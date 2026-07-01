//! Concrete `GrpcTransport` backed by `tonic::transport::Channel`.

use crate::error::CoreError;
use crate::grpc::connection::GrpcTarget;
use crate::grpc::invoke::{extract_status_details, CallOptions};
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
            .map_err(|e| CoreError::Transport(format!("connect `{uri}`: {}", error_chain(&e))))
    }

    async fn unary_dynamic(
        &self,
        channel: TonicChannel,
        method_path: String,
        request_codec: DynamicCodec,
        request: DynamicMessage,
        metadata: HashMap<String, String>,
        opts: CallOptions,
    ) -> Result<UnaryOutcome, CoreError> {
        let mut grpc = tonic::client::Grpc::new(channel)
            .max_decoding_message_size(opts.max_message_bytes)
            .max_encoding_message_size(opts.max_message_bytes);
        grpc.ready()
            .await
            .map_err(|e| CoreError::Transport(format!("channel not ready: {}", error_chain(&e))))?;

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
                let json = message_to_pretty_json(&msg)?;
                Ok(UnaryOutcome {
                    status_code: 0,
                    status_message: "OK".into(),
                    response_json: Some(json),
                    trailing_metadata: trailing,
                    status_details: Vec::new(),
                    elapsed_ms,
                })
            }
            Err(status) => Ok(UnaryOutcome {
                status_code: status.code() as i32,
                status_message: status.message().to_string(),
                response_json: None,
                trailing_metadata: metadata_to_map(status.metadata()),
                status_details: extract_status_details(&status),
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

/// Serialize a decoded response message to pretty JSON, **emitting fields that are at
/// their proto3 default value**.
///
/// prost-reflect's default `Serialize` impl uses `SerializeOptions::skip_default_fields =
/// true` (proto3 canonical JSON), which OMITS any field whose value is the default
/// (`""` / `0` / `false` / empty). For a gRPC debugging tool that hides newly-added or
/// zero-valued response fields entirely — Postman / grpcurl show them. We override with
/// `skip_default_fields(false)` so the response view always shows the full message shape.
/// We also set `use_proto_field_name(true)` so field names come out as the proto
/// (snake_case) names — matching Handshaker's Contract tab and request body — instead
/// of the canonical proto3-JSON lowerCamelCase.
/// See <https://docs.rs/prost-reflect/latest/prost_reflect/struct.SerializeOptions.html>.
fn message_to_pretty_json(msg: &DynamicMessage) -> Result<String, CoreError> {
    let mut buf = Vec::new();
    let mut serializer = serde_json::Serializer::pretty(&mut buf);
    let options = prost_reflect::SerializeOptions::new()
        .skip_default_fields(false)
        .use_proto_field_name(true);
    msg.serialize_with_options(&mut serializer, &options)
        .map_err(|e| CoreError::DecodeResponse(e.to_string()))?;
    String::from_utf8(buf).map_err(|e| CoreError::DecodeResponse(e.to_string()))
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

/// Render an error together with its `source()` chain, so the real cause behind an
/// opaque wrapper is visible. tonic's `transport::Error` Displays as just "transport
/// error"; the actual reason (e.g. `tcp connect error: Connection refused (os error …)`)
/// lives one or more links down the chain. Joined with `: `, de-duplicating links
/// whose message a parent already ends with.
fn error_chain(e: &(dyn std::error::Error + 'static)) -> String {
    let mut out = e.to_string();
    let mut src = e.source();
    while let Some(s) = src {
        let msg = s.to_string();
        if !msg.is_empty() && !out.ends_with(&msg) {
            out.push_str(": ");
            out.push_str(&msg);
        }
        src = s.source();
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
                CallOptions { max_message_bytes: 16 * 1024 * 1024 },
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
        let msg = match err {
            CoreError::Transport(m) => m,
            other => panic!("expected Transport, got {other:?}"),
        };
        assert!(msg.contains("connect `"), "keeps the connect prefix: {msg}");
        // The opaque tonic "transport error" must be enriched with the underlying
        // cause from the source() chain (platform-dependent wording).
        let lower = msg.to_lowercase();
        assert!(
            lower.contains("refused") || lower.contains("os error") || lower.contains("connect error"),
            "transport error should include the underlying cause, got: {msg}"
        );
    }

    #[test]
    fn error_chain_joins_sources_without_duplicating_tail() {
        use std::fmt;

        #[derive(Debug)]
        struct Inner;
        impl fmt::Display for Inner {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, "Connection refused (os error 10061)")
            }
        }
        impl std::error::Error for Inner {}

        #[derive(Debug)]
        struct Outer(Inner);
        impl fmt::Display for Outer {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, "transport error")
            }
        }
        impl std::error::Error for Outer {
            fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
                Some(&self.0)
            }
        }

        assert_eq!(
            error_chain(&Outer(Inner)),
            "transport error: Connection refused (os error 10061)"
        );
        // A parent that already ends with its source's message is not duplicated.
        #[derive(Debug)]
        struct Repeat(Inner);
        impl fmt::Display for Repeat {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, "tcp connect error: Connection refused (os error 10061)")
            }
        }
        impl std::error::Error for Repeat {
            fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
                Some(&self.0)
            }
        }
        assert_eq!(
            error_chain(&Repeat(Inner)),
            "tcp connect error: Connection refused (os error 10061)"
        );
    }

    /// A response message whose fields are all at their proto3 default value must still
    /// serialize WITH those fields present — otherwise newly-added / zero-valued response
    /// fields are invisible in the viewer (Postman/grpcurl show them). Regression guard
    /// for the `skip_default_fields` default in prost-reflect's canonical JSON.
    #[test]
    fn response_json_emits_default_valued_fields() {
        use prost::Message as _;
        use prost_reflect::{DescriptorPool, DynamicMessage};
        use prost_types::{
            field_descriptor_proto::Type as Ty, DescriptorProto, FieldDescriptorProto,
            FileDescriptorProto, FileDescriptorSet,
        };

        // message Pong { string id = 1; bool done = 2; int32 count = 3; }
        let pong = DescriptorProto {
            name: Some("Pong".into()),
            field: vec![
                FieldDescriptorProto {
                    name: Some("id".into()),
                    number: Some(1),
                    r#type: Some(Ty::String as i32),
                    ..Default::default()
                },
                FieldDescriptorProto {
                    name: Some("done".into()),
                    number: Some(2),
                    r#type: Some(Ty::Bool as i32),
                    ..Default::default()
                },
                FieldDescriptorProto {
                    name: Some("count".into()),
                    number: Some(3),
                    r#type: Some(Ty::Int32 as i32),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let file = FileDescriptorProto {
            name: Some("t.proto".into()),
            package: Some("test".into()),
            syntax: Some("proto3".into()),
            message_type: vec![pong],
            ..Default::default()
        };
        let set = FileDescriptorSet { file: vec![file] };
        let mut buf = Vec::new();
        set.encode(&mut buf).unwrap();
        let mut pool = DescriptorPool::new();
        pool.add_file_descriptor_set(FileDescriptorSet::decode(&buf[..]).unwrap())
            .unwrap();
        let desc = pool.get_message_by_name("test.Pong").unwrap();

        // Every field left unset → all at proto3 default (""/false/0).
        let msg = DynamicMessage::new(desc);
        let json = message_to_pretty_json(&msg).expect("serialize");

        assert!(json.contains("\"id\""), "default string field must appear: {json}");
        assert!(json.contains("\"done\""), "default bool field must appear: {json}");
        assert!(json.contains("\"count\""), "default int field must appear: {json}");
    }

    /// The response viewer mirrors the .proto (and the Contract tab): a multi-word
    /// field serializes as its snake_case proto name, NOT canonical camelCase.
    #[test]
    fn response_json_uses_proto_snake_case_field_names() {
        use prost::Message as _;
        use prost_reflect::{DescriptorPool, DynamicMessage};
        use prost_types::{
            field_descriptor_proto::Type as Ty, DescriptorProto, FieldDescriptorProto,
            FileDescriptorProto, FileDescriptorSet,
        };

        // message Company { string tax_registration_code = 1; }
        let company = DescriptorProto {
            name: Some("Company".into()),
            field: vec![FieldDescriptorProto {
                name: Some("tax_registration_code".into()),
                number: Some(1),
                r#type: Some(Ty::String as i32),
                ..Default::default()
            }],
            ..Default::default()
        };
        let file = FileDescriptorProto {
            name: Some("t.proto".into()),
            package: Some("test".into()),
            syntax: Some("proto3".into()),
            message_type: vec![company],
            ..Default::default()
        };
        let set = FileDescriptorSet { file: vec![file] };
        let mut buf = Vec::new();
        set.encode(&mut buf).unwrap();
        let mut pool = DescriptorPool::new();
        pool.add_file_descriptor_set(FileDescriptorSet::decode(&buf[..]).unwrap())
            .unwrap();
        let desc = pool.get_message_by_name("test.Company").unwrap();

        let msg = DynamicMessage::new(desc);
        let json = message_to_pretty_json(&msg).expect("serialize");
        assert!(
            json.contains("\"tax_registration_code\""),
            "snake_case proto key expected: {json}"
        );
        assert!(
            !json.contains("taxRegistrationCode"),
            "camelCase key must be gone: {json}"
        );
    }
}
