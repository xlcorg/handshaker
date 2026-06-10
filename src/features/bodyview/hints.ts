import type { MessageSchemaIpc, FieldNodeIpc } from "@/ipc/bindings";
import type * as Monaco from "monaco-editor";
import { parseWithSpans } from "./parse";
import { descendSchema, getModelSchema } from "./completion";
import type { JsonNode, JsonTree } from "./jsonTree";

export interface InlayHintItem {
  /** 0-based source offset the hint anchors AFTER (caller converts to a position). */
  offset: number;
  label: string;
}

const ENUM_PREVIEW_MAX = 5;

function hintLabel(schema: MessageSchemaIpc, field: FieldNodeIpc): string {
  if (field.value_kind === "enum" && field.enum_type) {
    const en = schema.enums.find((e) => e.full_name === field.enum_type);
    if (en) {
      const head = en.values.slice(0, ENUM_PREVIEW_MAX).join(" | ");
      const tail = en.values.length > ENUM_PREVIEW_MAX ? " | …" : "";
      const short = field.enum_type.split(".").pop() ?? field.enum_type;
      return `${field.repeated ? "repeated enum" : "enum"} ${short}: ${head}${tail}`;
    }
  }
  return field.type_label;
}

/** Object-key segments from root *down to but not including* this node's own key —
 *  i.e. the path its enclosing context sits at, as `descendSchema` expects.
 *  Array hops (parent.key === null) contribute nothing. */
function pathTo(tree: JsonTree, node: JsonNode): string[] {
  const segs: string[] = [];
  let cur: JsonNode | null = node.parentId ? tree.nodes[node.parentId] ?? null : null;
  while (cur) {
    if (cur.key !== null) segs.unshift(cur.key);
    cur = cur.parentId ? tree.nodes[cur.parentId] ?? null : null;
  }
  return segs;
}

/** One hint per recognized object key: type label anchored after the value's first
 *  token (after `{`/`[` for composites, after the whole token for scalars). */
export function computeInlayHints(text: string, schema: MessageSchemaIpc): InlayHintItem[] {
  const parsed = parseWithSpans(text);
  if (!parsed) return [];
  const spanByNode = new Map(parsed.spans.map((s) => [s.nodeId, s]));
  const out: InlayHintItem[] = [];
  for (const id of parsed.tree.order) {
    const node = parsed.tree.nodes[id];
    if (node.key === null) continue; // root or array element — arrays are hinted via their own node
    const d = descendSchema(schema, pathTo(parsed.tree, node));
    if (!d || d.kind === "map") continue; // unknown path, or arbitrary map-entry keys
    const field = d.node.fields.find((fl) => fl.json_name === node.key);
    if (!field) continue;
    const span = spanByNode.get(id);
    if (!span) continue;
    const offset =
      node.kind === "object" || node.kind === "array" ? span.start + 1 : span.end;
    out.push({ offset, label: hintLabel(schema, field) });
  }
  out.sort((a, b) => a.offset - b.offset);
  return out;
}

// ---------------------------------------------------------------------------
// Monaco glue — provider + refresh emitter.
// ---------------------------------------------------------------------------

let fireHintsChanged: (() => void) | null = null;

/** Nudge Monaco to re-query inlay hints (schema attached/changed on some model).
 *  Plain content edits already refresh hints natively; this covers schema swaps
 *  (method change, late fetch) — the monaco#4700 programmatic-update gotcha. */
export function refreshBodyHints(): void {
  fireHintsChanged?.();
}

/** Register the inlay-hints provider exactly once (called from monaco.ts setup). */
export function registerBodyInlayHints(monaco: typeof Monaco): void {
  const emitter = new monaco.Emitter<void>();
  fireHintsChanged = () => emitter.fire();
  monaco.languages.registerInlayHintsProvider("json-with-vars", {
    onDidChangeInlayHints: emitter.event,
    provideInlayHints(model) {
      const schema = getModelSchema(model);
      if (!schema) return { hints: [], dispose: () => {} };
      const hints = computeInlayHints(model.getValue(), schema).map((h) => ({
        position: model.getPositionAt(h.offset),
        label: h.label,
        kind: monaco.languages.InlayHintKind.Type,
        paddingLeft: true,
      }));
      return { hints, dispose: () => {} };
    },
  });
}
