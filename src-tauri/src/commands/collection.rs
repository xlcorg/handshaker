//! Collection IPC commands (master spec §6.2). Each `#[tauri::command]` is a thin
//! wrapper over an `impl AppState` method (Plan #4b convention) so the logic is
//! unit-testable without Tauri's `State<'_, T>` plumbing — see the `#[cfg(test)]`
//! block at the bottom.

use std::collections::HashMap;

use handshaker_core::collections::ids::{CollectionId, ItemId};
use handshaker_core::collections::{tree, Item};
use handshaker_core::error::CoreError;
use tauri::State;

use crate::ipc::collection::{
    parse_collection_id, parse_item_id, CollectionIpc, CollectionMetaIpc, ItemIpc, ItemSnapshotIpc,
    SavedAuthConfigIpc,
};
use crate::ipc::error::IpcError;
use crate::state::AppState;

fn parse_opt_item_id(s: Option<String>) -> Result<Option<ItemId>, CoreError> {
    s.map(|v| parse_item_id(&v)).transpose()
}

impl AppState {
    fn require_collection(&self, id: CollectionId) -> Result<handshaker_core::collections::Collection, CoreError> {
        self.collection_store
            .get(id)
            .ok_or_else(|| CoreError::InvalidTarget(format!("no collection {id:?}")))
    }

    pub fn collection_list_impl(&self) -> Vec<CollectionMetaIpc> {
        self.collection_store
            .list()
            .into_iter()
            .map(|c| CollectionMetaIpc { id: c.id.0.to_string(), name: c.name })
            .collect()
    }

    pub fn collection_get_impl(&self, id: &str) -> Result<CollectionIpc, CoreError> {
        let cid = parse_collection_id(id)?;
        Ok(CollectionIpc::from_core(self.require_collection(cid)?))
    }

    pub fn collection_upsert_impl(&self, collection: CollectionIpc) -> Result<(), CoreError> {
        let core = collection.into_core()?;
        self.collection_store.upsert(core)
    }

    pub fn collection_delete_impl(&self, id: &str) -> Result<(), CoreError> {
        let cid = parse_collection_id(id)?;
        self.collection_store.delete(cid)
    }

    pub fn collection_set_variables_impl(&self, id: &str, vars: HashMap<String, String>) -> Result<(), CoreError> {
        let cid = parse_collection_id(id)?;
        let mut c = self.require_collection(cid)?;
        c.variables = vars;
        self.collection_store.upsert(c)
    }

    pub fn collection_add_item_impl(&self, collection_id: &str, parent_id: Option<String>, item: ItemIpc) -> Result<(), CoreError> {
        let cid = parse_collection_id(collection_id)?;
        let parent = parse_opt_item_id(parent_id)?;
        let core_item = item.into_core()?;
        let mut c = self.require_collection(cid)?;
        tree::add_item(&mut c.items, parent, core_item)?;
        self.collection_store.upsert(c)
    }

    pub fn collection_rename_item_impl(&self, collection_id: &str, item_id: &str, name: String) -> Result<(), CoreError> {
        let cid = parse_collection_id(collection_id)?;
        let iid = parse_item_id(item_id)?;
        let mut c = self.require_collection(cid)?;
        tree::rename_item(&mut c.items, iid, name)?;
        self.collection_store.upsert(c)
    }

    pub fn collection_move_item_impl(&self, collection_id: &str, item_id: &str, new_parent_id: Option<String>, position: u32) -> Result<(), CoreError> {
        let cid = parse_collection_id(collection_id)?;
        let iid = parse_item_id(item_id)?;
        let new_parent = parse_opt_item_id(new_parent_id)?;
        let mut c = self.require_collection(cid)?;
        tree::move_item(&mut c.items, iid, new_parent, position as usize)?;
        self.collection_store.upsert(c)
    }

    /// Move an item subtree from one collection into another. When source == target this is an
    /// ordinary intra-tree move (which also rejects folder-into-own-descendant cycles).
    pub fn collection_move_item_across_impl(
        &self,
        source_collection_id: &str,
        item_id: &str,
        target_collection_id: &str,
        new_parent_id: Option<String>,
        position: u32,
    ) -> Result<(), CoreError> {
        let scid = parse_collection_id(source_collection_id)?;
        let tcid = parse_collection_id(target_collection_id)?;
        let iid = parse_item_id(item_id)?;
        let new_parent = parse_opt_item_id(new_parent_id)?;

        if scid == tcid {
            let mut c = self.require_collection(scid)?;
            tree::move_item(&mut c.items, iid, new_parent, position as usize)?;
            return self.collection_store.upsert(c);
        }

        let mut src = self.require_collection(scid)?;
        let mut tgt = self.require_collection(tcid)?;

        // Detach from source (operates on loaded copies; nothing is persisted yet).
        let snap = tree::delete_item(&mut src.items, iid)
            .ok_or_else(|| CoreError::InvalidTarget(format!("item {iid:?} not found in source")))?;
        // Insert into target; `restore_item` validates the new parent is a folder and clamps the
        // position. On error we return before either upsert, so stored state is untouched.
        tree::restore_item(&mut tgt.items, snap.item, new_parent, position as usize)?;

        // No cross-store transaction primitive exists (the store is per-collection atomic only).
        // We persist source-removal then target-insert: if the second upsert failed, the item
        // would be lost rather than duplicated. Loss is the accepted tradeoff here because both
        // upserts target an in-memory store backed by a single data dir and effectively cannot
        // fail independently in practice; should that change, prefer target-first (duplicate over
        // loss).
        self.collection_store.upsert(src)?;
        self.collection_store.upsert(tgt)
    }

    pub fn collection_duplicate_item_impl(&self, collection_id: &str, item_id: &str) -> Result<String, CoreError> {
        let cid = parse_collection_id(collection_id)?;
        let iid = parse_item_id(item_id)?;
        let mut c = self.require_collection(cid)?;
        let new_id = tree::duplicate_item(&mut c.items, iid)?;
        self.collection_store.upsert(c)?;
        Ok(new_id.0.to_string())
    }

    pub fn collection_delete_item_impl(&self, collection_id: &str, item_id: &str) -> Result<Option<ItemSnapshotIpc>, CoreError> {
        let cid = parse_collection_id(collection_id)?;
        let iid = parse_item_id(item_id)?;
        let mut c = self.require_collection(cid)?;
        match tree::delete_item(&mut c.items, iid) {
            Some(snap) => {
                self.collection_store.upsert(c)?;
                Ok(Some(ItemSnapshotIpc::from_core(snap)))
            }
            None => Ok(None), // idempotent: nothing to delete
        }
    }

    pub fn collection_restore_item_impl(&self, collection_id: &str, snapshot: ItemSnapshotIpc, parent_id: Option<String>, position: u32) -> Result<(), CoreError> {
        let cid = parse_collection_id(collection_id)?;
        let parent = parse_opt_item_id(parent_id)?;
        let item = snapshot.item.into_core()?;
        let mut c = self.require_collection(cid)?;
        tree::restore_item(&mut c.items, item, parent, position as usize)?;
        self.collection_store.upsert(c)
    }

    pub fn collection_set_node_auth_impl(
        &self,
        collection_id: &str,
        item_id: Option<String>,
        config: SavedAuthConfigIpc,
    ) -> Result<(), CoreError> {
        let cid = parse_collection_id(collection_id)?;
        let mut c = self.require_collection(cid)?;
        let core = config.into_core();
        match item_id {
            None => c.auth = core,
            Some(s) => {
                let iid = parse_item_id(&s)?;
                match tree::find_item_mut(&mut c.items, iid) {
                    Some(Item::Request(r)) => r.auth = core,
                    Some(Item::Folder(_)) => {
                        return Err(CoreError::InvalidTarget("folders carry no auth".into()))
                    }
                    None => return Err(CoreError::InvalidTarget(format!("item {iid:?} not found"))),
                }
            }
        }
        self.collection_store.upsert(c)
    }

    pub fn collection_bump_usage_impl(
        &self,
        collection_id: &str,
        item_id: &str,
        used_at: f64,
    ) -> Result<(), CoreError> {
        let cid = parse_collection_id(collection_id)?;
        let iid = parse_item_id(item_id)?;
        let mut c = self.require_collection(cid)?;
        match tree::find_item_mut(&mut c.items, iid) {
            Some(Item::Request(r)) => {
                r.last_used_at = Some(used_at);
                r.use_count = r.use_count.saturating_add(1);
            }
            Some(Item::Folder(_)) => {
                return Err(CoreError::InvalidTarget("usage applies to requests, not folders".into()))
            }
            None => return Err(CoreError::InvalidTarget(format!("request {iid:?} not found"))),
        }
        self.collection_store.upsert(c)
    }

    /// Persist the `expanded` flag for a tree node. `item_id == None` targets the
    /// collection root; `Some(id)` targets a folder within the tree.
    pub fn collection_set_expanded_impl(
        &self,
        collection_id: &str,
        item_id: Option<String>,
        expanded: bool,
    ) -> Result<(), CoreError> {
        let cid = parse_collection_id(collection_id)?;
        let mut c = self.require_collection(cid)?;
        match item_id {
            None => c.expanded = expanded,
            Some(iid) => {
                let iid = parse_item_id(&iid)?;
                if !tree::set_expanded(&mut c.items, iid, expanded) {
                    return Err(CoreError::InvalidTarget(format!("folder {iid:?} not found")));
                }
            }
        }
        self.collection_store.upsert(c)
    }
}

// --- command wrappers -------------------------------------------------------

#[tauri::command]
#[specta::specta]
pub async fn collection_list(state: State<'_, AppState>) -> Result<Vec<CollectionMetaIpc>, IpcError> {
    Ok(state.collection_list_impl())
}

#[tauri::command]
#[specta::specta]
pub async fn collection_get(state: State<'_, AppState>, id: String) -> Result<CollectionIpc, IpcError> {
    state.collection_get_impl(&id).map_err(IpcError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn collection_upsert(state: State<'_, AppState>, collection: CollectionIpc) -> Result<(), IpcError> {
    state.collection_upsert_impl(collection).map_err(IpcError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn collection_delete(state: State<'_, AppState>, id: String) -> Result<(), IpcError> {
    state.collection_delete_impl(&id).map_err(IpcError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn collection_set_variables(state: State<'_, AppState>, id: String, vars: HashMap<String, String>) -> Result<(), IpcError> {
    state.collection_set_variables_impl(&id, vars).map_err(IpcError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn collection_add_item(state: State<'_, AppState>, collection_id: String, parent_id: Option<String>, item: ItemIpc) -> Result<(), IpcError> {
    state.collection_add_item_impl(&collection_id, parent_id, item).map_err(IpcError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn collection_rename_item(state: State<'_, AppState>, collection_id: String, item_id: String, name: String) -> Result<(), IpcError> {
    state.collection_rename_item_impl(&collection_id, &item_id, name).map_err(IpcError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn collection_move_item(state: State<'_, AppState>, collection_id: String, item_id: String, new_parent_id: Option<String>, position: u32) -> Result<(), IpcError> {
    state.collection_move_item_impl(&collection_id, &item_id, new_parent_id, position).map_err(IpcError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn collection_move_item_across(
    state: State<'_, AppState>,
    source_collection_id: String,
    item_id: String,
    target_collection_id: String,
    new_parent_id: Option<String>,
    position: u32,
) -> Result<(), IpcError> {
    state
        .collection_move_item_across_impl(&source_collection_id, &item_id, &target_collection_id, new_parent_id, position)
        .map_err(IpcError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn collection_duplicate_item(state: State<'_, AppState>, collection_id: String, item_id: String) -> Result<String, IpcError> {
    state.collection_duplicate_item_impl(&collection_id, &item_id).map_err(IpcError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn collection_delete_item(state: State<'_, AppState>, collection_id: String, item_id: String) -> Result<Option<ItemSnapshotIpc>, IpcError> {
    state.collection_delete_item_impl(&collection_id, &item_id).map_err(IpcError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn collection_restore_item(state: State<'_, AppState>, collection_id: String, snapshot: ItemSnapshotIpc, parent_id: Option<String>, position: u32) -> Result<(), IpcError> {
    state.collection_restore_item_impl(&collection_id, snapshot, parent_id, position).map_err(IpcError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn collection_set_node_auth(state: State<'_, AppState>, collection_id: String, item_id: Option<String>, config: SavedAuthConfigIpc) -> Result<(), IpcError> {
    state.collection_set_node_auth_impl(&collection_id, item_id, config).map_err(IpcError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn collection_bump_usage(state: State<'_, AppState>, collection_id: String, item_id: String, used_at: f64) -> Result<(), IpcError> {
    state.collection_bump_usage_impl(&collection_id, &item_id, used_at).map_err(IpcError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn collection_set_expanded(
    state: State<'_, AppState>,
    collection_id: String,
    item_id: Option<String>,
    expanded: bool,
) -> Result<(), IpcError> {
    state.collection_set_expanded_impl(&collection_id, item_id, expanded).map_err(IpcError::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ipc::collection::{FolderIpc, SavedRequestIpc};
    use uuid::Uuid;

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

    fn request_ipc(id: u128, name: &str) -> ItemIpc {
        ItemIpc::Request(SavedRequestIpc {
            id: Uuid::from_u128(id).to_string(),
            name: name.into(),
            address_template: "{{host}}".into(),
            service: "svc".into(),
            method: "M".into(),
            body_template: "{}".into(),
            metadata: vec![],
            auth: SavedAuthConfigIpc::None,
            tls_override: None,
            last_used_at: None,
            use_count: 0,
        })
    }

    fn folder_ipc(id: u128, name: &str) -> ItemIpc {
        ItemIpc::Folder(FolderIpc {
            id: Uuid::from_u128(id).to_string(),
            name: name.into(),
            items: vec![],
            expanded: false,
        })
    }

    fn cid(id: u128) -> String {
        Uuid::from_u128(id).to_string()
    }

    #[test]
    fn upsert_then_get_round_trips_tree() {
        let state = AppState::default();
        state.collection_upsert_impl(empty_collection_ipc(1, "c")).unwrap();
        state.collection_add_item_impl(&cid(1), None, folder_ipc(10, "f")).unwrap();
        state.collection_add_item_impl(&cid(1), Some(cid(10)), request_ipc(20, "r")).unwrap();
        let got = state.collection_get_impl(&cid(1)).unwrap();
        assert_eq!(got.items.len(), 1); // the folder
    }

    #[test]
    fn add_item_idempotent_on_dup_id_and_bad_parent_errors() {
        let state = AppState::default();
        state.collection_upsert_impl(empty_collection_ipc(1, "c")).unwrap();
        state.collection_add_item_impl(&cid(1), None, request_ipc(20, "r")).unwrap();
        // dup id → Ok, no growth
        state.collection_add_item_impl(&cid(1), None, request_ipc(20, "r2")).unwrap();
        assert_eq!(state.collection_get_impl(&cid(1)).unwrap().items.len(), 1);
        // bad parent → InvalidTarget
        let err = state.collection_add_item_impl(&cid(1), Some(cid(999)), request_ipc(21, "x")).unwrap_err();
        assert!(matches!(err, CoreError::InvalidTarget(_)));
    }

    #[test]
    fn delete_collection_is_idempotent() {
        let state = AppState::default();
        state.collection_delete_impl(&cid(404)).unwrap(); // missing → Ok
    }

    #[test]
    fn move_item_rejects_cyclic_move() {
        let state = AppState::default();
        state.collection_upsert_impl(empty_collection_ipc(1, "c")).unwrap();
        state.collection_add_item_impl(&cid(1), None, folder_ipc(10, "outer")).unwrap();
        state.collection_add_item_impl(&cid(1), Some(cid(10)), folder_ipc(11, "inner")).unwrap();
        let err = state.collection_move_item_impl(&cid(1), &cid(10), Some(cid(11)), 0).unwrap_err();
        assert!(matches!(err, CoreError::InvalidTarget(_)));
    }

    #[test]
    fn move_across_collections_relocates_item() {
        let state = AppState::default();
        state.collection_upsert_impl(empty_collection_ipc(1, "src")).unwrap();
        state.collection_upsert_impl(empty_collection_ipc(2, "dst")).unwrap();
        state.collection_add_item_impl(&cid(1), None, request_ipc(20, "r")).unwrap();
        state
            .collection_move_item_across_impl(&cid(1), &cid(20), &cid(2), None, 0)
            .unwrap();
        assert_eq!(state.collection_get_impl(&cid(1)).unwrap().items.len(), 0);
        let dst = state.collection_get_impl(&cid(2)).unwrap();
        assert_eq!(dst.items.len(), 1);
        assert!(matches!(&dst.items[0], ItemIpc::Request(r) if r.id == cid(20)));
    }

    #[test]
    fn move_across_into_target_folder() {
        let state = AppState::default();
        state.collection_upsert_impl(empty_collection_ipc(1, "src")).unwrap();
        state.collection_upsert_impl(empty_collection_ipc(2, "dst")).unwrap();
        state.collection_add_item_impl(&cid(1), None, request_ipc(20, "r")).unwrap();
        state.collection_add_item_impl(&cid(2), None, folder_ipc(30, "f")).unwrap();
        state
            .collection_move_item_across_impl(&cid(1), &cid(20), &cid(2), Some(cid(30)), 0)
            .unwrap();
        let dst = state.collection_get_impl(&cid(2)).unwrap();
        let folder = match &dst.items[0] {
            ItemIpc::Folder(f) => f,
            _ => panic!("expected folder"),
        };
        assert_eq!(folder.items.len(), 1);
        assert_eq!(state.collection_get_impl(&cid(1)).unwrap().items.len(), 0); // removed from source
    }

    #[test]
    fn move_across_same_collection_delegates_to_move() {
        // source == target → behaves like an intra-tree move (and rejects cycles).
        let state = AppState::default();
        state.collection_upsert_impl(empty_collection_ipc(1, "c")).unwrap();
        state.collection_add_item_impl(&cid(1), None, folder_ipc(10, "outer")).unwrap();
        state.collection_add_item_impl(&cid(1), Some(cid(10)), folder_ipc(11, "inner")).unwrap();
        let err = state
            .collection_move_item_across_impl(&cid(1), &cid(10), &cid(1), Some(cid(11)), 0)
            .unwrap_err();
        assert!(matches!(err, CoreError::InvalidTarget(_)));
    }

    #[test]
    fn move_across_missing_item_errors_and_persists_nothing() {
        let state = AppState::default();
        state.collection_upsert_impl(empty_collection_ipc(1, "src")).unwrap();
        state.collection_upsert_impl(empty_collection_ipc(2, "dst")).unwrap();
        let err = state
            .collection_move_item_across_impl(&cid(1), &cid(999), &cid(2), None, 0)
            .unwrap_err();
        assert!(matches!(err, CoreError::InvalidTarget(_)));
        assert_eq!(state.collection_get_impl(&cid(2)).unwrap().items.len(), 0);
    }

    #[test]
    fn duplicate_grows_tree_and_returns_new_id() {
        let state = AppState::default();
        state.collection_upsert_impl(empty_collection_ipc(1, "c")).unwrap();
        state.collection_add_item_impl(&cid(1), None, request_ipc(20, "r")).unwrap();
        let new_id = state.collection_duplicate_item_impl(&cid(1), &cid(20)).unwrap();
        assert_ne!(new_id, cid(20));
        assert_eq!(state.collection_get_impl(&cid(1)).unwrap().items.len(), 2);
    }

    #[test]
    fn delete_item_returns_snapshot_then_restore() {
        let state = AppState::default();
        state.collection_upsert_impl(empty_collection_ipc(1, "c")).unwrap();
        state.collection_add_item_impl(&cid(1), None, request_ipc(20, "r")).unwrap();
        let snap = state.collection_delete_item_impl(&cid(1), &cid(20)).unwrap().unwrap();
        assert_eq!(state.collection_get_impl(&cid(1)).unwrap().items.len(), 0);
        state.collection_restore_item_impl(&cid(1), snap, None, 0).unwrap();
        assert_eq!(state.collection_get_impl(&cid(1)).unwrap().items.len(), 1);
        // deleting a missing item → Ok(None)
        assert!(state.collection_delete_item_impl(&cid(1), &cid(999)).unwrap().is_none());
    }

    #[test]
    fn set_node_auth_on_collection_and_request() {
        let state = AppState::default();
        state.collection_upsert_impl(empty_collection_ipc(1, "c")).unwrap();
        state.collection_add_item_impl(&cid(1), None, request_ipc(20, "r")).unwrap();
        let cfg = SavedAuthConfigIpc::EnvVar {
            env_var: "TOK".into(),
            header_name: "authorization".into(),
            prefix: "Bearer ".into(),
            environments: vec![],
        };
        state.collection_set_node_auth_impl(&cid(1), None, cfg.clone()).unwrap();
        state.collection_set_node_auth_impl(&cid(1), Some(cid(20)), cfg).unwrap();
        let got = state.collection_get_impl(&cid(1)).unwrap();
        assert!(matches!(got.auth, SavedAuthConfigIpc::EnvVar { .. }));
        let req = match &got.items[0] {
            ItemIpc::Request(r) => r,
            _ => panic!(),
        };
        assert!(matches!(req.auth, SavedAuthConfigIpc::EnvVar { .. }));
    }

    #[test]
    fn set_node_auth_on_folder_is_rejected() {
        let state = AppState::default();
        state.collection_upsert_impl(empty_collection_ipc(1, "c")).unwrap();
        state.collection_add_item_impl(&cid(1), None, folder_ipc(10, "f")).unwrap();
        let cfg = SavedAuthConfigIpc::EnvVar {
            env_var: "TOK".into(),
            header_name: "authorization".into(),
            prefix: "Bearer ".into(),
            environments: vec![],
        };
        let err = state.collection_set_node_auth_impl(&cid(1), Some(cid(10)), cfg).unwrap_err();
        assert!(matches!(err, CoreError::InvalidTarget(_)));
    }

    #[test]
    fn bump_usage_sets_last_used_and_increments_count() {
        let state = AppState::default();
        state.collection_upsert_impl(empty_collection_ipc(1, "c")).unwrap();
        state.collection_add_item_impl(&cid(1), None, request_ipc(20, "r")).unwrap();
        state.collection_bump_usage_impl(&cid(1), &cid(20), 555.0).unwrap();
        state.collection_bump_usage_impl(&cid(1), &cid(20), 777.0).unwrap();
        let got = state.collection_get_impl(&cid(1)).unwrap();
        let req = match &got.items[0] {
            ItemIpc::Request(r) => r,
            _ => panic!(),
        };
        assert_eq!(req.last_used_at, Some(777.0));
        assert_eq!(req.use_count, 2);
    }

    #[test]
    fn set_expanded_persists_collection_and_folder() {
        let state = AppState::default();
        state.collection_upsert_impl(empty_collection_ipc(1, "c")).unwrap();
        state.collection_add_item_impl(&cid(1), None, folder_ipc(10, "f")).unwrap();
        // collection-level (item_id = None)
        state.collection_set_expanded_impl(&cid(1), None, true).unwrap();
        assert!(state.collection_get_impl(&cid(1)).unwrap().expanded);
        // folder-level
        state.collection_set_expanded_impl(&cid(1), Some(cid(10)), true).unwrap();
        let c = state.collection_get_impl(&cid(1)).unwrap();
        assert!(matches!(&c.items[0], ItemIpc::Folder(f) if f.expanded));
    }

    #[test]
    fn set_expanded_missing_folder_errors() {
        let state = AppState::default();
        state.collection_upsert_impl(empty_collection_ipc(1, "c")).unwrap();
        let err = state.collection_set_expanded_impl(&cid(1), Some(cid(999)), true).unwrap_err();
        assert!(matches!(err, CoreError::InvalidTarget(_)));
    }
}
