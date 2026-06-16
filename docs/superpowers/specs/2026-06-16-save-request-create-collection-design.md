# Save request — создание коллекции из диалога

**Статус:** 📐 SPEC (одобрен дизайн, ожидает план) · 2026-06-16
**Объём:** чистый фронт, один компонент + его тест. Бэкенд / IPC / bindings не трогаем.

## Проблема

В диалоге **Save request** ([`src/features/catalog/SaveRequestDialog.tsx`](../../../src/features/catalog/SaveRequestDialog.tsx))
нельзя создать **новую коллекцию**, если хотя бы одна коллекция уже существует.

Корень:

```js
// SaveRequestDialog.tsx
const newLabel = !target
  ? "＋ New collection"
  : `＋ New folder in "${selectedNodeName}"`;
```

и при открытии диалога `target` авто-ставится на первую коллекцию:

```js
setTarget(collections.length > 0 ? { collectionId: collections[0].id, parentId: null } : null);
```

⇒ как только есть ≥1 коллекция, `target` всегда непустой, и единственная доступная
affordance — «＋ New folder in …». Снять выделение в `CollectionPicker` нельзя (клик
всегда выбирает узел), так что «＋ New collection» недостижима.

Проводка для создания уже готова: `onCreateCollection` проброшен из `WorkflowApp`
(`cat.createCollection`), а `commitNew` умеет создавать pending-коллекцию. Это чисто
UX-щель: affordance не показывается.

## Решение

Под деревом-пикером — **две affordance** вместо одной:

- **「＋ New collection」** — видна всегда.
- **「＋ New folder in "X"」** — видна только когда выбран `target` (есть куда класть папку).

Клик по любой раскрывает тот же инлайн-ввод имени, что и сейчас.

### Изменения в состоянии

Заменить неявную «что создаём» (выводилось из `!target`) на явное состояние:

```ts
type AddingKind = "collection" | "folder";
const [addingKind, setAddingKind] = useState<AddingKind | null>(null);
```

- 「New collection」 → `setAddingKind("collection")`, открыть инлайн-ввод.
- 「New folder in X」 → `setAddingKind("folder")`, открыть инлайн-ввод.

`commitNew` ветвится по `addingKind` (а **не** по `!target`):

- `"collection"` → добавить `PendingCollection`, `target` → её корень
  (`{ collectionId: tempId, parentId: null }`).
- `"folder"` → добавить `PendingFolder` под текущим `target`
  (как сейчас: `{ collectionId: target.collectionId, parentId: target.parentId }`).

Существующий стейт `adding` (открыт ли инлайн-ввод) можно сохранить или вывести из
`addingKind !== null` — деталь реализации, на усмотрение плана.

### Граничные случаи

- **Коллекций нет вообще** (`!target`): показываем только 「New collection」;
  「New folder」 скрыта (класть папку некуда). После создания pending-коллекции
  `target` становится непустым и folder-ссылка появляется.
- **Reco-чип** («✨ Рекомендуем сохранить как…») и `applyReco` — не трогаем. Он уже
  корректно создаёт коллекцию + папку на пустом дереве и переиспользует существующую
  одноимённую папку на непустом.
- `originBound` (запрос уже принадлежит коллекции — показывается только поле Name) —
  не затронут: весь блок пикера под `!originBound`.

### Что НЕ делаем (YAGNI)

- Мини-меню «＋ New…» с выбором collection/folder.
- Postman-строку «New collection» внутри дерева-пикера (синтетический узел в `treeNav`).
- Любые правки `CollectionPicker` / `treeNav` / `savePicker`.
- Бэкенд / IPC / bindings.

## Тесты (TDD, red→green)

В [`SaveRequestDialog.test.tsx`](../../../src/features/catalog/SaveRequestDialog.test.tsx):

1. **(red)** При ≥1 существующей коллекции в открытом диалоге видна 「＋ New collection」.
2. Клик 「New collection」 → ввод имени → Add → pending-коллекция выбрана как `target`;
   Save зовёт `onCreateCollection(name)` (а затем `onSave` с её id).
3. **(регрессия)** 「New folder」 по-прежнему создаёт папку под выбранным узлом
   (`onCreateFolder` зовётся с правильными collection/parent).
4. Без коллекций 「New folder」 не показывается, 「New collection」 показывается.

## Гейт

`vitest` · `tsc` · `vite build`. Бэкенд не затронут — `cargo`/bindings прогонять не нужно.
