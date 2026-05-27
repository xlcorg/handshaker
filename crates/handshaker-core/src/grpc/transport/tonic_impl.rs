//! Concrete `GrpcTransport` backed by `tonic::transport::Channel`.

use crate::error::CoreError;
use crate::grpc::connection::GrpcTarget;
use crate::grpc::transport::{GrpcTransport, TonicChannel};
use tonic::transport::{ClientTlsConfig, Endpoint};

#[derive(Debug, Default, Clone)]
pub struct TonicTransport;

impl TonicTransport {
    pub fn new() -> Self {
        Self
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
            let tls = ClientTlsConfig::new().with_native_roots();
            endpoint = endpoint
                .tls_config(tls)
                .map_err(|e| CoreError::Transport(format!("tls config for `{uri}`: {e}")))?;
        }

        endpoint
            .connect()
            .await
            .map_err(|e| CoreError::Transport(format!("connect `{uri}`: {e}")))
    }

    async fn unary_dynamic(
        &self,
        _channel: TonicChannel,
        _method_path: String,
        _request_codec: crate::grpc::transport::DynamicCodec,
        _request: prost_reflect::DynamicMessage,
        _metadata: std::collections::HashMap<String, String>,
    ) -> Result<crate::grpc::UnaryOutcome, CoreError> {
        Err(CoreError::NotImplemented(
            "unary_dynamic — real impl arrives in Plan #3 Task 4".into(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn skip_verify_returns_not_implemented() {
        let t = TonicTransport::new();
        // skip_verify is meaningful only with TLS — that combination is the deferred
        // path. With tls=false, skip_verify would be a no-op (no certs to skip).
        let target = GrpcTarget::new("127.0.0.1:65535", true, true).unwrap();
        let err = t.channel(&target).await.unwrap_err();
        assert!(matches!(err, CoreError::NotImplemented(_)));
    }

    #[tokio::test]
    async fn plaintext_unreachable_returns_transport_error() {
        // Bind a listener, capture its port, drop it. The OS guarantees the port
        // is free for the duration of this test, and a connect to it gets
        // ECONNREFUSED (or platform equivalent) within milliseconds — reliable
        // on Windows, macOS, and Linux.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        drop(listener);

        let t = TonicTransport::new();
        let target = GrpcTarget::new(addr.to_string(), false, false).unwrap();
        let err = t.channel(&target).await.unwrap_err();
        assert!(matches!(err, CoreError::Transport(_)), "got {err:?}");
    }
}
