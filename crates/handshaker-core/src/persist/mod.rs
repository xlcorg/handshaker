//! Atomic JSON persistence primitive. No Tauri dependency — path-injected and
//! unit-testable on a `tempfile::TempDir`.
//!
//! Every persisted file is an [`Envelope<T>`] carrying a `schema_version`. Writes
//! go through `<path>.tmp` + fsync + rename so a crash mid-write never truncates
//! the live file (master spec §4 line 148; design §6).

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::error::CoreError;

/// Current on-disk schema version. Bump + add a migration when the shape changes.
pub const SCHEMA_VERSION: u32 = 1;

/// Versioned wrapper around any persisted payload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Envelope<T> {
    pub schema_version: u32,
    pub data: T,
}

impl<T> Envelope<T> {
    /// Wrap `data` with the current schema version.
    pub fn new(data: T) -> Self {
        Self { schema_version: SCHEMA_VERSION, data }
    }
}

/// `<path>` + ".tmp" (keeps the original extension, e.g. `a.json` → `a.json.tmp`).
fn tmp_path(path: &Path) -> PathBuf {
    let mut s = path.as_os_str().to_owned();
    s.push(".tmp");
    PathBuf::from(s)
}

/// Serialize `value` and atomically replace `path`. Creates parent dirs on demand.
/// On any failure the previous contents of `path` are left intact.
pub fn atomic_write_json<T: Serialize>(path: &Path, value: &Envelope<T>) -> Result<(), CoreError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| CoreError::Persistence(format!("create dir {}: {e}", parent.display())))?;
    }
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|e| CoreError::Persistence(format!("serialize {}: {e}", path.display())))?;
    let tmp = tmp_path(path);
    {
        let mut f = fs::File::create(&tmp)
            .map_err(|e| CoreError::Persistence(format!("create tmp {}: {e}", tmp.display())))?;
        f.write_all(&bytes)
            .map_err(|e| CoreError::Persistence(format!("write tmp {}: {e}", tmp.display())))?;
        f.sync_all()
            .map_err(|e| CoreError::Persistence(format!("fsync tmp {}: {e}", tmp.display())))?;
    }
    fs::rename(&tmp, path)
        .map_err(|e| CoreError::Persistence(format!("rename {} -> {}: {e}", tmp.display(), path.display())))?;
    Ok(())
}

/// Shared envelope-parsing + version gate.
fn parse_envelope<T: DeserializeOwned>(bytes: &[u8], path: &Path) -> Result<T, CoreError> {
    let env: Envelope<T> = serde_json::from_slice(bytes)
        .map_err(|e| CoreError::Persistence(format!("parse {}: {e}", path.display())))?;
    if env.schema_version > SCHEMA_VERSION {
        return Err(CoreError::Persistence(format!(
            "unsupported schema v{} in {} (this build supports up to v{})",
            env.schema_version, path.display(), SCHEMA_VERSION
        )));
    }
    Ok(env.data)
}

/// Read + parse a file that is expected to exist. Missing file → `Persistence` error.
pub fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T, CoreError> {
    let bytes = fs::read(path)
        .map_err(|e| CoreError::Persistence(format!("read {}: {e}", path.display())))?;
    parse_envelope(&bytes, path)
}

/// Read + parse a file; a missing file yields `T::default()` (empty store on cold boot).
pub fn read_json_or_default<T: DeserializeOwned + Default>(path: &Path) -> Result<T, CoreError> {
    match fs::read(path) {
        Ok(bytes) => parse_envelope(&bytes, path),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(e) => Err(CoreError::Persistence(format!("read {}: {e}", path.display()))),
    }
}

/// Move a corrupt file aside (to `<path>.corrupt`) so it stops bricking loads while staying
/// recoverable on disk. Best-effort: returns the new path on success, `None` if the rename
/// failed (the file is then left in place). Any stale `<path>.corrupt` is overwritten.
pub fn quarantine_corrupt(path: &Path) -> Option<PathBuf> {
    let mut q = path.as_os_str().to_owned();
    q.push(".corrupt");
    let q = PathBuf::from(q);
    let _ = fs::remove_file(&q);
    fs::rename(path, &q).ok().map(|()| q)
}

/// Like [`read_json_or_default`], but a *corrupt* (present-but-unparsable) file is quarantined
/// (moved to `<path>.corrupt`, its new path pushed onto `recovered`) and the default returned,
/// rather than erroring. A missing file still defaults silently; a non-`NotFound` IO error
/// still propagates. This is what keeps one bad file from bricking startup.
pub fn read_json_or_recover<T: DeserializeOwned + Default>(
    path: &Path,
    recovered: &mut Vec<PathBuf>,
) -> Result<T, CoreError> {
    match fs::read(path) {
        Ok(bytes) => match parse_envelope(&bytes, path) {
            Ok(value) => Ok(value),
            Err(_) => {
                if let Some(q) = quarantine_corrupt(path) {
                    recovered.push(q);
                }
                Ok(T::default())
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(e) => Err(CoreError::Persistence(format!("read {}: {e}", path.display()))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_then_read_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.json");
        atomic_write_json(&path, &Envelope::new(vec![1u32, 2, 3])).unwrap();
        let back: Vec<u32> = read_json_or_default(&path).unwrap();
        assert_eq!(back, vec![1, 2, 3]);
    }

    #[test]
    fn missing_file_returns_default() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nope.json");
        let back: Vec<u32> = read_json_or_default(&path).unwrap();
        assert!(back.is_empty());
    }

    #[test]
    fn recover_quarantines_corrupt_file_and_returns_default() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.json");
        std::fs::write(&path, b"{ not valid json").unwrap();
        let mut recovered = Vec::new();
        let back: Vec<u32> = read_json_or_recover(&path, &mut recovered).unwrap();
        assert!(back.is_empty(), "corrupt file should yield the default");
        assert!(!path.exists(), "corrupt file should be moved aside");
        assert_eq!(recovered.len(), 1, "the quarantined file should be recorded");
        assert!(recovered[0].exists(), "quarantine copy should exist on disk");
        assert!(recovered[0].to_string_lossy().ends_with(".corrupt"));
    }

    #[test]
    fn recover_passes_through_valid_and_missing_without_recording() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.json");
        let mut recovered = Vec::new();
        // missing → default, nothing recorded
        let back: Vec<u32> = read_json_or_recover(&path, &mut recovered).unwrap();
        assert!(back.is_empty());
        assert!(recovered.is_empty());
        // valid → parsed, nothing recorded
        atomic_write_json(&path, &Envelope::new(vec![1u32, 2, 3])).unwrap();
        let back: Vec<u32> = read_json_or_recover(&path, &mut recovered).unwrap();
        assert_eq!(back, vec![1, 2, 3]);
        assert!(recovered.is_empty());
    }

    #[test]
    fn nested_parent_dirs_are_created() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a").join("b").join("data.json");
        atomic_write_json(&path, &Envelope::new(7u32)).unwrap();
        let back: u32 = read_json(&path).unwrap();
        assert_eq!(back, 7);
    }

    #[test]
    fn interrupted_write_leaves_old_file_intact() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.json");
        atomic_write_json(&path, &Envelope::new(vec![1u32, 2, 3])).unwrap();

        // Block tmp creation by occupying its path with a directory, so the next
        // write fails BEFORE the rename step.
        let tmp = tmp_path(&path);
        std::fs::create_dir(&tmp).unwrap();

        let err = atomic_write_json(&path, &Envelope::new(vec![9u32])).unwrap_err();
        assert!(matches!(err, CoreError::Persistence(_)), "got {err:?}");

        // Original file is untouched.
        let back: Vec<u32> = read_json_or_default(&path).unwrap();
        assert_eq!(back, vec![1, 2, 3]);
    }

    #[test]
    fn unknown_future_schema_version_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.json");
        // Hand-write an envelope from the future.
        let raw = serde_json::to_vec(&Envelope { schema_version: SCHEMA_VERSION + 1, data: 0u32 }).unwrap();
        std::fs::write(&path, raw).unwrap();
        let err = read_json::<u32>(&path).unwrap_err();
        match err {
            CoreError::Persistence(m) => assert!(m.contains("unsupported schema"), "got {m}"),
            other => panic!("expected Persistence, got {other:?}"),
        }
    }
}
