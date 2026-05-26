//! Concrete `GrpcTransport` backed by `tonic::transport::Channel`.

use crate::error::CoreError;
use crate::grpc::connection::GrpcTarget;
use crate::grpc::transport::{GrpcTransport, TonicChannel};
use tonic::transport::Endpoint;

#[derive(Debug, Default, Clone)]
pub struct TonicTransport {
    _private: (),
}

impl TonicTransport {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait::async_trait]
impl GrpcTransport for TonicTransport {
    async fn channel(&self, target: &GrpcTarget) -> Result<TonicChannel, CoreError> {
        if target.skip_verify {
            return Err(CoreError::NotImplemented(
                "skip_verify=true is deferred to a follow-up plan (requires hyper-rustls connector)"
                    .into(),
            ));
        }
        let scheme = if target.tls { "https" } else { "http" };
        let uri = format!("{scheme}://{}", target.address);
        let mut endpoint = Endpoint::from_shared(uri.clone())
            .map_err(|e| CoreError::Transport(format!("endpoint `{uri}`: {e}")))?;

        if target.tls {
            let tls = tonic::transport::ClientTlsConfig::new().with_native_roots();
            endpoint = endpoint
                .tls_config(tls)
                .map_err(|e| CoreError::Transport(format!("tls config for `{uri}`: {e}")))?;
        }

        endpoint
            .connect()
            .await
            .map_err(|e| CoreError::Transport(format!("connect `{uri}`: {e}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn skip_verify_returns_not_implemented() {
        let t = TonicTransport::new();
        let target = GrpcTarget::new("127.0.0.1:65535", true, true).unwrap();
        let err = t.channel(&target).await.unwrap_err();
        assert!(matches!(err, CoreError::NotImplemented(_)));
    }

    #[tokio::test]
    async fn plaintext_unreachable_returns_transport_error() {
        let t = TonicTransport::new();
        // Port 1 is reserved + unbound — guaranteed `Transport` error, not `InvalidTarget`.
        let target = GrpcTarget::new("127.0.0.1:1", false, false).unwrap();
        let err = t.channel(&target).await.unwrap_err();
        assert!(matches!(err, CoreError::Transport(_)), "got {err:?}");
    }
}
