//! IPC DTOs for persisted UI state (sort key + active request). Conversions to
//! and from [`handshaker_core::ui_state::UiState`] are total.

use handshaker_core::ui_state::{ActiveRequestRef, UiState};
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ActiveRequestRefIpc {
    pub collection_id: String,
    pub item_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct UiStateIpc {
    pub sort_key: Option<String>,
    pub active_request: Option<ActiveRequestRefIpc>,
}

impl UiStateIpc {
    pub fn from_core(s: UiState) -> Self {
        Self {
            sort_key: s.sort_key,
            active_request: s.active_request.map(|a| ActiveRequestRefIpc {
                collection_id: a.collection_id,
                item_id: a.item_id,
            }),
        }
    }

    pub fn into_core(self) -> UiState {
        UiState {
            sort_key: self.sort_key,
            active_request: self.active_request.map(|a| ActiveRequestRef {
                collection_id: a.collection_id,
                item_id: a.item_id,
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ui_state_round_trips_through_ipc() {
        let original = UiState {
            sort_key: Some("name".into()),
            active_request: Some(ActiveRequestRef {
                collection_id: "col-1".into(),
                item_id: "item-2".into(),
            }),
        };
        let ipc = UiStateIpc::from_core(original.clone());
        let back = ipc.into_core();
        assert_eq!(original, back);
    }
}
