# UI Polish Batch #2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Шесть пунктов полиша из спеки `docs/superpowers/specs/2026-06-12-ui-polish-batch2-design.md`: зум UI (хоткеи + Settings), dark-only, quick-add метода в коллекцию, дублирование сохранённого запроса, фикс ghost-текста после Reset, восстановление последнего response при переключении методов.

**Architecture:** Каждый пункт — независимая фича поверх существующих механизмов: зум через `webview.setZoom` + уже существующий `prefs.zoom`; quick-add и duplicate через существующие мутации `useCatalogTree` + `openSavedRequest`; последний response — lookup по уже существующей истории воркфлоу; ghost-фикс — недостающий пересчёт на внешнее обновление контролируемого `value`.

**Tech Stack:** React 18 + TS, Tauri 2 (`@tauri-apps/api/webview`), vitest + @testing-library/react, Radix/shadcn.

**Гейт батча:** `pnpm exec tsc --noEmit` · `pnpm vitest run` · `cargo test -p handshaker-core` + `cargo test` в `src-tauri` · `pnpm build`; живая проверка в WebView2.

**Свежий worktree:** сначала `pnpm install`, затем `pnpm build` (создать `dist/`) **до** компиляции `src-tauri` (`generate_context!` требует `dist/`).

---

## Phase A — Dark-only

### Task 1: Выпилить переключатель темы (dark-only)

Бэкенда нет — чисто фронтовая зачистка. Порядок: UI → prefs → потребители → тесты.

**Files:**
- Modify: `src/features/shell/Titlebar.tsx`
- Modify: `src/features/shell/Titlebar.test.tsx`
- Modify: `src/features/settings/AppearancePane.tsx`
- Modify: `src/lib/use-prefs.ts`
- Modify: `src/main.tsx`
- Modify: `src/lib/monaco.ts`
- Modify: `src/features/bodyview/BodyView.tsx`
- Modify: `src/components/ui/sonner.tsx`
- Modify (моки): `src/features/bodyview/BodyView.test.tsx`, `src/features/bodyview/BodyView.submit.test.tsx`, `src/features/response/ResponsePanel.test.tsx`, `src/features/response/ResponseBody.test.tsx`, `src/features/workflow/CallPanel.layout.test.tsx`

- [ ] **Step 1: Обновить тест Titlebar (упадёт после правки — фиксируем намерение)**

В `Titlebar.test.tsx` заменить тест на строке ~132:

```tsx
  it("still renders the sidebar/settings utilities", () => {
    render(<Titlebar onOpenSettings={() => {}} />);
    expect(screen.getByRole("button", { name: "Toggle sidebar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Toggle theme" })).toBeNull();
  });
```

- [ ] **Step 2: Запустить тест — убедиться, что новая ассерция падает**

Run: `pnpm vitest run src/features/shell/Titlebar.test.tsx`
Expected: FAIL — кнопка "Toggle theme" ещё рендерится.

- [ ] **Step 3: Удалить кнопку темы из Titlebar**

В `Titlebar.tsx` удалить блок (строки ~70–79):

```tsx
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
```

и убрать `Sun, Moon` из импорта `lucide-react`. `usePrefs` остаётся (кнопка sidebar им пользуется).

- [ ] **Step 4: Удалить строку Mode из настроек**

В `AppearancePane.tsx` удалить первый `<SettingsRow title="Mode" …/>` (строки ~30–40) из группы "Theme".

- [ ] **Step 5: Выпилить `theme` из prefs**

В `src/lib/use-prefs.ts`:
- удалить `export type ThemeMode = "dark" | "light";`
- удалить поле `theme: ThemeMode;` из `Prefs` (и его doc-комментарий, если есть)
- удалить `theme: "dark",` из `PREFS_DEFAULTS`

Миграция не нужна: лишний ключ `theme` в сохранённом localStorage-JSON безвреден (Partial-merge проносит его мимо типа, никто не читает).

- [ ] **Step 6: main.tsx — безусловный dark**

В `src/main.tsx` заменить:

```ts
const initial = readPrefs();
document.documentElement.classList.toggle("dark", initial.theme === "dark");
```

на:

```ts
document.documentElement.classList.add("dark");
```

Если `readPrefs`/`initial` после этого больше нигде в `main.tsx` не используются — удалить и импорт, и переменную.

- [ ] **Step 7: monaco.ts — только тёмная тема**

В `src/lib/monaco.ts`:
- удалить `export type ThemeMode = "dark" | "light";` (~строка 212) и `monacoThemeFor` (~214–216);
- найти определение светлой темы (`defineTheme("handshaker-light", …)` и связанные light-токены) и удалить его целиком; `handshaker-dark` не трогать;
- если есть экспортируемая константа дефолтной темы с комментарием «Backwards-compatible default — dark» — оставить её как единственный публичный способ получить имя темы (или экспортировать `export const MONACO_THEME = "handshaker-dark";`, если константы нет).

- [ ] **Step 8: Потребители темы**

`src/features/bodyview/BodyView.tsx` (~строка 322): `theme={monacoThemeFor(prefs.theme)}` → `theme="handshaker-dark"`, убрать `monacoThemeFor` из импорта.

`src/components/ui/sonner.tsx`: `<Sonner theme={prefs.theme} …/>` → `<Sonner theme="dark" …/>`; если `usePrefs` после этого не нужен — удалить хук и импорт.

- [ ] **Step 9: Почистить тест-моки**

- `BodyView.test.tsx` и `BodyView.submit.test.tsx`: из mock-фабрики `@/lib/monaco` удалить ключ `monacoThemeFor`; из prefs-объектов удалить `theme: "dark"` (оставить `bodyHints`).
- `ResponsePanel.test.tsx`, `ResponseBody.test.tsx`: `usePrefs: () => [{ theme: "dark" }]` → `usePrefs: () => [{}]`.
- `CallPanel.layout.test.tsx`: удалить `theme: "dark"` из обоих mock-объектов prefs.

- [ ] **Step 10: Прогнать тесты и tsc**

Run: `pnpm vitest run` и `pnpm exec tsc --noEmit`
Expected: всё зелёное. Если tsc найдёт ещё ссылки на `prefs.theme`/`ThemeMode`/`monacoThemeFor` — зачистить их тем же способом (литерал `"handshaker-dark"` / удаление ветвления).

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(ui): dark-only - remove theme toggle from titlebar and settings"
```

**🧹 /clear-чекпойнт**

---

## Phase B — Зум UI

### Task 2: Модуль zoom — чистая логика + applyZoom

**Files:**
- Create: `src/features/shell/zoom.ts`
- Test: `src/features/shell/zoom.test.ts`

- [ ] **Step 1: Написать падающие тесты**

```ts
// src/features/shell/zoom.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const setZoom = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setZoom }),
}));

import { zoomActionFromKey, nextZoom, applyZoom } from "./zoom";

beforeEach(() => {
  setZoom.mockReset();
  setZoom.mockResolvedValue(undefined);
});

describe("zoomActionFromKey", () => {
  const ev = (p: Partial<KeyboardEvent>) =>
    ({ key: "", code: "", ctrlKey: false, metaKey: false, ...p }) as KeyboardEvent;

  it("requires ctrl/meta", () => {
    expect(zoomActionFromKey(ev({ key: "=" }))).toBeNull();
    expect(zoomActionFromKey(ev({ key: "=", ctrlKey: true }))).toBe("in");
    expect(zoomActionFromKey(ev({ key: "=", metaKey: true }))).toBe("in");
  });

  it("maps =/+/NumpadAdd to in, -/NumpadSubtract to out, 0/Numpad0 to reset", () => {
    expect(zoomActionFromKey(ev({ key: "+", ctrlKey: true }))).toBe("in");
    expect(zoomActionFromKey(ev({ key: "x", code: "NumpadAdd", ctrlKey: true }))).toBe("in");
    expect(zoomActionFromKey(ev({ key: "-", ctrlKey: true }))).toBe("out");
    expect(zoomActionFromKey(ev({ key: "x", code: "NumpadSubtract", ctrlKey: true }))).toBe("out");
    expect(zoomActionFromKey(ev({ key: "0", ctrlKey: true }))).toBe("reset");
    expect(zoomActionFromKey(ev({ key: "x", code: "Numpad0", ctrlKey: true }))).toBe("reset");
    expect(zoomActionFromKey(ev({ key: "9", ctrlKey: true }))).toBeNull();
  });
});

describe("nextZoom", () => {
  it("steps by 0.1 and clamps to [0.5, 3]", () => {
    expect(nextZoom(1, "in")).toBe(1.1);
    expect(nextZoom(1, "out")).toBe(0.9);
    expect(nextZoom(3, "in")).toBe(3);
    expect(nextZoom(0.5, "out")).toBe(0.5);
  });

  it("reset returns 1", () => {
    expect(nextZoom(2.4, "reset")).toBe(1);
  });
});

describe("applyZoom", () => {
  it("calls webview setZoom with the clamped factor", async () => {
    await applyZoom(1.3);
    expect(setZoom).toHaveBeenCalledWith(1.3);
    await applyZoom(99);
    expect(setZoom).toHaveBeenCalledWith(3);
  });

  it("swallows rejections (outside Tauri)", async () => {
    setZoom.mockRejectedValueOnce(new Error("no ipc"));
    await expect(applyZoom(1)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `pnpm vitest run src/features/shell/zoom.test.ts`
Expected: FAIL — модуль `./zoom` не существует.

- [ ] **Step 3: Реализовать `zoom.ts` (пока без хука)**

```ts
// src/features/shell/zoom.ts
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { clampZoom, ZOOM_STEP } from "@/lib/use-prefs";

export type ZoomAction = "in" | "out" | "reset";

/** Маппинг хоткея на действие зума. `key` — символ (раскладко-независимо для =/+/-/0),
 *  `code` — физические NumPad-клавиши, которые дают другой `key`. */
export function zoomActionFromKey(
  e: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey">,
): ZoomAction | null {
  if (!e.ctrlKey && !e.metaKey) return null;
  if (e.key === "=" || e.key === "+" || e.code === "NumpadAdd") return "in";
  if (e.key === "-" || e.code === "NumpadSubtract") return "out";
  if (e.key === "0" || e.code === "Numpad0") return "reset";
  return null;
}

export function nextZoom(current: number, action: ZoomAction): number {
  if (action === "reset") return 1;
  return clampZoom(current + (action === "in" ? ZOOM_STEP : -ZOOM_STEP));
}

/** Применить зум к webview. Вне Tauri (vitest/preview) — молча no-op. */
export async function applyZoom(factor: number): Promise<void> {
  try {
    await getCurrentWebview().setZoom(clampZoom(factor));
  } catch {
    /* best-effort */
  }
}
```

- [ ] **Step 4: Тест зелёный**

Run: `pnpm vitest run src/features/shell/zoom.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/shell/zoom.ts src/features/shell/zoom.test.ts
git commit -m "feat(zoom): pure zoom-action mapping + best-effort webview applyZoom"
```

### Task 3: Хук useUiZoom (хоткеи + применение) + подключение в WorkflowApp

**Files:**
- Modify: `src/features/shell/zoom.ts`
- Modify: `src/app/WorkflowApp.tsx`
- Test: `src/features/shell/useUiZoom.test.tsx` (create)

- [ ] **Step 1: Написать падающий тест хука**

```tsx
// src/features/shell/useUiZoom.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";

const setZoom = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setZoom }),
}));

import { useUiZoom } from "./zoom";
import { readPrefs } from "@/lib/use-prefs";

function Probe() {
  useUiZoom();
  return null;
}

const press = (init: KeyboardEventInit) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { cancelable: true, ...init }));
  });

beforeEach(() => {
  localStorage.clear();
  setZoom.mockClear();
});

describe("useUiZoom", () => {
  it("applies the persisted zoom on mount", async () => {
    render(<Probe />);
    await waitFor(() => expect(setZoom).toHaveBeenCalledWith(readPrefs().zoom));
  });

  it("Ctrl+= zooms in, Ctrl+- zooms out, Ctrl+0 resets; each re-applies", async () => {
    render(<Probe />);
    const start = readPrefs().zoom;

    press({ key: "=", ctrlKey: true });
    expect(readPrefs().zoom).toBeCloseTo(start + 0.1);
    await waitFor(() => expect(setZoom).toHaveBeenLastCalledWith(readPrefs().zoom));

    press({ key: "-", ctrlKey: true });
    press({ key: "-", ctrlKey: true });
    expect(readPrefs().zoom).toBeCloseTo(start - 0.1);

    press({ key: "0", ctrlKey: true });
    expect(readPrefs().zoom).toBe(1);
  });

  it("ignores key presses without ctrl/meta", () => {
    render(<Probe />);
    const start = readPrefs().zoom;
    press({ key: "=" });
    expect(readPrefs().zoom).toBe(start);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `pnpm vitest run src/features/shell/useUiZoom.test.tsx`
Expected: FAIL — `useUiZoom` не экспортируется.

- [ ] **Step 3: Реализовать хук в `zoom.ts`**

Дописать в `src/features/shell/zoom.ts`:

```ts
import { useEffect } from "react";
import { readPrefs, usePrefs } from "@/lib/use-prefs";

/** Зум UI: применяет prefs.zoom к webview (на маунте и при каждом изменении)
 *  и вешает глобальные хоткеи Ctrl+=/Ctrl+-/Ctrl+0. Capture-фаза, чтобы фокус
 *  в Monaco не перехватывал сочетания. */
export function useUiZoom(): void {
  const [prefs, setPref] = usePrefs();

  useEffect(() => {
    void applyZoom(prefs.zoom);
  }, [prefs.zoom]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = zoomActionFromKey(e);
      if (!action) return;
      e.preventDefault();
      setPref("zoom", nextZoom(readPrefs().zoom, action));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // setPref пишет в модульный prefs-стор, readPrefs читает свежее — биндим однажды.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
```

(Импорты объединить с уже существующими в файле.)

- [ ] **Step 4: Тест зелёный**

Run: `pnpm vitest run src/features/shell/useUiZoom.test.tsx`
Expected: PASS

- [ ] **Step 5: Подключить в WorkflowApp**

В `src/app/WorkflowApp.tsx`: `import { useUiZoom } from "@/features/shell/zoom";` и первой строкой среди хуков компонента (рядом с `useAutosaveDraft`) добавить:

```ts
  // Зум UI: персистентный prefs.zoom → webview.setZoom + хоткеи Ctrl+=/-/0.
  useUiZoom();
```

- [ ] **Step 6: Полный прогон + commit**

Run: `pnpm vitest run` и `pnpm exec tsc --noEmit`
Expected: PASS

```bash
git add src/features/shell/zoom.ts src/features/shell/useUiZoom.test.tsx src/app/WorkflowApp.tsx
git commit -m "feat(zoom): Ctrl+=/-/0 hotkeys + persisted zoom applied on startup"
```

### Task 4: Строка Zoom в Settings → Appearance

**Files:**
- Modify: `src/features/settings/AppearancePane.tsx`
- Test: `src/features/settings/AppearancePane.test.tsx` (create)

- [ ] **Step 1: Написать падающий тест**

```tsx
// src/features/settings/AppearancePane.test.tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppearancePane } from "./AppearancePane";

beforeEach(() => {
  localStorage.clear();
});

describe("AppearancePane zoom row", () => {
  it("steps zoom by 10% and resets", async () => {
    const user = userEvent.setup();
    render(<AppearancePane />);
    // дефолт 100%, Reset скрыт
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reset zoom" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("110%")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset zoom" }));
    expect(screen.getByText("100%")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(screen.getByText("90%")).toBeInTheDocument();
    // вернуть дефолт, чтобы не протекало в соседние тесты файла
    await user.click(screen.getByRole("button", { name: "Reset zoom" }));
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `pnpm vitest run src/features/settings/AppearancePane.test.tsx`
Expected: FAIL — кнопки "Zoom in/out" не существуют.

- [ ] **Step 3: Добавить строку Zoom**

В `AppearancePane.tsx` — в группу (бывшую "Theme"; переименовать заголовок в `"Display"`, т.к. Mode удалён) после строки "gRPC icon" добавить:

```tsx
        <SettingsRow
          title="Zoom"
          hint="UI scale. Ctrl+= / Ctrl+- to step, Ctrl+0 to reset."
          control={
            <div className="flex items-center gap-1.5">
              {prefs.zoom !== 1 && (
                <Button variant="ghost" size="xs" aria-label="Reset zoom" onClick={() => setPref("zoom", 1)}>
                  Reset
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="icon-xs"
                aria-label="Zoom out"
                disabled={prefs.zoom <= ZOOM_MIN}
                onClick={() => setPref("zoom", nextZoom(prefs.zoom, "out"))}
              >
                <Minus />
              </Button>
              <span className="w-11 text-center font-mono text-xs tabular-nums">
                {Math.round(prefs.zoom * 100)}%
              </span>
              <Button
                type="button"
                variant="outline"
                size="icon-xs"
                aria-label="Zoom in"
                disabled={prefs.zoom >= ZOOM_MAX}
                onClick={() => setPref("zoom", nextZoom(prefs.zoom, "in"))}
              >
                <Plus />
              </Button>
            </div>
          }
        />
```

Импорты: `Minus, Plus` из `lucide-react` (к уже импортированному `ChevronDown`), `ZOOM_MIN, ZOOM_MAX` из `@/lib/use-prefs`, `nextZoom` из `@/features/shell/zoom`. Если у `Button` нет варианта `size="icon-xs"`/`"xs"` (проверить `src/components/ui/button.tsx`) — взять ближайший существующий маленький размер (`icon-sm`/`sm`) с `className="h-6 w-6"`-подгонкой.

- [ ] **Step 4: Тест зелёный + полный прогон**

Run: `pnpm vitest run src/features/settings/AppearancePane.test.tsx`, затем `pnpm vitest run` + `pnpm exec tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/AppearancePane.tsx src/features/settings/AppearancePane.test.tsx
git commit -m "feat(zoom): zoom stepper in Settings - Appearance"
```

**🧹 /clear-чекпойнт**

---

## Phase C — Ghost-фикс + последний response

### Task 5: Баг — ghost не исчезает после Reset to template

**Диагноз (проверен по коду):** `BodyView.handleChange` (пересчёт tree/ghost) подписан на `onChange` Monaco-обёртки, который срабатывает только на пользовательские правки. Reset-to-template обновляет контролируемый проп `value` снаружи; `@monaco-editor/react` применяет его к модели программно и **подавляет** `onChange` — ghost/tree/markers остаются от старого текста. Эффекты BodyView зависят только от `[schema, mode]` и `[prefs.bodyHints]`, на `value` никто не смотрит.

**Фикс:** отслеживать последний текст, который видел `handleChange` (`live.lastText`); эффект на `[value]` ловит расхождение (= внешнее обновление) и пересинхронизирует tree/spans/lineCount + `applyGhost()`.

**Files:**
- Modify: `src/features/bodyview/BodyView.tsx`
- Test: `src/features/bodyview/BodyView.ghost.test.tsx` (create)

- [ ] **Step 1: Написать падающий регрессионный тест**

Паттерн фейк-эдитора — как в `BodyView.submit.test.tsx` (mock вызывает `onMount`), плюс учёт view-zones:

```tsx
// src/features/bodyview/BodyView.ghost.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { MessageSchemaIpc } from "@/ipc/bindings";

const captured = vi.hoisted(() => ({
  value: "",
  zones: [] as string[],
  nextId: 0,
  mounted: false,
}));

vi.mock("@/lib/monaco", () => ({
  MonacoEditor: ({
    value,
    onMount,
  }: {
    value: string;
    onMount?: (editor: unknown, monaco: unknown) => void;
  }) => {
    captured.value = value; // редактор "видит" текущий проп value
    if (!captured.mounted) {
      captured.mounted = true;
      const editor = {
        getValue: () => captured.value,
        getModel: () => null, // маркеры/схема скипаются, ghost-ветка работает
        addCommand: () => {},
        onKeyUp: () => ({ dispose: () => {} }),
        changeViewZones: (
          cb: (acc: { addZone: (z: unknown) => string; removeZone: (id: string) => void }) => void,
        ) => {
          cb({
            addZone: () => {
              const id = `z${captured.nextId++}`;
              captured.zones.push(id);
              return id;
            },
            removeZone: (id: string) => {
              captured.zones = captured.zones.filter((z) => z !== id);
            },
          });
        },
        applyFontInfo: () => {},
        createDecorationsCollection: () => ({ set: () => {}, clear: () => {} }),
      };
      onMount?.(editor, { editor: { setModelMarkers: () => {} }, MarkerSeverity: { Error: 8 }, Range: class {} });
    }
    return <div data-testid="monaco" />;
  },
  BODY_EDIT_OPTIONS: { readOnly: false },
  BODY_READONLY_OPTIONS: { readOnly: true },
}));

const prefs = { bodyHints: true };
vi.mock("@/lib/use-prefs", () => ({
  usePrefs: () => [prefs],
  readPrefs: () => prefs,
}));
vi.mock("./controller", () => ({
  attachBodyController: () => ({ dispose: () => {} }),
  BADGE_CLASS: "badge",
}));

import { BodyView } from "./BodyView";

// Минимальная схема: computeGhostLines читает только root/messages[].full_name/fields[].json_name+type_label.
const schema = {
  root: "t.Msg",
  messages: [{ full_name: "t.Msg", fields: [{ json_name: "name", type_label: "string" }] }],
  enums: [],
} as unknown as MessageSchemaIpc;

beforeEach(() => {
  captured.value = "";
  captured.zones = [];
  captured.nextId = 0;
  captured.mounted = false;
});

describe("BodyView ghost vs external value updates", () => {
  it("clears the ghost when the controlled value is replaced externally (Reset-to-template)", () => {
    const { rerender } = render(
      <BodyView mode="request" value={"{\n}"} onChange={vi.fn()} schema={schema} />,
    );
    // поле "name" отсутствует → ghost-зона видна
    expect(captured.zones.length).toBe(1);

    // Reset-to-template: value заменяется снаружи, onChange НЕ вызывается
    rerender(
      <BodyView mode="request" value={'{\n  "name": "x"\n}'} onChange={vi.fn()} schema={schema} />,
    );
    // все поля на месте → ghost обязан исчезнуть
    expect(captured.zones.length).toBe(0);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает (воспроизводит баг)**

Run: `pnpm vitest run src/features/bodyview/BodyView.ghost.test.tsx`
Expected: FAIL на второй ассерции — `zones.length` остаётся 1 (ghost не пересчитан). Если падает первая ассерция — сначала починить стаб (ghost обязан появиться на маунте), не трогая прод-код.

- [ ] **Step 3: Реализовать фикс в BodyView**

В `interface Live` добавить поле:

```ts
  /** Текст, который последним видел handleChange/маунт — для детекта внешних обновлений value. */
  lastText: string;
```

В `onMount` при инициализации `live.current` добавить `lastText: editor.getValue(),`.

В `handleChange` первой строкой ветки `if (mode === "request" && live.current)` добавить:

```ts
        live.current.lastText = v;
```

После эффекта `[schema, mode, applyGhost]` добавить новый эффект:

```tsx
  // Внешние (не пользовательские) обновления контролируемого value — например
  // Reset-to-template — обёртка Monaco применяет к модели программно и НЕ
  // прокидывает в onChange. Ловим расхождение value с последним текстом,
  // который видел handleChange, и пересинхронизируем tree/ghost.
  useEffect(() => {
    const l = live.current;
    if (mode !== "request" || !l || value === l.lastText) return;
    l.lastText = value;
    const parsed = parseWithSpans(value);
    l.tree = parsed?.tree ?? null;
    l.spans = parsed?.spans ?? [];
    l.lineCount = value.split("\n").length;
    applyGhost();
  }, [value, mode, applyGhost]);
```

(Дочерние эффекты Monaco-обёртки выполняются раньше родительских, поэтому к моменту `applyGhost` модель уже содержит новый текст.)

- [ ] **Step 4: Тесты зелёные**

Run: `pnpm vitest run src/features/bodyview/`
Expected: PASS (новый + все существующие BodyView-тесты).

- [ ] **Step 5: Commit**

```bash
git add src/features/bodyview/BodyView.tsx src/features/bodyview/BodyView.ghost.test.tsx
git commit -m "fix(bodyview): recompute ghost/tree on external value updates (Reset-to-template)"
```

### Task 6: Последний response сессии при переключении методов

**Files:**
- Create: `src/features/workflow/lastExecuted.ts`
- Test: `src/features/workflow/lastExecuted.test.ts` (create)
- Modify: `src/features/catalog/actions.ts`
- Test: `src/features/catalog/actions.test.ts` (create)
- Modify: `src/features/workflow/actions.ts` (`applyMethodSelection`)
- Modify: `src/features/workflow/actions.test.ts` (дополнить)
- Modify: `src/features/workflow/CallPanel.tsx`

- [ ] **Step 1: Падающий тест чистой функции**

```ts
// src/features/workflow/lastExecuted.test.ts
import { describe, it, expect } from "vitest";
import { newStep, type Step } from "./model";
import { lastExecutedFor, responseSeedPatch } from "./lastExecuted";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

const outcome = (code: number) =>
  ({ status_code: code } as unknown as InvokeOutcomeIpc);

function executed(service: string, method: string, address: string, code: number): Step {
  return {
    ...newStep({ address, tls: false, service, method }),
    status: code === 0 ? "ok" : "error",
    outcome: outcome(code),
  };
}

describe("lastExecutedFor", () => {
  const steps = [
    executed("p.S", "Get", "h:1", 0),
    executed("p.S", "List", "h:1", 0),
    executed("p.S", "Get", "h:1", 5), // более поздний вызов того же метода
    executed("p.S", "Get", "h:2", 0), // другой адрес
  ];

  it("returns the LATEST matching executed step", () => {
    const hit = lastExecutedFor(steps, { service: "p.S", method: "Get", address: "h:1" });
    expect(hit?.outcome).toEqual(outcome(5));
  });

  it("matches address too", () => {
    const hit = lastExecutedFor(steps, { service: "p.S", method: "Get", address: "h:2" });
    expect(hit?.outcome).toEqual(outcome(0));
  });

  it("returns null when nothing matches", () => {
    expect(lastExecutedFor(steps, { service: "p.S", method: "Nope", address: "h:1" })).toBeNull();
  });
});

describe("responseSeedPatch", () => {
  it("copies status/outcome/error from the hit", () => {
    const hit = executed("p.S", "Get", "h:1", 5);
    expect(responseSeedPatch(hit)).toEqual({ status: "error", outcome: outcome(5), error: null });
  });

  it("null hit clears the response fields", () => {
    expect(responseSeedPatch(null)).toEqual({ status: "draft", outcome: null, error: null });
  });
});
```

- [ ] **Step 2: Убедиться, что падает**

Run: `pnpm vitest run src/features/workflow/lastExecuted.test.ts`
Expected: FAIL — модуль не существует.

- [ ] **Step 3: Реализовать**

```ts
// src/features/workflow/lastExecuted.ts
import type { Step } from "./model";

export interface CallKey {
  service: string;
  method: string;
  /** Шаблон адреса (как хранится в драфте/истории, до {{var}}-резолва). */
  address: string;
}

/** Последний executed-снапшот ЭТОЙ сессии для того же вызова. История воркфлоу
 *  хранит только дошедшие до сервера вызовы (ok + gRPC-error), append-only. */
export function lastExecutedFor(steps: Step[], key: CallKey): Step | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (s.service === key.service && s.method === key.method && s.address === key.address) {
      return s;
    }
  }
  return null;
}

/** Response-поля из найденного шага; null → чистая Response-панель. */
export function responseSeedPatch(
  last: Step | null,
): Pick<Step, "status" | "outcome" | "error"> {
  return last
    ? { status: last.status, outcome: last.outcome, error: last.error }
    : { status: "draft", outcome: null, error: null };
}
```

Run: `pnpm vitest run src/features/workflow/lastExecuted.test.ts` → PASS. Commit:

```bash
git add src/features/workflow/lastExecuted.ts src/features/workflow/lastExecuted.test.ts
git commit -m "feat(workflow): lastExecutedFor - look up the session's last response for a call"
```

- [ ] **Step 4: Падающий тест openSavedRequest-сидинга**

```ts
// src/features/catalog/actions.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { workflowStore } from "@/features/workflow/store";
import { newStep } from "@/features/workflow/model";
import { openSavedRequest } from "./actions";
import type { InvokeOutcomeIpc, SavedRequestIpc } from "@/ipc/bindings";

const outcome = { status_code: 0 } as unknown as InvokeOutcomeIpc;

const saved: SavedRequestIpc = {
  id: "r1",
  name: "Get",
  address_template: "h:1",
  service: "p.S",
  method: "Get",
  body_template: "{}",
  metadata: [],
  auth: { kind: "none" },
  tls_override: false,
  last_used_at: null,
  use_count: 0,
};

beforeEach(() => {
  workflowStore.reset();
});

describe("openSavedRequest", () => {
  it("seeds the draft's response from the session's last executed step", () => {
    workflowStore.commitExecutedStep({
      ...newStep({ address: "h:1", tls: false, service: "p.S", method: "Get" }),
      status: "ok",
      outcome,
    });
    openSavedRequest("c1", saved);
    const d = workflowStore.getState().draft!;
    expect(d.outcome).toEqual(outcome);
    expect(d.status).toBe("ok");
  });

  it("leaves a clean response when the session has no matching call", () => {
    openSavedRequest("c1", saved);
    const d = workflowStore.getState().draft!;
    expect(d.outcome).toBeNull();
    expect(d.status).toBe("draft");
  });
});
```

Run: `pnpm vitest run src/features/catalog/actions.test.ts`
Expected: FAIL — первый тест (outcome === null).

- [ ] **Step 5: Реализовать сидинг в openSavedRequest**

`src/features/catalog/actions.ts`:

```ts
import type { SavedRequestIpc } from "@/ipc/bindings";
import { workflowStore } from "@/features/workflow/store";
import { setView } from "@/features/workflow/reducers";
import { newStep } from "@/features/workflow/model";
import { lastExecutedFor, responseSeedPatch } from "@/features/workflow/lastExecuted";
import { savedRequestToDraft } from "./mapping";

/** Open a saved request in Focus as the global pending-draft, bound to its origin.
 *  Response-панель сидируется последним выполненным в ЭТОЙ сессии вызовом того же
 *  service/method/address (история воркфлоу). */
export function openSavedRequest(collectionId: string, saved: SavedRequestIpc): void {
  workflowStore.update((w) => setView(w, "focus"));
  const draft = savedRequestToDraft(saved);
  const last = lastExecutedFor(workflowStore.activeWorkflow().steps, {
    service: draft.service,
    method: draft.method,
    address: draft.address,
  });
  workflowStore.setDraft(
    { ...draft, ...responseSeedPatch(last) },
    { collectionId, requestId: saved.id, requestName: saved.name },
  );
}
```

(`newRequestDraft` без изменений.)

Run: `pnpm vitest run src/features/catalog/actions.test.ts` → PASS.

- [ ] **Step 6: Падающий тест applyMethodSelection**

В `src/features/workflow/actions.test.ts` дополнить describe `applyMethodSelection` (моки ipc в файле уже есть — `grpcBuildRequestSkeleton` замокан; следовать существующему сетапу файла):

```ts
  it("seeds the response fields from history for the newly selected method", async () => {
    const outcome = { status_code: 0 } as unknown as InvokeOutcomeIpc;
    const history: Step[] = [{
      ...(await createStepFromMethod({ address: "h:1", tls: false }, "p.S", "Other")),
      status: "ok" as const,
      outcome,
    }];
    const patches: Partial<Step>[] = [];
    await applyMethodSelection(
      (p) => patches.push(p),
      { address: "h:1", tls: false },
      { requestJson: "{}", service: "p.S", method: "Get" },
      { service: "p.S", method: "Other" },
      history,
    );
    const main = patches[0];
    expect(main.outcome).toEqual(outcome);
    expect(main.status).toBe("ok");
  });

  it("clears a stale response when the new method has no history", async () => {
    const patches: Partial<Step>[] = [];
    await applyMethodSelection(
      (p) => patches.push(p),
      { address: "h:1", tls: false },
      { requestJson: "{}", service: "p.S", method: "Get" },
      { service: "p.S", method: "Fresh" },
      [],
    );
    expect(patches[0].outcome).toBeNull();
    expect(patches[0].status).toBe("draft");
  });
```

(Импорты `InvokeOutcomeIpc`/`Step` добавить к существующим в файле.)

Run: `pnpm vitest run src/features/workflow/actions.test.ts`
Expected: FAIL — лишний аргумент / нет response-полей в патче.

- [ ] **Step 7: Реализовать в applyMethodSelection + CallPanel**

`src/features/workflow/actions.ts` — заменить `applyMethodSelection`:

```ts
import { lastExecutedFor, responseSeedPatch } from "./lastExecuted";

/** MethodPicker handler for an editable draft. Patches service/method (+ response-поля:
 *  последний выполненный в сессии вызов нового метода, либо очистка), then resets the
 *  body to `EMPTY_BODY_TEMPLATE` ONLY when the current body is still pristine. */
export async function applyMethodSelection(
  patch: (p: Partial<Step>) => void,
  target: CallTargetInit,
  current: { requestJson: string; service: string; method: string },
  m: { service: string; method: string },
  history: Step[] = [],
): Promise<void> {
  const oldSkeleton = await buildRequestSkeletonSafe(target, current.service, current.method);
  const pristine = isPristineBody(current.requestJson, oldSkeleton);
  const last = lastExecutedFor(history, {
    service: m.service,
    method: m.method,
    address: target.address,
  });
  patch({ service: m.service, method: m.method, ...responseSeedPatch(last) });
  if (pristine) patch({ requestJson: EMPTY_BODY_TEMPLATE });
}
```

`src/features/workflow/CallPanel.tsx` — в `onSelectMethod` пробросить историю активного воркфлоу (импорт `workflowStore` из `./store`):

```tsx
      onSelectMethod={(m) =>
        void applyMethodSelection(
          onPatch,
          { address: step.address, tls: step.tls },
          { requestJson: step.requestJson, service: step.service, method: step.method },
          m,
          workflowStore.activeWorkflow().steps,
        )
      }
```

- [ ] **Step 8: Полный прогон + commit**

Run: `pnpm vitest run` и `pnpm exec tsc --noEmit`
Expected: PASS

```bash
git add src/features/workflow/ src/features/catalog/actions.ts src/features/catalog/actions.test.ts
git commit -m "feat(response): restore the session's last response when opening/switching methods"
```

**🧹 /clear-чекпойнт**

---

## Phase D — Quick-add + Duplicate

### Task 7: Quick-add метода в коллекцию из MethodPicker

**Files:**
- Create: `src/features/catalog/quickAdd.ts`
- Test: `src/features/catalog/quickAdd.test.ts` (create)
- Modify: `src/features/shell/MethodPicker.tsx`
- Modify: `src/features/shell/MethodPicker.test.tsx` (дополнить)
- Modify: `src/app/WorkflowApp.tsx`, `src/features/workflow/FocusView.tsx`, `src/features/workflow/CallPanel.tsx`, `src/features/workflow/DraftAddressBar.tsx` (проброс хендлера)

- [ ] **Step 1: Падающий тест планировщика**

```ts
// src/features/catalog/quickAdd.test.ts
import { describe, it, expect } from "vitest";
import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";
import { planQuickAdd } from "./quickAdd";

const req = (id: string, service: string, method: string, address: string): ItemIpc => ({
  type: "request",
  id,
  name: method,
  address_template: address,
  service,
  method,
  body_template: "{}",
  metadata: [],
  auth: { kind: "none" },
  tls_override: false,
  last_used_at: null,
  use_count: 0,
});

const col = (id: string, name: string, items: ItemIpc[] = []): CollectionIpc => ({
  id,
  name,
  items,
  variables: {},
  auth: { kind: "none" },
  default_tls: false,
  skip_tls_verify: false,
  pinned: false,
  description: null,
  created_at: 0,
  expanded: false,
});

const folder = (id: string, name: string, items: ItemIpc[] = []): ItemIpc => ({
  type: "folder",
  id,
  name,
  items,
  expanded: false,
});

describe("planQuickAdd", () => {
  it("dedupes: same service+method+address already saved → exists", () => {
    const tree = [col("c1", "Main", [folder("f1", "Notes", [req("r1", "n.NotesService", "Get", "h:1")])])];
    const plan = planQuickAdd(tree, "n.NotesService", "Get", "h:1");
    expect(plan).toEqual({
      kind: "exists",
      location: expect.objectContaining({ collectionId: "c1", requestId: "r1" }),
    });
  });

  it("different address is NOT a dupe", () => {
    const tree = [col("c1", "Main", [req("r1", "n.NotesService", "Get", "h:1")])];
    expect(planQuickAdd(tree, "n.NotesService", "Get", "h:2").kind).toBe("create");
  });

  it("no collections → create with null ids and default names", () => {
    expect(planQuickAdd([], "n.NotesService", "Get", "h:1")).toEqual({
      kind: "create",
      collectionId: null,
      collectionName: "My Collection",
      folderId: null,
      folderName: "Notes",
      requestName: "Get",
    });
  });

  it("reuses an existing root folder named after the service", () => {
    const tree = [col("c1", "Main", [folder("f1", "Notes")])];
    const plan = planQuickAdd(tree, "n.NotesService", "Get", "h:1");
    expect(plan).toEqual({
      kind: "create",
      collectionId: "c1",
      collectionName: "Main",
      folderId: "f1",
      folderName: "Notes",
      requestName: "Get",
    });
  });

  it("targets the first collection; missing folder → folderId null", () => {
    const tree = [col("c1", "Main"), col("c2", "Other")];
    const plan = planQuickAdd(tree, "n.NotesService", "Get", "h:1");
    expect(plan).toMatchObject({ kind: "create", collectionId: "c1", folderId: null });
  });
});
```

- [ ] **Step 2: Убедиться, что падает**

Run: `pnpm vitest run src/features/catalog/quickAdd.test.ts`
Expected: FAIL — модуль не существует.

- [ ] **Step 3: Реализовать планировщик**

```ts
// src/features/catalog/quickAdd.ts
import type { CollectionIpc } from "@/ipc/bindings";
import { findSavedLocations, suggestSaveTarget, type SaveLocation } from "./grouping";

export type QuickAddPlan =
  | { kind: "exists"; location: SaveLocation }
  | {
      kind: "create";
      /** null → коллекций нет вовсе, исполнитель создаёт новую с `collectionName`. */
      collectionId: string | null;
      collectionName: string;
      /** Существующая корневая папка по имени сервиса; null → создать `folderName`. */
      folderId: string | null;
      folderName: string;
      requestName: string;
    };

/** Куда быстрый «+» кладёт метод: дедуп по service+method+address, иначе —
 *  первая коллекция + корневая папка по сервису (рекомендация suggestSaveTarget). */
export function planQuickAdd(
  tree: CollectionIpc[],
  service: string,
  method: string,
  address: string,
): QuickAddPlan {
  const existing = findSavedLocations(tree, { service, method, address });
  if (existing.length > 0) return { kind: "exists", location: existing[0] };

  const reco = suggestSaveTarget(service, method);
  const col = tree[0] ?? null;
  const folderHit = col?.items.find((it) => it.type === "folder" && it.name === reco.folderName);
  return {
    kind: "create",
    collectionId: col?.id ?? null,
    collectionName: col?.name ?? "My Collection",
    folderId: folderHit?.id ?? null,
    folderName: reco.folderName,
    requestName: reco.requestName,
  };
}
```

Run: `pnpm vitest run src/features/catalog/quickAdd.test.ts` → PASS. Commit:

```bash
git add src/features/catalog/quickAdd.ts src/features/catalog/quickAdd.test.ts
git commit -m "feat(catalog): planQuickAdd - dedupe + recommended target for one-click save"
```

- [ ] **Step 4: Падающий тест кнопки «+» в MethodPicker**

В `src/features/shell/MethodPicker.test.tsx` дополнить (следовать сетапу файла — как там открывается dropdown и строится `catalog`):

```tsx
  it("renders a quick-add button per method when onQuickAdd is provided and fires it", async () => {
    const onQuickAdd = vi.fn();
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <MethodPicker
        selected={{ service: "", method: "", kind: "unary" }}
        catalog={catalog} // фикстура файла: содержит сервис p.S с методом Get
        onSelect={onSelect}
        onQuickAdd={onQuickAdd}
      />,
    );
    await user.click(screen.getByRole("button", { name: /select a method/i }));
    await user.click(await screen.findByRole("button", { name: "Add Get to collection" }));
    expect(onQuickAdd).toHaveBeenCalledWith("p.S", "Get");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renders no quick-add buttons without onQuickAdd", async () => {
    const user = userEvent.setup();
    render(
      <MethodPicker
        selected={{ service: "", method: "", kind: "unary" }}
        catalog={catalog}
        onSelect={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /select a method/i }));
    expect(screen.queryByRole("button", { name: /to collection$/ })).toBeNull();
  });
```

(Если фикстура каталога в файле использует другие имена сервиса/метода — подставить её реальные имена в ассерции.)

Run: `pnpm vitest run src/features/shell/MethodPicker.test.tsx`
Expected: FAIL — пропа `onQuickAdd` нет.

- [ ] **Step 5: Реализовать кнопку в MethodPicker**

В `MethodPickerProps` добавить:

```ts
  /** Hover-«+» на строке метода: быстрое сохранение в коллекцию. Omit — кнопки нет. */
  onQuickAdd?: (service: string, method: string) => void;
```

Строку метода (внутри `svc.methods.map`) превратить из одиночной кнопки в контейнер — кнопка-в-кнопке невалидна, поэтому обёртка + абсолютный «+» (паттерн RowMenu):

```tsx
                  {svc.methods.map((m) => {
                    const active = selected.service === svc.full && selected.method === m.name;
                    return (
                      <div key={m.name} className="group/mrow relative">
                        <button
                          type="button"
                          data-active={active}
                          onClick={() => {
                            onSelect({ service: svc.full, method: m.name, kind: m.kind });
                            setOpen(false);
                          }}
                          className={cn(
                            "mp-mrow w-full flex items-center gap-2 px-3 pl-8 h-7 font-mono text-xs transition-colors text-left",
                            onQuickAdd && "pr-9",
                            active ? "bg-accent text-foreground" : "text-foreground/85 hover:bg-accent/60",
                          )}
                        >
                          <span className="mp-mname min-w-0 flex-1 truncate font-medium text-foreground">{m.name}</span>
                          <KindDot kind={m.kind} />
                        </button>
                        {onQuickAdd && (
                          <button
                            type="button"
                            aria-label={`Add ${m.name} to collection`}
                            title="Add to collection"
                            onClick={(e) => {
                              e.stopPropagation();
                              onQuickAdd(svc.full, m.name);
                              setOpen(false);
                            }}
                            className={cn(
                              "absolute right-2 top-1/2 z-10 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded",
                              "text-muted-foreground hover:bg-accent hover:text-foreground transition-opacity",
                              "opacity-0 group-hover/mrow:opacity-100 focus-visible:opacity-100",
                            )}
                          >
                            <Plus className="size-3" />
                          </button>
                        )}
                      </div>
                    );
                  })}
```

Импорт `Plus` из `lucide-react`, деструктурировать `onQuickAdd` из пропсов.

Run: `pnpm vitest run src/features/shell/MethodPicker.test.tsx` → PASS.

- [ ] **Step 6: Исполнитель в WorkflowApp + проброс**

`src/app/WorkflowApp.tsx` — добавить хендлер (рядом с `openRequest`); импорты: `planQuickAdd` из `@/features/catalog/quickAdd`, `findSavedRequest` уже импортирован, `EMPTY_BODY_TEMPLATE` из `@/features/workflow/actions`, `toast` из `sonner`:

```tsx
  // Быстрый «+» на строке метода в MethodPicker: сохранить по рекомендации и открыть.
  async function quickAddMethod(service: string, method: string) {
    const current = workflowStore.getState().draft;
    const address = current?.address ?? "";
    const plan = planQuickAdd(cat.tree, service, method, address);
    if (plan.kind === "exists") {
      const req = findSavedRequest(cat.tree, plan.location.collectionId, plan.location.requestId);
      if (req) {
        toast.info(`Уже в коллекции «${plan.location.collectionName}»`);
        openRequest(plan.location.collectionId, req);
      }
      return;
    }
    const collectionId = plan.collectionId ?? (await cat.createCollection(plan.collectionName));
    const folderId = plan.folderId ?? (await createFolder(collectionId, null, plan.folderName));
    const saved: SavedRequestIpc = {
      id: newId(),
      name: plan.requestName,
      address_template: address,
      service,
      method,
      body_template: EMPTY_BODY_TEMPLATE,
      metadata: [],
      auth: { kind: "none" },
      tls_override: current?.tls ?? false,
      last_used_at: null,
      use_count: 0,
    };
    await cat.addItem(collectionId, folderId, { type: "request", ...saved });
    toast.success(`Сохранено в ${plan.collectionName} / ${plan.folderName}`);
    openRequest(collectionId, saved); // guardedRun внутри + persist active_request
  }
```

Проброс вниз (4 механических хопа):
1. `renderView(wf.view, onRequestSave)` → добавить параметр: `renderView(view, onRequestSave, onQuickAddMethod)`; в `default`-ветке `<FocusView onRequestSave={onRequestSave} onQuickAddMethod={onQuickAddMethod} />`; в вызове передать `(service, method) => void quickAddMethod(service, method)`.
2. `FocusViewProps`: `onQuickAddMethod?: (service: string, method: string) => void;` → `<CallPanel … onQuickAddMethod={onQuickAddMethod} />`.
3. `CallPanelProps`: то же поле → передать в `<DraftAddressBar … onQuickAdd={onQuickAddMethod} />` (только в editable-ветке).
4. `DraftAddressBarProps`: `onQuickAdd?: (service: string, method: string) => void;` → `<MethodPicker … onQuickAdd={onQuickAdd} />`.

- [ ] **Step 7: Полный прогон + commit**

Run: `pnpm vitest run` и `pnpm exec tsc --noEmit`
Expected: PASS

```bash
git add src/app/WorkflowApp.tsx src/features/workflow/ src/features/shell/MethodPicker.tsx src/features/shell/MethodPicker.test.tsx
git commit -m "feat(catalog): one-click quick-add of a method to the collection from MethodPicker"
```

### Task 8: Кнопка Duplicate текущего сохранённого запроса

**Files:**
- Modify: `src/features/catalog/useCatalogTree.ts` (duplicateItem возвращает скопированный item)
- Modify: `src/features/catalog/useCatalogTree.test.ts`
- Modify: `src/features/workflow/FocusView.tsx`
- Modify: `src/features/workflow/FocusView.test.tsx`

- [ ] **Step 1: Падающий тест возврата duplicateItem**

В `useCatalogTree.test.ts` найти тест `duplicateItem` (~строка 99) и усилить: mock `collectionGet` должен вернуть коллекцию, СОДЕРЖАЩУЮ скопированный запрос с id `"r1-copy"` (использовать фикстуры-хелперы файла), а ассерция — проверить возврат:

```ts
    let item: ItemIpc | null = null;
    await act(async () => { item = await result.current.duplicateItem("c1", "r1"); });
    // duplicateItem возвращает скопированный item из перезагруженной коллекции
    expect(item).toMatchObject({ id: "r1-copy", type: "request" });
```

(Точную форму фикстуры взять из хелперов этого файла — там уже есть конструктор коллекции с запросом `r1`; добавить в мокнутый `collectionGet` второй запрос с id `r1-copy`.)

Run: `pnpm vitest run src/features/catalog/useCatalogTree.test.ts`
Expected: FAIL — duplicateItem возвращает `void`.

- [ ] **Step 2: Реализовать возврат**

В `useCatalogTree.ts`:
- интерфейс: `duplicateItem: (collectionId: string, itemId: string) => Promise<ItemIpc | null>;`
- реализация (бэкенд-команда уже возвращает id копии — `ipc.collectionDuplicateItem: Promise<string>`):

```ts
  // Backend assigns the new id and deep-copies; reload the affected collection
  // and hand the caller the duplicated item (null если не нашёлся — гонка/папка).
  const duplicateItem = useCallback(
    async (collectionId: string, itemId: string): Promise<ItemIpc | null> => {
      const name = itemNameOf(treeRef.current, collectionId, itemId);
      try {
        const newItemId = await ipc.collectionDuplicateItem(collectionId, itemId);
        const fresh = await ipc.collectionGet(collectionId);
        apply(treeRef.current.map((c) => (c.id === collectionId ? fresh : c)));
        return findItemById(fresh.items, newItemId) ?? null;
        // Duplicates are silent on success; only report failure.
      } catch (e) {
        toast.error(`Couldn't duplicate "${name}"`);
        throw e;
      }
    },
    [apply],
  );
```

Существующие потребители (`CollectionTree` → `onDuplicateItem`) совместимы: функция с `Promise<ItemIpc | null>` присваивается полю с возвратом `void`.

Run: `pnpm vitest run src/features/catalog/useCatalogTree.test.ts` → PASS.

- [ ] **Step 3: Падающий тест кнопки в FocusView**

В `FocusView.test.tsx` (следовать сетапу файла — как мокается каталог/провайдер; если FocusView рендерится через обёртку с `CatalogProvider`, замокать `@/features/catalog/CatalogProvider` точечно):

```tsx
  it("duplicates the bound request and opens the copy", async () => {
    const copied: ItemIpc = {
      type: "request", id: "r1-copy", name: "Get copy", address_template: "h:1",
      service: "p.S", method: "Get", body_template: "{}", metadata: [],
      auth: { kind: "none" }, tls_override: false, last_used_at: null, use_count: 0,
    };
    const duplicateItem = vi.fn().mockResolvedValue(copied);
    // mock useCatalog() → { ...остальные поля из сетапа файла, duplicateItem }
    workflowStore.setDraft(
      newStep({ address: "h:1", tls: false, service: "p.S", method: "Get" }),
      { collectionId: "c1", requestId: "r1", requestName: "Get" },
    );
    const user = userEvent.setup();
    render(<FocusView />); // в обёртке файла
    await user.click(screen.getByRole("button", { name: "Duplicate request" }));
    expect(duplicateItem).toHaveBeenCalledWith("c1", "r1");
    await waitFor(() => {
      const st = workflowStore.getState();
      expect(st.draftOrigin?.requestId).toBe("r1-copy");
      expect(st.draft?.method).toBe("Get");
    });
  });

  it("shows no duplicate button for an unbound draft", () => {
    workflowStore.setDraft(newStep({ address: "h:1", tls: false, service: "p.S", method: "Get" }));
    render(<FocusView />);
    expect(screen.queryByRole("button", { name: "Duplicate request" })).toBeNull();
  });
```

Также замокать `@/features/catalog/uiState` (`patchUiState: vi.fn()`), если файл ещё не мокает.

Run: `pnpm vitest run src/features/workflow/FocusView.test.tsx`
Expected: FAIL — кнопки нет.

- [ ] **Step 4: Реализовать кнопку в FocusView**

В `FocusView.tsx` — origin-ветку хедера заменить на:

```tsx
          {origin ? (
            <span className="flex items-center gap-2">
              <Tooltip content="Duplicate request">
                <button
                  type="button"
                  aria-label="Duplicate request"
                  onClick={() => void duplicate()}
                  className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Copy className="size-3.5" />
                </button>
              </Tooltip>
              <span className="text-muted-foreground" data-testid="autosave-status">
                Сохранено
              </span>
            </span>
          ) : (
            /* существующая кнопка Сохранить без изменений */
          )}
```

И функция внутри компонента (origin-bound черновик автосейвится, discard-guard не нужен):

```tsx
  const { tree, duplicateItem } = useCatalog(); // tree уже деструктурирован — дополнить
  async function duplicate() {
    if (!origin) return;
    const item = await duplicateItem(origin.collectionId, origin.requestId);
    if (!item || item.type !== "request") return;
    openSavedRequest(origin.collectionId, item);
    void patchUiState({ active_request: { collection_id: origin.collectionId, item_id: item.id } });
    toast.success(`Duplicated as "${item.name}"`);
  }
```

Импорты: `Copy` из `lucide-react` (к `Save`), `Tooltip` из `@/components/ui/tooltip`, `openSavedRequest` из `@/features/catalog/actions`, `patchUiState` из `@/features/catalog/uiState`, `toast` из `sonner`.

- [ ] **Step 5: Полный прогон + commit**

Run: `pnpm vitest run` и `pnpm exec tsc --noEmit`
Expected: PASS

```bash
git add src/features/catalog/useCatalogTree.ts src/features/catalog/useCatalogTree.test.ts src/features/workflow/FocusView.tsx src/features/workflow/FocusView.test.tsx
git commit -m "feat(catalog): duplicate the open saved request from the Focus header and switch to the copy"
```

**🧹 /clear-чекпойнт**

---

## Phase E — Гейт и живая проверка

### Task 9: Полный гейт + live-проверка в WebView2

- [ ] **Step 1: Полный фронтовый гейт**

Run: `pnpm exec tsc --noEmit && pnpm vitest run && pnpm build`
Expected: всё зелёное.

- [ ] **Step 2: Rust-гейт**

Run: `cargo test -p handshaker-core` (из корня) и `cargo test` (из `src-tauri`)
Expected: PASS (бэкенд не менялся — регрессий быть не должно).

- [ ] **Step 3: Live-проверка (требует человека/Preview за WebView2)**

`pnpm tauri dev`, проверить руками:
1. **Зум:** Ctrl+= / Ctrl+- / Ctrl+0; степпер и Reset в Settings → Appearance; рестарт приложения сохраняет масштаб; хоткей работает при фокусе в Monaco.
2. **Dark-only:** кнопки темы нет ни в titlebar, ни в Settings; приложение тёмное после рестарта.
3. **Quick-add:** «+» на hover строки метода в dropdown; клик создаёт `Коллекция/Сервис/Метод`, открывает его (заголовок-брэдкрамб + «Сохранено»), тост; повторный «+» того же метода — тост «Уже в коллекции», открыт существующий.
4. **Duplicate:** иконка Copy в хедере открытого сохранённого запроса; копия рядом с оригиналом в сайдбаре, открыта, тост.
5. **Ghost:** выбрать метод с полями → ↺ Reset to template → ghost исчез; Ctrl+Z (пустое тело) → ghost вернулся.
6. **Последний response:** Send на методе A → переключить на B → Response пуст; вернуться на A (через сайдбар и через MethodPicker) → последний ответ A виден.

- [ ] **Step 4: Финал**

Зафиксировать замечания live-прохода (если есть) отдельными фиксами, обновить статус-баннер этого плана и «Active work» в `CLAUDE.md`.
