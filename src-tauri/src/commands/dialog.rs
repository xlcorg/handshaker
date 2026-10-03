//! Generic native Save-As dialog helpers shared across commands.

use std::io::Write;
use std::path::PathBuf;

/// Why a [`save_via_dialog_with`] did not save: the picker itself failed (`Dialog` — the
/// dialog, its reply channel, the path conversion), the file could not be created /
/// flushed or the write task did not finish (`Io`), or the caller's `write` closure
/// failed (`Write`, its own error type).
#[derive(Debug)]
pub(crate) enum SaveError<E> {
    Dialog(String),
    Io(String),
    Write(E),
}

/// Open a native Save-As dialog and let `write` produce the file through a `Write` sink
/// over the chosen path — the sibling of [`save_bytes_via_dialog`] for content that is
/// streamed rather than held in one buffer (stream **Assemble**). `write` receives a
/// buffered `std::fs::File` on a blocking thread (see [`write_file`]); the sink is
/// flushed after it returns.
/// Ok(Some((path, T))) = saved; Ok(None) = cancelled; Err = dialog/io/write failure.
///
/// Async-command-safe: a non-blocking dialog (callback + oneshot) rather than
/// `blocking_save_file`, which must NOT run on the main thread.
///
/// No extension filter is set on purpose: the content is arbitrary, and on macOS
/// a filter LOCKS the extension (`NSSavePanel` greys out other types and
/// force-appends the filter's first extension). `default_name` carries the
/// suggested extension as a suggestion, not a cage.
pub(crate) async fn save_via_dialog_with<T, E>(
    app: &tauri::AppHandle,
    default_name: &str,
    write: impl FnOnce(&mut dyn Write) -> Result<T, E> + Send + 'static,
) -> Result<Option<(String, T)>, SaveError<E>>
where
    T: Send + 'static,
    E: Send + 'static,
{
    use tauri_plugin_dialog::DialogExt;

    let dialog = |e: &dyn std::fmt::Display| SaveError::Dialog(e.to_string());
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_file_name(default_name)
        .save_file(move |path| {
            let _ = tx.send(path);
        });

    match rx.await.map_err(|e| dialog(&e))? {
        Some(file_path) => {
            let path = file_path.into_path().map_err(|e| dialog(&e))?;
            write_file(path, write).await.map(Some)
        }
        None => Ok(None),
    }
}

/// Create `path` and run `write` over a buffered sink to it on a **blocking thread**
/// (`spawn_blocking`): a multi-GB assembly or a large JSON dump must never pin a tokio
/// worker and stall the other IPC / stream tasks. The sink is flushed after `write`
/// returns. Ok((path, T)) with the path as the string the frontend shows; a
/// create / flush failure or a write task that did not finish is `Io`, the closure's
/// own error `Write`.
pub(crate) async fn write_file<T, E>(
    path: PathBuf,
    write: impl FnOnce(&mut dyn Write) -> Result<T, E> + Send + 'static,
) -> Result<(String, T), SaveError<E>>
where
    T: Send + 'static,
    E: Send + 'static,
{
    tokio::task::spawn_blocking(move || {
        let io = |e: &dyn std::fmt::Display| SaveError::Io(e.to_string());
        let file = std::fs::File::create(&path).map_err(|e| io(&e))?;
        let mut sink = std::io::BufWriter::new(file);
        let value = write(&mut sink).map_err(SaveError::Write)?;
        sink.flush().map_err(|e| io(&e))?;
        Ok((path.to_string_lossy().into_owned(), value))
    })
    .await
    .unwrap_or_else(|e| Err(SaveError::Io(format!("write task: {e}"))))
}

/// Open a native Save-As dialog and write `bytes` to the chosen file (on a blocking
/// thread, like every write here). Ok(Some(path)) = saved; Ok(None) = cancelled;
/// Err = dialog/write failure.
pub(crate) async fn save_bytes_via_dialog(
    app: &tauri::AppHandle,
    default_name: &str,
    bytes: Vec<u8>,
) -> Result<Option<String>, String> {
    let saved = save_via_dialog_with(app, default_name, move |sink| {
        sink.write_all(&bytes).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| match e {
        SaveError::Dialog(m) | SaveError::Io(m) | SaveError::Write(m) => m,
    })?;
    Ok(saved.map(|(path, ())| path))
}

/// Filesystem-safe LOCAL timestamp `YYYY-MM-DDTHH-MM-SS` — the same shape the
/// frontend's `responseFileName` uses for unary saves, so stream exports sort alongside.
pub(crate) fn local_stamp() -> String {
    chrono::Local::now().format("%Y-%m-%dT%H-%M-%S").to_string()
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
    save_bytes_via_dialog(&app, &default_name, text.into_bytes()).await
}

#[cfg(test)]
mod tests {
    use super::{local_stamp, write_file, SaveError};

    #[test]
    fn local_stamp_is_filesystem_safe_and_sortable() {
        let s = local_stamp();
        // `2026-09-28T14-05-09`: digits and `-` / `T` only — no colons.
        assert_eq!(s.len(), 19, "{s}");
        assert!(s.chars().all(|c| c.is_ascii_digit() || c == '-' || c == 'T'), "{s}");
        assert_eq!(&s[10..11], "T");
    }

    #[tokio::test]
    async fn write_file_runs_the_closure_off_the_runtime_thread_and_flushes_the_sink() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("out.bin");
        let runtime_thread = std::thread::current().id();
        let (shown, wrote_on) = write_file(path.clone(), |sink| {
            sink.write_all(b"abc").unwrap();
            Ok::<_, String>(std::thread::current().id())
        })
        .await
        .expect("saved");
        assert_ne!(wrote_on, runtime_thread, "the write must run on a blocking thread, not the runtime worker");
        assert_eq!(shown, path.to_string_lossy());
        assert_eq!(std::fs::read(&path).unwrap(), b"abc", "flushed before returning");
    }

    #[tokio::test]
    async fn write_file_maps_a_closure_error_to_write_and_an_unwritable_path_to_io() {
        let dir = tempfile::tempdir().unwrap();
        match write_file(dir.path().join("x"), |_| Err::<(), String>("boom".into())).await {
            Err(SaveError::Write(m)) => assert_eq!(m, "boom"),
            other => panic!("expected Write, got {other:?}"),
        }
        match write_file(dir.path().join("missing-dir").join("x"), |_| Ok::<(), String>(())).await {
            Err(SaveError::Io(_)) => {}
            other => panic!("expected Io, got {other:?}"),
        }
    }
}
