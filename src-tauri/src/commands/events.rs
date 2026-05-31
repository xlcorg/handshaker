//! Tauri-specta events emitted by the gRPC subsystem.

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri_specta::Event;

/// Emitted whenever a target's contract has been (re)built (describe / refresh).
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct ContractUpdated {
    /// Stable key identifying the target whose contract just refreshed.
    pub target_key: String,
}
