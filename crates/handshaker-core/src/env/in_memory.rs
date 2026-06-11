//! In-memory implementation of [`EnvironmentStore`].

use std::collections::HashMap;
use std::sync::RwLock;

use crate::error::CoreError;

use super::{validate_env_name, Environment, EnvironmentStore};

/// Thread-safe in-memory store. Backed by `RwLock<Vec<Environment>>` — the
/// vector order is the canonical user order. Env counts are tiny; O(n) name
/// lookups are fine.
pub struct InMemoryEnvironmentStore {
    inner: RwLock<Vec<Environment>>,
}

impl InMemoryEnvironmentStore {
    pub fn new() -> Self {
        Self { inner: RwLock::new(Vec::new()) }
    }

    /// Bootstrap with a single empty `"Default"` env. Used by Tauri startup.
    pub fn with_default() -> Self {
        Self {
            inner: RwLock::new(vec![Environment {
                name: "Default".to_string(),
                variables: HashMap::new(),
                color: None,
            }]),
        }
    }
}

impl Default for InMemoryEnvironmentStore {
    fn default() -> Self { Self::new() }
}

impl EnvironmentStore for InMemoryEnvironmentStore {
    fn list(&self) -> Vec<Environment> {
        self.inner.read().expect("env store lock poisoned").clone()
    }

    fn get(&self, name: &str) -> Option<Environment> {
        self.inner
            .read()
            .expect("env store lock poisoned")
            .iter()
            .find(|e| e.name == name)
            .cloned()
    }

    fn upsert(&self, env: Environment) -> Result<(), CoreError> {
        validate_env_name(&env.name)?;
        let mut guard = self.inner.write().expect("env store lock poisoned");
        match guard.iter_mut().find(|e| e.name == env.name) {
            Some(slot) => *slot = env,
            None => guard.push(env),
        }
        Ok(())
    }

    fn delete(&self, name: &str) -> Result<(), CoreError> {
        self.inner
            .write()
            .expect("env store lock poisoned")
            .retain(|e| e.name != name);
        Ok(())
    }

    fn reorder(&self, names: &[String]) -> Result<(), CoreError> {
        let mut guard = self.inner.write().expect("env store lock poisoned");
        *guard = super::reordered(&guard, names)?;
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
        s.upsert(Environment { name: "e1".into(), variables: vars, color: None }).unwrap();
        assert_eq!(s.get("e1").unwrap().variables.get("k"), Some(&"v1".to_string()));

        // Replace
        let mut vars2 = HashMap::new();
        vars2.insert("k".to_string(), "v2".to_string());
        s.upsert(Environment { name: "e1".into(), variables: vars2, color: None }).unwrap();
        assert_eq!(s.get("e1").unwrap().variables.get("k"), Some(&"v2".to_string()));
    }

    #[test]
    fn upsert_rejects_invalid_name() {
        let s = InMemoryEnvironmentStore::new();
        let err = s.upsert(Environment {
            name: "".into(),
            variables: HashMap::new(),
            color: None,
        }).unwrap_err();
        match err {
            CoreError::InvalidTarget(msg) => assert!(msg.contains("invalid env name")),
            other => panic!("expected InvalidTarget, got {other:?}"),
        }
    }

    #[test]
    fn delete_removes_silently_idempotent() {
        let s = InMemoryEnvironmentStore::new();
        s.upsert(Environment { name: "e".into(), variables: HashMap::new(), color: None }).unwrap();
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
                s.upsert(Environment { name, variables: vars, color: None }).unwrap();
                let _ = s.list();
            }));
        }
        for h in handles {
            h.await.unwrap();
        }
        assert_eq!(s.list().len(), 10);
    }

    fn named(name: &str) -> Environment {
        Environment { name: name.into(), variables: HashMap::new(), color: None }
    }

    #[test]
    fn list_preserves_insertion_order() {
        let s = InMemoryEnvironmentStore::new();
        for n in ["b", "a", "c"] {
            s.upsert(named(n)).unwrap();
        }
        let names: Vec<_> = s.list().into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["b", "a", "c"]);
    }

    #[test]
    fn upsert_existing_keeps_position() {
        let s = InMemoryEnvironmentStore::new();
        for n in ["a", "b", "c"] {
            s.upsert(named(n)).unwrap();
        }
        let mut vars = HashMap::new();
        vars.insert("k".to_string(), "v".to_string());
        s.upsert(Environment { name: "b".into(), variables: vars, color: None }).unwrap();
        let names: Vec<_> = s.list().into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["a", "b", "c"]);
        assert_eq!(s.get("b").unwrap().variables.get("k"), Some(&"v".to_string()));
    }

    #[test]
    fn delete_preserves_order() {
        let s = InMemoryEnvironmentStore::new();
        for n in ["a", "b", "c"] {
            s.upsert(named(n)).unwrap();
        }
        s.delete("b").unwrap();
        let names: Vec<_> = s.list().into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["a", "c"]);
    }

    #[test]
    fn reorder_rearranges_list() {
        let s = InMemoryEnvironmentStore::new();
        for n in ["a", "b", "c"] {
            s.upsert(named(n)).unwrap();
        }
        s.reorder(&["c".into(), "a".into(), "b".into()]).unwrap();
        let names: Vec<_> = s.list().into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["c", "a", "b"]);
    }

    #[test]
    fn reorder_rejects_set_mismatch_and_leaves_order_unchanged() {
        let s = InMemoryEnvironmentStore::new();
        for n in ["a", "b"] {
            s.upsert(named(n)).unwrap();
        }
        assert!(s.reorder(&["a".into()]).is_err());
        assert!(s.reorder(&["a".into(), "ghost".into()]).is_err());
        let names: Vec<_> = s.list().into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["a", "b"]);
    }
}
