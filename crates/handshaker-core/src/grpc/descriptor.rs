//! Assemble a `prost_reflect::DescriptorPool` from a flat list of `FileDescriptorProto`s.
//!
//! `prost_reflect`'s `add_file_descriptor_protos` already handles dependency ordering and
//! detects cycles / unresolved imports. We wrap it with our error type.

use crate::error::CoreError;
use prost_reflect::DescriptorPool;
use prost_types::FileDescriptorProto;

/// Build a fresh pool from a list of file descriptors. Returns
/// `CoreError::DescriptorBuild` on cycles, dangling imports, or duplicate file names.
pub fn build_pool(files: Vec<FileDescriptorProto>) -> Result<DescriptorPool, CoreError> {
    if files.is_empty() {
        return Err(CoreError::DescriptorBuild(
            "no FileDescriptorProto received from server".into(),
        ));
    }
    let mut pool = DescriptorPool::new();
    pool.add_file_descriptor_protos(files)
        .map_err(|e| CoreError::DescriptorBuild(format!("pool assembly: {e}")))?;
    Ok(pool)
}

#[cfg(test)]
mod tests {
    use super::*;
    use prost_types::{
        field_descriptor_proto::Type as FieldType, DescriptorProto, FieldDescriptorProto,
        FileDescriptorProto, MethodDescriptorProto, ServiceDescriptorProto,
    };

    fn make_simple_file() -> FileDescriptorProto {
        FileDescriptorProto {
            name: Some("test/echo.proto".into()),
            package: Some("test".into()),
            syntax: Some("proto3".into()),
            message_type: vec![
                DescriptorProto {
                    name: Some("Ping".into()),
                    field: vec![FieldDescriptorProto {
                        name: Some("id".into()),
                        number: Some(1),
                        r#type: Some(FieldType::String as i32),
                        ..Default::default()
                    }],
                    ..Default::default()
                },
                DescriptorProto {
                    name: Some("Pong".into()),
                    field: vec![FieldDescriptorProto {
                        name: Some("id".into()),
                        number: Some(1),
                        r#type: Some(FieldType::String as i32),
                        ..Default::default()
                    }],
                    ..Default::default()
                },
            ],
            service: vec![ServiceDescriptorProto {
                name: Some("Echo".into()),
                method: vec![MethodDescriptorProto {
                    name: Some("Send".into()),
                    input_type: Some(".test.Ping".into()),
                    output_type: Some(".test.Pong".into()),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    #[test]
    fn empty_input_rejected() {
        let err = build_pool(vec![]).unwrap_err();
        assert!(matches!(err, CoreError::DescriptorBuild(_)));
    }

    #[test]
    fn single_file_builds_and_resolves_service() {
        let pool = build_pool(vec![make_simple_file()]).expect("build pool");
        let svc = pool
            .get_service_by_name("test.Echo")
            .expect("Echo service must be in pool");
        assert_eq!(svc.full_name(), "test.Echo");
        assert_eq!(svc.methods().count(), 1);
        let m = svc.methods().next().unwrap();
        assert_eq!(m.name(), "Send");
        assert_eq!(m.input().full_name(), "test.Ping");
        assert_eq!(m.output().full_name(), "test.Pong");
    }

    #[test]
    fn unresolved_import_is_rejected() {
        let bad = FileDescriptorProto {
            name: Some("a.proto".into()),
            package: Some("a".into()),
            syntax: Some("proto3".into()),
            dependency: vec!["missing/b.proto".into()],
            ..Default::default()
        };
        let err = build_pool(vec![bad]).unwrap_err();
        assert!(matches!(err, CoreError::DescriptorBuild(_)));
    }
}
