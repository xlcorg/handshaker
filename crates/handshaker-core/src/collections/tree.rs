//! Pure tree operations over a collection's `Vec<Item>`. All operate by `ItemId`
//! and recurse into folders. Idempotent where the IPC contract promises it
//! (design §5).

use crate::error::CoreError;

use super::ids::ItemId;
use super::Item;

/// A removed item plus where it lived, for undo (`collection_restore_item`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ItemSnapshot {
    pub item: Item,
    /// Parent folder id, or `None` if it was a root child.
    pub parent: Option<ItemId>,
    pub position: usize,
}

/// DFS for an item by id (immutable).
pub fn find_item(items: &[Item], id: ItemId) -> Option<&Item> {
    for it in items {
        if it.id() == id {
            return Some(it);
        }
        if let Item::Folder(f) = it {
            if let Some(found) = find_item(&f.items, id) {
                return Some(found);
            }
        }
    }
    None
}

/// DFS for an item by id (mutable).
pub fn find_item_mut(items: &mut [Item], id: ItemId) -> Option<&mut Item> {
    for it in items.iter_mut() {
        if it.id() == id {
            return Some(it);
        }
        if let Item::Folder(f) = it {
            if let Some(found) = find_item_mut(&mut f.items, id) {
                return Some(found);
            }
        }
    }
    None
}

/// Locate `id`: returns `(parent_folder_id_or_None_for_root, position)`.
fn locate(items: &[Item], id: ItemId, current_parent: Option<ItemId>) -> Option<(Option<ItemId>, usize)> {
    if let Some(pos) = items.iter().position(|it| it.id() == id) {
        return Some((current_parent, pos));
    }
    for it in items {
        if let Item::Folder(f) = it {
            if let Some(res) = locate(&f.items, id, Some(f.id)) {
                return Some(res);
            }
        }
    }
    None
}

/// Borrow the container `Vec` that holds direct children of `parent` (or root).
fn container_mut<'a>(items: &'a mut Vec<Item>, parent: Option<ItemId>) -> Result<&'a mut Vec<Item>, CoreError> {
    match parent {
        None => Ok(items),
        Some(pid) => match find_item_mut(items, pid) {
            Some(Item::Folder(f)) => Ok(&mut f.items),
            Some(Item::Request(_)) => Err(CoreError::InvalidTarget(format!("parent {pid:?} is a request, not a folder"))),
            None => Err(CoreError::InvalidTarget(format!("parent folder {pid:?} not found"))),
        },
    }
}

/// Append `item` under `parent` (or root). Idempotent: if `item.id()` already
/// exists anywhere in the tree, this is a no-op `Ok`.
pub fn add_item(items: &mut Vec<Item>, parent: Option<ItemId>, item: Item) -> Result<(), CoreError> {
    if find_item(items, item.id()).is_some() {
        return Ok(());
    }
    let container = container_mut(items, parent)?;
    container.push(item);
    Ok(())
}

/// Rename an item. Missing → `InvalidTarget`. Idempotent (same name → `Ok`).
pub fn rename_item(items: &mut [Item], id: ItemId, name: String) -> Result<(), CoreError> {
    match find_item_mut(items, id) {
        Some(it) => {
            it.set_name(name);
            Ok(())
        }
        None => Err(CoreError::InvalidTarget(format!("item {id:?} not found"))),
    }
}

/// Remove an item, returning a snapshot for undo. Missing → `None` (idempotent
/// at the command layer).
pub fn delete_item(items: &mut Vec<Item>, id: ItemId) -> Option<ItemSnapshot> {
    let (parent, pos) = locate(items, id, None)?;
    let container = match parent {
        None => &mut *items,
        Some(pid) => match find_item_mut(items, pid) {
            Some(Item::Folder(f)) => &mut f.items,
            _ => return None,
        },
    };
    let item = container.remove(pos);
    Some(ItemSnapshot { item, parent, position: pos })
}

/// Re-insert a previously-removed item at `parent`/`pos` (position clamped).
pub fn restore_item(items: &mut Vec<Item>, item: Item, parent: Option<ItemId>, pos: usize) -> Result<(), CoreError> {
    let container = container_mut(items, parent)?;
    let clamped = pos.min(container.len());
    container.insert(clamped, item);
    Ok(())
}

/// Detach `id` and reinsert at `pos` under `new_parent`. Rejects moving a folder
/// into itself or one of its descendants.
pub fn move_item(items: &mut Vec<Item>, id: ItemId, new_parent: Option<ItemId>, pos: usize) -> Result<(), CoreError> {
    if let Some(np) = new_parent {
        if np == id {
            return Err(CoreError::InvalidTarget("cannot move a folder into itself".into()));
        }
        if let Some(Item::Folder(f)) = find_item(items, id) {
            if find_item(&f.items, np).is_some() {
                return Err(CoreError::InvalidTarget("cannot move a folder into its own descendant".into()));
            }
        }
        // Validate destination is a folder.
        match find_item(items, np) {
            Some(Item::Folder(_)) => {}
            Some(Item::Request(_)) => return Err(CoreError::InvalidTarget("new parent is not a folder".into())),
            None => return Err(CoreError::InvalidTarget("new parent not found".into())),
        }
    }
    let snap = delete_item(items, id)
        .ok_or_else(|| CoreError::InvalidTarget(format!("item {id:?} not found")))?;
    restore_item(items, snap.item, new_parent, pos)
}

/// Deep-clone the subtree rooted at `id` with FRESH ids throughout; insert as the
/// next sibling. Returns the new root id.
pub fn duplicate_item(items: &mut Vec<Item>, id: ItemId) -> Result<ItemId, CoreError> {
    let (parent, pos) = locate(items, id, None)
        .ok_or_else(|| CoreError::InvalidTarget(format!("item {id:?} not found")))?;
    let mut clone = find_item(items, id).expect("located above").clone();
    let new_root_id = reassign_ids(&mut clone);
    let container = match parent {
        None => &mut *items,
        Some(pid) => match find_item_mut(items, pid) {
            Some(Item::Folder(f)) => &mut f.items,
            _ => return Err(CoreError::InvalidTarget("parent vanished".into())),
        },
    };
    container.insert(pos + 1, clone);
    Ok(new_root_id)
}

/// Recursively assign fresh ids to an item and all descendants; return the root's.
fn reassign_ids(item: &mut Item) -> ItemId {
    match item {
        Item::Folder(f) => {
            f.id = ItemId::new();
            for child in &mut f.items {
                reassign_ids(child);
            }
            f.id
        }
        Item::Request(r) => {
            r.id = ItemId::new();
            r.id
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::AuthByEnv;
    use crate::collections::{Folder, SavedRequest};
    use std::collections::HashMap;
    use uuid::Uuid;

    fn iid(n: u128) -> ItemId {
        ItemId(Uuid::from_u128(n))
    }

    fn req(id: ItemId, name: &str) -> Item {
        Item::Request(SavedRequest {
            id,
            name: name.to_string(),
            address_template: "{{host}}".into(),
            service: "svc".into(),
            method: "M".into(),
            body_template: "{}".into(),
            metadata: HashMap::new(),
            auth_by_env: AuthByEnv::default(),
            tls_override: None,
        })
    }

    fn folder(id: ItemId, name: &str, items: Vec<Item>) -> Item {
        Item::Folder(Folder {
            id,
            name: name.to_string(),
            items,
            auth_by_env: AuthByEnv::default(),
        })
    }

    #[test]
    fn add_at_root_and_under_folder() {
        let mut items = vec![folder(iid(1), "f", vec![])];
        add_item(&mut items, None, req(iid(2), "r2")).unwrap();
        add_item(&mut items, Some(iid(1)), req(iid(3), "r3")).unwrap();
        assert_eq!(items.len(), 2);
        assert!(find_item(&items, iid(3)).is_some());
    }

    #[test]
    fn add_is_idempotent_on_duplicate_id() {
        let mut items = vec![req(iid(1), "r")];
        add_item(&mut items, None, req(iid(1), "r-again")).unwrap();
        assert_eq!(items.len(), 1);
    }

    #[test]
    fn add_under_request_parent_is_invalid() {
        let mut items = vec![req(iid(1), "r")];
        let err = add_item(&mut items, Some(iid(1)), req(iid(2), "x")).unwrap_err();
        assert!(matches!(err, CoreError::InvalidTarget(_)));
    }

    #[test]
    fn rename_sets_name() {
        let mut items = vec![req(iid(1), "old")];
        rename_item(&mut items, iid(1), "new".into()).unwrap();
        assert_eq!(find_item(&items, iid(1)).unwrap().name(), "new");
    }

    #[test]
    fn delete_returns_snapshot_and_restore_reinserts() {
        let mut items = vec![req(iid(1), "a"), req(iid(2), "b"), req(iid(3), "c")];
        let snap = delete_item(&mut items, iid(2)).unwrap();
        assert_eq!(snap.position, 1);
        assert_eq!(snap.parent, None);
        assert_eq!(items.len(), 2);
        restore_item(&mut items, snap.item, snap.parent, snap.position).unwrap();
        assert_eq!(items.len(), 3);
        assert_eq!(items[1].id(), iid(2));
    }

    #[test]
    fn delete_missing_is_none() {
        let mut items = vec![req(iid(1), "a")];
        assert!(delete_item(&mut items, iid(99)).is_none());
    }

    #[test]
    fn move_across_folders() {
        let mut items = vec![folder(iid(1), "f1", vec![req(iid(2), "r")]), folder(iid(3), "f2", vec![])];
        move_item(&mut items, iid(2), Some(iid(3)), 0).unwrap();
        // r is now under f2, not f1.
        if let Item::Folder(f1) = &items[0] {
            assert!(f1.items.is_empty());
        } else {
            panic!();
        }
        if let Item::Folder(f2) = &items[1] {
            assert_eq!(f2.items[0].id(), iid(2));
        } else {
            panic!();
        }
    }

    #[test]
    fn move_folder_into_own_descendant_is_rejected() {
        let mut items = vec![folder(iid(1), "outer", vec![folder(iid(2), "inner", vec![])])];
        let err = move_item(&mut items, iid(1), Some(iid(2)), 0).unwrap_err();
        assert!(matches!(err, CoreError::InvalidTarget(_)));
    }

    #[test]
    fn duplicate_makes_fresh_ids_at_every_depth() {
        let mut items = vec![folder(iid(1), "f", vec![req(iid(2), "r")])];
        let new_root = duplicate_item(&mut items, iid(1)).unwrap();
        assert_eq!(items.len(), 2);
        assert_ne!(new_root, iid(1));
        // The duplicated subtree's child id differs from the original's child id.
        if let Item::Folder(dup) = find_item(&items, new_root).unwrap() {
            assert_ne!(dup.items[0].id(), iid(2));
        } else {
            panic!("duplicate root is not a folder");
        }
    }
}
