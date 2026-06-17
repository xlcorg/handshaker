# Collapse all / Expand all — кнопки в шапке панели коллекций

**Статус:** 🟡 SPEC — дизайн утверждён, имплементации нет.
**Ветка:** `claude/zealous-swanson-101d5f`
**Дата:** 2026-06-17

## Цель

Дать пользователю две кнопки в шапке панели коллекций: **Collapse all** и
**Expand all**, сворачивающие/разворачивающие **все коллекции верхнего уровня**
одним кликом. Вложенные папки **не трогаются** — сохраняют своё состояние
(осознанный выбор пользователя: «top-level collections only»).

### Предыстория (зачем)

Сейчас раскрытие коллекций — только поштучно (клик по строке/шеврону). При
нескольких коллекциях, чтобы быстро «всё свернуть» и сориентироваться или «всё
развернуть» и поискать запрос, нужно много кликов. Две кнопки в шапке
(рядом с сортировкой и ⋯-меню) — стандартный паттерн файловых деревьев
(VS Code Explorer: «Collapse All»).

## Поведение

- **Две icon-кнопки** в ряду-шапке «Collections» (`SidebarShell`), слева от
  `SortControl`. Порядок слева-направо: **Collapse all, затем Expand all**.
- **Expand all** → открывает строку **каждой коллекции** верхнего уровня.
  Вложенные папки остаются в своём состоянии (что было свёрнуто внутри — таким
  и останется при открытии коллекции).
- **Collapse all** → закрывает строку **каждой коллекции** верхнего уровня
  (всё дерево складывается, т.к. потомки коллекции рендерятся только при открытой
  коллекции).
- **Персист как у ручного тоггла:** состояние `expanded` каждой коллекции
  сохраняется в бэкенд через **существующий** IPC `collection_set_expanded`
  (`itemId = null` → таргетит саму коллекцию). Переживает перезапуск приложения.
  **Бэкенд/IPC/`bindings.ts` не трогаются.**
- **Обе кнопки `disabled`, когда:**
  - активен фильтр (`filterActive`) — при фильтрации дерево и так force-развёрнуто
    (`effectiveOpen = allContainerIds`), кнопки были бы no-op и сбивали бы с толку;
  - нет ни одной коллекции (`collections.length === 0`) — нечего сворачивать.

**Иконки** (lucide, конвенциональная пара):
- Collapse all → `ChevronsDownUp` (шевроны складываются внутрь).
- Expand all → `ChevronsUpDown` (шевроны раскрываются наружу).

## Архитектура

### Контекст: где живёт состояние раскрытия

Истина для рендера — локальный `open: Set<string>` **внутри** `CollectionTree`
(сидируется один раз из персистентных `expanded`-флагов, дальше принадлежит
пользователю). Ручной тоггл обновляет **и** локальный `open`, **и** персист
(`onSetExpanded`). Персистентные флаги на коллекциях нужны только для сида при
следующем старте — они не реактивны к локальному `open`.

Кнопки же логически живут **выше**, в шапке `SidebarShell`. Значит нужно из
шапки дотянуться до локального `open` дерева.

### Мостик: императивный handle через `forwardRef` + `useImperativeHandle`

Вместо подъёма ~80 строк логики `open`/клавиатуры/drag из `CollectionTree` в
`SidebarShell`, `CollectionTree` экспонирует крошечный императивный интерфейс:

```ts
export interface CollectionTreeHandle {
  expandAll(): void;
  collapseAll(): void;
}
```

`CollectionTree` оборачивается в `forwardRef<CollectionTreeHandle, CollectionTreeProps>`
и реализует handle через `useImperativeHandle`. Это законный, узко-ограниченный
интерфейс «императивные команды к view-компоненту».

### `CollectionTree.tsx`

Реализация handle (использует уже существующие в компоненте `collections`-проп,
`setOpen`, `persistExpanded`):

```ts
const collectionIds = useMemo(() => collections.map((c) => c.id), [collections]);

useImperativeHandle(ref, () => ({
  expandAll() {
    setOpen((prev) => new Set([...prev, ...collectionIds]));
    for (const id of collectionIds) props.onSetExpanded(id, null, true);
  },
  collapseAll() {
    setOpen((prev) => {
      const next = new Set(prev);
      for (const id of collectionIds) next.delete(id);
      return next;
    });
    for (const id of collectionIds) props.onSetExpanded(id, null, false);
  },
}), [collectionIds, props.onSetExpanded]);
```

Замечания:
- Только id коллекций — папки не трогаем (scope = top-level).
- `expandAll` **добавляет** коллекции в `open`, не затирая открытые папки/прочее;
  `collapseAll` **удаляет** только id коллекций.
- Персист — цикл `onSetExpanded(id, null, …)` по коллекциям (N = число коллекций,
  обычно единицы). Каждый вызов в `useCatalogTree.setExpanded` берёт свой снимок
  `treeRef`, применяет синхронно и таргетит **разные** коллекции (`setNodeExpanded`
  трогает одну) → компаундятся корректно, откат при ошибке тоже изолирован.

### `SidebarShell.tsx`

- `const treeRef = useRef<CollectionTreeHandle>(null);` — передать в `<CollectionTree ref={treeRef} … />`.
- В ряд-шапку «Collections» (сейчас `SidebarShell.tsx:108–130`), **перед**
  `SortControl`, добавить две кнопки:

```tsx
<Button
  size="icon-sm" variant="ghost" className="size-6"
  aria-label="collapse all"
  disabled={filterActive || visible.length === 0}
  onClick={() => treeRef.current?.collapseAll()}
>
  <ChevronsDownUp className="size-4" />
</Button>
<Button
  size="icon-sm" variant="ghost" className="size-6"
  aria-label="expand all"
  disabled={filterActive || visible.length === 0}
  onClick={() => treeRef.current?.expandAll()}
>
  <ChevronsUpDown className="size-4" />
</Button>
```

`filterActive` и `visible` уже вычисляются в `SidebarShell` (строки 64–65).
Желателен `title`/тултип («Collapse all» / «Expand all») — как у прочих
icon-кнопок шапки.

## Тестирование

**`CollectionTree.test.tsx`** (через ref):
- Смонтировать `CollectionTree` с ≥2 коллекциями (минимум одна с вложенной
  папкой/запросом) и `ref`. Изначально свернуто.
- `ref.current.expandAll()` → в DOM появляются строки потомков **всех** коллекций;
  `onSetExpanded` вызван с `(collectionId, null, true)` для **каждой** коллекции.
- `ref.current.collapseAll()` → строки потомков исчезают; `onSetExpanded` вызван с
  `(collectionId, null, false)` для каждой коллекции.
- (Регрессия scope) `expandAll` **не** зовёт `onSetExpanded` с id папок —
  только id коллекций.

**`SidebarShell.test.tsx`** (интеграционно, без мока ref):
- Кнопки `aria-label="collapse all"` / `"expand all"` отрендерены.
- Клик по «expand all» раскрывает коллекции (появляются дочерние строки в дереве);
  клик по «collapse all» сворачивает.
- Кнопки `disabled`, когда задан фильтр (ввести текст в `collection-filter`) и
  когда коллекций нет.

**Гейт:** `pnpm vitest run` (зелёный), `pnpm tsc`, `pnpm build`. Бэкенд не
трогается — `cargo` не обязателен.

## Затрагиваемые файлы

| Файл | Изменение |
| --- | --- |
| `src/features/catalog/CollectionTree.tsx` | `forwardRef` + `useImperativeHandle` (`expandAll`/`collapseAll`) |
| `src/features/catalog/SidebarShell.tsx` | `treeRef` + две icon-кнопки в шапке «Collections» |
| `src/features/catalog/CollectionTree.test.tsx` | тест handle (expand/collapse all + scope-регрессия) |
| `src/features/catalog/SidebarShell.test.tsx` | тест кнопок (рендер, клик, disabled) |

Бэкенд / IPC / `src/ipc/bindings.ts` — **не трогаем** (переиспользуем
`collection_set_expanded`).

## Риски

| Риск | Митигация |
| --- | --- |
| `forwardRef` ломает существующее использование `CollectionTree` | Единственный потребитель — `SidebarShell`; проп-сигнатура не меняется, добавляется только `ref`. Тесты дерева уже монтируют его — проверят отсутствие регрессии. |
| Цикл `onSetExpanded` гонится сам с собой (оптимистичный апдейт) | Каждый вызов таргетит **разную** коллекцию (`setNodeExpanded` трогает одну); снимок берётся синхронно до await → компаунд корректен. |
| Кнопки кажутся «не работают» при активном фильтре | `disabled` при `filterActive` (дерево и так force-развёрнуто). |
| Рассинхрон локального `open` и персист-флагов | `expandAll`/`collapseAll` обновляют **оба** (как ручной тоггл) — той же дисциплиной, что `toggle`/`expand`/`collapse`. |

## Live-проход (после имплементации)

В WebView2: при ≥2 коллекциях «Collapse all» сворачивает все, «Expand all»
разворачивает все; вложенные папки сохраняют состояние; состояние переживает
перезапуск; при вводе фильтра обе кнопки гаснут; при нуле коллекций — гаснут.
