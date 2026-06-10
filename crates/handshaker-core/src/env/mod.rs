//! Environment state — named variable sets.
//!
//! Storage abstraction lives in this module; the in-memory implementation lives
//! in [`in_memory`]. Active-env tracking is *not* a core concept — it's a Tauri
//! session concept handled in `src-tauri/src/state.rs`.

use std::collections::HashMap;

use crate::error::CoreError;
use serde::{Deserialize, Serialize};

pub mod file_store;
pub mod in_memory;

/// Named variable set.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Environment {
    pub name: String,
    pub variables: HashMap<String, String>,
    /// Optional palette-key color marker (e.g. "red"). `None` ⇒ frontend derives a
    /// default from the name. Stored opaquely; not validated here.
    #[serde(default)]
    pub color: Option<String>,
}

/// Storage abstraction for environments. Implementations:
/// [`in_memory::InMemoryEnvironmentStore`], [`file_store::FileEnvironmentStore`].
/// List order is canonical (user-meaningful) and must be preserved by impls.
pub trait EnvironmentStore: Send + Sync {
    /// Environments in user order.
    fn list(&self) -> Vec<Environment>;
    fn get(&self, name: &str) -> Option<Environment>;
    /// Existing name ⇒ replace in place (position preserved). New name ⇒ append.
    fn upsert(&self, env: Environment) -> Result<(), CoreError>;
    /// Order-preserving removal. Idempotent for unknown names.
    fn delete(&self, name: &str) -> Result<(), CoreError>;
    /// Rearrange the whole set to exactly `names` — must be a permutation of
    /// the current name set, otherwise `CoreError::InvalidTarget`.
    fn reorder(&self, names: &[String]) -> Result<(), CoreError>;
}

/// Validate an env name per master spec §5.2.
pub(crate) fn validate_env_name(name: &str) -> Result<(), CoreError> {
    if name.len() == 0 {
        return Err(CoreError::InvalidTarget(format!("invalid env name `{name}`")));
    }
    Ok(())
}

/// Validate `names` as an exact permutation of `current`'s names and return
/// `current` rearranged to that order. Shared by store impls.
pub(crate) fn reordered(
    current: &[Environment],
    names: &[String],
) -> Result<Vec<Environment>, CoreError> {
    if names.len() != current.len() {
        return Err(CoreError::InvalidTarget(format!(
            "reorder: expected {} names, got {}",
            current.len(),
            names.len()
        )));
    }
    let mut remaining: Vec<&Environment> = current.iter().collect();
    let mut next = Vec::with_capacity(current.len());
    for name in names {
        match remaining.iter().position(|e| &e.name == name) {
            Some(i) => next.push(remaining.remove(i).clone()),
            None => {
                return Err(CoreError::InvalidTarget(format!(
                    "reorder: unknown or duplicate name `{name}`"
                )))
            }
        }
    }
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_validation_accepts_typical() {
        assert!(validate_env_name("Default").is_ok());
        assert!(validate_env_name("prod_eu").is_ok());
        assert!(validate_env_name("_internal").is_ok());
        assert!(validate_env_name("env-1").is_ok());
    }

    #[test]
    fn name_validation_rejects_empty() {
        assert!(validate_env_name("").is_err());
    }

    #[test]
    fn name_validation_accepts_any_non_empty() {
        // Validation now only guards against empty names; everything else is allowed.
        assert!(validate_env_name("1bad").is_ok());
        assert!(validate_env_name("with space").is_ok());
        assert!(validate_env_name("with.dot").is_ok());
    }

    fn env(name: &str) -> Environment {
        Environment { name: name.into(), variables: HashMap::new(), color: None }
    }

    #[test]
    fn reordered_rearranges() {
        let cur = vec![env("a"), env("b"), env("c")];
        let next = reordered(&cur, &["c".into(), "a".into(), "b".into()]).unwrap();
        let names: Vec<_> = next.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["c", "a", "b"]);
    }

    #[test]
    fn reordered_rejects_wrong_length() {
        let cur = vec![env("a"), env("b")];
        assert!(reordered(&cur, &["a".into()]).is_err());
    }

    #[test]
    fn reordered_rejects_unknown_name() {
        let cur = vec![env("a"), env("b")];
        assert!(reordered(&cur, &["a".into(), "ghost".into()]).is_err());
    }

    #[test]
    fn reordered_rejects_duplicate_name() {
        let cur = vec![env("a"), env("b")];
        assert!(reordered(&cur, &["a".into(), "a".into()]).is_err());
    }
}
