//! GrpcTarget — resolved address + TLS flags. No `{{var}}` here.

use std::sync::Arc;

use crate::error::CoreError;
use crate::grpc::catalog::ServiceCatalog;
use crate::grpc::transport::TonicChannel;
use serde::{Deserialize, Serialize};

/// Resolved gRPC endpoint: `host:port` + TLS flags. Pure value type, no platform-specifics.
///
/// # Validation contract
///
/// `GrpcTarget::new(...)` is the validating constructor. **Other construction paths
/// (struct literals, `Deserialize` from JSON / IPC payloads) bypass validation** —
/// callers receiving externally-supplied `GrpcTarget`s from IPC must treat the
/// `address` field as untrusted and route through `new()` before use. Fields are
/// public to keep the IPC + serialisation surface ergonomic; the `pub` is a
/// deliberate KISS trade-off matching spec §5.6.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct GrpcTarget {
    /// `host:port`, already resolved (no `{{var}}`).
    pub address: String,
    /// `true` → TLS (`https://`). `false` → plaintext h2c (`http://`).
    pub tls: bool,
    /// `true` → skip TLS cert verification. **Not implemented in Plan #2.**
    pub skip_verify: bool,
}

impl GrpcTarget {
    /// Construct + validate.
    ///
    /// Rules:
    /// - `address` non-empty.
    /// - `address` must contain at least one `:`; the port is parsed from everything
    ///   after the last `:`, and the host is everything before. (Bracketed IPv6 like
    ///   `[::1]:443` is out of scope for Plan #2 and may produce a host of `[::1]`,
    ///   accepted but not exercised here.)
    /// - Host (everything before the last `:`) is non-empty.
    /// - Port (after the last `:`) is a valid `u16` in `1..=65535`.
    pub fn new(address: impl Into<String>, tls: bool, skip_verify: bool) -> Result<Self, CoreError> {
        let address = address.into();
        if address.is_empty() {
            return Err(CoreError::InvalidTarget("address is empty".into()));
        }
        let (host, port) = address.rsplit_once(':').ok_or_else(|| {
            CoreError::InvalidTarget(format!("address must be host:port, got `{address}`"))
        })?;
        if host.is_empty() {
            return Err(CoreError::InvalidTarget(format!(
                "host is empty in `{address}`"
            )));
        }
        let port_num: u16 = port
            .parse()
            .map_err(|_| CoreError::InvalidTarget(format!("invalid port `{port}` in `{address}`")))?;
        if port_num == 0 {
            return Err(CoreError::InvalidTarget(format!(
                "port must be 1..=65535, got 0 in `{address}`"
            )));
        }
        Ok(Self {
            address,
            tls,
            skip_verify,
        })
    }
}

/// Live connection state — the result of `activate()`. Holds the channel-bearing transport
/// plus the assembled descriptor pool and projected catalog. **NOT** `Clone`: there's at most
/// one live connection in the app (per spec §4 "Activated gRPC connections = 1").
///
/// `channel` is stored here so invoke doesn't perform a fresh h2 handshake per call —
/// one Channel is acquired in `activate()` and reused. Plan #3 §3.1.1 explains why
/// this is a pragmatic relaxation of Plan #2's "tonic confined to transport/reflection"
/// invariant (the field uses the `TonicChannel` alias, never raw `tonic::transport::Channel`).
pub struct GrpcConnection {
    pub target: GrpcTarget,
    pub transport: Arc<dyn crate::grpc::GrpcTransport>,
    pub channel: TonicChannel,
    pub pool: prost_reflect::DescriptorPool,
    pub catalog: ServiceCatalog,
}

impl std::fmt::Debug for GrpcConnection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GrpcConnection")
            .field("target", &self.target)
            .field("services", &self.catalog.services.len())
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_valid_hostport() {
        let t = GrpcTarget::new("api.prod.example.com:8443", true, false).unwrap();
        assert_eq!(t.address, "api.prod.example.com:8443");
        assert!(t.tls);
        assert!(!t.skip_verify);
    }

    #[test]
    fn accepts_ipv4() {
        let t = GrpcTarget::new("127.0.0.1:50051", false, false).unwrap();
        assert_eq!(t.address, "127.0.0.1:50051");
        assert!(!t.tls);
        assert!(!t.skip_verify);
    }

    #[test]
    fn rejects_empty_address() {
        let err = GrpcTarget::new("", false, false).unwrap_err();
        assert!(matches!(err, CoreError::InvalidTarget(_)));
    }

    #[test]
    fn rejects_missing_port() {
        let err = GrpcTarget::new("api.prod", true, false).unwrap_err();
        assert!(matches!(err, CoreError::InvalidTarget(_)));
    }

    #[test]
    fn rejects_empty_host() {
        let err = GrpcTarget::new(":8443", true, false).unwrap_err();
        assert!(matches!(err, CoreError::InvalidTarget(_)));
    }

    #[test]
    fn rejects_nonnumeric_port() {
        let err = GrpcTarget::new("api.prod:nope", true, false).unwrap_err();
        assert!(matches!(err, CoreError::InvalidTarget(_)));
    }

    #[test]
    fn rejects_zero_port() {
        let err = GrpcTarget::new("api.prod:0", true, false).unwrap_err();
        assert!(matches!(err, CoreError::InvalidTarget(_)));
    }

    #[test]
    fn rejects_overflow_port() {
        let err = GrpcTarget::new("api.prod:99999", true, false).unwrap_err();
        assert!(matches!(err, CoreError::InvalidTarget(_)));
    }

    #[test]
    fn grpc_connection_struct_has_channel_field() {
        // Compile-only check: if the `channel: TonicChannel` field is removed, this won't compile.
        fn _accepts_channel(c: &super::GrpcConnection) -> &crate::grpc::transport::TonicChannel {
            &c.channel
        }
    }
}
