# Типизированные тосты для оптимистичных операций с коллекцией — дизайн

**Статус:** черновик, ожидает ревью · **Дата:** 2026-06-06 ·
**Ветка:** redesign/workflow-ui-spec-plans

## 1. Проблема и цель

Оптимистичные операции с библиотекой коллекций (создать/переименовать/удалить/
сохранить реквест и т.д.) применяют локальное изменение немедленно, затем зовут
IPC и **откатывают снапшот при отказе** ([useCatalogTree.ts:97](../../../src/features/catalog/useCatalogTree.ts)).
Сейчас:

- **Успех** — молчит (изменение уже на экране).
- **Отказ** — откат + `setError(...)`, отрисовка постоянным красным баннером внизу
  сайдбара ([SidebarShell.tsx:128](../../../src/features/catalog/SidebarShell.tsx)).

Баннер плохо подходит для транзиентного фидбэка: он висит до следующей операции,
а при молчаливом откате пользователь видит, как его изменение «исчезло», без
объяснения. Цель — показывать **результат каждой операции всплывающим тостом**:
успех (иконка-галка) и ошибку (красный, с откатом).

### Не входит в объём (YAGNI)

- Действия в тосте (кнопки «Повторить»/«Отменить»).
- Анимация стекинга/входа уровня sonner.
- Миграция на внешнюю toast-библиотеку (sonner). Текущая кастомная реализация
  остаётся — требуется только добавить **типы**, что тривиально на 35-строчном
  компоненте и не оправдывает новую зависимость + Radix.

## 2. Архитектура

Три точки изменений + удаление баннера. Существующий внешний store на
`useSyncExternalStore` сохраняется как есть (позволяет звать `toast()` из любого
кода, включая не-React IPC-слой).

### 2.1 Модель и API — `src/lib/toast.ts`

```ts
export type ToastType = "success" | "error" | "info";

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

/** Show a transient toast; returns its id. */
export function toast(message: string, type: ToastType = "info"): string;
```

Дефолт `type = "info"` сохраняет обратную совместимость: однопараметрические вызовы
`toast(msg)` остаются валидными. **Уточнение:** в рамках этой работы вызов ошибки
clipboard обновляется до `toast("Couldn't copy", "error")` — это и есть «тост-ошибка»
из спека unified-body-view (§5). Все тосты приложения переведены на английский
(`"Copied"` / `"Couldn't copy"` и каталог §3).

Store (`getState`/`subscribe`/`dismiss`/`reset`/`emit`) и иммутабельная замена
массива — без изменений.

### 2.2 Рендер — `src/components/ui/toaster.tsx`

`ToastRow` выбирает классы и иконку по `type`. Иконки — `lucide-react` (уже в
зависимостях проекта):

| type | классы pill | иконка |
|---|---|---|
| `info` | `bg-foreground text-background` (как сейчас) | нет |
| `success` | `bg-foreground text-background` (как `info`) | `Check` |
| `error` | `bg-destructive text-destructive-foreground` | `CircleAlert` |

Различение успеха и инфо — только иконкой `Check`. **Зелёного нет намеренно:** в
теме ([globals.css](../../../src/styles/globals.css)) есть только токен
`destructive`; вводить `--success` ради мелочи — против YAGNI и консистентности.
`error` использует существующий `destructive`.

Контейнер и таймер авто-дисмисса (`TOAST_MS = 1800`) — без изменений.
`aria-live`: контейнер остаётся `polite`; для `error`-строки роль поднимается —
строка получает собственный `role="alert"` (assertive-семантика), чтобы скринридер
не проглатывал сообщение об отказе.

### 2.3 Точка внедрения — `src/features/catalog/useCatalogTree.ts`

`optimistic()` получает третий аргумент с подписями. `err` обязателен; `ok`
опционален — отсутствие `ok` подавляет success-тост (для шумных операций, см. §4):

```ts
const optimistic = useCallback(
  async (
    next: (prev: CollectionIpc[]) => CollectionIpc[],
    call: () => Promise<unknown>,
    labels: { ok?: string; err: string },
  ) => {
    const snapshot = treeRef.current;
    apply(next(snapshot));
    try {
      await call();
      if (labels.ok) toast(labels.ok, "success");
    } catch (e) {
      apply(snapshot);
      toast(labels.err, "error");
      throw e;
    }
  },
  [apply],
);
```

`setError`/`error` удаляются из состояния и из возвращаемого объекта хука.
`reload` (initial-load) и `duplicateItem` (идут не через `optimistic`) тостят
ошибку напрямую через `toast(errMsg(e), "error")`.

### 2.4 Удаление баннера — `src/features/catalog/SidebarShell.tsx`

Блок `{cat.error ? (...) : null}` ([:128](../../../src/features/catalog/SidebarShell.tsx))
удаляется вместе со ссылкой на `cat.error`.

## 3. Каталог сообщений

Каждый call-сайт передаёт свою пару. `ok` опускается там, где успех визуально
очевиден и операция может идти пачкой (DnD, пин) — чтобы не спамить тостами.

| Операция | `ok` | `err` |
|---|---|---|
| `createCollection` | "Collection created" | "Couldn't create collection" |
| `deleteCollection` | "Collection deleted" | "Couldn't delete collection" |
| `renameCollection` | "Collection renamed" | "Couldn't rename collection" |
| `setPinned` | — (опущен) | "Couldn't update pin" |
| `addItem` | "Request added" | "Couldn't add request" |
| `renameItem` | "Request renamed" | "Couldn't rename request" |
| `updateItemContent` | "Saved" | "Couldn't save" |
| `deleteItem` | "Request deleted" | "Couldn't delete request" |
| `duplicateItem` | "Request duplicated" | "Couldn't duplicate request" |
| `moveItem` | — (опущен) | "Couldn't move" |
| `moveItemAcross` | — (опущен) | "Couldn't move" |
| `reload` | — | `errMsg(e)` (как сейчас) |

Тексты UI — на английском (тосты приложения англоязычны; остальной UI пока на
русском). `errMsg(e)` — динамическое сообщение бэкенда.

## 4. Обработка ошибок и пределы

- **Откат:** при reject снапшот восстанавливается **до** показа тоста — порядок
  как сейчас, тост лишь заменяет `setError`.
- **Шум на DnD/пине:** success подавляется опусканием `ok`. Ошибка показывается
  всегда (это важный сигнал об откате).
- **Reload-ошибка теперь транзиентна.** Осознанный трейд-офф решения «заменить
  баннер тостом»: если список коллекций не загрузился, сайдбар покажет пустое/
  неизменённое дерево, а единственным следом ошибки будет тост на 1800 мс.
  Постоянного индикатора «загрузка не удалась» больше нет. Приемлемо для текущего
  объёма; при необходимости позже вернуть инлайн empty-error-state в дерево.
- **Дедуп/лимит очереди** — вне объёма (как и было).

## 5. Тестирование

- `src/lib/toast.test.ts` — `toast(msg)` даёт `type:"info"`; `toast(msg,"error")`
  даёт `type:"error"`; иммутабельность массива сохранена.
- `src/components/ui/toaster.test.tsx` — по `type` применяются ожидаемые классы и
  иконка; `error`-строка имеет `role="alert"`.
- `src/features/catalog/useCatalogTree.test.ts` — успех с заданным `ok` зовёт
  `toast(ok,"success")`; успех без `ok` не зовёт тост; reject зовёт
  `toast(err,"error")` **и** откатывает снапшот; `error` больше не в API хука.
- `src/lib/clipboard.ts` — обновлённый вызов ошибки покрыт существующим тестом
  (проверить, что не сломался).

## 6. Затронутые файлы

- `src/lib/toast.ts` — тип + сигнатура.
- `src/components/ui/toaster.tsx` — рендер по типу + иконки.
- `src/features/catalog/useCatalogTree.ts` — `labels`-аргумент, тосты, удаление
  `error`-state, прямые тосты в `reload`/`duplicateItem`.
- `src/features/catalog/SidebarShell.tsx` — удаление баннера.
- `src/lib/clipboard.ts` — `"error"`-тип для ошибки.
- Тесты перечисленных модулей.
