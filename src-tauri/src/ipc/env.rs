//! IPC wrapper for `Environment` — adds `specta::Type` and serde derives.

use std::collections::HashMap;

use handshaker_core::env::Environment;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct EnvironmentIpc {
    pub name: String,
    pub variables: HashMap<String, String>,
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
