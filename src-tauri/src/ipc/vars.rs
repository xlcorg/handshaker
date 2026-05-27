//! IPC wrapper for `ResolutionReport`.

use handshaker_core::vars::ResolutionReport;
use serde::Serialize;
use specta::Type;

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
