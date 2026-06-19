# Навигация по большому ответу — minimap · scrollbar · collapse/expand all

**Статус:** 📝 SPEC (на ревью) · 2026-06-19 · ветка `claude/sad-shtern-c77fd3`

## Проблема

При большом теле ответа навигация неудобна. Сейчас тело ответа — read-only
Monaco-редактор (`BodyView mode="response"`) с минимальным хромом
(`src/lib/monaco.ts`):

- `minimap: { enabled: false }` — нет обзорной карты документа;
- `scrollbar: { verticalScrollbarSize: 8 }` — тонкая 8px-полоса, трудно схватить;
- `folding: true` (фолдинг есть), но нет быстрого «свернуть всё».

Пользователь подтвердил три боли: **(1)** нет обзора / далеко прыгать;
**(2)** тонкий бар трудно схватить; **(3)** слишком длинно листать.
(Боль «теряю, в каком объекте нахожусь» — НЕ выбрана ⇒ sticky scroll вне scope.)

## Цели

1. Дать обзор формы всего ответа и быстрый прыжок в любое место — **minimap**.
2. Сделать вертикальный скроллбар удобным для попадания мышью — **шире + scrollByPage**.
3. Дать физически укоротить документ — **Collapse all / Expand all**.

## Не-цели (осознанно)

- **Sticky scroll** — соответствующая боль не выбрана.
- **Minimap на редакторе запроса** — тело запроса мелкое, карта там — шум.
- **Персист состояния свёрнутости** — ответ эфемерен; при новом ответе всё сбрасывается.
- **Collapse на >50MB raw-пути** — при превышении `BODY_MAX_BYTES` (`elide.ts`) дерево
  не строится, фолдинг выключен; minimap+scrollbar там всё ещё помогают, кнопки no-op
  (скрыты, см. ниже).
- **Бэкенд / IPC / bindings** — не трогаются вообще. Чистый фронт.

## Дизайн

### Поверхность изменений

| Файл | Изменение |
|------|-----------|
| `src/lib/monaco.ts` | scrollbar-тюнинг в `EDITOR_OPTIONS`; minimap-опции в `BODY_READONLY_OPTIONS` |
| `src/features/bodyview/BodyView.tsx` | `forwardRef` + handle `{ collapseAll, expandAll }`; size-gate minimap |
| `src/features/bodyview/minimapGate.ts` (новый) | чистый хелпер `shouldShowMinimap` |
| `src/features/response/ResponseBody.tsx` | проброс `ref` в `BodyView` |
| `src/features/response/ResponsePanel.tsx` | две icon-кнопки в шапке + `useRef` к handle |

### 1. Minimap (size-gated, только ответ)

- Включается **только на response-редакторе** (`BODY_READONLY_OPTIONS`). Request не трогаем.
- **Блок-форма** без символов: `minimap: { renderCharacters: false }` — чистый
  цвет-блок обзор под тёмную палитру; клик/драг = прыжок.
- **Видна только при переполнении вьюпорта** (выбор пользователя). Базовая опция
  `enabled` ставится исходя из размера, далее переоценивается живьём:
  - источник истины — `editor.getContentHeight()` vs высота вьюпорта
    `editor.getLayoutInfo().height`;
  - чистый предикат `shouldShowMinimap(contentHeight, viewportHeight)` →
    `contentHeight > viewportHeight` (с маленьким допуском, чтобы не мигало на грани);
  - подписки `editor.onDidContentSizeChange` + `editor.onDidLayoutChange` пересчитывают
    желаемое состояние; `editor.updateOptions({ minimap: { enabled } })` зовётся
    **только когда желаемое state отличается от текущего** — иначе toggling minimap сам
    меняет layout → петля обратной связи. Гард на «изменилось» рвёт петлю.
  - пересчёт также срабатывает после раскрытия elision-бейджа (документ вырос).
- Адаптивно к resizable-панелям: высокая панель / короткий ответ → нет полосы; большой
  ответ → карта появляется.

### 2. Scrollbar (оба редактора, базовые опции)

В `EDITOR_OPTIONS`:
- `scrollbar.verticalScrollbarSize`: 8 → **14** (дефолт VS Code; реальная цель для мыши).
- `scrollbar.scrollByPage`: **true** — клик по жёлобу листает экран, а не телепортирует.
  Прыжок «куда угодно» закрыт минимапой, поэтому постраничный клик — предсказуемое
  конвенциональное поведение. (Горизонтальный размер оставляем 8.)

### 3. Collapse all / Expand all (вкладка Body ответа)

- Две icon-кнопки: `ChevronsDownUp` (collapse all) / `ChevronsUpDown` (expand all),
  зеркало пары из шапки коллекций (единый словарь иконок).
- Живут в **шапке ResponsePanel** (ряд `h-10` с табами + `RespMeta`), в кластере
  `ml-auto` рядом с `RespMeta`.
- Рендерятся **только** когда активна вкладка **Body** и есть **успешный JSON-ответ**
  (`state === "success" && outcome && tab === "body" && outcome.response_json !== null`).
  Скрыты на Trailers/Headers/Contract, на ошибках и на idle empty-state.
- Мост шапка↔тело — как `SidebarShell` ↔ `CollectionTree`:
  - `BodyView` оборачивается в `forwardRef<BodyViewHandle>`, экспонирует через
    `useImperativeHandle` крошечный handle:
    ```ts
    export interface BodyViewHandle {
      collapseAll(): void;
      expandAll(): void;
    }
    ```
    реализация дёргает встроенные действия Monaco на `live.current.editor`:
    `editor.getAction("editor.foldAll")?.run()` /
    `editor.getAction("editor.unfoldAll")?.run()` (фолдинг включён в обоих body-режимах).
  - `ResponseBody` пробрасывает полученный `ref` вниз в `BodyView`
    (тоже `forwardRef`, тонкий проброс).
  - `ResponsePanel` держит `useRef<BodyViewHandle>(null)`, отдаёт его в `ResponseBody`
    и зовёт `bodyRef.current?.collapseAll()/expandAll()` из кнопок.
- Без персиста; новый ответ → keyed-ремаунт BodyView → фолды сбрасываются сами.
- Кнопки `disabled` нет смысла — они отрендерены только когда тело foldable; на
  редком >50MB raw-пути ответ не попадает под `response_json` tree-рендер так же
  (фолдинг выключен) — кнопки безвредно no-op; отдельный гард не вводим (YAGNI),
  но если потребуется — handle может вернуть `canFold`.

## Поведение / краевые случаи

- **Невалидный JSON** в ответе: tree не строится, но Monaco-фолдинг по отступам всё
  равно может что-то свернуть; кнопки видны (success+json present) и работают по
  фолдинг-регионам Monaco. Приемлемо.
- **Раскрытие elision-бейджа** растит документ → size-gate пересчитывает minimap.
- **Resize панели** (`onDidLayoutChange`) → size-gate пересчитывает minimap.
- **reduced-motion** — не затрагивается (никакой новой анимации).

## Стратегия тестов (TDD, в стиле текущего сьюта)

- `minimapGate.test.ts` — чистый `shouldShowMinimap`: overflow → true; помещается →
  false; граница/допуск.
- `BodyView` handle — против мок-редактора (как существующие BodyView-тесты мокают
  Monaco): `collapseAll()`/`expandAll()` триггерят правильные action-id.
- `ResponsePanel` — рендер-гейтинг кнопок: видны на success+Body+JSON; скрыты на
  Trailers/Headers/Contract, error, idle.
- Регрессия: request-редактор по-прежнему без minimap; Ctrl+Enter→Send жив
  (addCommand-гейт не тронут).

## Гейт перед мержем

- `pnpm test` (vitest) — все зелёные, новые тесты включены.
- `tsc` (типы) — чисто.
- `pnpm build` (vite) — собирается.
- Бэкенд не трогался ⇒ `cargo` не нужен; bindings без дрейфа (IPC не менялся).
- Живой проход в WebView2 (`pnpm tauri:dev`): большой ответ → minimap появляется и
  кликом прыгает; маленький → полосы нет; скроллбар шире и постранично; Collapse all /
  Expand all сворачивают/разворачивают тело; кнопки скрыты вне Body/на ошибке.
