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

  // Custom language: JSON with `{{var}}` placeholder highlighting.
  // No JSON diagnostics yet (trade-off acknowledged in Plan #4 spec §7.2);
  // pre-Send `JSON.parse` already validates. Plan #4b may add diagnostics
  // or switch to overlay-decorations.
  monaco.languages.register({ id: "json-with-vars" });

  monaco.languages.setLanguageConfiguration("json-with-vars", {
    brackets: [
      ["{", "}"],
      ["[", "]"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: '"', close: '"' },
    ],
    surroundingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: '"', close: '"' },
    ],
  });

  monaco.languages.setMonarchTokensProvider("json-with-vars", {
    // The `root` state handles top-level JSON syntax. When entering a string
    // (opening quote), we switch to the `@string` state which re-applies the
    // variable rule — this is what lets `{{uid}}` inside `"{{uid}}"` paint as
    // the variable token rather than being swallowed by an atomic string match.
    tokenizer: {
      root: [
        [/\{\{[a-zA-Z_][a-zA-Z0-9_\-]*\}\}/, "variable.template"],
        [/"/, { token: "string.quote", next: "@string" }],
        [/-?\d+(\.\d+)?([eE][+\-]?\d+)?/, "number"],
        [/\b(?:true|false|null)\b/, "keyword"],
        [/[{}\[\],:]/, "delimiter"],
        [/[ \t\r\n]+/, "white"],
      ],
      string: [
        [/\{\{[a-zA-Z_][a-zA-Z0-9_\-]*\}\}/, "variable.template"],
        [/[^"\\{]+/, "string"],
        [/\\./, "string.escape"],
        // A bare `{` not followed by a second `{` is just literal string content.
        [/\{/, "string"],
        [/"/, { token: "string.quote", next: "@pop" }],
      ],
    },
  });

  monaco.editor.defineTheme("handshaker-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "variable.template", foreground: "FACC15", fontStyle: "bold" },
    ],
    colors: {},
  });

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
 * Monaco theme — `handshaker-dark` extends `vs-dark` with a warm-yellow rule
 * for the `variable.template` token used by the `json-with-vars` language.
 * Registered inside the lazy factory above.
 */
export const MONACO_THEME = "handshaker-dark" as const;
