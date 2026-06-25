# Word-wrap toggle в контекстном меню редактора — дизайн

**Статус:** 📝 SPEC (готова к плану)
**Дата:** 2026-06-26
**Объём:** frontend-only — 1 новый чистый хелпер + тесты · правка `BodyView.tsx` · новая секция копии в `messages.ts` · экспорт стабильного `setPref` из `use-prefs.ts`
**Backend / IPC / bindings:** не трогаются

## Проблема / цель

Word-wrap уже управляем общим персистентным pref'ом `prefs.wordWrap`
([use-prefs.ts](../../../src/lib/use-prefs.ts)) и переключается двумя способами:
тумблером **Settings → Appearance** и глобальным хоткеем **Alt+Z / ⌥⌘Z**
([wordWrap.ts](../../../src/features/shell/wordWrap.ts)). Не хватает третьей,
контекстной поверхности — пункта по **правому клику** прямо в редакторе тела, где
проблема длинной строки и видна.

Pref — **единый источник истины**, общий для обоих редакторов тела (запрос +
ответ): [BodyView.tsx](../../../src/features/bodyview/BodyView.tsx) читает его в
`useMemo`'нутый `options`-проп, и обёртка `@monaco-editor/react` живо применяет
`updateOptions` при смене идентичности опций. Поэтому новый пункт меню — просто ещё
один писатель того же pref'а, без своего состояния.

## Утверждённые решения

- **Где показывать:** в **обоих** редакторах (запрос + ответ). Pref общий ⇒ логично
  иметь пункт везде; переключение из любого редактора влияет на оба.
- **Подпись:** **динамическая, отражает текущее состояние** — `"Enable word wrap"`,
  когда `prefs.wordWrap === false`, и `"Disable word wrap"`, когда `true` (label =
  действие, которое выполнит клик).
- **Где живёт текст:** копия — в [messages.ts](../../../src/lib/messages.ts) (новая
  секция `bodyview.menu.wordWrap`), а не инлайном в хелпере. Это направление,
  заявленное самим `messages.ts` («a small vertical slice … before wider migration»).
  Миграция соседних `foldActions`/`decodeActions` на `messages.ts` — **вне объёма**.

## Архитектура

### 1. Копия — `src/lib/messages.ts`

Новая секция (динамическая подпись ложится на уже существующий в файле паттерн
функций-строк, ср. `duplicatedAs: (name) => …`):

```ts
bodyview: {
  menu: {
    wordWrap: (wrapped: boolean): string =>
      wrapped ? "Disable word wrap" : "Enable word wrap",
  },
},
```

### 2. Чистый хелпер — `src/features/bodyview/wordWrapAction.ts`

Зеркало [foldActions.ts](../../../src/features/bodyview/foldActions.ts): структурный
интерфейс редактора (чтобы юнит-тесты не тащили `monaco-editor`) + регистратор
действия. Отдельной `wordWrapLabel`-функции **нет** — выбор строки по состоянию
есть копия, и она уже в `messages.ts`.

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

/** Срез редактора, нужный для регистрации действия. Реальный
 *  `IStandaloneCodeEditor` удовлетворяет структурно. */
export interface WordWrapMenuEditor {
  addAction(descriptor: WordWrapActionDescriptor): DisposableLike;
}

// Собственная группа, сортируется после "1_folding" и до "9_cutcopypaste*":
// в меню ответа пункт встаёт под Collapse/Expand all и над copy/save; в меню
// запроса — своим слайсом.
const GROUP_VIEW = "2_view";

/**
 * Регистрирует пункт «Enable/Disable word wrap» в контекстном меню. Подпись
 * отражает ТЕКУЩЕЕ состояние `wrapped` (берётся из messages.ts). Monaco фиксирует
 * label действия в момент регистрации, поэтому при смене pref вызывающий
 * пере-вешает действие (dispose + re-add) — дёшево, переключают редко. БЕЗ
 * keybinding (Alt+Z / ⌥⌘Z остаётся за оконным слушателем, встроенный Monaco
 * отвязан в monaco.ts) ⇒ глобальный last-wins реестр keybinding не трогаем —
 * та же причина, что у foldActions/decodeActions.
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

### 3. Стабильный сеттер — `src/lib/use-prefs.ts`

Экспортировать модульный `setPref(key, value)` (симметрия с уже существующим
`readPrefs()`), чтобы замыкание-тоггл и эффект пере-навешивания в `BodyView` не
зависели от пер-рендерной идентичности сеттера из хука. `usePrefs().setKey`
делегирует в него:

```ts
export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  broadcast({ ...current, [key]: value });
}
// usePrefs: function setKey(key, value) { setPref(key, value); }
```

### 4. Проводка — `src/features/bodyview/BodyView.tsx`

- В `Live` добавить `wrap: DisposableLike | null` (рядом с `fold`).
- В `onMount` (для **обоих** mode), после создания `live.current`:
  ```ts
  const toggleWrap = () => setPref("wordWrap", !readPrefs().wordWrap);
  live.current.wrap = attachWordWrapAction(
    editor as unknown as WordWrapMenuEditor,
    readPrefs().wordWrap,
    toggleWrap,
  );
  ```
- `useEffect` на `[prefs.wordWrap]`: dispose старого `wrap` + re-attach со свежей
  подписью (гард `if (!live.current) return`, т.к. эффект может опередить mount
  ленивого Monaco — тогда первичную навеску делает `onMount`, а эффект ловит
  последующие смены pref без ремаунта). Зависимость только `prefs.wordWrap` —
  `setPref` модульный/стабильный.
- Dispose `wrap` в обоих teardown-сайтах: pre-teardown блок в начале `onMount`
  (рядом с `live.current?.fold?.dispose()`) и unmount-`useEffect`.

**Взаимодействие с ремаунтом ответа.** Редактор ответа ремаунтится по `key=value`;
`onMount` тогда навешивает заново с `readPrefs().wordWrap` (актуальным). Эффект
`[prefs.wordWrap]` при ремаунте не срабатывает (pref не менялся). Разделение
чистое: `onMount` — свежие mount'ы, эффект — смена pref без ремаунта.

## Почему так, а не иначе

- **Без keybinding в `addAction`** — передача keybinding пере-регистрировала бы
  аккорд в глобальном last-wins реестре Monaco (см. коммент про Ctrl+Enter в
  `BodyView`), конфликтуя с оконным Alt+Z. Хоткей уже работает через
  `useWordWrapHotkey`; в меню — только подпись.
- **Динамика через dispose+re-add**, а не checkbox/`toggled` — стандартный
  `IStandaloneCodeEditor.addAction` не выставляет состояние-галочку в контекстном
  меню, а label фиксируется при регистрации. Пере-навеска — единственный способ
  отразить состояние; стоит дёшево (переключают редко).
- **Текст в `messages.ts`** — выбранное направление проекта; хелпер остаётся чистой
  логикой без литералов.
- **Модульный `setPref`** — убирает нестабильную зависимость в `useEffect`
  (иначе эффект пере-вешал бы действие на каждый рендер из-за новой идентичности
  `setKey`).

## Тестирование (TDD)

**Юнит — `wordWrapAction.test.ts`** (fake-редактор, фиксирующий descriptor):
- `wrapped=false` ⇒ зарегистрированный label === `"Enable word wrap"` (пин копии).
- `wrapped=true` ⇒ label === `"Disable word wrap"`.
- descriptor: `id==="hs.toggleWordWrap"`, `contextMenuGroupId==="2_view"`, без
  keybinding-поля.
- `run()` зовёт переданный `onToggle`.
- возвращённый `DisposableLike.dispose()` диспозит действие (fake считает вызовы).

**Юнит — `use-prefs.test.ts`**: модульный `setPref("wordWrap", true)` обновляет
`readPrefs().wordWrap` и уведомляет подписчиков `usePrefs`.

**Интеграция — `BodyView.test.tsx`** (мок `@monaco-editor/react`, собирающий
`addAction`-дескрипторы, как в существующих тестах меню):
- В обоих mode (`request`/`response`) среди зарегистрированных action есть
  `hs.toggleWordWrap`.
- Начальная подпись соответствует текущему `prefs.wordWrap`.
- Вызов `run()` тоггл-действия инвертирует `readPrefs().wordWrap`.
- После смены `prefs.wordWrap` (rerender) подпись действия обновляется
  (dispose+re-add).

## Вне объёма (YAGNI)

- Миграция `foldActions`/`decodeActions` на `messages.ts`.
- Keybinding-хинт в пункте меню / своя комбинация.
- Backend / IPC / bindings.
- Любые правки тумблера Settings или хоткея.
