//! Concrete `GrpcTransport` backed by `tonic::transport::Channel`.

use crate::error::CoreError;
use crate::grpc::connection::GrpcTarget;
use crate::grpc::transport::{DynamicCodec, GrpcTransport, TonicChannel};
use crate::grpc::UnaryOutcome;
use prost_reflect::DynamicMessage;
use std::collections::HashMap;
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
        channel: TonicChannel,
        method_path: String,
        request_codec: DynamicCodec,
        request: DynamicMessage,
        metadata: HashMap<String, String>,
    ) -> Result<UnaryOutcome, CoreError> {
        let mut grpc = tonic::client::Grpc::new(channel);
        grpc.ready()
            .await
            .map_err(|e| CoreError::Transport(format!("channel not ready: {e}")))?;

        let path: http::uri::PathAndQuery = method_path
            .parse()
            .map_err(|e| CoreError::EncodeRequest(format!("invalid path `{method_path}`: {e}")))?;

        let mut tonic_req = tonic::Request::new(request);
        inject_ascii_metadata(tonic_req.metadata_mut(), &metadata)?;

        let started = std::time::Instant::now();
        let result = grpc.unary(tonic_req, path, request_codec).await;
        let elapsed_ms = started.elapsed().as_millis() as u64;

        match result {
            Ok(response) => {
                let trailing = metadata_to_map(response.metadata());
                let msg: DynamicMessage = response.into_inner();
                // prost-reflect impl Serialize for DynamicMessage = canonical proto3 JSON.
                let json = serde_json::to_string_pretty(&msg)
                    .map_err(|e| CoreError::DecodeResponse(e.to_string()))?;
                Ok(UnaryOutcome {
                    status_code: 0,
                    status_message: "OK".into(),
                    response_json: Some(json),
                    trailing_metadata: trailing,
                    elapsed_ms,
                })
            }
            Err(status) => Ok(UnaryOutcome {
                status_code: status.code() as i32,
                status_message: format!("{}: {}", status.code(), status.message()),
                response_json: None,
                trailing_metadata: metadata_to_map(status.metadata()),
                elapsed_ms,
            }),
        }
    }
}

/// Place ASCII metadata from a HashMap into a `tonic::metadata::MetadataMap`.
/// Binary (`-bin` suffix) is rejected — this is an MVP simplification (Plan #3 §2 D10).
fn inject_ascii_metadata(
    md: &mut tonic::metadata::MetadataMap,
    pairs: &HashMap<String, String>,
) -> Result<(), CoreError> {
    for (k, v) in pairs {
        let key = tonic::metadata::AsciiMetadataKey::from_bytes(k.to_lowercase().as_bytes())
            .map_err(|e| CoreError::EncodeRequest(format!("invalid metadata key `{k}`: {e}")))?;
        let value = tonic::metadata::AsciiMetadataValue::try_from(v.as_str())
            .map_err(|e| CoreError::EncodeRequest(format!("invalid metadata value for `{k}`: {e}")))?;
        md.insert(key, value);
    }
    Ok(())
}

/// Pull ASCII keys out of a `MetadataMap`. Binary keys (`-bin` suffix) are skipped silently.
fn metadata_to_map(md: &tonic::metadata::MetadataMap) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for kv in md.iter() {
        if let tonic::metadata::KeyAndValueRef::Ascii(k, v) = kv {
            if let Ok(s) = v.to_str() {
                out.insert(k.to_string(), s.to_string());
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn unary_dynamic_returns_unavailable_outcome_on_dead_channel() {
        use crate::grpc::transport::DynamicCodec;
        use crate::grpc::UnaryOutcome;
        use prost_reflect::{DescriptorPool, DynamicMessage};
        use prost_types::{field_descriptor_proto::Type as Ty, *};
        use std::collections::HashMap;

        // Bind a port and immediately drop the listener — connecting to it will fail.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        drop(listener);

        // Open a lazy channel — connect_lazy doesn't fail at ready(), but the first
        // actual RPC returns UNAVAILABLE (code 14). Per the architectural invariant,
        // non-OK gRPC status → Ok(UnaryOutcome { status_code: 14, ... }), NOT Err.
        let channel = tonic::transport::Channel::from_shared(format!("http://{addr}"))
            .unwrap()
            .connect_lazy();

        // Minimal pool for DynamicCodec.
        let ping = DescriptorProto {
            name: Some("Ping".to_string()),
            field: vec![FieldDescriptorProto {
                name: Some("id".to_string()),
                number: Some(1),
                r#type: Some(Ty::String as i32),
                ..Default::default()
            }],
            ..Default::default()
        };
        let file = FileDescriptorProto {
            name: Some("test/ping.proto".to_string()),
            package: Some("test".to_string()),
            syntax: Some("proto3".to_string()),
            message_type: vec![ping],
            ..Default::default()
        };
        let set = FileDescriptorSet { file: vec![file] };
        let mut pool = DescriptorPool::new();
        pool.add_file_descriptor_set(set).expect("add set");
        let desc = pool.get_message_by_name("test.Ping").unwrap();

        let codec = DynamicCodec {
            request_descriptor: desc.clone(),
            response_descriptor: desc.clone(),
        };
        let request = DynamicMessage::new(desc);

        let t = TonicTransport::new();
        let outcome: UnaryOutcome = t
            .unary_dynamic(
                channel,
                "/test.Ping/Send".to_string(),
                codec,
                request,
                HashMap::new(),
            )
            .await
            .expect("dead channel returns Ok(UnaryOutcome), not Err");

        // gRPC UNAVAILABLE = code 14
        assert_eq!(
            outcome.status_code, 14,
            "expected UNAVAILABLE (14), got {}",
            outcome.status_code
        );
        assert!(
            outcome.response_json.is_none(),
            "non-OK outcome should have no response JSON"
        );
    }

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
