# Рефакторинг коллекции сервисов: Postman-style библиотека реквестов

**Дата:** 2026-06-05
**Статус:** дизайн (ожидает ревью пользователя → плана реализации)
**Тип:** замена каталог-сайдбара редизайна на персистентную Postman-style библиотеку реквестов поверх существующего `CollectionIpc`-бэкенда (с точечными правками бэкенда), + связанные правки workflow-модели (фронтенд + Rust)
**Ветка:** `redesign/workflow-ui-spec-plans`

> Этот спек **суперседит** части каталог-фичи, построенной планами #1–#5
> (`CatalogService`, curated-методы, `ServicePanel`, `ServiceAuthEditor`,
> `AddServiceForm`, in-memory `catalogStore`). Reflection остаётся как
> **персистентный кэш контракта по адресу**, а не как управляемая сущность-хост.

---

## 1. Контекст и проблема

Живой shell редизайна — `src/app/WorkflowApp.tsx` — рендерит каталог-сайдбар
`src/features/catalog/Sidebar.tsx`. Текущая модель: дерево **выводится** из
reflection-контракта + плоского списка `curated[]` (`CatalogService`,
in-memory `catalogStore`). Пользователь дерево не редактирует.

Боли (со слов пользователя):

1. **Дублирование секций** — «★ Избранные» и «Коллекция» рендерят одни и те же
   сервисы дважды.
2. **Нет пользовательской организации** — структура жёстко выводится из
   reflection; нельзя создать папки, перенести методы, держать методы разных
   хостов рядом (как в Postman).
3. **Ховер-действия вместо контекстного меню** — нет rename/duplicate/delete и т.п.
4. **`Sidebar.tsx` смешивает** дерево/секции/форму/состояние; добавление сервиса
   через сайдбар неудобно.

**Цель:** заменить выводимое дерево на **персистентную пользователь-редактируемую
Postman-style библиотеку**: несколько именованных коллекций → папки → сохранённые
реквесты (листья). Лист = сохранённый вызов (тело/metadata/auth/адрес). Создание —
request-first (как в Postman): новый реквест → указать хост → reflection → выбрать
метод → Send → Save в любую коллекцию.

## 2. Подход (одобрен — вариант D)

База — существующий **персистентный** бэкенд коллекций (`CollectionIpc` +
`FileCollectionStore`, верифицировано: `crates/.../collections/file_store.rs`,
тест `collections_persistence.rs`). Где форма бэкенда не подходит под типы
редизайна — **меняем/расширяем бэкенд**, а не строим lossy-адаптер. Фронт нового
сайдбара пишем под типы редизайна, переиспользуя проверенные **паттерны** из
легаси `src/features/collections/tree/` (контекстное меню, expand/collapse,
filter, reveal-active). Альтернативы B (дерево рядом с `CatalogService`) и C
(новый бэкенд) отклонены: B даёт дублирование моделей, C переписывает
протестированный персист-стор без выгоды.

## 3. Целевая модель: Focus / Workflow / Sidebar

- **Focus = редактор одного pending-draft** (host/method/body/metadata/auth) —
  и для новых реквестов, и для открытых сохранённых. Это «активный draft».
- **Send** исполняет вызов и **дописывает выполненный шаг в активный workflow**
  (леджер/список = история выполненных). Pending-draft в историю не попадает,
  пока не выполнен. Draft **остаётся** в Focus после Send.
- **Sidebar коллекций = персистентная библиотека сохранённых реквестов.** Клик по
  реквесту → грузим в Focus (draft). Save → кладём draft в коллекцию.
- **Один глобальный pending-draft** (табов нет). Send пишет шаг в активный
  workflow (если воркфлоу нет — создаётся).
- Разделение draft (pending) и executed-step — **в скоупе** этой задачи (правка
  workflow-модели). Представления истории (`StepRail`/`ListView`/`LedgerView`)
  остаются как есть, кроме появления отдельного draft.

`SavedRequest` ≈ шаблон `Step`. Маппинг `step ↔ savedRequest` — чистая функция
(`mapping.ts`).

## 4. Правки бэкенда (Rust + IPC)

Все правки в `handshaker-core::collections::*`, `src-tauri/src/ipc/collection.rs`,
`src-tauri/src/commands/collection.rs`, `state.rs`. Миграции данных нет (фича
новая), поле `schema_version` **не** добавляем (YAGNI).

| # | Изменение | Причина |
|---|-----------|---------|
| B1 | `SavedRequest.metadata`: `HashMap<String,String>` → `Vec<MetadataRow{ key, value, enabled }>` | сохранить порядок/enabled/дубли ключей (как `Step.metadata`) |
| B2 | Auth: убрать `auth_by_env: AuthByEnvIpc`; добавить `auth: SavedAuthConfig` **на Collection и Request** (single config). У **Folder auth нет**. Удалить команду `auth_set_for_env` и тип `AuthByEnvIpc` | выбран один auth-конфиг на узел; env резолвит `{{vars}}`/секреты внутри конфига |
| B3 | `Collection.pinned: bool` | пин только на уровне коллекции (Postman) |
| B4 | `SavedRequest.last_used_at: Option<i64>` (epoch ms), `use_count: u32` | сортировка «недавние/частота» |
| B5 | `Collection.description: Option<String>` | описание только у коллекции |
| B6 | `Collection.created_at: i64` (epoch ms) | сортировка «по дате создания» |
| B7 | **Персистентный кэш контракта** по `resolved address` (сейчас дескриптор-кэш session-only, см. `state.rs`). Новый файловый стор (напр. `data_dir/contracts/`), ключ = resolved address. | reflection-кэш должен переживать перезапуск; шарится между реквестами одного адреса |

Сохраняем как есть: дерево `items` (folders+requests, **вложенность без лимита**),
`Collection.variables`, `Collection.default_tls`/`skip_tls_verify`,
`SavedRequest.address_template`/`service`/`method`/`body_template`/`tls_override`,
команды `collection_list/get/upsert/delete/add_item/rename_item/move_item/
duplicate_item/delete_item/restore_item` и операции `tree::*`.

Конвертеры `from_core`/`into_core` и тесты (`collection.rs#tests`,
`collections_persistence.rs`) обновляются под новые поля.

## 5. Сайдбар: информационная архитектура

- **Несколько именованных коллекций** верхнего уровня → папки (любой глубины) →
  реквесты-листья.
- **Порядок коллекций** — глобальная настройка сортировки (одна на сайдбар):
  по алфавиту / дате создания / недавним / частоте. «Недавние» =
  `max(last_used_at детей)`, «частота» = `sum(use_count детей)` (агрегация чистой
  функцией, без отдельных счётчиков на коллекции). Коллекции **не** перетаскиваются.
- **Внутри контейнера**: ручной порядок (DnD). **Папки всегда сверху** списка,
  реквесты ниже; реквест нельзя поднять выше папок (Postman-стиль).
- **Pinned** — флаг на коллекции: закреплённые показываются с иконкой и всплывают
  вверх общего списка (отдельной секции нет).
- **Фильтр** — текстовое поле; ищет по имени узла + service/method + адресу.
  При фильтрации всё считается раскрытым.
- **Состояние раскрытия** — при старте всё свёрнуто (не персистится).
- **Загрузка** — `loadAll` при старте.
- **Ширина** — resizable, персист в prefs.
- **Toggle всей панели** — кнопка + хоткей **Ctrl/Cmd+B**.
- **Виртуализации нет** (ожидаются небольшие деревья).
- **Мутации оптимистичные** с откатом при ошибке IPC.

### Строки

- **Коллекция:** шеврон + имя (+ иконка pin если закреплена). Клик по имени →
  CollectionOverview; шеврон → раскрыть.
- **Папка:** шеврон + иконка папки + имя. Клик по имени **и** шеврону → раскрыть.
- **Реквест:** имя + монохромный бейдж типа потока (unary/server/client/bidi —
  без цвета/иконки). Адрес в строке **не** показываем. Клик → открыть в Focus.

### Действия

- **Ховер-кнопки** на строке: **Pin** (только на коллекции; на ховере, у
  закреплённой — всегда) и **⋯** (открывает контекстное меню; оно же по правому
  клику).
- **Дабл-клик** по имени (реквест/коллекция) → inline-rename. **Blur = commit**,
  Enter = commit, Esc = cancel.
- **Контекстное меню:**
  - Коллекция: `Add request` · `Add folder` · `Rename` · `Delete`
  - Папка: `Add request` · `Add folder` · `Rename` · `Delete`
  - Реквест: `Rename` · `Duplicate` · `Delete`
  - (`Open` нет — клик уже открывает; `Pin/Unpin` — ховер-кнопка; `Move to…`
    нет — перенос только DnD)
- **Delete** — **всегда confirm** (диалог), **без undo** (snapshot из бэкенда не
  используем).
- **Duplicate** (реквесты) — имя `«<name> copy»`.
- **Add folder / New collection** — создаётся с дефолтным именем (`New folder` /
  `New collection`) сразу в режиме inline-rename.
- **Add request** (из меню) — открывает обычный pending-draft (без предвыбора
  цели сохранения).

### Drag-and-drop

- Перетаскиваются **реквесты и папки** (не коллекции).
- **Между коллекциями** — разрешено (move между деревьями).
- Режимы: **drop В папку** (вложить) и **reorder** между элементами на одном
  уровне. Ограничение: папки всегда выше реквестов.
- Визуал: **линия-индикатор вставки + подсветка** целевой папки.
- Бэкенд: `collection_move_item` (+ кросс-коллекционный вариант). Паттерн —
  `src/features/workflow/dnd.ts`. Оптимистично + откат.

## 6. Создание и сохранение (request-first)

- **New request** доступен из: шапки сайдбара (`+`), пустого Focus, и ⌘K.
  Создаёт **глобальный pending-draft** и фокусирует его.
- В Focus: ввод **host** → **reflection** (авто после паузы ~400мс **и** кнопка
  refresh) → **MethodPicker** (dropdown reflected service/method) → авто-скелет
  тела из дескриптора → правка body/metadata/**auth** → **Send** (Ctrl+Enter).
- **Нет reflection** (сервер без рефлексии) → показать ошибку (ручного ввода
  service/method нет в этой задаче).
- **Save** (Ctrl+S) → диалог (как Postman; адаптируем `SaveRequestDialog`):
  выбор коллекции/папки **руками**, но с **подсказкой текущего пути** для этого
  метода (где он уже сохранён / предлагаемый `Host > Service`). Авто-создание
  папок не делаем. Имя по умолчанию = **method**. **Дубли разрешены**.
- **Save / Save As:** у **несвязанного** draft `Save` создаёт реквест и
  привязывает (origin). У **origin-bound** реквеста — **автосохранение при любой
  правке** (body/header/host/...); `Save As` создаёт копию.
- **`dirty`** актуально только для несвязанного draft. При открытии другого
  реквеста поверх dirty-draft — **confirm** (заменить/сохранить?).

## 7. Auth и окружения

- **Один `SavedAuthConfig` на узел** (Collection / Request); у Folder auth нет.
- **Наследование: request → collection** (папки прозрачны для auth).
  Реконсиляция: ранее обсуждалась цепочка request→folder→collection, но т.к.
  папки не несут auth, фактическая цепочка — request→collection.
- **Env-переключатель** (`WorkflowEnvControl`) влияет на **vars + auth-резолв**:
  активный env резолвит `{{vars}}`/секреты (`env_var`) внутри единственного
  auth-конфига и в адресе/теле.
- **Fallback на Send:** если у реквеста нет auth — берём inherited (collection);
  если и там нет — без auth (`none`).
- **`Step` несёт `auth: SavedAuthConfig` инлайн**; поле `serviceId` удаляется
  (вместе с `CatalogService`). `CallPanel`/`actions.ts` резолвят auth из
  draft/step, а не из `catalogStore`.

## 8. CollectionOverview

- Рендерится **в главной области** (вместо Focus), как легаси-сценарий
  `collection`.
- Табы: **Overview** (имя, description, default TLS/skip-verify) · **Authorization**
  (single auth коллекции) · **Variables** (переменные коллекции).
- Адаптируем легаси `src/features/collections/overview/*` под новую модель
  (single-auth вместо `auth_by_env`).

## 9. ⌘K (Command Palette)

- Содержимое — **только сохранённые реквесты**, поиск по **всем коллекциям**.
- Выбор → **открыть в Focus** (с confirm если dirty).
- Текущую `CommandPalette` (завязана на `catalogStore`) **переписываем** под
  коллекции.

## 10. Reflection / кэш контракта

- Кэш по **resolved address** (шарится между реквестами одного адреса),
  **персистится** (см. B7).
- Refresh — ручная кнопка в Focus + авто-debounce при вводе адреса.

## 11. Клавиатура и a11y

- **Хоткеи:** `Ctrl/Cmd+B` toggle сайдбара; `Ctrl/Cmd+Enter` Send (есть);
  `Ctrl/Cmd+S` Save; `Ctrl/Cmd+N` New request; `⌘K` палитра (есть).
- **Навигация по дереву:** полная стрелочная — `↑/↓` по видимым узлам,
  `→/←` раскрыть/свернуть, `Enter` открыть, `F2` rename.
- **A11y:** базовые `aria-label` на кнопках/строках (без полноценных
  `tree`/`treeitem` ролей в этой задаче).

## 12. Удаляем / ретайрим

- `src/features/catalog/`: `model.ts` (`CatalogService`/`curated`/`Collection`),
  `store.ts` (`catalogStore`), `tree.ts` (вывод дерева), `Sidebar.tsx`,
  `ServicePanel.tsx`, `ServiceAuthEditor.tsx`, `AddServiceForm.tsx` (+ их тесты).
- `src/features/workflow`: `Step.serviceId`, `resolveStepAuthHeader`-ветка через
  `catalogStore` (заменяется инлайн-auth).
- **Мёртвый легаси-фронт:** старый `src/App.tsx` и легаси
  `src/features/collections/tree|overview|*` после переноса паттернов — удаляем.
- Бэкенд: тип `AuthByEnvIpc` и команда `auth_set_for_env`.

Новые фронт-файлы (ориентир, не жёстко): `SidebarShell`, `CollectionTree`,
`CollectionNode`, `FolderNode`, `RequestRow`, `RowMenu`, `PinButton`,
`SortControl`, `useCatalogTree` (мутации поверх IPC, оптимистичные),
`grouping.ts` (подсказка пути Host>Service), `mapping.ts` (step↔savedRequest),
`dnd.ts` (перенос с ограничением «папки сверху»).

## 13. Терминология / визуал

- Язык UI — **английский** (gRPC-термины тоже EN).
- Лист — **Request**. Иконки — `lucide`. Кастомизации коллекций (цвет/иконка)
  нет. Тема/плотность — наследуют `prefs`.

## 14. Тестирование (TDD)

**Backend (Rust):**
- round-trip `Vec<MetadataRow>` через `FileCollectionStore` (порядок/enabled);
- single `auth` на collection/request; отсутствие auth у folder;
- `pinned` / `description` / `created_at` / `last_used_at` / `use_count` персист;
- персист кэша контракта (drop+reconstruct);
- существующие tree-тесты (add/move/duplicate/delete/restore) зелёные после
  смены схемы.

**Frontend (Vitest + Testing Library):**
- `mapping.ts` (step↔savedRequest: metadata-rows, auth, address/tls);
- `grouping.ts` (подсказка пути Host>Service из reflection);
- агрегация usage для сортировки коллекций (max/sum);
- сортировка/фильтр (по имени+service/method+адресу);
- `useCatalogTree` мутации (оптимистичность + откат);
- сайдбар-взаимодействия: inline-rename (blur=commit), context-menu
  (add/rename/duplicate/delete), pin, confirm на delete;
- DnD-reducer (drop-в-папку, reorder, «папки сверху», кросс-коллекция);
- стрелочная навигация по дереву;
- Focus/draft: новый pending-draft, Send→шаг в активный workflow, draft остаётся,
  open-over-dirty confirm, автосохранение origin-bound, Save/Save As;
- auth-резолв по env + наследование request→collection + fallback none;
- ⌘K (саджест сохранённых, open в Focus);
- CollectionOverview (Overview/Authorization/Variables, single-auth).

## 15. Реестр решений (для трассируемости)

| Тема | Решение |
|------|---------|
| Метадата бэкенда | `Vec<MetadataRow>` |
| Пин | только на коллекции; иконка, всплытие вверх; без секции |
| ID узлов | глобальные UUID |
| Версия схемы | нет |
| Сортировка коллекций | глобальная: алфавит/дата/недавние/частота |
| Usage | `last_used_at`+`use_count` на реквесте; агрегация max/sum |
| Фильтр | имя + service/method + адрес |
| Ширина сайдбара | resizable + персист |
| Toggle панели | да, `Ctrl/Cmd+B` |
| Строка реквеста | имя + монохром-бейдж потока; без адреса |
| Строка папки/коллекции | папка: шеврон+иконка+имя; коллекция: шеврон+имя |
| Вложенность | без лимита |
| Pin-кнопка | ховер; закреплённая — всегда |
| Inline-rename blur | commit |
| Delete | всегда confirm; без undo |
| Контекст-меню | колл/папка: Add request/Add folder/Rename/Delete; реквест: Rename/Duplicate/Delete |
| New request | отдельный глобальный pending-draft; из sidebar `+`/Focus-пустоты/⌘K |
| Reflection-триггер | авто (debounce) + кнопка |
| Выбор метода | MethodPicker из reflection; нет reflection → ошибка |
| Префилл тела | авто-скелет из дескриптора |
| Save-диалог | как Postman; папки руками + подсказка пути; имя=method; дубли ок |
| Save vs Save As | Save биндит/обновляет, Save As — копия; origin-bound автосейв |
| Открытие реквеста | в Focus; confirm если dirty (табов нет) |
| Реквест→workflow | выполненные вызовы попадают в историю автоматически (Send) |
| Draft после Send | остаётся в Focus; шаг — в активный workflow |
| Auth-модель | один конфиг на узел; наследование request→collection; folder без auth |
| Env | vars + auth-резолв |
| Auth fallback | inherited → none |
| Step.auth | инлайн на Step/draft; `serviceId` удалён |
| Reflection-кэш | персист, по resolved-адресу |
| Browse методов | только MethodPicker |
| DnD | реквесты+папки; меж-коллекционно; drop-в-папку+reorder; папки сверху; линия+подсветка |
| ⌘K | только сохранённые реквесты, все коллекции, open в Focus; переписать |
| Пустой сайдбар | только New collection |
| Первый запуск | авто «My Collection» |
| Import/Export | stub |
| Пустая коллекция | только текст |
| Toggle hotkey | `Ctrl/Cmd+B` |
| Реквест-хоткеи | Send/Save/New |
| Навигация по дереву | полная стрелочная |
| A11y | базовые aria-label |
| Виртуализация | нет |
| Мутации | оптимистичные + откат |
| Expand-состояние | всё свёрнуто при старте |
| Загрузка | loadAll при старте |
| Язык UI | английский |
| Кастомизация коллекции | нет |
| Термин листа | Request |
| Variables | да, таб в CollectionOverview |
| Клик по контейнеру | шеврон=раскрыть, имя коллекции=overview, имя папки=раскрыть |
| Настройки коллекции | CollectionOverview: Overview/Authorization/Variables |
| Auth/TLS папки | нет (только collection + request) |
| Description | только коллекция |
| Дубликат-имя | `<name> copy` |
| Создание узла | дефолт + inline-rename |
| Draft/step разделение | в скоупе |
| Usage-агрегация | из детей max/sum |
| Легаси-фронт | удалить мёртвый код |
| История-вьюхи | как есть (+ draft-разделение) |
| Pending-draft | один глобальный |
| Send → шаг | в активный workflow (нет — создать) |

## 16. Фазинг (для writing-plans)

1. **Бэкенд:** metadata-rows (B1), auth single (B2), pinned/description/
   created_at/usage (B3–B6), персист кэша контракта (B7) + тесты, обновление
   IPC-биндингов.
2. **Маппинг и чистые функции:** `mapping.ts` (step↔savedRequest), `grouping.ts`,
   usage-агрегация, сортировка/фильтр — TDD.
3. **Workflow-модель:** глобальный pending-draft, `Step.auth` инлайн (удалить
   `serviceId`), Send→шаг в активный workflow, draft остаётся. Обновить
   `CallPanel`/`actions`/`FocusView`.
4. **Сайдбар (без DnD):** `SidebarShell`/`CollectionTree`/`CollectionNode`/
   `FolderNode`/`RequestRow`/`RowMenu`/`PinButton`/`SortControl`, `useCatalogTree`,
   inline-rename, context-menu, confirm-delete, фильтр, стрелочная навигация,
   toggle+resize.
5. **Create/Save flow:** new-request draft, reflection+MethodPicker+скелет,
   `SaveRequestDialog` (подсказка пути, Save/Save As, автосейв origin-bound),
   open-over-dirty confirm.
6. **CollectionOverview** (Overview/Authorization/Variables) + ⌘K переписать.
7. **DnD:** перенос реквестов/папок, меж-коллекционно, «папки сверху», линия+
   подсветка, оптимистично.
8. **Зачистка:** удалить `CatalogService`/`ServicePanel`/`ServiceAuthEditor`/
   `AddServiceForm`/`catalog` tree/store, легаси `collections/`-фронт, старый
   `App.tsx`, `AuthByEnvIpc`/`auth_set_for_env`; обновить `WorkflowApp`.

🧹 **/clear-чекпойнты** между фазами 1–2, 3, 4, 5–6, 7, 8.
