# Command Palette — richer request rows (design)

> **Статус:** 📝 SPEC — дизайн утверждён, реализация не начата.
> **Ветка:** `claude/beautiful-jones-6d5269` (worktree).
> **Бэкенд/IPC/bindings:** не затрагиваются (рендер по уже загруженному `cat.tree`,
> данные уже есть в `SavedRequestIpc`). Гейт фичи = `vitest` + `tsc` + `vite build`.
> **План реализации:** будет создан skill'ом `writing-plans` после ревью этой спеки.

## Проблема / цель

UX-полиш командной палитры (`Ctrl/Cmd+K` / `Ctrl/Cmd+P`). Сейчас строка результата-
**запроса** показывает только жирное имя + имя коллекции, прижатое вправо (моно). На
один взгляд не видно, **какой именно gRPC-метод** стоит за сохранённым запросом —
особенно когда в нескольких коллекциях лежат запросы с одинаковыми именами
(`Get`, `Search`, `List`).

Цель — добавить под именем вторую строку с полным `service/method`, чтобы каждый
результат нёс реальную gRPC-идентичность. **Только это** — без иконок, превью и новых
источников поиска (эти направления на этапе брейншторма не выбраны).

## Что уже есть в коде (база для реюза)

- `src/features/catalog/CommandPalette.tsx` — тонкий cmdk-компонент; `RowView`
  рендерит три вида строк (`collection` / `request` / `overview`). Сейчас
  request-строка = жирное имя + `collectionName` (моно, справа).
- `src/features/catalog/paletteModel.ts` — чистое ядро `derivePaletteResults`;
  request-строка несёт `indices` (fuzzy-совпадения **только по имени**, через
  `nameIndices(query, request.name)`).
- `src/features/catalog/palette.ts` — `rankRequests` ранжирует по haystack
  `name + service.method + address_template` (через `fuzzy.fuzzyMatch`).
- `Highlighted` (внутри `CommandPalette.tsx`) — рендер строки с подсветкой
  совпавших символов по массиву `indices`.
- Данные строки результата уже в `SavedRequestIpc`: `name`, `service`, `method`,
  `address_template`, `last_used_at`, `use_count` — **новый бэкенд/IPC не нужен**.
- Строки палитры — **все инлайновые**, в `src/lib/messages.ts` их нет (проверено).

## Утверждённые решения

| # | Решение | Выбор |
|---|---------|-------|
| 1 | Направление полиша | **Richer request rows** — только request-строки (не иконки, не affordance выделения, не recents) |
| 2 | Что в подзаголовке | **`service/method`** (всегда конкретен; адрес — нет, часто `{{host}}`) |
| 3 | Раскладка строки | **Вариант A** — две строки: имя (жирное) над `service/method` (моно, muted) |
| 4 | Разделитель в подзаголовке | **`/`** (gRPC-конвенция `package.Service/Method`) |
| 5 | Имя коллекции справа | **Только в плоском режиме**; в scope-режиме скрыто (дублирует scope-чип) |
| 6 | Подсветка совпадений | На **обеих** строках (имя + метод); адрес ранжирует, но не подсвечивается (не показан) |
| 7 | Прочие виды строк | `collection` («⇥ drill in»), `overview`, пустой экран, футер — **без изменений** |

## Архитектура и модули

### `palette.ts` (расширяем)

- Добавить чистый хелпер `methodLabel(request: SavedRequestIpc): string` →
  `` `${request.service}/${request.method}` `` — **единственный источник** строки
  метода, чтобы отображаемый текст и индексы подсветки считались по одной и той же
  строке (haystack ранжирования с точкой `service.method` остаётся как есть —
  поведение ранжирования и «поиск по адресу» не меняются).

### `paletteModel.ts` (правка)

- В `PaletteRow` (вариант `kind: "request"`) добавить поле
  `methodIndices: number[]` — `fuzzyMatch(query, methodLabel(request)).indices`
  (пустой при пустом query / отсутствии совпадения), рядом с уже живущим `indices`
  (по имени). Считается **в обоих** местах сборки request-строк
  (`derivePaletteResults`: плоский режим и scope-режим).
- `indices` (имя), ранжирование, лимиты, overview-строка, `bestCollectionMatch`,
  `completionFor` — **не трогаем**.

### `CommandPalette.tsx` (правка)

- Ветка `request` в `RowView` → двухстрочная раскладка:
  - текстовая колонка `min-w-0` (обрезка вместо переноса): строка 1 — `Highlighted`
    по `request.name` (жирная, `truncate`); строка 2 — `Highlighted` по
    `methodLabel(request)` с `methodIndices` (моно, muted, `truncate`);
  - имя коллекции справа (`ml-auto`, `truncate`) — **только когда `scope === null`**
    (в scope-режиме не рендерится).
- `Highlighted`, `collection`/`overview`-ветки, обработчики клавиш
  (`TAB`/`.`/`Backspace`/`Enter`), футер — без изменений.
- `RowView` нужен `scope` (или флаг `showCollection`), чтобы скрывать правую часть
  в scope-режиме — прокинуть из компонента.

### `messages.ts` (правило ui-strings — фокус-чистка)

Поскольку правим `CommandPalette.tsx`, его user-facing строки централизуем в новый
namespace `palette` (по правилу `.claude/rules/ui-strings.md`):

- плейсхолдеры инпута (плоский / scope: `Search collections and requests…`,
  `Search methods in <name>…`);
- заголовки групп (`Collections`, `Requests`, scope-заголовок `<name> · methods`);
- пустые подсказки (`Start typing…`, `No matches`, `No methods in <name>`);
- проза футера и строки (`drill / complete`, `open`, `close`, `drill in`).

Глифы клавиш (`⇥`, `↵`, `esc`) остаются `<Kbd>`-элементами в компоненте (по правилу).
Состояние-зависимые строки (со `<name>`) — функции в `messages.ts`.

## Состояние и поток

Меняется **только рендер request-строки**. Состояние палитры (`{ scope, query }`),
поток ввода, навигация cmdk (↑/↓/Enter), drill (`collection → TAB → "." → method`),
`Backspace`-выход из scope, открытие запроса/коллекции — **идентичны текущим**.

- **Плоский режим** (`scope === null`): группы `Collections` + `Requests`;
  request-строка двухстрочная, справа имя коллекции.
- **Scope-режим** (`scope !== null`): список методов коллекции; request-строка
  двухстрочная, **без** правого имени коллекции (scope-чип уже показывает её).

## Тесты (TDD)

- **`paletteModel.test.ts`**: request-строка несёт `methodIndices`, посчитанные по
  `service/method` (совпадение по методу → непустые индексы; пустой query → пусто;
  нет совпадения → пусто); проверка и в плоском, и в scope-режиме.
- **`palette.test.ts`**: `methodLabel` формирует `service/method`.
- **`CommandPalette.test.tsx`** (RTL): request-строка рендерит подзаголовок
  `service/method`; подсветка по методу присутствует; в **плоском** режиме видно имя
  коллекции справа, в **scope**-режиме — нет; collection/overview-строки и key-flow
  (`TAB`/`.`/Enter/Backspace/Esc) не регрессируют.

## Гейт

`pnpm test` (vitest) · `tsc` · `vite build`. Бэкенд не трогаем → `cargo` и
bindings-no-drift не требуются (свежий worktree: `pnpm install` + сборка `dist/`
перед любым живым прогоном).

## Вне scope (YAGNI / не выбрано на брейншторме)

- Иконки строк (per-row icons / `GrpcIcon`).
- Строка адреса в подзаголовке (вариант C) и folder-path брэдкрамб.
- Индикатор стриминга (требует reflection — другого источника).
- Recents/frequently-used на пустом вводе (есть `last_used_at`/`use_count`, но
  направление не выбрано).
- Action-команды (rename/delete/run) — палитра остаётся навигационной.
- Affordance выделенной строки (accent-бар, инлайн-↵).

## Риски / на что смотреть

- **Подсветка ↔ отображаемая строка**: индексы `methodIndices` обязаны считаться по
  той же строке `methodLabel(request)`, что и рендерится (slash, не dot) — иначе
  подсветка съедет. Поэтому единый хелпер `methodLabel`.
- **Обрезка, не перенос**: двухстрочная раскладка требует `min-w-0` на колонке и
  `truncate` на обеих строках, иначе длинный `service/method` сломает строку или
  вытолкнет правое имя коллекции.
- **Высота строки** выросла (~30px → ~40px): список (`CommandList`) скроллится,
  лимиты (`collections: 6`, `requests: 8`) оставляем — переполнение обрабатывается
  скроллом.
- **scope-режим**: не забыть прокинуть `scope`/флаг в `RowView`, иначе правое имя
  коллекции останется и в scope (регрессия чистоты).
