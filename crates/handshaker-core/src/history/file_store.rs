use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

use uuid::Uuid;

use super::{
    CallId, CallOutcome, CallRecord, CallSummary, RecordedBody, HISTORY_CAP, INLINE_JSON_BUDGET,
    MAX_MESSAGE_ROWS, MAX_RECORD_BYTES,
};
use crate::persist::{
    atomic_write_bytes, atomic_write_json, quarantine_corrupt, read_json, read_json_or_default,
    to_json_bytes, Envelope,
};
use crate::CoreError;

const INDEX: &str = "index.json";

#[derive(Debug, Clone, PartialEq)]
pub struct HistoryPage {
    /// 1 after `load`, bumped on every committed append. The frontend applies a page only
    /// when its revision is newer than the one it holds, so replies can land in any order.
    pub revision: u32,
    /// Newest first.
    pub rows: Vec<CallSummary>,
}

#[derive(Debug)]
pub struct FileHistoryStore {
    dir: PathBuf,
    log: RwLock<HistoryPage>,
    recovered: Vec<PathBuf>,
}

impl FileHistoryStore {
    /// Open the log under `dir`. A missing dir is an empty log; nothing is created until
    /// the first append.
    pub fn load(dir: &Path) -> Result<Self, CoreError> {
        let index_path = dir.join(INDEX);
        let index: Vec<CallSummary> = read_json(&index_path).unwrap_or_default();
        let bodies = scan_bodies(dir)?;
        let mut rows: Vec<CallSummary> = index
            .iter()
            .filter(|r| bodies.contains(&r.id))
            .cloned()
            .collect();
        let indexed: HashSet<CallId> = rows.iter().map(|r| r.id).collect();
        let mut recovered = Vec::new();
        for &id in bodies.iter().filter(|id| !indexed.contains(id)) {
            let path = body_path(dir, id);
            match read_json::<CallRecord>(&path) {
                Ok(record) if record.id == id => rows.push(record.summary()),
                _ => recovered.extend(quarantine_corrupt(&path)),
            }
        }
        let (rows, evicted) = retain_newest(rows);
        remove_bodies(dir, &evicted);
        if rows != index {
            let _ = atomic_write_json(&index_path, &Envelope::new(&rows));
        }
        Ok(Self {
            dir: dir.to_path_buf(),
            log: RwLock::new(HistoryPage { revision: 1, rows }),
            recovered,
        })
    }

    pub fn recovered_files(&self) -> &[PathBuf] {
        &self.recovered
    }

    pub fn list(&self) -> HistoryPage {
        self.log.read().expect("history poisoned").clone()
    }

    /// `Ok(None)` when the id is not in the log (evicted or never recorded) or its body is
    /// gone. A corrupt body is a `Persistence` error; it is not quarantined at runtime.
    pub fn get(&self, id: CallId) -> Result<Option<CallRecord>, CoreError> {
        let log = self.log.read().expect("history poisoned");
        if !log.rows.iter().any(|r| r.id == id) {
            return Ok(None);
        }
        read_json_or_default::<Option<CallRecord>>(&body_path(&self.dir, id))
    }

    /// Persist one record, trimmed to the size bound, and return the page after it. An id
    /// already in the log is a no-op. A record still over [`MAX_RECORD_BYTES`] after the
    /// trim is refused with a `Persistence` error and nothing is written.
    pub fn append(&self, record: CallRecord) -> Result<HistoryPage, CoreError> {
        let mut log = self.log.write().expect("history poisoned");
        if log.rows.iter().any(|r| r.id == record.id) {
            return Ok(log.clone());
        }
        let record = fit_budget(record);
        let path = body_path(&self.dir, record.id);
        let bytes = to_json_bytes(&path, &Envelope::new(&record))?;
        if bytes.len() > MAX_RECORD_BYTES {
            return Err(CoreError::Persistence(format!(
                "call record is {} bytes after trimming; the limit is {MAX_RECORD_BYTES}",
                bytes.len()
            )));
        }
        atomic_write_bytes(&path, &bytes)?;
        let mut rows = log.rows.clone();
        rows.push(record.summary());
        let (rows, evicted) = retain_newest(rows);
        let _ = atomic_write_json(&self.dir.join(INDEX), &Envelope::new(&rows));
        *log = HistoryPage {
            revision: log.revision + 1,
            rows,
        };
        remove_bodies(&self.dir, &evicted);
        Ok(log.clone())
    }
}

fn retain_newest(mut rows: Vec<CallSummary>) -> (Vec<CallSummary>, Vec<CallId>) {
    rows.sort_by(|a, b| {
        b.started_at_ms
            .total_cmp(&a.started_at_ms)
            .then(b.id.cmp(&a.id))
    });
    let mut seen = HashSet::new();
    rows.retain(|r| seen.insert(r.id));
    let evicted = rows
        .split_off(rows.len().min(HISTORY_CAP))
        .into_iter()
        .map(|r| r.id)
        .collect();
    (rows, evicted)
}

fn fit_budget(mut record: CallRecord) -> CallRecord {
    match &mut record.outcome {
        CallOutcome::Unary { response, .. } => {
            if let RecordedBody::Inline { json } = response {
                let size = json.len();
                if size > INLINE_JSON_BUDGET {
                    *response = RecordedBody::Omitted {
                        size_bytes: size as u64,
                    };
                }
            }
        }
        CallOutcome::Stream {
            messages,
            omitted_messages,
            ..
        } => {
            let excess = messages.len().saturating_sub(MAX_MESSAGE_ROWS);
            messages.drain(..excess);
            *omitted_messages =
                omitted_messages.saturating_add(u32::try_from(excess).unwrap_or(u32::MAX));
            let mut inline: usize = messages
                .iter()
                .filter_map(|m| m.json.as_ref())
                .map(String::len)
                .sum();
            for message in messages.iter_mut() {
                if inline <= INLINE_JSON_BUDGET {
                    break;
                }
                if let Some(json) = message.json.take() {
                    inline -= json.len();
                }
            }
        }
        CallOutcome::UnaryFault { .. } | CallOutcome::StreamRefused { .. } => {}
    }
    record
}

fn scan_bodies(dir: &Path) -> Result<HashSet<CallId>, CoreError> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(HashSet::new()),
        Err(e) => {
            return Err(CoreError::Persistence(format!(
                "read dir {}: {e}",
                dir.display()
            )))
        }
    };
    let mut ids = HashSet::new();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if name.ends_with(".tmp") {
            let _ = fs::remove_file(entry.path());
        } else if let Some(stem) = name.strip_suffix(".json") {
            if let Some(id) = Uuid::parse_str(stem).ok().filter(|u| u.to_string() == stem) {
                ids.insert(CallId(id));
            }
        }
    }
    Ok(ids)
}

fn remove_bodies(dir: &Path, ids: &[CallId]) {
    for &id in ids {
        let _ = fs::remove_file(body_path(dir, id));
    }
}

fn body_path(dir: &Path, id: CallId) -> PathBuf {
    dir.join(format!("{}.json", id.0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::history::testing::*;
    use tempfile::tempdir;

    fn id(n: u128) -> CallId {
        CallId(Uuid::from_u128(n))
    }

    fn ok(n: u128, started_at_ms: f64) -> CallRecord {
        unary(n, started_at_ms, RecordedBody::Inline { json: "{}".into() })
    }

    fn ids(page: &HistoryPage) -> Vec<u128> {
        page.rows.iter().map(|r| r.id.0.as_u128()).collect()
    }

    fn write_body(dir: &Path, record: &CallRecord) {
        atomic_write_json(&body_path(dir, record.id), &Envelope::new(record)).unwrap();
    }

    #[test]
    fn round_trips_through_reload() {
        let dir = tempdir().unwrap();
        let store = FileHistoryStore::load(dir.path()).unwrap();
        assert_eq!(
            store.list(),
            HistoryPage {
                revision: 1,
                rows: vec![]
            }
        );
        let record = stream(
            1,
            10.0,
            vec![message(1, Some("{\n  \"tick\": 1\n}".into()))],
        );
        store.append(record.clone()).unwrap();

        let back = FileHistoryStore::load(dir.path()).unwrap();
        assert_eq!(back.list().rows, vec![record.summary()]);
        assert_eq!(back.get(id(1)).unwrap(), Some(record));
        assert!(back.recovered_files().is_empty());
    }

    #[test]
    fn list_is_newest_first_with_id_tiebreak() {
        let dir = tempdir().unwrap();
        let store = FileHistoryStore::load(dir.path()).unwrap();
        for (n, t) in [(1, 10.0), (2, 30.0), (3, 10.0), (4, 20.0)] {
            store.append(ok(n, t)).unwrap();
        }
        assert_eq!(ids(&store.list()), vec![2, 4, 3, 1]);
        assert_eq!(
            ids(&FileHistoryStore::load(dir.path()).unwrap().list()),
            vec![2, 4, 3, 1]
        );
    }

    #[test]
    fn cap_evicts_oldest_and_deletes_its_body() {
        let dir = tempdir().unwrap();
        let store = FileHistoryStore::load(dir.path()).unwrap();
        for n in 1..=HISTORY_CAP as u128 + 1 {
            store.append(ok(n, n as f64)).unwrap();
        }
        let page = store.list();
        assert_eq!(page.rows.len(), HISTORY_CAP);
        assert_eq!(page.rows.first().unwrap().id, id(HISTORY_CAP as u128 + 1));
        assert_eq!(page.rows.last().unwrap().id, id(2));
        assert!(!body_path(dir.path(), id(1)).exists());
        assert!(body_path(dir.path(), id(2)).exists());
        assert_eq!(store.get(id(1)).unwrap(), None);
    }

    #[test]
    fn late_append_older_than_cap_is_evicted() {
        let dir = tempdir().unwrap();
        for n in 1..=HISTORY_CAP as u128 {
            write_body(dir.path(), &ok(n, 100.0 + n as f64));
        }
        let store = FileHistoryStore::load(dir.path()).unwrap();
        let before = store.list();

        let page = store.append(ok(999, 1.0)).unwrap();

        assert_eq!(page.revision, before.revision + 1);
        assert_eq!(page.rows, before.rows);
        assert!(!body_path(dir.path(), id(999)).exists());
    }

    #[test]
    fn re_append_same_id_is_a_noop() {
        let dir = tempdir().unwrap();
        let store = FileHistoryStore::load(dir.path()).unwrap();
        let page = store.append(ok(1, 10.0)).unwrap();
        let again = store
            .append(CallRecord {
                elapsed_ms: 99,
                ..ok(1, 50.0)
            })
            .unwrap();
        assert_eq!(again, page);
        assert_eq!(store.get(id(1)).unwrap().unwrap().elapsed_ms, 12);
    }

    #[test]
    fn revision_increments_per_append() {
        let dir = tempdir().unwrap();
        let store = FileHistoryStore::load(dir.path()).unwrap();
        assert_eq!(store.append(ok(1, 1.0)).unwrap().revision, 2);
        assert_eq!(store.append(ok(2, 2.0)).unwrap().revision, 3);
        assert_eq!(store.append(ok(2, 2.0)).unwrap().revision, 3);
        assert_eq!(store.list().revision, 3);
    }

    #[test]
    fn orphan_body_is_adopted_on_load() {
        let dir = tempdir().unwrap();
        FileHistoryStore::load(dir.path())
            .unwrap()
            .append(ok(1, 10.0))
            .unwrap();
        write_body(dir.path(), &ok(2, 20.0));

        let store = FileHistoryStore::load(dir.path()).unwrap();

        assert_eq!(ids(&store.list()), vec![2, 1]);
        let index: Vec<CallSummary> = read_json(&dir.path().join(INDEX)).unwrap();
        assert_eq!(index.len(), 2);
        assert!(store.recovered_files().is_empty());
    }

    #[test]
    fn lingering_evicted_body_is_trimmed_on_load() {
        let dir = tempdir().unwrap();
        for n in 1..=HISTORY_CAP as u128 + 1 {
            write_body(dir.path(), &ok(n, n as f64));
        }
        let store = FileHistoryStore::load(dir.path()).unwrap();
        assert_eq!(store.list().rows.len(), HISTORY_CAP);
        assert_eq!(store.list().rows.last().unwrap().id, id(2));
        assert!(!body_path(dir.path(), id(1)).exists());
    }

    #[test]
    fn index_row_without_body_is_dropped() {
        let dir = tempdir().unwrap();
        let store = FileHistoryStore::load(dir.path()).unwrap();
        store.append(ok(1, 1.0)).unwrap();
        store.append(ok(2, 2.0)).unwrap();
        fs::remove_file(body_path(dir.path(), id(1))).unwrap();
        assert_eq!(
            ids(&FileHistoryStore::load(dir.path()).unwrap().list()),
            vec![2]
        );
    }

    #[test]
    fn corrupt_index_is_rebuilt_and_not_reported() {
        let dir = tempdir().unwrap();
        let store = FileHistoryStore::load(dir.path()).unwrap();
        store.append(ok(1, 1.0)).unwrap();
        store.append(ok(2, 2.0)).unwrap();
        fs::write(dir.path().join(INDEX), b"{ not json").unwrap();

        let back = FileHistoryStore::load(dir.path()).unwrap();

        assert_eq!(ids(&back.list()), vec![2, 1]);
        assert!(back.recovered_files().is_empty());
        let index: Vec<CallSummary> = read_json(&dir.path().join(INDEX)).unwrap();
        assert_eq!(index, back.list().rows);
    }

    #[test]
    fn corrupt_body_is_quarantined_and_reported() {
        let dir = tempdir().unwrap();
        FileHistoryStore::load(dir.path())
            .unwrap()
            .append(ok(1, 1.0))
            .unwrap();
        let bad = body_path(dir.path(), id(2));
        fs::write(&bad, b"{ not json").unwrap();

        let store = FileHistoryStore::load(dir.path()).unwrap();

        assert_eq!(ids(&store.list()), vec![1]);
        assert!(!bad.exists());
        assert_eq!(store.recovered_files().len(), 1);
        assert!(store.recovered_files()[0].exists());
        assert!(store.recovered_files()[0]
            .to_string_lossy()
            .ends_with(".json.corrupt"));
        assert_eq!(
            ids(&FileHistoryStore::load(dir.path()).unwrap().list()),
            vec![1]
        );
    }

    #[test]
    fn body_under_another_id_is_quarantined() {
        let dir = tempdir().unwrap();
        atomic_write_json(&body_path(dir.path(), id(2)), &Envelope::new(ok(1, 1.0))).unwrap();
        let store = FileHistoryStore::load(dir.path()).unwrap();
        assert!(store.list().rows.is_empty());
        assert_eq!(store.recovered_files().len(), 1);
    }

    #[test]
    fn stale_tmp_is_removed() {
        let dir = tempdir().unwrap();
        let tmp = dir.path().join(format!("{}.json.tmp", id(1).0));
        fs::write(&tmp, b"partial").unwrap();
        fs::write(dir.path().join("index.json.tmp"), b"partial").unwrap();

        let store = FileHistoryStore::load(dir.path()).unwrap();

        assert!(store.list().rows.is_empty());
        assert!(!tmp.exists());
        assert!(!dir.path().join("index.json.tmp").exists());
    }

    #[test]
    fn missing_dir_is_an_empty_log_and_creates_nothing() {
        let dir = tempdir().unwrap();
        let history = dir.path().join("history");
        let store = FileHistoryStore::load(&history).unwrap();
        assert_eq!(
            store.list(),
            HistoryPage {
                revision: 1,
                rows: vec![]
            }
        );
        assert!(!history.exists());
    }

    #[test]
    fn get_unknown_id_is_none() {
        let dir = tempdir().unwrap();
        let store = FileHistoryStore::load(dir.path()).unwrap();
        store.append(ok(1, 1.0)).unwrap();
        assert_eq!(store.get(id(9)).unwrap(), None);
    }

    #[test]
    fn get_of_a_corrupt_indexed_body_is_a_persistence_error() {
        let dir = tempdir().unwrap();
        let store = FileHistoryStore::load(dir.path()).unwrap();
        store.append(ok(1, 1.0)).unwrap();
        fs::write(body_path(dir.path(), id(1)), b"{ not json").unwrap();
        assert!(matches!(store.get(id(1)), Err(CoreError::Persistence(_))));
    }

    #[test]
    fn over_budget_unary_body_is_omitted_with_its_size() {
        let dir = tempdir().unwrap();
        let store = FileHistoryStore::load(dir.path()).unwrap();
        let kept = "k".repeat(INLINE_JSON_BUDGET);
        store
            .append(unary(1, 1.0, RecordedBody::Inline { json: kept.clone() }))
            .unwrap();
        store
            .append(unary(
                2,
                2.0,
                RecordedBody::Inline {
                    json: "o".repeat(INLINE_JSON_BUDGET + 1),
                },
            ))
            .unwrap();

        let response = |n| match store.get(id(n)).unwrap().unwrap().outcome {
            CallOutcome::Unary { response, .. } => response,
            other => panic!("expected unary, got {other:?}"),
        };
        assert_eq!(response(1), RecordedBody::Inline { json: kept });
        assert_eq!(
            response(2),
            RecordedBody::Omitted {
                size_bytes: INLINE_JSON_BUDGET as u64 + 1
            }
        );
    }

    #[test]
    fn stream_keeps_the_newest_rows_and_counts_the_rest() {
        let dir = tempdir().unwrap();
        let store = FileHistoryStore::load(dir.path()).unwrap();
        let messages = (1..=MAX_MESSAGE_ROWS as u32 + 5)
            .map(|i| message(i, None))
            .collect();
        store.append(stream(1, 1.0, messages)).unwrap();

        match store.get(id(1)).unwrap().unwrap().outcome {
            CallOutcome::Stream {
                messages,
                omitted_messages,
                ..
            } => {
                assert_eq!(messages.len(), MAX_MESSAGE_ROWS);
                assert_eq!(messages.first().unwrap().index, 6);
                assert_eq!(messages.last().unwrap().index, MAX_MESSAGE_ROWS as u32 + 5);
                assert_eq!(omitted_messages, 5);
            }
            other => panic!("expected stream, got {other:?}"),
        }
    }

    #[test]
    fn inline_message_json_is_dropped_oldest_first_until_the_budget_holds() {
        let dir = tempdir().unwrap();
        let store = FileHistoryStore::load(dir.path()).unwrap();
        let half = "j".repeat(INLINE_JSON_BUDGET / 2);
        let messages = (1..=3).map(|i| message(i, Some(half.clone()))).collect();
        store.append(stream(1, 1.0, messages)).unwrap();

        match store.get(id(1)).unwrap().unwrap().outcome {
            CallOutcome::Stream {
                messages,
                omitted_messages,
                ..
            } => {
                let inline: Vec<bool> = messages.iter().map(|m| m.json.is_some()).collect();
                assert_eq!(inline, vec![false, true, true]);
                assert_eq!(messages[0].preview, "{\"tick\":1}");
                assert_eq!(omitted_messages, 0);
            }
            other => panic!("expected stream, got {other:?}"),
        }
    }

    #[test]
    fn request_body_is_never_truncated() {
        let dir = tempdir().unwrap();
        let store = FileHistoryStore::load(dir.path()).unwrap();
        let body = "b".repeat(300 * 1024);
        let record = CallRecord {
            request: request(&body),
            ..unary(
                1,
                1.0,
                RecordedBody::Inline {
                    json: "c".repeat(300 * 1024),
                },
            )
        };
        store.append(record).unwrap();

        let back = store.get(id(1)).unwrap().unwrap();
        assert_eq!(back.request, request(&body));
        assert!(matches!(
            back.outcome,
            CallOutcome::Unary {
                response: RecordedBody::Omitted { .. },
                ..
            }
        ));
    }

    #[test]
    fn record_over_the_size_limit_after_trimming_is_refused() {
        let dir = tempdir().unwrap();
        let store = FileHistoryStore::load(dir.path()).unwrap();
        let record = CallRecord {
            request: request(&"b".repeat(MAX_RECORD_BYTES)),
            ..ok(1, 1.0)
        };

        let err = store.append(record).unwrap_err();

        assert!(matches!(err, CoreError::Persistence(m) if m.contains("after trimming")));
        assert_eq!(
            store.list(),
            HistoryPage {
                revision: 1,
                rows: vec![]
            }
        );
        assert!(!body_path(dir.path(), id(1)).exists());
    }
}
