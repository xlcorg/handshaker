# Умное авто-переименование сохранённого запроса при смене метода

**Статус:** 🎉 DONE 2026-06-30 (rebase+ff в `main` `08e1ed3`; live-verified в WebView2) ·
план+спека в `archive/`. Реализация — чистый фронт (3 TDD-задачи, subagent-driven).

## Проблема

У сохранённого запроса `name` сейчас **полностью независим** от его `service`/`method`.
При создании (быстрый «＋» или диалог Save) дефолтное имя = короткое имя метода
(`suggestSaveTarget` → `requestName: method.trim()` в `grouping.ts`; диалог Save —
`defaultName={draftMethod}` в `WorkflowApp.tsx`). Но когда пользователь открывает
сохранённый запрос и меняет метод через MethodPicker, автосейв
(`useAutosaveDraft` → `save.ts:autosaveDraft` → `updateItemContent` →
`replaceItemInTree`) сохраняет новые `service`/`method`/тело/auth, но **намеренно
сохраняет старое `name`** (`treeEdit.ts:replaceItemInTree` обновляет все поля, кроме
`name`).

Итог: запрос, созданный под метод `Create` (имя «Create»), после смены метода на
`Delete` остаётся с именем «Create» в дереве коллекций и в брэдкрамбе Focus —
устаревший, вводящий в заблуждение ярлык.

## Ресёрч (UX best practices)

- **Выделенные API-клиенты (Postman / Insomnia / Bruno)** — имя запроса полностью
  независимо от метода/URL: задаётся вручную, дефолт вроде «New Request» / через Save As.
  Авто-имя из URL/метода пользователи постоянно *просят* (т.е. полностью ручной подход
  даёт трение), но это не дефолт. Источники: Insomnia
  [discussion #4166](https://github.com/Kong/insomnia/discussions/4166),
  [issue #1628](https://github.com/Kong/insomnia/issues/1628); Bruno
  [#1858](https://github.com/usebruno/bruno/discussions/1858);
  [Postman gRPC docs](https://learning.postman.com/docs/sending-requests/grpc/grpc-request-interface).
- **Kreya (ближайший аналог — desktop gRPC, «операция = метод сервиса»)** — имя операции
  тоже отдельное: сначала «choose a descriptive name … hit enter», метод выбираешь потом
  в хедере; за методом имя не следует. Источник:
  [Kreya docs](https://kreya.app/docs/operations/grpc/).
- **Канонический «умный» паттерн — авто-имя, пока пользователь не переименовал** —
  официально реализован в Figma флагом `autoRename` на текстовом слое: имя следует за
  содержимым, пока ты вручную не переименуешь (тогда `autoRename=false`, авто-следование
  выключается); очистишь имя — включается снова. Источники:
  [Figma plugin docs — `name`](https://www.figma.com/plugin-docs/api/properties/nodes-name/),
  [Figma forum](https://forum.figma.com/t/how-to-autorename-text-layer-according-to-text-inside/31579).

**Вывод:** индустриальная «золотая середина» — авто-следование, пока имя не
персонализировано. У нас оно ложится особенно естественно, потому что дефолтное имя
уже = имя метода, а в коде уже есть ровно такой идиом — `isPristineBody`
(«это всё ещё нетронутый скелет?» в `actions.ts`).

## Решение — подход A (Figma-стиль, без нового поля в модели)

Воспроизводим Figma `autoRename` **без** persistent-флага, через чистый stateless-предикат
(зеркало `isPristineBody`): «имя считается авто-выведенным, если оно совпадает с именем,
которое мы бы сгенерировали для текущего метода».

### Правило поведения

Когда у **origin-bound** (сохранённого) запроса меняется метод через MethodPicker:

1. Если текущее имя запроса всё ещё «авто-выведенное» — совпадает с авто-именем
   **старого** метода — переименовать его в авто-имя **нового** метода.
2. Если имя кастомное (пользователь его трогал) — не менять ничего.
3. Для **несохранённого** черновика — no-op (имя ещё не существует; выбирается при Save).

«Авто-имя» — через единственный источник правды `suggestSaveTarget(service, method).requestName`
(сейчас `method.trim()`):

```ts
isAutoName(name, service, method) === (name === suggestSaveTarget(service, method).requestName)
```

### Компоненты и проводка

- **Чистое ядро** — новая функция `isAutoName(name, service, method): boolean` в
  `src/features/catalog/grouping.ts`, рядом с `suggestSaveTarget` (тот же модуль —
  определение «авто-имени» в одном месте). Полностью юнит-тестируемая, без побочек.
- **Точка проводки — `FocusView`** (там доступны `origin`, `renameItem` из `useCatalog`,
  и дерево каталога с текущим именем запроса). `CallPanel` получает новый необязательный
  колбэк `onMethodSelected?(prev: {service, method}, next: {service, method})`, который
  срабатывает **после** `applyMethodSelection`. `FocusView` его реализует:
  - читает текущее имя сохранённого запроса из дерева по `origin.requestId`;
  - проверяет `isAutoName(name, prev.service, prev.method)`;
  - если да — зовёт `renameItem(origin.collectionId, origin.requestId,
    suggestSaveTarget(next.service, next.method).requestName)`.
- `applyMethodSelection` остаётся **чистой** (только патчит draft через `onPatch`) —
  вся каталожная логика живёт в `FocusView`.
- Имя в дереве коллекций и в брэдкрамбе Focus обновятся сами — они рендерятся живьём
  из каталога (`draftBreadcrumb` → `pathNamesToItem`).

### Краевые случаи и НЕ-цели

- **Папку не трогаем.** `suggestSaveTarget` выводит из сервиса ещё и имя папки, но
  перемещать запрос по дереву при смене метода — слишком неожиданно и вне жалобы.
  Скоуп строго = **имя запроса**. (Явная не-цель.)
- **Краевой случай:** если пользователь вручную назвал запрос ровно как метод
  (`Create`), смена метода всё равно переименует. Принято как безобидный компромисс
  (имя и так совпадало с методом) — плата за отсутствие persistent-флага.
- **Гонка с автосейвом** (известный интеграционный риск): автосейв контента
  (`updateItemContent`) намеренно сохраняет имя через `replaceItemInTree`, а `renameItem` —
  отдельная мутация. Rename проводится через тот же `useCatalogTree`-хук (общий `treeRef` —
  единый источник истины), и порядок «rename обновляет `treeRef` → последующий debounced
  upsert контента читает уже новое имя» не должен затирать новое имя старым. Точную
  последовательность фиксирует TDD в плане (тест на «после авто-rename последующий
  автосейв не возвращает старое имя»).
- Пустой новый метод невозможен (MethodPicker всегда выбирает конкретный метод).

### Бэкенд

Не трогается. Чистый фронт: переименование идёт по существующему IPC
`collection_rename_item` (через `useCatalogTree.renameItem`). Core / IPC / bindings без
изменений и без дрейфа.

## Тестирование (TDD)

- Юнит `isAutoName` (`grouping.test.ts`): совпадение / несовпадение / trim / кастомное имя.
- Интеграция `FocusView` (`FocusView.test.tsx`):
  - (a) origin-bound + авто-имя → метод сменён → `renameItem` вызван с авто-именем нового метода;
  - (b) origin-bound + кастомное имя → `renameItem` НЕ вызван;
  - (c) несохранённый черновик → no-op (никаких каталожных вызовов);
  - (d) папка не двигается (никакого `moveItem`).
- Гейт проекта: vitest · `tsc -b` · `vite build` — зелёные.

## Остаток после реализации

- Живой проход в WebView2: открыть сохранённый запрос с авто-именем → сменить метод →
  имя в дереве + брэдкрамбе обновилось; переименовать вручную → сменить метод → имя
  осталось кастомным; папка не сдвинулась.
