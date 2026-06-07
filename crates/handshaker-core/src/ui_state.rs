//! Single-file UI-state store: `<dir>/ui-state.json`. Mirrors the persistence
//! shape of [`crate::collections::file_store::FileCollectionStore`] but holds a
//! single envelope payload (sort key + active request) rather than a per-id map.
//!
//! Like the other stores it is path-injected and unit-testable on a `TempDir`;
//! reads serve from an in-memory mirror updated only after a successful write
//! (clone-then-commit).

use std::path::{Path, PathBuf};
use std::sync::RwLock;

use serde::{Deserialize, Serialize};

use crate::persist::{atomic_write_json, read_json_or_default, Envelope};
use crate::CoreError;

/// Reference to the request currently open in the workflow editor.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActiveRequestRef {
    pub collection_id: String,
    pub item_id: String,
}

/// Persisted UI state. Every field is optional so an empty file (cold boot)
/// deserializes to `UiState::default()`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct UiState {
    #[serde(default)]
    pub sort_key: Option<String>,
    #[serde(default)]
    pub active_request: Option<ActiveRequestRef>,
}

/// Disk-backed store for [`UiState`], one `ui-state.json` per `dir`.
#[derive(Debug)]
pub struct FileUiStateStore {
    path: PathBuf,
    inner: RwLock<UiState>,
}

impl FileUiStateStore {
    /// Load `ui-state.json` from `dir` (empty default if the file is missing).
    pub fn load(dir: &Path) -> Result<Self, CoreError> {
        let path = dir.join("ui-state.json");
        let state: UiState = read_json_or_default(&path)?;
        Ok(Self { path, inner: RwLock::new(state) })
    }

    /// Snapshot the current state.
    pub fn get(&self) -> UiState {
        self.inner.read().expect("ui_state poisoned").clone()
    }

    /// Atomically persist `state`, then commit it to the in-memory mirror.
    pub fn set(&self, state: UiState) -> Result<(), CoreError> {
        let mut guard = self.inner.write().expect("ui_state poisoned");
        atomic_write_json(&self.path, &Envelope::new(state.clone()))?;
        *guard = state;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn round_trips_through_disk() {
        let dir = tempdir().unwrap();
        let store = FileUiStateStore::load(dir.path()).unwrap();
        assert_eq!(store.get(), UiState::default());
        store
            .set(UiState {
                sort_key: Some("recent".into()),
                active_request: Some(ActiveRequestRef {
                    collection_id: "c1".into(),
                    item_id: "r1".into(),
                }),
            })
            .unwrap();
        // reload from a fresh store → persisted
        let store2 = FileUiStateStore::load(dir.path()).unwrap();
        assert_eq!(store2.get().sort_key.as_deref(), Some("recent"));
        assert_eq!(store2.get().active_request.unwrap().item_id, "r1");
    }

    #[test]
    fn missing_file_loads_default() {
        let dir = tempdir().unwrap();
        let store = FileUiStateStore::load(dir.path()).unwrap();
        assert_eq!(store.get(), UiState::default());
    }
}
