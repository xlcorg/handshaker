import type { MessageSchemaIpc, MessageNodeIpc, FieldNodeIpc } from "@/ipc/bindings";
import type * as Monaco from "monaco-editor";

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

/**
 * Keys already present in the innermost object containing `caret`, excluding the
 * key token the caret sits in — the property being edited must keep completing
 * itself (mirrors VS Code's JSON service, which seeds its `proposed` set with
 * every existing property except `currentProperty`). Lenient full-text scan: an
 * unterminated string swallows the rest of the text, dropping any keys after it
 * (acceptable mid-typing degradation).
 */
export function collectPresentKeys(text: string, caret: number): ReadonlySet<string> {
  interface KeyFrame { type: "object" | "array"; keys: Set<string> }
  const stack: KeyFrame[] = [];
  let caretFrame: KeyFrame | null = null;
  let lastString: string | null = null;
  let caretInLastString = false;

  let i = 0;
  const n = text.length;
  while (i < n) {
    // Strings never push/pop frames, so capturing at the next loop top after a
    // token that spans the caret still snapshots the correct enclosing frame.
    if (caretFrame === null && i >= caret) caretFrame = stack[stack.length - 1] ?? null;
    const c = text[i];
    if (c === '"') {
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
      if (!terminated) break; // mid-typing tail — keys beyond it are lost (lenient)
      lastString = buf;
      caretInLastString = caret > i && caret < j;
      i = j;
      continue;
    }
    switch (c) {
      case "{":
        stack.push({ type: "object", keys: new Set() });
        lastString = null;
        break;
      case "[":
        stack.push({ type: "array", keys: new Set() });
        lastString = null;
        break;
      case "}":
      case "]":
        stack.pop();
        lastString = null;
        break;
      case ":": {
        const top = stack[stack.length - 1];
        if (top?.type === "object" && lastString !== null && !caretInLastString) {
          top.keys.add(lastString);
        }
        break;
      }
      case ",":
        lastString = null;
        break;
      default:
        break;
    }
    i += 1;
  }
  // Caret at/past the end of the text: the innermost still-open frame encloses it.
  if (caretFrame === null) caretFrame = stack[stack.length - 1] ?? null;
  return caretFrame?.type === "object" ? caretFrame.keys : new Set();
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

export function buildKeySuggestions(
  schema: MessageSchemaIpc,
  ctx: CompletionContext,
  presentKeys: ReadonlySet<string> = new Set(),
): Suggestion[] {
  const d = descendSchema(schema, ctx.path);
  if (!d || d.kind === "map") return []; // unknown path, or arbitrary map keys
  // A present member also rules out its oneof siblings — two set members of one
  // oneof are invalid protobuf JSON.
  const takenOneofs = new Set<string>();
  for (const fl of d.node.fields) {
    if (fl.oneof_group && presentKeys.has(fl.json_name)) takenOneofs.add(fl.oneof_group);
  }
  return d.node.fields
    .filter(
      (field) =>
        !presentKeys.has(field.json_name) &&
        (!field.oneof_group || !takenOneofs.has(field.oneof_group)),
    )
    .map((field) => ({
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

/** Full pipeline: text-before-cursor → suggestions. The Monaco provider wraps this.
 *  `presentKeys` (from `collectPresentKeys` over the full text) hides fields the
 *  enclosing object already has; value suggestions ignore it. */
export function computeSuggestions(
  schema: MessageSchemaIpc,
  textBefore: string,
  presentKeys?: ReadonlySet<string>,
): Suggestion[] {
  const ctx = resolveCompletionContext(textBefore);
  return ctx.where === "key"
    ? buildKeySuggestions(schema, ctx, presentKeys)
    : buildValueSuggestions(schema, ctx);
}

// ---------------------------------------------------------------------------
// Monaco glue — a single provider on `json-with-vars`, schema scoped per model.
// ---------------------------------------------------------------------------

const schemaByModel = new WeakMap<Monaco.editor.ITextModel, MessageSchemaIpc>();

/** Attach (or clear) the schema for a given editor model. */
export function setModelSchema(
  model: Monaco.editor.ITextModel | null,
  schema: MessageSchemaIpc | null,
): void {
  if (!model) return;
  if (schema) schemaByModel.set(model, schema);
  else schemaByModel.delete(model);
}

/** Read access for sibling providers (inlay hints) sharing the same model↔schema map.
 *  Returns `undefined` (not `null`) when no schema is attached — WeakMap semantics. */
export function getModelSchema(
  model: Monaco.editor.ITextModel,
): MessageSchemaIpc | undefined {
  return schemaByModel.get(model);
}

/** When a key is completed but a value already follows, insert only the quoted key. */
function colonAlreadyAhead(model: Monaco.editor.ITextModel, position: Monaco.Position): boolean {
  const lineEnd = model.getLineMaxColumn(position.lineNumber);
  const after = model.getValueInRange({
    startLineNumber: position.lineNumber,
    startColumn: position.column,
    endLineNumber: position.lineNumber,
    endColumn: lineEnd,
  });
  return /^\s*:/.test(after);
}

function monacoKind(monaco: typeof Monaco, kind: Suggestion["kind"]): Monaco.languages.CompletionItemKind {
  const K = monaco.languages.CompletionItemKind;
  switch (kind) {
    case "message":
      return K.Struct;
    case "enum":
      return K.Enum;
    case "value":
      return K.EnumMember;
    case "scalar":
      return K.Value;
    default:
      return K.Field;
  }
}

/**
 * Compute the replacement column range for a completion. When the caret sits inside a
 * string literal (an opening `"` immediately precedes the word), expand the range to
 * swallow the surrounding quote(s) so a QUOTED insertText replaces them instead of
 * nesting (which would yield malformed `""VALUE""`). Columns are 1-based (Monaco);
 * `lineContent` is the full line text; `wordStartColumn`/`wordEndColumn` come from
 * `model.getWordUntilPosition`.
 */
export function insertionColumns(
  lineContent: string,
  wordStartColumn: number,
  wordEndColumn: number,
): { startColumn: number; endColumn: number } {
  const before = lineContent[wordStartColumn - 2]; // char just before the word (1-based → -2)
  if (before !== '"') return { startColumn: wordStartColumn, endColumn: wordEndColumn };
  const after = lineContent[wordEndColumn - 1]; // char at the caret / word end
  return {
    startColumn: wordStartColumn - 1,
    endColumn: after === '"' ? wordEndColumn + 1 : wordEndColumn,
  };
}

/** Register the request-body completion provider exactly once (called from monaco.ts). */
export function registerBodyCompletion(monaco: typeof Monaco): void {
  monaco.languages.registerCompletionItemProvider("json-with-vars", {
    triggerCharacters: ['"', ":", " "],
    provideCompletionItems(model, position) {
      const schema = schemaByModel.get(model);
      if (!schema) return { suggestions: [] };

      const textBefore = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      const ctx = resolveCompletionContext(textBefore);
      const items =
        ctx.where === "key"
          ? buildKeySuggestions(
              schema,
              ctx,
              collectPresentKeys(model.getValue(), model.getOffsetAt(position)),
            )
          : buildValueSuggestions(schema, ctx);
      if (items.length === 0) return { suggestions: [] };

      const word = model.getWordUntilPosition(position);
      const lineContent = model.getLineContent(position.lineNumber);
      const cols = insertionColumns(lineContent, word.startColumn, word.endColumn);
      const range: Monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: cols.startColumn,
        endColumn: cols.endColumn,
      };
      const keyOnly = ctx.where === "key" && colonAlreadyAhead(model, position);
      // When the caret is inside a string, `insertionColumns` extended the range left
      // over the opening `"`. Monaco then filters suggestions against the leading text
      // INCLUDING that quote (e.g. `"ti`), so a bare label like `title` matches nothing
      // and the widget shows "No suggestions". Give those items a quoted `filterText`
      // so the leading quote matches. (Outside a string we keep the default label.)
      const insideString = cols.startColumn < word.startColumn;

      const suggestions: Monaco.languages.CompletionItem[] = items.map((s) => {
        const asKeyOnly = keyOnly && s.kind !== "value";
        const insertText = asKeyOnly ? `"${s.label}"` : s.insertText;
        return {
          label: s.label,
          detail: s.detail,
          kind: monacoKind(monaco, s.kind),
          insertText,
          filterText: insideString ? `"${s.label}"` : undefined,
          insertTextRules:
            s.isSnippet && !asKeyOnly
              ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
              : undefined,
          range,
          command:
            s.triggerNext && !asKeyOnly
              ? { id: "editor.action.triggerSuggest", title: "" }
              : undefined,
        };
      });
      return { suggestions };
    },
  });
}
