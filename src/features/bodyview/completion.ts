import type { MessageSchemaIpc, MessageNodeIpc, FieldNodeIpc } from "@/ipc/bindings";

// ---------------------------------------------------------------------------
// Cursor context — a schema-blind scanner over the text before the cursor.
// ---------------------------------------------------------------------------

export interface CompletionContext {
  /** Literal object keys from root to the enclosing object (array frames add nothing). */
  path: string[];
  where: "key" | "value";
  /** When where==="value": the literal json key whose value we're typing. */
  valueField?: string;
}

interface Frame {
  type: "object" | "array";
  /** The key that opened this container (null at root or inside an array). */
  openKey: string | null;
}

/**
 * Resolve the JSON cursor context from the text *before* the cursor. The JSON is
 * typically incomplete/invalid mid-typing, so this is a lenient char scanner, not a
 * parser. It never throws.
 */
export function resolveCompletionContext(text: string): CompletionContext {
  const stack: Frame[] = [];
  let pendingKey: string | null = null;
  let afterColon = false;
  let lastString: string | null = null;

  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      // Scan a string literal; handle escapes.
      let j = i + 1;
      let buf = "";
      let terminated = false;
      while (j < n) {
        const d = text[j];
        if (d === "\\") {
          buf += text[j + 1] ?? "";
          j += 2;
          continue;
        }
        if (d === '"') {
          terminated = true;
          j += 1;
          break;
        }
        buf += d;
        j += 1;
      }
      if (!terminated) {
        // Cursor is inside this (unterminated) string — it's the token being typed.
        // Context is whatever the state was BEFORE it; stop scanning.
        break;
      }
      lastString = buf;
      i = j;
      continue;
    }

    switch (c) {
      case "{":
        stack.push({ type: "object", openKey: pendingKey });
        pendingKey = null;
        afterColon = false;
        lastString = null;
        break;
      case "[":
        stack.push({ type: "array", openKey: pendingKey });
        pendingKey = null;
        afterColon = false;
        lastString = null;
        break;
      case "}":
      case "]":
        stack.pop();
        pendingKey = null;
        afterColon = false;
        lastString = null;
        break;
      case ":":
        if (stack.length && stack[stack.length - 1].type === "object") {
          pendingKey = lastString;
          afterColon = true;
        }
        break;
      case ",":
        pendingKey = null;
        afterColon = false;
        lastString = null;
        break;
      default:
        break; // whitespace, digits, unquoted literal chars (true/false/null/numbers)
    }
    i += 1;
  }

  const top = stack[stack.length - 1];
  const pathKeys = stack.map((fr) => fr.openKey).filter((k): k is string => k !== null);

  if (!top) return { path: [], where: "key" };

  if (top.type === "array") {
    // Element/value slot; the value's owner is the array's key, owned by its parent.
    const valueField = pathKeys[pathKeys.length - 1];
    return { path: pathKeys.slice(0, -1), where: "value", valueField };
  }
  if (afterColon) {
    return { path: pathKeys, where: "value", valueField: pendingKey ?? undefined };
  }
  return { path: pathKeys, where: "key" };
}

// ---------------------------------------------------------------------------
// Schema descent.
// ---------------------------------------------------------------------------

export type Descent =
  | { kind: "message"; node: MessageNodeIpc }
  | { kind: "map"; field: FieldNodeIpc }
  | null;

export function descendSchema(schema: MessageSchemaIpc, path: string[]): Descent {
  const byName = (name: string) => schema.messages.find((m) => m.full_name === name) ?? null;
  let node = byName(schema.root);
  if (!node) return null;

  let i = 0;
  while (i < path.length) {
    const field = node.fields.find((fl) => fl.json_name === path[i]);
    if (!field) return null;
    if (field.value_kind === "map") {
      if (i + 1 >= path.length) return { kind: "map", field };
      if (!field.message_type) return null; // scalar/enum-valued map → nothing to descend
      const next = byName(field.message_type);
      if (!next) return null;
      node = next;
      i += 2; // consume the map field AND the arbitrary map key
    } else {
      if (!field.message_type) return null; // scalar/enum field → can't descend
      const next = byName(field.message_type);
      if (!next) return null;
      node = next;
      i += 1;
    }
  }
  return { kind: "message", node };
}

// ---------------------------------------------------------------------------
// Suggestion builders (Monaco-agnostic).
// ---------------------------------------------------------------------------

export interface Suggestion {
  label: string;
  detail?: string;
  insertText: string;
  kind: "field" | "message" | "enum" | "scalar" | "value";
  isSnippet?: boolean;
  /** Ask Monaco to re-trigger suggestions after accepting (next nesting level). */
  triggerNext?: boolean;
}

const NUMBER_LABELS = new Set([
  "double", "float", "int32", "int64", "uint32", "uint64",
  "sint32", "sint64", "fixed32", "fixed64", "sfixed32", "sfixed64",
]);

/** snippet body inserted after `"jsonName": ` for a key suggestion. */
function scaffold(field: FieldNodeIpc): string {
  if (field.repeated) return "[$0]";
  switch (field.value_kind) {
    case "message":
    case "map":
      return "{\n\t$0\n}";
    case "enum":
      return '"$0"';
    case "scalar":
    default:
      if (field.type_label === "bool") return "${1:false}";
      if (NUMBER_LABELS.has(field.type_label)) return "${1:0}";
      return '"$0"'; // string / bytes
  }
}

function keyKind(field: FieldNodeIpc): Suggestion["kind"] {
  switch (field.value_kind) {
    case "message":
    case "map":
      return "message";
    case "enum":
      return "enum";
    default:
      return "field";
  }
}

export function buildKeySuggestions(schema: MessageSchemaIpc, ctx: CompletionContext): Suggestion[] {
  const d = descendSchema(schema, ctx.path);
  if (!d || d.kind === "map") return []; // unknown path, or arbitrary map keys
  return d.node.fields.map((field) => ({
    label: field.json_name,
    detail: field.type_label,
    insertText: `"${field.json_name}": ${scaffold(field)}`,
    kind: keyKind(field),
    isSnippet: true,
    triggerNext: field.value_kind === "message" || field.value_kind === "enum",
  }));
}

export function buildValueSuggestions(schema: MessageSchemaIpc, ctx: CompletionContext): Suggestion[] {
  const d = descendSchema(schema, ctx.path);
  if (!d) return [];

  let field: FieldNodeIpc | undefined;
  if (d.kind === "map") {
    field = d.field; // value type of the map
  } else {
    field = d.node.fields.find((fl) => fl.json_name === ctx.valueField);
  }
  if (!field) return [];

  if (field.enum_type) {
    const enumType = field.enum_type;
    const en = schema.enums.find((e) => e.full_name === enumType);
    if (!en) return [];
    return en.values.map((v) => ({ label: v, insertText: `"${v}"`, kind: "value" as const }));
  }
  // Bool suggestions only for non-map singular/repeated bool (map-value bool is niche).
  if (d.kind === "message" && (field.type_label === "bool" || field.type_label === "repeated bool")) {
    return [
      { label: "true", insertText: "true", kind: "value" },
      { label: "false", insertText: "false", kind: "value" },
    ];
  }
  return [];
}

/** Full pipeline: text-before-cursor → suggestions. The Monaco provider wraps this. */
export function computeSuggestions(schema: MessageSchemaIpc, textBefore: string): Suggestion[] {
  const ctx = resolveCompletionContext(textBefore);
  return ctx.where === "key"
    ? buildKeySuggestions(schema, ctx)
    : buildValueSuggestions(schema, ctx);
}
