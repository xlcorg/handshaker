# `{{var}}` Autocomplete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** в работе · **Ветка:** `claude/peaceful-gauss-f0850e` · **Спека:**
`docs/superpowers/specs/2026-06-19-var-autocomplete-design.md` · **Гейт:**
`pnpm test` · `pnpm lint` (tsc) · `pnpm build`. Бэкенд/IPC/bindings **не трогаем**.

**Goal:** При наборе `{{` предлагать переменные активного окружения + привязанной
коллекции (имя · превью значения · тег env/collection) — в теле запроса (Monaco) и
в plain-инпутах `VarHighlightInput` (адресная строка + поле значения переменных
коллекции).

**Architecture:** Чистый фронт. Общее ядро — сборка кандидатов
(`candidates.ts`) + чистые функции контекста/вставки (`varContext.ts`). Две
поверхности: (1) расширение единого Monaco-провайдера на `json-with-vars`
(var-ветка ставится **до** schema-гейта, чтобы работать без схемы); (2)
каретко-привязанный listbox-дропдаун внутри `VarHighlightInput`. Кандидаты
доезжают до Monaco через per-model `WeakMap` (зеркало `setModelSchema`), до
plain-инпутов — через проп `variables`.

**Tech Stack:** React 18 · TypeScript · Monaco (`@monaco-editor/react`) ·
Vitest + React Testing Library · jsdom.

---

## File Structure

**Новые файлы**

- `src/features/vars/candidates.ts` (+ `candidates.test.ts`) — `VarOrigin`,
  `VarCandidate`, `buildVarCandidates(env, collection)`.
- `src/features/vars/varContext.ts` (+ `varContext.test.ts`) — `openVarToken`,
  `filterCandidates`, `applyVarPick` (чистые).
- `src/features/envs/useActiveEnvVars.ts` (+ `useActiveEnvVars.test.tsx`) — хук:
  переменные активного окружения воркфлоу.
- `src/features/vars/VarSuggestDropdown.tsx` — презентационный listbox (вид A).

**Правки**

- `src/features/bodyview/completion.ts` — `Suggestion.kind` += `"variable"`;
  per-model `varsByModel` WeakMap + `setModelVarCandidates`; `buildVarSuggestions`;
  var-ветка в провайдере; `monacoKind`; `triggerCharacters` += `"{"`.
- `src/features/bodyview/completion.test.ts` — тесты `buildVarSuggestions`.
- `src/features/bodyview/BodyView.tsx` — проп `varCandidates`; постановка на
  модель (onMount + эффект); force-open `onKeyUp` для `{`.
- `src/features/invoke/BodyEditor.tsx` — проп `varCandidates` (pass-through).
- `src/features/workflow/RequestTabs.tsx` — проп `varCandidates` → BodyEditor.
- `src/features/workflow/CallPanel.tsx` — `useActiveEnvVars` + проп `originVars` +
  сборка кандидатов → DraftAddressBar (`variables`) + RequestTabs (`varCandidates`).
- `src/features/workflow/DraftAddressBar.tsx` — проп `variables` → VarHighlightInput.
- `src/features/workflow/FocusView.tsx` — `originVars` из `tree` → CallPanel.
- `src/features/vars/VarHighlightInput.tsx` — проп `variables` + интеграция
  дропдауна (токен по `selectionStart`, клавиатура, вставка, a11y, измерение).
- `src/features/vars/VarHighlightInput.test.tsx` — open/filter/insert/keyboard.
- `src/features/catalog/overview/VariablesBlock.tsx` — проп `variables` →
  VarHighlightInput.
- `src/features/catalog/overview/CollectionOverview.tsx` — сборка кандидатов
  (active env + `varsRecord`) → VariablesBlock.

**Фазы:** Tasks 1–6 — ядро + Monaco-поверхность (🧹 /clear-чекпойнт после Task 8).
Tasks 9–12 — `VarHighlightInput`-дропдаун + проводка. Task 13 — финальный гейт.

---

## Task 1: Сборка кандидатов — `buildVarCandidates`

**Files:**
- Create: `src/features/vars/candidates.ts`
- Test: `src/features/vars/candidates.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildVarCandidates } from "./candidates";

describe("buildVarCandidates", () => {
  it("lists env first, then collection, env wins on name clash (marked overrides)", () => {
    const out = buildVarCandidates(
      { host: "api.staging", token: "jwt" },
      { host: "api.local", order_id: "42" },
    );
    expect(out).toEqual([
      { name: "host", value: "api.staging", origin: "env", overrides: true },
      { name: "token", value: "jwt", origin: "env" },
      { name: "order_id", value: "42", origin: "collection" },
    ]);
  });

  it("handles missing sides and skips undefined values", () => {
    expect(buildVarCandidates(undefined, undefined)).toEqual([]);
    expect(buildVarCandidates({ a: "1", b: undefined }, undefined)).toEqual([
      { name: "a", value: "1", origin: "env" },
    ]);
    expect(buildVarCandidates(undefined, { c: "3" })).toEqual([
      { name: "c", value: "3", origin: "collection" },
    ]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm test src/features/vars/candidates.test.ts`
Expected: FAIL — `buildVarCandidates` not found.

- [ ] **Step 3: Implement**

```ts
export type VarOrigin = "env" | "collection";

export interface VarCandidate {
  name: string;
  /** Raw stored value (preview). Never resolved here — instant, no IPC. */
  value: string;
  origin: VarOrigin;
  /** Set on an env candidate that shadows a same-named collection var. */
  overrides?: boolean;
}

type VarMap = Partial<Record<string, string>> | undefined;

/** Active environment wins over a same-named collection var (mirrors resolve order
 *  env > collection). Order: env candidates first, then collection. */
export function buildVarCandidates(env: VarMap, collection: VarMap): VarCandidate[] {
  const envEntries = Object.entries(env ?? {}).filter(
    (e): e is [string, string] => e[1] !== undefined,
  );
  const envNames = new Set(envEntries.map(([k]) => k));
  const collEntries = Object.entries(collection ?? {}).filter(
    (e): e is [string, string] => e[1] !== undefined,
  );
  const collNames = new Set(collEntries.map(([k]) => k));

  const out: VarCandidate[] = [];
  for (const [name, value] of envEntries) {
    out.push(collNames.has(name)
      ? { name, value, origin: "env", overrides: true }
      : { name, value, origin: "env" });
  }
  for (const [name, value] of collEntries) {
    if (envNames.has(name)) continue; // env wins
    out.push({ name, value, origin: "collection" });
  }
  return out;
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm test src/features/vars/candidates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/vars/candidates.ts src/features/vars/candidates.test.ts
git commit -m "feat(vars): buildVarCandidates (env+collection, env-wins dedup)"
```

---

## Task 2: Детектор открытого токена — `openVarToken`

**Files:**
- Create: `src/features/vars/varContext.ts`
- Test: `src/features/vars/varContext.test.ts`

Grammar — ядровый `VAR_RE` (`\{\{([^{}]+)\}\}`): имя = любой непустой пробег
без фигурных скобок (дефисы/точки/слэши считаются). Детектор каретко-независим
(текст ДО курсора), что обходит баг Postman #5067.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { openVarToken } from "./varContext";

describe("openVarToken", () => {
  it("returns the partial after the last unclosed {{", () => {
    expect(openVarToken("host = {{ho")).toEqual({ partial: "ho", tokenStart: 7 });
    expect(openVarToken("{{")).toEqual({ partial: "", tokenStart: 0 });
    expect(openVarToken("{{api.ho")).toEqual({ partial: "api.ho", tokenStart: 0 });
  });

  it("returns null when there is no open token", () => {
    expect(openVarToken("plain")).toBeNull();
    expect(openVarToken("{single")).toBeNull();
    expect(openVarToken("{{x}}")).toBeNull();          // closed
    expect(openVarToken("{{x}} then {{y")).toEqual({ partial: "y", tokenStart: 11 });
  });

  it("rejects a partial containing braces (token already closed/broken)", () => {
    expect(openVarToken("{{a}")).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm test src/features/vars/varContext.test.ts`
Expected: FAIL — `openVarToken` not found.

- [ ] **Step 3: Implement**

```ts
import type { VarCandidate } from "./candidates";

export interface OpenToken {
  /** Text typed after the `{{` up to the caret. */
  partial: string;
  /** Index of the `{{` in the supplied text (doc/string offset). */
  tokenStart: number;
}

/** If the end of `textBefore` sits inside an unclosed `{{…`, return the partial and
 *  the `{{` offset; else null. A brace in the partial means the token is closed/broken. */
export function openVarToken(textBefore: string): OpenToken | null {
  const open = textBefore.lastIndexOf("{{");
  if (open === -1) return null;
  const partial = textBefore.slice(open + 2);
  if (partial.includes("{") || partial.includes("}")) return null;
  return { partial, tokenStart: open };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm test src/features/vars/varContext.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/vars/varContext.ts src/features/vars/varContext.test.ts
git commit -m "feat(vars): openVarToken open-{{ detector (layout/caret independent)"
```

---

## Task 3: Фильтр кандидатов — `filterCandidates`

**Files:**
- Modify: `src/features/vars/varContext.ts`
- Test: `src/features/vars/varContext.test.ts`

- [ ] **Step 1: Failing test (append)**

```ts
import { filterCandidates } from "./varContext";
import type { VarCandidate } from "./candidates";

const C = (name: string): VarCandidate => ({ name, value: "", origin: "env" });

describe("filterCandidates", () => {
  it("returns all when partial is empty", () => {
    expect(filterCandidates([C("a"), C("b")], "").map((c) => c.name)).toEqual(["a", "b"]);
  });
  it("case-insensitive substring match, prefix matches first", () => {
    const out = filterCandidates([C("api_root"), C("host"), C("hostname")], "host");
    expect(out.map((c) => c.name)).toEqual(["host", "hostname"]);
  });
  it("keeps prefix before mid-substring, preserving input order within a rank", () => {
    const out = filterCandidates([C("x_host"), C("host"), C("hostly")], "host");
    expect(out.map((c) => c.name)).toEqual(["host", "hostly", "x_host"]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm test src/features/vars/varContext.test.ts`
Expected: FAIL — `filterCandidates` not found.

- [ ] **Step 3: Implement (append to `varContext.ts`)**

```ts
/** Case-insensitive substring filter; prefix matches rank above mid-string matches.
 *  Stable within a rank (Array.sort is stable), so input order is preserved. */
export function filterCandidates(cands: VarCandidate[], partial: string): VarCandidate[] {
  if (partial === "") return cands;
  const p = partial.toLowerCase();
  return cands
    .map((c) => ({ c, idx: c.name.toLowerCase().indexOf(p) }))
    .filter((s) => s.idx !== -1)
    .sort((a, b) => (a.idx === 0 ? 0 : 1) - (b.idx === 0 ? 0 : 1))
    .map((s) => s.c);
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm test src/features/vars/varContext.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/vars/varContext.ts src/features/vars/varContext.test.ts
git commit -m "feat(vars): filterCandidates (substring, prefix-first, stable)"
```

---

## Task 4: Применение выбора — `applyVarPick`

**Files:**
- Modify: `src/features/vars/varContext.ts`
- Test: `src/features/vars/varContext.test.ts`

Вставляет `{{name}}`. Если `}}` уже сразу за курсором (авто-закрытие Monaco /
повторный вызов) — второй `}}` не добавляется. Курсор встаёт после `}}`.

- [ ] **Step 1: Failing test (append)**

```ts
import { applyVarPick } from "./varContext";

describe("applyVarPick", () => {
  it("inserts {{name}} and places caret after }} (no closing ahead)", () => {
    // value="a {{ho", caret at end (6)
    expect(applyVarPick("a {{ho", 6, "host")).toEqual({ value: "a {{host}}", caret: 10 });
  });
  it("does not duplicate }} when closing already ahead", () => {
    // value="a {{ho}}", caret after "ho" (6), "}}" follows
    expect(applyVarPick("a {{ho}}", 6, "host")).toEqual({ value: "a {{host}}", caret: 10 });
  });
  it("returns null when caret is not in an open token", () => {
    expect(applyVarPick("plain", 5, "host")).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm test src/features/vars/varContext.test.ts`
Expected: FAIL — `applyVarPick` not found.

- [ ] **Step 3: Implement (append to `varContext.ts`)**

```ts
/** Replace the open `{{partial` ending at `caret` with `{{name}}`. Returns the new
 *  value and caret (just past `}}`), or null if the caret is not in an open token. */
export function applyVarPick(
  value: string,
  caret: number,
  name: string,
): { value: string; caret: number } | null {
  const tok = openVarToken(value.slice(0, caret));
  if (!tok) return null;
  const head = value.slice(0, tok.tokenStart); // everything before `{{`
  const after = value.slice(caret);
  const closingAhead = after.startsWith("}}");
  const inserted = `{{${name}${closingAhead ? "" : "}}"}`;
  return {
    value: head + inserted + after,
    caret: head.length + inserted.length + (closingAhead ? 2 : 0),
  };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm test src/features/vars/varContext.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/vars/varContext.ts src/features/vars/varContext.test.ts
git commit -m "feat(vars): applyVarPick (insert {{name}}, skip dup }} )"
```

---

## Task 5: Monaco var-подсказки — `buildVarSuggestions` + `"variable"` kind

**Files:**
- Modify: `src/features/bodyview/completion.ts`
- Test: `src/features/bodyview/completion.test.ts`

- [ ] **Step 1: Failing test (append to completion.test.ts)**

```ts
import { buildVarSuggestions } from "./completion";
import type { VarCandidate } from "@/features/vars/candidates";

const VC: VarCandidate[] = [
  { name: "host", value: "api.staging", origin: "env", overrides: true },
  { name: "order_id", value: "42", origin: "collection" },
];

describe("buildVarSuggestions", () => {
  it("maps candidates to var Suggestions filtered by partial, value+origin in detail", () => {
    const out = buildVarSuggestions(VC, "ho", false);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      label: "host",
      kind: "variable",
      insertText: "host}}",          // no closing ahead → append }}
      detail: "api.staging · env (overrides)",
    });
  });
  it("omits the trailing }} when closing is already ahead", () => {
    expect(buildVarSuggestions(VC, "", true)[0].insertText).toBe("host");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm test src/features/bodyview/completion.test.ts`
Expected: FAIL — `buildVarSuggestions` not found.

- [ ] **Step 3: Implement**

In `completion.ts`, extend the `Suggestion["kind"]` union and add the builder. Add the import at the top:

```ts
import { filterCandidates } from "@/features/vars/varContext";
import type { VarCandidate } from "@/features/vars/candidates";
```

Change the kind union (existing line in `interface Suggestion`):

```ts
  kind: "field" | "message" | "enum" | "scalar" | "value" | "variable";
```

Add the builder (e.g. just below `computeSuggestions`):

```ts
/** Human detail line for a var suggestion: "<value> · <origin>[ (overrides)]". */
function varDetail(c: VarCandidate): string {
  const origin = c.overrides ? "env (overrides)" : c.origin;
  return c.value ? `${c.value} · ${origin}` : origin;
}

/** Variable-name suggestions for an open `{{` token. `closingAhead` = `}}` already
 *  immediately follows the caret (skip appending it). */
export function buildVarSuggestions(
  candidates: VarCandidate[],
  partial: string,
  closingAhead: boolean,
): Suggestion[] {
  return filterCandidates(candidates, partial).map((c, i) => ({
    label: c.name,
    detail: varDetail(c),
    insertText: closingAhead ? c.name : `${c.name}}}`,
    kind: "variable" as const,
    sortText: sortKey(i),
  }));
}
```

Extend `monacoKind` — add a case before `default`:

```ts
    case "variable":
      return K.Variable;
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm test src/features/bodyview/completion.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/bodyview/completion.ts src/features/bodyview/completion.test.ts
git commit -m "feat(bodyview): buildVarSuggestions + variable completion kind"
```

---

## Task 6: Monaco-провайдер — var-ветка + per-model кандидаты + триггер `{`

**Files:**
- Modify: `src/features/bodyview/completion.ts`

Чистая логика (`buildVarSuggestions`/`openVarToken`) уже покрыта Tasks 2/5. Здесь —
Monaco-склейка (range от `{{`-офсета, чтобы корректно заменять и точечные имена;
var-ветка ставится ДО schema-гейта). Проверяется компиляцией + живым проходом.

- [ ] **Step 1: WeakMap + setter.** Рядом с `schemaByModel`:

```ts
import { openVarToken } from "@/features/vars/varContext";
// (VarCandidate import added in Task 5)

const varsByModel = new WeakMap<Monaco.editor.ITextModel, VarCandidate[]>();

/** Attach (or clear) the var candidates for a model — request body only. */
export function setModelVarCandidates(
  model: Monaco.editor.ITextModel | null,
  candidates: VarCandidate[] | null,
): void {
  if (!model) return;
  if (candidates && candidates.length) varsByModel.set(model, candidates);
  else varsByModel.delete(model);
}
```

- [ ] **Step 2: Var-branch in the provider.** In `registerBodyCompletion`, add `"{"` to `triggerCharacters` and insert the var-branch at the TOP of `provideCompletionItems` (before `const schema = ...` / the schema gate):

```ts
    triggerCharacters: ['"', ":", " ", "{"],
    provideCompletionItems(model, position) {
      const textBefore = model.getValueInRange({
        startLineNumber: 1, startColumn: 1,
        endLineNumber: position.lineNumber, endColumn: position.column,
      });

      // --- variable completion (works without a schema) -------------------
      const varCands = varsByModel.get(model);
      const tok = openVarToken(textBefore);
      if (tok && varCands) {
        // Range covers the whole partial (offset after `{{` → caret), so dotted
        // names replace correctly instead of duplicating the prefix.
        const start = model.getPositionAt(tok.tokenStart + 2);
        const lineEnd = model.getLineMaxColumn(position.lineNumber);
        const after = model.getValueInRange({
          startLineNumber: position.lineNumber, startColumn: position.column,
          endLineNumber: position.lineNumber, endColumn: lineEnd,
        });
        const closingAhead = /^\}\}/.test(after);
        const items = buildVarSuggestions(varCands, tok.partial, closingAhead);
        if (items.length === 0) return { suggestions: [] };
        const range: Monaco.IRange = {
          startLineNumber: start.lineNumber, startColumn: start.column,
          endLineNumber: position.lineNumber, endColumn: position.column,
        };
        return {
          suggestions: items.map((s) => ({
            label: s.label,
            detail: s.detail,
            kind: monacoKind(monaco, s.kind),
            insertText: s.insertText,
            sortText: s.sortText,
            filterText: s.label,
            range,
          })),
        };
      }

      const schema = schemaByModel.get(model);
      if (!schema) return { suggestions: [] };
      // ...existing schema logic unchanged, BUT remove its now-duplicate
      //    `const textBefore = ...` (it is computed above) and reuse `textBefore`.
```

Note: delete the second `const textBefore = ...` declaration that previously lived after the schema gate — it is now declared at the top and reused.

- [ ] **Step 3: Typecheck.**

Run: `pnpm lint`
Expected: PASS (no type errors).

- [ ] **Step 4: Full suite (no regressions in schema completion).**

Run: `pnpm test src/features/bodyview/completion.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/bodyview/completion.ts
git commit -m "feat(bodyview): {{var}} branch in completion provider + setModelVarCandidates"
```

---

## Task 7: BodyView — проп `varCandidates` + постановка на модель + force-open

**Files:**
- Modify: `src/features/bodyview/BodyView.tsx`

- [ ] **Step 1: Prop + ref + import.** Add to imports:

```ts
import { setModelSchema, computeSuggestions, collectPresentKeys, setModelVarCandidates } from "./completion";
import { openVarToken, filterCandidates } from "@/features/vars/varContext";
import type { VarCandidate } from "@/features/vars/candidates";
```

Extend `BodyViewProps`:

```ts
  /** Variable candidates for `{{`-autocomplete — request mode only. */
  varCandidates?: VarCandidate[];
```

Destructure + keep a fresh ref (next to `schemaRef`):

```ts
export function BodyView({ mode, value, onChange, onSubmit, schema, varCandidates }: BodyViewProps) {
  ...
  const varCandidatesRef = useRef(varCandidates);
  varCandidatesRef.current = varCandidates;
```

- [ ] **Step 2: Set on model in onMount.** Right after the existing `setModelSchema(editor.getModel(), schemaRef.current ?? null);`:

```ts
      setModelVarCandidates(editor.getModel(), varCandidatesRef.current ?? null);
```

- [ ] **Step 3: Keep current via effect.** Extend the existing schema-sync effect body (the one that calls `setModelSchema(model, schema)`):

```ts
  useEffect(() => {
    const model = live.current?.editor.getModel();
    setModelSchema(model ?? null, schema ?? null);
    setModelVarCandidates(model ?? null, varCandidates ?? null);
    applyGhost();
  }, [schema, varCandidates, mode, applyGhost]);
```

- [ ] **Step 4: Force-open on `{`.** In the `onKeyUp` handler (request mode), broaden the guard and add the var path. Replace the existing `if (e.browserEvent.key !== '"') return;` block body with:

```ts
        live.current.typeSub = editor.onKeyUp((e) => {
          const key = e.browserEvent.key;
          if (key !== '"' && key !== "{") return;
          const model = editor.getModel();
          const pos = editor.getPosition();
          if (!model || !pos) return;
          const textBefore = model.getValueInRange({
            startLineNumber: 1, startColumn: 1,
            endLineNumber: pos.lineNumber, endColumn: pos.column,
          });
          // Variable token: open the widget if `{{…` and candidates match.
          const tok = openVarToken(textBefore);
          const vc = varCandidatesRef.current;
          if (tok && vc && filterCandidates(vc, tok.partial).length > 0) {
            editor.trigger("autocomplete", "editor.action.triggerSuggest", {});
            return;
          }
          // Schema path (quote open) — unchanged behaviour.
          if (key !== '"') return;
          const sc = schemaRef.current;
          if (!sc) return;
          const present = collectPresentKeys(model.getValue(), model.getOffsetAt(pos));
          if (computeSuggestions(sc, textBefore, present).length > 0) {
            editor.trigger("autocomplete", "editor.action.triggerSuggest", {});
          }
        });
```

- [ ] **Step 5: Clear on unmount.** In the unmount-cleanup effect that calls `setModelSchema(model ?? null, null)`, add:

```ts
      setModelVarCandidates(model ?? null, null);
```

- [ ] **Step 6: Typecheck + commit.**

Run: `pnpm lint`
Expected: PASS.

```bash
git add src/features/bodyview/BodyView.tsx
git commit -m "feat(bodyview): wire varCandidates into model + force-open on {{"
```

---

## Task 8: Проброс `varCandidates` — BodyEditor → RequestTabs

**Files:**
- Modify: `src/features/invoke/BodyEditor.tsx`
- Modify: `src/features/workflow/RequestTabs.tsx`

- [ ] **Step 1: BodyEditor pass-through.**

```ts
import type { MessageSchemaIpc } from "@/ipc/bindings";
import type { VarCandidate } from "@/features/vars/candidates";

export interface BodyEditorProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit?: () => void;
  schema?: MessageSchemaIpc | null;
  varCandidates?: VarCandidate[];
}

export function BodyEditor({ value, onChange, onSubmit, schema, varCandidates }: BodyEditorProps) {
  return (
    <BodyView mode="request" value={value} onChange={onChange} onSubmit={onSubmit}
      schema={schema} varCandidates={varCandidates} />
  );
}
```

- [ ] **Step 2: RequestTabs pass-through.** Add import + prop + forward:

```ts
import type { SavedAuthConfigIpc, MessageSchemaIpc } from "@/ipc/bindings";
import type { VarCandidate } from "@/features/vars/candidates";
```

Add to `RequestTabsProps`:

```ts
  /** Variable candidates for body `{{`-autocomplete. */
  varCandidates?: VarCandidate[];
```

Destructure `varCandidates` and forward to BodyEditor:

```ts
          <BodyEditor value={step.requestJson} onChange={onBody} onSubmit={onSubmit}
            schema={schema} varCandidates={varCandidates} />
```

- [ ] **Step 3: Typecheck + commit.**

Run: `pnpm lint`
Expected: PASS.

```bash
git add src/features/invoke/BodyEditor.tsx src/features/workflow/RequestTabs.tsx
git commit -m "feat(workflow): thread varCandidates BodyEditor→RequestTabs"
```

> 🧹 **/clear-чекпойнт.** Ядро + Monaco-поверхность готовы. Проводку в CallPanel
> делаем вместе с адресной строкой (Task 12), т.к. она питает обе поверхности.

---

## Task 9: Хук `useActiveEnvVars`

**Files:**
- Create: `src/features/envs/useActiveEnvVars.ts`
- Test: `src/features/envs/useActiveEnvVars.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const envList = vi.fn();
vi.mock("@/ipc/client", () => ({ envList: () => envList() }));
vi.mock("@/features/workflow/store", () => ({
  useActiveWorkflow: () => ({ envName: "staging" }),
}));
vi.mock("./envRevision", () => ({ useEnvRevision: () => 0 }));

import { useActiveEnvVars } from "./useActiveEnvVars";

describe("useActiveEnvVars", () => {
  beforeEach(() => envList.mockReset());

  it("returns the active env's variables (undefined values filtered)", async () => {
    envList.mockResolvedValue([
      { name: "staging", variables: { host: "api", token: undefined }, color: null },
      { name: "prod", variables: { host: "p" }, color: null },
    ]);
    const { result } = renderHook(() => useActiveEnvVars());
    await waitFor(() => expect(result.current).toEqual({ host: "api" }));
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm test src/features/envs/useActiveEnvVars.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { useEffect, useState } from "react";
import { envList } from "@/ipc/client";
import { useActiveWorkflow } from "@/features/workflow/store";
import { useEnvRevision } from "./envRevision";

/** Variables of the active workflow environment ({} when none / on error).
 *  Re-fetches on env switch or env-revision bump (edits to the active env). */
export function useActiveEnvVars(): Record<string, string> {
  const wf = useActiveWorkflow();
  const envRevision = useEnvRevision();
  const [vars, setVars] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!wf.envName) {
      setVars({});
      return;
    }
    let cancelled = false;
    void envList()
      .then((envs) => {
        if (cancelled) return;
        const env = envs.find((e) => e.name === wf.envName);
        const rec: Record<string, string> = {};
        for (const [k, v] of Object.entries(env?.variables ?? {})) {
          if (v !== undefined) rec[k] = v;
        }
        setVars(rec);
      })
      .catch(() => {
        if (!cancelled) setVars({});
      });
    return () => {
      cancelled = true;
    };
  }, [wf.envName, envRevision]);

  return vars;
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm test src/features/envs/useActiveEnvVars.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/envs/useActiveEnvVars.ts src/features/envs/useActiveEnvVars.test.tsx
git commit -m "feat(envs): useActiveEnvVars hook"
```

---

## Task 10: Презентационный дропдаун `VarSuggestDropdown`

**Files:**
- Create: `src/features/vars/VarSuggestDropdown.tsx`
- Test: `src/features/vars/VarSuggestDropdown.test.tsx`

Вид A: иконка · имя · приглушённый превью значения (truncate) · тег
env/collection (+ «overrides» на env-кандидате). a11y по APG: `role=listbox` на
контейнере, `role=option` + `aria-selected` на строках, стабильные `id`.

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { VarSuggestDropdown } from "./VarSuggestDropdown";
import type { VarCandidate } from "./candidates";

const items: VarCandidate[] = [
  { name: "host", value: "api.staging", origin: "env", overrides: true },
  { name: "order_id", value: "42", origin: "collection" },
];

describe("VarSuggestDropdown", () => {
  it("renders a listbox with option rows showing name, value and origin", () => {
    render(<VarSuggestDropdown items={items} active={0} listboxId="lb" onPick={() => {}} left={0} />);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    const opts = screen.getAllByRole("option");
    expect(opts).toHaveLength(2);
    expect(opts[0]).toHaveAttribute("aria-selected", "true");
    expect(opts[0]).toHaveTextContent("host");
    expect(opts[0]).toHaveTextContent("api.staging");
    expect(screen.getByText("env")).toBeInTheDocument();
    expect(screen.getByText("collection")).toBeInTheDocument();
  });

  it("calls onPick with the index on mousedown", () => {
    const onPick = vi.fn();
    render(<VarSuggestDropdown items={items} active={0} listboxId="lb" onPick={onPick} left={0} />);
    // mousedown (not click) so the input keeps focus
    screen.getAllByRole("option")[1].dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onPick).toHaveBeenCalledWith(1);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm test src/features/vars/VarSuggestDropdown.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
import { cn } from "@/lib/cn";
import type { VarCandidate } from "./candidates";

export interface VarSuggestDropdownProps {
  items: VarCandidate[];
  active: number;
  listboxId: string;
  onPick: (index: number) => void;
  /** px offset from the wrapper's left edge (caret-anchored at `{{`). */
  left: number;
}

export function optionId(listboxId: string, i: number): string {
  return `${listboxId}-opt-${i}`;
}

export function VarSuggestDropdown({ items, active, listboxId, onPick, left }: VarSuggestDropdownProps) {
  return (
    <ul
      id={listboxId}
      role="listbox"
      className="absolute top-full z-50 mt-1 max-h-56 w-[min(22rem,90vw)] overflow-auto rounded-md border border-border bg-popover py-1 text-xs shadow-md"
      style={{ left }}
    >
      {items.map((c, i) => (
        <li
          key={c.name}
          id={optionId(listboxId, i)}
          role="option"
          aria-selected={i === active}
          // mousedown, not click: keep DOM focus on the input (no blur-close race)
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(i);
          }}
          className={cn(
            "flex items-center gap-2 px-2.5 py-1 cursor-pointer",
            i === active ? "bg-accent" : "hover:bg-accent/60",
          )}
        >
          <span className="font-mono text-foreground">{c.name}</span>
          {c.value ? (
            <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground/70">{c.value}</span>
          ) : (
            <span className="flex-1" />
          )}
          <span
            className={cn(
              "shrink-0 rounded px-1.5 py-px text-[10px]",
              c.origin === "env" ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400",
            )}
          >
            {c.origin}
          </span>
          {c.overrides ? <span className="shrink-0 text-[10px] text-muted-foreground/50">overrides</span> : null}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm test src/features/vars/VarSuggestDropdown.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/vars/VarSuggestDropdown.tsx src/features/vars/VarSuggestDropdown.test.tsx
git commit -m "feat(vars): VarSuggestDropdown listbox (name/value/origin, APG roles)"
```

---

## Task 11: `VarHighlightInput` — интеграция дропдауна

**Files:**
- Modify: `src/features/vars/VarHighlightInput.tsx`
- Test: `src/features/vars/VarHighlightInput.test.tsx`

Поведение: набор `{{`/партиала → дропдаун открыт, если есть совпадения; ↑/↓ —
двигают активную опцию (с переносом), Enter/Tab — принять, Esc — закрыть (клавиши
гасятся `preventDefault`+`stopPropagation`, чтобы не сабмитить адрес / не уводить
фокус); выбор → `applyVarPick`, курсор после `}}`. a11y: input `role=combobox`,
`aria-expanded`/`aria-controls`/`aria-activedescendant`. Позиция: измеряем ширину
`value.slice(0, tokenStart)` скрытым мерочным `<span>` с теми же `metrics` (в jsdom
offsetWidth=0 → left=0, что тестам ОК).

- [ ] **Step 1: Failing test (append to VarHighlightInput.test.tsx)**

```tsx
import { fireEvent } from "@testing-library/react";
import type { VarCandidate } from "./candidates";

const VARS: VarCandidate[] = [
  { name: "host", value: "api.staging", origin: "env" },
  { name: "hostname", value: "h", origin: "collection" },
  { name: "token", value: "jwt", origin: "env" },
];

function typeInto(input: HTMLInputElement, value: string) {
  input.focus();
  fireEvent.change(input, { target: { value } });
  // place caret at end (jsdom doesn't track it from change)
  input.setSelectionRange(value.length, value.length);
  fireEvent.keyUp(input, { key: value.slice(-1) });
}

describe("VarHighlightInput autocomplete", () => {
  it("opens a listbox filtered by the partial after {{", () => {
    const onChange = vi.fn();
    render(<VarHighlightInput value="" onChange={onChange} ariaLabel="addr" variables={VARS} />);
    const input = screen.getByLabelText("addr") as HTMLInputElement;
    typeInto(input, "{{host");
    const opts = screen.getAllByRole("option");
    expect(opts.map((o) => o.textContent)).toEqual([
      expect.stringContaining("host"),
      expect.stringContaining("hostname"),
    ]);
    expect(input).toHaveAttribute("aria-expanded", "true");
  });

  it("Enter inserts the active variable with closing braces", () => {
    const onChange = vi.fn();
    render(<VarHighlightInput value="" onChange={onChange} ariaLabel="addr" variables={VARS} />);
    const input = screen.getByLabelText("addr") as HTMLInputElement;
    typeInto(input, "{{host");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("{{host}}");
  });

  it("Escape closes the listbox without inserting", () => {
    render(<VarHighlightInput value="" onChange={() => {}} ariaLabel="addr" variables={VARS} />);
    const input = screen.getByLabelText("addr") as HTMLInputElement;
    typeInto(input, "{{ho");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("does not open when there are no variables", () => {
    render(<VarHighlightInput value="" onChange={() => {}} ariaLabel="addr" />);
    const input = screen.getByLabelText("addr") as HTMLInputElement;
    typeInto(input, "{{ho");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm test src/features/vars/VarHighlightInput.test.tsx`
Expected: FAIL — `variables` prop / listbox not implemented.

- [ ] **Step 3: Implement.** Add to `VarHighlightInput.tsx`:

Imports:

```ts
import { useId } from "react";
import { VarSuggestDropdown, optionId } from "./VarSuggestDropdown";
import { openVarToken, filterCandidates, applyVarPick } from "./varContext";
import type { VarCandidate } from "./candidates";
```

Extend `VarHighlightInputProps`:

```ts
  /** Variable candidates for `{{`-autocomplete. Omit/empty to disable. */
  variables?: VarCandidate[];
```

Destructure `variables` in the signature. Inside the component, add state + a measuring span + handlers:

```ts
  const listboxId = useId();
  const [suggest, setSuggest] = useState<{ items: VarCandidate[]; active: number; left: number } | null>(null);
  const measureRef = useRef<HTMLSpanElement>(null);

  // Recompute the open-token + matches from the LIVE input (DOM value + caret), NOT the
  // `value` prop — the prop can lag within a tick, and an uncontrolled-parent test drives
  // the DOM directly. Position the dropdown at the `{{` via the measuring span.
  const refreshSuggest = () => {
    const el = inputRef.current;
    if (!el || !variables || variables.length === 0) { setSuggest(null); return; }
    const text = el.value;
    const caret = el.selectionStart ?? text.length;
    const tok = openVarToken(text.slice(0, caret));
    if (!tok) { setSuggest(null); return; }
    const items = filterCandidates(variables, tok.partial);
    if (items.length === 0) { setSuggest(null); return; }
    let left = 0;
    if (measureRef.current) {
      measureRef.current.textContent = text.slice(0, tok.tokenStart);
      left = measureRef.current.offsetWidth - el.scrollLeft;
    }
    setSuggest((prev) => ({ items, active: prev ? Math.min(prev.active, items.length - 1) : 0, left: Math.max(0, left) }));
  };

  const pick = (index: number) => {
    const el = inputRef.current;
    const item = suggest?.items[index];
    if (!el || !item) return;
    const res = applyVarPick(el.value, el.selectionStart ?? el.value.length, item.name);
    if (!res) return;
    onChange(res.value);
    setSuggest(null);
    // Restore caret after the controlled value re-renders (parent feeds `value` back).
    requestAnimationFrame(() => {
      const e = inputRef.current;
      if (e) { e.focus(); e.setSelectionRange(res.caret, res.caret); }
    });
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!suggest) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSuggest((s) => s && { ...s, active: (s.active + 1) % s.items.length });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSuggest((s) => s && { ...s, active: (s.active - 1 + s.items.length) % s.items.length });
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      pick(suggest.active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setSuggest(null);
    }
  };
```

Wire the `<input>`: add `onKeyDown={onInputKeyDown}`, call `refreshSuggest(e.target.value)` inside the existing `onChange`, call `refreshSuggest(value)` on `onKeyUp`/`onSelect`/`onClick`, close on `onBlur`, and add the combobox a11y attrs. Replace the `onChange` line and add handlers:

```tsx
      <input
        ref={inputRef}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={suggest != null}
        aria-controls={suggest ? listboxId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={suggest ? optionId(listboxId, suggest.active) : undefined}
        value={value}
        onChange={(e) => { onChange(e.target.value); refreshSuggest(); }}
        onKeyDown={onInputKeyDown}
        onKeyUp={refreshSuggest}
        onSelect={refreshSuggest}
        onBlur={() => setSuggest(null)}
        onScroll={syncScroll}
        placeholder={placeholder}
        spellCheck={false}
        className={cn(
          "relative w-full border-0 bg-transparent text-transparent caret-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-0",
          metrics,
        )}
      />
```

Add a hidden measuring span (same `metrics` font) inside the wrapper, and render the dropdown when open. Place just before the closing `</div>` of the wrapper:

```tsx
      <span
        ref={measureRef}
        aria-hidden
        className={cn("pointer-events-none invisible absolute left-0 top-0 whitespace-pre", metrics)}
      />
      {suggest && (
        <VarSuggestDropdown
          items={suggest.items}
          active={suggest.active}
          listboxId={listboxId}
          onPick={pick}
          left={suggest.left}
        />
      )}
```

Note: the wrapper is already `relative`. Keep the existing tooltip wrapping; the listbox is `absolute` so it escapes the field visually.

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm test src/features/vars/VarHighlightInput.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm lint`
Expected: PASS.

```bash
git add src/features/vars/VarHighlightInput.tsx src/features/vars/VarHighlightInput.test.tsx
git commit -m "feat(vars): {{var}} autocomplete dropdown in VarHighlightInput"
```

---

## Task 12: Проводка кандидатов во все поверхности

**Files:**
- Modify: `src/features/workflow/CallPanel.tsx`
- Modify: `src/features/workflow/DraftAddressBar.tsx`
- Modify: `src/features/workflow/FocusView.tsx`
- Modify: `src/features/catalog/overview/VariablesBlock.tsx`
- Modify: `src/features/catalog/overview/CollectionOverview.tsx`

- [ ] **Step 1: DraftAddressBar — `variables` prop.** Add import + prop + forward to `VarHighlightInput`:

```ts
import type { VarCandidate } from "@/features/vars/candidates";
```

Add to its props interface:

```ts
  variables?: VarCandidate[];
```

Destructure `variables` and pass it to the `<VarHighlightInput ... variables={variables} />` (the existing element at lines ~62–69).

- [ ] **Step 2: VariablesBlock — `variables` prop.** Same pattern:

```ts
import type { VarCandidate } from "@/features/vars/candidates";
```

Add to `VariablesBlockProps`:

```ts
  /** Variable candidates for `{{`-autocomplete inside the value field. */
  variables?: VarCandidate[];
```

Destructure and pass `variables={variables}` to the `<VarHighlightInput>` in the value cell.

- [ ] **Step 3: CallPanel — build + pass candidates.** Add imports:

```ts
import { useActiveEnvVars } from "@/features/envs/useActiveEnvVars";
import { buildVarCandidates } from "@/features/vars/candidates";
import { useMemo } from "react"; // merge with existing react import
```

Add an `originVars` prop to `CallPanelProps`:

```ts
  /** Variables of the draft's origin collection — feeds {{var}} autocomplete. */
  originVars?: Partial<Record<string, string>>;
```

Inside the component (only meaningful for the editable draft), build candidates:

```ts
  const activeEnvVars = useActiveEnvVars();
  const varCandidates = useMemo(
    () => (editable ? buildVarCandidates(activeEnvVars, originVars) : undefined),
    [editable, activeEnvVars, originVars],
  );
```

Pass to the editable header and request tabs:

```tsx
    <DraftAddressBar
      ...
      resolveAddress={varsResolverFor(step.collectionId)}
      resolveKey={addressResolveKey}
      variables={varCandidates}
    />
```

```tsx
          <RequestTabs
            step={step}
            serviceAuth={effectiveAuth}
            onBody={onBody}
            onMetadata={onMetadata}
            onSubmit={() => sendShortcutRef.current()}
            onResetTemplate={editable ? onResetBody : undefined}
            schema={schema}
            varCandidates={varCandidates}
          />
```

Update the destructure line: `export function CallPanel({ step, onPatch, onExecuted, editable, onQuickAddMethod, originAuth, originVars }: CallPanelProps)`.

- [ ] **Step 4: FocusView — derive `originVars`.** Next to the existing `originAuth` derivation (`tree.find((c) => c.id === origin.collectionId)?.auth`), add:

```ts
  const originVars = origin ? tree.find((c) => c.id === origin.collectionId)?.variables : undefined;
```

Pass it on the `<CallPanel ... originVars={originVars} />` element (next to `originAuth={originAuth}`).

- [ ] **Step 5: CollectionOverview — build + pass.** Add imports:

```ts
import { useActiveEnvVars } from "@/features/envs/useActiveEnvVars";
import { buildVarCandidates } from "@/features/vars/candidates";
```

After `varsRecord` is computed, build candidates (env + unsaved overlay rows so a just-added var is suggestable):

```ts
  const activeEnvVars = useActiveEnvVars();
  const varCandidates = useMemo(
    () => buildVarCandidates(activeEnvVars, varsRecord),
    [activeEnvVars, varsRecord],
  );
```

Pass to `<VariablesBlock ... variables={varCandidates} />` (the element around line 229–236).

- [ ] **Step 6: Typecheck + full suite.**

Run: `pnpm lint && pnpm test`
Expected: PASS (no type errors; all suites green).

- [ ] **Step 7: Commit**

```bash
git add src/features/workflow/CallPanel.tsx src/features/workflow/DraftAddressBar.tsx src/features/workflow/FocusView.tsx src/features/catalog/overview/VariablesBlock.tsx src/features/catalog/overview/CollectionOverview.tsx
git commit -m "feat: wire {{var}} candidates into address bar, body and collection vars editor"
```

---

## Task 13: Финальный гейт

**Files:** none (verification only).

- [ ] **Step 1: Tests.** Run: `pnpm test` — Expected: PASS (existing count + new specs).
- [ ] **Step 2: Typecheck.** Run: `pnpm lint` — Expected: PASS.
- [ ] **Step 3: Build.** Run: `pnpm build` — Expected: PASS (tsc -b + vite build).
- [ ] **Step 4: bindings no-drift.** `git status --porcelain src/ipc/bindings.ts` — Expected: empty (бэкенд/IPC не трогали).
- [ ] **Step 5:** Обновить баннер этого плана на «🎉 DONE» и строку «Active work» в
  `CLAUDE.md`; перенести план+спеку в `archive/` (`git mv`) одним коммитом
  `docs(archive): {{var}} autocomplete plan+spec`. Остаток — live WebView2-проход
  (тело: `{{` открывает список, Enter вставляет, `Send` проходит; адресная строка
  и поле значений коллекции — то же; русская раскладка; точечные имена).

---

## Self-Review

**Spec coverage** (каждый пункт спеки → задача):
- Источник кандидатов (env+collection, env-wins, overrides) → Task 1; проводка
  env через хук → Task 9; в поверхности → Task 12.
- Фильтр по партиалу / `openVarToken` (каретко-независимо, баг #5067) → Tasks 2–3.
- Тело (Monaco): расширение единого провайдера, var до schema-гейта, триггер `{{`,
  авто-`}}` → Tasks 5–7. Без схемы работает (var-branch до `if (!schema)`).
- `VarHighlightInput` дропдаун (позиция через mirror, клавиатура, a11y APG, вид A)
  → Tasks 10–11. Адрес + поле коллекции получают через проп `variables` → Task 12.
- Краевые: ноль кандидатов → не открывается (Task 11 тест + Task 6 `items.length`);
  нет env / нет коллекции → `buildVarCandidates` (Task 1); `}}` впереди →
  `applyVarPick`/`closingAhead` (Tasks 4,6); дубль → overrides (Task 1).
- Вне scope (auth/header, неактивные env, resolve-on-focus, бэкенд) — не трогаем.

**Placeholders:** нет «TBD/TODO»; весь код приведён.

**Type consistency:** `VarCandidate`/`VarOrigin` (Task 1) — единый источник;
`openVarToken`/`filterCandidates`/`applyVarPick` (Tasks 2–4) — единые сигнатуры,
переиспользуются в `completion.ts` (Tasks 5–6) и `VarHighlightInput` (Task 11);
`setModelVarCandidates` (Task 6) ↔ BodyView (Task 7); проп `varCandidates`
(BodyView/BodyEditor/RequestTabs/CallPanel) и `variables`
(VarHighlightInput/DraftAddressBar/VariablesBlock) — имена согласованы по цепочке;
`buildVarSuggestions(candidates, partial, closingAhead)` — одинаково в Task 5 и 6.
