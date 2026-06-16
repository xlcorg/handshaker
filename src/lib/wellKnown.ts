/**
 * Scalar `google.protobuf.*` well-known types — the wrappers plus Timestamp,
 * Duration and FieldMask. proto3 JSON encodes each as a BARE scalar, not a nested
 * `{"value": …}` message, so the deserializer (and Send) reject the object form.
 *
 * The message-schema keeps reporting these as ordinary `Message` fields, so the
 * Contract tab and ghost hints show the real type name (e.g. `Int64Value`). These
 * helpers drive only two surfaces: autocomplete INSERTS the bare scalar, and the
 * Contract renders the type atomically (the type name, no `value`-field block —
 * that's redundant for a well-known type). Kept in sync with core
 * `grpc/invoke/well_known.rs`.
 */
export type WktScalarShape = "number" | "string" | "bool";

const SCALAR_WKT: Record<string, WktScalarShape> = {
  "google.protobuf.DoubleValue": "number",
  "google.protobuf.FloatValue": "number",
  "google.protobuf.Int64Value": "number",
  "google.protobuf.UInt64Value": "number",
  "google.protobuf.Int32Value": "number",
  "google.protobuf.UInt32Value": "number",
  "google.protobuf.BoolValue": "bool",
  "google.protobuf.StringValue": "string",
  "google.protobuf.BytesValue": "string",
  "google.protobuf.Timestamp": "string",
  "google.protobuf.Duration": "string",
  "google.protobuf.FieldMask": "string",
};

/** Bare-scalar JSON shape for a (possibly null) message full-name, else `null`. */
export function scalarWktShape(messageType: string | null | undefined): WktScalarShape | null {
  return messageType ? SCALAR_WKT[messageType] ?? null : null;
}

/** True when the full-name is a scalar well-known type — atomic in contract/hints. */
export function isScalarWkt(fullName: string): boolean {
  return fullName in SCALAR_WKT;
}
