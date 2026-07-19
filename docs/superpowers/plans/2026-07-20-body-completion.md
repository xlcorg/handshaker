# Body Completion — Test the Interface That Ships — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One pure `computeCompletion(fullText, caretOffset, ctx)` is the single home (and test surface) of the body-completion pipeline; Monaco registration and BodyView auto-trigger become pass-through consumers.

**Architecture:** The 110-line `provideCompletionItems` orchestration and BodyView's inline auto-trigger branch collapse into a pure function over `(fullText, caretOffset)` that derives all line/column/word math itself and returns a Monaco-free `BodyCompletion` DTO with a `source` discriminant. Helpers stop being exports (except `descendSchema`, consumed by `validate.ts`). Spec: `docs/superpowers/specs/2026-07-20-body-completion-design.md`.

**Tech Stack:** React 18 + TypeScript, monaco-editor, vitest.

## Global Constraints

- Execute in an isolated worktree branch `claude/body-completion` off `main`. Fresh worktree: `pnpm install` (frontend-only feature — no Rust build needed unless running the full gate's `cargo test`).
- **Bug-for-bug preservation**: interface tests encode current behavior (unterminated string swallows trailing keys; zero var matches fall through to schema completion). Real bugs found during the rewrite are recorded as follow-ups in the plan-file banner, not fixed inline.
- Exports of `src/features/bodyview/completion.ts` after the change: `computeCompletion`, `BodyCompletion`, `BodyCompletionItem`, `registerBodyCompletion`, `setModelSchema`, `setModelVarCandidates`, `descendSchema`, `Descent`. Everything else module-internal; `computeSuggestions` deleted.
- Test-migration rule: 1 meaningful case of a deleted helper test → ≥1 interface case through `computeCompletion`.
- No new user-facing strings (nothing for `src/lib/messages.ts`).
- Gate per task: `pnpm lint` + `pnpm test`. Full gate before merge (CLAUDE.md): + `cargo test --workspace` (untouched, must stay green).
- Commits: Conventional Commits with scope; **no trailers** (`.claude/rules/commit-messages.md`). Branch squashes to one feature commit at merge (`.claude/rules/squashing-feature-branches.md`).

---

### Task 1: Pure core — `computeCompletion` (coexists with old code)

**Files:**
- Modify: `src/features/bodyview/completion.ts` (add position math + DTO + `computeCompletion` after the `buildVarSuggestions` section, ~line 410; touch nothing else)
- Test: `src/features/bodyview/completion.test.ts` (append new describe blocks; do not touch existing ones)

**Interfaces:**
- Consumes (all already in the file): `openVarToken`, `buildVarSuggestions`, `resolveCompletionContext`, `collectPresentKeys`, `buildKeySuggestions`, `buildValueSuggestions`, `insertionColumns`, `separatorAfter`, types `MessageSchemaIpc`, `VarCandidate`.
- Produces:

```ts
export function computeCompletion(
  fullText: string,
  caretOffset: number,
  ctx: { schema: MessageSchemaIpc | null; vars: VarCandidate[] | null },
): BodyCompletion;

export interface BodyCompletion {
  source: "vars" | "schema" | null; // which branch produced items; null = nothing to show
  suggestions: BodyCompletionItem[];
}
export interface BodyCompletionItem {
  label: string;
  detail?: string;
  kind: "field" | "message" | "enum" | "scalar" | "value" | "variable";
  insertText: string;
  sortText?: string;
  filterText?: string;
  isSnippet?: boolean;
  triggerNext?: boolean;
  range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }; // 1-based
}
```

Task 2 rewires the shell and BodyView to exactly these names.

- [ ] **Step 1: Write the failing tests**

Append to `src/features/bodyview/completion.test.ts` (reuses the file's existing `SCHEMA`, `VC`, and `f()` fixtures — do not duplicate them):

```ts
import { computeCompletion } from "./completion"; // add to the existing import list

/** Split "text│text" into (fullText, caretOffset) at the │ marker. */
function at(textWithCaret: string): { fullText: string; caretOffset: number } {
  const caretOffset = textWithCaret.indexOf("│");
  if (caretOffset === -1) throw new Error("test text has no │ caret marker");
  return { fullText: textWithCaret.replace("│", ""), caretOffset };
}

function complete(
  text: string,
  opts: { schema?: typeof SCHEMA | null; vars?: VarCandidate[] | null } = {},
) {
  const { fullText, caretOffset } = at(text);
  return computeCompletion(fullText, caretOffset, {
    schema: opts.schema === undefined ? SCHEMA : opts.schema,
    vars: opts.vars ?? null,
  });
}

describe("computeCompletion — orchestration", () => {
  it("var branch wins when {{ is open and a candidate matches", () => {
    const r = complete('{ "title": "{{ho│" }', { vars: VC });
    expect(r.source).toBe("vars");
    expect(r.suggestions.map((s) => s.label)).toContain("host");
    // `{{` sits at offset 12; range covers just-after-`{{` (col 15) → caret (col 17).
    expect(r.suggestions[0].range).toEqual({
      startLineNumber: 1, startColumn: 15, endLineNumber: 1, endColumn: 17,
    });
  });

  it("var insertText appends }} unless a closing }} is already ahead", () => {
    const open = complete('{ "t": "{{ho│" }', { vars: VC });
    expect(open.suggestions[0].insertText.endsWith("}}")).toBe(true);
    const closed = complete('{ "t": "{{ho│}}" }', { vars: VC });
    expect(closed.suggestions[0].insertText.endsWith("}}")).toBe(false);
  });

  it("zero var matches falls through to schema completion", () => {
    const r = complete('{ "{{zzz│ }', { vars: VC });
    expect(r.source).toBe("schema"); // stray {{ is not a var context; keys still offered
    expect(r.suggestions.map((s) => s.label)).toContain("title");
  });

  it("no schema and no vars → source null, no suggestions", () => {
    const r = complete("{ │ }", { schema: null });
    expect(r).toEqual({ source: null, suggestions: [] });
  });

  it("insideString: quoted filterText and range extended over the quotes", () => {
    const r = complete('{ "ti│" }');
    const title = r.suggestions.find((s) => s.label === "title")!;
    expect(title.filterText).toBe('"title"');
    // Word ti = cols 4-6; insertionColumns extends over both quotes → 3..7.
    expect(title.range).toEqual({
      startLineNumber: 1, startColumn: 3, endLineNumber: 1, endColumn: 7,
    });
  });

  it("keyOnly when a colon is already ahead: bare quoted key, no snippet, no re-trigger", () => {
    // Bare key typed in front of an existing `:` — only the quoted key is inserted.
    const r = complete("{ ad│: {} }");
    const addr = r.suggestions.find((s) => s.label === "addr")!;
    expect(addr.insertText).toBe('"addr"');
    expect(addr.isSnippet).toBeFalsy();
    expect(addr.triggerNext).toBeFalsy();
  });

  it("separator comma when another property follows the replaced range", () => {
    const r = complete('{\n  │\n  "done": true\n}');
    const title = r.suggestions.find((s) => s.label === "title")!;
    expect(title.insertText.endsWith(",")).toBe(true);
    expect(title.range.startLineNumber).toBe(2); // multi-line position math
  });

  it("no separator before a closing brace", () => {
    const r = complete("{ │ }");
    const title = r.suggestions.find((s) => s.label === "title")!;
    expect(title.insertText.endsWith(",")).toBe(false);
  });

  it("value context: enum values as plain (non-snippet) inserts", () => {
    const r = complete('{ "status": │ }');
    expect(r.source).toBe("schema");
    expect(r.suggestions.map((s) => s.label)).toEqual(["UNKNOWN", "ACTIVE"]);
    expect(r.suggestions[0].insertText).toBe('"UNKNOWN"');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/features/bodyview/completion.test.ts`
Expected: FAIL — `computeCompletion` is not exported.

- [ ] **Step 3: Implement**

In `src/features/bodyview/completion.ts`, after the `buildVarSuggestions` section (before the "Monaco glue" banner), add:

```ts
// ---------------------------------------------------------------------------
// The deep interface: pure body completion over (fullText, caretOffset).
// Monaco registration and the BodyView auto-trigger are pass-through consumers.
// ---------------------------------------------------------------------------

export interface BodyCompletionItem {
  label: string;
  detail?: string;
  kind: Suggestion["kind"];
  insertText: string;
  sortText?: string;
  /** insideString: quoted so Monaco's filter matches past the opening `"`. */
  filterText?: string;
  isSnippet?: boolean;
  /** Re-trigger suggest after accepting (next nesting level). */
  triggerNext?: boolean;
  /** 1-based, Monaco convention. */
  range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
}

export interface BodyCompletion {
  /** Which branch produced the items; null = nothing to show. */
  source: "vars" | "schema" | null;
  suggestions: BodyCompletionItem[];
}

/** Monaco's usual word separators (default wordPattern equivalent). */
const WORD_SEPARATORS = new Set("`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/?".split(""));

interface TextPos {
  lineNumber: number;
  column: number;
  lineStartOffset: number;
  lineContent: string;
}

/** Offset → 1-based line/column plus the line's text. LF line endings (Monaco
 *  bodies are LF; a stray `\r` stays in lineContent, harmless for JSON). */
function positionAt(fullText: string, offset: number): TextPos {
  let lineStart = 0;
  let lineNumber = 1;
  for (let i = 0; i < offset; i++) {
    if (fullText[i] === "\n") {
      lineStart = i + 1;
      lineNumber += 1;
    }
  }
  const nextNl = fullText.indexOf("\n", lineStart);
  const lineContent = fullText.slice(lineStart, nextNl === -1 ? fullText.length : nextNl);
  return { lineNumber, column: offset - lineStart + 1, lineStartOffset: lineStart, lineContent };
}

/** `getWordUntilPosition` equivalent: the run of non-separator, non-whitespace
 *  chars ending at `column` (endColumn = the caret column, Monaco convention). */
function wordUntil(lineContent: string, column: number): { startColumn: number; endColumn: number } {
  let start = column;
  while (start > 1) {
    const ch = lineContent[start - 2];
    if (ch === undefined || WORD_SEPARATORS.has(ch) || /\s/.test(ch)) break;
    start -= 1;
  }
  return { startColumn: start, endColumn: column };
}

/** The pure answer to "what does the suggest widget show at this caret". */
export function computeCompletion(
  fullText: string,
  caretOffset: number,
  ctx: { schema: MessageSchemaIpc | null; vars: VarCandidate[] | null },
): BodyCompletion {
  const textBefore = fullText.slice(0, caretOffset);
  const pos = positionAt(fullText, caretOffset);

  // --- variable completion (works without a schema) -----------------------
  const tok = openVarToken(textBefore);
  if (tok && ctx.vars && ctx.vars.length > 0) {
    // Range covers the whole partial (offset after `{{` → caret), so dotted
    // names replace correctly instead of duplicating the prefix.
    const start = positionAt(fullText, tok.tokenStart + 2);
    const afterOnLine = pos.lineContent.slice(pos.column - 1);
    const closingAhead = /^\}\}/.test(afterOnLine);
    const items = buildVarSuggestions(ctx.vars, tok.partial, closingAhead);
    if (items.length > 0) {
      const range = {
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: pos.lineNumber,
        endColumn: pos.column,
      };
      return {
        source: "vars",
        suggestions: items.map((s) => ({
          label: s.label,
          detail: s.detail,
          kind: s.kind,
          insertText: s.insertText,
          sortText: s.sortText,
          filterText: s.label,
          range,
        })),
      };
    }
    // Zero matches → not a real var context (e.g. a stray unclosed `{{`); fall
    // through to schema completion below.
  }

  if (!ctx.schema) return { source: null, suggestions: [] };
  const schema = ctx.schema;

  const cctx = resolveCompletionContext(textBefore);
  const items =
    cctx.where === "key"
      ? buildKeySuggestions(schema, cctx, collectPresentKeys(fullText, caretOffset))
      : buildValueSuggestions(schema, cctx);
  if (items.length === 0) return { source: null, suggestions: [] };

  const word = wordUntil(pos.lineContent, pos.column);
  const cols = insertionColumns(pos.lineContent, word.startColumn, word.endColumn);
  const range = {
    startLineNumber: pos.lineNumber,
    endLineNumber: pos.lineNumber,
    startColumn: cols.startColumn,
    endColumn: cols.endColumn,
  };
  const afterCaretOnLine = pos.lineContent.slice(pos.column - 1);
  // When a key is completed but a value already follows, insert only the quoted key.
  const keyOnly = cctx.where === "key" && /^\s*:/.test(afterCaretOnLine);
  // Separator comma when the next token after the replaced range is another
  // property/value (VS Code parity). Not for key-only inserts — a `:` follows.
  const sep = separatorAfter(fullText.slice(pos.lineStartOffset + cols.endColumn - 1));
  // When the caret is inside a string, `insertionColumns` extended the range left
  // over the opening `"`. Monaco then filters suggestions against the leading text
  // INCLUDING that quote (e.g. `"ti`), so a bare label like `title` matches nothing
  // and the widget shows "No suggestions". Give those items a quoted `filterText`
  // so the leading quote matches. (Outside a string we keep the default label.)
  const insideString = cols.startColumn < word.startColumn;

  return {
    source: "schema",
    suggestions: items.map((s) => {
      const asKeyOnly = keyOnly && s.kind !== "value";
      return {
        label: s.label,
        detail: s.detail,
        kind: s.kind,
        insertText: asKeyOnly ? `"${s.label}"` : s.insertText + sep,
        sortText: s.sortText,
        filterText: insideString ? `"${s.label}"` : undefined,
        isSnippet: s.isSnippet && !asKeyOnly,
        triggerNext: s.triggerNext && !asKeyOnly,
        range,
      };
    }),
  };
}
```

Do NOT modify `registerBodyCompletion`, BodyView, or any export in this task.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/features/bodyview/completion.test.ts`
Expected: PASS — all new `computeCompletion — orchestration` cases AND every pre-existing describe (old code untouched). Then `pnpm lint` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/bodyview/completion.ts src/features/bodyview/completion.test.ts
git commit -m "feat(bodyview): computeCompletion — pure body-completion pipeline"
```

---

### Task 2: Shell + BodyView ride the interface; helpers go internal; tests migrate

**Files:**
- Modify: `src/features/bodyview/completion.ts` (rewrite `registerBodyCompletion` ~line 501-609; delete `computeSuggestions` ~line 378-387; delete `colonAlreadyAhead` ~line 449-458; remove `export` keywords)
- Modify: `src/features/bodyview/BodyView.tsx` (imports line 14; auto-trigger block ~line 285-307)
- Modify: `src/features/bodyview/completion.test.ts` (port helper describes to interface level)

**Interfaces:**
- Consumes: `computeCompletion`, `BodyCompletion` (Task 1 signatures).
- Produces: final export surface of `completion.ts` = `computeCompletion`, `BodyCompletion`, `BodyCompletionItem`, `registerBodyCompletion`, `setModelSchema`, `setModelVarCandidates`, `descendSchema`, `Descent`.

- [ ] **Step 1: Rewrite the Monaco shell**

Replace the whole `registerBodyCompletion` body with the pass-through (dictionary substitutions only — `kind`, `isSnippet`, `triggerNext`; range verbatim):

```ts
/** Register the request-body completion provider exactly once (called from monaco.ts).
 *  A pass-through shell: all decisions live in `computeCompletion`. */
export function registerBodyCompletion(monaco: typeof Monaco): void {
  monaco.languages.registerCompletionItemProvider("json-with-vars", {
    triggerCharacters: ['"', ":", " ", "{"],
    provideCompletionItems(model, position) {
      const r = computeCompletion(model.getValue(), model.getOffsetAt(position), {
        schema: schemaByModel.get(model) ?? null,
        vars: varsByModel.get(model) ?? null,
      });
      const suggestions: Monaco.languages.CompletionItem[] = r.suggestions.map((s) => ({
        label: s.label,
        detail: s.detail,
        kind: monacoKind(monaco, s.kind),
        insertText: s.insertText,
        sortText: s.sortText,
        filterText: s.filterText,
        insertTextRules: s.isSnippet
          ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
          : undefined,
        range: s.range,
        command: s.triggerNext ? { id: "editor.action.triggerSuggest", title: "" } : undefined,
      }));
      return { suggestions };
    },
  });
}
```

Delete `colonAlreadyAhead` (absorbed into `computeCompletion` in Task 1) and delete `computeSuggestions` entirely.

- [ ] **Step 2: Rewire the BodyView auto-trigger**

In `src/features/bodyview/BodyView.tsx`, replace the handler body (currently `openVarToken`/`filterCandidates` var check + `key !== '"'` gate + `collectPresentKeys`/`computeSuggestions`) with:

```ts
          const model = editor.getModel();
          const pos = editor.getPosition();
          if (!model || !pos) return;
          const r = computeCompletion(model.getValue(), model.getOffsetAt(pos), {
            schema: schemaRef.current ?? null,
            vars: varCandidatesRef.current ?? null,
          });
          // Vars pop on any key inside an open `{{…`; schema keys only on a quote —
          // the `"` gate is BodyView's UI policy, the "is there anything" answer is
          // computeCompletion's.
          if (r.source === "vars" || (key === '"' && r.source === "schema")) {
            editor.trigger("autocomplete", "editor.action.triggerSuggest", {});
          }
```

Update the line-14 import to `import { setModelSchema, computeCompletion, setModelVarCandidates } from "./completion";` and drop `openVarToken`/`filterCandidates` from the `varContext` import if this block was their last use in the file (`pnpm lint` confirms).

- [ ] **Step 3: De-export the helpers**

In `completion.ts`, remove the `export` keyword from: `CompletionContext`, `resolveCompletionContext`, `collectPresentKeys`, `Suggestion`, `buildKeySuggestions`, `buildValueSuggestions`, `buildVarSuggestions`, `insertionColumns`, `separatorAfter`. Keep exported: `descendSchema` + `Descent` (consumed by `validate.ts`), `setModelSchema`, `setModelVarCandidates`, `registerBodyCompletion`, `computeCompletion`, `BodyCompletion`, `BodyCompletionItem`.

- [ ] **Step 4: Migrate the tests**

In `completion.test.ts`, port every meaningful case of these describes to interface level (rule: 1 old case → ≥1 `computeCompletion` case via the `at`/`complete` helpers from Task 1), then delete the old describe: `buildVarSuggestions`, `resolveCompletionContext`, `computeSuggestions`, `collectPresentKeys`, `proto field order (sortText)`, `separatorAfter`, `present-key filtering`, `map value suggestions`, `insertionColumns (quote-aware range)`, `scalar well-known types`, `proto snake_case field names`. Keep `describe("descendSchema")` as-is. Porting examples (the pattern for the rest):

```ts
// was: buildVarSuggestions filters by partial
it("var partial filters candidates case-insensitively", () => {
  const r = complete('{ "u": "{{HO│" }', { vars: VC });
  expect(r.suggestions.map((s) => s.label)).toEqual(["host"]);
});

// was: computeSuggestions "nested path descends the schema"
it("keys inside addr come from t.Address", () => {
  const r = complete('{ "addr": { │ } }');
  expect(r.suggestions.map((s) => s.label)).toEqual(["city", "status"]);
});

// was: collectPresentKeys / present-key filtering
it("present keys are hidden from key suggestions", () => {
  const r = complete('{ "title": "x", │ }');
  expect(r.suggestions.map((s) => s.label)).not.toContain("title");
});
```

Update the `labels` helper (it references `ReturnType<typeof computeSuggestions>`) to take `BodyCompletion` or inline it away. Fix the import list to the new export surface.

- [ ] **Step 5: Run the gate**

Run: `pnpm lint && pnpm test`
Expected: PASS. Lint proves no stale consumer of a de-exported helper anywhere in `src/`.

- [ ] **Step 6: Commit**

```bash
git add src/features/bodyview/completion.ts src/features/bodyview/completion.test.ts src/features/bodyview/BodyView.tsx
git commit -m "feat(bodyview): Monaco shell and auto-trigger ride computeCompletion; helpers go internal"
```

---

### Task 3: Domain term, live verification, finish

**Files:**
- Create: `src/CONTEXT.md`
- Modify: `CONTEXT-MAP.md` (line ~11: the "своего `CONTEXT.md` пока нет" entry)

- [ ] **Step 1: Create `src/CONTEXT.md`** (Russian, matching `src-tauri/CONTEXT.md` style):

```markdown
# Frontend (`src/`) — контекст

React 18 UI. Говорит с ядром только через фасад `src/ipc/client.ts`
(единственный потребитель генерируемого `src/ipc/bindings.ts`).

## Language

**Body completion**:
Чистый ответ на вопрос «что покажет suggest-виджет в этой позиции тела запроса» —
`computeCompletion(fullText, caretOffset, {schema, vars})` в
`src/features/bodyview/completion.ts`. Единственный дом ветвления var-vs-schema,
range-математики и правил вставки; Monaco-регистрация и auto-trigger в BodyView —
только потребители (`source: "vars" | "schema" | null`).
_Avoid_: повторная реализация ветвления в провайдере или обработчиках клавиш.
```

- [ ] **Step 2: Link it from `CONTEXT-MAP.md`** — replace the "Frontend … своего `CONTEXT.md` пока нет" line with:

```markdown
- [Frontend](./src/CONTEXT.md) — React 18 UI; фасад `src/ipc/client.ts`
```

- [ ] **Step 3: Commit**

```bash
git add src/CONTEXT.md CONTEXT-MAP.md
git commit -m "docs(context): frontend CONTEXT.md with the Body completion term"
```

- [ ] **Step 4: Live verification**

Run: `pnpm tauri:dev` (never a bare vite/browser). Manually, in a request body with a schema: key suggestions inside `{ }` (proto order, snippets, re-trigger on message fields), typing inside a quoted partial key still matches (insideString), completing before an existing `:` inserts the bare key, completing above another property appends a comma, enum/bool value suggestions after `:`, and `{{` pops variable candidates on any key. Behavior identical to pre-refactor.

- [ ] **Step 5: Mark done + hand off to merge flow**

Update the spec banner (`docs/superpowers/specs/2026-07-20-body-completion-design.md`) to `🎉 DONE`; run the full gate (`pnpm lint` + `pnpm test` + `cargo test --workspace`); then follow `superpowers:finishing-a-development-branch` — squash to **one** feature commit, ff-merge to `main`, archive plan+spec per `.claude/rules/archiving-completed-work.md` (rotate the CLAUDE.md "Active work" entry, update memory).
