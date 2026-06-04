import type { JsonNode } from "./jsonTree";

export const PREVIEW_LIMIT = 120;

/** Clipboard text per spec §6: string unquoted, scalar as-is, container compact JSON. */
export function copyTextForNode(node: JsonNode): string {
  switch (node.kind) {
    case "string": return node.value as string;
    case "number":
    case "boolean": return String(node.value);
    case "null": return "null";
    case "object":
    case "array": return JSON.stringify(node.value);
  }
}

/** Inline display preview (truncated). The FULL value is what `copyTextForNode` yields. */
export function valuePreview(node: JsonNode): string {
  switch (node.kind) {
    case "string": {
      const s = node.value as string;
      const body = s.length > PREVIEW_LIMIT ? `${s.slice(0, PREVIEW_LIMIT)}…` : s;
      return `"${body}"`;
    }
    case "number":
    case "boolean": return String(node.value);
    case "null": return "null";
    case "array": return node.childCount === 0 ? "[]" : `[${node.childCount}]`;
    case "object": return node.childCount === 0 ? "{}" : `{${node.childCount}}`;
  }
}

/**
 * JSON literal for a node rendered on a single `leaf` line: scalars and EMPTY containers.
 * (Non-empty containers are rendered with real brackets by `JsonLineView`, not via this.)
 */
export function valueLiteral(node: JsonNode): string {
  switch (node.kind) {
    case "string": {
      const s = node.value as string;
      const body = s.length > PREVIEW_LIMIT ? `${s.slice(0, PREVIEW_LIMIT)}…` : s;
      return `"${body}"`;
    }
    case "number":
    case "boolean":
      return String(node.value);
    case "null":
      return "null";
    case "array":
      return "[]";
    case "object":
      return "{}";
  }
}
