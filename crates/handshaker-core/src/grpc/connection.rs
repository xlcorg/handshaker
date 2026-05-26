//! GrpcTarget — resolved address + TLS flags. No `{{var}}` here.

use crate::error::CoreError;
use serde::{Deserialize, Serialize};

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
    /// - `address` contains exactly one `:`.
    /// - Port is a valid u16 (1..=65535).
    /// - Host is non-empty.
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
}
