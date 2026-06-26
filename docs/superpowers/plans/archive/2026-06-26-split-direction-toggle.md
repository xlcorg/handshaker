# Split-direction toggle — Implementation Plan

**Статус:** 🎉 DONE 2026-06-26 — все задачи выполнены и влиты в `main` ff `4cc5c0c`. Гейт: vitest 1133 · tsc · vite build.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Кнопка в титлбаре (между Toggle sidebar и Check for updates) + глобальный хоткей `Alt+V` / `⌥⌘V`, переключающие `prefs.split` (Left/Right ↔ Top/Bottom); все строки — в `messages.ts`.

**Architecture:** Чистый фронт. Титлбар уже держит `usePrefs()` → читает/пишет `prefs.split` напрямую (ноль проброса пропсов); `CallPanel` реагирует через общий реактивный стор prefs. Хоткей — новый `splitDirection.ts` (зеркало `wordWrap.ts`), подключён в `WorkflowApp`. Видимые строки централизованы в `messages.ts` (`.claude/rules/ui-strings.md`).

**Tech Stack:** React 18 · TypeScript · lucide-react (`Columns2`/`Rows2`) · vitest + Testing Library · Tauri 2 (webview).

**Спека:** `docs/superpowers/specs/2026-06-26-split-direction-toggle-design.md`

**Гейт (после каждой задачи, целиком в конце):** `pnpm vitest run <файл>` для точечного теста; финально `pnpm test` (полный vitest) · `pnpm build` (tsc + vite). Бэкенд/IPC/bindings не трогаем ⇒ `cargo` не нужен.

---

### Task 0: Закоммитить спеку + инфраструктуру правил

Спека, `.gitignore` и `.claude/rules/ui-strings.md` уже созданы в рабочем дереве (незакоммичены). Зафиксировать до старта кода.

**Files:**
- Commit (already on disk): `docs/superpowers/specs/2026-06-26-split-direction-toggle-design.md`, `.gitignore`, `.claude/rules/ui-strings.md`

- [ ] **Step 1: Проверить, что правило не игнорируется**

Run: `git check-ignore -v .claude/rules/ui-strings.md && echo IGNORED || echo OK`
Expected: `OK` (файл коммитимый), `.claude/worktrees` при этом остаётся игнорируемым.

- [ ] **Step 2: Commit**

```bash
git add .gitignore .claude/rules/ui-strings.md docs/superpowers/specs/2026-06-26-split-direction-toggle-design.md
git commit -m "docs(rules): un-ignore .claude/rules/ + ui-strings rule; split-toggle spec" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 1: `splitDirection.ts` — чистые `nextSplit` + `isSplitToggleHotkey`

**Files:**
- Create: `src/features/shell/splitDirection.ts`
- Test: `src/features/shell/splitDirection.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/features/shell/splitDirection.test.ts
import { describe, it, expect } from "vitest";
import { isSplitToggleHotkey, nextSplit } from "./splitDirection";

type KeyInit = Parameters<typeof isSplitToggleHotkey>[0];
const ev = (over: Partial<KeyInit>): KeyInit => ({
  code: "KeyV",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
});

describe("nextSplit", () => {
  it("toggles both ways", () => {
    expect(nextSplit("horizontal")).toBe("vertical");
    expect(nextSplit("vertical")).toBe("horizontal");
  });
});

describe("isSplitToggleHotkey on Windows/Linux (mac=false)", () => {
  it("accepts Alt+V", () => {
    expect(isSplitToggleHotkey(ev({ altKey: true }), false)).toBe(true);
  });
  it("rejects AltGr (Ctrl+Alt)+V, Shift, Meta, bare V, and other keys", () => {
    expect(isSplitToggleHotkey(ev({ altKey: true, ctrlKey: true }), false)).toBe(false);
    expect(isSplitToggleHotkey(ev({ altKey: true, shiftKey: true }), false)).toBe(false);
    expect(isSplitToggleHotkey(ev({ altKey: true, metaKey: true }), false)).toBe(false);
    expect(isSplitToggleHotkey(ev({ altKey: false }), false)).toBe(false);
    expect(isSplitToggleHotkey(ev({ code: "KeyZ", altKey: true }), false)).toBe(false);
  });
});

describe("isSplitToggleHotkey on macOS (mac=true)", () => {
  it("accepts ⌥⌘V (Alt+Meta+V)", () => {
    expect(isSplitToggleHotkey(ev({ altKey: true, metaKey: true }), true)).toBe(true);
  });
  it("rejects bare ⌥V (no Meta) and Ctrl+Alt+V", () => {
    expect(isSplitToggleHotkey(ev({ altKey: true }), true)).toBe(false);
    expect(isSplitToggleHotkey(ev({ altKey: true, metaKey: true, ctrlKey: true }), true)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/features/shell/splitDirection.test.ts`
Expected: FAIL — `does not provide an export named 'isSplitToggleHotkey'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/features/shell/splitDirection.ts
import type { SplitDir } from "@/lib/use-prefs";

/** Следующая ориентация по кругу (двух-состояний тоггл). */
export function nextSplit(cur: SplitDir): SplitDir {
  return cur === "horizontal" ? "vertical" : "horizontal";
}

/** Предикат хоткея split-direction по ФИЗИЧЕСКОЙ клавише V (раскладко-независимо):
 *   - Windows/Linux — Alt+V, без Ctrl (AltGr = Ctrl+Alt), Meta, Shift;
 *   - macOS — ⌥⌘V (голый ⌥V печатает символ / перехватывается; Command гасит
 *     композицию). Без Ctrl, без Shift. `mac` передаётся вызывающим (хук берёт
 *     isMacOS) — предикат чистый и тестируется на обеих платформах. */
export function isSplitToggleHotkey(
  e: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
  mac: boolean,
): boolean {
  if (e.code !== "KeyV" || e.shiftKey) return false;
  if (mac) return e.altKey && e.metaKey && !e.ctrlKey;
  return e.altKey && !e.ctrlKey && !e.metaKey;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/features/shell/splitDirection.test.ts`
Expected: PASS (все кейсы).

- [ ] **Step 5: Commit**

```bash
git add src/features/shell/splitDirection.ts src/features/shell/splitDirection.test.ts
git commit -m "feat(shell): pure split-direction helpers (nextSplit + isSplitToggleHotkey)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `useSplitDirectionHotkey` + подключение в `WorkflowApp`

**Files:**
- Modify: `src/features/shell/splitDirection.ts` (добавить хук)
- Test: `src/features/shell/useSplitDirectionHotkey.test.tsx` (create)
- Modify: `src/app/WorkflowApp.tsx:84` (вызов рядом с `useWordWrapHotkey()`)

- [ ] **Step 1: Write the failing test** (зеркало `useWordWrapHotkey.test.tsx`)

```tsx
// src/features/shell/useSplitDirectionHotkey.test.tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { act } from "react";
import { useSplitDirectionHotkey } from "./splitDirection";
import { readPrefs, setPref } from "@/lib/use-prefs";

function Probe() {
  useSplitDirectionHotkey();
  return null;
}

const press = (init: KeyboardEventInit) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { cancelable: true, ...init }));
  });

beforeEach(() => {
  setPref("split", "vertical"); // детерминированный старт (in-memory + localStorage)
});

describe("useSplitDirectionHotkey", () => {
  it("Alt+V toggles the split pref both ways", () => {
    render(<Probe />);
    expect(readPrefs().split).toBe("vertical");
    press({ code: "KeyV", altKey: true });
    expect(readPrefs().split).toBe("horizontal");
    press({ code: "KeyV", altKey: true });
    expect(readPrefs().split).toBe("vertical");
  });

  it("ignores AltGr (Ctrl+Alt)+V", () => {
    render(<Probe />);
    press({ code: "KeyV", altKey: true, ctrlKey: true });
    expect(readPrefs().split).toBe("vertical");
  });

  it("preventDefault on a real Alt+V (suppresses any stray handler)", () => {
    render(<Probe />);
    const e = new KeyboardEvent("keydown", { code: "KeyV", altKey: true, cancelable: true });
    act(() => {
      window.dispatchEvent(e);
    });
    expect(e.defaultPrevented).toBe(true);
  });
});
```

> Примечание: тест проверяет Windows-аккорд (`isMacOS` в jsdom = false). Mac-ветка предиката покрыта чистым тестом в Task 1.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/features/shell/useSplitDirectionHotkey.test.tsx`
Expected: FAIL — `does not provide an export named 'useSplitDirectionHotkey'`.

- [ ] **Step 3: Add the hook to `splitDirection.ts`**

Дописать в конец файла (и добавить импорты сверху):

```ts
import { useEffect } from "react";
import { readPrefs, setPref } from "@/lib/use-prefs";
import { isMacOS } from "@/lib/platform";
```

```ts
/** Глобальный хоткей split-direction → переключает pref `split`. Аккорд из
 *  isSplitToggleHotkey (Alt+V на Win/Linux, ⌥⌘V на macOS). Capture-фаза +
 *  preventDefault/stopPropagation: capture-фаза НЕ равна подавлению — нужен
 *  stopPropagation, иначе Monaco/прочие увидят событие (урок env-cycle). Ни Alt+V,
 *  ни ⌥⌘V не являются дефолтом Monaco, поэтому отвязывать ничего не нужно. Биндим
 *  однажды: setPref пишет в модульный стор, readPrefs() читает свежее. */
export function useSplitDirectionHotkey(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || !isSplitToggleHotkey(e, isMacOS)) return;
      e.preventDefault();
      e.stopPropagation();
      setPref("split", nextSplit(readPrefs().split));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/features/shell/useSplitDirectionHotkey.test.tsx`
Expected: PASS.

- [ ] **Step 5: Подключить в `WorkflowApp`**

В `src/app/WorkflowApp.tsx` добавить импорт рядом с `import { useWordWrapHotkey } from "@/features/shell/wordWrap";` (≈ строка 40):

```ts
import { useSplitDirectionHotkey } from "@/features/shell/splitDirection";
```

И сразу после `useWordWrapHotkey();` (строка 84) добавить:

```ts
  // Глобальный Alt+V / ⌥⌘V → переключает prefs.split (ориентация request/response).
  useSplitDirectionHotkey();
```

- [ ] **Step 6: Verify build + full suite**

Run: `pnpm build`
Expected: tsc + vite OK.

- [ ] **Step 7: Commit**

```bash
git add src/features/shell/splitDirection.ts src/features/shell/useSplitDirectionHotkey.test.tsx src/app/WorkflowApp.tsx
git commit -m "feat(shell): useSplitDirectionHotkey — global Alt+V/⌥⌘V toggles prefs.split" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Централизовать строки титлбара в `messages.shell.titlebar` (чистый рефактор)

Поведение не меняется — значения строк идентичны; существующие тесты `Titlebar.test.tsx` (запрос по accessible-name) остаются зелёными. Бренд «Handshaker» НЕ трогаем (имя продукта, не переводимая копия).

**Files:**
- Modify: `src/lib/messages.ts` (добавить namespace `shell.titlebar`, перед `} as const`)
- Modify: `src/features/shell/Titlebar.tsx` (заменить инлайн-литералы на `messages.shell.titlebar.*`)

- [ ] **Step 1: Добавить namespace в `messages.ts`**

Внутри объекта `messages`, перед закрывающим `} as const;` (строка 75), добавить:

```ts
  shell: {
    titlebar: {
      toggleSidebar: "Toggle sidebar",
      checkForUpdates: "Check for updates",
      checkingForUpdates: "Checking for updates…",
      updateAvailable: "Update available",
      settings: "Settings",
      minimize: "Minimize",
      maximize: "Maximize",
      close: "Close",
      minimizeWindow: "Minimize window",
      maximizeWindow: "Maximize window",
      closeWindow: "Close window",
    },
  },
```

- [ ] **Step 2: Заменить строки в `Titlebar.tsx`**

Импорт (рядом с прочими, ≈ строка 11):

```ts
import { messages } from "@/lib/messages";
```

Замены (точечно):

- Toggle sidebar (строки 66-67):
```tsx
        <Tooltip content={messages.shell.titlebar.toggleSidebar} side="bottom">
          <button type="button" onClick={() => setPref("sidebar", !prefs.sidebar)} className={btn} aria-label={messages.shell.titlebar.toggleSidebar}>
```
- Check for updates tooltip + aria (строки 72-81):
```tsx
          <Tooltip
            content={updateBusy ? messages.shell.titlebar.checkingForUpdates : updateAvailable ? messages.shell.titlebar.updateAvailable : messages.shell.titlebar.checkForUpdates}
            side="bottom"
          >
            <button
              type="button"
              onClick={onCheckForUpdates}
              disabled={updateBusy}
              className={`${btn} relative disabled:opacity-50`}
              aria-label={messages.shell.titlebar.checkForUpdates}
            >
```
- Settings (строки 94-95):
```tsx
        <Tooltip content={messages.shell.titlebar.settings} side="bottom">
          <button type="button" onClick={onOpenSettings} className={btn} aria-label={messages.shell.titlebar.settings}>
```
- Minimize (строки 102-103):
```tsx
            <Tooltip content={messages.shell.titlebar.minimize} side="bottom">
              <button type="button" onClick={() => getCurrentWindow().minimize()} className={btn} aria-label={messages.shell.titlebar.minimizeWindow}>
```
- Maximize (строки 107-108):
```tsx
            <Tooltip content={messages.shell.titlebar.maximize} side="bottom">
              <button type="button" onClick={() => getCurrentWindow().toggleMaximize()} className={btn} aria-label={messages.shell.titlebar.maximizeWindow}>
```
- Close (строки 112-117):
```tsx
            <Tooltip content={messages.shell.titlebar.close} side="bottom">
              <button
                type="button"
                onClick={() => getCurrentWindow().close()}
                className={`h-5 w-6 rounded-sm inline-flex items-center justify-center text-muted-foreground hover:bg-destructive hover:text-destructive-foreground ${compactFocusRing}`}
                aria-label={messages.shell.titlebar.closeWindow}
              >
```

- [ ] **Step 3: Run existing Titlebar tests (поведение не изменилось)**

Run: `pnpm vitest run src/features/shell/Titlebar.test.tsx`
Expected: PASS (значения строк прежние ⇒ accessible-name запросы совпадают).

- [ ] **Step 4: Verify build**

Run: `pnpm build`
Expected: tsc + vite OK.

- [ ] **Step 5: Commit**

```bash
git add src/lib/messages.ts src/features/shell/Titlebar.tsx
git commit -m "refactor(shell): centralize Titlebar strings into messages.shell.titlebar" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Кнопка split-direction в титлбаре

**Files:**
- Modify: `src/lib/messages.ts` (добавить `splitDirection` + `splitDirectionTooltip` в `shell.titlebar`)
- Modify: `src/features/shell/Titlebar.tsx` (импорты, `SPLIT_KEYS`, кнопка между sidebar и updates)
- Test: `src/features/shell/Titlebar.test.tsx` (добавить блок тестов)

- [ ] **Step 1: Write the failing tests** (добавить в `Titlebar.test.tsx`)

Сверху файла, рядом с прочими импортами (после строки 36):

```tsx
import { readPrefs, setPref } from "@/lib/use-prefs";
```

Добавить новый describe-блок (после блока «Titlebar (both platforms)»):

```tsx
describe("Titlebar — split-direction toggle", () => {
  beforeEach(() => {
    mockIsMacOS = false;
    setPref("split", "vertical");
  });

  it("renders the toggle button on both platforms", () => {
    render(<Titlebar onOpenSettings={() => {}} />);
    expect(screen.getByRole("button", { name: "Toggle split direction" })).toBeInTheDocument();
  });

  it("shows the Columns2 icon when split is vertical (Left/Right)", () => {
    const { container } = render(<Titlebar onOpenSettings={() => {}} />);
    expect(container.querySelector(".lucide-columns-2")).not.toBeNull();
    expect(container.querySelector(".lucide-rows-2")).toBeNull();
  });

  it("flips prefs.split and swaps the icon on click", async () => {
    const user = userEvent.setup();
    const { container } = render(<Titlebar onOpenSettings={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Toggle split direction" }));
    expect(readPrefs().split).toBe("horizontal");
    expect(container.querySelector(".lucide-rows-2")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Toggle split direction" }));
    expect(readPrefs().split).toBe("vertical");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/features/shell/Titlebar.test.tsx`
Expected: FAIL — нет кнопки `Toggle split direction`.

- [ ] **Step 3: Добавить копию в `messages.ts`**

В `shell.titlebar` (Task 3) дописать два ключа:

```ts
      splitDirection: "Toggle split direction",
      splitDirectionTooltip: (split: "horizontal" | "vertical"): string =>
        split === "horizontal" ? "Switch to left / right layout" : "Switch to top / bottom layout",
```

- [ ] **Step 4: Добавить кнопку в `Titlebar.tsx`**

Импорты — дополнить существующую lucide-строку (строка 1) на `Columns2`/`Rows2` и добавить `Kbd` + `nextSplit`:

```ts
import { Columns2, Minus, PanelLeft, RefreshCw, Rows2, Settings, Square, X } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { nextSplit } from "@/features/shell/splitDirection";
```

Под определением `btn` (после строки 14) добавить модульную константу чорда (зеркало `WORD_WRAP_KEYS` в `KeyboardPane`):

```ts
// ⌥V на macOS печатает символ → используем ⌥⌘V (см. features/shell/splitDirection.ts).
const SPLIT_KEYS = isMacOS ? ["⌥", "⌘", "V"] : ["Alt", "V"];
```

Вставить кнопку между блоком Toggle sidebar (заканчивается `</Tooltip>` на строке 70) и блоком `{onCheckForUpdates && (` (строка 71):

```tsx
        <Tooltip
          content={
            <span>
              {messages.shell.titlebar.splitDirectionTooltip(prefs.split)}{" "}
              {SPLIT_KEYS.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </span>
          }
          side="bottom"
        >
          <button
            type="button"
            onClick={() => setPref("split", nextSplit(prefs.split))}
            className={btn}
            aria-label={messages.shell.titlebar.splitDirection}
          >
            {prefs.split === "horizontal" ? <Rows2 size={13} /> : <Columns2 size={13} />}
          </button>
        </Tooltip>
```

> `prefs` и `setPref` уже в области видимости (`const [prefs, setPref] = usePrefs();`, строка 39). `isMacOS` импортирован (строка 5).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/features/shell/Titlebar.test.tsx`
Expected: PASS (все, включая прежние).

- [ ] **Step 6: Verify build**

Run: `pnpm build`
Expected: tsc + vite OK.

- [ ] **Step 7: Commit**

```bash
git add src/lib/messages.ts src/features/shell/Titlebar.tsx src/features/shell/Titlebar.test.tsx
git commit -m "feat(shell): split-direction toggle button in titlebar (Columns2/Rows2 + chord tooltip)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Строка «Split direction» в Settings → Keyboard

**Files:**
- Modify: `src/lib/messages.ts` (добавить `shell.keyboard`)
- Modify: `src/features/settings/KeyboardPane.tsx` (метки → `messages`; строка Split direction)
- Test: `src/features/settings/KeyboardPane.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/settings/KeyboardPane.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

let mockIsMacOS = false;
vi.mock("@/lib/platform", () => ({
  get isMacOS() {
    return mockIsMacOS;
  },
}));

import { KeyboardPane } from "./KeyboardPane";

describe("KeyboardPane", () => {
  it("lists the Split direction shortcut with Alt+V on Windows/Linux", () => {
    mockIsMacOS = false;
    render(<KeyboardPane />);
    expect(screen.getByText("Split direction")).toBeInTheDocument();
    // chord glyphs render as <Kbd> with text "Alt" and "V"
    expect(screen.getAllByText("V").length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/features/settings/KeyboardPane.test.tsx`
Expected: FAIL — нет текста `Split direction`.

- [ ] **Step 3: Добавить `shell.keyboard` в `messages.ts`**

В namespace `shell` (рядом с `titlebar`) добавить:

```ts
    keyboard: {
      sendRequest: "Send request",
      toggleSidebar: "Toggle sidebar",
      wordWrap: "Word wrap",
      splitDirection: "Split direction",
    },
```

- [ ] **Step 4: Обновить `KeyboardPane.tsx`**

Заменить весь файл на:

```tsx
import { Kbd } from "@/components/ui/kbd";
import { SettingsGroup, SettingsRow } from "./SettingsDialog";
import { isMacOS } from "@/lib/platform";
import { messages } from "@/lib/messages";

// Аккорды, зависящие от ОС: голый ⌥<буква> на macOS печатает символ, поэтому
// Mac-чорд — ⌥⌘<буква> (см. features/shell/wordWrap.ts и splitDirection.ts).
const WORD_WRAP_KEYS = isMacOS ? ["⌥", "⌘", "Z"] : ["Alt", "Z"];
const SPLIT_KEYS = isMacOS ? ["⌥", "⌘", "V"] : ["Alt", "V"];

// Each action lists one or more equivalent chords (rendered "·"-separated).
const ROWS: Array<[string, string[][]]> = [
  [messages.shell.keyboard.sendRequest, [["Ctrl", "Enter"], ["Ctrl", "R"]]],
  [messages.shell.keyboard.toggleSidebar, [["Ctrl", "B"]]],
  [messages.shell.keyboard.wordWrap, [WORD_WRAP_KEYS]],
  [messages.shell.keyboard.splitDirection, [SPLIT_KEYS]],
];

export function KeyboardPane() {
  return (
    <SettingsGroup title="Shortcuts">
      {ROWS.map(([n, combos]) => (
        <SettingsRow
          key={n}
          title={n}
          control={
            <span className="flex items-center gap-1">
              {combos.map((keys, ci) => (
                <span key={ci} className="flex items-center gap-1">
                  {ci > 0 && <span className="px-0.5 text-muted-foreground">·</span>}
                  {keys.map((k, i) => (
                    <Kbd key={i}>{k}</Kbd>
                  ))}
                </span>
              ))}
            </span>
          }
        />
      ))}
    </SettingsGroup>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/features/settings/KeyboardPane.test.tsx`
Expected: PASS.

- [ ] **Step 6: Verify build + full suite**

Run: `pnpm build` затем `pnpm test`
Expected: tsc + vite OK; полный vitest зелёный.

- [ ] **Step 7: Commit**

```bash
git add src/lib/messages.ts src/features/settings/KeyboardPane.tsx src/features/settings/KeyboardPane.test.tsx
git commit -m "feat(settings): list Split direction shortcut (Alt+V/⌥⌘V); centralize Keyboard labels" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Финальная проверка (после всех задач)

- [ ] `pnpm test` — полный vitest зелёный (включая новые: `splitDirection`, `useSplitDirectionHotkey`, `Titlebar` split-блок, `KeyboardPane`).
- [ ] `pnpm build` — tsc + vite без ошибок.
- [ ] bindings без дрейфа — IPC не менялся (бэкенд не трогали), `src/ipc/bindings.ts` не требует регена.
- [ ] **Live-проход в WebView2** (`pnpm tauri:dev`):
  - кнопка в титлбаре между sidebar и updates; иконка `Columns2`/`Rows2` по состоянию; тултип показывает действие + чорд;
  - клик переключает Left/Right ↔ Top/Bottom; `CallPanel` перекладывается;
  - `Alt+V` (и `⌥⌘V` на mac) переключает; русская раскладка — работает (физ. `KeyV`); `AltGr+V` не срабатывает; WebView не перезагружается;
  - тумблер Settings → Appearance синхронен с кнопкой; строка в Settings → Keyboard видна; состояние переживает рестарт.

## Notes / Out of scope

- Бэкенд / IPC / bindings — `prefs.split` уже персистится в localStorage.
- `AppearancePane` ToggleGroup не трогаем (остаётся источником-контролом).
- Широкая миграция строк в `messages.ts` — только два редактируемых файла (`Titlebar`, `KeyboardPane`); бренд «Handshaker» оставлен инлайн.
- Запоминание разных `bodyPanel` под каждую ориентацию — вне scope (общий, как сейчас).
- Гард Monaco: если при live-проходе `Alt+V`/`⌥⌘V` внезапно дёргает встроенное действие Monaco — отвязать в `monaco.ts` через `addKeybindingRule({ command: null })` (ожидание — нечего отвязывать).
```
