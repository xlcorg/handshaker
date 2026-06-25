//! Lenient JSON pre-processing for the request body sent on Send.
//!
//! The only leniency is forgiving a *trailing comma* — a `,` whose next
//! significant character is `}` or `]`. Everything else that is invalid JSON
//! (double commas, sparse arrays, comments, trailing junk) is left intact so the
//! strict `serde_json` deserializer behind `prost_reflect::DynamicMessage` still
//! rejects it. This is a pure text scrub: no number is ever parsed or
//! re-serialized, so int64 precision and the user's formatting are preserved.

use std::borrow::Cow;

/// Remove JSON trailing commas (a `,` whose next significant character is `}` or
/// `]`) from `input`. Returns `Cow::Borrowed` when there is nothing to strip, so
/// the common clean-body path allocates nothing.
///
/// String-aware: commas inside string literals are copied verbatim, so a value
/// like `"x, ]"` is never corrupted. Only a genuine trailing comma is dropped —
/// any other malformed JSON is left intact for the strict deserializer to reject.
pub(crate) fn strip_trailing_commas(input: &str) -> Cow<'_, str> {
    let bytes = input.as_bytes();
    let mut in_string = false;
    let mut escaped = false;
    // Allocated lazily on the first dropped comma, back-filled with the clean
    // prefix seen so far; stays `None` (⇒ Borrowed) when nothing is dropped.
    let mut out: Option<Vec<u8>> = None;

    for (i, &b) in bytes.iter().enumerate() {
        if in_string {
            if let Some(o) = out.as_mut() {
                o.push(b);
            }
            if escaped {
                escaped = false;
            } else if b == b'\\' {
                escaped = true;
            } else if b == b'"' {
                in_string = false;
            }
            continue;
        }
        if b == b'"' {
            in_string = true;
            if let Some(o) = out.as_mut() {
                o.push(b);
            }
            continue;
        }
        if b == b',' && next_significant_is_close(bytes, i + 1) {
            // First drop: materialize the buffer with the clean prefix (which
            // already excludes this comma at index `i`). The comma is not pushed.
            out.get_or_insert_with(|| bytes[..i].to_vec());
            continue;
        }
        if let Some(o) = out.as_mut() {
            o.push(b);
        }
    }

    match out {
        None => Cow::Borrowed(input),
        // Only ASCII `,` bytes are ever dropped and every other byte is copied
        // verbatim, so the result is still valid UTF-8.
        Some(o) => Cow::Owned(
            String::from_utf8(o).expect("only ASCII commas dropped; result is valid UTF-8"),
        ),
    }
}

/// True if, skipping JSON whitespace from `start`, the next byte is `}` or `]`.
fn next_significant_is_close(bytes: &[u8], start: usize) -> bool {
    let mut j = start;
    while j < bytes.len() && matches!(bytes[j], b' ' | b'\t' | b'\r' | b'\n') {
        j += 1;
    }
    matches!(bytes.get(j), Some(b'}') | Some(b']'))
}

#[cfg(test)]
mod tests {
    use super::strip_trailing_commas;
    use std::borrow::Cow;

    #[test]
    fn strips_object_trailing_comma() {
        assert_eq!(strip_trailing_commas("{\"a\":1,}"), "{\"a\":1}");
    }

    #[test]
    fn strips_array_trailing_comma() {
        assert_eq!(strip_trailing_commas("[1,2,]"), "[1,2]");
    }

    #[test]
    fn strips_trailing_comma_with_whitespace_before_brace() {
        assert_eq!(strip_trailing_commas("{\"a\":1,\n}"), "{\"a\":1\n}");
    }

    #[test]
    fn strips_nested_trailing_commas() {
        assert_eq!(
            strip_trailing_commas("{\"a\":[1,2,],}"),
            "{\"a\":[1,2]}"
        );
    }

    #[test]
    fn keeps_interior_comma() {
        // The comma between fields is not trailing — it must stay.
        assert_eq!(strip_trailing_commas("{\"a\":1,\"b\":2}"), "{\"a\":1,\"b\":2}");
    }

    #[test]
    fn does_not_touch_comma_inside_string_value() {
        // The reason a string-aware scan is required: a bare regex would corrupt
        // this string value into `"x  ]"`.
        let input = "{\"a\":\"x, ]\"}";
        assert_eq!(strip_trailing_commas(input), input);
    }

    #[test]
    fn escaped_quote_does_not_end_string() {
        // The `\"` keeps us inside the string, so the comma is interior to it.
        let input = "{\"a\":\"\\\", ]\"}";
        assert_eq!(strip_trailing_commas(input), input);
    }

    #[test]
    fn double_trailing_comma_only_strips_one() {
        // Only a genuine single trailing comma is forgiven; `,,]` stays `,]`
        // (and the strict parser will still reject it). Documented boundary.
        assert_eq!(strip_trailing_commas("[1,2,,]"), "[1,2,]");
    }

    #[test]
    fn clean_input_is_borrowed_no_alloc() {
        assert!(matches!(
            strip_trailing_commas("{\"a\":1}"),
            Cow::Borrowed(_)
        ));
    }

    #[test]
    fn preserves_large_int64_verbatim() {
        // Pure text scrub — the big integer is copied byte-for-byte, never parsed.
        assert_eq!(
            strip_trailing_commas("{\"id\":12345678901234567890,}"),
            "{\"id\":12345678901234567890}"
        );
    }

    #[test]
    fn scrubbed_body_parses_with_strict_serde_json() {
        // Baseline: strict serde_json rejects the trailing comma (this is exactly
        // the `trailing comma at line N` error the user hit on Send).
        assert!(serde_json::from_str::<serde_json::Value>("{\"a\":1,}").is_err());

        // After the scrub the same strict parser accepts it.
        let cleaned = strip_trailing_commas("{\"a\":1,}");
        let v: serde_json::Value =
            serde_json::from_str(&cleaned).expect("scrubbed body must parse");
        assert_eq!(v["a"], serde_json::json!(1));
    }
}
