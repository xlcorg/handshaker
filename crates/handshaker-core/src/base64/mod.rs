//! Lenient base64 decode + content classification for the response decoder.
//! Pure / OS-independent. See docs/superpowers/specs/2026-06-15-base64-value-decoder-design.md.

use base64::{
    alphabet,
    engine::{DecodePaddingMode, GeneralPurpose, GeneralPurposeConfig},
    Engine as _,
};

/// What the decoded bytes turned out to be.
#[derive(Debug, Clone, PartialEq)]
pub enum Classified {
    /// Valid UTF-8 that parses as JSON. Holds the raw decoded text (front pretty-prints).
    Json(String),
    /// Valid UTF-8, not JSON. Holds the raw decoded text.
    Text(String),
    /// Not UTF-8. Magic-byte type, if `infer` recognised it.
    Binary { mime: Option<String>, extension: Option<String> },
}

/// Strip surrounding whitespace, an optional `data:<mime>;base64,` prefix, and any
/// interior whitespace/newlines (some encoders wrap base64).
fn clean(input: &str) -> String {
    let trimmed = input.trim();
    let body = if trimmed.starts_with("data:") {
        match trimmed.find(";base64,") {
            Some(i) => &trimmed[i + ";base64,".len()..],
            None => trimmed,
        }
    } else {
        trimmed
    };
    body.chars().filter(|c| !c.is_whitespace()).collect()
}

/// Decode accepting BOTH alphabets (standard + URL-safe) and ANY padding —
/// protobuf JSON `bytes` are canonically standard-with-padding but decoders must
/// accept all four variants (ProtoJSON spec).
pub fn decode_lenient(input: &str) -> Result<Vec<u8>, String> {
    let cleaned = clean(input);
    if cleaned.is_empty() {
        return Err("Not valid base64".to_string());
    }
    // GeneralPurposeConfig is Copy, so one cfg feeds both engines.
    let cfg = GeneralPurposeConfig::new().with_decode_padding_mode(DecodePaddingMode::Indifferent);
    let std_engine = GeneralPurpose::new(&alphabet::STANDARD, cfg);
    if let Ok(bytes) = std_engine.decode(cleaned.as_bytes()) {
        return Ok(bytes);
    }
    let url_engine = GeneralPurpose::new(&alphabet::URL_SAFE, cfg);
    url_engine
        .decode(cleaned.as_bytes())
        .map_err(|_| "Not valid base64".to_string())
}

/// Classify decoded bytes: JSON > text > binary (magic bytes).
pub fn classify(bytes: &[u8]) -> Classified {
    match std::str::from_utf8(bytes) {
        Ok(s) => {
            if !s.trim().is_empty() && serde_json::from_str::<serde_json::Value>(s).is_ok() {
                Classified::Json(s.to_string())
            } else {
                Classified::Text(s.to_string())
            }
        }
        Err(_) => match infer::get(bytes) {
            Some(t) => Classified::Binary {
                mime: Some(t.mime_type().to_string()),
                extension: Some(t.extension().to_string()),
            },
            None => Classified::Binary { mime: None, extension: None },
        },
    }
}

/// Suggested file extension for a Save-As of this content.
pub fn suggested_extension(c: &Classified) -> String {
    match c {
        Classified::Json(_) => "json".into(),
        Classified::Text(_) => "txt".into(),
        Classified::Binary { extension: Some(e), .. } => e.clone(),
        Classified::Binary { extension: None, .. } => "bin".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
    use base64::Engine as _;

    #[test]
    fn decodes_standard_with_padding() {
        assert_eq!(decode_lenient(&STANDARD.encode(b"hello")).unwrap(), b"hello");
    }

    #[test]
    fn decodes_url_safe_without_padding() {
        let raw = vec![0xfbu8, 0xff, 0xbf];
        let url = URL_SAFE_NO_PAD.encode(&raw); // contains '-' and '_'
        assert_eq!(decode_lenient(&url).unwrap(), raw);
    }

    #[test]
    fn strips_data_uri_prefix_and_interior_whitespace() {
        let json = STANDARD.encode(br#"{"a":1}"#);
        assert_eq!(decode_lenient(&format!("data:application/json;base64,{json}")).unwrap(), br#"{"a":1}"#);
        let wrapped = format!("{}\n {}", &json[..4], &json[4..]);
        assert_eq!(decode_lenient(&wrapped).unwrap(), br#"{"a":1}"#);
    }

    #[test]
    fn rejects_garbage() {
        assert!(decode_lenient("not base64!!!").is_err());
        assert!(decode_lenient("   ").is_err());
    }

    #[test]
    fn classifies_json_text_and_binary() {
        assert_eq!(classify(br#"{"a":1}"#), Classified::Json(r#"{"a":1}"#.to_string()));
        assert_eq!(classify(b"hello world"), Classified::Text("hello world".to_string()));
        let png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
        assert_eq!(
            classify(&png),
            Classified::Binary { mime: Some("image/png".into()), extension: Some("png".into()) }
        );
        let unknown = [0x00u8, 0x01, 0x02, 0xff, 0xfe];
        assert_eq!(classify(&unknown), Classified::Binary { mime: None, extension: None });
    }

    #[test]
    fn suggested_extension_per_kind() {
        assert_eq!(suggested_extension(&Classified::Json("{}".into())), "json");
        assert_eq!(suggested_extension(&Classified::Text("x".into())), "txt");
        assert_eq!(suggested_extension(&Classified::Binary { mime: Some("image/png".into()), extension: Some("png".into()) }), "png");
        assert_eq!(suggested_extension(&Classified::Binary { mime: None, extension: None }), "bin");
    }
}
