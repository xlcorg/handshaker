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
    /// Read + validate an export file and count how many of its collections /
    /// environments already exist locally. Does NOT mutate anything.
    pub fn bundle_import_inspect_impl(&self, path: String) -> Result<ImportSummaryIpc, CoreError> {
        let bundle = bundle::read_bundle(Path::new(&path))?;
        let collections_existing = bundle
            .collections
            .iter()
            .filter(|c| self.collection_store.get(c.id).is_some())
            .count() as u32;
        let environments_existing = bundle
            .environments
            .iter()
            .filter(|e| self.env_store.get(&e.name).is_some())
            .count() as u32;
        Ok(ImportSummaryIpc {
            collections_total: bundle.collections.len() as u32,
            collections_existing,
            environments_total: bundle.environments.len() as u32,
            environments_existing,
        })
    }

    /// Apply an export file as a NON-DESTRUCTIVE merge. Collections keyed by id,
    /// environments by name. On match → update (env variables merged, imported
    /// wins on shared keys); otherwise → add. Nothing is ever deleted; the active
    /// environment is untouched. Validation happens up front, so a foreign/corrupt
    /// file changes nothing.
    pub fn bundle_import_apply_impl(&self, path: String) -> Result<ImportResultIpc, CoreError> {
        let bundle = bundle::read_bundle(Path::new(&path))?;

        let mut collections_added = 0u32;
        let mut collections_updated = 0u32;
        for c in bundle.collections {
            if self.collection_store.get(c.id).is_some() {
                collections_updated += 1;
            } else {
                collections_added += 1;
            }
            self.collection_store.upsert(c)?;
        }

        let mut environments_added = 0u32;
        let mut environments_updated = 0u32;
        for imported in bundle.environments {
            match self.env_store.get(&imported.name) {
                Some(mut existing) => {
                    for (k, v) in imported.variables {
                        existing.variables.insert(k, v);
                    }
                    if imported.color.is_some() {
                        existing.color = imported.color;
                    }
                    self.env_store.upsert(existing)?;
                    environments_updated += 1;
                }
                None => {
                    self.env_store.upsert(imported)?;
                    environments_added += 1;
                }
            }
        }

        Ok(ImportResultIpc {
            collections_added,
            collections_updated,
            environments_added,
            environments_updated,
        })
    }

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

#[tauri::command]
#[specta::specta]
pub async fn bundle_import_inspect(
    state: State<'_, AppState>,
    path: String,
) -> Result<ImportSummaryIpc, IpcError> {
    state.bundle_import_inspect_impl(path).map_err(IpcError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn bundle_import_apply(
    state: State<'_, AppState>,
    path: String,
) -> Result<ImportResultIpc, IpcError> {
    state.bundle_import_apply_impl(path).map_err(IpcError::from)
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
    fn inspect_counts_existing_vs_new_without_mutating() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("src.json");

        // Source state → export file with c1, c2 + env prod, staging.
        let source = AppState::default();
        source.collection_upsert_impl(empty_collection_ipc(1, "c1")).unwrap();
        source.collection_upsert_impl(empty_collection_ipc(2, "c2")).unwrap();
        source.env_upsert_impl(handshaker_core::env::Environment { name: "prod".into(), variables: HashMap::new(), color: None }).unwrap();
        source.env_upsert_impl(handshaker_core::env::Environment { name: "staging".into(), variables: HashMap::new(), color: None }).unwrap();
        source.bundle_export_impl(src.to_string_lossy().into_owned(), None).unwrap();

        // Target already has c1 (id collision) + env prod (name collision).
        let target = AppState::default();
        target.collection_upsert_impl(empty_collection_ipc(1, "c1-local")).unwrap();
        target.env_upsert_impl(handshaker_core::env::Environment { name: "prod".into(), variables: HashMap::new(), color: None }).unwrap();

        let summary = target.bundle_import_inspect_impl(src.to_string_lossy().into_owned()).unwrap();
        assert_eq!(summary.collections_total, 2);
        assert_eq!(summary.collections_existing, 1); // c1
        assert_eq!(summary.environments_total, 2);
        assert_eq!(summary.environments_existing, 1); // prod

        // Inspect must NOT mutate.
        assert_eq!(target.collection_list_impl().len(), 1);
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

    fn env(name: &str, kv: &[(&str, &str)]) -> handshaker_core::env::Environment {
        handshaker_core::env::Environment {
            name: name.into(),
            variables: kv.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
            color: None,
        }
    }

    #[test]
    fn apply_merges_updates_adds_and_never_deletes() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("src.json");

        // Source export: c1 (renamed), c2 (new) + env prod {b:2}, staging.
        let source = AppState::default();
        source.collection_upsert_impl(empty_collection_ipc(1, "c1-from-file")).unwrap();
        source.collection_upsert_impl(empty_collection_ipc(2, "c2")).unwrap();
        source.env_upsert_impl(env("prod", &[("b", "2")])).unwrap();
        source.env_upsert_impl(env("staging", &[])).unwrap();
        source.bundle_export_impl(src.to_string_lossy().into_owned(), None).unwrap();

        // Target: c1 (local name), c9 (NOT in file), env prod {a:1}, keep {x:1}.
        let target = AppState::default();
        target.collection_upsert_impl(empty_collection_ipc(1, "c1-local")).unwrap();
        target.collection_upsert_impl(empty_collection_ipc(9, "c9-local")).unwrap();
        target.env_upsert_impl(env("prod", &[("a", "1")])).unwrap();
        target.env_upsert_impl(env("keep", &[("x", "1")])).unwrap();

        let result = target.bundle_import_apply_impl(src.to_string_lossy().into_owned()).unwrap();
        assert_eq!(result.collections_added, 1); // c2
        assert_eq!(result.collections_updated, 1); // c1
        assert_eq!(result.environments_added, 1); // staging
        assert_eq!(result.environments_updated, 1); // prod

        // c1 updated to the file's name; c9 untouched; c2 added.
        let one = Uuid::from_u128(1).to_string();
        assert_eq!(target.collection_get_impl(&one).unwrap().name, "c1-from-file");
        assert!(target.collection_get_impl(&Uuid::from_u128(9).to_string()).is_ok());
        assert_eq!(target.collection_list_impl().len(), 3);

        // prod merged: a kept, b added. keep untouched. staging added.
        let prod = target.env_store.get("prod").unwrap();
        assert_eq!(prod.variables.get("a").map(String::as_str), Some("1"));
        assert_eq!(prod.variables.get("b").map(String::as_str), Some("2"));
        assert!(target.env_store.get("keep").is_some());
        assert!(target.env_store.get("staging").is_some());
    }

    #[test]
    fn apply_rejects_foreign_file_and_leaves_data_intact() {
        let dir = tempfile::tempdir().unwrap();
        let bad = dir.path().join("bad.json");
        std::fs::write(&bad, b"{ not a bundle").unwrap();
        let target = AppState::default();
        target.collection_upsert_impl(empty_collection_ipc(1, "keep")).unwrap();

        assert!(target.bundle_import_apply_impl(bad.to_string_lossy().into_owned()).is_err());
        assert_eq!(target.collection_list_impl().len(), 1); // untouched
    }

    #[test]
    fn apply_updates_env_color_only_when_imported_sets_one() {
        use handshaker_core::env::Environment;
        let dir = tempfile::tempdir().unwrap();

        // Imported color Some(..) overwrites the existing color.
        let a = dir.path().join("a.json");
        let src_a = AppState::default();
        src_a.env_upsert_impl(Environment { name: "e".into(), variables: HashMap::new(), color: Some("blue".into()) }).unwrap();
        src_a.bundle_export_impl(a.to_string_lossy().into_owned(), None).unwrap();
        let tgt_a = AppState::default();
        tgt_a.env_upsert_impl(Environment { name: "e".into(), variables: HashMap::new(), color: Some("red".into()) }).unwrap();
        tgt_a.bundle_import_apply_impl(a.to_string_lossy().into_owned()).unwrap();
        assert_eq!(tgt_a.env_store.get("e").unwrap().color.as_deref(), Some("blue"));

        // Imported color None preserves the existing color.
        let b = dir.path().join("b.json");
        let src_b = AppState::default();
        src_b.env_upsert_impl(Environment { name: "e".into(), variables: HashMap::new(), color: None }).unwrap();
        src_b.bundle_export_impl(b.to_string_lossy().into_owned(), None).unwrap();
        let tgt_b = AppState::default();
        tgt_b.env_upsert_impl(Environment { name: "e".into(), variables: HashMap::new(), color: Some("red".into()) }).unwrap();
        tgt_b.bundle_import_apply_impl(b.to_string_lossy().into_owned()).unwrap();
        assert_eq!(tgt_b.env_store.get("e").unwrap().color.as_deref(), Some("red"));
    }
}
