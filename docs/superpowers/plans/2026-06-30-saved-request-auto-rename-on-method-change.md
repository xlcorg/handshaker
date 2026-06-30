# Умное авто-переименование сохранённого запроса при смене метода — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Когда у сохранённого (origin-bound) запроса меняют gRPC-метод, обновлять его имя в коллекции на имя нового метода — но только если имя всё ещё авто-выведенное (его не переименовывали вручную).

**Architecture:** Figma `autoRename` без persistent-флага. Чистый stateless-предикат `isAutoName` (зеркало существующего `isPristineBody`) определяет, «тронуто» ли имя. `CallPanel` отдаёт наверх новый колбэк `onMethodSelected(prev, next)`; `FocusView` (где живут `origin` + `renameItem` + дерево каталога) принимает решение и зовёт существующий `renameItem`. Бэкенд/IPC/bindings не трогаются.

**Tech Stack:** React 18 + TypeScript, Vitest + Testing Library, существующие модули `src/features/catalog/grouping.ts`, `src/features/workflow/{CallPanel,FocusView}.tsx`.

**Спека:** `docs/superpowers/specs/2026-06-30-saved-request-auto-rename-on-method-change-design.md`

---

## File Structure

- **`src/features/catalog/grouping.ts`** (modify) — добавить чистый предикат `isAutoName(name, service, method)` рядом с `suggestSaveTarget` (единый источник правды определения авто-имени).
- **`src/features/catalog/grouping.test.ts`** (modify) — юнит-тесты `isAutoName`.
- **`src/features/workflow/CallPanel.tsx`** (modify) — новый необязательный проп `onMethodSelected?(prev, next)`, который срабатывает в обработчике `onSelectMethod` после `applyMethodSelection`. Тонкая проводка producer'а.
- **`src/features/workflow/FocusView.tsx`** (modify) — обработчик `handleMethodSelected`: читает живое имя сохранённого запроса из дерева, проверяет `isAutoName` по СТАРОМУ методу, при совпадении зовёт `renameItem` с авто-именем НОВОГО метода. Передаёт колбэк в `CallPanel` только для origin-bound черновика.
- **`src/features/workflow/FocusView.test.tsx`** (modify) — расширить mock `CallPanel` (кнопка, дёргающая `onMethodSelected`) и mock `useCatalog` (`renameItem`/`moveItem`); 4 интеграционных теста.

**Почему `CallPanel.tsx` не получает свой vitest-тест:** `CallPanel.test.tsx` в проекте нет — `FocusView.test.tsx` мокает `CallPanel` целиком, а реальный `CallPanel` тащит `ResizablePanelGroup`, который падает вне Tauri (см. заметку проекта про resizable-форк). Проводка `onMethodSelected?.(prev, next)` — одна строка пасс-тру: проверяется `tsc -b` (типы пропа) + живым WebView2-проходом. Вся решающая логика (предикат + решение FocusView) покрыта юнитами/интеграцией.

---

## Task 1: Предикат `isAutoName`

**Files:**
- Modify: `src/features/catalog/grouping.ts`
- Test: `src/features/catalog/grouping.test.ts`

- [ ] **Step 1: Написать падающие тесты**

В `src/features/catalog/grouping.test.ts` заменить строку импорта на:

```ts
import { suggestSaveTarget, findSavedLocations, isAutoName } from "./grouping";
```

Добавить новый describe-блок (например, сразу после `describe("suggestSaveTarget", ...)`):

```ts
describe("isAutoName", () => {
  it("true when the name equals the method's auto-derived request name", () => {
    expect(isAutoName("Create", "notes.v1.NotesApiService", "Create")).toBe(true);
  });

  it("false when the name was customized away from the method", () => {
    expect(isAutoName("Create user", "notes.v1.NotesApiService", "Create")).toBe(false);
  });

  it("depends only on the method short name, not the service", () => {
    // suggestSaveTarget.requestName ignores the service entirely.
    expect(isAutoName("Delete", "a.b.FooService", "Delete")).toBe(true);
    expect(isAutoName("Delete", "totally.different.Svc", "Delete")).toBe(true);
  });

  it("treats a whitespace mismatch as a customized name", () => {
    expect(isAutoName("Create ", "x.S", "Create")).toBe(false);
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `pnpm test src/features/catalog/grouping.test.ts`
Expected: FAIL — `isAutoName is not a function` / `does not provide an export named 'isAutoName'`.

- [ ] **Step 3: Реализовать предикат**

В `src/features/catalog/grouping.ts` добавить после функции `suggestSaveTarget` (после строки 28):

```ts
/** True when `name` is still the auto-derived request name for `service`/`method` —
 *  i.e. it equals `suggestSaveTarget(...).requestName` and the user never renamed it.
 *  Mirrors `isPristineBody`: a stateless "is this still the default?" check, so a method
 *  switch can refresh the name only while the user hasn't taken ownership of it. */
export function isAutoName(name: string, service: string, method: string): boolean {
  return name === suggestSaveTarget(service, method).requestName;
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `pnpm test src/features/catalog/grouping.test.ts`
Expected: PASS — все тесты `suggestSaveTarget`, `findSavedLocations` и новый `isAutoName` зелёные.

- [ ] **Step 5: Коммит**

```bash
git add src/features/catalog/grouping.ts src/features/catalog/grouping.test.ts
git commit -m "feat(catalog): add isAutoName predicate (name still tracks the method)"
```

---

## Task 2: `CallPanel` отдаёт `onMethodSelected(prev, next)`

**Files:**
- Modify: `src/features/workflow/CallPanel.tsx`

Тонкая проводка producer'а — нового vitest-теста нет (см. «Почему CallPanel.tsx не получает свой vitest-тест» выше). Гейт — `tsc -b` + существующий suite остаётся зелёным; срабатывание проверяется живым проходом в Task 3-remainder.

- [ ] **Step 1: Добавить проп в интерфейс**

В `src/features/workflow/CallPanel.tsx`, в `interface CallPanelProps` (заканчивается на строке 48, после `originVars?`), добавить:

```ts
  /** Origin-bound only: a method was just picked. (prev, next) carry the service/method
   *  before and after the switch — lets the owner auto-rename the saved request when its
   *  name still tracks the old method. */
  onMethodSelected?: (
    prev: { service: string; method: string },
    next: { service: string; method: string },
  ) => void;
```

- [ ] **Step 2: Добавить в деструктуризацию пропсов**

Изменить сигнатуру функции (строка 51) — добавить `onMethodSelected` в деструктуризацию:

```ts
export function CallPanel({ step, onPatch, onExecuted, editable, onQuickAddMethod, originAuth, originVars, onMethodSelected }: CallPanelProps) {
```

- [ ] **Step 3: Дёрнуть колбэк после `applyMethodSelection`**

Заменить обработчик `onSelectMethod` в `DraftAddressBar` (строки 171–179) на:

```tsx
        onSelectMethod={(m) => {
          // Snapshot the pre-switch method BEFORE applyMethodSelection patches the draft,
          // so the owner can decide whether the saved name still tracked it.
          const prev = { service: step.service, method: step.method };
          void applyMethodSelection(
            onPatch,
            { address: step.address, tls: step.tls, collectionId: step.collectionId },
            { requestJson: step.requestJson, service: step.service, method: step.method },
            m,
            workflowStore.activeWorkflow().steps,
          );
          onMethodSelected?.(prev, { service: m.service, method: m.method });
        }}
```

- [ ] **Step 4: Гейт — тайпчек + полный suite зелёные**

Run: `pnpm lint` (= `tsc -b`)
Expected: PASS (нет ошибок типов — проп необязательный).

Run: `pnpm test`
Expected: PASS — существующие тесты не сломаны (новый колбэк необязателен и срабатывает только при выборе метода, которого существующие тесты не триггерят).

- [ ] **Step 5: Коммит**

```bash
git add src/features/workflow/CallPanel.tsx
git commit -m "feat(workflow): CallPanel surfaces onMethodSelected(prev,next)"
```

---

## Task 3: `FocusView` авто-переименовывает сохранённый запрос

**Files:**
- Modify: `src/features/workflow/FocusView.tsx`
- Test: `src/features/workflow/FocusView.test.tsx`

- [ ] **Step 1: Написать падающие интеграционные тесты**

В `src/features/workflow/FocusView.test.tsx`:

(1) Расширить mock `CallPanel` (строки 7–29) — добавить проп `onMethodSelected` в тип и кнопку, дёргающую его (prev = текущий метод шага, next = фиксированный `DeleteX`):

```tsx
vi.mock("./CallPanel", () => ({
  CallPanel: ({
    step,
    originAuth,
    onQuickAddMethod,
    onExecuted,
    onMethodSelected,
  }: {
    step: { service: string; method: string };
    originAuth?: { kind: string };
    onQuickAddMethod?: (service: string, method: string) => void;
    onExecuted?: (executed: unknown) => void;
    onMethodSelected?: (
      prev: { service: string; method: string },
      next: { service: string; method: string },
    ) => void;
  }) => (
    <div>
      <div>CALL:{step.method}</div>
      <div data-testid="origin-auth">{originAuth?.kind ?? ""}</div>
      <div data-testid="quickadd-wired">{onQuickAddMethod ? "yes" : "no"}</div>
      {/* Simulate CallPanel firing onExecuted (gated on shouldRecordExecuted = server responded). */}
      <button type="button" onClick={() => onExecuted?.(step)}>
        fire-executed
      </button>
      {/* Simulate a method switch: prev = current step method, next = a different method. */}
      <button
        type="button"
        onClick={() =>
          onMethodSelected?.(
            { service: step.service, method: step.method },
            { service: step.service, method: "DeleteX" },
          )
        }
      >
        fire-method-selected
      </button>
    </div>
  ),
}));
```

(2) Расширить mock `useCatalog` (строки 31–38) — добавить `renameItem` и `moveItem`:

```tsx
const cat = vi.hoisted(() => ({
  tree: [] as CollectionIpc[],
  duplicateItem: vi.fn(),
  bumpUsage: vi.fn(() => Promise.resolve()),
  renameItem: vi.fn(() => Promise.resolve()),
  moveItem: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/features/catalog/CatalogProvider", () => ({
  useCatalog: () => ({
    tree: cat.tree,
    duplicateItem: cat.duplicateItem,
    bumpUsage: cat.bumpUsage,
    renameItem: cat.renameItem,
    moveItem: cat.moveItem,
  }),
}));
```

(3) В `beforeEach` (строки 54–60) добавить сброс новых моков:

```tsx
  cat.renameItem.mockClear();
  cat.moveItem.mockClear();
```

(4) Добавить новый describe-блок (например, в конец файла перед закрывающей скобкой внешнего `describe`, либо отдельным top-level `describe`):

```tsx
describe("FocusView auto-rename on method change", () => {
  function boundTreeWithName(name: string): CollectionIpc[] {
    return [
      {
        id: "c1", name: "Notes", default_tls: false, skip_tls_verify: false,
        pinned: false, description: null, created_at: 0, variables: {}, auth: { kind: "none" },
        expanded: false,
        items: [
          {
            type: "request", id: "r1", name, address_template: "h:443",
            service: "p.S", method: "GetX", body_template: "{}", metadata: [],
            auth: { kind: "none" }, tls_override: null, last_used_at: null, use_count: 0,
          },
        ],
      },
    ];
  }

  it("renames an origin-bound request to the new method when its name still tracks the old method", async () => {
    const user = userEvent.setup();
    cat.tree = boundTreeWithName("GetX"); // == auto-name of the old method
    workflowStore.setDraft(
      newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }),
      { collectionId: "c1", requestId: "r1" },
    );
    renderFV();
    await user.click(screen.getByRole("button", { name: "fire-method-selected" }));
    expect(cat.renameItem).toHaveBeenCalledWith("c1", "r1", "DeleteX");
  });

  it("leaves a customized name untouched on method change", async () => {
    const user = userEvent.setup();
    cat.tree = boundTreeWithName("My favorite call");
    workflowStore.setDraft(
      newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }),
      { collectionId: "c1", requestId: "r1" },
    );
    renderFV();
    await user.click(screen.getByRole("button", { name: "fire-method-selected" }));
    expect(cat.renameItem).not.toHaveBeenCalled();
  });

  it("does not rename for an unbound draft (no saved request to rename)", async () => {
    const user = userEvent.setup();
    workflowStore.setDraft(newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }));
    renderFV();
    await user.click(screen.getByRole("button", { name: "fire-method-selected" }));
    expect(cat.renameItem).not.toHaveBeenCalled();
  });

  it("never moves the request between folders on method change", async () => {
    const user = userEvent.setup();
    cat.tree = boundTreeWithName("GetX");
    workflowStore.setDraft(
      newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }),
      { collectionId: "c1", requestId: "r1" },
    );
    renderFV();
    await user.click(screen.getByRole("button", { name: "fire-method-selected" }));
    expect(cat.moveItem).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Запустить тесты — убедиться, что падают**

Run: `pnpm test src/features/workflow/FocusView.test.tsx`
Expected: FAIL — тест «renames an origin-bound request…» падает (`cat.renameItem` не вызван), т.к. `FocusView` ещё не передаёт `onMethodSelected`. Остальные три (assert NOT called) пройдут уже сейчас — это сторожевые тесты.

- [ ] **Step 3: Реализовать обработчик и проводку в `FocusView`**

В `src/features/workflow/FocusView.tsx` добавить импорты (рядом с существующими, строки 5–8):

```ts
import { findSavedRequest } from "@/features/catalog/treeNav";
import { isAutoName, suggestSaveTarget } from "@/features/catalog/grouping";
```

Добавить `renameItem` в деструктуризацию `useCatalog` (строка 25):

```ts
  const { tree, duplicateItem, bumpUsage, renameItem } = useCatalog();
```

Добавить обработчик (например, сразу после функции `duplicate`, до вычисления `originAuth`):

```ts
  // Figma-style autoRename: when the method changes on an origin-bound request whose name
  // is still the auto-derived one (== the OLD method's name), refresh it to the NEW method's
  // name. A customized name is left untouched. Name only — never moves the request's folder.
  // The breadcrumb + tree reflect it live (pathNamesToItem reads the catalog).
  const handleMethodSelected = (
    prev: { service: string; method: string },
    next: { service: string; method: string },
  ) => {
    if (!origin) return;
    const saved = findSavedRequest(tree, origin.collectionId, origin.requestId);
    if (!saved || !isAutoName(saved.name, prev.service, prev.method)) return;
    const newName = suggestSaveTarget(next.service, next.method).requestName;
    if (newName === saved.name) return; // no-op if the auto-name is unchanged
    void renameItem(origin.collectionId, origin.requestId, newName).catch(() => {});
  };
```

Передать колбэк в `CallPanel` (в JSX, рядом с `onQuickAddMethod`, строки 125–127) — только для origin-bound черновика:

```tsx
            onMethodSelected={origin ? handleMethodSelected : undefined}
```

- [ ] **Step 4: Запустить тесты — убедиться, что проходят**

Run: `pnpm test src/features/workflow/FocusView.test.tsx`
Expected: PASS — все 4 новых теста + существующие тесты `FocusView` зелёные.

- [ ] **Step 5: Полный гейт проекта**

Run: `pnpm lint` (= `tsc -b`)
Expected: PASS.

Run: `pnpm test`
Expected: PASS — весь suite зелёный.

Run: `pnpm build` (tsc + vite build)
Expected: PASS.

- [ ] **Step 6: Коммит**

```bash
git add src/features/workflow/FocusView.tsx src/features/workflow/FocusView.test.tsx
git commit -m "feat(workflow): auto-rename origin-bound request when method changes"
```

---

## Заметка про гонку с автосейвом (анализ, не отдельный тест)

Спека отметила риск «авто-rename vs автосейв контента». Разбор показывает, что клобера нет:

- `renameItem` обновляет общий `treeRef` **синхронно** (оптимистичный апдейт), в том же тике, что и смена метода.
- Автосейв контента (`useAutosaveDraft`) дебаунсится на 500 мс; когда он срабатывает, `updateItemContent` → `replaceItemInTree` обновляет service/method/тело, но **сохраняет имя из текущего `treeRef`** (а там уже новое имя), затем `collectionUpsert` пишет всю коллекцию с новым именем.
- Порядок IPC между `collection_rename_item` и `collection_upsert` не важен: payload upsert'а уже содержит новое имя (читается из `treeRef`), так что оба пути сходятся к новому имени.

То есть «сохранение имени» — встроенный инвариант `replaceItemInTree` (он всегда переносит существующее `name`), а не то, что нужно покрывать отдельным таймерным тестом. Поведение подтверждается живым WebView2-проходом ниже. `origin.requestName` в сторе остаётся прежним (это лишь fallback брэдкрамба, когда дерево не нашло запрос) — ровно как и при ручном переименовании через дерево; трогать стор не нужно.

---

## Остаток после реализации (live WebView2-проход)

`pnpm tauri:dev`, затем:

1. Открыть сохранённый запрос с авто-именем (имя == метод) → сменить метод в MethodPicker → имя в дереве коллекций и в брэдкрамбе Focus обновилось на новый метод (всплыл тост `Renamed to "…"`).
2. Переименовать запрос вручную в дереве → сменить метод → имя осталось кастомным (не переименовалось).
3. Несохранённый черновик → смена метода ничего не переименовывает (имя выбирается при Save).
4. Запрос лежит в папке → после смены метода остался в той же папке (не переехал).
```
