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

> **Амендмент по live-фидбеку (2026-06-19):** Collapse all / Expand all
> **перенесены из icon-кнопок в шапке в right-click контекстное меню** тела
> ответа (рядом с decode/copy-действиями). Это убрало мост шапка↔тело целиком —
> `BodyViewHandle`/`forwardRef`/проброс `ref` больше не нужны. Раздел 3 ниже
> отражает финальный (context-menu) дизайн; minimap и scrollbar без изменений.

| Файл | Изменение |
|------|-----------|
| `src/lib/monaco.ts` | scrollbar-тюнинг в `EDITOR_OPTIONS`; minimap-опции в `BODY_READONLY_OPTIONS` |
| `src/features/bodyview/BodyView.tsx` | size-gate minimap (response onMount); `attachFoldActions` в response-ветке |
| `src/features/bodyview/minimapGate.ts` (новый) | чистый хелпер `shouldShowMinimap` |
| `src/features/bodyview/foldActions.ts` (новый) | `foldAll`/`unfoldAll` + `attachFoldActions` (context-menu actions) |
| `src/features/response/ResponseBody.tsx` · `ResponsePanel.tsx` | без изменений по сути (плоский `BodyView`, без ref-моста) |

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

### 3. Collapse all / Expand all (right-click меню тела ответа)

- Два пункта right-click контекстного меню Monaco: **Collapse all** / **Expand all**,
  рядом с уже существующими decode/copy/save-действиями (`attachDecodeActions`).
- Регистрируются через `editor.addAction({ contextMenuGroupId, contextMenuOrder, run })` —
  тот же механизм, что у decode-действий. **Без keybinding** (только `contextMenuGroupId`),
  поэтому глобальный last-wins реестр клавиш Monaco не трогается.
- Собственная группа `"1_folding"` — сортируется **выше** clipboard-группы
  (`"9_cutcopypaste*"`), так что Collapse/Expand стоят сверху меню с разделителем под ними.
- **Document-wide**, поэтому без `precondition` — доступны на любом right-click
  (в т.ч. не по строковому значению, где decode/copy скрыты).
- Реализация — чистый `attachFoldActions(editor)` в `foldActions.ts`: дёргает
  встроенные действия Monaco `editor.getAction("editor.foldAll"/"editor.unfoldAll")?.run()`
  через хелперы `foldAll`/`unfoldAll`; возвращает `DisposableLike`, снимающий оба пункта.
- Вешается в `BodyView` response-ветке `onMount` (`live.current.fold = attachFoldActions(...)`),
  диспозится в remount-teardown и unmount-effect (как `decode`). **Нет** моста
  шапка↔тело, нет `forwardRef`/handle/ref-проброса — всё локально в редакторе.
- Без персиста; новый ответ → keyed-ремаунт BodyView → фолды сбрасываются сами.
- На редком >50MB raw-пути фолдинг выключен — пункты безвредно no-op (YAGNI: без гарда).

## Поведение / краевые случаи

- **Контекстное меню** доступно на любой right-click в теле ответа; decode/copy/save —
  только на строковом значении (их `precondition`), Collapse/Expand — всегда.
- **Раскрытие elision-бейджа** растит документ → size-gate пересчитывает minimap.
- **Resize панели** (`onDidLayoutChange`) → size-gate пересчитывает minimap.
- **reduced-motion** — не затрагивается (никакой новой анимации).

## Стратегия тестов (TDD, в стиле текущего сьюта)

- `minimapGate.test.ts` — чистый `shouldShowMinimap`: overflow → true; помещается →
  false; граница/допуск.
- `foldActions.test.ts` — `foldAll`/`unfoldAll` триггерят правильные action-id +
  no-op при отсутствии действия; `attachFoldActions` регистрирует два пункта меню
  (id/label/группа/порядок), их `run` зовёт fold/unfold, `dispose()` снимает оба.
- Регрессия: request-редактор по-прежнему без minimap; Ctrl+Enter→Send жив
  (addCommand-гейт не тронут); существующие decode-действия не сломаны.

## Гейт перед мержем

- `pnpm test` (vitest) — все зелёные, новые тесты включены.
- `tsc` (типы) — чисто.
- `pnpm build` (vite) — собирается.
- Бэкенд не трогался ⇒ `cargo` не нужен; bindings без дрейфа (IPC не менялся).
- Живой проход в WebView2 (`pnpm tauri:dev`): большой ответ → minimap появляется и
  кликом прыгает; маленький → полосы нет; скроллбар шире и постранично; right-click по
  телу → Collapse all / Expand all сворачивают/разворачивают тело (рядом с decode/copy).
