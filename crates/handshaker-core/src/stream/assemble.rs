//! **Assemble** — one file out of a `bytes` field of every inbound message of a Stream
//! call, plus the two descriptor-driven helpers around it: the candidate list the UI
//! offers ([`bytes_fields`], computed at Open) and the default Save-As name
//! ([`default_name`]). Pure over descriptors and raw rows; the [`StreamCall`] wrappers
//! bind them to a call's Stream store.
//!
//! [`StreamCall`]: super::StreamCall

use std::borrow::Cow;
use std::io::Write;

use bytes::Bytes;
use prost_reflect::{DynamicMessage, FieldDescriptor, Kind, MessageDescriptor, ReflectMessage as _};

use super::decode_row;
use crate::base64::{classify, suggested_extension};
use crate::error::CoreError;

/// Nesting cap for [`bytes_fields`] — deeper than any real "chunk" envelope; the on-path
/// visited check already stops self-recursive types, this stops pathological chains.
const MAX_DEPTH: usize = 8;

/// String fields of the first inbound message that name the file, in precedence order.
const NAME_FIELDS: [&str; 3] = ["name", "file_name", "filename"];

/// What an assembly wrote: `written` = inbound messages that carried the field, `total`
/// = all inbound messages, `size_bytes` = bytes handed to the sink.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct AssembleResult {
    pub written: u32,
    pub total: u32,
    pub size_bytes: u64,
}

/// Assemble candidates of a response type: every non-repeated `bytes` field, top-level or
/// reached through nested **single** (non-repeated, non-map) message fields, as dotted
/// paths in declaration order (`data`, `chunk.payload`). A message type that nests itself
/// is walked once per path (no infinite descent); repeated and map fields are never
/// entered.
pub fn bytes_fields(desc: &MessageDescriptor) -> Vec<String> {
    let mut out = Vec::new();
    let mut on_path: Vec<String> = vec![desc.full_name().to_string()];
    walk(desc, "", &mut on_path, &mut out);
    out
}

fn walk(desc: &MessageDescriptor, prefix: &str, on_path: &mut Vec<String>, out: &mut Vec<String>) {
    if on_path.len() > MAX_DEPTH {
        return;
    }
    for field in desc.fields() {
        if field.is_list() || field.is_map() {
            continue;
        }
        let path = if prefix.is_empty() { field.name().to_string() } else { format!("{prefix}.{}", field.name()) };
        match field.kind() {
            Kind::Bytes => out.push(path),
            Kind::Message(inner) => {
                let name = inner.full_name().to_string();
                if on_path.iter().any(|n| *n == name) {
                    continue; // the type is already an ancestor on this path
                }
                on_path.push(name);
                walk(&inner, &path, on_path, out);
                on_path.pop();
            }
            _ => {}
        }
    }
}

/// Resolve a dotted `field_path` against `desc`: every segment a non-repeated, non-map
/// field, intermediates messages, the leaf `bytes`. `None` when the path is not an
/// Assemble candidate of this type.
pub fn resolve_path(desc: &MessageDescriptor, field_path: &str) -> Option<Vec<FieldDescriptor>> {
    let mut chain = Vec::new();
    let mut cur = desc.clone();
    let segments: Vec<&str> = field_path.split('.').collect();
    for (i, seg) in segments.iter().enumerate() {
        let field = cur.get_field_by_name(seg)?;
        if field.is_list() || field.is_map() {
            return None;
        }
        let last = i + 1 == segments.len();
        match field.kind() {
            Kind::Bytes if last => chain.push(field),
            Kind::Message(inner) if !last => {
                cur = inner;
                chain.push(field);
            }
            _ => return None,
        }
    }
    Some(chain)
}

/// The leaf `bytes` of one decoded message along `chain`, or `None` when any segment is
/// unset (a `oneof` sibling, a header / progress message) — that message contributes
/// nothing to the file.
fn leaf_bytes(msg: &DynamicMessage, chain: &[FieldDescriptor]) -> Option<Bytes> {
    let (last, parents) = chain.split_last()?;
    let mut cur: Cow<'_, DynamicMessage> = Cow::Borrowed(msg);
    for fd in parents {
        if !cur.has_field(fd) {
            return None;
        }
        let inner = cur.get_field(fd).as_message()?.clone();
        cur = Cow::Owned(inner);
    }
    if !cur.has_field(last) {
        return None;
    }
    cur.get_field(last).as_bytes().cloned()
}

/// Write the `chain` leaf of every row of `rows` (raw encoded messages of type `desc`, in
/// receive order) to `sink`, one message at a time — the file is never buffered whole.
/// Rows without the field are skipped silently (0 bytes, still counted in `total`).
pub fn assemble(
    desc: &MessageDescriptor,
    rows: impl IntoIterator<Item = Bytes>,
    chain: &[FieldDescriptor],
    sink: &mut dyn Write,
) -> Result<AssembleResult, CoreError> {
    let mut result = AssembleResult::default();
    for raw in rows {
        result.total += 1;
        let msg = decode_row(desc, raw)?;
        if let Some(chunk) = leaf_bytes(&msg, chain) {
            sink.write_all(&chunk).map_err(|e| CoreError::Persistence(format!("write: {e}")))?;
            result.written += 1;
            result.size_bytes += chunk.len() as u64;
        }
    }
    sink.flush().map_err(|e| CoreError::Persistence(format!("flush: {e}")))?;
    Ok(result)
}

/// Default Save-As name of an assembly: the non-empty `name` / `file_name` / `filename`
/// string field of the **first** inbound message (top-level), else
/// `stream-<stamp>.<ext>` with `<ext>` sniffed from the first message that carries the
/// field (`classify` over the whole chunk → `suggested_extension`), `bin` when nothing
/// was received or the content is unknown. `stamp` is the caller's local timestamp.
pub fn default_name(
    desc: &MessageDescriptor,
    rows: impl IntoIterator<Item = Bytes>,
    chain: &[FieldDescriptor],
    stamp: &str,
) -> Result<String, CoreError> {
    let mut first_chunk: Option<Bytes> = None;
    for (i, raw) in rows.into_iter().enumerate() {
        let msg = decode_row(desc, raw)?;
        if i == 0 {
            if let Some(name) = name_field(&msg) {
                return Ok(name);
            }
        }
        if let Some(chunk) = leaf_bytes(&msg, chain) {
            first_chunk = Some(chunk);
            break;
        }
    }
    let ext = match first_chunk {
        Some(chunk) if !chunk.is_empty() => suggested_extension(&classify(&chunk)),
        _ => "bin".to_string(),
    };
    Ok(format!("stream-{stamp}.{ext}"))
}

fn name_field(msg: &DynamicMessage) -> Option<String> {
    let desc = msg.descriptor();
    NAME_FIELDS.iter().find_map(|name| {
        let fd = desc.get_field_by_name(name)?;
        if fd.is_list() || fd.is_map() || !matches!(fd.kind(), Kind::String) || !msg.has_field(&fd) {
            return None;
        }
        let v = msg.get_field(&fd);
        let s = v.as_str()?;
        (!s.is_empty()).then(|| s.to_string())
    })
}

#[cfg(test)]
mod tests {
    use prost::Message as _;
    use prost_reflect::{DescriptorPool, Value};
    use prost_types::{
        field_descriptor_proto::{Label, Type as Ty},
        DescriptorProto, FieldDescriptorProto, FileDescriptorProto, FileDescriptorSet, MessageOptions,
    };

    use super::*;
    use crate::grpc::testing::dynamic_message;

    fn field(name: &str, number: i32, ty: Ty, type_name: Option<&str>, label: Label) -> FieldDescriptorProto {
        FieldDescriptorProto {
            name: Some(name.into()),
            number: Some(number),
            r#type: Some(ty as i32),
            type_name: type_name.map(Into::into),
            label: Some(label as i32),
            ..Default::default()
        }
    }

    /// ```proto
    /// message Meta  { bytes tag = 1; string note = 2; }
    /// message Node  { bytes payload = 1; Node next = 2; }
    /// message Chunk {
    ///   string name = 1; bytes data = 2; Meta meta = 3; repeated bytes parts = 4;
    ///   map<string, bytes> kv = 5; repeated Meta metas = 6; Node node = 7; int32 n = 8;
    ///   string file_name = 9;
    /// }
    /// message Plain { string id = 1; }
    /// ```
    fn pool() -> DescriptorPool {
        use Label::{Optional as Opt, Repeated as Rep};
        let meta = DescriptorProto {
            name: Some("Meta".into()),
            field: vec![field("tag", 1, Ty::Bytes, None, Opt), field("note", 2, Ty::String, None, Opt)],
            ..Default::default()
        };
        let node = DescriptorProto {
            name: Some("Node".into()),
            field: vec![
                field("payload", 1, Ty::Bytes, None, Opt),
                field("next", 2, Ty::Message, Some(".t.Node"), Opt),
            ],
            ..Default::default()
        };
        let kv_entry = DescriptorProto {
            name: Some("KvEntry".into()),
            field: vec![field("key", 1, Ty::String, None, Opt), field("value", 2, Ty::Bytes, None, Opt)],
            options: Some(MessageOptions { map_entry: Some(true), ..Default::default() }),
            ..Default::default()
        };
        let chunk = DescriptorProto {
            name: Some("Chunk".into()),
            field: vec![
                field("name", 1, Ty::String, None, Opt),
                field("data", 2, Ty::Bytes, None, Opt),
                field("meta", 3, Ty::Message, Some(".t.Meta"), Opt),
                field("parts", 4, Ty::Bytes, None, Rep),
                field("kv", 5, Ty::Message, Some(".t.Chunk.KvEntry"), Rep),
                field("metas", 6, Ty::Message, Some(".t.Meta"), Rep),
                field("node", 7, Ty::Message, Some(".t.Node"), Opt),
                field("n", 8, Ty::Int32, None, Opt),
                field("file_name", 9, Ty::String, None, Opt),
            ],
            nested_type: vec![kv_entry],
            ..Default::default()
        };
        let plain = DescriptorProto {
            name: Some("Plain".into()),
            field: vec![field("id", 1, Ty::String, None, Opt)],
            ..Default::default()
        };
        let file = FileDescriptorProto {
            name: Some("t.proto".into()),
            package: Some("t".into()),
            syntax: Some("proto3".into()),
            message_type: vec![meta, node, chunk, plain],
            ..Default::default()
        };
        let set = FileDescriptorSet { file: vec![file] };
        let mut pool = DescriptorPool::new();
        pool.add_file_descriptor_set(FileDescriptorSet::decode(&set.encode_to_vec()[..]).unwrap()).unwrap();
        pool
    }

    fn chunk_desc() -> MessageDescriptor {
        pool().get_message_by_name("t.Chunk").unwrap()
    }

    /// `Chunk { name?, data?, meta.tag? }` encoded.
    fn chunk(name: Option<&str>, data: Option<&[u8]>, tag: Option<&[u8]>) -> Bytes {
        let meta = |t: &[u8]| {
            let desc = pool().get_message_by_name("t.Meta").unwrap();
            Value::Message(dynamic_message(desc, [("tag", Value::Bytes(Bytes::copy_from_slice(t)))]))
        };
        let fields = name
            .map(|n| ("name", Value::String(n.into())))
            .into_iter()
            .chain(data.map(|d| ("data", Value::Bytes(Bytes::copy_from_slice(d)))))
            .chain(tag.map(|t| ("meta", meta(t))));
        Bytes::from(dynamic_message(chunk_desc(), fields).encode_to_vec())
    }

    fn chain(path: &str) -> Vec<FieldDescriptor> {
        resolve_path(&chunk_desc(), path).unwrap_or_else(|| panic!("{path} resolves"))
    }

    #[test]
    fn bytes_fields_lists_top_level_and_nested_single_paths_skips_repeated_and_map_and_terminates_on_recursion() {
        assert_eq!(bytes_fields(&chunk_desc()), vec!["data", "meta.tag", "node.payload"]);
        // A self-referencing type stops after one level: `payload`, never `next.payload…`.
        assert_eq!(bytes_fields(&pool().get_message_by_name("t.Node").unwrap()), vec!["payload"]);
        assert!(bytes_fields(&pool().get_message_by_name("t.Plain").unwrap()).is_empty());
    }

    #[test]
    fn resolve_path_accepts_only_candidates() {
        let d = chunk_desc();
        assert_eq!(resolve_path(&d, "data").unwrap().len(), 1);
        assert_eq!(resolve_path(&d, "meta.tag").unwrap().len(), 2);
        for bad in ["name", "parts", "kv", "metas.tag", "meta", "meta.note", "nope", "data.x", "", "meta."] {
            assert!(resolve_path(&d, bad).is_none(), "{bad:?} must not resolve");
        }
    }

    #[test]
    fn assemble_concatenates_the_field_in_order_and_skips_rows_without_it() {
        let rows = vec![
            chunk(Some("f.bin"), None, None), // header message: no data
            chunk(None, Some(b"ab"), None),
            chunk(None, None, Some(b"T")), // progress-like: data unset
            chunk(None, Some(b"cd"), Some(b"U")),
            chunk(None, Some(b""), None), // empty bytes = unset in proto3 → skipped
        ];
        let mut sink = Vec::new();
        let r = assemble(&chunk_desc(), rows.clone(), &chain("data"), &mut sink).unwrap();
        assert_eq!(sink, b"abcd");
        assert_eq!(r, AssembleResult { written: 2, total: 5, size_bytes: 4 });

        let mut sink = Vec::new();
        let r = assemble(&chunk_desc(), rows, &chain("meta.tag"), &mut sink).unwrap();
        assert_eq!(sink, b"TU");
        assert_eq!(r, AssembleResult { written: 2, total: 5, size_bytes: 2 });
    }

    /// Records every `write` call — proves the file goes out one chunk at a time.
    struct CountingSink {
        writes: Vec<usize>,
    }

    impl Write for CountingSink {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.writes.push(buf.len());
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn assemble_streams_one_write_per_message_never_one_buffer() {
        let rows: Vec<Bytes> = (1..=4).map(|i| chunk(None, Some(&vec![0u8; i * 1000]), None)).collect();
        let mut sink = CountingSink { writes: vec![] };
        let r = assemble(&chunk_desc(), rows, &chain("data"), &mut sink).unwrap();
        assert_eq!(sink.writes, vec![1000, 2000, 3000, 4000]);
        assert_eq!(r.size_bytes, 10_000);
    }

    #[test]
    fn assemble_with_no_rows_writes_nothing_and_counts_zero() {
        let mut sink = Vec::new();
        let r = assemble(&chunk_desc(), Vec::<Bytes>::new(), &chain("data"), &mut sink).unwrap();
        assert!(sink.is_empty());
        assert_eq!(r, AssembleResult::default());
    }

    #[test]
    fn default_name_prefers_a_name_field_of_the_first_message() {
        let d = chunk_desc();
        let rows = vec![chunk(Some("report.pdf"), None, None), chunk(Some("other"), Some(b"x"), None)];
        assert_eq!(default_name(&d, rows, &chain("data"), "S").unwrap(), "report.pdf");
        // `file_name` counts too; an empty `name` does not.
        let m = dynamic_message(
            d.clone(),
            [("name", Value::String(String::new())), ("file_name", Value::String("via-file-name.txt".into()))],
        );
        let rows = vec![Bytes::from(m.encode_to_vec())];
        assert_eq!(default_name(&d, rows, &chain("data"), "S").unwrap(), "via-file-name.txt");
        // Only the FIRST message names the file.
        let rows = vec![chunk(None, Some(&[0xff, 0xfe]), None), chunk(Some("late.bin"), None, None)];
        assert_eq!(default_name(&d, rows, &chain("data"), "S").unwrap(), "stream-S.bin");
    }

    #[test]
    fn default_name_sniffs_the_extension_from_the_first_chunk_with_the_field() {
        let d = chunk_desc();
        let png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
        let rows = vec![chunk(None, None, Some(b"skip")), chunk(None, Some(&png), None)];
        assert_eq!(
            default_name(&d, rows, &chain("data"), "2026-09-28T10-00-00").unwrap(),
            "stream-2026-09-28T10-00-00.png"
        );
        let rows = vec![chunk(None, Some(br#"{"a":1}"#), None)];
        assert_eq!(default_name(&d, rows, &chain("data"), "S").unwrap(), "stream-S.json");
        let rows = vec![chunk(None, Some(&[0x00, 0x01, 0x02, 0xff, 0xfe]), None)];
        assert_eq!(default_name(&d, rows, &chain("data"), "S").unwrap(), "stream-S.bin");
        // Nothing received, or no row carries the field → `.bin`.
        assert_eq!(default_name(&d, Vec::<Bytes>::new(), &chain("data"), "S").unwrap(), "stream-S.bin");
        let rows = vec![chunk(None, None, Some(b"T"))];
        assert_eq!(default_name(&d, rows, &chain("data"), "S").unwrap(), "stream-S.bin");
    }
}
