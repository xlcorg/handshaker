import type { JsonNode, JsonTree } from "./jsonTree";
import type { ValueSpan } from "./spans";
import { elideString } from "./elide";

const INDENT = "  ";

export interface Badge {
  nodeId: string;
  previewStart: number; // offset of the preview value token's first char (the quote)
  previewEnd: number;   // offset just past the preview value token's closing quote
  label: string;
}

export interface RenderResult {
  text: string;
  spans: ValueSpan[];
  badges: Badge[];
}

export function renderJsonTree(tree: JsonTree, expanded: ReadonlySet<string> = new Set()): RenderResult {
  const spans: ValueSpan[] = [];
  const badges: Badge[] = [];
  let out = "";

  const walk = (node: JsonNode, indent: string) => {
    const start = out.length;
    switch (node.kind) {
      case "object": {
        if (node.childCount === 0) { out += "{}"; break; }
        out += "{\n";
        node.childIds.forEach((cid, i) => {
          const child = tree.nodes[cid];
          out += indent + INDENT + JSON.stringify(child.key) + ": ";
          walk(child, indent + INDENT);
          out += i < node.childCount - 1 ? ",\n" : "\n";
        });
        out += indent + "}";
        break;
      }
      case "array": {
        if (node.childCount === 0) { out += "[]"; break; }
        out += "[\n";
        node.childIds.forEach((cid, i) => {
          out += indent + INDENT;
          walk(tree.nodes[cid], indent + INDENT);
          out += i < node.childCount - 1 ? ",\n" : "\n";
        });
        out += indent + "]";
        break;
      }
      case "string": {
        const full = node.value as string;
        const elision = expanded.has(node.id) ? null : elideString(full);
        if (elision) {
          const previewStart = out.length;
          out += JSON.stringify(elision.preview);
          badges.push({ nodeId: node.id, previewStart, previewEnd: out.length, label: elision.label });
        } else {
          out += JSON.stringify(full);
        }
        break;
      }
      case "number":
      case "boolean": out += String(node.value); break;
      case "null": out += "null"; break;
    }
    spans.push({ nodeId: node.id, start, end: out.length });
  };

  if (tree.rootId) walk(tree.nodes[tree.rootId], "");
  return { text: out, spans, badges };
}
