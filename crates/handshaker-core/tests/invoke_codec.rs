//! Integration tests for `DynamicCodec`: round-trip encode-decode via `tonic::codec::EncodeBody`
//! and `tonic::Streaming`, against descriptor sets with scalars and nested messages.
//!
//! No network, no server — pure codec behavior through the Tonic wire protocol.

mod common;

use handshaker_core::grpc::transport::DynamicCodec;
use prost::Message;
use prost_reflect::{DescriptorPool, DynamicMessage, ReflectMessage, Value};
use tonic::codec::{Codec, EncodeBody};

/// Build a DescriptorPool from the encoded bytes of the simple fixture (test.Ping + test.Pong).
fn pool_from_fixture() -> DescriptorPool {
    let bytes = common::fixture_descriptor_set_bytes();
    let set = prost_types::FileDescriptorSet::decode(&bytes[..])
        .expect("decode fixture descriptor set");
    let mut pool = DescriptorPool::new();
    pool.add_file_descriptor_set(set)
        .expect("add fixture to DescriptorPool");
    pool
}

/// Build a DescriptorPool from the encoded bytes of the multi-file fixture
/// (test.Header + test.PingX + test.PongX, with dependencies).
fn pool_from_fixture_with_deps() -> DescriptorPool {
    let bytes = common::fixture_descriptor_set_with_deps_bytes();
    let set = prost_types::FileDescriptorSet::decode(&bytes[..])
        .expect("decode fixture descriptor set");
    let mut pool = DescriptorPool::new();
    pool.add_file_descriptor_set(set)
        .expect("add fixture to DescriptorPool");
    pool
}

/// Round-trip a `DynamicMessage` through encoder → wire → decoder using the Tonic codec path.
///
/// This replicates the pattern from `src/grpc/transport/codec.rs` tests:
/// we cannot directly construct `EncodeBuf` or `DecodeBuf` (they are `pub(crate)` in tonic),
/// so we go through the public `EncodeBody::new_client` + `tonic::Streaming::new_request` wrappers
/// that the production `tonic::client::Grpc` uses.
async fn roundtrip(msg: DynamicMessage) -> DynamicMessage {
    let desc = msg.descriptor();
    let mut codec = DynamicCodec {
        request_descriptor: desc.clone(),
        response_descriptor: desc.clone(),
    };

    // --- encode: calls DynamicEncoder::encode ---
    let stream = tokio_stream::once(Ok::<_, tonic::Status>(msg));
    let encode_body = EncodeBody::new_client(codec.encoder(), stream, None, None);

    // --- decode: calls DynamicDecoder::decode ---
    let mut streaming =
        tonic::Streaming::new_request(codec.decoder(), encode_body, None, None);

    streaming
        .message()
        .await
        .expect("decode should succeed")
        .expect("stream should yield one message")
}

// =============================================================================
// Test 1: roundtrip Ping (scalar string field)
// =============================================================================

#[tokio::test]
async fn roundtrip_ping_with_id() {
    let pool = pool_from_fixture();
    let ping_desc = pool
        .get_message_by_name("test.Ping")
        .expect("test.Ping in pool");

    let mut msg = DynamicMessage::new(ping_desc);
    msg.set_field_by_name("id", Value::String("abc".to_string()));

    let decoded = roundtrip(msg).await;

    // Verify message type
    assert_eq!(decoded.descriptor().full_name(), "test.Ping");

    // Verify field value
    let id = decoded
        .get_field_by_name("id")
        .expect("field id present")
        .as_str()
        .expect("id should be string")
        .to_string();
    assert_eq!(id, "abc");
}

// =============================================================================
// Test 2: roundtrip nested PingX (nested message field)
// =============================================================================

#[tokio::test]
async fn roundtrip_nested_ping_x() {
    let pool = pool_from_fixture_with_deps();

    // Get descriptors for Header and PingX
    let header_desc = pool
        .get_message_by_name("test.Header")
        .expect("test.Header in pool");
    let ping_x_desc = pool
        .get_message_by_name("test.PingX")
        .expect("test.PingX in pool");

    // Build Header { trace_id: "tid" }
    let mut header = DynamicMessage::new(header_desc);
    header.set_field_by_name("trace_id", Value::String("tid".to_string()));

    // Build PingX { h: <nested>, id: "outer" }
    let mut msg = DynamicMessage::new(ping_x_desc);
    msg.set_field_by_name("h", Value::Message(header));
    msg.set_field_by_name("id", Value::String("outer".to_string()));

    let decoded = roundtrip(msg).await;

    // Verify message type
    assert_eq!(decoded.descriptor().full_name(), "test.PingX");

    // Verify top-level string field
    let id = decoded
        .get_field_by_name("id")
        .expect("field id present")
        .as_str()
        .expect("id should be string")
        .to_string();
    assert_eq!(id, "outer");

    // Verify nested message field
    let h_value = decoded
        .get_field_by_name("h")
        .expect("field h present");
    let nested_header = h_value
        .as_message()
        .expect("h should be a message");

    let trace_id = nested_header
        .get_field_by_name("trace_id")
        .expect("field trace_id present in nested header")
        .as_str()
        .expect("trace_id should be string")
        .to_string();
    assert_eq!(trace_id, "tid");
}
