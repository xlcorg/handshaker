# Draft Address-Bar Redesign — Implementation Plan

> **Status banner:** ✅ **done** (реализовано: `c16d48f` redesign DraftAddressBar —
> TLS-замок в host, full-width picker, refresh в дропдаун; `e49fa95` ReflectionFooter;
> + полиш `57b6902`/`a275854`/`d5a6b84`) · branch `redesign/workflow-ui-spec-plans` ·
> mode subagent-driven. У плана не было статус-баннера; работа влита, файл архивирован.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перекомпоновать верх окна черновика под раскладку gRPC-запроса Postman — хедер с брэдкрамбом и Save-иконкой, строка адреса с тихим замком TLS внутри host, `MethodPicker` на всю ширину с плейсхолдером и футером рефлексии (куда переезжает кнопка обновления контракта).

**Architecture:** Чисто фронтенд (React 18 + TS), бэкенд/IPC и модель `Step` не трогаем. Логику дробим на тестируемые единицы: pure-хелпер брэдкрамба (`draftHeader.ts`), презентационный `ReflectionFooter`, расширение `DraftOrigin` (UI-стор) опциональными именами. `MethodPicker` — single-consumer (только `DraftAddressBar`), поэтому сигнатуру меняем свободно.

**Tech Stack:** React 18, TypeScript, Tailwind, Radix (`DropdownMenu`, `Tooltip`), lucide-react, Vitest + Testing Library.

**Спека:** `docs/superpowers/specs/2026-06-05-draft-address-bar-redesign-design.md`

**Команда тестов:** `pnpm test <path>` (это `vitest run <path>`). Фильтр по имени: `pnpm test <path> -t "<name>"`.

**Ветка:** `redesign/workflow-ui-spec-plans` (текущая). В рабочей копии есть несвязанные правки `actions.ts`/`useDraftReflection.ts` (resolveAddressSafe) — **не** коммитить их вместе с задачами плана; каждый коммит ниже добавляет только свои файлы по имени.

---

## File Structure

**Создаём:**
- `src/features/workflow/draftHeader.ts` — pure-хелпер `draftBreadcrumb(draft, origin)`.
- `src/features/workflow/draftHeader.test.ts` — тест хелпера.
- `src/features/workflow/ReflectionFooter.tsx` — презентационный футер статуса рефлексии + reload.
- `src/features/workflow/ReflectionFooter.test.tsx` — тест футера.
- `src/features/shell/MethodPicker.test.tsx` — тест плейсхолдера/nullable-каталога.

**Модифицируем:**
- `src/features/workflow/store.ts` — `DraftOrigin` + опциональные `collectionName`/`requestName`.
- `src/features/catalog/actions.ts` — `openSavedRequest` кладёт `requestName`.
- `src/features/catalog/actions.test.ts` — обновить ожидание origin.
- `src/app/WorkflowApp.tsx` — `handleSave` кладёт `collectionName`/`requestName`.
- `src/features/workflow/FocusView.tsx` — хедер: брэдкрамб + Save-иконка + dirty-точка.
- `src/features/workflow/FocusView.test.tsx` — новые проверки хедера.
- `src/features/shell/MethodPicker.tsx` — `catalog` nullable, плейсхолдер, опциональный футер.
- `src/features/workflow/DraftAddressBar.tsx` — замок TLS внутри host, full-width picker, убрать standalone refresh/статус-текст, проброс footer + `onTls`.
- `src/features/workflow/DraftAddressBar.test.tsx` — переписать под новый бар.
- `src/features/workflow/CallPanel.tsx` — проброс `onTls` + `reflection` в `DraftAddressBar`.
- `src/features/workflow/CallPanel.editable.test.tsx` — проверка проброса TLS.

---

## Task 1: `DraftOrigin` имена + хелпер брэдкрамба

**Files:**
- Modify: `src/features/workflow/store.ts:6-9` (интерфейс `DraftOrigin`)
- Create: `src/features/workflow/draftHeader.ts`
- Test: `src/features/workflow/draftHeader.test.ts`

- [ ] **Step 1: Расширить `DraftOrigin` опциональными именами**

В `src/features/workflow/store.ts` заменить интерфейс:

```ts
export interface DraftOrigin {
  collectionId: string;
  requestId: string;
  /** Display names for the header breadcrumb; absent for legacy/unknown origins. */
  collectionName?: string;
  requestName?: string;
}
```

- [ ] **Step 2: Написать падающий тест хелпера**

Create `src/features/workflow/draftHeader.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { draftBreadcrumb } from "./draftHeader";
import { newStep } from "./model";

const draft = newStep({
  address: "h:443", tls: false, service: "pkg.v1.NotesService", method: "Create",
});

describe("draftBreadcrumb", () => {
  it("returns 'New request' for an unbound draft", () => {
    expect(draftBreadcrumb(draft, null)).toBe("New request");
  });

  it("returns 'Collection › Name' when both names are known", () => {
    expect(
      draftBreadcrumb(draft, {
        collectionId: "c1", requestId: "r1", collectionName: "Notes", requestName: "Create note",
      }),
    ).toBe("Notes › Create note");
  });

  it("uses the request name alone when collection name is missing", () => {
    expect(
      draftBreadcrumb(draft, { collectionId: "c1", requestId: "r1", requestName: "Create note" }),
    ).toBe("Create note");
  });

  it("falls back to service / method when origin has no names", () => {
    expect(draftBreadcrumb(draft, { collectionId: "c1", requestId: "r1" })).toBe(
      "NotesService / Create",
    );
  });
});
```

- [ ] **Step 3: Запустить тест — убедиться, что падает**

Run: `pnpm test src/features/workflow/draftHeader.test.ts`
Expected: FAIL — `draftBreadcrumb` не существует (модуль не найден).

- [ ] **Step 4: Реализовать хелпер**

Create `src/features/workflow/draftHeader.ts`:

```ts
import { shortService } from "@/features/shell/SelectedMethod";
import type { Step } from "./model";
import type { DraftOrigin } from "./store";

/** Header breadcrumb label for the draft window. Unbound → "New request";
 *  bound → "Collection › Name" when names are known, else a label derived from the call. */
export function draftBreadcrumb(draft: Step, origin: DraftOrigin | null): string {
  if (!origin) return "New request";
  if (origin.requestName) {
    return origin.collectionName
      ? `${origin.collectionName} › ${origin.requestName}`
      : origin.requestName;
  }
  const svc = shortService(draft.service);
  return draft.method ? `${svc} / ${draft.method}` : svc || "Saved request";
}
```

- [ ] **Step 5: Запустить тест — убедиться, что проходит**

Run: `pnpm test src/features/workflow/draftHeader.test.ts`
Expected: PASS (4 теста).

- [ ] **Step 6: Commit**

```bash
git add src/features/workflow/store.ts src/features/workflow/draftHeader.ts src/features/workflow/draftHeader.test.ts
git commit -m "feat(workflow): DraftOrigin display names + draftBreadcrumb helper"
```

---

## Task 2: Проброс имён origin в точках сохранения

**Files:**
- Modify: `src/features/catalog/actions.ts:8-11` (`openSavedRequest`)
- Modify: `src/features/catalog/actions.test.ts:34` (ожидание origin)
- Modify: `src/app/WorkflowApp.tsx:106-115` (`handleSave`)

- [ ] **Step 1: Обновить тест `openSavedRequest` (ожидать requestName)**

В `src/features/catalog/actions.test.ts` заменить строку ожидания origin:

```ts
    expect(workflowStore.getState().draftOrigin).toEqual({
      collectionId: "c1", requestId: "req-1", requestName: "GetX",
    });
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `pnpm test src/features/catalog/actions.test.ts -t "loads a saved request"`
Expected: FAIL — origin пока без `requestName`.

- [ ] **Step 3: Положить `requestName` в origin при открытии сохранённого реквеста**

В `src/features/catalog/actions.ts` заменить тело `openSavedRequest`:

```ts
export function openSavedRequest(collectionId: string, saved: SavedRequestIpc): void {
  workflowStore.update((w) => setView(w, "focus"));
  workflowStore.setDraft(savedRequestToDraft(saved), {
    collectionId, requestId: saved.id, requestName: saved.name,
  });
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `pnpm test src/features/catalog/actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Положить имена в origin при сохранении нового реквеста**

В `src/app/WorkflowApp.tsx`, в `handleSave`, заменить строку `setDraftOrigin`:

```ts
    const id = await saveNewRequest(cat.addItem, current, dest);
    const collectionName = cat.tree.find((c) => c.id === dest.collectionId)?.name;
    workflowStore.setDraftOrigin({
      collectionId: dest.collectionId, requestId: id, collectionName, requestName: dest.name,
    });
```

- [ ] **Step 6: Проверить типы/сборку (это wiring внутри большого компонента — изолированного юнит-теста нет)**

Run: `pnpm test src/features/catalog/actions.test.ts && pnpm tsc --noEmit`
Expected: тесты PASS; `tsc` без ошибок (если в проекте нет скрипта `tsc`, использовать `pnpm build` либо `pnpm exec tsc --noEmit`).

- [ ] **Step 7: Commit**

```bash
git add src/features/catalog/actions.ts src/features/catalog/actions.test.ts src/app/WorkflowApp.tsx
git commit -m "feat(workflow): carry collection/request names into DraftOrigin at save sites"
```

---

## Task 3: Хедер `FocusView` (брэдкрамб + Save-иконка + dirty-точка)

**Files:**
- Modify: `src/features/workflow/FocusView.tsx` (целиком)
- Test: `src/features/workflow/FocusView.test.tsx` (добавить кейсы)

- [ ] **Step 1: Добавить падающие тесты хедера**

В `src/features/workflow/FocusView.test.tsx` добавить внутрь `describe("FocusView Save affordance", …)` после существующих кейсов:

```ts
  it("shows the breadcrumb 'New request' for an unbound draft", () => {
    workflowStore.setDraft(newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }));
    render(<FocusView onRequestSave={vi.fn()} />);
    expect(screen.getByTestId("draft-breadcrumb")).toHaveTextContent("New request");
  });

  it("shows a dirty dot once the unbound draft is edited", () => {
    workflowStore.setDraft(newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }));
    workflowStore.updateDraft({ requestJson: '{"a":1}' });
    render(<FocusView onRequestSave={vi.fn()} />);
    expect(screen.getByTestId("draft-dirty-dot")).toBeInTheDocument();
  });

  it("shows the collection breadcrumb for a bound draft", () => {
    workflowStore.setDraft(
      newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }),
      { collectionId: "c1", requestId: "r1", collectionName: "Notes", requestName: "Create" },
    );
    render(<FocusView onRequestSave={vi.fn()} />);
    expect(screen.getByTestId("draft-breadcrumb")).toHaveTextContent("Notes › Create");
  });
```

- [ ] **Step 2: Запустить тесты — убедиться, что падают**

Run: `pnpm test src/features/workflow/FocusView.test.tsx`
Expected: FAIL — нет `draft-breadcrumb` / `draft-dirty-dot`.

- [ ] **Step 3: Переписать `FocusView` с хедером**

Заменить весь `src/features/workflow/FocusView.tsx`:

```tsx
import { Save } from "lucide-react";
import { CallPanel } from "./CallPanel";
import { useDraft, useDraftDirty, useDraftOrigin, workflowStore } from "./store";
import { draftBreadcrumb } from "./draftHeader";
import type { Step } from "./model";

export interface FocusViewProps {
  /** Open the Save dialog for the current unbound draft (Ctrl+S / the Save button). */
  onRequestSave?: () => void;
}

export function FocusView({ onRequestSave }: FocusViewProps = {}) {
  const draft = useDraft();
  const origin = useDraftOrigin();
  const dirty = useDraftDirty();

  return (
    <div className="flex h-full min-h-0 flex-col">
      {draft && (
        <div className="flex h-9 items-center justify-between gap-2 border-b border-border px-3 text-xs">
          <span className="min-w-0 truncate text-muted-foreground" data-testid="draft-breadcrumb">
            {draftBreadcrumb(draft, origin)}
          </span>
          {origin ? (
            <span className="text-muted-foreground" data-testid="autosave-status">
              Сохранено
            </span>
          ) : (
            <button
              type="button"
              aria-label="Сохранить"
              onClick={() => onRequestSave?.()}
              className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-0.5 hover:bg-accent"
            >
              <Save className="size-3.5" />
              Сохранить
              {dirty && (
                <span
                  data-testid="draft-dirty-dot"
                  className="ml-0.5 size-1.5 rounded-full bg-warn"
                  aria-hidden
                />
              )}
            </button>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1">
        {draft ? (
          <CallPanel
            step={draft}
            onPatch={(patch: Partial<Step>) => workflowStore.updateDraft(patch)}
            onExecuted={(executed: Step) => workflowStore.commitExecutedStep(executed)}
            editable
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Нет активного реквеста — выбери метод в сайдбаре или нажми ⌘K.
          </div>
        )}
      </div>
    </div>
  );
}
```

Примечание: сохранены `aria-label="Сохранить"` и `data-testid="autosave-status"`, поэтому существующие кейсы остаются зелёными. `bg-warn` уже используется в проекте (`MethodPicker` KindDot, client-stream).

- [ ] **Step 4: Запустить тесты — убедиться, что проходят**

Run: `pnpm test src/features/workflow/FocusView.test.tsx`
Expected: PASS (исходные 3 + новые 3).

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/FocusView.tsx src/features/workflow/FocusView.test.tsx
git commit -m "feat(workflow): FocusView header — breadcrumb, Save icon, dirty dot"
```

---

## Task 4: `MethodPicker` — nullable каталог + плейсхолдер «Select a method»

**Files:**
- Modify: `src/features/shell/MethodPicker.tsx:14-69` (props, groups, триггер)
- Test: `src/features/shell/MethodPicker.test.tsx` (создать)

- [ ] **Step 1: Написать падающие тесты**

Create `src/features/shell/MethodPicker.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MethodPicker } from "./MethodPicker";
import type { SelectedMethod } from "./SelectedMethod";

const empty: SelectedMethod = { service: "", method: "", kind: "unary" };

describe("MethodPicker trigger", () => {
  it("shows the 'Select a method' placeholder when nothing is selected", () => {
    render(<MethodPicker selected={empty} catalog={null} onSelect={vi.fn()} />);
    expect(screen.getByText("Select a method")).toBeInTheDocument();
  });

  it("shows the method name when a method is selected (even without catalog)", () => {
    render(
      <MethodPicker
        selected={{ service: "p.v1.S", method: "GetX", kind: "unary" }}
        catalog={null}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("GetX")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm test src/features/shell/MethodPicker.test.tsx`
Expected: FAIL — сейчас `catalog` обязателен и нет плейсхолдера (рантайм-ошибка на `catalog.services` при `null`, либо отсутствие текста).

- [ ] **Step 3: Сделать `catalog` nullable и добавить плейсхолдер в триггер**

В `src/features/shell/MethodPicker.tsx`:

(a) В `MethodPickerProps` заменить тип каталога:

```ts
  catalog: ServiceCatalogIpc | null;
```

(b) В `useMemo` для `groups` заменить первую строку источника сервисов — было `catalog.services`, стало защищённо:

```ts
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (catalog?.services ?? [])
      .map((svc) => ({
```

(остальное тело `useMemo` без изменений).

(c) Заменить блок `const triggerLabel = (…)` на ветвление по наличию метода:

```tsx
  const hasMethod = selected.method.trim().length > 0;
  const triggerLabel = hasMethod ? (
    <>
      <Box className="size-3 text-muted-foreground flex-none" />
      <span className="text-muted-foreground truncate" style={{ maxWidth: maxLabel }}>
        {shortService(selected.service)}
      </span>
      <span className="text-muted-foreground/50">/</span>
      <span className="text-foreground font-medium truncate" style={{ maxWidth: maxLabel }}>
        {selected.method}
      </span>
      {selected.kind !== "unary" && <KindBadge kind={selected.kind} />}
      <ChevronDown className="size-2.5 text-muted-foreground/70 ml-0.5 flex-none" />
    </>
  ) : (
    <>
      <Box className="size-3 text-muted-foreground flex-none" />
      <span className="text-muted-foreground truncate">Select a method</span>
      <ChevronDown className="size-2.5 text-muted-foreground/70 ml-auto flex-none" />
    </>
  );
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `pnpm test src/features/shell/MethodPicker.test.tsx`
Expected: PASS.

- [ ] **Step 5: Прогнать соседние тесты на регресс**

Run: `pnpm test src/features/workflow/DraftAddressBar.test.tsx`
Expected: PASS (триггер с методом «GetX» по-прежнему рендерится).

- [ ] **Step 6: Commit**

```bash
git add src/features/shell/MethodPicker.tsx src/features/shell/MethodPicker.test.tsx
git commit -m "feat(shell): MethodPicker accepts null catalog + 'Select a method' placeholder"
```

---

## Task 5: `ReflectionFooter` + футер рефлексии в `MethodPicker`

**Files:**
- Create: `src/features/workflow/ReflectionFooter.tsx`
- Test: `src/features/workflow/ReflectionFooter.test.tsx`
- Modify: `src/features/shell/MethodPicker.tsx` (новый опциональный проп + рендер футера)

- [ ] **Step 1: Написать падающий тест футера**

Create `src/features/workflow/ReflectionFooter.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReflectionFooter } from "./ReflectionFooter";

describe("ReflectionFooter", () => {
  it("shows 'Reflecting…' while loading", () => {
    render(<ReflectionFooter loading error={null} onRefresh={vi.fn()} />);
    expect(screen.getByText("Reflecting…")).toBeInTheDocument();
  });

  it("shows the error text when reflection failed", () => {
    render(<ReflectionFooter loading={false} error="no reflection here" onRefresh={vi.fn()} />);
    expect(screen.getByText("no reflection here")).toBeInTheDocument();
  });

  it("shows the reflection status and fires refresh", () => {
    const onRefresh = vi.fn();
    render(<ReflectionFooter loading={false} error={null} onRefresh={onRefresh} />);
    expect(screen.getByText("Using server reflection")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("refresh-reflection"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm test src/features/workflow/ReflectionFooter.test.tsx`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать `ReflectionFooter`**

Create `src/features/workflow/ReflectionFooter.tsx`:

```tsx
import { RefreshCw } from "lucide-react";

export interface ReflectionFooterProps {
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

/** Status + reload row at the bottom of the draft method dropdown. Mirrors Postman's
 *  "Using server reflection ⟳" — the refresh action lives here, not on the address bar. */
export function ReflectionFooter({ loading, error, onRefresh }: ReflectionFooterProps) {
  return (
    <div className="flex items-center gap-2 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
      {loading ? (
        <>
          <RefreshCw className="size-3 animate-spin" aria-hidden /> Reflecting…
        </>
      ) : error ? (
        <span className="truncate text-destructive">{error}</span>
      ) : (
        <>
          <span className="truncate">Using server reflection</span>
          <button
            type="button"
            aria-label="refresh-reflection"
            onClick={onRefresh}
            className="ml-auto inline-flex hover:text-foreground"
          >
            <RefreshCw className="size-3" />
          </button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `pnpm test src/features/workflow/ReflectionFooter.test.tsx`
Expected: PASS (3 теста).

- [ ] **Step 5: Подключить футер в `MethodPicker` (опциональный проп)**

В `src/features/shell/MethodPicker.tsx`:

(a) Импорт сверху:

```ts
import { ReflectionFooter } from "@/features/workflow/ReflectionFooter";
```

(b) В `MethodPickerProps` добавить поле:

```ts
  /** Draft-only: status + reload row at the bottom of the dropdown. Omit to hide. */
  reflection?: { loading: boolean; error: string | null; onRefresh: () => void };
```

(c) В сигнатуре деструктуризации добавить `reflection`:

```ts
export function MethodPicker({ selected, catalog, onSelect, maxLabel = 160, className, reflection }: MethodPickerProps) {
```

(d) Внутри `<DropdownMenuContent …>` после блока со списком (`<div className="max-h-[360px] …">…</div>`), перед закрытием `</DropdownMenuContent>`, добавить:

```tsx
        {reflection && (
          <ReflectionFooter
            loading={reflection.loading}
            error={reflection.error}
            onRefresh={reflection.onRefresh}
          />
        )}
```

- [ ] **Step 6: Запустить — убедиться, что ничего не сломалось**

Run: `pnpm test src/features/shell/MethodPicker.test.tsx`
Expected: PASS (футер закрыт, пока дропдаун закрыт; рендер-логика футера покрыта `ReflectionFooter.test`).

- [ ] **Step 7: Commit**

```bash
git add src/features/workflow/ReflectionFooter.tsx src/features/workflow/ReflectionFooter.test.tsx src/features/shell/MethodPicker.tsx
git commit -m "feat(workflow): ReflectionFooter + wire optional reflection footer into MethodPicker"
```

---

## Task 6: Редизайн `DraftAddressBar`

**Files:**
- Modify: `src/features/workflow/DraftAddressBar.tsx` (целиком)
- Test: `src/features/workflow/DraftAddressBar.test.tsx` (переписать)

- [ ] **Step 1: Переписать тест под новый бар**

Заменить весь `src/features/workflow/DraftAddressBar.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DraftAddressBar } from "./DraftAddressBar";
import { newStep } from "./model";

const base = newStep({ address: "h:443", tls: true, service: "p.v1.S", method: "GetX" });
const cat = { services: [{ full_name: "p.v1.S", methods: [
  { name: "GetX", path: "/p.v1.S/GetX", input_message: "Req", output_message: "Res",
    client_streaming: false, server_streaming: false },
] }] };

function props(over = {}) {
  return {
    step: base, catalog: null, reflecting: false, reflectError: null,
    onAddress: vi.fn(), onTls: vi.fn(), onRefresh: vi.fn(), onSelectMethod: vi.fn(),
    onSend: vi.fn(), onCancel: vi.fn(), ...over,
  };
}

describe("DraftAddressBar", () => {
  it("edits the address", () => {
    const p = props();
    render(<DraftAddressBar {...p} />);
    fireEvent.change(screen.getByLabelText("draft-address"), { target: { value: "newhost:8080" } });
    expect(p.onAddress).toHaveBeenCalledWith("newhost:8080");
  });

  it("toggles TLS via the lock (enabled → off)", () => {
    const p = props(); // base.tls === true
    render(<DraftAddressBar {...p} />);
    fireEvent.click(screen.getByLabelText("TLS enabled"));
    expect(p.onTls).toHaveBeenCalledWith(false);
  });

  it("toggles TLS via the lock (plaintext → on)", () => {
    const p = props({ step: { ...base, tls: false } });
    render(<DraftAddressBar {...p} />);
    fireEvent.click(screen.getByLabelText("Plaintext"));
    expect(p.onTls).toHaveBeenCalledWith(true);
  });

  it("shows the 'Select a method' placeholder when no method is chosen", () => {
    render(<DraftAddressBar {...props({ step: { ...base, method: "" } })} />);
    expect(screen.getByText("Select a method")).toBeInTheDocument();
  });

  it("renders the MethodPicker trigger when a method is set", () => {
    render(<DraftAddressBar {...props({ catalog: cat })} />);
    expect(screen.getByText("GetX")).toBeInTheDocument();
  });

  it("disables Send until a method is chosen", () => {
    render(<DraftAddressBar {...props({ step: { ...base, method: "" } })} />);
    expect((screen.getByRole("button", { name: /send/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("fires Send when a method is set", () => {
    const p = props();
    render(<DraftAddressBar {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(p.onSend).toHaveBeenCalledTimes(1);
  });

  it("has no standalone refresh button in the bar (refresh lives in the dropdown)", () => {
    render(<DraftAddressBar {...props({ catalog: cat })} />);
    expect(screen.queryByLabelText("refresh-reflection")).toBeNull();
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm test src/features/workflow/DraftAddressBar.test.tsx`
Expected: FAIL — нет `onTls`/замка, есть лишние элементы.

- [ ] **Step 3: Переписать `DraftAddressBar`**

Заменить весь `src/features/workflow/DraftAddressBar.tsx`:

```tsx
import { Lock, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { MethodPicker } from "@/features/shell/MethodPicker";
import type { SelectedMethod } from "@/features/shell/SelectedMethod";
import type { ServiceCatalogIpc } from "@/ipc/bindings";
import type { Step } from "./model";

export interface DraftAddressBarProps {
  step: Step;
  catalog: ServiceCatalogIpc | null;
  reflecting: boolean;
  reflectError: string | null;
  onAddress: (address: string) => void;
  onTls: (tls: boolean) => void;
  onRefresh: () => void;
  onSelectMethod: (m: SelectedMethod) => void;
  onSend: () => void;
  onCancel: () => void;
}

/** Editable Focus header for a draft: TLS lock + host → full-width MethodPicker → Send.
 *  Reflection status & reload live inside the MethodPicker dropdown (Postman-style). */
export function DraftAddressBar({
  step, catalog, reflecting, reflectError,
  onAddress, onTls, onRefresh, onSelectMethod, onSend, onCancel,
}: DraftAddressBarProps) {
  const sending = step.status === "sending";
  return (
    <div className="flex h-14 items-center gap-2 border-b border-border px-4">
      <div className="flex h-8 flex-none items-center gap-1.5 rounded-md border border-input bg-background pl-2 pr-1 focus-within:ring-1 focus-within:ring-ring">
        <Tooltip
          content={step.tls ? "TLS enabled — click to switch to plaintext" : "Plaintext — click to enable TLS"}
        >
          <button
            type="button"
            onClick={() => onTls(!step.tls)}
            aria-label={step.tls ? "TLS enabled" : "Plaintext"}
            className="flex flex-none items-center text-muted-foreground hover:text-foreground"
          >
            {step.tls ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
          </button>
        </Tooltip>
        <Input
          aria-label="draft-address"
          value={step.address}
          onChange={(e) => onAddress(e.target.value)}
          placeholder="host:port"
          className="h-7 w-44 border-0 bg-transparent px-1 font-mono text-xs focus-visible:ring-0"
        />
      </div>
      <MethodPicker
        selected={{ service: step.service, method: step.method, kind: "unary" }}
        catalog={catalog}
        onSelect={onSelectMethod}
        reflection={{ loading: reflecting, error: reflectError, onRefresh }}
        className="flex-1 justify-between"
      />
      {sending ? (
        <Button size="sm" variant="outline" onClick={onCancel}>
          ✕ Cancel
        </Button>
      ) : null}
      <Button size="sm" onClick={onSend} disabled={sending || step.method.trim().length === 0}>
        {sending ? "Sending…" : "▶ Send"}
      </Button>
    </div>
  );
}
```

Примечание: `className="flex-1 justify-between"` делает триггер `MethodPicker` растягивающимся на всё свободное место с шевроном у правого края (триггер — `inline-flex`, `flex-1` задаёт рост внутри flex-строки бара).

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `pnpm test src/features/workflow/DraftAddressBar.test.tsx`
Expected: PASS (8 тестов).

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/DraftAddressBar.tsx src/features/workflow/DraftAddressBar.test.tsx
git commit -m "feat(workflow): redesign DraftAddressBar — TLS lock in host, full-width picker, refresh moved to dropdown"
```

---

## Task 7: Проброс `onTls` + `reflection` из `CallPanel`

**Files:**
- Modify: `src/features/workflow/CallPanel.tsx:56-72` (заголовок editable)
- Test: `src/features/workflow/CallPanel.editable.test.tsx` (добавить кейс)

- [ ] **Step 1: Добавить падающий тест проброса TLS**

В `src/features/workflow/CallPanel.editable.test.tsx` добавить импорт `fireEvent` (в первой строке RTL) и новый кейс. Заменить строку импорта RTL:

```ts
import { render, screen, fireEvent } from "@testing-library/react";
```

Добавить кейс внутрь `describe("CallPanel editable", …)`:

```ts
  it("toggles TLS through onPatch from the draft header", () => {
    const onPatch = vi.fn();
    render(<CallPanel step={draft} onPatch={onPatch} editable />);
    // draft.tls === true → lock shows "TLS enabled"; clicking switches to plaintext
    fireEvent.click(screen.getByLabelText("TLS enabled"));
    expect(onPatch).toHaveBeenCalledWith({ tls: false });
  });
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm test src/features/workflow/CallPanel.editable.test.tsx`
Expected: FAIL — `DraftAddressBar` пока не получает `onTls`, замок не вызывает `onPatch`.

- [ ] **Step 3: Пробросить `onTls` в `DraftAddressBar`**

В `src/features/workflow/CallPanel.tsx` в блоке `editable ? (<DraftAddressBar … />)` добавить проп `onTls` (после `onAddress`):

```tsx
      onAddress={(address) => onPatch({ address })}
      onTls={(tls) => onPatch({ tls })}
```

(пропсы `catalog/reflecting/reflectError/onRefresh` уже передаются — менять не нужно.)

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `pnpm test src/features/workflow/CallPanel.editable.test.tsx`
Expected: PASS.

- [ ] **Step 5: Прогнать всю workflow-папку + shell на регресс**

Run: `pnpm test src/features/workflow src/features/shell`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/workflow/CallPanel.tsx src/features/workflow/CallPanel.editable.test.tsx
git commit -m "feat(workflow): wire TLS toggle from CallPanel draft header"
```

---

## Финальная проверка

- [ ] **Прогнать весь тест-сьют**

Run: `pnpm test`
Expected: всё зелёное.

- [ ] **Проверить типы/сборку**

Run: `pnpm build` (или `pnpm exec tsc --noEmit`)
Expected: без ошибок типов.

- [ ] **Визуальная проверка (опционально, если нужен запуск приложения)**

Запустить dev-приложение, открыть черновик: замок TLS внутри host слева; `Select a method` растянут; в дропдауне снизу «Using server reflection ⟳»; в хедере брэдкрамб + 💾 Сохранить с жёлтой точкой при правках.

---

## Self-Review (выполнено при написании плана)

**Покрытие спеки:**
- §Хедер (брэдкрамб + Save-иконка + dirty-точка) → Task 1 (брэдкрамб), Task 2 (имена), Task 3 (UI).
- §Строка адреса: замок TLS внутри host → Task 6 + Task 7 (проброс); full-width picker → Task 4 + Task 6; убрать standalone refresh → Task 6.
- §Дропдаун: nullable каталог + плейсхолдер → Task 4; футер рефлексии → Task 5.
- §Поведение (пустой адрес/loading/error/TLS-перезапрос) → покрыто `ReflectionFooter.test` + `MethodPicker.test` + `DraftAddressBar.test`; авто-перезапрос по `tls` уже в `useDraftReflection` (не трогаем).
- §Не делаем (skip_verify, нижний сплит, логика автосейва) → вне задач.

**Плейсхолдеры:** нет — весь код приведён целиком.

**Согласованность типов:** `DraftOrigin` (collectionName?/requestName?) одинаково используется в Task 1/2/3; проп `reflection: {loading,error,onRefresh}` совпадает в `MethodPicker` (Task 5) и `DraftAddressBar` (Task 6); `onTls(tls: boolean)` совпадает в `DraftAddressBar` (Task 6) и `CallPanel` (Task 7).

**Известное упрощение:** брэдкрамб привязанного черновика использует имена из `DraftOrigin`, заполняемые в точках сохранения; `openSavedRequest` кладёт только `requestName` (имя коллекции там недоступно) — брэдкрамб корректно показывает одно имя. Полное `Коллекция › Имя` гарантировано для только что сохранённого черновика (Task 2, `handleSave`).
