//! IPC wrapper for `Environment` — adds `specta::Type` and serde derives.

use indexmap::IndexMap;

use handshaker_core::env::Environment;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct EnvironmentIpc {
    pub name: String,
    pub variables: IndexMap<String, String>,
    pub color: Option<String>,
}

impl From<Environment> for EnvironmentIpc {
    fn from(e: Environment) -> Self {
        Self { name: e.name, variables: e.variables, color: e.color }
    }
}

impl From<EnvironmentIpc> for Environment {
    fn from(e: EnvironmentIpc) -> Self {
        Self { name: e.name, variables: e.variables, color: e.color }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Regression for the live "variable order не сохраняется" bug.
    ///
    /// Tauri's IPC layer serializes command return values through
    /// `serde_json::to_value` before handing them to the WebView. `serde_json`'s
    /// `Value::Object` is backed by a `BTreeMap` (alphabetical) UNLESS the
    /// `preserve_order` feature is enabled — in which case it is an `IndexMap`
    /// (insertion order). So even though `EnvironmentIpc.variables` is an
    /// insertion-ordered `IndexMap` (and round-trips order to disk via direct
    /// `to_writer`), the IPC `to_value` hop silently re-sorted the keys
    /// alphabetically. This test pins the `to_value` boundary that the
    /// file-store round-trip tests never exercised.
    #[test]
    fn to_value_preserves_variable_insertion_order() {
        let mut variables = IndexMap::new();
        for k in ["zebra", "apple", "mango", "delta"] {
            variables.insert(k.to_string(), "v".to_string());
        }
        let env = EnvironmentIpc { name: "e".into(), variables, color: None };

        let value = serde_json::to_value(&env).unwrap();
        let keys: Vec<&str> = value["variables"]
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();

        assert_eq!(
            keys,
            vec!["zebra", "apple", "mango", "delta"],
            "tauri IPC (serde_json::to_value) must preserve IndexMap insertion order; \
             without serde_json's `preserve_order` feature it sorts alphabetically"
        );
    }
}
