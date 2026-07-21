//! Portable export/import bundle: one JSON document carrying any number of
//! collections plus any number of environments. Reuses the [`Envelope`]
//! atomic-write + schema-version primitive (so a future-version file is
//! rejected for free). The `kind` tag guards against importing an unrelated
//! JSON (a single-collection on-disk file, random JSON, …).

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::collections::Collection;
use crate::env::Environment;
use crate::error::CoreError;
use crate::persist::{atomic_write_json, read_json, Envelope};

/// Self-describing tag stored in every export file.
pub const BUNDLE_KIND: &str = "handshaker-export";

/// A portable export payload. Uses core types directly, so the file's serde
/// shape matches the on-disk per-collection / environments files.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Bundle {
    pub kind: String,
    pub collections: Vec<Collection>,
    pub environments: Vec<Environment>,
}

impl Bundle {
    /// Wrap collections + environments with the current [`BUNDLE_KIND`].
    pub fn new(collections: Vec<Collection>, environments: Vec<Environment>) -> Self {
        Self { kind: BUNDLE_KIND.to_string(), collections, environments }
    }
}

/// Serialize `bundle` into an [`Envelope`] and atomically write it to `path`.
pub fn write_bundle(path: &Path, bundle: &Bundle) -> Result<(), CoreError> {
    atomic_write_json(path, &Envelope::new(bundle))
}

/// Read + validate an export file: envelope parse (+ future-version gate) then
/// a `kind` check. A foreign/corrupt file is a `CoreError`, never a panic.
pub fn read_bundle(path: &Path) -> Result<Bundle, CoreError> {
    let bundle: Bundle = read_json(path)?;
    if bundle.kind != BUNDLE_KIND {
        return Err(CoreError::InvalidTarget(format!(
            "not a Handshaker export file (kind `{}`)",
            bundle.kind
        )));
    }
    Ok(bundle)
}

#[cfg(test)]
mod tests {
    use indexmap::IndexMap;

    use uuid::Uuid;

    use super::*;
    use crate::auth::SavedAuthConfig;
    use crate::collections::ids::CollectionId;
    use crate::collections::CollectionLink;

    fn sample_collection(id: u128, name: &str) -> Collection {
        Collection {
            id: CollectionId(Uuid::from_u128(id)),
            name: name.into(),
            items: vec![],
            variables: IndexMap::new(),
            auth: SavedAuthConfig::None,
            default_tls: false,
            skip_tls_verify: false,
            pinned: false,
            description: None,
            created_at: 0.0,
            expanded: false,
            links: vec![],
        }
    }

    fn sample_env(name: &str) -> Environment {
        Environment { name: name.into(), variables: IndexMap::new(), color: None }
    }

    #[test]
    fn write_then_read_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("export.json");
        let bundle = Bundle::new(vec![sample_collection(1, "c")], vec![sample_env("prod")]);
        write_bundle(&path, &bundle).unwrap();
        let back = read_bundle(&path).unwrap();
        assert_eq!(back, bundle);
    }

    /// A shared bundle carries the collection's links, so an importing teammate
    /// gets the service's tooling too.
    #[test]
    fn links_survive_an_export_import_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("export.json");
        let mut c = sample_collection(1, "c");
        c.links = vec![
            CollectionLink { name: "Grafana".into(), url: "https://{{host}}/d/abc".into() },
            CollectionLink { name: "Logs".into(), url: "https://logs.example".into() },
        ];
        write_bundle(&path, &Bundle::new(vec![c.clone()], vec![])).unwrap();
        let back = read_bundle(&path).unwrap();
        assert_eq!(back.collections[0].links, c.links);
    }

    /// A bundle exported before this feature has no `links` key — it must import
    /// cleanly, with an empty list.
    #[test]
    fn pre_feature_bundle_imports_with_empty_links() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("legacy.json");
        let bundle = Bundle::new(vec![sample_collection(1, "c")], vec![]);
        write_bundle(&path, &bundle).unwrap();

        // Strip `links` from the persisted collection, mimicking a pre-feature export.
        let raw = std::fs::read_to_string(&path).unwrap();
        let mut doc: serde_json::Value = serde_json::from_str(&raw).unwrap();
        doc["data"]["collections"][0]
            .as_object_mut()
            .unwrap()
            .remove("links")
            .expect("links must be exported in the first place");
        std::fs::write(&path, serde_json::to_string(&doc).unwrap()).unwrap();

        let back = read_bundle(&path).unwrap();
        assert!(back.collections[0].links.is_empty());
    }

    #[test]
    fn read_rejects_foreign_kind() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("foreign.json");
        let foreign = Bundle { kind: "something-else".into(), collections: vec![], environments: vec![] };
        atomic_write_json(&path, &Envelope::new(&foreign)).unwrap();
        let err = read_bundle(&path).unwrap_err();
        assert!(matches!(err, CoreError::InvalidTarget(_)), "got {err:?}");
    }

    #[test]
    fn read_rejects_non_json() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bad.json");
        std::fs::write(&path, b"{ not valid json").unwrap();
        assert!(matches!(read_bundle(&path).unwrap_err(), CoreError::Persistence(_)));
    }
}
