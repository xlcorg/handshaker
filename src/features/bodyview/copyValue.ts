import type { JsonNode } from "./jsonTree";

/** Clipboard text: string unquoted, scalar as-is, container compact JSON. */
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

export const TOAST_SNIPPET_LIMIT = 60;

/** Single-line, length-capped preview of copied text for a confirmation toast. */
export function toastSnippet(text: string, max = TOAST_SNIPPET_LIMIT): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}
