//! Codec для DynamicMessage. Один codec на один call (per мастер-спека §5.6).
//!
//! Параметризуется парой MessageDescriptor'ов из общего DescriptorPool;
//! tonic::client::Grpc вызывает encoder/decoder для encode request + decode response.

use prost::Message;
use prost_reflect::{DynamicMessage, MessageDescriptor};
use tonic::codec::{Codec, DecodeBuf, Decoder, EncodeBuf, Encoder};

/// Codec для динамических protobuf-сообщений. Несёт descriptor'ы request и response
/// той Method'ы, которую вызываем — `tonic::client::Grpc` вызывает `encoder()`
/// перед отправкой и `decoder()` после получения.
pub struct DynamicCodec {
    pub request_descriptor: MessageDescriptor,
    pub response_descriptor: MessageDescriptor,
}

/// Encoder — без внутреннего state. DynamicMessage сам несёт свой descriptor
/// и реализует `prost::Message::encode`.
pub struct DynamicEncoder;

/// Decoder — содержит response descriptor, чтобы создать `DynamicMessage::new`
/// и заполнить его из wire bytes через `merge`.
pub struct DynamicDecoder {
    response_descriptor: MessageDescriptor,
}

impl Codec for DynamicCodec {
    type Encode = DynamicMessage;
    type Decode = DynamicMessage;
    type Encoder = DynamicEncoder;
    type Decoder = DynamicDecoder;

    fn encoder(&mut self) -> Self::Encoder {
        DynamicEncoder
    }

    fn decoder(&mut self) -> Self::Decoder {
        DynamicDecoder {
            response_descriptor: self.response_descriptor.clone(),
        }
    }
}

impl Encoder for DynamicEncoder {
    type Item = DynamicMessage;
    type Error = tonic::Status;

    fn encode(&mut self, item: Self::Item, dst: &mut EncodeBuf<'_>) -> Result<(), Self::Error> {
        item.encode(dst)
            .map_err(|e| tonic::Status::internal(format!("dynamic encode: {e}")))
    }
}

impl Decoder for DynamicDecoder {
    type Item = DynamicMessage;
    type Error = tonic::Status;

    fn decode(&mut self, src: &mut DecodeBuf<'_>) -> Result<Option<Self::Item>, Self::Error> {
        let mut msg = DynamicMessage::new(self.response_descriptor.clone());
        msg.merge(src)
            .map_err(|e| tonic::Status::internal(format!("dynamic decode: {e}")))?;
        Ok(Some(msg))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use prost_reflect::{DescriptorPool, ReflectMessage};
    use tonic::codec::EncodeBody;

    /// Минимальный pool с message `test.Ping { string id = 1 }` для round-trip тестов.
    fn ping_pool() -> DescriptorPool {
        // syntax = "proto3"; package test; message Ping { string id = 1; }
        use prost::Message as _;
        use prost_types::{field_descriptor_proto::Type as Ty, *};
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
        let set = prost_types::FileDescriptorSet { file: vec![file] };
        let mut buf = Vec::new();
        set.encode(&mut buf).expect("encode set");
        let mut pool = DescriptorPool::new();
        pool.add_file_descriptor_set(set).expect("add set");
        pool
    }

    fn ping_descriptor() -> MessageDescriptor {
        ping_pool()
            .get_message_by_name("test.Ping")
            .expect("test.Ping in pool")
    }

    /// Build a DynamicCodec for test.Ping ↔ test.Ping and run a message through
    /// the full Encoder → wire frames → Decoder path.
    ///
    /// `tonic::codec::EncodeBuf::new` and `DecodeBuf::new` are `pub(crate)` in
    /// tonic 0.14.6 (see codec/buffer.rs), so we cannot construct them directly.
    /// Instead we go through the two public wrappers that tonic exposes:
    ///
    ///   • `EncodeBody::new_client`  — drives `DynamicEncoder::encode`
    ///   • `tonic::Streaming::new_request` — drives `DynamicDecoder::decode`
    ///
    /// This is the same call-stack that `tonic::client::Grpc` uses in production.
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

    #[tokio::test]
    async fn roundtrip_ping_with_id() {
        let desc = ping_descriptor();
        let mut msg = DynamicMessage::new(desc.clone());
        msg.set_field_by_name("id", prost_reflect::Value::String("hello".to_string()));

        let decoded = roundtrip(msg).await;

        assert_eq!(decoded.descriptor().full_name(), "test.Ping");
        let id = decoded
            .get_field_by_name("id")
            .expect("field id present")
            .as_str()
            .expect("string")
            .to_string();
        assert_eq!(id, "hello");
    }

    #[tokio::test]
    async fn roundtrip_empty_message_decodes_to_defaults() {
        let desc = ping_descriptor();
        let msg = DynamicMessage::new(desc.clone()); // id = "" (proto3 default)

        let decoded = roundtrip(msg).await;

        assert_eq!(decoded.descriptor().full_name(), "test.Ping");
        // proto3 string default = "" — the field is absent on the wire but
        // get_field_by_name returns the default value.
        let id = decoded
            .get_field_by_name("id")
            .expect("field id present")
            .as_str()
            .expect("string")
            .to_string();
        assert_eq!(id, "");
    }
}
