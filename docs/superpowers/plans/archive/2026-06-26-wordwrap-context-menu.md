# Word-wrap toggle в контекстном меню редактора — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить пункт «Enable/Disable word wrap» в контекстное меню (ПКМ) обоих редакторов тела, переключающий общий pref `prefs.wordWrap`; подпись отражает текущее состояние.

**Architecture:** Чистый хелпер `wordWrapAction.ts` (зеркало `foldActions.ts`) регистрирует одно Monaco-действие без keybinding в группе `2_view`. `BodyView` навешивает его в `onMount` (оба режима) и пере-вешает в `useEffect` на смену `prefs.wordWrap` (Monaco фиксирует label при регистрации ⇒ динамика = dispose+re-add). Текст — в `messages.ts`. Тоггл пишет в pref через новый модульный `setPref` (симметрия с `readPrefs`).

**Tech Stack:** React 18 · TypeScript · `@monaco-editor/react` · vitest · Monaco `editor.addAction`.

**Спека:** `docs/superpowers/specs/2026-06-26-wordwrap-context-menu-design.md`

**Гейт (фронт-only):** `pnpm test` (vitest) · `pnpm build` (tsc -b + vite build). Rust/IPC/bindings не трогаются.

---

### Task 1: Модульный `setPref` в use-prefs.ts

Экспортировать стабильный модульный сеттер (симметрия с `readPrefs()`), чтобы тоггл-замыкание и эффект пере-навешивания в `BodyView` не зависели от пер-рендерной идентичности `usePrefs().setKey`. `usePrefs` делегирует в него.

**Files:**
- Modify: `src/lib/use-prefs.ts` (функция `setKey` внутри `usePrefs`, ~строки 100-102)
- Test: `src/lib/use-prefs.test.ts`

- [ ] **Step 1: Написать падающий тест**

Дописать `setPref` в существующий импорт из `./use-prefs` (строка 2) — станет
`import { PREFS_DEFAULTS, clampTimeoutMs, readPrefs, setPref } from "./use-prefs";` —
и добавить в конец `src/lib/use-prefs.test.ts`:

```ts
describe("setPref (module-level setter)", () => {
  beforeEach(() => localStorage.clear());

  it("writes a pref that readPrefs() reflects", () => {
    const before = readPrefs().wordWrap;
    setPref("wordWrap", !before);
    expect(readPrefs().wordWrap).toBe(!before);
    setPref("wordWrap", before); // restore shared module-level state
  });
});
```

(`readPrefs` уже импортирован в этом файле; `setPref` — нет, добавляем импорт строкой выше.)

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm test -- src/lib/use-prefs.test.ts`
Expected: FAIL — `setPref` не экспортируется (`"setPref" is not exported by "src/lib/use-prefs.ts"`).

- [ ] **Step 3: Реализовать**

В `src/lib/use-prefs.ts` добавить модульный `setPref` (рядом с `readPrefs`, в конце файла) и делегировать `setKey` в него:

```ts
export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  broadcast({ ...current, [key]: value });
}
```

И заменить тело `setKey` внутри `usePrefs`:

```ts
  function setKey<K extends keyof Prefs>(key: K, value: Prefs[K]) {
    setPref(key, value);
  }
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `pnpm test -- src/lib/use-prefs.test.ts`
Expected: PASS (все блоки use-prefs зелёные).

- [ ] **Step 5: Commit**

```bash
git add src/lib/use-prefs.ts src/lib/use-prefs.test.ts
git commit -m "refactor(prefs): export module-level setPref (symmetry with readPrefs)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Копия + чистый хелпер `wordWrapAction.ts`

Подпись пункта меню — в `messages.ts` (выбранное направление проекта). Хелпер — зеркало `foldActions.ts`: структурный интерфейс редактора (юнит-тесты без `monaco-editor`) + регистратор действия. Отдельной `wordWrapLabel` нет — выбор строки по состоянию и есть копия, она в `messages.ts`.

**Files:**
- Modify: `src/lib/messages.ts` (добавить секцию `bodyview`)
- Create: `src/features/bodyview/wordWrapAction.ts`
- Test: `src/features/bodyview/wordWrapAction.test.ts`

- [ ] **Step 1: Написать падающий тест**

Создать `src/features/bodyview/wordWrapAction.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { attachWordWrapAction, type WordWrapMenuEditor } from "./wordWrapAction";

/** A mock menu editor recording registered descriptors + their disposers. */
function mockMenuEditor() {
  const descriptors: {
    id: string;
    label: string;
    contextMenuGroupId?: string;
    contextMenuOrder?: number;
    run(): void;
  }[] = [];
  const disposers: ReturnType<typeof vi.fn>[] = [];
  const addAction = vi.fn((d: (typeof descriptors)[number]) => {
    descriptors.push(d);
    const dispose = vi.fn();
    disposers.push(dispose);
    return { dispose };
  });
  return { editor: { addAction } as unknown as WordWrapMenuEditor, descriptors, disposers };
}

describe("attachWordWrapAction", () => {
  it("labels the action 'Enable word wrap' when wrap is OFF", () => {
    const m = mockMenuEditor();
    attachWordWrapAction(m.editor, false, vi.fn());
    expect(m.descriptors[0].label).toBe("Enable word wrap");
  });

  it("labels the action 'Disable word wrap' when wrap is ON", () => {
    const m = mockMenuEditor();
    attachWordWrapAction(m.editor, true, vi.fn());
    expect(m.descriptors[0].label).toBe("Disable word wrap");
  });

  it("registers one action with a stable id in its own ordered group, no keybinding", () => {
    const m = mockMenuEditor();
    attachWordWrapAction(m.editor, false, vi.fn());
    expect(m.descriptors).toHaveLength(1);
    const d = m.descriptors[0];
    expect(d.id).toBe("hs.toggleWordWrap");
    expect(d.contextMenuGroupId).toBe("2_view");
    expect(d.contextMenuOrder).toBe(1);
    expect(d).not.toHaveProperty("keybindings");
  });

  it("run() invokes the supplied toggle", () => {
    const m = mockMenuEditor();
    const onToggle = vi.fn();
    attachWordWrapAction(m.editor, false, onToggle);
    m.descriptors[0].run();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("dispose() removes the action", () => {
    const m = mockMenuEditor();
    attachWordWrapAction(m.editor, false, vi.fn()).dispose();
    expect(m.disposers[0]).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm test -- src/features/bodyview/wordWrapAction.test.ts`
Expected: FAIL — `./wordWrapAction` не существует (cannot resolve import).

- [ ] **Step 3: Добавить копию в messages.ts**

В `src/lib/messages.ts`, внутри объекта `messages`, добавить новую секцию (например, после `contract` и перед `vars`):

```ts
  bodyview: {
    menu: {
      /** Context-menu toggle label — reads as the action a click performs. */
      wordWrap: (wrapped: boolean): string =>
        wrapped ? "Disable word wrap" : "Enable word wrap",
    },
  },
```

- [ ] **Step 4: Создать хелпер**

Создать `src/features/bodyview/wordWrapAction.ts`:

```ts
import { messages } from "@/lib/messages";
import type { DisposableLike } from "./editorLike";

interface WordWrapActionDescriptor {
  id: string;
  label: string;
  contextMenuGroupId?: string;
  contextMenuOrder?: number;
  run(): void;
}

/** The slice of the Monaco editor we need to register the word-wrap action.
 *  The real `IStandaloneCodeEditor` satisfies this structurally. */
export interface WordWrapMenuEditor {
  addAction(descriptor: WordWrapActionDescriptor): DisposableLike;
}

// Own group, sorted after "1_folding" and before "9_cutcopypaste*": in the
// response menu the item sits below Collapse/Expand-all and above copy/save;
// in the request menu it forms its own slice.
const GROUP_VIEW = "2_view";

/**
 * Register the word-wrap toggle in the editor's right-click menu. The label
 * reflects the CURRENT wrap state (from messages.ts), reading as the action a
 * click performs. Monaco fixes an action's label at registration time, so the
 * caller re-attaches (dispose + re-add) when the pref changes — cheap, toggling
 * is rare. Carries NO keybinding (Alt+Z / ⌥⌘Z stays owned by the window-level
 * listener; Monaco's built-in is unbound in monaco.ts), so the global last-wins
 * keybinding registry is untouched — same reasoning as foldActions/decodeActions.
 * Returns a disposable that removes the action.
 */
export function attachWordWrapAction(
  editor: WordWrapMenuEditor,
  wrapped: boolean,
  onToggle: () => void,
): DisposableLike {
  return editor.addAction({
    id: "hs.toggleWordWrap",
    label: messages.bodyview.menu.wordWrap(wrapped),
    contextMenuGroupId: GROUP_VIEW,
    contextMenuOrder: 1,
    run: onToggle,
  });
}
```

- [ ] **Step 5: Запустить — убедиться, что проходит**

Run: `pnpm test -- src/features/bodyview/wordWrapAction.test.ts`
Expected: PASS (5 тестов зелёные).

- [ ] **Step 6: Commit**

```bash
git add src/lib/messages.ts src/features/bodyview/wordWrapAction.ts src/features/bodyview/wordWrapAction.test.ts
git commit -m "feat(bodyview): word-wrap context-menu action helper + copy" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Проводка в BodyView + интеграционный тест

Навесить действие в `onMount` (оба режима), пере-вешать в эффекте на смену `prefs.wordWrap`, диспозить в обоих teardown-сайтах. Добавить `addAction` в мок `BodyView.ghost.test.tsx` (request-режим теперь регистрирует action). Новый интеграционный тест `BodyView.wordwrap.test.tsx`.

**Files:**
- Modify: `src/features/bodyview/BodyView.tsx`
- Modify: `src/features/bodyview/BodyView.ghost.test.tsx` (мок: добавить `addAction`)
- Test: `src/features/bodyview/BodyView.wordwrap.test.tsx` (новый)

- [ ] **Step 1: Написать падающий интеграционный тест**

Создать `src/features/bodyview/BodyView.wordwrap.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

// Capture every editor.addAction(...) descriptor so we can find the word-wrap toggle.
// `mounted` guards onMount to a SINGLE call (like the ghost test): otherwise the mock
// re-runs onMount on every render and the re-register-on-pref-flip test would pass via
// onMount re-running rather than the effect under test.
const captured = vi.hoisted(() => ({
  actions: [] as Array<{ id: string; label: string; contextMenuGroupId?: string; run: () => void }>,
  mounted: false,
}));
// Shared prefs the mock's setPref mutates — proves BodyView's toggle is wired to it.
const state = vi.hoisted(() => ({
  prefs: { bodyHints: false, wordWrap: false } as { bodyHints: boolean; wordWrap: boolean },
}));

vi.mock("@/lib/monaco", () => ({
  MonacoEditor: ({ onMount }: { onMount?: (editor: unknown, monaco: unknown) => void }) => {
    if (!captured.mounted) {
      captured.mounted = true;
      const editor = {
        getValue: () => "{}",
        getModel: () => null,
        addCommand: () => {},
        getContribution: () => null,
        onKeyUp: () => ({ dispose: () => {} }),
        createContextKey: () => ({ set: () => {} }),
        addAction: (d: { id: string; label: string; contextMenuGroupId?: string; run: () => void }) => {
          captured.actions.push(d);
          return { dispose: () => {} };
        },
        onMouseDown: () => ({ dispose: () => {} }),
        changeViewZones: (cb: (acc: { addZone: () => string; removeZone: () => void }) => void) =>
          cb({ addZone: () => "z", removeZone: () => {} }),
        applyFontInfo: () => {},
        createDecorationsCollection: () => ({ set: () => {}, clear: () => {} }),
        getContentHeight: () => 0,
        getLayoutInfo: () => ({ height: 100, contentLeft: 0 }),
        onDidContentSizeChange: () => ({ dispose: () => {} }),
        onDidLayoutChange: () => ({ dispose: () => {} }),
        updateOptions: () => {},
      };
      onMount?.(editor, {
        KeyMod: { CtrlCmd: 2048 },
        KeyCode: { Enter: 3, KeyR: 48 },
        editor: { setModelMarkers: () => {} },
        MarkerSeverity: { Error: 8 },
        Range: class {},
      });
    }
    return <div data-testid="monaco" />;
  },
  BODY_EDIT_OPTIONS: { readOnly: false },
  BODY_READONLY_OPTIONS: { readOnly: true },
  MONACO_THEME: "handshaker-dark",
}));
vi.mock("@/lib/use-prefs", () => ({
  usePrefs: () => [
    state.prefs,
    (k: string, v: unknown) => {
      (state.prefs as Record<string, unknown>)[k] = v;
    },
  ],
  readPrefs: () => state.prefs,
  setPref: (k: string, v: unknown) => {
    (state.prefs as Record<string, unknown>)[k] = v;
  },
}));
vi.mock("./controller", () => ({
  attachBodyController: () => ({ dispose: () => {} }),
  BADGE_CLASS: "badge",
}));

import { BodyView } from "./BodyView";

const wrapActions = () => captured.actions.filter((a) => a.id === "hs.toggleWordWrap");

describe("BodyView word-wrap context-menu action", () => {
  beforeEach(() => {
    captured.actions = [];
    captured.mounted = false;
    state.prefs = { bodyHints: false, wordWrap: false };
  });

  it("registers the toggle in the REQUEST editor", () => {
    render(<BodyView mode="request" value="{}" onChange={vi.fn()} />);
    expect(wrapActions().length).toBeGreaterThan(0);
  });

  it("registers the toggle in the RESPONSE editor", () => {
    render(<BodyView mode="response" value="{}" />);
    expect(wrapActions().length).toBeGreaterThan(0);
  });

  it("labels the action by the current pref ('Enable' when wrap is off)", () => {
    render(<BodyView mode="request" value="{}" onChange={vi.fn()} />);
    expect(wrapActions().at(-1)!.label).toBe("Enable word wrap");
  });

  it("running the action flips prefs.wordWrap via setPref", () => {
    render(<BodyView mode="request" value="{}" onChange={vi.fn()} />);
    expect(state.prefs.wordWrap).toBe(false);
    wrapActions().at(-1)!.run();
    expect(state.prefs.wordWrap).toBe(true);
  });

  it("re-registers with a fresh label when the pref flips", () => {
    const { rerender } = render(<BodyView mode="response" value="{}" />);
    expect(wrapActions().at(-1)!.label).toBe("Enable word wrap");
    state.prefs = { ...state.prefs, wordWrap: true };
    rerender(<BodyView mode="response" value="{}" />);
    expect(wrapActions().at(-1)!.label).toBe("Disable word wrap");
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm test -- src/features/bodyview/BodyView.wordwrap.test.tsx`
Expected: FAIL — действие `hs.toggleWordWrap` не регистрируется (`wrapActions()` пуст).

- [ ] **Step 3: Импорты + поле Live в BodyView.tsx**

В `src/features/bodyview/BodyView.tsx`:

(а) Расширить импорт use-prefs (строка 4) — добавить `setPref`:

```ts
import { usePrefs, readPrefs, setPref } from "@/lib/use-prefs";
```

(б) Добавить импорт хелпера (рядом с импортом `attachFoldActions`, ~строка 26):

```ts
import { attachWordWrapAction, type WordWrapMenuEditor } from "./wordWrapAction";
```

(в) В интерфейсе `Live` добавить поле (рядом с `fold: DisposableLike | null;`):

```ts
  /** Word-wrap toggle context-menu action (both modes). */
  wrap: DisposableLike | null;
```

- [ ] **Step 4: Навеска в onMount + диспоз в teardown'ах**

(а) В pre-teardown блоке в начале `onMount` (рядом с `live.current?.fold?.dispose();`, ~строка 204) добавить:

```ts
      live.current?.wrap?.dispose();
```

(б) В литерале `live.current = { … }` добавить `wrap: null,` (рядом с `fold: null,`):

```ts
        decorations: null, expanded: new Set(), controller: null, decode: null, fold: null, wrap: null, typeSub: null,
```

(в) Сразу после строки `setModelVarCandidates(editor.getModel(), varCandidatesRef.current ?? null);` (~строка 223), до `if (mode === "request")`, добавить навеску для ОБОИХ режимов:

```ts
      // Word-wrap toggle in the right-click menu — both editors share prefs.wordWrap,
      // so the item lives in both. Label reflects the current state; the effect below
      // re-attaches it when the pref flips.
      live.current.wrap = attachWordWrapAction(
        editor as unknown as WordWrapMenuEditor,
        readPrefs().wordWrap,
        () => setPref("wordWrap", !readPrefs().wordWrap),
      );
```

(г) В unmount-`useEffect` (тот, что диспозит controller/decode/fold, ~строки 342-350) добавить:

```ts
    live.current?.wrap?.dispose();
```

- [ ] **Step 5: Эффект пере-навешивания на смену pref**

В `BodyView.tsx`, рядом с эффектом `useEffect(() => { applyGhost(); }, [prefs.bodyHints, applyGhost]);` (~строка 365), добавить:

```ts
  // Re-register the word-wrap menu action with a fresh label when the pref flips.
  // Monaco fixes an action's label at registration, so reflecting state means
  // dispose + re-add. No-ops until the editor mounts (onMount does the first attach;
  // setPref/readPrefs are module-level/stable, so deps are just [prefs.wordWrap]).
  useEffect(() => {
    const l = live.current;
    if (!l) return;
    l.wrap?.dispose();
    l.wrap = attachWordWrapAction(
      l.editor as unknown as WordWrapMenuEditor,
      prefs.wordWrap,
      () => setPref("wordWrap", !readPrefs().wordWrap),
    );
  }, [prefs.wordWrap]);
```

- [ ] **Step 6: Дополнить мок BodyView.ghost.test.tsx**

Request-режим теперь регистрирует word-wrap action ⇒ фейковому редактору нужен `addAction`. В `src/features/bodyview/BodyView.ghost.test.tsx`, в объект `editor` (рядом с `createDecorationsCollection`, ~строка 44) добавить:

```ts
        addAction: () => ({ dispose: () => {} }),
```

- [ ] **Step 7: Запустить новый тест + затронутые тесты — убедиться, что зелено**

Run: `pnpm test -- src/features/bodyview/BodyView.wordwrap.test.tsx src/features/bodyview/BodyView.ghost.test.tsx src/features/bodyview/BodyView.submit.test.tsx src/features/bodyview/BodyView.minimap.test.tsx src/features/bodyview/BodyView.test.tsx`
Expected: PASS (новый word-wrap тест 5/5; ghost/submit/minimap/smoke без регрессий).

- [ ] **Step 8: Commit**

```bash
git add src/features/bodyview/BodyView.tsx src/features/bodyview/BodyView.ghost.test.tsx src/features/bodyview/BodyView.wordwrap.test.tsx
git commit -m "feat(bodyview): word-wrap toggle in the editor context menu" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Полный гейт

Никакого нового кода — прогнать весь фронт-гейт и подтвердить отсутствие регрессий и чистый tsc.

**Files:** (нет)

- [ ] **Step 1: Весь vitest**

Run: `pnpm test`
Expected: PASS — все наборы зелёные, 0 failed (счётчик вырос на новые ~11 тестов: 5 helper + 1 setPref + 5 integration).

- [ ] **Step 2: tsc + vite build**

Run: `pnpm build`
Expected: PASS — `tsc -b` без ошибок типов, `vite build` собирается. (Bindings не трогали ⇒ дрейфа нет.)

- [ ] **Step 3 (если что-то упало):** диагностировать и починить минимальной правкой, перезапустить шаги 1-2, отдельный fix-commit. Если всё зелёное — задача завершена без коммита.

---

## Остаток (вне плана)

Live WebView2-проход (`pnpm tauri:dev`): ПКМ в редакторе запроса и ответа → пункт «Enable/Disable word wrap» виден в своей группе (под Collapse/Expand-all в ответе), клик переключает перенос, подпись инвертируется; согласованность с тумблером Settings и хоткеем Alt+Z; переживает рестарт.

## Вне объёма (YAGNI)

- Миграция `foldActions`/`decodeActions` на `messages.ts`.
- Keybinding-хинт в пункте меню / своя комбинация.
- Backend / IPC / bindings.
- Правки тумблера Settings или хоткея.
