# Body completion — test the interface that ships — design

Status: 🎉 DONE (2026-07-20) — implemented, live-verified, merged to `main`.

Candidate 1 from the architecture review: `src/features/bodyview/completion.ts`
has 8 pure helpers, each unit-tested — but the 110-line Monaco
`provideCompletionItems` orchestration that ships (var-vs-schema branch, range
math, keyOnly/`colonAlreadyAhead`, insideString quoting, `separatorAfter`
slice — where every documented bug lived) has zero tests. Two more inline
copies of the same branch logic exist: the provider re-implements
`computeSuggestions` instead of calling it, and BodyView's auto-trigger key
handler re-derives the var-vs-schema decision a third time.

Goal — one deep, pure entry point that IS the test surface; Monaco becomes a
pass-through shell.

## Decisions (grilling)

1. **Seam shape**: a pure function over primitives — no model-reader adapter.
   `computeCompletion(fullText, caretOffset, ctx)` derives all line/column and
   word math internally (including replicating Monaco's default word regex in
   place of `getWordUntilPosition`). Tests are "string with a caret marker →
   expected items + range"; no fake text-model in test code.
2. **Return type**: a Monaco-free DTO the shell forwards verbatim.
3. **WeakMap seams stay in the shell**: `schemaByModel`/`varsByModel` and
   `setModelSchema`/`setModelVarCandidates` are unchanged (Monaco-keyed glue,
   called from BodyView); the provider reads them and passes plain values in.
4. **Helpers stop being exports**; their tests migrate to interface tests
   (rule: 1 meaningful helper case → ≥1 interface case). `descendSchema` is
   the exception — `validate.ts` consumes it; it stays exported with its unit
   tests. `computeSuggestions` dies entirely (its inline duplicates collapse
   into `computeCompletion`). `collectPresentKeys` goes internal (its only
   external consumer was BodyView's auto-trigger block, which now rides the
   deep interface).
5. **BodyView auto-trigger** rides `computeCompletion` via a `source`
   discriminant; the `"`-key gate for the schema branch remains BodyView's UI
   policy.
6. **File layout**: everything stays in `completion.ts` — pure core on top,
   ~50-line Monaco shell at the bottom. No `completionModel.ts` split;
   locality of the branch logic beats symmetry with `paletteModel.ts`.
7. **Bug-for-bug preservation**: interface tests encode current behavior
   (including quirks: unterminated string swallows trailing keys; zero var
   matches fall through to schema completion). Real bugs found during the
   rewrite are recorded as follow-ups, not fixed inline.

## Interface (pure core, `src/features/bodyview/completion.ts`)

```ts
export interface BodyCompletionItem {
  label: string;
  detail?: string;
  kind: "field" | "message" | "enum" | "scalar" | "value" | "variable";
  insertText: string;
  sortText?: string;
  /** insideString: quoted so Monaco's filter matches past the opening `"`. */
  filterText?: string;
  isSnippet?: boolean;
  /** Re-trigger suggest after accepting (next nesting level). */
  triggerNext?: boolean;
  /** 1-based, Monaco convention. */
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
}

export interface BodyCompletion {
  /** Which branch produced the items; null = nothing to show. */
  source: "vars" | "schema" | null;
  suggestions: BodyCompletionItem[];
}

export function computeCompletion(
  fullText: string,
  caretOffset: number,
  ctx: { schema: MessageSchemaIpc | null; vars: VarCandidate[] | null },
): BodyCompletion;
```

Everything the provider currently does moves inside: the var-vs-schema branch
with its fall-through, `{{` token range (offset after `{{` → caret,
`closingAhead` detection), key/value context resolution, present-keys
filtering, `insertionColumns` range extension over quotes, keyOnly when a `:`
is already ahead, the `separatorAfter` slice, insideString `filterText`
quoting, and the keyOnly suppression of snippets/`triggerNext`.

Exports after the change: `computeCompletion`, `registerBodyCompletion`,
`setModelSchema`, `setModelVarCandidates`, `descendSchema` (+ its `Descent`
type). Everything else is module-internal.

## Monaco shell (same file)

`registerBodyCompletion` becomes a pass-through: read the two WeakMaps, call
`computeCompletion(model.getValue(), model.getOffsetAt(position), { schema,
vars })`, and map dictionary-style — `kind → CompletionItemKind` (existing
`monacoKind`), `isSnippet → InsertTextRules.InsertAsSnippet`, `triggerNext →
command: editor.action.triggerSuggest`; `range` passes through verbatim. Three
branch-free substitutions; not worth a test.

## BodyView auto-trigger

The key handler calls `computeCompletion` with the refs' schema/vars and
decides by `source`: `"vars"` → trigger on any key; `"schema"` → trigger only
when the pressed key is `"`. Its imports of `computeSuggestions`,
`collectPresentKeys`, `openVarToken`, `filterCandidates` disappear
(`varContext.ts` itself is unchanged — plain inputs still use it).

## Tests

- `completion.test.ts` is rewritten against `computeCompletion`: a caret-marker
  helper (`body("{ \"ti│\" }")` → `{ fullText, caretOffset }`) plus the
  existing schema fixtures. Every meaningful case of the deleted helper tests
  reappears as an interface case; the previously untested orchestration gets
  new cases (var fall-through on zero matches, insideString filterText, keyOnly,
  separator comma, replacement range over quotes, multi-line positions).
- `descendSchema` unit tests survive as-is.
- Gate: `pnpm lint` + `pnpm test` (frontend-only change; full gate before
  merge per CLAUDE.md anyway).
- Live check in `pnpm tauri:dev`: widget behavior unchanged — keys, values,
  enum/bool values, `{{var}}` completion, insideString matching, separator
  comma.

## Domain language

Create `src/CONTEXT.md` (the frontend context the CONTEXT-MAP marks as
"create lazily") with a Language section defining **Body completion**: the
pure answer to "what does the suggest widget show at this caret" —
`computeCompletion` is its single home; Monaco registration and the BodyView
auto-trigger are consumers. Link it from `CONTEXT-MAP.md`.
