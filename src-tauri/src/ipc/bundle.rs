//! IPC DTOs for the import/export bundle commands.

use serde::{Deserialize, Serialize};
use specta::Type;

/// Result of inspecting an export file before applying it (no mutation).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ImportSummaryIpc {
    pub collections_total: u32,
    pub collections_existing: u32,
    pub environments_total: u32,
    pub environments_existing: u32,
}

/// Result of applying an import (merge).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ImportResultIpc {
    pub collections_added: u32,
    pub collections_updated: u32,
    pub environments_added: u32,
    pub environments_updated: u32,
}
