import type { MessageSchemaIpc } from "@/ipc/bindings";
import { parseWithSpans, repairTrailingCommas } from "./parse";
import { descendSchema } from "./completion";
import { pathTo } from "./hints";

export interface ContractMarker {
  /** 0-based char offsets of the offending key token (quotes included). */
  start: number;
  end: number;
  message: string;
}

/** Locate the quoted key token preceding a value starting at `valueStart`.
 *  Returns null for exotic keys (escape sequences make the raw token longer than
 *  the unescaped key) — the caller falls back to the value span. */
function keyRangeBefore(
  text: string,
  valueStart: number,
  key: string,
): { start: number; end: number } | null {
  let i = valueStart - 1;
  while (i >= 0 && " \t\r\n".includes(text[i])) i--;
  if (text[i] !== ":") return null;
  i--;
  while (i >= 0 && " \t\r\n".includes(text[i])) i--;
  if (text[i] !== '"') return null;
  const end = i + 1;
  const start = end - key.length - 2;
  return start >= 0 && text.slice(start, end) === `"${key}"` ? { start, end } : null;
}

/** Keys that don't exist in the contract, at every nesting level the schema can
 *  judge. Map values (arbitrary keys) and subtrees of unknown fields are exempt;
 *  values are never validated — they may hold `{{var}}` placeholders that only
 *  resolve at Send. Returns null when the text is unparseable even after the
 *  trailing-comma repair: the caller keeps its previous markers, mirroring
 *  VS Code's stale-diagnostics-while-typing behavior. */
export function computeUnknownFieldMarkers(
  text: string,
  schema: MessageSchemaIpc,
): ContractMarker[] | null {
  const parsed = parseWithSpans(text) ?? parseWithSpans(repairTrailingCommas(text));
  if (!parsed) return null;
  const spanByNode = new Map(parsed.spans.map((s) => [s.nodeId, s]));
  const out: ContractMarker[] = [];
  for (const id of parsed.tree.order) {
    const node = parsed.tree.nodes[id];
    if (node.key === null) continue; // root or array element
    const d = descendSchema(schema, pathTo(parsed.tree, node));
    if (!d || d.kind === "map") continue; // unknown context, or arbitrary map keys
    if (d.node.fields.some((fl) => fl.json_name === node.key)) continue;
    const span = spanByNode.get(id);
    if (!span) continue;
    const range = keyRangeBefore(text, span.start, node.key) ?? { start: span.start, end: span.end };
    out.push({ ...range, message: `"${node.key}" is not a field of ${d.node.full_name}` });
  }
  return out;
}
