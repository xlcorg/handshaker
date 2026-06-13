# Ctrl+E env-cycle hotkey — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Статус:** ✅ code-complete (2026-06-13; ветка `claude/modest-sinoussi-a20e6e`; commits `b238377`…`d171fec`). Гейт зелёный: vitest **880** · tsc clean · бэкенд/bindings не тронуты. Остаток — live WebView2-проход (Task 4 Step 4).
**Спека:** `docs/superpowers/specs/2026-06-13-env-cycle-hotkey-design.md`

**Goal:** Глобальный хоткей **Ctrl+E / Cmd+E** переключает окружение активного воркфлоу на следующее по кругу (исключая «No environment»), плюс подсказка `Ctrl+E`/`⌘E` в шапке env-меню.

**Architecture:** Чистая логика (предикат хоткея + функция цикла) — в новом тестируемом модуле `src/features/envs/cycle.ts`. Тонкий capture-фазовый `keydown`-слушатель — в `WorkflowEnvControl` (он уже владеет `envs`, активным env и путём смены через `workflowStore.setWorkflowEnv`). Зеркалит существующую пару `reorder.ts` (чистый `computeReorder`) + инлайн-handler. Бэкенд/IPC не трогаем.

**Tech Stack:** React 18, TypeScript, Vitest + Testing Library, Tauri 2.

**Команды гейта (frontend-only фича):**
- Один тест-файл: `pnpm test <path>`
- Полный прогон: `pnpm test`
- Типчек: `pnpm lint` (это `tsc -b`)

---

## Файловая структура

| Файл | Ответственность |
| --- | --- |
| `src/features/envs/cycle.ts` | **новый** — `isEnvCycleHotkey(e)` (предикат) + `nextEnvName(names, current)` (чистый цикл) |
| `src/features/envs/cycle.test.ts` | **новый** — юнит-тесты обеих чистых функций |
| `src/features/workflow/WorkflowEnvControl.tsx` | **+** `useEffect` с capture-слушателем `keydown` |
| `src/features/workflow/WorkflowEnvControl.test.tsx` | **+** интеграционный тест цикла + AltGr no-op |
| `src/features/envs/EnvSwitcherMenu.tsx` | **+** keycap-хинт `Ctrl+E`/`⌘E` в шапке |
| `src/features/envs/EnvSwitcherMenu.test.tsx` | **+** тест наличия хинта |

---

## Task 1: Чистый модуль `cycle.ts` (предикат + цикл)

**Files:**
- Create: `src/features/envs/cycle.ts`
- Test: `src/features/envs/cycle.test.ts`

- [ ] **Step 1: Написать падающий тест**

Создать `src/features/envs/cycle.test.ts`:

```ts
import { describe, it, expect } from "vitest";

import { isEnvCycleHotkey, nextEnvName } from "./cycle";

describe("nextEnvName", () => {
  it("returns null for an empty list (no-op)", () => {
    expect(nextEnvName([], null)).toBeNull();
    expect(nextEnvName([], "prod")).toBeNull();
  });

  it("selects the first env when none is active", () => {
    expect(nextEnvName(["staging", "prod"], null)).toBe("staging");
  });

  it("advances to the next env in order", () => {
    expect(nextEnvName(["staging", "prod", "dev"], "staging")).toBe("prod");
    expect(nextEnvName(["staging", "prod", "dev"], "prod")).toBe("dev");
  });

  it("wraps from the last env back to the first", () => {
    expect(nextEnvName(["staging", "prod"], "prod")).toBe("staging");
  });

  it("treats an unknown current env as none → first", () => {
    expect(nextEnvName(["staging", "prod"], "gone")).toBe("staging");
  });

  it("re-selects the only env", () => {
    expect(nextEnvName(["staging"], "staging")).toBe("staging");
  });
});

describe("isEnvCycleHotkey", () => {
  const base = {
    code: "KeyE",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
  };

  it("matches Ctrl+E (physical key — layout-independent, also fires on ЙЦУКЕН where key would be 'у')", () => {
    expect(isEnvCycleHotkey({ ...base, ctrlKey: true })).toBe(true);
  });

  it("matches Cmd+E on macOS", () => {
    expect(isEnvCycleHotkey({ ...base, metaKey: true })).toBe(true);
  });

  it("rejects AltGr (Ctrl+Alt) — prints € etc. on EU layouts", () => {
    expect(isEnvCycleHotkey({ ...base, ctrlKey: true, altKey: true })).toBe(false);
  });

  it("rejects Ctrl+Shift+E", () => {
    expect(isEnvCycleHotkey({ ...base, ctrlKey: true, shiftKey: true })).toBe(false);
  });

  it("rejects a bare E (no Ctrl/Cmd)", () => {
    expect(isEnvCycleHotkey(base)).toBe(false);
  });

  it("rejects Ctrl + a different key", () => {
    expect(isEnvCycleHotkey({ ...base, ctrlKey: true, code: "KeyR" })).toBe(false);
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `pnpm test src/features/envs/cycle.test.ts`
Expected: FAIL — `Failed to resolve import "./cycle"` (модуль ещё не создан).

- [ ] **Step 3: Реализовать модуль**

Создать `src/features/envs/cycle.ts`:

```ts
/**
 * Ctrl+E env-cycle hotkey helpers. Pure + unit-tested; the keydown listener
 * lives in {@link WorkflowEnvControl}.
 */

/** Предикат хоткея «cycle env»: Ctrl/Cmd+E по ФИЗИЧЕСКОЙ клавише E
 *  (`e.code === "KeyE"`, раскладко-независимо — на ЙЦУКЕН `e.key` был бы "у"),
 *  без Alt (AltGr = Ctrl+Alt печатает символы на евро-раскладках) и без Shift. */
export function isEnvCycleHotkey(
  e: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
): boolean {
  if (e.altKey || e.shiftKey) return false;
  if (!e.ctrlKey && !e.metaKey) return false;
  return e.code === "KeyE";
}

/** Следующее окружение по кругу, исключая «No environment».
 *  Возвращает имя env для активации, либо `null` = no-op (список пуст).
 *  `current === null` или имя не из списка ⇒ первый env. */
export function nextEnvName(names: string[], current: string | null): string | null {
  if (names.length === 0) return null;
  const idx = current === null ? -1 : names.indexOf(current);
  return names[(idx + 1) % names.length];
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `pnpm test src/features/envs/cycle.test.ts`
Expected: PASS (13 assertions, оба describe зелёные).

- [ ] **Step 5: Коммит**

```bash
git add src/features/envs/cycle.ts src/features/envs/cycle.test.ts
git commit -m "feat(envs): pure Ctrl+E env-cycle helpers (predicate + nextEnvName)"
```

---

## Task 2: Привязать хоткей в `WorkflowEnvControl`

**Files:**
- Modify: `src/features/workflow/WorkflowEnvControl.tsx`
- Test: `src/features/workflow/WorkflowEnvControl.test.tsx`

- [ ] **Step 1: Написать падающий интеграционный тест**

В `src/features/workflow/WorkflowEnvControl.test.tsx` добавить ВНУТРЬ `describe("WorkflowEnvControl", …)` (после последнего `it`, перед закрывающей `});` describe-блока) два теста. `act` уже импортирован в этом файле (строка 2).

```ts
  it("Ctrl+E cycles the active workflow env, excluding 'No environment'", async () => {
    render(<WorkflowEnvControl />);
    await screen.findByText("No environment");
    // Flush the on-mount envList() resolution so `envs` state is populated and
    // the hotkey effect has re-bound with the real env list.
    await act(async () => {});

    const pressCtrlE = () =>
      act(() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { code: "KeyE", ctrlKey: true, bubbles: true }),
        );
      });

    pressCtrlE(); // null → first
    expect(workflowStore.activeWorkflow().envName).toBe("staging");
    pressCtrlE(); // staging → prod
    expect(workflowStore.activeWorkflow().envName).toBe("prod");
    pressCtrlE(); // prod → wrap → staging
    expect(workflowStore.activeWorkflow().envName).toBe("staging");
  });

  it("ignores AltGr+E (Ctrl+Alt = symbol on EU layouts) — env unchanged", async () => {
    render(<WorkflowEnvControl />);
    await screen.findByText("No environment");
    await act(async () => {});

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { code: "KeyE", ctrlKey: true, altKey: true, bubbles: true }),
      );
    });

    expect(workflowStore.activeWorkflow().envName).toBeNull();
  });
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `pnpm test src/features/workflow/WorkflowEnvControl.test.tsx`
Expected: FAIL — первый новый тест: `expected null to be "staging"` (хоткей ещё не привязан; AltGr-тест может проходить вакуумно, это норм).

- [ ] **Step 3: Добавить импорт `cycle`-хелперов**

В `src/features/workflow/WorkflowEnvControl.tsx` добавить импорт рядом с остальными `@/features/envs/*` (после строки `import { colorHex, resolveColorKey } from "@/features/envs/colors";`):

```ts
import { isEnvCycleHotkey, nextEnvName } from "@/features/envs/cycle";
```

- [ ] **Step 4: Добавить capture-фазовый слушатель**

В том же файле, СРАЗУ ПОСЛЕ строки `const activeEnvObj = envs.find((e) => e.name === activeEnv) ?? null;` и ПЕРЕД `return (`, вставить:

```ts
  // Глобальный Ctrl+E / Cmd+E циклит env активного воркфлоу (исключая «No
  // environment»). Capture-фаза — чтобы сфокусированный Monaco не перехватил.
  // Перепривязка на [envs, activeEnv] держит замыкание свежим.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || !isEnvCycleHotkey(e)) return;
      const next = nextEnvName(envs.map((x) => x.name), activeEnv);
      if (next === null) return; // ноль env — не глотаем клавишу
      e.preventDefault();
      workflowStore.setWorkflowEnv(next);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [envs, activeEnv]);
```

- [ ] **Step 5: Запустить тест — убедиться, что проходит**

Run: `pnpm test src/features/workflow/WorkflowEnvControl.test.tsx`
Expected: PASS (все тесты файла, включая 2 новых).

- [ ] **Step 6: Коммит**

```bash
git add src/features/workflow/WorkflowEnvControl.tsx src/features/workflow/WorkflowEnvControl.test.tsx
git commit -m "feat(envs): Ctrl+E cycles the active workflow env"
```

---

## Task 3: Подсказка `Ctrl+E`/`⌘E` в шапке env-меню

**Files:**
- Modify: `src/features/envs/EnvSwitcherMenu.tsx`
- Test: `src/features/envs/EnvSwitcherMenu.test.tsx`

- [ ] **Step 1: Написать падающий тест**

В `src/features/envs/EnvSwitcherMenu.test.tsx` добавить тест внутрь `describe("EnvSwitcherMenu", …)` (например, сразу после теста `"header has a + button…"`):

```ts
  it("shows the Ctrl+E shortcut hint in the header (non-mac UA)", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByText("env-trigger"));
    // jsdom's default UA is not macOS, so isMacOS === false → "Ctrl+E".
    expect(await screen.findByText("Ctrl+E")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `pnpm test src/features/envs/EnvSwitcherMenu.test.tsx`
Expected: FAIL — `Unable to find an element with the text: Ctrl+E`.

- [ ] **Step 3: Добавить импорт `isMacOS`**

В `src/features/envs/EnvSwitcherMenu.tsx` добавить импорт после строки `import type { EnvironmentIpc } from "@/ipc/bindings";`:

```ts
import { isMacOS } from "@/lib/platform";
```

- [ ] **Step 4: Отрендерить хинт в шапке**

В том же файле заменить блок шапки (строки с `<div className="flex items-center justify-between">` … до закрывающего `</div>` перед `No environment`-айтемом) на версию с хинтом. Текущий блок:

```tsx
          <div className="flex items-center justify-between">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Environments
            </DropdownMenuLabel>
            <DropdownMenuItem
              aria-label="New environment"
              onSelect={onNewEnv}
              className="mr-1 h-6 w-6 justify-center p-0"
            >
              <Plus />
            </DropdownMenuItem>
          </div>
```

заменить на:

```tsx
          <div className="flex items-center justify-between">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Environments
            </DropdownMenuLabel>
            <div className="flex items-center gap-1.5">
              <span aria-hidden className="text-[10px] text-muted-foreground/70">
                {isMacOS ? "⌘E" : "Ctrl+E"}
              </span>
              <DropdownMenuItem
                aria-label="New environment"
                onSelect={onNewEnv}
                className="mr-1 h-6 w-6 justify-center p-0"
              >
                <Plus />
              </DropdownMenuItem>
            </div>
          </div>
```

- [ ] **Step 5: Запустить тест — убедиться, что проходит**

Run: `pnpm test src/features/envs/EnvSwitcherMenu.test.tsx`
Expected: PASS (все тесты файла, включая новый хинт-тест).

- [ ] **Step 6: Коммит**

```bash
git add src/features/envs/EnvSwitcherMenu.tsx src/features/envs/EnvSwitcherMenu.test.tsx
git commit -m "feat(envs): show Ctrl+E hint in the env switcher header"
```

---

## Task 4: Финальный гейт

**Files:** нет (только прогон проверок).

- [ ] **Step 1: Полный прогон тестов**

Run: `pnpm test`
Expected: PASS — все файлы зелёные (база + 13 новых cycle-ассертов + 2 WorkflowEnvControl + 1 EnvSwitcherMenu). Запомнить итоговое число тестов для статус-баннера.

- [ ] **Step 2: Типчек**

Run: `pnpm lint`
Expected: чисто (exit 0), без TS-ошибок.

- [ ] **Step 3: Обновить статус плана + CLAUDE.md**

Пометить баннер этого плана как `✅ code-complete` (остаток — live WebView2-проход) и обновить строку «Active work» в `CLAUDE.md`. Коммит:

```bash
git add docs/superpowers/plans/2026-06-13-env-cycle-hotkey.md CLAUDE.md
git commit -m "docs: mark Ctrl+E env-cycle plan code-complete"
```

- [ ] **Step 4 (вне сессии — человек): live WebView2-проход**

В `pnpm tauri:dev`: Ctrl+E циклит env по тайтлбар-pill (staging→prod→…→wrap, «No environment» пропускается); на русской раскладке тоже срабатывает; AltGr+E печатает символ и env не трогает; хинт `Ctrl+E` виден в шапке меню. На mac — Cmd+E + хинт `⌘E`.

---

## Self-review

- **Spec coverage:** поведение цикла + исключение No env (Task 1 `nextEnvName` + Task 2 интеграция) ✓; раскладко-независимость по `code` (Task 1 предикат + тест) ✓; AltGr/Shift/repeat-гарды (Task 1 предикат + Task 2 `e.repeat` + AltGr-тест) ✓; capture-фаза + preventDefault (Task 2) ✓; обнаруживаемость-хинт (Task 3) ✓; крайние случаи (пусто/null/wrap/unknown) (Task 1 тесты) ✓; тосты — намеренно нет ✓.
- **Placeholder scan:** плейсхолдеров нет; весь код приведён целиком.
- **Type consistency:** `isEnvCycleHotkey` / `nextEnvName` имена и сигнатуры совпадают между `cycle.ts`, тестами и импортом в `WorkflowEnvControl`. `workflowStore.setWorkflowEnv(string)` и `workflowStore.activeWorkflow().envName` — существующий API (см. текущий `WorkflowEnvControl.tsx` и тест #3). `isMacOS` — boolean-const из `@/lib/platform`.
