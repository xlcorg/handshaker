//! IPC DTOs for persisted UI state (sort key + active request + links
//! placement). Conversions to and from [`handshaker_core::ui_state::UiState`]
//! are total.

use handshaker_core::ui_state::{ActiveRequestRef, LinksPlacement, UiState};
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ActiveRequestRefIpc {
    pub collection_id: String,
    pub item_id: String,
}

/// Where the collection quick-links render — mirrors [`LinksPlacement`].
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum LinksPlacementIpc {
    #[default]
    Strip,
    Header,
}

impl LinksPlacementIpc {
    fn from_core(p: LinksPlacement) -> Self {
        match p {
            LinksPlacement::Strip => Self::Strip,
            LinksPlacement::Header => Self::Header,
        }
    }

    fn into_core(self) -> LinksPlacement {
        match self {
            Self::Strip => LinksPlacement::Strip,
            Self::Header => LinksPlacement::Header,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct UiStateIpc {
    pub sort_key: Option<String>,
    pub active_request: Option<ActiveRequestRefIpc>,
    #[serde(default)]
    pub links_placement: LinksPlacementIpc,
}

impl UiStateIpc {
    pub fn from_core(s: UiState) -> Self {
        Self {
            sort_key: s.sort_key,
            active_request: s.active_request.map(|a| ActiveRequestRefIpc {
                collection_id: a.collection_id,
                item_id: a.item_id,
            }),
            links_placement: LinksPlacementIpc::from_core(s.links_placement),
        }
    }

    pub fn into_core(self) -> UiState {
        UiState {
            sort_key: self.sort_key,
            active_request: self.active_request.map(|a| ActiveRequestRef {
                collection_id: a.collection_id,
                item_id: a.item_id,
            }),
            links_placement: self.links_placement.into_core(),
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
            links_placement: LinksPlacement::Header,
        };
        let ipc = UiStateIpc::from_core(original.clone());
        let back = ipc.into_core();
        assert_eq!(original, back);
    }
}
