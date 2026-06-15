# Command Palette — быстрый поиск по коллекциям и методам (design)

> **Статус:** 📝 SPEC — дизайн утверждён, реализация не начата.
> **Ветка:** `claude/nervous-swartz-f4def4` (worktree).
> **Бэкенд/IPC/bindings:** не затрагиваются (поиск идёт по уже загруженному
> `cat.tree`). Гейт фичи = `vitest` + `tsc` + `vite build`.
> **План реализации:** будет создан skill'ом `writing-plans` после ревью этой спеки.

## Проблема / цель

Усилить usability за счёт вызываемой палитры быстрого поиска (command palette):

- **Быстрый поиск по коллекциям** с автоподстановкой.
- **Быстрый поиск по методам** (= сохранённым запросам внутри коллекции) с
  автоподстановкой.

Эталонный сценарий пользователя: есть коллекция `edo-attorney-letters` с
сохранённым запросом-методом `Search`. Пользователь вызывает палитру, набирает
`edo` → срабатывает фильтр коллекций, выбирает нужную и жмёт **TAB** → коллекция
становится скоупом; жмёт **`.`** → переход к выбору метода; `s` + **TAB** →
дополняется `edo-attorney-letters.Search`; **Enter** открывает запрос.

## Что уже есть в коде (база для реюза)

- В проекте **был** `CommandPalette` (изначально двухступенчатый `service→method`
  finder, затем переписан под сохранённые запросы), но titlebar-рефайнинг
  2026-06-06 удалил его целиком.
- `src/features/catalog/palette.ts` — **осиротевший рабочий код**: `flattenRequests`
  + `rankRequests` (fuzzy-ранжирование по `name` / `service.method` / `address`),
  с тестами, но не импортируется ни одним живым компонентом.
- `src/features/catalog/fuzzy.ts` — `fuzzyMatch` (subsequence-матчер с бонусами за
  префикс/контиг/word-start; возвращает `indices` для подсветки).
- Глобальные хоткеи — один `window.keydown` в `src/app/WorkflowApp.tsx` (Ctrl/Cmd+S/N/B).
  `Ctrl+K`/`Ctrl+P` свободны.
- Открытие запроса — `openSavedRequest` через `WorkflowApp.openRequest` (с
  discard-guard `guardedRun` + персист активного запроса). Открытие коллекции —
  `setPanelCollectionId` (тот же путь, что у `SidebarShell.onOpenCollection`).
- `cmdk` / shadcn `Command` **не установлены** (ранее доп. зависимость осознанно
  откладывалась — теперь вводится осознанно для этой фичи).

## Утверждённые решения

| # | Решение | Выбор |
|---|---------|-------|
| 1 | Что такое «метод» на 2-м шаге | **Сохранённый запрос** (лист коллекции); открывается в Focus; реюз `palette.ts`/`fuzzy.ts`; reflection не нужен |
| 2 | Модель поиска | **Суперсет**: плоский fuzzy по умолчанию + drill `коллекция → TAB → «.» → метод → TAB` поверх |
| 3 | Хоткей вызова | **`Ctrl/Cmd+K` И `Ctrl/Cmd+P`** — оба открывают одну палитру |
| 4 | Семантика клавиш | **`TAB` = принять/дополнить** (на коллекции авто-«.» → режим методов), **`Enter` = открыть**; «.» работает и вручную |
| 5 | Enter на коллекции без метода | **Открыть Collection Overview** (палитра = и «поиск по коллекциям», и «по методам») |
| 6 | Стратегия сборки | **`cmdk` / shadcn `Command`** (модалка `CommandDialog`) |
| 7 | Пустой ввод в плоском режиме | **Пустой экран + подсказка** «Начните вводить…» (без «недавних») |

## Почему cmdk укладывается (сверка с докой)

- **Вложенные «pages»** — официальный паттерн: стек `pages` в стейте, `Backspace`
  на пустом вводе выталкивает страницу, `Escape` тоже. Это и есть наш
  scope-механизм (scope = «page» из одного уровня), идиоматично.
- **`shouldFilter={false}`** — официально отключает встроенную фильтрацию/сортировку,
  позволяя подсунуть наш собственный ранжированный список → сохраняем `fuzzy.ts`
  и подсветку совпадений.
- **Контролируемый `Command.Input`** (`value`/`onValueChange`) + контролируемый
  `value` на `<Command>` (подсвеченный элемент) → читаем highlighted для TAB.

Кастомным остаётся только: TAB-дополнение, коммит scope по «.», рендер scope-чипа —
аддитивные обработчики `onKeyDown` поверх нативной навигации cmdk (↑/↓/Enter).

Источники: cmdk README (`/dip/cmdk`) — nested pages / `shouldFilter` / controlled
input; shadcn/ui — Command/CommandDialog; паттерны скоупинга — VS Code Quick Open
(`@`/`:`/`>`), Notion scoped palettes, fzf.

## Архитектура и модули

- **Зависимость:** `pnpm add cmdk`.
- **`src/components/ui/command.tsx`** (новый) — стандартная shadcn-обёртка над cmdk:
  `CommandDialog`, `CommandInput`, `CommandList`, `CommandGroup`, `CommandItem`,
  `CommandEmpty`. Должна **пробрасывать** `shouldFilter` / `value` / `onValueChange`
  / `onKeyDown` в корневой `Command`. Строку ввода (под scope-чип) при необходимости
  собираем из cmdk-примитивов напрямую, оставляя shadcn-стиль для списка/элементов.
- **`src/features/catalog/palette.ts`** (расширяем): оставляем `flattenRequests` /
  `rankRequests`; добавляем `CollectionHit` + `rankCollections(query, collections)`
  (через тот же `fuzzy.fuzzyMatch`; пустой query → коллекции по имени). Чисто,
  тестируемо.
- **`src/features/catalog/paletteModel.ts`** (новый, чистый — «сердце»): по входу
  `{ tree, scope, query }` отдаёт результат для рендера и хелперы переходов. Без
  React → исчерпывающее юнит-покрытие. Публичная поверхность (ориентир):
  - `derivePaletteResults({ tree, scope, query, limits })` →
    `{ mode: "flat" | "scoped", collectionHits, requestHits, scopeCollection, overviewItem, truncated }`.
  - `bestCollectionMatch(tree, query, highlightedId)` → коллекция для коммита по «.»
    (подсвеченная, иначе топ-1 ранжирования; `null` если `query` пустой ИЛИ
    совпадений нет — чтобы «.» на пустом вводе не коммитил случайную коллекцию).
  - `completionFor(highlightedItem)` → строка автодополнения для TAB на запросе.
- **`src/features/catalog/CommandPalette.tsx`** (новый, тонкий): cmdk-компонент.
  Props: `{ open, onClose, collections, onOpenRequest, onOpenCollection }`.
  Рендер scope-чипа + инпута + групп; обработчики TAB/«.»/Enter/Backspace; подсветка
  совпавших символов из `fuzzy.indices`.
- **`src/features/catalog/CommandPalette.test.tsx`** (новый) — RTL key-flow тесты.
- **`src/app/WorkflowApp.tsx`** (правка): состояние `paletteOpen`; хоткеи
  `Ctrl/Cmd+K`/`Ctrl/Cmd+P` в существующем `keydown`-эффекте; `cat.reload()` на
  открытии; монтаж `<CommandPalette … />` с колбэками `openRequest` /
  `(id) => setPanelCollectionId(id)`.

## Состояние и поток

Состояние палитры: `{ scope: { id, name } | null, query }`. Рендер:
`<Command value={highlighted} onValueChange={setHighlighted} shouldFilter={false}>` —
список ранжируем сами через `paletteModel`/`palette.ts`.

- **Плоский режим** (`scope === null`):
  - Пустой `query` → пустой экран + подсказка «Начните вводить, чтобы найти
    коллекцию или метод».
  - Непустой `query` → две группы: `COLLECTIONS` (топ-**6** из `rankCollections`,
    показывается только при наличии совпадений) и `REQUESTS` (топ-**8** из
    `rankRequests` по всем коллекциям). При усечении — строка «…ещё N». Подсветка
    совпавших символов. Виртуализация не нужна (десятки коллекций / сотни запросов).
- **Scope-режим** (`scope !== null`):
  - В инпуте слева — чип `[<collection> ›]`.
  - Список = сохранённые запросы этой коллекции (`rankRequests`, отфильтрованные по
    `collectionId`) + синтетическая верхняя строка **«Open <collection> overview»**.

## Семантика клавиш (поверх нативной навигации cmdk ↑/↓/Enter)

- **`TAB`** — принять подсвеченное:
  - коллекция → коммит scope (`scope = {id,name}`, `query = ""`, чип; авто-«.»);
  - запрос → дополнить `query` именем запроса (НЕ открывать; даёт «дополнить, но
    не открывать»). `preventDefault`.
- **`.`** — если `scope === null` и `bestCollectionMatch` ≠ null → коммит этой
  коллекции как scope, «.» не печатается (`preventDefault`). Иначе (нет совпадений
  или уже в scope) — «.» вводится буквально (поиск методов с точкой возможен).
- **`Enter`** — открыть подсвеченное: запрос → `onOpenRequest(collectionId, req)`;
  коллекция или строка overview → `onOpenCollection(collectionId)`. После открытия —
  `onClose()`.
- **`Backspace`** на пустом `query` в scope → снять чип (`scope = null`) — нативный
  pages-паттерн cmdk.
- **`Esc`** → `onClose()` (Radix Dialog).
- Футер-хинт: `⇥ перейти · ↵ открыть · esc`.

## Интеграция (WorkflowApp)

- Хоткеи в существующем `keydown`-эффекте: матч по **физической** клавише
  (`e.code === "KeyK" || e.code === "KeyP"`) — раскладко-независимо, как уже сделано
  для Ctrl+E; + `mod` (`metaKey||ctrlKey`), AltGr-гард (не `altKey`), `!e.repeat`;
  `preventDefault` только при реальном открытии.
- На открытии палитры — `cat.reload()` (дёшево, гарантирует свежий `tree`).
- Открытие запроса переиспользует существующий `openRequest` (discard-guard
  `guardedRun` + персист активного запроса). Открытие коллекции — `setPanelCollectionId`.

## Тесты (TDD)

- **Чистые модули** — исчерпывающие юнит-тесты:
  - `palette.ts`: `rankCollections` (матч по имени, пустой query, ранжирование).
  - `paletteModel.ts`: `derivePaletteResults` (плоский/scope, усечение, overview-item,
    пустой query); `bestCollectionMatch` (подсвеченная vs топ-1 vs null);
    `completionFor`.
- **`CommandPalette.test.tsx`** (RTL): открытие по хоткею; плоский поиск показывает
  обе группы; TAB на коллекции → чип + scope; «.» → scope (символ не введён);
  `s` + TAB дополняет имя запроса; Enter открывает запрос (колбэк с верными
  аргументами); Enter на коллекции/overview → `onOpenCollection`; Backspace на
  пустом вводе снимает чип; Esc вызывает `onClose`.

## Гейт

`pnpm test` (vitest) · `tsc` · `vite build`. Бэкенд не трогаем → `cargo` и
bindings-no-drift не требуются (но `dist/` собирать перед `src-tauri`, если будет
живой прогон — свежий worktree).

## Вне scope (YAGNI)

- Поиск по **gRPC-методам из reflection** (вариант «оба источника») — не делаем;
  только сохранённые запросы.
- «Недавние/частые» в пустом вводе — отложено (пустой экран + подсказка).
- Поиск по содержимому body/метаданным запроса.
- Виртуализация списка.
- Действия-команды (rename/delete/duplicate) внутри палитры — это навигационная
  палитра, не командная.

## Риски / на что смотреть

- **shadcn-обёртка должна пробрасывать `shouldFilter`/`value`/`onKeyDown`** — иначе
  встроенная фильтрация cmdk поборется с нашим ранжированием. Проверить, что
  `shouldFilter={false}` реально отключает фильтр (тест: ввод, не совпадающий с
  value элемента, его не скрывает).
- **Чтение подсвеченного элемента** для TAB/«.» — через контролируемый `value` на
  `<Command>`; убедиться, что `onValueChange` обновляется при ↑/↓ и при смене списка.
- **Конфликт хоткеев**: Monaco биндит Ctrl+Enter (send) и Ctrl+F (find) — Ctrl+K/P
  свободны; проверить, что палитра открывается и при фокусе в Monaco-редакторе
  (capture-фаза, как у zoom/Ctrl+E).
- **discard-guard**: открытие из палитры обязано идти через `guardedRun`
  (несохранённый unbound-черновик не теряется) — реюз `openRequest` это обеспечивает.
