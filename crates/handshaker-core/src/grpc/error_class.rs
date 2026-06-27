//! Classify a transport/connect error MESSAGE into a coarse kind, so the UI can pick a
//! face/hint without re-parsing strings. This is the single source of truth (was a
//! fragile frontend regex). The `Other` kind covers anything we don't specifically map.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectKind {
    Refused,
    Tls,
    Dns,
    Other,
}

/// Map a raw connect/transport error string (from tonic / the OS) to a `ConnectKind`.
/// Order matters: more specific patterns first.
pub fn classify_connect_error(message: &str) -> ConnectKind {
    let m = message.to_lowercase();
    if m.contains("connection refused") || m.contains("econnrefused") || m.contains("refused") {
        ConnectKind::Refused
    } else if m.contains("certificate")
        || m.contains("tls")
        || m.contains("ssl")
        || m.contains("handshake")
    {
        ConnectKind::Tls
    } else if m.contains("dns")
        || m.contains("name resolution")
        || m.contains("failed to lookup")
        || m.contains("no such host")
    {
        ConnectKind::Dns
    } else {
        ConnectKind::Other
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_real_world_strings() {
        assert_eq!(classify_connect_error("connection refused"), ConnectKind::Refused);
        assert_eq!(
            classify_connect_error("tcp connect error: Connection refused (os error 10061)"),
            ConnectKind::Refused
        );
        assert_eq!(classify_connect_error("the certificate is not trusted"), ConnectKind::Tls);
        assert_eq!(classify_connect_error("TLS handshake failed"), ConnectKind::Tls);
        assert_eq!(classify_connect_error("dns error: failed to lookup address"), ConnectKind::Dns);
        assert_eq!(classify_connect_error("no such host"), ConnectKind::Dns);
        assert_eq!(classify_connect_error("something weird"), ConnectKind::Other);
    }
}
