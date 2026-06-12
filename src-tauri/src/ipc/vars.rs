//! IPC wrapper for `ResolutionReport`.

use std::collections::HashMap;

use handshaker_core::vars::ResolutionReport;
use serde::{Deserialize, Serialize};
use specta::Type;

/// Optional resolve context for `vars_resolve`. All fields optional:
/// - `collection_id` — live paths; the backend reads the collection's vars from the store;
/// - `collection_vars` — editor overlay (unsaved rows); wins over `collection_id`;
/// - `env_vars` — env-editor overlay; wins over the active environment.
#[derive(Debug, Clone, Default, Deserialize, Type)]
pub struct VarsResolveCtxIpc {
    pub collection_id: Option<String>,
    pub collection_vars: Option<HashMap<String, String>>,
    pub env_vars: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct ResolutionReportIpc {
    pub resolved: String,
    pub unresolved_vars: Vec<String>,
    pub cycle_chain: Option<Vec<String>>,
}

impl From<ResolutionReport> for ResolutionReportIpc {
    fn from(r: ResolutionReport) -> Self {
        Self {
            resolved: r.resolved,
            unresolved_vars: r.unresolved_vars,
            cycle_chain: r.cycle_chain,
        }
    }
}
