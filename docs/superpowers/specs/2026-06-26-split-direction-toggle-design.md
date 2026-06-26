# Split-direction toggle — кнопка в титлбаре + хоткей

**Статус:** 🟢 SPEC — ожидает ревью пользователя, затем план.
**Дата:** 2026-06-26
**Ветка:** `claude/relaxed-hawking-059cef`
**Тип:** чистый фронт (FE-only). Бэкенд / IPC / bindings **не трогаем**.

## Цель

Дать прямую, всегда-под-рукой кнопку переключения ориентации сплита
request/response, не заставляя лезть в Settings. Сейчас `prefs.split`
(`"vertical"` = Left/Right, `"horizontal"` = Top/Bottom) меняется **только** через
Settings → Appearance → Layout → Split direction (ToggleGroup). Это и есть
анти-паттерн, на который жалуются пользователи Insomnia/Bruno: тумблер закопан в
настройках.

### Best-practice (обоснование расположения и формы)

- **Postman** — иконка-тоггл «два прямоугольника» в статус-баре (низ-право), плюс
  `View → Toggle Two Pane View`, плюс хоткей `⌥⌘V` (Mac). Канонический паттерн:
  маленькая иконка, отражающая ориентацию, всегда видна, + хоткей.
  ([digi-dank](https://digi-dank.com/set-two-pane-view-in-postman/),
  [Postman docs](https://learning.postman.com/docs/getting-started/installation/settings))
- **Insomnia** — только опция в Preferences («always use vertical layout»);
  пользователи многократно просят быстрый тоггл
  ([Kong/insomnia#1295](https://github.com/getinsomnia/insomnia/issues/1295)).
- **Bruno** — только Left/Right, быстрый тоггл — открытый feature request, прямо
  ссылающийся на Postman
  ([usebruno/bruno#7708](https://github.com/usebruno/bruno/issues/7708)).

Вывод: маленькая иконка-тоггл + хоткей. У Handshaker нет нижнего статус-бара,
поэтому ближайший аналог «всегда видно, рядом с утилитами» — **титлбар**.
Расположение выбрано пользователем: **между Toggle sidebar и Check for updates**.

## Расположение и почему так

Кнопка — новый icon-button в правом кластере утилит титлбара
(`src/features/shell/Titlebar.tsx`, блок `justify-self-end`), **между** кнопкой
Toggle sidebar (`PanelLeft`) и Check for updates (`RefreshCw`).

Титлбар уже зовёт `usePrefs()` → `[prefs, setPref]`, поэтому кнопка читает/пишет
`prefs.split` **напрямую** — ноль проброса пропсов, ноль новой связности.
`CallPanel` перерисуется через тот же общий реактивный стор prefs
(`src/lib/use-prefs.ts`), который маппит `prefs.split` в `orientation`
`ResizablePanelGroup` (`CallPanel.tsx:65`).

## Компонент кнопки

- Переиспользует общий класс `btn` титлбара (как соседи), `size={13}` иконка.
- **Иконка отражает текущую раскладку:**
  - `prefs.split === "vertical"` (Left/Right) → `Columns2` (две колонки рядом);
  - `prefs.split === "horizontal"` (Top/Bottom) → `Rows2` (две строки стопкой).
  Обе иконки проверены — есть в `lucide-react@^0.460`.
- `aria-label` — **стабильный** `messages.shell.titlebar.splitDirection`
  (`"Toggle split direction"`), чтобы тесты/скринридер не зависели от состояния.
- **Tooltip** — динамичная подпись-действие + чорд:
  `messages.shell.titlebar.splitDirectionTooltip(prefs.split)` →
  - при `vertical` → `"Switch to top / bottom layout"`;
  - при `horizontal` → `"Switch to left / right layout"`;
  плюс глифы хоткея через `<Kbd>` (`Alt`/`⌘` + `V`) — проза в `messages`, символы
  клавиш остаются `<Kbd>`-элементами в компоненте (тот же раздел, что в Send-тултипе
  и `KeyboardPane`). `side="bottom"` как у соседей.
- `onClick`: `setPref("split", prefs.split === "horizontal" ? "vertical" : "horizontal")`.
- Видна на обеих платформах (в отличие от min/max/close — те только на Win/Linux).

## Хоткей

`Alt+V` (Windows/Linux) / `⌥⌘V` (macOS). Совпадает **и** с хоткеем Postman на Mac
(`⌥⌘V`), **и** с конвенцией репо для word-wrap (Win `Alt+<буква>`, Mac `⌥⌘<буква>` —
голый `⌥V` на маке печатает символ и перехватывается глобально).

Новый чистый модуль `src/features/shell/splitDirection.ts` — **зеркало**
`wordWrap.ts`:

```ts
import { useEffect } from "react";
import { readPrefs, setPref } from "@/lib/use-prefs";
import type { SplitDir } from "@/lib/use-prefs";
import { isMacOS } from "@/lib/platform";

/** Следующая ориентация по кругу (двух-состояний тоггл). */
export function nextSplit(cur: SplitDir): SplitDir {
  return cur === "horizontal" ? "vertical" : "horizontal";
}

/** Предикат хоткея split-direction по ФИЗИЧЕСКОЙ клавише V (раскладко-независимо):
 *   - Windows/Linux — Alt+V, без Ctrl (AltGr = Ctrl+Alt), Meta, Shift;
 *   - macOS — ⌥⌘V (голый ⌥V печатает символ / перехватывается; Command гасит
 *     композицию). Без Ctrl, без Shift. `mac` передаётся вызывающим (хук берёт
 *     isMacOS) — предикат остаётся чистым и тестируется на обеих платформах. */
export function isSplitToggleHotkey(
  e: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
  mac: boolean,
): boolean {
  if (e.code !== "KeyV" || e.shiftKey) return false;
  if (mac) return e.altKey && e.metaKey && !e.ctrlKey;
  return e.altKey && !e.ctrlKey && !e.metaKey;
}

/** Глобальный хоткей split-direction → переключает pref `split`. Capture-фаза +
 *  preventDefault/stopPropagation (capture-фаза НЕ равна подавлению — нужен
 *  stopPropagation, иначе Monaco/прочие могут увидеть событие; урок env-cycle).
 *  Биндим однажды: setPref пишет в модульный стор, readPrefs() читает свежее. */
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
  }, []);
}
```

Подключение — в `src/app/WorkflowApp.tsx` рядом с `useWordWrapHotkey()`:

```ts
useUiZoom();
useWordWrapHotkey();
useSplitDirectionHotkey(); // ← новый
```

**Гард по Monaco:** ни `Alt+V`, ни `⌥⌘V` не являются дефолтным кейбиндингом Monaco
(в отличие от `Alt+Z` = `editor.action.toggleWordWrap`, который пришлось отвязывать).
Capture-фаза + `stopPropagation` подавляют любой сторонний хендлер на совпавшем
чорде. Верифицировать при реализации: если внезапно есть дефолт Monaco на `V`-чорд —
отвязать в `monaco.ts` через `addKeybindingRule({ command: null })` (как с Alt+Z).
Ожидание — отвязывать нечего.

## Строки — всё в `messages.ts`

Per `.claude/rules/ui-strings.md`: любая видимая пользователю строка живёт в
`src/lib/messages.ts`. Так как мы редактируем `Titlebar.tsx` и `KeyboardPane.tsx`,
**централизуем существующие инлайн-строки этих двух файлов** (значения идентичны —
тесты по accessible-name остаются зелёными). Файлы, которые не трогаем (напр.
`AppearancePane`), — вне scope этой фичи.

Новый namespace `shell` в `messages.ts`:

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
    splitDirection: "Toggle split direction",               // aria-label (стабильный)
    splitDirectionTooltip: (split: "horizontal" | "vertical"): string =>
      split === "horizontal" ? "Switch to left / right layout" : "Switch to top / bottom layout",
  },
  keyboard: {
    sendRequest: "Send request",
    toggleSidebar: "Toggle sidebar",
    wordWrap: "Word wrap",
    splitDirection: "Split direction",
  },
},
```

(Тип параметра — инлайн-юнион `"horizontal" | "vertical"`, чтобы `messages.ts`
оставался без импортов, как сейчас.)

`Titlebar.tsx`: заменить инлайн-литералы тултипов/aria на `messages.shell.titlebar.*`;
добавить новую кнопку. `KeyboardPane.tsx`: ROWS-метки → `messages.shell.keyboard.*`;
добавить строку Split direction.

## Settings

- **AppearancePane** — ToggleGroup «Split direction» остаётся как есть
  (источник истины-контрол, не трогаем).
- **KeyboardPane** — добавить строку `["Split direction", [SPLIT_KEYS]]`, где
  `SPLIT_KEYS = isMacOS ? ["⌥", "⌘", "V"] : ["Alt", "V"]` (зеркало `WORD_WRAP_KEYS`).
  Метка из `messages.shell.keyboard.splitDirection`.

Обе поверхности и кнопка пишут один и тот же `prefs.split` ⇒ автосинхрон.

## Вне scope

- Бэкенд / IPC / bindings — `prefs.split` уже существует и персистится в localStorage.
- Рефактор `AppearancePane` и широкая миграция строк в `messages.ts` (только два
  редактируемых файла).
- Запоминание разных размеров панели под каждую ориентацию (`bodyPanel` общий —
  как сейчас, осознанно).

## Тестирование (TDD)

1. **`src/features/shell/splitDirection.test.ts`** (новый) — таблица для
   `isSplitToggleHotkey`:
   - Win: `Alt+V` (code `KeyV`, alt, без ctrl/meta/shift) → `true`; `Alt+Shift+V`,
     `Ctrl+Alt+V` (AltGr), `Alt+Z`, голый `V` → `false`.
   - Mac: `⌥⌘V` → `true`; голый `⌥V` (без meta), `Ctrl+Alt+V` → `false`.
   - `nextSplit("horizontal") === "vertical"` и обратно.
2. **`src/features/shell/useSplitDirectionHotkey.test.tsx`** (новый) — зеркало
   `useWordWrapHotkey.test.tsx`: смонтировать компонент, зовущий хук; задать
   `setPref("split", "vertical")`; диспатчить `keydown` совпавшего чорда; проверить
   `readPrefs().split === "horizontal"`; повторно — обратно.
3. **`Titlebar.test.tsx`** (расширить) — кнопка `name: "Toggle split direction"`
   рендерится (обе платформы); клик флипает `prefs.split` (сбросить prefs в
   `beforeEach`); иконка/тултип меняются по состоянию. Существующие тесты по
   accessible-name соседей зелёные (значения строк не изменились).
4. **`KeyboardPane`** — строка Split direction с правильным чордом (если есть тест
   панели; иначе покрыто tsc).

**Гейт:** `pnpm test` (vitest) · `tsc` · `pnpm build` (vite). Бэкенд не трогаем ⇒
`cargo` не нужен. bindings без дрейфа (IPC не менялся).

## Затронутые файлы

| Файл | Изменение |
|---|---|
| `src/lib/messages.ts` | **+** namespace `shell.titlebar` / `shell.keyboard` |
| `src/features/shell/splitDirection.ts` | **новый** — `isSplitToggleHotkey` + `nextSplit` + `useSplitDirectionHotkey` |
| `src/features/shell/splitDirection.test.ts` | **новый** — таблица предиката + `nextSplit` |
| `src/features/shell/useSplitDirectionHotkey.test.tsx` | **новый** — тоггл-тест хука |
| `src/features/shell/Titlebar.tsx` | **+** кнопка (между sidebar и updates); строки → `messages` |
| `src/features/shell/Titlebar.test.tsx` | **+** тесты кнопки/клика/иконки |
| `src/features/settings/KeyboardPane.tsx` | **+** строка Split direction; метки → `messages` |
| `src/app/WorkflowApp.tsx` | **+** вызов `useSplitDirectionHotkey()` |

## Инфраструктура правил (сделано отдельно от фичи)

- `.gitignore`: `.claude` → `.claude/*` + `!.claude/rules/` (коммитим только правила).
- `.claude/rules/ui-strings.md` — правило «строки → `messages.ts`», `paths`-скоуп
  `src/**/*.{ts,tsx}`. Это и регулирует строковую часть данной фичи.
