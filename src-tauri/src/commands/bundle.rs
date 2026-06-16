//! Import/export bundle commands. Thin `#[tauri::command]` wrappers over
//! `impl AppState` methods (unit-testable without Tauri's `State<'_, T>`).
//! Import is a NON-DESTRUCTIVE merge: collections keyed by id, environments by
//! name — update on match, add otherwise, never delete.

use std::path::Path;

use handshaker_core::bundle::{self, Bundle};
use handshaker_core::error::CoreError;
use tauri::State;

use crate::ipc::bundle::{ImportResultIpc, ImportSummaryIpc};
use crate::ipc::collection::parse_collection_id;
use crate::ipc::error::IpcError;
use crate::state::AppState;

impl AppState {
    /// Gather collections (+ environments when `collection_id` is None) and write
    /// the bundle to `path`. `Some(id)` exports just that collection, no envs.
    pub fn bundle_export_impl(&self, path: String, collection_id: Option<String>) -> Result<(), CoreError> {
        let bundle = match collection_id {
            None => Bundle::new(self.collection_store.list(), self.env_store.list()),
            Some(id) => {
                let cid = parse_collection_id(&id)?;
                let c = self
                    .collection_store
                    .get(cid)
                    .ok_or_else(|| CoreError::InvalidTarget(format!("no collection {cid:?}")))?;
                Bundle::new(vec![c], vec![])
            }
        };
        bundle::write_bundle(Path::new(&path), &bundle)
    }
}

#[tauri::command]
#[specta::specta]
pub async fn bundle_export(
    state: State<'_, AppState>,
    path: String,
    collection_id: Option<String>,
) -> Result<(), IpcError> {
    state.bundle_export_impl(path, collection_id).map_err(IpcError::from)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use handshaker_core::bundle::read_bundle;
    use uuid::Uuid;

    use super::*;
    use crate::ipc::collection::CollectionIpc;
    use crate::ipc::collection::SavedAuthConfigIpc;

    fn empty_collection_ipc(id: u128, name: &str) -> CollectionIpc {
        CollectionIpc {
            id: Uuid::from_u128(id).to_string(),
            name: name.into(),
            items: vec![],
            variables: HashMap::new(),
            auth: SavedAuthConfigIpc::None,
            default_tls: false,
            skip_tls_verify: false,
            pinned: false,
            description: None,
            created_at: 0.0,
            expanded: false,
        }
    }

    #[test]
    fn export_all_writes_collections_and_envs() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("all.json");
        let state = AppState::default();
        state.collection_upsert_impl(empty_collection_ipc(1, "c1")).unwrap();
        state.collection_upsert_impl(empty_collection_ipc(2, "c2")).unwrap();
        state
            .env_upsert_impl(handshaker_core::env::Environment {
                name: "prod".into(),
                variables: HashMap::new(),
                color: None,
            })
            .unwrap();

        state.bundle_export_impl(path.to_string_lossy().into_owned(), None).unwrap();

        let bundle = read_bundle(&path).unwrap();
        assert_eq!(bundle.collections.len(), 2);
        assert_eq!(bundle.environments.len(), 1);
    }

    #[test]
    fn export_one_writes_single_collection_no_envs() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("one.json");
        let state = AppState::default();
        state.collection_upsert_impl(empty_collection_ipc(1, "c1")).unwrap();
        state.collection_upsert_impl(empty_collection_ipc(2, "c2")).unwrap();
        state
            .env_upsert_impl(handshaker_core::env::Environment {
                name: "prod".into(),
                variables: HashMap::new(),
                color: None,
            })
            .unwrap();

        let one = Uuid::from_u128(1).to_string();
        state.bundle_export_impl(path.to_string_lossy().into_owned(), Some(one)).unwrap();

        let bundle = read_bundle(&path).unwrap();
        assert_eq!(bundle.collections.len(), 1);
        assert_eq!(bundle.collections[0].name, "c1");
        assert!(bundle.environments.is_empty());
    }
}
