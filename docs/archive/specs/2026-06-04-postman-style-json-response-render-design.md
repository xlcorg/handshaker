# Postman-style JSON response rendering (Plan #4b)

**Дата:** 2026-06-04
**Статус:** дизайн (одобрен, ожидает плана реализации)
**Тип:** правка слоя рендеринга кастомного JSON-вьюера ответа (фронтенд)
**Ветка:** `redesign/workflow-ui-spec-plans`

## 1. Контекст и проблема

Plan #4 построил кастомный вьюер ответа как **дерево-аутлайн**: одна строка на узел,
контейнеры показывают счётчик `{N}` / `[N]`, нет структурных скобок, кавычек у ключей,
запятых и закрывающих строк. На практике это «не читается как JSON» — пользователь
(сверяясь с Postman) ожидает увидеть **настоящий JSON**.

**Цель:** рендерить ответ как настоящий, сворачиваемый, подсвеченный JSON с нумерацией
строк — «как в Postman», **сохранив** все фичи Plan #4:
- дабл-клик-копирование значения по правилам §6 спеки (строка без кавычек, скаляр как
  есть, контейнер — компактный JSON) + тост;
- внутренний поиск Ctrl+F (подсветка + next/prev + автоскролл);
- виртуализацию строк;
- мягкую деградацию больших ответов + «скачать»;
- Postman-style рендер gRPC-ошибок (`ErrorView`).

## 2. Подход (одобрен)

Переиспользуем разобранное дерево узлов (`parseJsonTree` из Plan #4) и оркестровку
(`ResponseBody`), меняем **только** слой превращения дерева в строки и рендер строки.
Подход A из обсуждения: переделать вьюер под JSON-синтаксис; альтернатива (read-only
Monaco) отклонена — она выкинула бы дабл-клик-копирование и бо́льшую часть Plan #4.

## 3. Модель строк — `src/features/response/json/jsonLines.ts` (чистая, без React)

```ts
export type JsonLineKind = "leaf" | "open" | "close" | "folded";

export interface JsonLine {
  nodeId: string;        // узел дерева, к которому относится строка
  kind: JsonLineKind;
  depth: number;         // уровень отступа (= node.depth; close-строка на depth узла)
  trailingComma: boolean; // нужна ли «,» в конце строки
}

export function flattenLines(tree: JsonTree, collapsed: ReadonlySet<string>): JsonLine[];
```

Правила (DFS от корня):
- **развёрнутый непустой контейнер** → строка `open` (`trailingComma:false`), затем строки
  всех детей, затем строка `close` (`trailingComma = !isLastChildOfParent(node)`);
- **свёрнутый непустой контейнер** → одна строка `folded`
  (`trailingComma = !isLastChildOfParent(node)`); детей не эмитим;
- **пустой контейнер** (`childCount === 0`) → одна строка `leaf`
  (`trailingComma = !isLast`); рендерится как `{}` / `[]`, без каретки;
- **скаляр** → одна строка `leaf` (`trailingComma = !isLast`);
- **корень** → `isLastChildOfParent` = true (нет родителя), значит `trailingComma:false`.

«isLastChildOfParent(node)»: `parentId == null` → true; иначе `node` — последний в
`parent.childIds`.

Для error-дерева (`tree.rootId == null`) → `[]`.

`flattenVisible` (Plan #4) выводится из использования — заменяется на `flattenLines`.

## 4. Рендер строки — `src/features/response/json/JsonLineView.tsx` (заменяет `JsonRowView`)

Пропсы: `{ line: JsonLine, node: JsonNode, lineNumber: number, collapsed: boolean,
isMatch: boolean, isActiveMatch: boolean, onToggle(id), onCopy(node) }`.

Раскладка одной строки:
- **жёлоб с номером строки** (`lineNumber`, выравнивание `tabular-nums`, приглушённый);
- **каретка fold** — только на `open`/`folded` строках непустых контейнеров
  (`▾` для open, `▸` для folded); `aria-label="toggle-node"`, `stopPropagation`;
- отступ `paddingLeft = base + depth * INDENT`;
- содержимое по `kind`:
  - `leaf` с ключом: `"key": <литерал><,?>`
  - `leaf` без ключа (элемент массива/корень-скаляр): `<литерал><,?>`
  - `open` с ключом: `"key": {`  (или `[`)
  - `open` без ключа (корень/элемент массива): `{` (или `[`)
  - `folded` с ключом: `"key": { … }<,?>` (или `[ … ]`)
  - `folded` без ключа: `{ … }<,?>` (или `[ … ]`)
  - `close`: `}<,?>` (или `]`)
  - пустой контейнер (`leaf`-kind, container node): как `<key?>{}<,?>` / `[]`;
- **JSON-литерал значения** (для скалярных листьев): строка в кавычках (`tok-str`),
  число (`tok-num`), bool (`tok-bool`), `null` (`tok-punct`);
- **ключ в кавычках** (`tok-key`), двоеточие/запятые/скобки/`…` — `tok-punct`;
- **дабл-клик** по строке → `onCopy(node)` (копирование по §6: строка без кавычек,
  скаляр как есть, контейнер — компактный JSON всего поддерева) + тост; `title` =
  полное значение (`copyTextForNode(node)`); ховер-подсветка строки;
- подсветка `isMatch` / `isActiveMatch`.

`copyValue.copyTextForNode` (правила копирования) — **без изменений**. Из `copyValue`
для рендера литерала используем выделенный хелпер `valueLiteral(node)` (строка в
кавычках / число / bool / null) — это текущая `valuePreview` без ветки контейнеров;
контейнерные превью (`{N}`) больше не нужны (заменены настоящими скобками/`…`).
Усечение длинных строк в превью сохраняем (полное значение — по дабл-клику/`title`).

## 5. Контейнер — `src/features/response/json/JsonTreeView.tsx`

- строит `const lines = flattenLines(tree, collapsed)`;
- виртуализирует `lines` (`@tanstack/react-virtual`, фикс-высота строки);
- рендерит `JsonLineView` с `lineNumber = index + 1`;
- `onToggle(id)` переключает `collapsed` (в `ResponseBody`, без изменений);
- **автоскролл к активному матчу**: узел → индекс его **первой** строки в `lines`
  (`lines.findIndex(l => l.nodeId === scrollToId)`); зависимости эффекта
  `[scrollToId, lines.length]` (правка из финального ревью Plan #4 сохраняется);
- `role="tree"` на контейнере остаётся (тесты `ResponsePanel`/`ResponseBody` это
  проверяют). Жёлоб номеров строк — часть каждой строки (а не отдельная колонка),
  чтобы не ломать виртуализацию.

## 6. Что не трогаем

`parseJsonTree` и тип `JsonNode`; `copyValue.copyTextForNode`; `jsonSearch`
(`findMatches`/`ancestorsToExpand` — матчинг по узлам, подсветка маппится на строки
узла); `degrade`/`download`; оркестровку `ResponseBody` (collapse-set, search-state,
Ctrl+F, degrade/download, copy-all); `ErrorView`; `toast`/`clipboard`;
`JsonSearchBar`. Удаляются `JsonRowView.tsx` (+тест) и `flattenVisible` —
заменяются на `JsonLineView` / `flattenLines`.

## 7. Тестирование (TDD)

**Чистые тесты `jsonLines.test.ts`:**
- развёрнутый объект → `open` … дети … `close`;
- запятая у `close`/листа, только если узел не последний у родителя; у последнего — нет;
- свёрнутый контейнер → ровно одна `folded`-строка, дети скрыты;
- пустой объект/массив → одна строка, без `close`-строки и без каретки;
- корневой скаляр / корневой массив — без ключа, без запятой у корня;
- error-дерево → `[]`.

**Компонентные `JsonLineView.test.tsx`:**
- ключ рендерится в кавычках (`"name"`, не `name`);
- запятая присутствует/отсутствует по `trailingComma`;
- каретка на `open`/`folded`, клик → `onToggle(node.id)`, без `onCopy`;
- дабл-клик по строке → `onCopy(node)`;
- номер строки виден.

**Компонентные `JsonTreeView.test.tsx`** (мок `@tanstack/react-virtual`, как в Plan #4):
- рендерит строку на каждую видимую `JsonLine`, включая `close`-строки;
- сворачивание контейнера скрывает и детей, и его `close`-строку;
- номера строк идут по порядку.

**Регрессия:** обновить `ResponseBody.test.tsx` / `ResponsePanel.test.tsx` под новый
рендер (по-прежнему `role="tree"`; значения видны как `"echo"`; поиск даёт `1/2`).

Полный гейт: `pnpm exec vitest run`, `pnpm lint` (tsc -b), `pnpm build`.

## 8. Вне области

- Переключатель Tree/JSON (отклонён — выбран единый JSON-вид).
- Read-only Monaco для ответа (отклонён).
- Изменение правил копирования §6 (остаются как в Plan #4).
- Сворачивание на уровне произвольных диапазонов строк (фолдим по узлам контейнеров).

## 9. Риски / заметки

- **Корректность запятых** — самая хрупкая часть; покрывается чистыми тестами
  `flattenLines` (последний/не-последний, вложенность, пустые контейнеры).
- **Номера строк** — включены (как в Postman); при желании легко убрать (один проп).
- Свёрнутый узел показываем как `"key": { … }` (одобрено).
- Дерево узлов и `flattenLines` рекурсивны — защита от переполнения стека на
  сверхглубоком JSON уже есть в `parseJsonTree` (try/catch из Plan #4); `flattenLines`
  на свежем дереве не упадёт глубже, чем уже разобранное дерево.
