//! Pure body rules: what a request body implies and encodes to, and how a response body
//! is classified for display.

use serde::de::IgnoredAny;

use super::ResponseBody;

/// A body after `{{var}}` resolve and built-in expansion, before encoding.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ResolvedBody {
    None,
    Json(String),
    Text(String),
    Form(Vec<(String, String)>),
}

/// The `Content-Type` a body implies. Applied only when the user set none.
pub(crate) fn implied_content_type(body: &ResolvedBody) -> Option<&'static str> {
    match body {
        ResolvedBody::None => None,
        ResolvedBody::Json(_) => Some("application/json"),
        ResolvedBody::Text(_) => Some("text/plain; charset=utf-8"),
        ResolvedBody::Form(_) => Some("application/x-www-form-urlencoded"),
    }
}

/// The bytes on the wire. `None` for no body, so no `Content-Length: 0` is invented.
pub(crate) fn encode(body: ResolvedBody) -> Option<bytes::Bytes> {
    match body {
        ResolvedBody::None => None,
        ResolvedBody::Json(text) | ResolvedBody::Text(text) => Some(text.into()),
        ResolvedBody::Form(fields) => Some(
            url::form_urlencoded::Serializer::new(String::new())
                .extend_pairs(fields)
                .finish()
                .into(),
        ),
    }
}

/// Classify a fully-read body. JSON when the content type says so (`application/json`,
/// `*+json`), or when it is absent or `text/plain` and the bytes hold a JSON object or
/// array. Text when the bytes are UTF-8, Binary otherwise, Empty for zero bytes.
pub(crate) fn classify_response(content_type: Option<&str>, bytes: &[u8]) -> ResponseBody {
    if bytes.is_empty() {
        return ResponseBody::Empty;
    }
    let Ok(text) = std::str::from_utf8(bytes) else {
        return ResponseBody::Binary;
    };
    let essence = content_type.map(|ct| {
        ct.split(';')
            .next()
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
    });
    let json_declared = essence
        .as_deref()
        .is_some_and(|e| e == "application/json" || e.ends_with("+json"));
    let json_sniffable = matches!(essence.as_deref(), None | Some("text/plain"))
        && text.trim_start().starts_with(['{', '[']);
    if json_declared || json_sniffable {
        if let Some(pretty) = reindent_json_lexemes(text) {
            return ResponseBody::Json { text: pretty };
        }
    }
    ResponseBody::Text {
        text: text.to_string(),
    }
}

pub(crate) fn reindent_json_lexemes(text: &str) -> Option<String> {
    serde_json::from_str::<IgnoredAny>(text).ok()?;
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len() + text.len() / 2);
    let mut depth = 0usize;
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'"' => {
                let end = string_end(bytes, i);
                out.push_str(&text[i..end]);
                i = end;
                continue;
            }
            open @ (b'{' | b'[') => {
                let next = skip_whitespace(bytes, i + 1);
                if matches!(bytes.get(next), Some(b'}' | b']')) {
                    out.push(open as char);
                    out.push(bytes[next] as char);
                    i = next + 1;
                    continue;
                }
                depth += 1;
                out.push(open as char);
                newline(&mut out, depth);
            }
            close @ (b'}' | b']') => {
                depth -= 1;
                newline(&mut out, depth);
                out.push(close as char);
            }
            b',' => {
                out.push(',');
                newline(&mut out, depth);
            }
            b':' => out.push_str(": "),
            b' ' | b'\t' | b'\n' | b'\r' => {}
            _ => {
                let end = scalar_end(bytes, i);
                out.push_str(&text[i..end]);
                i = end;
                continue;
            }
        }
        i += 1;
    }
    Some(out)
}

fn newline(out: &mut String, depth: usize) {
    out.push('\n');
    out.extend(std::iter::repeat("  ").take(depth));
}

/// Index one past the closing quote of the string opening at `start`. Validated JSON
/// guarantees the quote exists, and UTF-8 continuation bytes never equal `"` or `\`.
fn string_end(bytes: &[u8], start: usize) -> usize {
    let mut i = start + 1;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i += 2,
            b'"' => return i + 1,
            _ => i += 1,
        }
    }
    bytes.len()
}

fn skip_whitespace(bytes: &[u8], mut i: usize) -> usize {
    while matches!(bytes.get(i), Some(b' ' | b'\t' | b'\n' | b'\r')) {
        i += 1;
    }
    i
}

/// A number, `true`, `false`, or `null` runs until the next structural byte or whitespace.
fn scalar_end(bytes: &[u8], mut i: usize) -> usize {
    while i < bytes.len()
        && !matches!(
            bytes[i],
            b'{' | b'}' | b'[' | b']' | b',' | b':' | b'"' | b' ' | b'\t' | b'\n' | b'\r'
        )
    {
        i += 1;
    }
    i
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reindent_json_lexemes_keeps_integers_beyond_f64_and_key_order() {
        let pretty =
            reindent_json_lexemes(r#"{"z":9007199254740993,"a":[1, 2.50e3],"s":"x\"y {,}"}"#)
                .unwrap();
        assert_eq!(
            pretty,
            "{\n  \"z\": 9007199254740993,\n  \"a\": [\n    1,\n    2.50e3\n  ],\n  \"s\": \"x\\\"y {,}\"\n}"
        );
    }

    #[test]
    fn reindent_json_lexemes_keeps_empty_containers_compact_and_rejects_non_json() {
        assert_eq!(
            reindent_json_lexemes(r#"{"a": { }, "b": []}"#).unwrap(),
            "{\n  \"a\": {},\n  \"b\": []\n}"
        );
        assert_eq!(reindent_json_lexemes("  42 "), Some("42".to_string()));
        assert_eq!(reindent_json_lexemes(r#"{"a":}"#), None);
    }

    #[test]
    fn classify_covers_every_body_kind() {
        let json = ResponseBody::Json {
            text: "{\n  \"id\": 1\n}".into(),
        };
        assert_eq!(
            classify_response(Some("application/json; charset=utf-8"), br#"{"id":1}"#),
            json
        );
        assert_eq!(
            classify_response(Some("application/problem+json"), br#"{"id":1}"#),
            json
        );
        assert_eq!(classify_response(Some("text/plain"), br#"{"id":1}"#), json);
        assert_eq!(classify_response(None, br#"{"id":1}"#), json);
        assert_eq!(
            classify_response(Some("application/json"), b"not json"),
            ResponseBody::Text {
                text: "not json".into()
            }
        );
        assert_eq!(
            classify_response(Some("text/html"), br#"{"id":1}"#),
            ResponseBody::Text {
                text: r#"{"id":1}"#.into()
            }
        );
        assert_eq!(
            classify_response(Some("application/octet-stream"), &[0xff, 0xfe]),
            ResponseBody::Binary
        );
        assert_eq!(
            classify_response(Some("application/json"), b""),
            ResponseBody::Empty
        );
    }

    #[test]
    fn each_body_mode_implies_its_content_type_and_encodes_its_bytes() {
        let form = ResolvedBody::Form(vec![("q".into(), "a b".into()), ("x".into(), "1&2".into())]);
        assert_eq!(
            implied_content_type(&form),
            Some("application/x-www-form-urlencoded")
        );
        assert_eq!(encode(form).unwrap(), bytes::Bytes::from("q=a+b&x=1%262"));

        let json = ResolvedBody::Json(r#"{"a":1}"#.into());
        assert_eq!(implied_content_type(&json), Some("application/json"));
        assert_eq!(encode(json).unwrap(), bytes::Bytes::from(r#"{"a":1}"#));

        let text = ResolvedBody::Text("hi".into());
        assert_eq!(
            implied_content_type(&text),
            Some("text/plain; charset=utf-8")
        );

        assert_eq!(implied_content_type(&ResolvedBody::None), None);
        assert_eq!(encode(ResolvedBody::None), None);
    }
}
