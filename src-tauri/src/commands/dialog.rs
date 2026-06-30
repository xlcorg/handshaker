//! Generic native Save-As dialog helpers shared across commands.

/// Open a native Save-As dialog and write `bytes` to the chosen file.
/// Ok(Some(path)) = saved; Ok(None) = cancelled; Err = dialog/write failure.
///
/// Async-command-safe: a non-blocking dialog (callback + oneshot) rather than
/// `blocking_save_file`, which must NOT run on the main thread.
///
/// No extension filter is set on purpose: the content is arbitrary, and on macOS
/// a filter LOCKS the extension (`NSSavePanel` greys out other types and
/// force-appends the filter's first extension). `default_name` carries the
/// suggested extension as a suggestion, not a cage.
pub(crate) async fn save_bytes_via_dialog(
    app: &tauri::AppHandle,
    default_name: &str,
    bytes: &[u8],
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_file_name(default_name)
        .save_file(move |path| {
            let _ = tx.send(path);
        });

    match rx.await.map_err(|e| e.to_string())? {
        Some(file_path) => {
            let path = file_path.into_path().map_err(|e| e.to_string())?;
            std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
            Ok(Some(path.to_string_lossy().into_owned()))
        }
        None => Ok(None),
    }
}

/// Write arbitrary UTF-8 `text` (verbatim — no newline transformation) to a
/// user-picked file via the native Save-As dialog. Ok(Some(path)) = saved;
/// Ok(None) = cancelled; Err = dialog/write failure.
#[tauri::command]
#[specta::specta]
pub async fn file_save_text(
    app: tauri::AppHandle,
    text: String,
    default_name: String,
) -> Result<Option<String>, String> {
    save_bytes_via_dialog(&app, &default_name, text.as_bytes()).await
}
