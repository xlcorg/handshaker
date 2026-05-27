import { lazy } from "react";

/**
 * Lazy-loaded Monaco editor. Initial bundle stays small; the first render of
 * `<MonacoEditor>` pulls in ~3MB of JS on demand.
 *
 * Re-exports `@monaco-editor/react`'s default export under the named `MonacoEditor`.
 */
export const MonacoEditor = lazy(async () => {
  const mod = await import("@monaco-editor/react");
  return { default: mod.default };
});

export const EDITOR_OPTIONS = {
  fontSize: 13,
  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  automaticLayout: true,
  tabSize: 2,
  insertSpaces: true,
  wordWrap: "on",
} as const;

export const READ_ONLY_OPTIONS = {
  ...EDITOR_OPTIONS,
  readOnly: true,
} as const;

/**
 * Monaco theme — `vs-dark` fits the shadcn new-york OKLCH dark palette.
 * (Custom theme registration — separate sub-plan.)
 */
export const MONACO_THEME = "vs-dark" as const;
