//! Scalar well-known types — single source of truth for the proto3-JSON
//! representation of the `google.protobuf.*` wrapper/value types that are
//! encoded as a BARE scalar in proto3 JSON, not as a nested `{"value": …}`
//! message.
//!
//! Both the request skeleton (`skeleton`) and the message-schema builder
//! (`schema`) classify a `Message(m)` kind through [`classify`]: if the
//! message is one of these well-known types, it is treated as its canonical
//! scalar form instead of being expanded as an ordinary message. Producing
//! `{"value": 0}` for e.g. `google.protobuf.Int64Value` makes
//! `prost_reflect::DynamicMessage::deserialize` reject the body
//! (`invalid type: map, expected a 64-bit signed integer or decimal string`),
//! because proto3 JSON serializes these as the bare wrapped value.
//!
//! Scope is deliberately narrow: only the 12 types below. `Struct`, `Value`,
//! `ListValue`, `Any`, `Empty` and every other message keep the ordinary
//! message path (recursion / message node).

use serde_json::{json, Value};

/// A `google.protobuf.*` type that proto3 JSON represents as a bare scalar.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ScalarWellKnown {
    DoubleValue,
    FloatValue,
    Int64Value,
    UInt64Value,
    Int32Value,
    UInt32Value,
    BoolValue,
    StringValue,
    BytesValue,
    Timestamp,
    Duration,
    FieldMask,
}

/// Classify a message by its fully-qualified name. Returns `Some` only for the
/// 12 scalar well-known types; every other message (including `Struct`,
/// `Value`, `ListValue`, `Any`, `Empty`) returns `None` and keeps the ordinary
/// message path.
pub(crate) fn classify(full_name: &str) -> Option<ScalarWellKnown> {
    use ScalarWellKnown::*;
    Some(match full_name {
        "google.protobuf.DoubleValue" => DoubleValue,
        "google.protobuf.FloatValue" => FloatValue,
        "google.protobuf.Int64Value" => Int64Value,
        "google.protobuf.UInt64Value" => UInt64Value,
        "google.protobuf.Int32Value" => Int32Value,
        "google.protobuf.UInt32Value" => UInt32Value,
        "google.protobuf.BoolValue" => BoolValue,
        "google.protobuf.StringValue" => StringValue,
        "google.protobuf.BytesValue" => BytesValue,
        "google.protobuf.Timestamp" => Timestamp,
        "google.protobuf.Duration" => Duration,
        "google.protobuf.FieldMask" => FieldMask,
        _ => return None,
    })
}

impl ScalarWellKnown {
    /// Human/type label used by the message-schema and skeleton surfaces, e.g.
    /// `int64`, `string`, `Timestamp`. Mirrors the scalar labels in `schema`.
    pub(crate) fn label(self) -> &'static str {
        use ScalarWellKnown::*;
        match self {
            DoubleValue => "double",
            FloatValue => "float",
            Int64Value => "int64",
            UInt64Value => "uint64",
            Int32Value => "int32",
            UInt32Value => "uint32",
            BoolValue => "bool",
            StringValue => "string",
            BytesValue => "bytes",
            Timestamp => "Timestamp",
            Duration => "Duration",
            FieldMask => "FieldMask",
        }
    }

    /// Default skeleton value in the bare proto3-JSON scalar form.
    pub(crate) fn skeleton_default(self) -> Value {
        use ScalarWellKnown::*;
        match self {
            DoubleValue | FloatValue => json!(0.0),
            Int64Value | UInt64Value | Int32Value | UInt32Value => json!(0),
            BoolValue => json!(false),
            StringValue => json!(""),
            BytesValue => json!(""),
            Timestamp => json!("1970-01-01T00:00:00Z"),
            Duration => json!("0s"),
            FieldMask => json!(""),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_all_twelve_scalar_wkts() {
        let cases = [
            ("google.protobuf.DoubleValue", ScalarWellKnown::DoubleValue),
            ("google.protobuf.FloatValue", ScalarWellKnown::FloatValue),
            ("google.protobuf.Int64Value", ScalarWellKnown::Int64Value),
            ("google.protobuf.UInt64Value", ScalarWellKnown::UInt64Value),
            ("google.protobuf.Int32Value", ScalarWellKnown::Int32Value),
            ("google.protobuf.UInt32Value", ScalarWellKnown::UInt32Value),
            ("google.protobuf.BoolValue", ScalarWellKnown::BoolValue),
            ("google.protobuf.StringValue", ScalarWellKnown::StringValue),
            ("google.protobuf.BytesValue", ScalarWellKnown::BytesValue),
            ("google.protobuf.Timestamp", ScalarWellKnown::Timestamp),
            ("google.protobuf.Duration", ScalarWellKnown::Duration),
            ("google.protobuf.FieldMask", ScalarWellKnown::FieldMask),
        ];
        for (name, expected) in cases {
            assert_eq!(classify(name), Some(expected), "classify({name})");
        }
    }

    #[test]
    fn does_not_classify_struct_value_listvalue_any_empty_or_plain() {
        for name in [
            "google.protobuf.Struct",
            "google.protobuf.Value",
            "google.protobuf.ListValue",
            "google.protobuf.Any",
            "google.protobuf.Empty",
            "my.pkg.Int64Value", // same short name, different package
            "t.M",
        ] {
            assert_eq!(classify(name), None, "classify({name}) must be None");
        }
    }

    #[test]
    fn labels_match_scalar_forms() {
        assert_eq!(classify("google.protobuf.Int64Value").unwrap().label(), "int64");
        assert_eq!(classify("google.protobuf.UInt32Value").unwrap().label(), "uint32");
        assert_eq!(classify("google.protobuf.StringValue").unwrap().label(), "string");
        assert_eq!(classify("google.protobuf.BoolValue").unwrap().label(), "bool");
        assert_eq!(classify("google.protobuf.DoubleValue").unwrap().label(), "double");
        assert_eq!(classify("google.protobuf.Timestamp").unwrap().label(), "Timestamp");
        assert_eq!(classify("google.protobuf.Duration").unwrap().label(), "Duration");
        assert_eq!(classify("google.protobuf.FieldMask").unwrap().label(), "FieldMask");
    }

    #[test]
    fn skeleton_defaults_are_bare_scalars() {
        assert_eq!(classify("google.protobuf.Int64Value").unwrap().skeleton_default(), json!(0));
        assert_eq!(classify("google.protobuf.UInt64Value").unwrap().skeleton_default(), json!(0));
        assert_eq!(classify("google.protobuf.Int32Value").unwrap().skeleton_default(), json!(0));
        assert_eq!(classify("google.protobuf.UInt32Value").unwrap().skeleton_default(), json!(0));
        assert_eq!(classify("google.protobuf.DoubleValue").unwrap().skeleton_default(), json!(0.0));
        assert_eq!(classify("google.protobuf.FloatValue").unwrap().skeleton_default(), json!(0.0));
        assert_eq!(classify("google.protobuf.BoolValue").unwrap().skeleton_default(), json!(false));
        assert_eq!(classify("google.protobuf.StringValue").unwrap().skeleton_default(), json!(""));
        assert_eq!(classify("google.protobuf.BytesValue").unwrap().skeleton_default(), json!(""));
        assert_eq!(
            classify("google.protobuf.Timestamp").unwrap().skeleton_default(),
            json!("1970-01-01T00:00:00Z")
        );
        assert_eq!(classify("google.protobuf.Duration").unwrap().skeleton_default(), json!("0s"));
        assert_eq!(classify("google.protobuf.FieldMask").unwrap().skeleton_default(), json!(""));
    }
}
