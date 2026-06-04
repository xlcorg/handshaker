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

export const TOAST_SNIPPET_LIMIT = 60;

/** Single-line, length-capped preview of copied text for a confirmation toast. */
export function toastSnippet(text: string, max = TOAST_SNIPPET_LIMIT): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}
