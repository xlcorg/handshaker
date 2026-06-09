import { lazy } from "react";
import { registerBodyCompletion } from "@/features/bodyview/completion";

/**
 * Bundle Monaco locally — no CDN dependency. Desktop apps need to work offline.
 *
 * The setup promise starts at MODULE LOAD (not on first <MonacoEditor> mount),
 * so the ~4MB chunk begins downloading as soon as monaco.ts is imported. By
 * the time the user selects a method and React Suspense pulls on MonacoEditor,
 * the resource is typically already ready — no visible "Loading editor…"
 * fallback. main.tsx imports this module eagerly to kick the download off
 * during app boot.
 *
 * Workers we ship: editor (required) + json (request/response are JSON).
 * Other language workers (ts/css/html/...) are NOT requested at runtime —
 * Monaco only spawns workers via the `getWorker(label)` dispatch.
 */
const setupPromise = (async () => {
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

  // Custom language: JSON with `{{var}}` placeholder highlighting + a `key`
  // vs `string` distinction so the design's `--syntax-key` (blue) and
  // `--syntax-str` (green) tokens can be themed separately. Lookahead detects
  // a closing quote followed by `:` (= an object key); without lookahead,
  // Monarch tokenizes left-to-right and can't tell yet.
  monaco.languages.register({ id: "json-with-vars" });
  registerBodyCompletion(monaco);

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
    tokenizer: {
      root: [
        [/\{\{[a-zA-Z_][a-zA-Z0-9_\-]*\}\}/, "variable.template"],
        // Lookahead: opening quote followed by anything-then-quote-then-colon = a key.
        [/"(?=(?:[^"\\]|\\.)*"\s*:)/, { token: "string.key.quote", next: "@stringKey" }],
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
        [/\{/, "string"],
        [/"/, { token: "string.quote", next: "@pop" }],
      ],
      stringKey: [
        [/\{\{[a-zA-Z_][a-zA-Z0-9_\-]*\}\}/, "variable.template"],
        [/[^"\\]+/, "string.key"],
        [/\\./, "string.key.escape"],
        [/"/, { token: "string.key.quote", next: "@pop" }],
      ],
    },
  });

  // Themes — colors mirror the `--syntax-*` HSL tokens declared in globals.css.
  // Hex values are precomputed (HSL→sRGB) so they're stable inside Monaco;
  // if globals.css changes the tokens, update both places.
  monaco.editor.defineTheme("handshaker-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "string.key", foreground: "70A6DB" },
      { token: "string.key.quote", foreground: "70A6DB" },
      { token: "string", foreground: "A0C982" },
      { token: "string.quote", foreground: "A0C982" },
      { token: "string.escape", foreground: "A0C982" },
      { token: "number", foreground: "DBB470" },
      { token: "keyword", foreground: "DBB470" },
      { token: "delimiter", foreground: "737373" },
      { token: "variable.template", foreground: "DBB470", fontStyle: "bold" },
    ],
    colors: {
      "editor.background": "#0A0A0A",
      "editor.foreground": "#FAFAFA",
      "editorLineNumber.foreground": "#737373",
      "editorLineNumber.activeForeground": "#FAFAFA",
      "editor.lineHighlightBackground": "#0A0A0A",
      "editor.lineHighlightBorder": "#0A0A0A",
      "editorGutter.background": "#0A0A0A",
      "editor.selectionBackground": "#FAFAFA26",
      "editorCursor.foreground": "#FAFAFA",
      "editorWidget.background": "#0F0F0F",
      "editorWidget.border": "#262626",
      "scrollbarSlider.background": "#26262680",
      "scrollbarSlider.hoverBackground": "#A3A3A366",
      "scrollbarSlider.activeBackground": "#A3A3A399",
    },
  });

  monaco.editor.defineTheme("handshaker-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "string.key", foreground: "2259A0" },
      { token: "string.key.quote", foreground: "2259A0" },
      { token: "string", foreground: "356E35" },
      { token: "string.quote", foreground: "356E35" },
      { token: "string.escape", foreground: "356E35" },
      { token: "number", foreground: "A5611D" },
      { token: "keyword", foreground: "A5611D" },
      { token: "delimiter", foreground: "8C8C8C" },
      { token: "variable.template", foreground: "A5611D", fontStyle: "bold" },
    ],
    colors: {
      "editor.background": "#FFFFFF",
      "editor.foreground": "#0A0A0A",
      "editorLineNumber.foreground": "#A3A3A3",
      "editorLineNumber.activeForeground": "#0A0A0A",
      "editor.lineHighlightBackground": "#FFFFFF",
      "editor.lineHighlightBorder": "#FFFFFF",
      "editorGutter.background": "#FFFFFF",
      "editor.selectionBackground": "#0A0A0A26",
      "editorCursor.foreground": "#0A0A0A",
      "editorWidget.background": "#FFFFFF",
      "editorWidget.border": "#E5E5E5",
      "scrollbarSlider.background": "#E5E5E580",
      "scrollbarSlider.hoverBackground": "#73737366",
      "scrollbarSlider.activeBackground": "#73737399",
    },
  });

  return reactMod.default;
})();

export const MonacoEditor = lazy(async () => ({ default: await setupPromise }));

export const EDITOR_OPTIONS = {
  fontSize: 12.5,
  fontFamily: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  automaticLayout: true,
  tabSize: 2,
  insertSpaces: true,
  wordWrap: "on",
  lineNumbersMinChars: 3,
  glyphMargin: false,
  folding: false,
  renderLineHighlight: "none",
  guides: { indentation: false },
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
  scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
  padding: { top: 10, bottom: 24 },
} as const;

export const READ_ONLY_OPTIONS = {
  ...EDITOR_OPTIONS,
  readOnly: true,
} as const;

/** Body-view options: folding gutter ON (Postman-style node collapse). */
export const BODY_EDIT_OPTIONS = {
  ...EDITOR_OPTIONS,
  folding: true,
} as const;

export const BODY_READONLY_OPTIONS = {
  ...EDITOR_OPTIONS,
  folding: true,
  readOnly: true,
} as const;

export type ThemeMode = "dark" | "light";

export function monacoThemeFor(theme: ThemeMode): string {
  return theme === "light" ? "handshaker-light" : "handshaker-dark";
}

/** Backwards-compatible default — dark. Prefer `monacoThemeFor(prefs.theme)`. */
export const MONACO_THEME = "handshaker-dark" as const;
