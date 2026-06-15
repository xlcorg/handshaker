//! Base64 decode IPC: inspect (view) + save (native Save-As). See
//! docs/superpowers/specs/2026-06-15-base64-value-decoder-design.md.

use handshaker_core::base64::{classify, decode_lenient, suggested_extension};

use crate::ipc::base64::Base64InspectIpc;

/// Testable core of `base64_inspect`. Err = input is not valid base64.
fn inspect_impl(input: &str) -> Result<Base64InspectIpc, String> {
    let bytes = decode_lenient(input)?;
    let size = bytes.len().min(u32::MAX as usize) as u32;
    Ok(Base64InspectIpc::from_classified(size, classify(&bytes)))
}

/// Decode a base64 string and report its kind/size/text (view-only).
#[tauri::command]
#[specta::specta]
pub async fn base64_inspect(input: String) -> Result<Base64InspectIpc, String> {
    inspect_impl(&input)
}

/// Decode a base64 string and write the bytes to a user-picked file.
/// Ok(Some(path)) = saved; Ok(None) = cancelled; Err = decode/write failure.
#[tauri::command]
#[specta::specta]
pub async fn base64_save(app: tauri::AppHandle, input: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let bytes = decode_lenient(&input)?;
    let ext = suggested_extension(&classify(&bytes));

    // Non-blocking save dialog from an async command: callback + oneshot.
    // (blocking_save_file must NOT run on the main thread.)
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_file_name(format!("decoded.{ext}"))
        .add_filter(ext.to_uppercase(), &[ext.as_str()])
        .save_file(move |path| {
            let _ = tx.send(path);
        });

    match rx.await.map_err(|e| e.to_string())? {
        Some(file_path) => {
            let path = file_path.into_path().map_err(|e| e.to_string())?;
            std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
            Ok(Some(path.to_string_lossy().into_owned()))
        }
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ipc::base64::Base64KindIpc;
    use base64::Engine as _;

    #[test]
    fn inspect_reports_json_kind_and_text() {
        let input = base64::engine::general_purpose::STANDARD.encode(br#"{"a":1}"#);
        let r = inspect_impl(&input).unwrap();
        assert!(matches!(r.kind, Base64KindIpc::Json));
        assert_eq!(r.text.as_deref(), Some(r#"{"a":1}"#));
        assert_eq!(r.size_bytes, 7);
    }

    #[test]
    fn inspect_errors_on_garbage() {
        assert!(inspect_impl("!!!").is_err());
    }
}
