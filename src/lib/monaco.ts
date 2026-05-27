import { lazy } from "react";

/**
 * Bundle Monaco locally — no CDN dependency. Desktop apps need to work offline.
 *
 * All Monaco setup lives inside the lazy factory so the ~4MB core ships as a
 * separate chunk instead of being baked into the initial bundle. The factory
 * runs once on first mount of `<MonacoEditor>`:
 *
 * 1. Dynamic-imports `monaco-editor`, the editor + json workers (via Vite
 *    `?worker`), `@monaco-editor/loader`, and `@monaco-editor/react`.
 * 2. Sets `self.MonacoEnvironment.getWorker` BEFORE configuring the loader,
 *    so Monaco's first internal `getWorker()` call resolves to our locals.
 * 3. Calls `loader.config({ monaco })` to make `@monaco-editor/react` use
 *    the same Monaco instance we just imported.
 * 4. Returns the React wrapper as `default`.
 *
 * Workers we ship: editor (required) + json (request/response are JSON).
 * Other language workers (ts/css/html/...) are NOT requested at runtime —
 * Monaco only spawns workers via the `getWorker(label)` dispatch.
 */
export const MonacoEditor = lazy(async () => {
  const [monaco, editorWorkerMod, jsonWorkerMod, loaderMod, reactMod] =
    await Promise.all([
      import("monaco-editor"),
      import("monaco-editor/esm/vs/editor/editor.worker?worker"),
      import("monaco-editor/esm/vs/language/json/json.worker?worker"),
      import("@monaco-editor/loader"),
      import("@monaco-editor/react"),
    ]);

  self.MonacoEnvironment = {
    getWorker(_workerId, label) {
      if (label === "json") return new jsonWorkerMod.default();
      return new editorWorkerMod.default();
    },
  };
  loaderMod.default.config({ monaco });

  return { default: reactMod.default };
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
