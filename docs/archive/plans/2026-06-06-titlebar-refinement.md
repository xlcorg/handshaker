# Titlebar Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** 🎉 DONE — фича влита в `main` и давно живёт в продукте (единый
`Titlebar.tsx` + `Titlebar.test.tsx` с drag-region/`WorkflowSelector`/`ViewSwitcher`,
командная палитра ⌘K удалена — верифицировано по коду при архивации 2026-06-12;
чекбоксы задач в этом файле не проставлялись по ходу исполнения). Поверх этой
базы позже легли «Draft address-bar redesign» и «macOS-стиль титлбара».
· **Спека:** `docs/superpowers/specs/2026-06-06-titlebar-refinement-design.md` · **Режим:** subagent-driven

**Goal:** Свести верхнюю панель в единый рабочий титлбар: починить перетаскивание окна, вернуть кнопки min/max/close + утилиты, выровнять env-селектор под workflow, персистить выбор env, центрировать англоязычный view-switcher и полностью удалить командную палитру ⌘K.

**Architecture:** `src/features/shell/Titlebar.tsx` переписывается в единый живой компонент (grid `[1fr_auto_1fr]`, drag через `data-tauri-drag-region`, внутри — `WorkflowSelector` / `WorkflowEnvControl` / `ViewSwitcher` + утилиты + кнопки окна) и рендерится в `WorkflowApp` вместо инлайн-бара. Бэкенд уже хранит активный env — фронт подхватывает его на старте через новый `workflowStore.hydrateEnv`. Командная палитра и её ⌘K-обработчик удаляются без замены.

**Tech Stack:** React 18 + TypeScript, Tailwind, Radix UI, Tauri 2 (`@tauri-apps/api/window`), Vitest + Testing Library.

**Команды:**
- Тест одного файла: `pnpm test <path>` (например `pnpm test src/features/workflow/ViewSwitcher.test.tsx`)
- Все тесты: `pnpm test`
- Типы/линт: `pnpm lint` (это `tsc -b`)
- Сборка приложения (ручная верификация): `pnpm build`, затем `pnpm tauri dev` (требует готового `dist/`, см. CLAUDE.md)

---

## File Structure

**Создаём:**
- `src/features/shell/Titlebar.test.tsx` — тест нового консолидированного титлбара.

**Изменяем:**
- `src-tauri/capabilities/default.json` — + разрешение `core:window:allow-start-dragging`.
- `src/features/workflow/ViewSwitcher.tsx` — английские лейблы.
- `src/features/workflow/store.ts` — + метод `hydrateEnv`.
- `src/features/workflow/WorkflowEnvControl.tsx` — стиль триггера под `WorkflowSelector`.
- `src/features/shell/Titlebar.tsx` — переписать целиком.
- `src/app/WorkflowApp.tsx` — рендерить `Titlebar`, гидрация env, монтаж `SettingsDialog`, удалить палитру/⌘K.
- `src/features/workflow/{FocusView,LedgerView,ListView}.tsx` — убрать упоминания «⌘K» из подсказок пустого состояния.
- `src/features/workflow/ViewSwitcher.test.tsx` — создаётся в Task 2 (нет сейчас).
- `src/features/workflow/store.test.ts` — добавить кейс `hydrateEnv` (или создать, если файла нет — см. Task 3).
- `src/features/workflow/WorkflowEnvControl.test.tsx` — + тест отсутствия `font-mono`.
- `src/app/WorkflowApp.test.tsx` — убрать мок палитры, добавить моки tauri-window/SettingsDialog/envActiveGet, обновить лейблы радио, добавить тесты гидрации и настроек.

**Удаляем:**
- `src/features/catalog/CommandPalette.tsx`
- `src/features/catalog/CommandPalette.test.tsx`

---

## Task 1: Разрешение на перетаскивание окна (capabilities)

`data-tauri-drag-region` под капотом вызывает `window.startDragging`, для которого нужно разрешение `core:window:allow-start-dragging`. Сейчас его нет — это одна из двух причин неработающего drag.

**Files:**
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Добавить разрешение**

В массив `permissions` добавить `"core:window:allow-start-dragging"` (рядом с прочими `core:window:*`). Итоговый файл:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capability for the main window — core IPC + window controls (minimize / maximize / close / drag) for the custom titlebar, plus webview zoom reset.",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:allow-close",
    "core:window:allow-minimize",
    "core:window:allow-toggle-maximize",
    "core:window:allow-internal-toggle-maximize",
    "core:window:allow-start-dragging",
    "core:webview:allow-set-webview-zoom"
  ]
}
```

- [ ] **Step 2: Проверить валидность JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('src-tauri/capabilities/default.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add src-tauri/capabilities/default.json
git commit -m "fix(tauri): grant core:window:allow-start-dragging for titlebar drag"
```

---

## Task 2: View-switcher — английские лейблы

**Files:**
- Modify: `src/features/workflow/ViewSwitcher.tsx`
- Test: `src/features/workflow/ViewSwitcher.test.tsx` (создать)

- [ ] **Step 1: Написать падающий тест**

Создать `src/features/workflow/ViewSwitcher.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ViewSwitcher } from "./ViewSwitcher";
import { workflowStore } from "./store";

beforeEach(() => {
  workflowStore.reset();
});

describe("ViewSwitcher", () => {
  it("renders English labels Ledger / List / Focus", () => {
    render(<ViewSwitcher />);
    expect(screen.getByRole("radio", { name: "Ledger" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "List" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Focus" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `pnpm test src/features/workflow/ViewSwitcher.test.tsx`
Expected: FAIL — текущие лейблы `Лента/Список/Фокус`, радио с именами `Ledger/List/Focus` не найдены.

- [ ] **Step 3: Поменять лейблы**

В `src/features/workflow/ViewSwitcher.tsx` заменить массив `OPTIONS`:

```tsx
const OPTIONS = [
  { value: "ledger", label: "Ledger" },
  { value: "list", label: "List" },
  { value: "focus", label: "Focus" },
];
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `pnpm test src/features/workflow/ViewSwitcher.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/ViewSwitcher.tsx src/features/workflow/ViewSwitcher.test.tsx
git commit -m "feat(view-switcher): English labels Ledger/List/Focus"
```

---

## Task 3: `workflowStore.hydrateEnv` — проставить env без обратного round-trip

Гидратор ставит `envName` активного workflow **без** вызова `envActiveSet` (в отличие от `setWorkflowEnv`), чтобы при старте не было лишнего эха в бэкенд.

**Files:**
- Modify: `src/features/workflow/store.ts`
- Test: `src/features/workflow/store.test.ts` (создать, если отсутствует)

- [ ] **Step 1: Написать падающий тест**

Создать (или дополнить) `src/features/workflow/store.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/ipc/client", () => ({
  envActiveSet: vi.fn().mockResolvedValue(undefined),
}));

import { workflowStore } from "./store";
import { envActiveSet } from "@/ipc/client";

beforeEach(() => {
  vi.clearAllMocks();
  workflowStore.reset();
});

describe("workflowStore.hydrateEnv", () => {
  it("sets the active workflow env without calling envActiveSet", () => {
    workflowStore.hydrateEnv("staging");
    expect(workflowStore.activeWorkflow().envName).toBe("staging");
    expect(envActiveSet).not.toHaveBeenCalled();
  });

  it("accepts null (no environment)", () => {
    workflowStore.hydrateEnv("staging");
    workflowStore.hydrateEnv(null);
    expect(workflowStore.activeWorkflow().envName).toBeNull();
    expect(envActiveSet).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `pnpm test src/features/workflow/store.test.ts`
Expected: FAIL — `workflowStore.hydrateEnv is not a function`.

- [ ] **Step 3: Реализовать `hydrateEnv`**

В `src/features/workflow/store.ts` добавить метод в объект `workflowStore` (рядом с `setWorkflowEnv`). Использует уже импортированный редьюсер `setWorkflowEnvReducer`:

```ts
  /** Set the active workflow's env from a persisted source WITHOUT echoing back to
   * the backend (used to hydrate on startup from envActiveGet). */
  hydrateEnv(name: string | null) {
    workflowStore.update((w) => setWorkflowEnvReducer(w, name));
  },
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `pnpm test src/features/workflow/store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/store.ts src/features/workflow/store.test.ts
git commit -m "feat(store): add hydrateEnv to set workflow env without backend echo"
```

---

## Task 4: Env-селектор под вид workflow (убрать `font-mono`)

Триггер `WorkflowEnvControl` приводим к виду триггера `WorkflowSelector`: `text-xs`, без `font-mono`, лейбл `text-foreground`, шеврон `size-3`.

**Files:**
- Modify: `src/features/workflow/WorkflowEnvControl.tsx`
- Test: `src/features/workflow/WorkflowEnvControl.test.tsx`

- [ ] **Step 1: Написать падающий тест**

Добавить в `src/features/workflow/WorkflowEnvControl.test.tsx` (внутрь `describe("WorkflowEnvControl", …)`):

```tsx
  it("renders the trigger to match WorkflowSelector (no font-mono, text-xs)", async () => {
    render(<WorkflowEnvControl />);
    const label = await screen.findByText("No environment");
    const trigger = label.closest("button");
    expect(trigger).not.toBeNull();
    expect(trigger!.className).not.toContain("font-mono");
    expect(trigger!.className).toContain("text-xs");
  });
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `pnpm test src/features/workflow/WorkflowEnvControl.test.tsx`
Expected: FAIL — текущий триггер использует `<Button … className="gap-1 font-mono">`, в нём есть `font-mono` и нет `text-xs`.

- [ ] **Step 3: Заменить триггер**

В `src/features/workflow/WorkflowEnvControl.tsx`:

Убрать импорт `Button` (строка `import { Button } from "@/components/ui/button";`) — он больше не нужен.

Заменить проп `trigger` у `EnvSwitcherMenu` на нативную кнопку с классами `WorkflowSelector`. `EnvSwitcherMenu` оборачивает триггер в `DropdownMenuTrigger asChild`, поэтому передаём один элемент-кнопку:

```tsx
        trigger={
          <button
            type="button"
            className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent"
          >
            <span className="max-w-[180px] truncate text-foreground">{label}</span>
            <ChevronDown className="size-3" aria-hidden />
          </button>
        }
```

(Импорт `ChevronDown` из `lucide-react` уже есть в файле — оставить.)

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `pnpm test src/features/workflow/WorkflowEnvControl.test.tsx`
Expected: PASS (оба прежних теста + новый)

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/WorkflowEnvControl.tsx src/features/workflow/WorkflowEnvControl.test.tsx
git commit -m "feat(env-control): match WorkflowSelector trigger style (drop font-mono)"
```

---

## Task 5: Переписать `Titlebar.tsx` в единый консолидированный титлбар

Новый `Titlebar` сам импортирует `WorkflowSelector` / `WorkflowEnvControl` / `ViewSwitcher`, добавляет утилиты (сайдбар/тема/настройки) и кнопки окна, и делает весь бар drag-зоной через `data-tauri-drag-region`. Сигнатура меняется на `{ onOpenSettings: () => void }` (старый `envSlot` уходит). Пока не рендерится в `WorkflowApp` (это Task 6) — сборка остаётся зелёной.

**Files:**
- Modify: `src/features/shell/Titlebar.tsx`
- Test: `src/features/shell/Titlebar.test.tsx` (создать)

- [ ] **Step 1: Написать падающий тест**

Создать `src/features/shell/Titlebar.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
  }),
}));
vi.mock("@/ipc/client", () => ({
  envList: vi.fn().mockResolvedValue([]),
  envActiveSet: vi.fn().mockResolvedValue(undefined),
}));

import { Titlebar } from "./Titlebar";
import { workflowStore } from "@/features/workflow/store";

beforeEach(() => {
  vi.clearAllMocks();
  workflowStore.reset();
});

describe("Titlebar", () => {
  it("renders workflow selector, env control and the English view switcher", async () => {
    render(<Titlebar onOpenSettings={() => {}} />);
    expect(screen.getByRole("button", { name: /workflow-1/ })).toBeInTheDocument();
    expect(await screen.findByText("No environment")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Ledger" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "List" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Focus" })).toBeInTheDocument();
  });

  it("renders the window control buttons", () => {
    render(<Titlebar onOpenSettings={() => {}} />);
    expect(screen.getByRole("button", { name: "Minimize window" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Maximize window" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close window" })).toBeInTheDocument();
  });

  it("makes the bar a Tauri drag region", () => {
    const { container } = render(<Titlebar onOpenSettings={() => {}} />);
    expect(container.querySelector("[data-tauri-drag-region]")).not.toBeNull();
  });

  it("calls onOpenSettings when the settings button is clicked", async () => {
    const onOpenSettings = vi.fn();
    const user = userEvent.setup();
    render(<Titlebar onOpenSettings={onOpenSettings} />);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `pnpm test src/features/shell/Titlebar.test.tsx`
Expected: FAIL — текущий `Titlebar` требует проп `envSlot`, не рендерит workflow-селектор/view-switcher, его нельзя вызвать с новой сигнатурой.

- [ ] **Step 3: Переписать компонент**

Полностью заменить содержимое `src/features/shell/Titlebar.tsx`:

```tsx
import { Minus, Moon, PanelLeft, Settings, Square, Sun, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Tooltip } from "@/components/ui/tooltip";
import { usePrefs } from "@/lib/use-prefs";
import { cn } from "@/lib/cn";
import { WorkflowSelector } from "@/features/workflow/WorkflowSelector";
import { WorkflowEnvControl } from "@/features/workflow/WorkflowEnvControl";
import { ViewSwitcher } from "@/features/workflow/ViewSwitcher";

const btn =
  "h-5 w-6 rounded-sm inline-flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground";

/**
 * Единый титлбар: лого + workflow/env слева, view-switcher по центру,
 * утилиты (сайдбар/тема/настройки) и кнопки окна справа. Весь бар — drag-зона
 * (`data-tauri-drag-region`); атрибут не наследуется детьми, поэтому он продублирован
 * на неинтерактивных зонах (корень, ячейки grid, лого/wordmark). Кнопки и дропдауны
 * перетаскивание не перехватывают — это нужное поведение.
 */
export function Titlebar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [prefs, setPref] = usePrefs();
  return (
    <div
      data-tauri-drag-region
      className="grid h-9 flex-none grid-cols-[1fr_auto_1fr] items-center gap-2 bg-card border-b border-border px-2.5 select-none relative z-40"
    >
      <div data-tauri-drag-region className="flex items-center gap-2.5 min-w-0 justify-self-start">
        <span data-tauri-drag-region className="flex items-center gap-1.5">
          <LogoMark size={13} className="text-foreground/85" />
          <span data-tauri-drag-region className="text-[13px] font-semibold tracking-tight text-foreground">
            Handshaker
          </span>
        </span>
        <WorkflowSelector />
        <WorkflowEnvControl />
      </div>

      <div className="justify-self-center">
        <ViewSwitcher />
      </div>

      <div data-tauri-drag-region className="flex items-center gap-0.5 justify-self-end">
        <Tooltip content="Toggle sidebar" side="bottom">
          <button type="button" onClick={() => setPref("sidebar", !prefs.sidebar)} className={btn} aria-label="Toggle sidebar">
            <PanelLeft size={13} />
          </button>
        </Tooltip>
        <Tooltip content={prefs.theme === "dark" ? "Light mode" : "Dark mode"} side="bottom">
          <button
            type="button"
            onClick={() => setPref("theme", prefs.theme === "dark" ? "light" : "dark")}
            className={btn}
            aria-label="Toggle theme"
          >
            {prefs.theme === "dark" ? <Sun size={13} /> : <Moon size={13} />}
          </button>
        </Tooltip>
        <Tooltip content="Settings" side="bottom">
          <button type="button" onClick={onOpenSettings} className={btn} aria-label="Settings">
            <Settings size={13} />
          </button>
        </Tooltip>
        <span className="h-3.5 w-px bg-border mx-1" />
        <Tooltip content="Minimize" side="bottom">
          <button type="button" onClick={() => getCurrentWindow().minimize()} className={btn} aria-label="Minimize window">
            <Minus size={11} strokeWidth={1.5} />
          </button>
        </Tooltip>
        <Tooltip content="Maximize" side="bottom">
          <button type="button" onClick={() => getCurrentWindow().toggleMaximize()} className={btn} aria-label="Maximize window">
            <Square size={9} strokeWidth={1.5} />
          </button>
        </Tooltip>
        <Tooltip content="Close" side="bottom">
          <button
            type="button"
            onClick={() => getCurrentWindow().close()}
            className="h-5 w-6 rounded-sm inline-flex items-center justify-center text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
            aria-label="Close window"
          >
            <X size={11} strokeWidth={1.5} />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

function LogoMark({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(className)}
      aria-hidden
    >
      <path d="M4 9 L9 4 L13 8" />
      <path d="M20 15 L15 20 L11 16" />
      <path d="M8 12 L12 8 L16 12 L12 16 Z" />
    </svg>
  );
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `pnpm test src/features/shell/Titlebar.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/shell/Titlebar.tsx src/features/shell/Titlebar.test.tsx
git commit -m "feat(titlebar): consolidate workflow/env/view + utilities + window controls with drag region"
```

---

## Task 6: `WorkflowApp` — рендерить Titlebar, гидрация env, монтаж SettingsDialog, удаление ⌘K

Заменяем инлайн-бар на `<Titlebar>`, гидрируем env на старте, монтируем `SettingsDialog` (сейчас он нигде не открывается), удаляем состояние/обработчик/монтаж командной палитры и ⌘K-чип. Обработчики `⌘S` и `⌘N` сохраняем.

**Files:**
- Modify: `src/app/WorkflowApp.tsx`
- Test: `src/app/WorkflowApp.test.tsx`

- [ ] **Step 1: Обновить тест (падающий)**

В `src/app/WorkflowApp.test.tsx`:

(a) Удалить мок палитры (строки с `vi.mock("@/features/catalog/CommandPalette", …)`).

(b) Добавить рядом с прочими `vi.mock` моки tauri-window и SettingsDialog:

```tsx
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn() }),
}));
vi.mock("@/features/settings/SettingsDialog", () => ({
  SettingsDialog: ({ open }: { open: boolean }) => (open ? <div>SETTINGS-DIALOG</div> : null),
}));
```

(c) В моке `@/ipc/client` добавить `envActiveGet`:

```tsx
vi.mock("@/ipc/client", () => ({
  envList: vi.fn().mockResolvedValue([]),
  envActiveSet: vi.fn().mockResolvedValue(undefined),
  envActiveGet: vi.fn().mockResolvedValue(null),
}));
```

(d) Обновить англоязычные лейблы радио в тесте `"renders the workflow selector, env control and view switcher"`:

```tsx
    expect(screen.getByRole("radio", { name: "Ledger" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "List" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Focus" })).toBeInTheDocument();
```

(e) В тесте `"defaults to Focus and switches to the real List view"` заменить клик `{ name: "Список" }` на `{ name: "List" }`.

(f) Добавить новый describe-блок в конец файла (импорт `envActiveGet` нужно добавить к существующему `import … from "@/ipc/client"` — сейчас прямого импорта нет, поэтому добавить строку):

```tsx
import { envActiveGet } from "@/ipc/client";
```

```tsx
describe("WorkflowApp env hydration + settings", () => {
  it("hydrates the active workflow env from envActiveGet on mount", async () => {
    (envActiveGet as ReturnType<typeof vi.fn>).mockResolvedValueOnce("staging");
    render(<WorkflowApp />);
    expect(await screen.findByText("staging")).toBeInTheDocument();
  });

  it("opens the settings dialog from the titlebar settings button", async () => {
    const user = userEvent.setup();
    render(<WorkflowApp />);
    expect(screen.queryByText("SETTINGS-DIALOG")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByText("SETTINGS-DIALOG")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `pnpm test src/app/WorkflowApp.test.tsx`
Expected: FAIL — инлайн-бар ещё рендерит русские лейблы и не содержит кнопки «Settings»; гидрации нет.

- [ ] **Step 3: Переписать `WorkflowApp.tsx`**

Изменения в `src/app/WorkflowApp.tsx`:

(a) **Импорты.** Удалить:
```tsx
import { Kbd } from "@/components/ui/kbd";
import { ViewSwitcher } from "@/features/workflow/ViewSwitcher";
import { WorkflowSelector } from "@/features/workflow/WorkflowSelector";
import { WorkflowEnvControl } from "@/features/workflow/WorkflowEnvControl";
import { CommandPalette } from "@/features/catalog/CommandPalette";
```
Добавить:
```tsx
import { Titlebar } from "@/features/shell/Titlebar";
import { SettingsDialog } from "@/features/settings/SettingsDialog";
import { envActiveGet } from "@/ipc/client";
```
(`useActiveWorkflow, useDraft, workflowStore` из `@/features/workflow/store` уже импортированы — оставить.)

(b) **Состояние.** Удалить `const [paletteOpen, setPaletteOpen] = useState(false);`. Добавить `const [settingsOpen, setSettingsOpen] = useState(false);`.

(c) **keydown-обработчик.** Удалить ветку ⌘K:
```tsx
      if (mod && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (mod && (e.key === "s" || e.key === "S")) {
```
→ начать с `if (mod && (e.key === "s" || e.key === "S")) {` (ветки `s` и `n` сохранить как есть).

(d) **Эффект reload-on-open.** Удалить полностью:
```tsx
  useEffect(() => {
    if (paletteOpen) void cat.reload();
  }, [paletteOpen, cat.reload]);
```

(e) **Гидрация env.** Добавить эффект (один раз на маунте), например сразу после `useAutosaveDraft(...)`:
```tsx
  // Подхватить сохранённый бэкендом активный env при старте (спека §4).
  useEffect(() => {
    void envActiveGet().then((name) => workflowStore.hydrateEnv(name));
  }, []);
```

(f) **Верхний бар.** Заменить инлайн-`<div className="flex h-9 …">…</div>` (логотип, WorkflowSelector, WorkflowEnvControl, ViewSwitcher, кнопка ⌘K) одной строкой:
```tsx
      <Titlebar onOpenSettings={() => setSettingsOpen(true)} />
```

(g) **Удалить монтаж палитры** — блок `<CommandPalette open={paletteOpen} … />` целиком.

(h) **Смонтировать SettingsDialog** — рядом с `<Toaster />`:
```tsx
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
```

(i) Поправить комментарий на строке ~40, чтобы не упоминать ⌘K:
```tsx
  // The ONE shared catalog instance — feeds overview + Save dialog AND the sidebar.
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `pnpm test src/app/WorkflowApp.test.tsx`
Expected: PASS (включая новые тесты гидрации и настроек)

- [ ] **Step 5: Проверить типы**

Run: `pnpm lint`
Expected: без ошибок (на этом шаге `CommandPalette.tsx` ещё существует, но не импортируется — это нормально).

- [ ] **Step 6: Commit**

```bash
git add src/app/WorkflowApp.tsx src/app/WorkflowApp.test.tsx
git commit -m "feat(app): render consolidated Titlebar, hydrate env on startup, mount SettingsDialog, drop ⌘K palette"
```

---

## Task 7: Удалить командную палитру и зачистить упоминания ⌘K

После Task 6 `CommandPalette` больше нигде не импортируется (кроме собственного теста) — удаляем файлы и чистим устаревшие подсказки пустого состояния.

**Files:**
- Delete: `src/features/catalog/CommandPalette.tsx`, `src/features/catalog/CommandPalette.test.tsx`
- Modify: `src/features/workflow/FocusView.tsx`, `LedgerView.tsx`, `ListView.tsx`
- Modify: `src/features/catalog/CatalogProvider.tsx` (комментарий)

- [ ] **Step 1: Удалить файлы палитры**

```bash
git rm src/features/catalog/CommandPalette.tsx src/features/catalog/CommandPalette.test.tsx
```

- [ ] **Step 2: Зачистить подсказки пустого состояния**

`src/features/workflow/FocusView.tsx` (строка ~58):
```tsx
            Нет активного реквеста — выбери метод в сайдбаре.
```
`src/features/workflow/LedgerView.tsx` (строка ~20):
```tsx
        Нет шагов — создай вызов в сайдбаре.
```
`src/features/workflow/ListView.tsx` (строка ~14):
```tsx
        Нет шагов — создай вызов в сайдбаре.
```

`src/features/catalog/CatalogProvider.tsx` (строка ~6, комментарий) — убрать «⌘К»:
```tsx
/** Owns the ONE catalog-tree instance shared by the sidebar, overview and Save flow. */
```

- [ ] **Step 3: Проверить, что упоминаний ⌘K/CommandPalette в `src/` не осталось**

Run: `git grep -n "CommandPalette\|⌘K" -- src/ ; echo "exit=$?"`
Expected: только отсутствие совпадений (`exit=1` у git grep = ничего не найдено). Если что-то найдено — устранить.

- [ ] **Step 4: Полный прогон тестов и типов**

Run: `pnpm test`
Expected: PASS, все файлы.

Run: `pnpm lint`
Expected: без ошибок (нет «висящих» импортов `Kbd`, `CommandPalette` и пр.).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove ⌘K command palette and stale hints"
```

---

## Task 8: Ручная верификация в собранном приложении

Юнит-тесты не покрывают drag и реальные кнопки окна (поведение Tauri-рантайма) — проверяем вручную.

**Files:** —

- [ ] **Step 1: Собрать фронт и запустить приложение**

Run: `pnpm build` (создаёт `dist/`), затем `pnpm tauri dev`
Expected: приложение запускается без ошибок консоли.

- [ ] **Step 2: Чек-лист по 6 пунктам жалобы**

- [ ] Перетаскивание: тянуть за пустую часть титлбара (лого/wordmark/пустое пространство) — окно двигается; за дропдауны/кнопки/view-switcher — НЕ двигается.
- [ ] Кнопки окна: minimize сворачивает, maximize разворачивает/восстанавливает, close закрывает.
- [ ] Env-селектор визуально совпадает с workflow-селектором (тот же размер шрифта, не моноширинный).
- [ ] Выбрать env → закрыть приложение → снова открыть: выбранный env сохранился.
- [ ] View-switcher по центру, подписи `Ledger / List / Focus`.
- [ ] Кнопка настроек открывает диалог Settings; командной палитры по ⌘K больше нет.

- [ ] **Step 3: Зафиксировать результат**

Отметить выполнение пунктов; при расхождении — завести фикс отдельной задачей.

---

## Self-Review (выполнено при написании плана)

**Spec coverage:**
- Drag (data-tauri-drag-region) → Task 5; permission → Task 1. ✓
- Кнопки окна min/max/close → Task 5. ✓
- Утилиты тема/сайдбар/настройки + монтаж SettingsDialog → Task 5 (кнопки) + Task 6 (монтаж). ✓
- Env-селектор под workflow (без font-mono) → Task 4. ✓
- Персист env через hydrateEnv → Task 3 (стор) + Task 6 (вызов на старте). ✓
- View-switcher центр + английский → Task 2 (лейблы) + Task 5 (центр в grid). ✓
- Удаление ⌘K палитры + зачистка подсказок → Task 6 (отвязка) + Task 7 (удаление/чистка). ✓

**Placeholder scan:** плейсхолдеров нет — весь код приведён целиком.

**Type/name consistency:** `hydrateEnv(name: string | null)` определён в Task 3, используется в Task 6; `Titlebar({ onOpenSettings })` определён в Task 5, вызывается в Task 6; моки `envActiveGet`/`@tauri-apps/api/window`/`SettingsDialog` согласованы между Task 5 и Task 6.
