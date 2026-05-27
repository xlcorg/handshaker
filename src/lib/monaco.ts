import { lazy } from "react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import loader from "@monaco-editor/loader";

/**
 * Bundle Monaco locally — no CDN dependency. Desktop apps need to work offline.
 *
 * We register `self.MonacoEnvironment` BEFORE `loader.config({ monaco })` so the
 * Monaco instance we pass to the loader already knows how to spawn its workers
 * when consumers mount `<MonacoEditor>`. Both are synchronous top-level
 * statements — order is preserved.
 *
 * Workers we ship: editor (required) + json (request/response are JSON).
 * We deliberately skip ts/css/html/* workers — they aren't used and would
 * bloat the bundle.
 */
self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === "json") return new jsonWorker();
    return new editorWorker();
  },
};
loader.config({ monaco });

/**
 * Lazy-loaded Monaco editor. Initial app bundle stays small; the first render
 * of `<MonacoEditor>` pulls in the ~4MB Monaco core + json worker on demand.
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
 * Monaco theme — `vs-dark` fits the shadcn new-york OKLCH dark palette closely
 * enough for MVP. Custom theme registration is a separate sub-plan.
 */
export const MONACO_THEME = "vs-dark" as const;
