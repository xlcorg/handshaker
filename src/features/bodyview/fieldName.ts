import type { FieldNodeIpc } from "@/ipc/bindings";

// The single source of the field-naming invariant: "write the proto name (snake_case),
// recognize both forms". A mirror of the proto3-JSON wire deserializer, which emits
// canonical camelCase but accepts both the camelCase and the original proto name.
// See docs/superpowers/specs/2026-07-01-proto-field-names-snake-case-design.md.

/** The key Handshaker writes into the JSON body — the proto (snake_case) name,
 *  matching the Contract tab. */
export function bodyFieldKey(field: FieldNodeIpc): string {
  return field.proto_name;
}

/** Does an existing body key refer to this field? Accepts BOTH the proto name and the
 *  proto3-JSON camelCase name — legacy saved requests were written in camelCase, and
 *  the wire deserializer accepts both. */
export function matchesField(field: FieldNodeIpc, key: string): boolean {
  return key === field.proto_name || key === field.json_name;
}

/** Is any form (proto or JSON name) of this field present among `keys`? */
export function fieldPresent(field: FieldNodeIpc, keys: ReadonlySet<string>): boolean {
  return keys.has(field.proto_name) || keys.has(field.json_name);
}
