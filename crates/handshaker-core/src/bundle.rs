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
    use std::collections::HashMap;

    use uuid::Uuid;

    use super::*;
    use crate::auth::SavedAuthConfig;
    use crate::collections::ids::CollectionId;

    fn sample_collection(id: u128, name: &str) -> Collection {
        Collection {
            id: CollectionId(Uuid::from_u128(id)),
            name: name.into(),
            items: vec![],
            variables: HashMap::new(),
            auth: SavedAuthConfig::None,
            default_tls: false,
            skip_tls_verify: false,
            pinned: false,
            description: None,
            created_at: 0.0,
            expanded: false,
        }
    }

    fn sample_env(name: &str) -> Environment {
        Environment { name: name.into(), variables: HashMap::new(), color: None }
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
