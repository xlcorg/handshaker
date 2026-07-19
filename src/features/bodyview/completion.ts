import type { MessageSchemaIpc, MessageNodeIpc, FieldNodeIpc } from "@/ipc/bindings";
import type * as Monaco from "monaco-editor";
import { scalarWktShape } from "@/lib/wellKnown";
import { filterCandidates, openVarToken } from "@/features/vars/varContext";
import type { VarCandidate } from "@/features/vars/candidates";
import { bodyFieldKey, matchesField, fieldPresent } from "./fieldName";

// ---------------------------------------------------------------------------
// Cursor context — a schema-blind scanner over the text before the cursor.
// ---------------------------------------------------------------------------

interface CompletionContext {
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
function resolveCompletionContext(text: string): CompletionContext {
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
function collectPresentKeys(text: string, caret: number): ReadonlySet<string> {
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
    const field = node.fields.find((fl) => matchesField(fl, path[i]));
    if (!field) return null;
    if (field.value_kind === "map") {
      if (i + 1 >= path.length) return { kind: "map", field };
      // A map whose value is a scalar WKT has no descendable structure.
      if (scalarWktShape(field.message_type)) return null;
      if (!field.message_type) return null; // scalar/enum-valued map → nothing to descend
      const next = byName(field.message_type);
      if (!next) return null;
      node = next;
      i += 2; // consume the map field AND the arbitrary map key
    } else {
      // Scalar well-known types are leaves — never descend into the wrapper.
      if (scalarWktShape(field.message_type)) return null;
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

interface Suggestion {
  label: string;
  detail?: string;
  insertText: string;
  kind: "field" | "message" | "enum" | "scalar" | "value" | "variable";
  isSnippet?: boolean;
  /** Ask Monaco to re-trigger suggestions after accepting (next nesting level). */
  triggerNext?: boolean;
  /** Keeps the widget in proto declaration order (Monaco defaults to alphabetical),
   *  matching the ghost skeleton and the contract panel. */
  sortText?: string;
}

/** Zero-padded index → Monaco sortText (string compare). */
const sortKey = (i: number) => String(i).padStart(4, "0");

const NUMBER_LABELS = new Set([
  "double", "float", "int32", "int64", "uint32", "uint64",
  "sint32", "sint64", "fixed32", "fixed64", "sfixed32", "sfixed64",
]);

/** snippet body inserted after `"jsonName": ` for a key suggestion. */
function scaffold(field: FieldNodeIpc): string {
  if (field.repeated) return "[$0]";
  // Scalar well-known types insert a bare proto3-JSON scalar, not a `{…}` message.
  const wkt = scalarWktShape(field.message_type);
  if (wkt) return wkt === "bool" ? "${1:false}" : wkt === "number" ? "${1:0}" : '"$0"';
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
  if (scalarWktShape(field.message_type)) return "field";
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

function buildKeySuggestions(
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
    if (fl.oneof_group && fieldPresent(fl, presentKeys)) takenOneofs.add(fl.oneof_group);
  }
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
}

function buildValueSuggestions(schema: MessageSchemaIpc, ctx: CompletionContext): Suggestion[] {
  const d = descendSchema(schema, ctx.path);
  if (!d) return [];

  let field: FieldNodeIpc | undefined;
  if (d.kind === "map") {
    field = d.field; // value type of the map
  } else {
    const vf = ctx.valueField;
    field = vf === undefined ? undefined : d.node.fields.find((fl) => matchesField(fl, vf));
  }
  if (!field) return [];

  if (field.enum_type) {
    const enumType = field.enum_type;
    const en = schema.enums.find((e) => e.full_name === enumType);
    if (!en) return [];
    return en.values.map((v, i) => ({
      label: v.name,
      insertText: `"${v.name}"`,
      kind: "value" as const,
      sortText: sortKey(i),
    }));
  }
  // Bool suggestions only for non-map singular/repeated bool (map-value bool is niche).
  if (
    d.kind === "message" &&
    (field.type_label === "bool" ||
      field.type_label === "repeated bool" ||
      scalarWktShape(field.message_type) === "bool")
  ) {
    return [
      { label: "true", insertText: "true", kind: "value" },
      { label: "false", insertText: "false", kind: "value" },
    ];
  }
  return [];
}

/** Human detail line for a var suggestion: "<value> · <origin>[ (overrides)]". */
function varDetail(c: VarCandidate): string {
  const origin = c.overrides ? "env (overrides)" : c.origin;
  return c.value ? `${c.value} · ${origin}` : origin;
}

/** Variable-name suggestions for an open `{{` token. `closingAhead` = `}}` already
 *  immediately follows the caret (skip appending it). */
function buildVarSuggestions(
  candidates: VarCandidate[],
  partial: string,
  closingAhead: boolean,
): Suggestion[] {
  return filterCandidates(candidates, partial).map((c, i) => ({
    label: c.name,
    detail: varDetail(c),
    insertText: closingAhead ? c.name : `${c.name}}}`,
    kind: "variable" as const,
    sortText: sortKey(i),
  }));
}

// ---------------------------------------------------------------------------
// The deep interface: pure body completion over (fullText, caretOffset).
// Monaco registration and the BodyView auto-trigger are pass-through consumers.
// ---------------------------------------------------------------------------

export interface BodyCompletionItem {
  label: string;
  detail?: string;
  kind: Suggestion["kind"];
  insertText: string;
  sortText?: string;
  /** insideString: quoted so Monaco's filter matches past the opening `"`. */
  filterText?: string;
  isSnippet?: boolean;
  /** Re-trigger suggest after accepting (next nesting level). */
  triggerNext?: boolean;
  /** 1-based, Monaco convention. */
  range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
}

export interface BodyCompletion {
  /** Which branch produced the items; null = nothing to show. */
  source: "vars" | "schema" | null;
  suggestions: BodyCompletionItem[];
}

/**
 * Monaco's usual word separators (default wordPattern equivalent). The default
 * pattern's number-literal alternative `(-?\d*\.\d\w*)` is deliberately not
 * reproduced — it only changes the replace-range around decimal literals, where
 * the widget's prefix filter rejects every suggestion anyway.
 */
const WORD_SEPARATORS = new Set("`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/?".split(""));

interface TextPos {
  lineNumber: number;
  column: number;
  lineStartOffset: number;
  lineContent: string;
}

/** Offset → 1-based line/column plus the line's text. LF line endings (Monaco
 *  bodies are LF; a stray `\r` stays in lineContent, harmless for JSON). */
function positionAt(fullText: string, offset: number): TextPos {
  let lineStart = 0;
  let lineNumber = 1;
  for (let i = 0; i < offset; i++) {
    if (fullText[i] === "\n") {
      lineStart = i + 1;
      lineNumber += 1;
    }
  }
  const nextNl = fullText.indexOf("\n", lineStart);
  const lineContent = fullText.slice(lineStart, nextNl === -1 ? fullText.length : nextNl);
  return { lineNumber, column: offset - lineStart + 1, lineStartOffset: lineStart, lineContent };
}

/** `getWordUntilPosition` equivalent: the run of non-separator, non-whitespace
 *  chars ending at `column` (endColumn = the caret column, Monaco convention). */
function wordUntil(lineContent: string, column: number): { startColumn: number; endColumn: number } {
  let start = column;
  while (start > 1) {
    const ch = lineContent[start - 2];
    if (ch === undefined || WORD_SEPARATORS.has(ch) || /\s/.test(ch)) break;
    start -= 1;
  }
  return { startColumn: start, endColumn: column };
}

/** The pure answer to "what does the suggest widget show at this caret". */
export function computeCompletion(
  fullText: string,
  caretOffset: number,
  ctx: { schema: MessageSchemaIpc | null; vars: VarCandidate[] | null },
): BodyCompletion {
  const textBefore = fullText.slice(0, caretOffset);
  const pos = positionAt(fullText, caretOffset);

  // --- variable completion (works without a schema) -----------------------
  const tok = openVarToken(textBefore);
  if (tok && ctx.vars && ctx.vars.length > 0) {
    // Range covers the whole partial (offset after `{{` → caret), so dotted
    // names replace correctly instead of duplicating the prefix.
    const start = positionAt(fullText, tok.tokenStart + 2);
    const afterOnLine = pos.lineContent.slice(pos.column - 1);
    const closingAhead = /^\}\}/.test(afterOnLine);
    const items = buildVarSuggestions(ctx.vars, tok.partial, closingAhead);
    if (items.length > 0) {
      const range = {
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: pos.lineNumber,
        endColumn: pos.column,
      };
      return {
        source: "vars",
        suggestions: items.map((s) => ({
          label: s.label,
          detail: s.detail,
          kind: s.kind,
          insertText: s.insertText,
          sortText: s.sortText,
          filterText: s.label,
          range,
        })),
      };
    }
    // Zero matches → not a real var context (e.g. a stray unclosed `{{`); fall
    // through to schema completion below.
  }

  if (!ctx.schema) return { source: null, suggestions: [] };
  const schema = ctx.schema;

  const cctx = resolveCompletionContext(textBefore);
  const items =
    cctx.where === "key"
      ? buildKeySuggestions(schema, cctx, collectPresentKeys(fullText, caretOffset))
      : buildValueSuggestions(schema, cctx);
  if (items.length === 0) return { source: null, suggestions: [] };

  const word = wordUntil(pos.lineContent, pos.column);
  const cols = insertionColumns(pos.lineContent, word.startColumn, word.endColumn);
  const range = {
    startLineNumber: pos.lineNumber,
    endLineNumber: pos.lineNumber,
    startColumn: cols.startColumn,
    endColumn: cols.endColumn,
  };
  const afterCaretOnLine = pos.lineContent.slice(pos.column - 1);
  // When a key is completed but a value already follows, insert only the quoted key.
  const keyOnly = cctx.where === "key" && /^\s*:/.test(afterCaretOnLine);
  // Separator comma when the next token after the replaced range is another
  // property/value (VS Code parity). Not for key-only inserts — a `:` follows.
  const sep = separatorAfter(fullText.slice(pos.lineStartOffset + cols.endColumn - 1));
  // When the caret is inside a string, `insertionColumns` extended the range left
  // over the opening `"`. Monaco then filters suggestions against the leading text
  // INCLUDING that quote (e.g. `"ti`), so a bare label like `title` matches nothing
  // and the widget shows "No suggestions". Give those items a quoted `filterText`
  // so the leading quote matches. (Outside a string we keep the default label.)
  const insideString = cols.startColumn < word.startColumn;

  return {
    source: "schema",
    suggestions: items.map((s) => {
      const asKeyOnly = keyOnly && s.kind !== "value";
      return {
        label: s.label,
        detail: s.detail,
        kind: s.kind,
        insertText: asKeyOnly ? `"${s.label}"` : s.insertText + sep,
        sortText: s.sortText,
        filterText: insideString ? `"${s.label}"` : undefined,
        isSnippet: s.isSnippet && !asKeyOnly,
        triggerNext: s.triggerNext && !asKeyOnly,
        range,
      };
    }),
  };
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

const varsByModel = new WeakMap<Monaco.editor.ITextModel, VarCandidate[]>();

/** Attach (or clear) the var candidates for a model — request body only. */
export function setModelVarCandidates(
  model: Monaco.editor.ITextModel | null,
  candidates: VarCandidate[] | null,
): void {
  if (!model) return;
  if (candidates && candidates.length) varsByModel.set(model, candidates);
  else varsByModel.delete(model);
}

/** Separator to append after an accepted completion, given the text that follows the
 *  replacement range. Mirrors VS Code's `evaluateSeparatorAfter`: another token ahead
 *  (the next property/value) needs a `,`; a closing brace/bracket, an existing comma,
 *  or end-of-text needs nothing. */
function separatorAfter(textAfter: string): "" | "," {
  const next = /\S/.exec(textAfter)?.[0];
  return next === undefined || next === "," || next === "}" || next === "]" ? "" : ",";
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
    case "variable":
      return K.Variable;
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
function insertionColumns(
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

/** Register the request-body completion provider exactly once (called from monaco.ts).
 *  A pass-through shell: all decisions live in `computeCompletion`. */
export function registerBodyCompletion(monaco: typeof Monaco): void {
  monaco.languages.registerCompletionItemProvider("json-with-vars", {
    triggerCharacters: ['"', ":", " ", "{"],
    provideCompletionItems(model, position) {
      const r = computeCompletion(model.getValue(), model.getOffsetAt(position), {
        schema: schemaByModel.get(model) ?? null,
        vars: varsByModel.get(model) ?? null,
      });
      const suggestions: Monaco.languages.CompletionItem[] = r.suggestions.map((s) => ({
        label: s.label,
        detail: s.detail,
        kind: monacoKind(monaco, s.kind),
        insertText: s.insertText,
        sortText: s.sortText,
        filterText: s.filterText,
        insertTextRules: s.isSnippet
          ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
          : undefined,
        range: s.range,
        command: s.triggerNext ? { id: "editor.action.triggerSuggest", title: "" } : undefined,
      }));
      return { suggestions };
    },
  });
}
