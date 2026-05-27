//! Environment state — named variable sets.
//!
//! Storage abstraction lives in this module; the in-memory implementation lives
//! in [`in_memory`]. Active-env tracking is *not* a core concept — it's a Tauri
//! session concept handled in `src-tauri/src/state.rs`.

use std::collections::HashMap;

use crate::error::CoreError;

pub mod in_memory;

/// Named variable set.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Environment {
    /// Unique identifier; must match `^[a-zA-Z_][a-zA-Z0-9_-]*$`.
    pub name: String,
    pub variables: HashMap<String, String>,
}

/// Storage abstraction for environments. Implementations: [`in_memory::InMemoryEnvironmentStore`].
pub trait EnvironmentStore: Send + Sync {
    fn list(&self) -> Vec<Environment>;
    fn get(&self, name: &str) -> Option<Environment>;
    fn upsert(&self, env: Environment) -> Result<(), CoreError>;
    fn delete(&self, name: &str) -> Result<(), CoreError>;
}

/// Validate an env name per master spec §5.2.
pub(crate) fn validate_env_name(name: &str) -> Result<(), CoreError> {
    use std::sync::LazyLock;
    use regex::Regex;
    static NAME_RE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"^[a-zA-Z_][a-zA-Z0-9_-]*$").unwrap());
    if !NAME_RE.is_match(name) {
        return Err(CoreError::InvalidTarget(format!("invalid env name: `{name}`")));
    }
    Ok(())
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
    fn name_validation_rejects_bad() {
        assert!(validate_env_name("").is_err());
        assert!(validate_env_name("1bad").is_err());
        assert!(validate_env_name("with space").is_err());
        assert!(validate_env_name("with.dot").is_err());
    }
}
