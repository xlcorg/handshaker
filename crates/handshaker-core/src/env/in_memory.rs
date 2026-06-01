//! In-memory implementation of [`EnvironmentStore`].

use std::collections::HashMap;
use std::sync::RwLock;

use crate::error::CoreError;

use super::{validate_env_name, Environment, EnvironmentStore};

/// Thread-safe in-memory store. Backed by `RwLock<HashMap<String, Environment>>`.
/// Critical sections are O(1) HashMap operations — using `std::sync::RwLock` from
/// async code is safe under this load.
pub struct InMemoryEnvironmentStore {
    inner: RwLock<HashMap<String, Environment>>,
}

impl InMemoryEnvironmentStore {
    pub fn new() -> Self {
        Self { inner: RwLock::new(HashMap::new()) }
    }

    /// Bootstrap with a single empty `"Default"` env. Used by Tauri startup.
    pub fn with_default() -> Self {
        let mut map = HashMap::new();
        map.insert(
            "Default".to_string(),
            Environment {
                name: "Default".to_string(),
                variables: HashMap::new(),
            },
        );
        Self { inner: RwLock::new(map) }
    }
}

impl Default for InMemoryEnvironmentStore {
    fn default() -> Self { Self::new() }
}

impl EnvironmentStore for InMemoryEnvironmentStore {
    fn list(&self) -> Vec<Environment> {
        self.inner
            .read()
            .expect("env store lock poisoned")
            .values()
            .cloned()
            .collect()
    }

    fn get(&self, name: &str) -> Option<Environment> {
        self.inner
            .read()
            .expect("env store lock poisoned")
            .get(name)
            .cloned()
    }

    fn upsert(&self, env: Environment) -> Result<(), CoreError> {
        validate_env_name(&env.name)?;
        self.inner
            .write()
            .expect("env store lock poisoned")
            .insert(env.name.clone(), env);
        Ok(())
    }

    fn delete(&self, name: &str) -> Result<(), CoreError> {
        self.inner
            .write()
            .expect("env store lock poisoned")
            .remove(name);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn with_default_creates_default_env() {
        let s = InMemoryEnvironmentStore::with_default();
        let envs = s.list();
        assert_eq!(envs.len(), 1);
        assert_eq!(envs[0].name, "Default");
        assert!(envs[0].variables.is_empty());
    }

    #[test]
    fn upsert_inserts_and_replaces() {
        let s = InMemoryEnvironmentStore::new();
        let mut vars = HashMap::new();
        vars.insert("k".to_string(), "v1".to_string());
        s.upsert(Environment { name: "e1".into(), variables: vars }).unwrap();
        assert_eq!(s.get("e1").unwrap().variables.get("k"), Some(&"v1".to_string()));

        // Replace
        let mut vars2 = HashMap::new();
        vars2.insert("k".to_string(), "v2".to_string());
        s.upsert(Environment { name: "e1".into(), variables: vars2 }).unwrap();
        assert_eq!(s.get("e1").unwrap().variables.get("k"), Some(&"v2".to_string()));
    }

    #[test]
    fn upsert_rejects_invalid_name() {
        let s = InMemoryEnvironmentStore::new();
        let err = s.upsert(Environment {
            name: "".into(),
            variables: HashMap::new(),
        }).unwrap_err();
        match err {
            CoreError::InvalidTarget(msg) => assert!(msg.contains("invalid env name")),
            other => panic!("expected InvalidTarget, got {other:?}"),
        }
    }

    #[test]
    fn delete_removes_silently_idempotent() {
        let s = InMemoryEnvironmentStore::new();
        s.upsert(Environment { name: "e".into(), variables: HashMap::new() }).unwrap();
        s.delete("e").unwrap();
        assert!(s.get("e").is_none());
        // Idempotent — delete missing returns Ok.
        s.delete("e").unwrap();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn concurrent_upsert_and_list_does_not_panic() {
        let s = Arc::new(InMemoryEnvironmentStore::new());
        let mut handles = Vec::new();
        for i in 0..10 {
            let s = s.clone();
            handles.push(tokio::spawn(async move {
                let name = format!("env_{i}");
                let mut vars = HashMap::new();
                vars.insert("k".to_string(), format!("v_{i}"));
                s.upsert(Environment { name, variables: vars }).unwrap();
                let _ = s.list();
            }));
        }
        for h in handles {
            h.await.unwrap();
        }
        assert_eq!(s.list().len(), 10);
    }
}
