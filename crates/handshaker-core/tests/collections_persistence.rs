//! End-to-end: build a collection with a folder + request, mutate via tree ops
//! through a FileCollectionStore on a TempDir, drop + reconstruct, assert the
//! tree survived. Mirrors the style of `tests/vars_end_to_end.rs`.

use std::collections::HashMap;

use handshaker_core::auth::AuthByEnv;
use handshaker_core::collections::ids::{CollectionId, ItemId};
use handshaker_core::collections::store::CollectionStore;
use handshaker_core::collections::{tree, Collection, Folder, Item, SavedRequest};
use handshaker_core::collections::FileCollectionStore;
use uuid::Uuid;

fn request(id: u128, name: &str) -> Item {
    Item::Request(SavedRequest {
        id: ItemId(Uuid::from_u128(id)),
        name: name.into(),
        address_template: "{{host}}".into(),
        service: "pkg.Svc".into(),
        method: "Do".into(),
        body_template: "{}".into(),
        metadata: HashMap::new(),
        auth_by_env: AuthByEnv::default(),
        tls_override: None,
    })
}

#[test]
fn collection_tree_survives_restart() {
    let dir = tempfile::tempdir().unwrap();
    let store = FileCollectionStore::load(dir.path().to_path_buf()).unwrap();

    let cid = CollectionId(Uuid::from_u128(100));
    let mut coll = Collection {
        id: cid,
        name: "My API".into(),
        items: vec![Item::Folder(Folder {
            id: ItemId(Uuid::from_u128(1)),
            name: "Users".into(),
            items: vec![],
            auth_by_env: AuthByEnv::default(),
        })],
        variables: HashMap::new(),
        auth_by_env: AuthByEnv::default(),
        default_tls: false,
        skip_tls_verify: false,
    };

    // Add a request under the folder, then persist.
    tree::add_item(&mut coll.items, Some(ItemId(Uuid::from_u128(1))), request(2, "GetUser")).unwrap();
    store.upsert(coll).unwrap();

    // "Restart".
    drop(store);
    let store2 = FileCollectionStore::load(dir.path().to_path_buf()).unwrap();
    let reloaded = store2.get(cid).unwrap();

    // Folder + nested request survived.
    let found = tree::find_item(&reloaded.items, ItemId(Uuid::from_u128(2)));
    assert!(found.is_some(), "nested request should survive restart");
    assert_eq!(found.unwrap().name(), "GetUser");
}
