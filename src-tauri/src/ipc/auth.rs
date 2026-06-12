//! IPC DTO for resolved auth credentials (Plan #5, Phase B). Total conversion
//! from core `AuthCredentials` — a single resolved header to attach to a request.

use handshaker_core::auth::AuthCredentials;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AuthCredentialsIpc {
    pub header_name: String,
    pub header_value: String,
}

impl AuthCredentialsIpc {
    pub fn from_core(c: AuthCredentials) -> Self {
        Self { header_name: c.header_name, header_value: c.header_value }
    }
}

/// Result of a forced token fetch (the "Get token" button) — lifetime only;
/// the token itself stays in the backend cache.
/// `u32` (not u64) because specta forbids BigInt in generated TypeScript.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct OAuth2TokenInfoIpc {
    pub expires_in_secs: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_core_maps_fields_one_to_one() {
        let core = AuthCredentials {
            header_name: "authorization".into(),
            header_value: "Bearer x".into(),
        };
        let ipc = AuthCredentialsIpc::from_core(core);
        assert_eq!(ipc.header_name, "authorization");
        assert_eq!(ipc.header_value, "Bearer x");
    }
}
