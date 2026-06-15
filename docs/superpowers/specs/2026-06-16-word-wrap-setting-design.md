# Word Wrap — настройка + хоткей Alt+Z

**Статус:** 📝 SPEC (брейншторм-апрув получен 2026-06-16; план ещё не написан)
**Ветка:** `claude/sharp-antonelli-2e0d2d`
**Дата:** 2026-06-16

## Цель

Дать пользователю управляемый **перенос строк (word wrap)** в редакторах тела
запроса и ответа, **выключенный по умолчанию**. Управление — переключателем в
**Настройках** (Appearance) и глобальным хоткеем **Alt+Z** (как в VS Code).

### Предыстория (зачем)

Сейчас оба Monaco-редактора (запрос и ответ) жёстко включают `wordWrap: "on"`
(`EDITOR_OPTIONS` в `src/lib/monaco.ts`). При узком окне длинное строковое
значение без пробелов (base64/JWT) ведёт себя так: Monaco переносит по границе
слова — по пробелу после `:` — и, не уместив длинный токен в остаток строки,
сбрасывает его **целиком** на следующую строку, а уже там ломает посимвольно.
Итог — ключ один на первой строке, значение «башней» под ним. Пользователю это
не нравится. `renderJsonTree` тут ни при чём (он всегда даёт `"key": "value"` на
одной логической строке — подтверждено `render.test.ts`); причина — именно
`wordWrap: "on"`.

Best practice расходится: **VS Code** по умолчанию держит word wrap **off**
(длинная строка уезжает вправо, горизонтальный скролл), **Postman** — wrap on, но
там и баг переноса, и запрос фичи «дайте отключить перенос для длинных Base64».
Выбранное решение — сделать wrap **настраиваемым, off по умолчанию**, с тумблером
и хоткеем (зеркало UX VS Code: setting `editor.wordWrap` + Alt+Z).

## Поведение

- **Pref `wordWrap` (boolean), по умолчанию `false`.** Единый глобальный — общий
  для редактора запроса и редактора ответа (как настройка уровня редактора в
  VS Code; переключение влияет на оба сразу).
- **off** → `wordWrap: "off"`: длинная строка не переносится, уезжает вправо
  (горизонтальный скролл), ключ+значение остаются на одной визуальной строке,
  «башни под ключом» нет.
- **on** → `wordWrap: "on"`: текущее поведение (мягкий перенос).
- Переключение: тумблер в **Settings → Appearance → Editor → Word wrap**, либо
  хоткей **Alt+Z** (откуда угодно). Оба пишут один pref → оба редактора и тумблер
  синхронны мгновенно.
- **Scope:** только редакторы тела запроса/ответа (`BodyView`). Contract-таб
  (прото-Monaco) — вне scope (строки короткие); при желании добавляется позже тем
  же pref'ом.

## Раскладко-независимость и гард-условия (по образцу `cycle.ts` / `useUiZoom`)

Матч по **физической** клавише `e.code === "KeyZ"` (а не `e.key`) — чтобы хоткей
работал на любой раскладке (на ЙЦУКЕН `e.key` был бы `"я"`).

- Требуется `e.altKey`.
- Отсев `e.ctrlKey` и `e.metaKey` — **AltGr на Windows = Ctrl+Alt** (печатает
  символы); требование `altKey && !ctrlKey` отсекает AltGr, как в env-cycle.
- Отсев `e.shiftKey`.
- Игнор автоповтора (`e.repeat`).
- При срабатывании — `e.preventDefault()` **и** `e.stopPropagation()`.
- Слушатель — в **capture-фазе** на `window`.

### Подавление встроенного Alt+Z Monaco

Monaco поставляет команду `editor.action.toggleWordWrap` с дефолтным биндингом
**Alt+Z**, которая дёргает **внутренний** флаг переноса редактора. Если её не
подавить, при фокусе в редакторе Alt+Z переключит Monaco-внутренний wrap в
рассинхрон с нашим pref. Поэтому хоткей живёт в **capture-фазе window** и при
срабатывании зовёт **`stopPropagation()`** — событие не доходит до DOM-узла
редактора, встроенный биндинг не срабатывает, источник истины один (наш pref).
Это ровно урок из памяти про Ctrl+E на macOS: *capture-фаза сама по себе не
подавляет — нужен `stopPropagation`*. Подавление безопасно и корректно
независимо от того, активен ли дефолтный биндинг в конкретной сборке Monaco.

Хоткей **глобальный** (срабатывает независимо от фокуса) — намеренно, как zoom и
env-cycle. На macOS Option+Z обычно печатает `Ω`; мы его перехватываем — это
совпадает с поведением VS Code (там Alt+Z = word wrap) и принимается.

## Архитектура

Чистая логика — в тестируемом модуле; тонкий хук-обработчик и тонкая обвязка
Monaco — в местах потребления. Зеркалит пару `zoom.ts` (`nextZoom` + `useUiZoom`)
и `cycle.ts` (`isEnvCycleHotkey`).

### 1. Pref — `src/lib/use-prefs.ts`

```ts
export interface Prefs {
  // …
  /** Перенос длинных строк в редакторах тела запроса/ответа. Off → гориз. скролл. */
  wordWrap: boolean;
}

export const PREFS_DEFAULTS: Prefs = {
  // …
  wordWrap: false,
};
```

Механика `usePrefs`/`readPrefs`/`broadcast` уже есть (localStorage + листенеры);
новый ключ переживает рестарт и живо рассылается подписчикам. `read()` мерджит
поверх `PREFS_DEFAULTS`, так что старые сохранённые prefs без `wordWrap`
получают `false`.

### 2. Monaco — `src/features/bodyview/BodyView.tsx` (только)

`src/lib/monaco.ts` **не трогаем.** Жёсткое `wordWrap: "on"` остаётся в
`EDITOR_OPTIONS`, но `BodyView` **переопределяет** опцию из pref, поэтому базовое
значение для тела не важно. Это безопаснее удаления: `READ_ONLY_OPTIONS` оказался
**нигде не используемым** (grep по всей кодовой базе), а `EDITOR_OPTIONS` собирает
только `READ_ONLY_OPTIONS`/`BODY_*`; ContractView эти консты не импортирует. Минус
один изменённый файл и один риск.

- В `BodyView` уже есть `const [prefs] = usePrefs();`. Прокидываем перенос,
  **переопределяя** базовую опцию (spread → последнее поле выигрывает):

```ts
const base = mode === "response" ? BODY_READONLY_OPTIONS : BODY_EDIT_OPTIONS;
const wrap = prefs.wordWrap ? "on" : "off";
const options = useMemo(() => ({ ...base, wordWrap: wrap }), [base, wrap]);
```

  Начальное значение берётся из текущего pref (через `usePrefs`-стейт,
  сидированный `readPrefs()` при инициализации) → **нет мигания** на маунте.
- Живое переключение — явным эффектом (не полагаемся на то, как
  `@monaco-editor/react` реагирует на смену `options`-пропа: его поведение я не
  смог подтвердить из-за pnpm-раскладки node_modules, поэтому делаю надёжно):

```ts
useEffect(() => {
  live.current?.editor.updateOptions({ wordWrap: prefs.wordWrap ? "on" : "off" });
}, [prefs.wordWrap]);
```

  Эффект no-op до маунта (`live.current` ещё null); `onMount` берёт начальное
  значение из `options`. Срабатывает для обоих режимов (общий pref).

  > Примечание: т.к. опция переопределяется здесь, base-консты в `monaco.ts`
  > остаются как есть. Короткий комментарий в `BodyView` фиксирует, что источник
  > истины по `wordWrap` — pref, а не `BODY_*`.

### 3. Новый модуль `src/features/shell/wordWrap.ts`

Рядом с `zoom.ts` (оба — глобальные хоткеи/prefs уровня оболочки).

```ts
import { useEffect } from "react";
import { readPrefs, usePrefs } from "@/lib/use-prefs";

/** Предикат хоткея word-wrap: Alt+Z по физической клавише Z (раскладко-
 *  независимо), без Ctrl (AltGr-гард), Meta и Shift. */
export function isWordWrapHotkey(
  e: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
): boolean {
  if (!e.altKey) return false;
  if (e.ctrlKey || e.metaKey || e.shiftKey) return false; // AltGr=Ctrl+Alt, Shift — не наш
  return e.code === "KeyZ";
}

/** Глобальный Alt+Z → переключает pref `wordWrap`. Capture-фаза + stopPropagation,
 *  чтобы подавить встроенный Alt+Z Monaco (рассинхрон). Bind once: handler читает
 *  свежее значение через readPrefs(), setPref читает модульный current. */
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
  }, [setPref]);
}
```

Привязка — в `src/app/WorkflowApp.tsx` рядом с `useUiZoom();`:

```ts
useUiZoom();
useWordWrapHotkey();
```

### 4. Настройки — `src/features/settings/AppearancePane.tsx`

Новая группа **Editor** с рядом-тумблером (shadcn `Switch`, как ряд «Sidebar»):

```tsx
<SettingsGroup title="Editor">
  <SettingsRow
    title="Word wrap"
    hint="Wrap long lines in the request and response editors. Alt+Z toggles."
    control={<Switch checked={prefs.wordWrap} onCheckedChange={(v) => setPref("wordWrap", v)} />}
  />
</SettingsGroup>
```

### 5. KeyboardPane — `src/features/settings/KeyboardPane.tsx`

Добавить строку в `ROWS`:

```ts
["Word wrap", ["Alt", "Z"]],
```

## Тестирование

**Юнит (`src/features/shell/wordWrap.test.ts`):**
- `isWordWrapHotkey`: `{altKey, code:"KeyZ"}` → true; `+ctrlKey` (AltGr) → false;
  `+metaKey` → false; `+shiftKey` → false; без `altKey` → false;
  `{altKey, code:"KeyY"}` → false; кириллица `{altKey, code:"KeyZ"}` (key был бы
  `"я"`) → true.

**Хук (`src/features/shell/useWordWrapHotkey.test.tsx`):** смонтировать компонент,
зовущий `useWordWrapHotkey()`; начальный `readPrefs().wordWrap === false`;
диспатч `KeyboardEvent("keydown", {altKey, code:"KeyZ", bubbles})` на `window` →
`readPrefs().wordWrap === true`; повторный диспатч → снова `false` (тоггл).
Диспатч `{altKey, ctrlKey, code:"KeyZ"}` (AltGr) → pref не меняется.

**Pref-дефолт:** ассерт `PREFS_DEFAULTS.wordWrap === false` (если у `use-prefs`
ещё нет тест-файла — завести минимальный `src/lib/use-prefs.test.ts` с этим
ассертом и проверкой, что `read()` старого payload без ключа даёт `false`).

**Settings (`src/features/settings/AppearancePane.test.tsx`):** ряд «Word wrap»
виден; клик по `Switch` зовёт `setPref("wordWrap", true)` (или меняет pref).

**BodyView (`src/features/bodyview/BodyView.test.tsx`):** при `prefs.wordWrap=false`
переданные в мок-`MonacoEditor` `options.wordWrap === "off"`; (по возможности) при
смене pref зовётся `editor.updateOptions({ wordWrap: "on" })`. Мок Monaco в этих
тестах уже есть — расширить, чтобы фиксировать `options`/`updateOptions`.

**Гейт:** `pnpm vitest run` (все зелёные), `pnpm tsc`, `pnpm build`. Бэкенд не
трогается — `cargo` не обязателен, но прогон `cargo check` не повредит.

## Затрагиваемые файлы

| Файл | Изменение |
| --- | --- |
| `src/lib/use-prefs.ts` | `wordWrap: boolean` в `Prefs` + `PREFS_DEFAULTS: false` |
| `src/features/bodyview/BodyView.tsx` | переопределить `wordWrap` из pref (`useMemo`) + эффект `updateOptions` |
| `src/features/shell/wordWrap.ts` | **новый** — `isWordWrapHotkey` + `useWordWrapHotkey` |
| `src/features/shell/wordWrap.test.ts` | **новый** — юнит предиката |
| `src/features/shell/useWordWrapHotkey.test.tsx` | **новый** — тест хука/тоггла |
| `src/app/WorkflowApp.tsx` | вызов `useWordWrapHotkey()` рядом с `useUiZoom()` |
| `src/features/settings/AppearancePane.tsx` | группа Editor + `Switch` Word wrap |
| `src/features/settings/AppearancePane.test.tsx` | тест ряда Word wrap |
| `src/features/settings/KeyboardPane.tsx` | строка `Word wrap → Alt Z` |
| `src/features/bodyview/BodyView.test.tsx` | ассерт `options.wordWrap` по pref |

Бэкенд/IPC/`bindings.ts` — **не трогаем**.

## Риски

| Риск | Митигация |
| --- | --- |
| Встроенный Alt+Z Monaco рассинхронит wrap с pref | Capture-фаза + `stopPropagation` → событие не доходит до редактора; источник истины — pref. |
| `@monaco-editor/react` не применит смену `options`-пропа вживую | Явный `editor.updateOptions` в эффекте — не зависим от поведения обёртки. |
| Alt+Z (Option+Z на macOS) перехватывает ввод `Ω` в инпутах | Принимается — совпадает с VS Code (Alt+Z = word wrap). Windows-первичное приложение, Alt+Z там не печатает. |
| Мигание wrap при холодном маунте | Начальное `options.wordWrap` берётся из pref (`readPrefs`-сидированный стейт) до первого пейнта. |

## Live-проход (после имплементации)

В WebView2: длинное base64-значение в ответе при off — уезжает вправо (скролл),
ключ+значение вместе; Alt+Z включает перенос (значение wrap'ится), Alt+Z снова —
выключает; тумблер в Settings → Appearance синхронен с хоткеем в обе стороны;
на русской раскладке Alt+Z тоже срабатывает; AltGr+Z (Windows) перенос не трогает;
состояние переживает перезапуск приложения.
