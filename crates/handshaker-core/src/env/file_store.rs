//! Disk-backed implementation of [`EnvironmentStore`]. One JSON file holds the
//! whole environment set (small data — simplicity over incrementality). An
//! in-memory `RwLock` mirror serves reads so they never hit disk; the mirror is
//! updated only after a successful atomic write (clone-then-commit, design §R7).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::RwLock;

use crate::error::CoreError;
use crate::persist::{atomic_write_json, read_json_or_default, Envelope};

use super::{validate_env_name, Environment, EnvironmentStore};

pub struct FileEnvironmentStore {
    path: PathBuf,
    inner: RwLock<HashMap<String, Environment>>,
}

impl FileEnvironmentStore {
    pub fn load(path: PathBuf) -> Result<Self, CoreError> {
        let list: Vec<Environment> = read_json_or_default(&path)?;
        let map = list.into_iter().map(|e| (e.name.clone(), e)).collect();
        Ok(Self { path, inner: RwLock::new(map) })
    }

    /// Serialize the given map to disk, deterministically ordered by name.
    fn persist(&self, map: &HashMap<String, Environment>) -> Result<(), CoreError> {
        let mut list: Vec<Environment> = map.values().cloned().collect();
        list.sort_by(|a, b| a.name.cmp(&b.name));
        atomic_write_json(&self.path, &Envelope::new(list))
    }
}

impl EnvironmentStore for FileEnvironmentStore {
    fn list(&self) -> Vec<Environment> {
        self.inner.read().expect("env store lock poisoned").values().cloned().collect()
    }

    fn get(&self, name: &str) -> Option<Environment> {
        self.inner.read().expect("env store lock poisoned").get(name).cloned()
    }

    fn upsert(&self, env: Environment) -> Result<(), CoreError> {
        validate_env_name(&env.name)?;
        let mut guard = self.inner.write().expect("env store lock poisoned");
        let mut next = guard.clone();
        next.insert(env.name.clone(), env);
        self.persist(&next)?;
        *guard = next;
        Ok(())
    }

    fn delete(&self, name: &str) -> Result<(), CoreError> {
        let mut guard = self.inner.write().expect("env store lock poisoned");
        if !guard.contains_key(name) {
            return Ok(()); // idempotent; no disk write needed
        }
        let mut next = guard.clone();
        next.remove(name);
        self.persist(&next)?;
        *guard = next;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(name: &str, kv: &[(&str, &str)]) -> Environment {
        Environment {
            name: name.to_string(),
            variables: kv.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
            color: None,
        }
    }

    #[test]
    fn color_persists_across_reload() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("environments.json");
        let store = FileEnvironmentStore::load(path.clone()).unwrap();
        store
            .upsert(Environment { name: "prod".into(), variables: Default::default(), color: Some("red".into()) })
            .unwrap();
        drop(store);
        let store2 = FileEnvironmentStore::load(path).unwrap();
        assert_eq!(store2.get("prod").unwrap().color, Some("red".to_string()));
    }

    #[test]
    fn missing_color_deserializes_as_none() {
        // A pre-color environments.json must still load (color defaults to None).
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("environments.json");
        // Hand-write a v1 envelope WITHOUT the color field.
        let raw = r#"{"schema_version":1,"data":[{"name":"prod","variables":{}}]}"#;
        std::fs::write(&path, raw).unwrap();
        let store = FileEnvironmentStore::load(path).unwrap();
        assert_eq!(store.get("prod").unwrap().color, None);
    }

    #[test]
    fn upsert_then_reload_sees_env() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("environments.json");
        let store = FileEnvironmentStore::load(path.clone()).unwrap();
        store.upsert(env("prod", &[("host", "api:443")])).unwrap();

        // Simulate a restart: drop + reconstruct from the same path.
        drop(store);
        let store2 = FileEnvironmentStore::load(path).unwrap();
        assert_eq!(store2.get("prod").unwrap().variables.get("host"), Some(&"api:443".to_string()));
    }

    #[test]
    fn delete_persists_across_reload() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("environments.json");
        let store = FileEnvironmentStore::load(path.clone()).unwrap();
        store.upsert(env("a", &[])).unwrap();
        store.upsert(env("b", &[])).unwrap();
        store.delete("a").unwrap();

        let store2 = FileEnvironmentStore::load(path).unwrap();
        assert!(store2.get("a").is_none());
        assert!(store2.get("b").is_some());
    }

    #[test]
    fn cold_boot_is_empty() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileEnvironmentStore::load(dir.path().join("environments.json")).unwrap();
        assert!(store.list().is_empty());
    }

    #[test]
    fn rejects_invalid_name() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileEnvironmentStore::load(dir.path().join("environments.json")).unwrap();
        assert!(store.upsert(env("", &[])).is_err());
    }
}
