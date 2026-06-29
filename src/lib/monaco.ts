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

  // We own the wordWrap state via the `wordWrap` pref (toggled by our global hotkey
  // — Alt+Z on Win/Linux, ⌥⌘Z on macOS — and the Settings switch). Disable Monaco's
  // built-in Alt+Z (`editor.action.toggleWordWrap`) so it can't independently flip an
  // editor's wrap out of sync with the pref. Critical on macOS: the hotkey there is
  // ⌥⌘Z, so plain ⌥Z now reaches Monaco — unbinding (vs. swallowing) leaves ⌥Z free
  // to type its normal character (Ω) while removing only the rogue toggle.
  monaco.editor.addKeybindingRule({
    keybinding: monaco.KeyMod.Alt | monaco.KeyCode.KeyZ,
    command: null,
  });

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
  // Effective wordWrap is pref-driven: BodyView overrides this per prefs.wordWrap
  // (default off). This base value only matters to any non-BodyView consumer.
  wordWrap: "off",
  lineNumbersMinChars: 3,
  glyphMargin: false,
  folding: false,
  renderLineHighlight: "none",
  // No muted box around the word under the caret on a plain click — Monaco's
  // textual word-highlighter reads as a stray selection in a JSON body editor.
  occurrencesHighlight: "off",
  guides: { indentation: false },
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
  // 14px vertical bar (VS Code default) is a real mouse target; the thin 8px bar
  // was hard to grab on a big response. scrollByPage: clicking the trough pages by
  // a screenful instead of teleporting — jump-anywhere is covered by the minimap.
  scrollbar: { verticalScrollbarSize: 14, horizontalScrollbarSize: 8, scrollByPage: true },
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
  // Postman-style autocomplete: surface completions as you type INSIDE strings.
  // JSON keys and enum values both live in `"..."`, and Monaco suppresses quick
  // suggestions in strings by default — which is why only Ctrl+Space worked. Enabling
  // `strings` also lets the `"` trigger-character fire the widget on quote-open.
  quickSuggestions: { other: true, comments: false, strings: true },
  // Our schema-driven provider is the ONLY intended completion source. Disable Monaco's
  // word-based fallback — otherwise, at a value position where we offer nothing (e.g. a
  // free-form string field), it surfaces existing field KEYS from the document as value
  // suggestions.
  wordBasedSuggestions: "off",
  // Suggest widget matches the editor font (row font here; the `.message`/`.details`
  // elements are pinned in globals.css since this option doesn't reach them).
  suggestFontSize: 12.5,
  suggestLineHeight: 18,
} as const;

export const BODY_READONLY_OPTIONS = {
  ...EDITOR_OPTIONS,
  folding: true,
  readOnly: true,
  // Minimap starts OFF; BodyView (response) flips `enabled` on only when the
  // rendered content overflows the viewport (size-gated, see minimapGate.ts).
  // renderCharacters:false → a clean color-block overview matching the dark theme.
  minimap: { enabled: false, renderCharacters: false },
} as const;

export const MONACO_THEME = "handshaker-dark" as const;
