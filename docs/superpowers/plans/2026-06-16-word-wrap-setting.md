# Word Wrap — настройка + хоткей Alt+Z — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать управляемый перенос строк (word wrap) в редакторах тела запроса и ответа — pref `wordWrap` (off по умолчанию), тумблер в Настройках и глобальный хоткей Alt+Z.

**Architecture:** Один глобальный localStorage-pref `wordWrap`. `BodyView` переопределяет Monaco-опцию `wordWrap` из pref (общий для запроса и ответа). Хоткей Alt+Z — чистый предикат + хук-обёртка (capture-фаза + `stopPropagation`, чтобы подавить встроенный Alt+Z Monaco). Поверхности — `Switch` в AppearancePane и строка в KeyboardPane. Бэкенд/IPC/bindings не трогаются.

**Tech Stack:** React 18 + TypeScript, Monaco (`@monaco-editor/react`), shadcn UI, Vitest + Testing Library.

**Спека:** `docs/superpowers/specs/2026-06-16-word-wrap-setting-design.md`

**Ветка:** `claude/sharp-antonelli-2e0d2d` (worktree уже создан).

---

## Соглашения

- **Гейт:** `pnpm test` (vitest), `pnpm lint` (tsc -b), `pnpm build` (tsc -b + vite build).
  Пер-таск прогон одного файла: `pnpm test <path>`.
- Если node_modules пуст (свежий worktree) — сначала `pnpm install`.
- Каждый коммит заканчивается трейлером (второй `-m`):
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Один таск = один коммит. TDD: красный → зелёный → коммит.

## Карта файлов

| Файл | Ответственность |
| --- | --- |
| `src/lib/use-prefs.ts` | объявить pref `wordWrap` (+ дефолт `false`) |
| `src/lib/use-prefs.test.ts` | дефолт/мердж `wordWrap` |
| `src/features/shell/wordWrap.ts` | **новый** — `isWordWrapHotkey` (чистый) + `useWordWrapHotkey` (хук) |
| `src/features/shell/wordWrap.test.ts` | **новый** — таблица предиката |
| `src/features/shell/useWordWrapHotkey.test.tsx` | **новый** — тоггл-тест хука |
| `src/app/WorkflowApp.tsx` | вызвать `useWordWrapHotkey()` |
| `src/features/bodyview/BodyView.tsx` | переопределить `wordWrap` из pref + эффект `updateOptions` |
| `src/features/bodyview/BodyView.test.tsx` | ассерт прокидывания `options.wordWrap` |
| `src/features/settings/AppearancePane.tsx` | группа Editor + `Switch` Word wrap |
| `src/features/settings/AppearancePane.test.tsx` | тоггл-тест свитча |
| `src/features/settings/KeyboardPane.tsx` | строка `Word wrap → Alt Z` |
| `src/features/settings/KeyboardPane.test.tsx` | **новый** — наличие строки |

---

## Task 1: Pref `wordWrap`

**Files:**
- Modify: `src/lib/use-prefs.ts` (interface `Prefs` + `PREFS_DEFAULTS`)
- Test: `src/lib/use-prefs.test.ts`

- [ ] **Step 1: Write the failing test** — добавить в конец `src/lib/use-prefs.test.ts`:

```ts
describe("wordWrap pref", () => {
  beforeEach(() => localStorage.clear());

  it("defaults wordWrap to false", () => {
    expect(PREFS_DEFAULTS.wordWrap).toBe(false);
  });

  it("merges a persisted wordWrap:true over defaults", () => {
    localStorage.setItem("handshaker.prefs.v1", JSON.stringify({ wordWrap: true }));
    const merged = { ...PREFS_DEFAULTS, wordWrap: true };
    expect(merged.wordWrap).toBe(true);
    expect(typeof readPrefs().wordWrap).toBe("boolean");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/use-prefs.test.ts`
Expected: FAIL — `PREFS_DEFAULTS.wordWrap` is `undefined` (`expected undefined to be false`) и тип `readPrefs().wordWrap` не `boolean`.

- [ ] **Step 3: Write minimal implementation** — в `src/lib/use-prefs.ts`.

В интерфейс `Prefs` (после `bodyHints: boolean;`) добавить:

```ts
  /** Перенос длинных строк в редакторах тела запроса/ответа. Off → гориз. скролл. */
  wordWrap: boolean;
```

В `PREFS_DEFAULTS` (после `bodyHints: true,`) добавить:

```ts
  wordWrap: false,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/use-prefs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/use-prefs.ts src/lib/use-prefs.test.ts
git commit -m "feat(prefs): wordWrap pref (default off)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `isWordWrapHotkey` (чистый предикат)

**Files:**
- Create: `src/features/shell/wordWrap.ts`
- Test: `src/features/shell/wordWrap.test.ts`

- [ ] **Step 1: Write the failing test** — создать `src/features/shell/wordWrap.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isWordWrapHotkey } from "./wordWrap";

// Alt+Z по физической клавише Z (раскладко-независимо).
const base = { code: "KeyZ", ctrlKey: false, metaKey: false, altKey: true, shiftKey: false };

describe("isWordWrapHotkey", () => {
  it("Alt+Z (physical KeyZ) → true", () => {
    expect(isWordWrapHotkey(base)).toBe(true);
  });
  it("ignores AltGr (Ctrl+Alt) → false", () => {
    expect(isWordWrapHotkey({ ...base, ctrlKey: true })).toBe(false);
  });
  it("ignores Meta+Alt → false", () => {
    expect(isWordWrapHotkey({ ...base, metaKey: true })).toBe(false);
  });
  it("ignores Shift → false", () => {
    expect(isWordWrapHotkey({ ...base, shiftKey: true })).toBe(false);
  });
  it("requires Alt → false without it", () => {
    expect(isWordWrapHotkey({ ...base, altKey: false })).toBe(false);
  });
  it("only the physical Z key → false for KeyY", () => {
    expect(isWordWrapHotkey({ ...base, code: "KeyY" })).toBe(false);
  });
  it("layout-independent: matches by code, not key (ЙЦУКЕН 'я')", () => {
    // we never read e.key, so the Cyrillic char the Z key would produce is irrelevant
    expect(isWordWrapHotkey({ ...base, code: "KeyZ" })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/shell/wordWrap.test.ts`
Expected: FAIL — `Failed to resolve import "./wordWrap"` (модуль не существует).

- [ ] **Step 3: Write minimal implementation** — создать `src/features/shell/wordWrap.ts`:

```ts
/** Предикат хоткея word-wrap: Alt+Z по физической клавише Z (раскладко-независимо),
 *  без Ctrl (AltGr-гард на Windows = Ctrl+Alt), Meta и Shift. */
export function isWordWrapHotkey(
  e: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
): boolean {
  if (!e.altKey) return false;
  if (e.ctrlKey || e.metaKey || e.shiftKey) return false;
  return e.code === "KeyZ";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/shell/wordWrap.test.ts`
Expected: PASS (7 тестов).

- [ ] **Step 5: Commit**

```bash
git add src/features/shell/wordWrap.ts src/features/shell/wordWrap.test.ts
git commit -m "feat(shell): isWordWrapHotkey predicate (Alt+Z, layout-independent)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `useWordWrapHotkey` (хук)

**Files:**
- Modify: `src/features/shell/wordWrap.ts` (добавить хук)
- Test: `src/features/shell/useWordWrapHotkey.test.tsx`

- [ ] **Step 1: Write the failing test** — создать `src/features/shell/useWordWrapHotkey.test.tsx` (зеркало `useUiZoom.test.tsx`):

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { act } from "react";
import { useWordWrapHotkey } from "./wordWrap";
import { readPrefs } from "@/lib/use-prefs";

function Probe() {
  useWordWrapHotkey();
  return null;
}

const press = (init: KeyboardEventInit) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { cancelable: true, ...init }));
  });

beforeEach(() => {
  localStorage.clear();
});

describe("useWordWrapHotkey", () => {
  it("Alt+Z toggles the wordWrap pref both ways", () => {
    render(<Probe />);
    const start = readPrefs().wordWrap;
    press({ code: "KeyZ", altKey: true });
    expect(readPrefs().wordWrap).toBe(!start);
    press({ code: "KeyZ", altKey: true });
    expect(readPrefs().wordWrap).toBe(start);
  });

  it("ignores AltGr (Ctrl+Alt)+Z", () => {
    render(<Probe />);
    const start = readPrefs().wordWrap;
    press({ code: "KeyZ", altKey: true, ctrlKey: true });
    expect(readPrefs().wordWrap).toBe(start);
  });

  it("preventDefault on a real Alt+Z (suppresses Monaco's built-in)", () => {
    render(<Probe />);
    const e = new KeyboardEvent("keydown", { code: "KeyZ", altKey: true, cancelable: true });
    act(() => {
      window.dispatchEvent(e);
    });
    expect(e.defaultPrevented).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/shell/useWordWrapHotkey.test.tsx`
Expected: FAIL — `useWordWrapHotkey` не экспортирован (`does not provide an export named 'useWordWrapHotkey'`).

- [ ] **Step 3: Write minimal implementation** — в `src/features/shell/wordWrap.ts` добавить импорты сверху и хук снизу:

```ts
import { useEffect } from "react";
import { readPrefs, usePrefs } from "@/lib/use-prefs";
```

```ts
/** Глобальный Alt+Z → переключает pref `wordWrap`. Capture-фаза + stopPropagation
 *  подавляют встроенный Alt+Z Monaco (`editor.action.toggleWordWrap`), иначе он
 *  дёргал бы внутренний флаг редактора в рассинхрон с pref. Биндим однажды:
 *  setPref пишет в модульный стор, readPrefs() читает свежее значение. */
export function useWordWrapHotkey(): void {
  const [, setPref] = usePrefs();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || !isWordWrapHotkey(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setPref("wordWrap", !readPrefs().wordWrap);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/shell/useWordWrapHotkey.test.tsx`
Expected: PASS (3 теста).

- [ ] **Step 5: Commit**

```bash
git add src/features/shell/wordWrap.ts src/features/shell/useWordWrapHotkey.test.tsx
git commit -m "feat(shell): useWordWrapHotkey — global Alt+Z toggles wordWrap pref" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Привязать хук в `WorkflowApp`

**Files:**
- Modify: `src/app/WorkflowApp.tsx` (импорт + вызов рядом с `useUiZoom()`)

Дедик-теста нет (хук покрыт в Task 3; рендер `WorkflowApp` тяжёл). Верификация — `pnpm lint` + полный `pnpm test` остаются зелёными.

- [ ] **Step 1: Add the import** — рядом с `import { useUiZoom } from "@/features/shell/zoom";` (≈ строка 36) добавить:

```ts
import { useWordWrapHotkey } from "@/features/shell/wordWrap";
```

- [ ] **Step 2: Call the hook** — сразу после `useUiZoom();` (≈ строка 76):

```ts
  useUiZoom();
  // Глобальный Alt+Z → переключает prefs.wordWrap (перенос строк в редакторах тела).
  useWordWrapHotkey();
```

- [ ] **Step 3: Verify typecheck + full suite**

Run: `pnpm lint` then `pnpm test`
Expected: both PASS (никаких регрессий).

- [ ] **Step 4: Commit**

```bash
git add src/app/WorkflowApp.tsx
git commit -m "feat(shell): wire Alt+Z word-wrap hotkey in WorkflowApp" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `BodyView` — `wordWrap` из pref

**Files:**
- Modify: `src/features/bodyview/BodyView.tsx`
- Test: `src/features/bodyview/BodyView.test.tsx`

- [ ] **Step 1: Write the failing test** — обновить `src/features/bodyview/BodyView.test.tsx`.

Расширить мок `@/lib/monaco`, чтобы стаб отдавал `data-wordwrap`, и мок prefs — добавить `wordWrap`:

```tsx
vi.mock("@/lib/monaco", () => ({
  MonacoEditor: ({ value, options }: {
    value: string;
    options?: { readOnly?: boolean; wordWrap?: string };
  }) => (
    <pre
      data-testid="monaco"
      data-readonly={String(!!options?.readOnly)}
      data-wordwrap={String(options?.wordWrap)}
    >{value}</pre>
  ),
  BODY_EDIT_OPTIONS: { readOnly: false },
  BODY_READONLY_OPTIONS: { readOnly: true },
  MONACO_THEME: "handshaker-dark",
}));
const prefs = { bodyHints: false, wordWrap: false };
vi.mock("@/lib/use-prefs", () => ({
  usePrefs: () => [prefs],
  readPrefs: () => prefs,
}));
```

Добавить два теста в `describe("BodyView", …)`:

```tsx
  it("passes wordWrap 'off' when the pref is off (default)", () => {
    prefs.wordWrap = false;
    render(<BodyView mode="request" value={`{"a":1}`} onChange={vi.fn()} />);
    expect(screen.getByTestId("monaco").getAttribute("data-wordwrap")).toBe("off");
  });

  it("passes wordWrap 'on' when the pref is on", () => {
    prefs.wordWrap = true;
    render(<BodyView mode="response" value={`{"a":1}`} />);
    expect(screen.getByTestId("monaco").getAttribute("data-wordwrap")).toBe("on");
    prefs.wordWrap = false; // restore — shared module-level mock object
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/bodyview/BodyView.test.tsx`
Expected: FAIL — `data-wordwrap` равно `"undefined"` (BodyView ещё не задаёт `options.wordWrap`).

- [ ] **Step 3: Write minimal implementation** — в `src/features/bodyview/BodyView.tsx`.

(a) Заменить строку `const options = mode === "response" ? BODY_READONLY_OPTIONS : BODY_EDIT_OPTIONS;` (≈ 328) на:

```ts
  // wordWrap — источник истины prefs.wordWrap (общий для запроса и ответа), поэтому
  // переопределяем базовую опцию здесь; base-консты в monaco.ts остаются как есть.
  // Default off → длинное значение не уходит «башней» под ключ (см. spec 2026-06-16).
  const base = mode === "response" ? BODY_READONLY_OPTIONS : BODY_EDIT_OPTIONS;
  const options = useMemo(
    () => ({ ...base, wordWrap: prefs.wordWrap ? "on" : "off" }),
    [base, prefs.wordWrap],
  );
```

(b) Добавить эффект живого переключения. Вставить сразу после существующего
`useEffect(() => { applyGhost(); }, [prefs.bodyHints, applyGhost]);` (≈ строка 272):

```ts
  // Живое переключение переноса: controlled `options` покрывает маунт; этот эффект
  // гарантирует in-place обновление при смене pref независимо от поведения обёртки.
  // No-op до маунта редактора (live.current === null).
  useEffect(() => {
    live.current?.editor.updateOptions({ wordWrap: prefs.wordWrap ? "on" : "off" });
  }, [prefs.wordWrap]);
```

(c) **Починить два мока, чьи фейк-редакторы вызывают `onMount`** — теперь BodyView
зовёт `editor.updateOptions`, которого в этих моках нет (иначе `updateOptions is
not a function`). В мок-объект `editor` добавить заглушку `updateOptions: () => {},`:

- `src/features/bodyview/BodyView.submit.test.tsx` — в объекте `editor` (≈ строки 20–34),
  например после `getModel: () => null,`:

```ts
      updateOptions: () => {},
```

- `src/features/bodyview/BodyView.ghost.test.tsx` — в объекте `editor` (≈ строки 23–44),
  например после `addCommand: () => {},`:

```ts
        updateOptions: () => {},
```

(Их `usePrefs`-моки без `wordWrap` править не нужно: `prefs.wordWrap === undefined`
→ `"off"`, не падает; меняем только мок-редактор.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/features/bodyview/`
Expected: PASS — `BodyView.test` (request→"off", response→"on", + прежние смоук),
`BodyView.submit.test` и `BodyView.ghost.test` зелёные (заглушка `updateOptions`).

- [ ] **Step 5: Commit**

```bash
git add src/features/bodyview/BodyView.tsx src/features/bodyview/BodyView.test.tsx src/features/bodyview/BodyView.submit.test.tsx src/features/bodyview/BodyView.ghost.test.tsx
git commit -m "feat(bodyview): drive Monaco wordWrap from prefs.wordWrap" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: AppearancePane — `Switch` Word wrap

**Files:**
- Modify: `src/features/settings/AppearancePane.tsx`
- Test: `src/features/settings/AppearancePane.test.tsx`

- [ ] **Step 1: Write the failing test** — добавить в `describe("AppearancePane", …)` в `AppearancePane.test.tsx`:

```tsx
  it("word wrap switch toggles the pref", () => {
    render(<AppearancePane />);
    const start = readPrefs().wordWrap;
    const row = screen.getByText("Word wrap").closest("div.flex") as HTMLElement;
    fireEvent.click(within(row).getByRole("switch"));
    expect(readPrefs().wordWrap).toBe(!start);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/settings/AppearancePane.test.tsx`
Expected: FAIL — `Unable to find an element with the text: Word wrap`.

- [ ] **Step 3: Write minimal implementation** — в `src/features/settings/AppearancePane.tsx` добавить новую группу **сразу после** закрывающего `</SettingsGroup>` группы «Layout» (перед `<SettingsGroup title="Method picker">`):

```tsx
      <SettingsGroup title="Editor">
        <SettingsRow
          title="Word wrap"
          hint="Wrap long lines in the request and response editors. Alt+Z toggles."
          control={
            <Switch checked={prefs.wordWrap} onCheckedChange={(v) => setPref("wordWrap", v)} />
          }
        />
      </SettingsGroup>
```

(`Switch` уже импортирован — используется в ряду «Sidebar».)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/settings/AppearancePane.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/AppearancePane.tsx src/features/settings/AppearancePane.test.tsx
git commit -m "feat(settings): Word wrap toggle in Appearance" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: KeyboardPane — строка Alt+Z

**Files:**
- Modify: `src/features/settings/KeyboardPane.tsx`
- Test: `src/features/settings/KeyboardPane.test.tsx` (**новый**)

- [ ] **Step 1: Write the failing test** — создать `src/features/settings/KeyboardPane.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { KeyboardPane } from "./KeyboardPane";

describe("KeyboardPane", () => {
  it("lists the Word wrap → Alt+Z shortcut", () => {
    render(<KeyboardPane />);
    expect(screen.getByText("Word wrap")).toBeInTheDocument();
    expect(screen.getByText("Alt")).toBeInTheDocument();
    expect(screen.getByText("Z")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/settings/KeyboardPane.test.tsx`
Expected: FAIL — `Unable to find an element with the text: Word wrap`.

- [ ] **Step 3: Write minimal implementation** — в `src/features/settings/KeyboardPane.tsx` добавить строку в массив `ROWS`:

```ts
const ROWS: Array<[string, string[]]> = [
  ["Send request", ["Ctrl", "Enter"]],
  ["Toggle sidebar", ["Ctrl", "B"]],
  ["Word wrap", ["Alt", "Z"]],
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/settings/KeyboardPane.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/KeyboardPane.tsx src/features/settings/KeyboardPane.test.tsx
git commit -m "feat(settings): document Alt+Z word-wrap shortcut" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Полный гейт + статус + Active work

**Files:**
- Modify: `docs/superpowers/specs/2026-06-16-word-wrap-setting-design.md` (статус-баннер)
- Modify: `CLAUDE.md` (строка «Active work»)

- [ ] **Step 1: Full gate**

Run: `pnpm test`
Expected: PASS — все тесты (прежние + новые ~13).

Run: `pnpm build`
Expected: PASS — `tsc -b` без ошибок типов, затем `vite build` собирает `dist/`.

- [ ] **Step 2: Обновить статус-баннер спеки** — в `docs/superpowers/specs/2026-06-16-word-wrap-setting-design.md` заменить строку статуса на:

```markdown
**Статус:** ✅ CODE-COMPLETE (2026-06-16; гейт зелёный: vitest · tsc · build). Остаток — live-проход в WebView2 (см. раздел «Live-проход»).
```

- [ ] **Step 3: Обновить «Active work» в `CLAUDE.md`** — заменить первое предложение
  раздела «## Active work» (`Нет активной фичи в работе.`) на:

```markdown
В работе — **Word Wrap — настройка + хоткей Alt+Z** (✅ CODE-COMPLETE 2026-06-16,
ветка `claude/sharp-antonelli-2e0d2d`; план `docs/superpowers/plans/2026-06-16-word-wrap-setting.md`,
спека `docs/superpowers/specs/2026-06-16-word-wrap-setting-design.md`); ждёт live-проход
в WebView2, затем ff в `main` и архивацию.
```

  Остальной текст абзаца («Последняя влитая — …») оставить без изменений.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-06-16-word-wrap-setting-design.md CLAUDE.md
git commit -m "docs: word-wrap feature code-complete; live-pass pending" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## После плана (вне TDD-тасков)

- **Live-проход** (раздел в спеке): длинное base64-значение при off — уезжает вправо
  (скролл), ключ+значение вместе; Alt+Z включает/выключает перенос; тумблер в
  Settings → Appearance синхронен с хоткеем; русская раскладка — Alt+Z работает;
  AltGr+Z (Windows) перенос не трогает; состояние переживает рестарт.
- **Финализация** (после успешного live-прохода): пометить план/спеку как DONE,
  `git mv` в `archive/` (план → `plans/archive/`, спека → `specs/archive/`) одним
  коммитом `docs(archive): word-wrap plan+spec`, обновить «Active work» и индекс
  памяти. Влить ветку в `main` fast-forward по обычной процедуре.

## Риски / заметки для исполнителя

- **Полный прогон vitest, не точечный.** BodyView читает новый `prefs.wordWrap`;
  если какой-то тест-файл мокает `@/lib/use-prefs` без этого ключа — `prefs.wordWrap`
  будет `undefined` → `"off"` (безопасно, не падает). Но финальный гейт — `pnpm test`
  целиком (урок из памяти про частичные vi.mock).
- **monaco.ts НЕ трогаем.** `BODY_*` сохраняют `wordWrap: "on"` из `EDITOR_OPTIONS`;
  spread в `BodyView` переопределяет. `READ_ONLY_OPTIONS` нигде не используется
  (проверено grep) — менять общий конст незачем.
- **Не полагаемся на `@monaco-editor/react`** в части реакции на смену `options`:
  явный `editor.updateOptions` в эффекте — независимая гарантия живого переключения.
- **AltGr-гард:** `altKey && !ctrlKey` — на Windows AltGr = Ctrl+Alt; без отсева
  `ctrlKey` хоткей ложно срабатывал бы на евро-раскладках (тот же урок, что в `cycle.ts`).
