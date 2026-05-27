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

    /// Минимальный pool с message `test.Ping { string id = 1 }` для round-trip тестов.
    fn ping_pool() -> DescriptorPool {
        // Используем fixture байтов из common test helper'а (пересобираем здесь, чтобы codec.rs
        // оставался unit-тестируемым без integration test infra). Структура:
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

    #[test]
    fn roundtrip_ping_with_id() {
        let desc = ping_descriptor();
        let mut req = DynamicMessage::new(desc.clone());
        req.set_field_by_name(
            "id",
            prost_reflect::Value::String("hello".to_string()),
        );

        // Encode via prost::Message::encode
        let mut buf = Vec::new();
        req.encode(&mut buf).expect("encode");
        assert!(!buf.is_empty(), "encoded bytes should be non-empty");

        // Decode via merge
        let mut decoded = DynamicMessage::new(desc.clone());
        let mut slice = &buf[..];
        decoded.merge(&mut slice).expect("decode");

        assert_eq!(decoded.descriptor().full_name(), "test.Ping");
        let id = decoded
            .get_field_by_name("id")
            .expect("field id present")
            .as_str()
            .expect("string")
            .to_string();
        assert_eq!(id, "hello");
    }

    #[test]
    fn roundtrip_empty_message_decodes_to_defaults() {
        let desc = ping_descriptor();
        let req = DynamicMessage::new(desc.clone()); // id = "" default

        // Encode empty message
        let mut buf = Vec::new();
        req.encode(&mut buf).expect("encode");

        // Decode into new message
        let mut decoded = DynamicMessage::new(desc.clone());
        let mut slice = &buf[..];
        decoded.merge(&mut slice).expect("decode");

        // proto3 default for string = "" — поле может отсутствовать в wire format,
        // но get_field_by_name по дефолту возвращает default value.
        let id = decoded
            .get_field_by_name("id")
            .expect("field id present")
            .as_str()
            .expect("string")
            .to_string();
        assert_eq!(id, "");
    }
}
