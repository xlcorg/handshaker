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
    pub dynamic_vars: Vec<String>,
}

impl From<ResolutionReport> for ResolutionReportIpc {
    fn from(r: ResolutionReport) -> Self {
        Self {
            resolved: r.resolved,
            unresolved_vars: r.unresolved_vars,
            cycle_chain: r.cycle_chain,
            dynamic_vars: r.dynamic_vars,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ipc_report_carries_dynamic_vars() {
        let core = ResolutionReport {
            resolved: "id={{$guid}}".into(),
            unresolved_vars: vec![],
            cycle_chain: None,
            dynamic_vars: vec!["$guid".into()],
        };
        let ipc: ResolutionReportIpc = core.into();
        assert_eq!(ipc.dynamic_vars, vec!["$guid".to_string()]);
        assert_eq!(ipc.resolved, "id={{$guid}}");
    }
}
