# Дизайн: улучшение коллекции сайдбара (полный переход на shadcn Sidebar)

- **Дата:** 2026-06-06
- **Статус:** Design approved — готов к детализации в план
- **Основа:** поверх завершённого рефакторинга
  `docs/superpowers/specs/2026-06-05-service-collection-sidebar-refactor-design.md`
  (дерево `src/features/catalog/*`, бэкенд `CollectionIpc`, DnD — плечи 05–08 готовы).

## Контекст и цель

Текущий сайдбар коллекций работает (персистентная библиотека, DnD, фильтр, rename),
но визуально и по поведению отстаёт от Postman/shadcn-эталона. Пользователь
перечислил 10 точечных улучшений: поведение кликов, иконка gRPC, плотность отступов,
направляющие линии, подсветка активной строки, иконка сортировки, и — главное —
**персист состояния коллекции между перезапусками** (раскрытость, сортировка,
активный реквест). Пользователь решил **полностью перейти на компоненты shadcn**
(а не гибрид), приняв цену миграции.

Цель — перевести дерево сайдбара на канонический shadcn `Sidebar` (со всеми
menu-примитивами и `ResizablePanelGroup` для ширины), закрыв все 10 пунктов и
сохранив доменную модель дерева, бэкенд `CollectionIpc` и логику DnD-планирования.

## Ключевые решения (зафиксированы в брейншторме)

| # | Решение |
|---|---------|
| Подход к shadcn | **Полный переход (уровень 3):** канонический `Sidebar` + рекурсия дерева на `SidebarMenuSub`. |
| Ширина / резайз | **`ResizablePanelGroup`** (react-resizable-panels, уже в зависимостях) оборачивает `[sidebar \| main]`. |
| Схлоп/видимость/хоткей | Одна механика: **видимость через панель + существующий `prefs.sidebar` + cmd+ctrl+B**; провайдерский cmd+B и cookie **вырезаются** из вендоренного `sidebar.tsx`. |
| Персист UI-состояния коллекции | **Бэкенд** (раскрытость, сортировка, активный реквест). |
| Стиль иконки gRPC | **Настройка** (4 варианта) в `localStorage` prefs. |
| Плотность отступов | Шаг **8px**. |
| Иконка сортировки | `ArrowUpDown` + `DropdownMenu`. |
| DnD | Текущая логика планирования + **auto-expand при наведении** (~0.7с). |

## 1. Полный переход на shadcn Sidebar

Установить `src/components/ui/sidebar.tsx` (официальный компонент; registry-зависимость
`sheet` — см. §9.8). Дерево строится канонически:

- Контейнер: `SidebarProvider` → `Sidebar` → `SidebarHeader` (заголовок «Collections»
  + иконка сортировки + «+») → `SidebarContent` → `SidebarGroup` → `SidebarMenu`.
- Узлы: коллекция/папка — `SidebarMenuItem` + `SidebarMenuButton` + вложенный
  `SidebarMenuSub` (рекурсия) с `SidebarMenuSubItem`/`SidebarMenuSubButton`; реквест —
  лист `SidebarMenuSubButton`/`SidebarMenuButton` (`asChild`, `isActive`).
- Трейлинг-экшены (⋯-меню, pin) — через `SidebarMenuAction` (`showOnHover`).

Доменная модель дерева (`CollectionIpc`, `useCatalogTree`) и логика DnD-планирования
(`dnd.ts`: `planDrop`, зоны, folders-on-top) **сохраняются**; меняется только
презентационный слой (`CollectionNode/FolderNode/RequestRow` переписываются на
shadcn-примитивы или заменяются рекурсивным рендером).

## 2. Коллизии полной миграции и их резолюции

| # | Коллизия | Резолюция |
|---|----------|-----------|
| 1 | Ширина/резайз: свой drag-резайзер vs отсутствие native-resize у `SidebarRail` | Обернуть `[sidebar \| main]` в `ResizablePanelGroup direction="horizontal"`. Сайдбар — `ResizablePanel` (`collapsible`, `minSize`/`maxSize`, `defaultSize`). `Sidebar` внутри — `collapsible="none"` + `--sidebar-width: 100%`, чтобы заполнять панель; реальную ширину держит панель. Персист ширины — `onLayout` → `prefs` (мигрируем `sidebarWidth` px → размеры панелей). |
| 2 | Видимость/схлоп + хоткей cmd+B + cookie | Мы **владеем** вендоренным `sidebar.tsx` (shadcn копирует код в репо). Вырезаем из него keyboard-shortcut (cmd+B) и cookie-персист. Единая механика видимости: collapsible-панель + существующий `prefs.sidebar` + cmd+ctrl+B. Icon-rail не используем (для дерева бессмыслен). |
| 3 | DnD-геометрия под новый DOM | Обработчики DnD вешаем на элемент, отрисованный через `asChild` (наш `<div draggable>`), а не на `<li>`. Зонная математика (`getBoundingClientRect`, `zoneFromPointer`) остаётся по-строчной. Обязательная перевалидация `dnd.test.ts` + ручной прогон (план выделяет задачу). |
| 4 | 436+ тестов завязаны на старую структуру | Принятая цена. План выделяет отдельную задачу на миграцию тестов сайдбара (`SidebarShell.test`, `CollectionTree.test`, узлы) под новую структуру/aria. |
| 5 | Оверлеи строки (⋯/pin/rename) | ⋯-меню и pin → `SidebarMenuAction` (`showOnHover`). Инлайн-rename подменяет содержимое кнопки в режиме редактирования. |
| 6 | Кастомная arrow-навигация | Сохраняем (`treeNav.ts`, `focusedId`); `SidebarMenuButton` — фокусируемый элемент, мирим ring-фокус. |
| 7 | Layout / `SidebarInset` | `SidebarInset` **не** используем — раскладку держит `ResizablePanelGroup`, main-область = второй `ResizablePanel`. |
| 8 | Лишний `sheet` (mobile offcanvas) | Десктоп-Tauri: либо добавить `sheet.tsx` ради компиляции импорта, либо вырезать mobile-ветку из вендоренного `sidebar.tsx`. Предпочтительно — вырезать (мёртвый код). |

## 3. Отступы и направляющие линии (#6, #9)

- Шаг вложенности **8px** — переопределяем дефолтный отступ `SidebarMenuSub`
  (shadcn по умолчанию `mx-3.5 px-2.5`) на 8px.
- Направляющая линия — штатная левая граница `SidebarMenuSub` (`border-l` через
  `--sidebar-border`); при наведении на ветку линия подсвечивается (усиление на `:hover`).

## 4. Иконка gRPC-реквестов (#3)

- Новый pref в `src/lib/use-prefs.ts`:
  `grpcIcon: "solid" | "letter" | "outline" | "circle"`, default `"solid"`,
  добавить в `PREFS_DEFAULTS` (мердж со старым стейтом безопасен — см. `read()`).
- Строка-переключатель «gRPC icon» (`ToggleGroup`) в
  `src/features/settings/AppearancePane.tsx`.
- В презентации листа реквеста заменить монохромный плейсхолдер `un` (`StreamBadge`)
  на `GrpcIcon`, читающий `prefs.grpcIcon`; применение мгновенное.
- Варианты (синий, 16px): `solid` (залитый квадрат, белая «g», default) ·
  `letter` (только синяя «g») · `outline` (синяя рамка) · `circle` (синий круг).

## 5. Сортировка: дропдаун → иконка (#8)

- `src/features/catalog/SortControl.tsx`: нативный `<select>` → иконка-кнопка
  `ArrowUpDown` (lucide) + `DropdownMenu` (`src/components/ui/dropdown-menu.tsx` есть)
  с галочкой у активного режима (`alpha`/`created`/`recent`/`frequency`).
- Значение сортировки читается/пишется в бэкенд-настройки (см. §7.2).

## 6. Поведение кликов

### 6.1 Коллекция / папка (#1)
- Клик по **шеврону** (`SidebarMenuAction` или leading-кнопка) — только тоггл раскрытия.
- Клик по **имени / телу строки** — открыть overview + раскрыть узел; повторный клик
  **не сворачивает** (раскрытие идемпотентно).
- Раскрытие пишется в бэкенд (§7.1).

### 6.2 Реквест (#2)
- Клик в любом месте строки → открыть реквест. Исключения: `SidebarMenuAction`
  (⋯-меню/pin), инлайн-rename, drag-хэндл.

### 6.3 Подсветка активной строки (#7)
- Сейчас `SidebarShell` передаёт `activeItemId={null}` (захардкожено).
- Пробросить реальный активный id из workflow-стора (`src/features/workflow/store.ts`):
  активный = saved-request, соответствующий origin открытого workflow.
- Рендер через `SidebarMenuButton isActive` (фон `--sidebar-accent`); `focusedId`
  (клавиатура, ring) остаётся отдельным состоянием.

## 7. Персист состояния коллекции на бэкенде

### 7.1 Раскрытость узлов (#5)
- В `crates/handshaker-core` добавить `expanded: bool` на `Collection` и `Folder`
  (default `false` — свёрнуто; существующие коллекции при миграции получают `false`).
- Сериализуется в per-collection JSON (`file_store.rs`).
- Новый лёгкий IPC `collection_set_expanded(collectionId, itemId | null, expanded)`
  (`null` → сама коллекция; `itemId` → папка). Точечная запись, **без**
  `collectionUpsert` всего дерева.
- Фронт: множество раскрытых узлов инициализируется из `expanded`-флагов (вместо
  пустого `useState<Set>` в `CollectionTree.tsx`); тоггл → новый IPC (оптимистично).
- Force-expand при активном фильтре сохраняется и **не** перетирает флаги.

### 7.2 Глобальное UI-состояние (сортировка + активный реквест)
- Новый app-settings стор в `handshaker-core`: файл `ui-state.json` в data_dir
  (atomic write, как `file_store.rs`). Форма:
  `{ sortKey, activeRequest: { collectionId, itemId } | null }`.
- IPC `app_settings_get() -> UiStateIpc`, `app_settings_set(patch)`.
- Фронт: `SidebarShell` читает `sortKey` отсюда; открытие реквеста пишет
  `activeRequest`. На старте — восстановление сортировки + переоткрытие реквеста.

### Разграничение хранения
- **Бэкенд (`CollectionIpc` / app-settings):** раскрытость, сортировка, активный реквест.
- **localStorage (`prefs`):** `grpcIcon`, ширина сайдбара (через `onLayout`),
  видимость, тема/плотность/шрифты. (Чисто визуальные/локальные преференции.)

## 8. DnD: Postman-нюанс (#4)

- Логика планирования (`dnd.ts`: before/after/inside, кросс-коллекции, folders-on-top)
  сохраняется; индикаторы перестилизуются под новый вид.
- **Auto-expand:** удержание перетаскиваемого над свёрнутой папкой/коллекцией ~700мс →
  авто-раскрытие. Таймер сбрасывается при уходе курсора. Авто-раскрытие идёт тем же
  путём, что обычный тоггл (§7.1), поэтому персистится (соответствует #5).

## 9. Затрагиваемые файлы (ориентир)

**Фронтенд:**
- `src/components/ui/sidebar.tsx` (новый, вендоренный shadcn — с правками §2.2/§2.8),
  при необходимости `sheet.tsx`; `resizable.tsx` (есть, начинаем использовать),
  `dropdown-menu.tsx` (есть).
- `src/app/WorkflowApp.tsx` (обернуть раскладку в `ResizablePanelGroup`).
- `src/features/catalog/`: `SidebarShell.tsx`, `CollectionTree.tsx`,
  `CollectionNode.tsx`, `FolderNode.tsx`, `RequestRow.tsx` (переписать на
  shadcn-примитивы/рекурсию), `SortControl.tsx`, `dnd.ts`, `GrpcIcon.tsx` (новый).
- `src/lib/use-prefs.ts`, `src/features/settings/AppearancePane.tsx`.
- `src/styles/globals.css` (токены `--sidebar-*` в HSL, `:root` + `.dark`).
- `src/features/workflow/store.ts` (проброс активного реквеста).
- Фронт-обёртки IPC для новых команд.
- Тесты сайдбара — миграция под новую структуру (§2.4).

**Бэкенд:**
- `crates/handshaker-core`: `expanded` на Collection/Folder; app-settings стор
  (`ui-state.json`); `file_store.rs`.
- `src-tauri`: команды `collection_set_expanded`, `app_settings_get`, `app_settings_set`.

## 10. Верификация (end-to-end)

- **Сборка свежего worktree:** `pnpm install` → собрать `dist/` → компиляция
  `src-tauri` (`generate_context!` требует `dist/`).
- **Тесты:** `pnpm test` (vitest; сайдбар-тесты мигрированы и зелёные);
  `cargo test` (ядро + tauri: `expanded`, `collection_set_expanded`, app-settings).
- **Ручной прогон:**
  1. Раскрыть коллекцию + папку → перезапуск → раскрытость сохранилась (#5).
  2. Сменить сортировку → перезапуск → сохранилась; активный реквест переоткрылся (#7).
  3. Клик по имени коллекции → overview + раскрытие; клик по строке реквеста где
     угодно → открылся (#1, #2).
  4. Переключить `grpcIcon` в Appearance → дерево обновилось мгновенно (#3).
  5. Отступ 8px + направляющие линии с подсветкой при наведении (#6, #9).
  6. Resize сайдбара тянется (`ResizablePanelGroup`), ширина переживает перезапуск.
  7. Скрыть/показать сайдбар по cmd+ctrl+B — без конфликта с cmd+B.
  8. DnD: реквест на свёрнутую папку → auto-expand → дроп внутрь, порядок сохранился (#4).

## 11. Вне рамок (YAGNI)

- Icon-collapse rail (схлоп в иконки) — для дерева не делаем.
- Mobile offcanvas (`Sheet`-ветка sidebar.tsx) — вырезается.
- Синхронизация UI-состояния между машинами — следствие бэкенд-персиста, отдельно
  не проектируем.
