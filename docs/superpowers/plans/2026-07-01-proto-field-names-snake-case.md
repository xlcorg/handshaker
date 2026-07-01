# Proto Field Names (snake_case) in Body — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify field naming to snake_case (proto names) across the request skeleton, autocomplete, ghost hints, and response viewer so every surface matches the Contract tab.

**Architecture:** Emitters of a field name (skeleton, response serializer, autocomplete insert, ghost hint) switch to the proto name (snake_case); readers of body text (autocomplete path descent + present-check, ghost present-check, validate) recognize BOTH the proto name and the proto3-JSON camelCase name. This mirrors the wire deserializer, which emits canonical camelCase but accepts both — we flip the emit direction toward the contract. A single frontend helper `fieldName.ts` holds the invariant.

**Tech Stack:** Rust (`handshaker-core`, `prost-reflect`) · TypeScript/React (Monaco body editor) · vitest · cargo test.

**Spec:** [`docs/superpowers/specs/2026-07-01-proto-field-names-snake-case-design.md`](../specs/2026-07-01-proto-field-names-snake-case-design.md)

**Branch / worktree:** `claude/fervent-newton-dec204` (this worktree). Every commit ends with the `Co-Authored-By` trailer shown in each step.

**Invariant (name it, keep it consistent across tasks):**
- `bodyFieldKey(field)` → `field.proto_name` — the key we WRITE.
- `matchesField(field, key)` → `key === field.proto_name || key === field.json_name` — recognize both.
- `fieldPresent(field, keys)` → `keys.has(field.proto_name) || keys.has(field.json_name)`.

---

## Task 1: Backend — skeleton emits proto (snake_case) field names

**Files:**
- Modify: `crates/handshaker-core/src/grpc/invoke/skeleton.rs:44`
- Test: `crates/handshaker-core/src/grpc/invoke/skeleton.rs` (inline `#[cfg(test)] mod tests`)

- [ ] **Step 1: Write the failing test**

Add this test at the end of the `mod tests` block in `crates/handshaker-core/src/grpc/invoke/skeleton.rs` (just before the final closing `}` of the module, after `empty_wkt_is_not_collapsed_and_stays_an_object`):

```rust
    #[test]
    fn skeleton_uses_proto_snake_case_field_names() {
        // A multi-word proto field: json_name() would camelCase it to
        // `taxRegistrationCode`, but the skeleton must mirror the .proto (and the
        // Contract tab) with the snake_case proto name.
        let m = msg("M", vec![scalar_field("tax_registration_code", 1, Ty::String)]);
        let pool = pool_with(FileDescriptorSet {
            file: vec![FileDescriptorProto {
                name: Some("t.proto".into()),
                package: Some("t".into()),
                syntax: Some("proto3".into()),
                message_type: vec![m],
                ..Default::default()
            }],
        });
        let desc = pool.get_message_by_name("t.M").unwrap();
        let v = build_default_json_skeleton(&desc);
        let obj = v.as_object().expect("object");
        assert!(
            obj.contains_key("tax_registration_code"),
            "snake_case proto key expected: {v}"
        );
        assert!(
            !obj.contains_key("taxRegistrationCode"),
            "camelCase key must be gone: {v}"
        );
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p handshaker-core skeleton_uses_proto_snake_case_field_names`
Expected: FAIL — the skeleton currently emits `taxRegistrationCode` (the `contains_key("tax_registration_code")` assert fails).

- [ ] **Step 3: Write minimal implementation**

In `crates/handshaker-core/src/grpc/invoke/skeleton.rs`, change line 44 inside `build_message`:

```rust
        obj.insert(field.name().to_string(), value);
```

(was `field.json_name().to_string()` — `field.name()` returns the proto snake_case name.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p handshaker-core --lib skeleton`
Expected: PASS — the new test plus all existing skeleton tests (single-letter field names are unaffected).

- [ ] **Step 5: Commit**

```bash
git add crates/handshaker-core/src/grpc/invoke/skeleton.rs
git commit -m "feat(core): skeleton emits proto (snake_case) field names" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Backend — response viewer emits proto (snake_case) field names

**Files:**
- Modify: `crates/handshaker-core/src/grpc/transport/tonic_impl.rs:117-133` (doc + `message_to_pretty_json`)
- Test: `crates/handshaker-core/src/grpc/transport/tonic_impl.rs` (inline `mod tests`)

- [ ] **Step 1: Write the failing test**

Add this test at the end of the `mod tests` block in `crates/handshaker-core/src/grpc/transport/tonic_impl.rs` (right after `response_json_emits_default_valued_fields`, before the module's closing `}`):

```rust
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p handshaker-core response_json_uses_proto_snake_case_field_names`
Expected: FAIL — the serializer currently emits `taxRegistrationCode`.

- [ ] **Step 3: Write minimal implementation**

In `crates/handshaker-core/src/grpc/transport/tonic_impl.rs`, update `message_to_pretty_json` (the `options` line at ~129) to add `.use_proto_field_name(true)`:

```rust
    let options = prost_reflect::SerializeOptions::new()
        .skip_default_fields(false)
        .use_proto_field_name(true);
```

And append one sentence to the doc comment above the function (after the existing `skip_default_fields` paragraph, before the `See <...>` line):

```rust
/// We also set `use_proto_field_name(true)` so field names come out as the proto
/// (snake_case) names — matching Handshaker's Contract tab and request body — instead
/// of the canonical proto3-JSON lowerCamelCase.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p handshaker-core --lib tonic_impl`
Expected: PASS — the new test plus `response_json_emits_default_valued_fields` (its fields `id`/`done`/`count` are single-word, unaffected).

- [ ] **Step 5: Commit**

```bash
git add crates/handshaker-core/src/grpc/transport/tonic_impl.rs
git commit -m "feat(core): response viewer emits proto (snake_case) field names" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Frontend — `fieldName.ts` helper (the invariant)

**Files:**
- Create: `src/features/bodyview/fieldName.ts`
- Test: `src/features/bodyview/fieldName.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/bodyview/fieldName.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { FieldNodeIpc } from "@/ipc/bindings";
import { bodyFieldKey, matchesField, fieldPresent } from "./fieldName";

function f(proto_name: string, json_name: string): FieldNodeIpc {
  return {
    json_name, proto_name, type_label: "string", value_kind: "scalar",
    repeated: false, message_type: null, enum_type: null, oneof_group: null,
    number: 1, optional: false,
  };
}

const field = f("tax_registration_code", "taxRegistrationCode");

describe("bodyFieldKey", () => {
  it("returns the proto (snake_case) name — the key we write into the body", () => {
    expect(bodyFieldKey(field)).toBe("tax_registration_code");
  });
});

describe("matchesField", () => {
  it("matches the proto name", () => {
    expect(matchesField(field, "tax_registration_code")).toBe(true);
  });
  it("matches the proto3-JSON camelCase name (legacy bodies; wire accepts both)", () => {
    expect(matchesField(field, "taxRegistrationCode")).toBe(true);
  });
  it("rejects an unrelated key", () => {
    expect(matchesField(field, "something_else")).toBe(false);
  });
});

describe("fieldPresent", () => {
  it("is true when the proto name is present", () => {
    expect(fieldPresent(field, new Set(["tax_registration_code"]))).toBe(true);
  });
  it("is true when the camelCase name is present", () => {
    expect(fieldPresent(field, new Set(["taxRegistrationCode"]))).toBe(true);
  });
  it("is false when neither form is present", () => {
    expect(fieldPresent(field, new Set(["other"]))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/bodyview/fieldName.test.ts`
Expected: FAIL — `./fieldName` module does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/features/bodyview/fieldName.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/bodyview/fieldName.test.ts`
Expected: PASS (all 7 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/features/bodyview/fieldName.ts src/features/bodyview/fieldName.test.ts
git commit -m "feat(bodyview): add fieldName helper (emit snake_case, match both forms)" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Frontend — autocomplete emits snake_case, matches both forms

**Files:**
- Modify: `src/features/bodyview/completion.ts` (import + 5 sites: lines ~220, ~313, ~318, ~322-324, ~343)
- Test: `src/features/bodyview/completion.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/features/bodyview/completion.test.ts`, add `buildKeySuggestions` to the existing import from `./completion`:

```ts
import {
  resolveCompletionContext,
  descendSchema,
  computeSuggestions,
  collectPresentKeys,
  insertionColumns,
  separatorAfter,
  buildVarSuggestions,
  buildKeySuggestions,
} from "./completion";
```

Then append this describe block at the end of the file:

```ts
// A schema whose fields have DIFFERENT proto (snake_case) and JSON (camelCase) names.
const SNAKE_SCHEMA: MessageSchemaIpc = {
  root: "t.M",
  enums: [],
  messages: [
    {
      full_name: "t.M",
      fields: [
        {
          json_name: "taxRegistrationCode", proto_name: "tax_registration_code",
          type_label: "string", value_kind: "scalar", repeated: false,
          message_type: null, enum_type: null, oneof_group: null, number: 1, optional: false,
        },
        {
          json_name: "billingAddress", proto_name: "billing_address",
          type_label: "Address", value_kind: "message", repeated: false,
          message_type: "t.Address", enum_type: null, oneof_group: null, number: 2, optional: false,
        },
      ],
    },
    {
      full_name: "t.Address",
      fields: [
        {
          json_name: "postalCode", proto_name: "postal_code",
          type_label: "string", value_kind: "scalar", repeated: false,
          message_type: null, enum_type: null, oneof_group: null, number: 1, optional: false,
        },
      ],
    },
  ],
};

describe("proto snake_case field names", () => {
  it("inserts the snake_case (proto) name, not camelCase", () => {
    const s = computeSuggestions(SNAKE_SCHEMA, "{\n  ");
    const tax = s.find((x) => x.label === "tax_registration_code");
    expect(tax).toBeDefined();
    expect(tax!.insertText).toBe('"tax_registration_code": "$0"');
    expect(s.map((x) => x.label)).not.toContain("taxRegistrationCode");
  });

  it("descendSchema resolves a path segment given in EITHER name form", () => {
    const viaSnake = descendSchema(SNAKE_SCHEMA, ["billing_address"]);
    const viaCamel = descendSchema(SNAKE_SCHEMA, ["billingAddress"]);
    expect(viaCamel).toEqual(viaSnake);
    expect(viaCamel?.kind).toBe("message");
    // Nested key completion works through the legacy camelCase path.
    const nested = buildKeySuggestions(SNAKE_SCHEMA, { path: ["billingAddress"], where: "key" });
    expect(nested.map((x) => x.label)).toContain("postal_code");
  });

  it("does not re-offer a field already present under its camelCase form", () => {
    const present = new Set(["taxRegistrationCode"]);
    const s = buildKeySuggestions(SNAKE_SCHEMA, { path: [], where: "key" }, present);
    expect(s.map((x) => x.label)).not.toContain("tax_registration_code");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/bodyview/completion.test.ts`
Expected: FAIL — labels/insertText currently use camelCase (`taxRegistrationCode`), and `descendSchema(["billing_address"])` returns `null` (only camelCase matches today).

- [ ] **Step 3: Write minimal implementation**

In `src/features/bodyview/completion.ts`, add the helper import near the top (after the existing imports):

```ts
import { bodyFieldKey, matchesField, fieldPresent } from "./fieldName";
```

Edit `descendSchema` (the `node.fields.find` at ~line 220):

```ts
    const field = node.fields.find((fl) => matchesField(fl, path[i]));
```

Edit `buildKeySuggestions` — the oneof-taken loop (~line 313):

```ts
    if (fl.oneof_group && fieldPresent(fl, presentKeys)) takenOneofs.add(fl.oneof_group);
```

Edit the same function's filter + map (~lines 316-325) to use the helpers:

```ts
  return d.node.fields
    .filter(
      (field) =>
        !fieldPresent(field, presentKeys) &&
        (!field.oneof_group || !takenOneofs.has(field.oneof_group)),
    )
    .map((field, i) => ({
      label: bodyFieldKey(field),
      detail: field.type_label,
      insertText: `"${bodyFieldKey(field)}": ${scaffold(field)}`,
      kind: keyKind(field),
      isSnippet: true,
      // A scalar WKT inserts a complete scalar — no nested level to re-trigger into.
      triggerNext:
        !scalarWktShape(field.message_type) &&
        (field.value_kind === "message" || field.value_kind === "enum"),
      sortText: sortKey(i),
    }));
```

Edit `buildValueSuggestions` — the field lookup by `ctx.valueField` (~line 343). Replace:

```ts
    field = d.node.fields.find((fl) => fl.json_name === ctx.valueField);
```

with (guard the `undefined` valueField, then match both forms):

```ts
    const vf = ctx.valueField;
    field = vf === undefined ? undefined : d.node.fields.find((fl) => matchesField(fl, vf));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/bodyview/completion.test.ts`
Expected: PASS — the new block plus all existing completion tests (their fixtures set `proto_name === json_name`, so labels/matches are unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/features/bodyview/completion.ts src/features/bodyview/completion.test.ts
git commit -m "feat(bodyview): autocomplete emits snake_case, matches both name forms" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Frontend — ghost hint shows snake_case, dedups both forms

**Files:**
- Modify: `src/features/bodyview/ghost.ts` (import + lines ~7 doc, ~29-30, ~54)
- Test: `src/features/bodyview/ghost.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/features/bodyview/ghost.test.ts`, append this describe block at the end of the file (the file already imports `computeGhostLines`, `MessageSchemaIpc`, and defines the `f` helper that supports a `proto_name` override via `extra`):

```ts
describe("computeGhostLines — proto snake_case names", () => {
  const SNAKE: MessageSchemaIpc = {
    root: "t.Req",
    enums: [],
    messages: [
      {
        full_name: "t.Req",
        fields: [f("taxRegistrationCode", "string", "scalar", { proto_name: "tax_registration_code" })],
      },
    ],
  };

  it("renders the hint line with the snake_case proto name", () => {
    expect(computeGhostLines("{\n}", SNAKE)).toEqual({
      afterLine: 1,
      lines: ['  "tax_registration_code": string'],
    });
  });

  it("treats a present camelCase key as satisfying the field (no duplicate hint)", () => {
    expect(computeGhostLines('{\n  "taxRegistrationCode": "x"\n}', SNAKE)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/bodyview/ghost.test.ts`
Expected: FAIL — the hint line currently renders `"taxRegistrationCode"`, and a present camelCase key is NOT recognized (so the ghost still lists the field).

- [ ] **Step 3: Write minimal implementation**

In `src/features/bodyview/ghost.ts`, add the helper import near the top (after the existing imports on line 1-2):

```ts
import { bodyFieldKey, fieldPresent } from "./fieldName";
```

Update the `present`/`missing` computation (currently lines 29-30) to filter non-string keys and use `fieldPresent`:

```ts
  const present = new Set(
    root.childIds
      .map((id) => parsed.tree.nodes[id]?.key)
      .filter((k): k is string => typeof k === "string"),
  );
  const missing = rootMsg.fields.filter((fl) => !fieldPresent(fl, present));
```

Update the rendered ghost line (currently line 54) to write the snake_case key:

```ts
    lines: missing.map((fl) => `  "${bodyFieldKey(fl)}": ${fl.type_label}`),
```

(Optional doc tidy: the `lines` doc comment on line 7 mentions `"jsonName"`; you may update it to `"protoName"` for accuracy.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/bodyview/ghost.test.ts`
Expected: PASS — the new block plus all existing ghost tests (fixtures set `proto_name === json_name`, unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/features/bodyview/ghost.ts src/features/bodyview/ghost.test.ts
git commit -m "feat(bodyview): ghost hint shows snake_case, dedups both name forms" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Frontend — validate recognizes both proto and JSON field names

**Files:**
- Modify: `src/features/bodyview/validate.ts` (import + line ~64)
- Test: `src/features/bodyview/validate.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/features/bodyview/validate.test.ts`, append this test inside the existing `describe("computeUnknownFieldMarkers", ...)` block (the file already imports `computeUnknownFieldMarkers`, `MessageSchemaIpc`, and defines the `f` helper with a `proto_name` override):

```ts
  it("recognizes a known field addressed by its camelCase (proto3-JSON) name", () => {
    const schema: MessageSchemaIpc = {
      root: "t.Req",
      enums: [],
      messages: [
        {
          full_name: "t.Req",
          fields: [f("taxRegistrationCode", "string", "scalar", { proto_name: "tax_registration_code" })],
        },
      ],
    };
    // Legacy body uses camelCase → must NOT be flagged as unknown.
    expect(computeUnknownFieldMarkers('{ "taxRegistrationCode": "x" }', schema)).toEqual([]);
    // The snake_case proto form is also recognized.
    expect(computeUnknownFieldMarkers('{ "tax_registration_code": "x" }', schema)).toEqual([]);
    // A genuinely unknown key still flags.
    const ms = computeUnknownFieldMarkers('{ "bogus": 1 }', schema)!;
    expect(ms).toHaveLength(1);
    expect(ms[0].message).toBe('"bogus" is not a field of t.Req');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/bodyview/validate.test.ts`
Expected: FAIL — `"taxRegistrationCode"` is currently flagged unknown (validate matches only `json_name`, which here is `taxRegistrationCode`... note: this specific fixture's json_name IS camelCase, so the camelCase case passes today, but the `"tax_registration_code"` assert FAILS — the snake form is not recognized). The test fails on the snake_case assertion.

- [ ] **Step 3: Write minimal implementation**

In `src/features/bodyview/validate.ts`, add the helper import near the top (after the existing imports on lines 1-4):

```ts
import { matchesField } from "./fieldName";
```

Change the known-field check (line 64) from:

```ts
    if (d.node.fields.some((fl) => fl.json_name === node.key)) continue;
```

to:

```ts
    if (d.node.fields.some((fl) => matchesField(fl, node.key))) continue;
```

(`node.key` is narrowed to `string` here — the loop already `continue`s on `node.key === null` above.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/bodyview/validate.test.ts`
Expected: PASS — the new test plus all existing validate tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/bodyview/validate.ts src/features/bodyview/validate.test.ts
git commit -m "fix(bodyview): validate recognizes both proto and JSON field names" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Full gate + bindings no-drift

**Files:** none (verification only).

- [ ] **Step 1: Rust workspace tests**

Run: `cargo test --workspace`
Expected: PASS (all core + src-tauri tests, 0 failed).

- [ ] **Step 2: Frontend tests**

Run: `pnpm test`
Expected: PASS (full vitest suite green).

- [ ] **Step 3: Type check**

Run: `pnpm lint`
Expected: PASS (`tsc -b`, no type errors).

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: PASS (`tsc -b && vite build`).

- [ ] **Step 5: Bindings no-drift**

This change does NOT touch any IPC DTO, so `src/ipc/bindings.ts` must not change. Regenerate and confirm no diff:

Run:
```bash
cargo run -p handshaker --bin export-bindings --features export-bindings
git diff --exit-code src/ipc/bindings.ts
```
Expected: `git diff --exit-code` returns 0 (no output, no drift).

- [ ] **Step 6: Manual live pass (WebView2) — record result**

Launch: `pnpm tauri:dev`. Against a service with a multi-word field (e.g. `tax_registration_code`), confirm:
- Request skeleton pre-populates with `tax_registration_code` (snake_case).
- Autocomplete inserts `tax_registration_code`; nested completion works.
- Ghost / Field hints show `"tax_registration_code": <type>`.
- Send succeeds; response viewer shows `tax_registration_code`.
- An older saved request whose body has `taxRegistrationCode` still sends, shows no false "unknown field" marker, and its ghost does not offer a duplicate `tax_registration_code`.

No commit (verification task). If any gate step fails, fix in the relevant task before proceeding.

---

## Self-Review Notes (for the executor)

- **Existing tests stay green:** all current fixtures in `completion.test.ts`, `ghost.test.ts`, `validate.test.ts` set `proto_name === json_name`, and the core response test uses single-word fields — so behavior is identical there. New behavior is exercised only by the added `proto_name !== json_name` cases.
- **No IPC/bindings change:** `FieldNodeIpc` already carries both `json_name` and `proto_name`; Task 7 Step 5 guards against accidental drift.
- **Contract tab untouched:** `proto.ts` already renders `proto_name`; the `json_name` tooltip stays (now a useful hint of the camelCase form).
