# Доработка титлбара — дизайн

**Статус:** дизайн утверждён, готов к плану · **Дата:** 2026-06-06 · **Ветка:** `claude/infallible-lumiere-bc9ea5`

## Проблема

Реально отрисовывается инлайн-бар в `src/app/WorkflowApp.tsx` (строки ~143–156), а
компонент `src/features/shell/Titlebar.tsx` (в котором уже есть кнопки окна, drag-класс,
тогглы темы/сайдбара/настроек) — **мёртвый код, нигде не подключён**. Отсюда набор жалоб:

1. Не работает перетаскивание окна.
2. Нет кнопок min / max / close.
3. Селектор environment крупнее и моноширинный — не совпадает с видом селектора workflow.
4. Выбор environment не переживает перезапуск приложения.
5. Переключатель вида (`Лента / Список / Фокус`) стоит справа и на русском.
6. ⌘K-поиск — изначально просили «сделать шире»; по итогам брейнсторма решено **удалить
   командную палитру целиком**.

## Решение (обзор)

Свести верхнюю панель в **единый титлбар** (переписанный `Titlebar.tsx`), отрисовываемый в
`WorkflowApp` вместо инлайн-бара. Инлайн-бар и командная палитра удаляются. Раскладка —
**одна строка**, grid `[1fr_auto_1fr]`, центр гарантированно по центру.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ◆ Handshaker  [workflow ▾] [env ▾]    [ Ledger | List | Focus ]    ▭ ☀ ⚙ │ – ▢ ✕ │
│  ← LEFT (nodrag)                          CENTER                    → RIGHT (nodrag)   │
└──────────────────────────────────────────────────────────────────────────┘
```

- **LEFT:** лого ◆ + wordmark «Handshaker», `WorkflowSelector`, `WorkflowEnvControl`.
- **CENTER:** `ViewSwitcher` (английские лейблы).
- **RIGHT:** сайдбар-тоггл · тема · настройки · вертикальный разделитель · кнопки окна (min/max/close).

На минимальной ширине окна (1024px) всё помещается с запасом — после удаления ⌘K-строки
адаптивные брейкпоинты не нужны.

## Детали по пунктам

### 1 + 2. Перетаскивание и кнопки окна

Две корневые причины, обе чиним:

- **Бэкенд (capabilities):** добавить `core:window:allow-start-dragging` в
  `src-tauri/capabilities/default.json`. Без него `data-tauri-drag-region` не работает.
  Разрешения на close/minimize/toggle-maximize там уже есть — кнопки окна заработают как есть.
- **Фронт:** перейти с `-webkit-app-region: drag` (Electron-подход, ненадёжен в WebView2 на
  Windows) на нативный Tauri-атрибут **`data-tauri-drag-region`**. Атрибут **не наследуется
  детьми** — вешаем его на корень бара и на каждую неинтерактивную зону, которую хотим таскать
  (лого, wordmark, пустые ячейки grid). Кнопки, дропдаун-триггеры и сегменты view-switcher
  перетаскивать не будут — это правильное поведение.

Кнопки окна (min/max/close) переносятся из существующего кода `Titlebar.tsx` через
`getCurrentWindow().minimize() / toggleMaximize() / close()`.

Источники (проверено через WebSearch):
- https://v2.tauri.app/learn/window-customization/
- https://v2.tauri.app/reference/acl/core-permissions/
- https://github.com/tauri-apps/tauri/discussions/5886

### 3. Env-селектор под вид workflow

`WorkflowEnvControl` сейчас рисует триггер как `<Button variant="ghost" size="sm" className="gap-1 font-mono">`
— крупнее и моноширинный. Привести триггер к классам `WorkflowSelector`:
`flex items-center gap-1 rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent`,
лейбл в `text-foreground`, шеврон `size-3`, **без `font-mono`**. Логика меню и диалогов
(`EnvSwitcherMenu`, `EnvEditorDialog`, `ConfirmDeleteEnvDialog`) не трогается.

### 4. Персист выбора environment — гидрация из бэкенда

Бэкенд уже хранит активный env (`envActiveGet` / `envActiveSet`), но фронт-стор при старте
всегда создаёт свежий workflow с `envName = null` и нигде не подхватывает сохранённое значение.

- В `workflowStore` добавить метод **`hydrateEnv(name: string | null)`**, который проставляет
  `envName` активного workflow **без** обратного вызова `envActiveSet` (чтобы не было лишнего
  round-trip и эха).
- В `WorkflowApp` — один `useEffect` на маунте: `envActiveGet()` → `workflowStore.hydrateEnv(result)`.

Персист всего стора (несколько workflow, view-mode) — **вне объёма**; чиним только заявленную
жалобу по env.

### 5. View-switcher — центр + английский

В `src/features/workflow/ViewSwitcher.tsx` поменять лейблы (значения `ledger/list/focus` не
меняются):

| value    | было     | стало    |
|----------|----------|----------|
| `ledger` | Лента    | Ledger   |
| `list`   | Список   | List     |
| `focus`  | Фокус    | Focus    |

Позиция — центральная колонка grid (`justify-self: center`).

### 6. Удаление командной палитры (⌘K)

Полностью убрать функциональность:

- `src/app/WorkflowApp.tsx`: удалить импорт `CommandPalette`, состояние `paletteOpen`/`setPaletteOpen`,
  ветку обработчика клавиш `e.key === "k" / "K"`, эффект reload-on-open
  (`useEffect(... if (paletteOpen) cat.reload())`), кнопку-чип ⌘K и монтирование `<CommandPalette>`.
  Обработчики `⌘S` и `⌘N` в том же `keydown`-листенере **сохранить**.
- Удалить файлы `src/features/catalog/CommandPalette.tsx` и `src/features/catalog/CommandPalette.test.tsx`.
- `src/app/WorkflowApp.test.tsx`: убрать `vi.mock(".../CommandPalette", …)`.
- Обновить устаревшие подсказки пустого состояния, упоминающие ⌘K:
  - `src/features/workflow/FocusView.tsx:58` — «…или нажми ⌘K.» → убрать упоминание ⌘K.
  - `src/features/workflow/LedgerView.tsx:20` — «…или ⌘K.» → убрать.
  - `src/features/workflow/ListView.tsx:14` — «…или ⌘K.» → убрать.
- Комментарии, упоминающие ⌘K (`CatalogProvider.tsx`, `WorkflowApp.tsx`), привести в соответствие
  (косметика).
- Компонент `Kbd` (`src/components/ui/kbd.tsx`) **не удалять** — используется в `KeyboardPane`,
  `Heroes`, `MethodPicker`.

### Доп. кнопки (тема / сайдбар / настройки)

Переносятся в титлбар из существующего кода `Titlebar.tsx`:

- **Сайдбар-тоггл:** флипает `prefs.sidebar` через `usePrefs`. `SidebarShell` уже слушает этот
  преф (`if (!prefs.sidebar) return null`) — доп. проводка не нужна.
- **Тема:** флипает `prefs.theme` (`dark`/`light`) через `usePrefs`.
- **Настройки:** открывают `SettingsDialog`. Сейчас `SettingsDialog` существует, но **нигде не
  примонтирован** — попутно монтируем его в `WorkflowApp` (`open` / `onOpenChange`) и
  прокидываем колбэк открытия в титлбар.

## Затрагиваемые файлы

- `src-tauri/capabilities/default.json` — + `core:window:allow-start-dragging`.
- `src/features/shell/Titlebar.tsx` — переписать в единый живой титлбар (drag-атрибут, grid,
  workflow/env/view + утилиты + кнопки окна).
- `src/app/WorkflowApp.tsx` — рендерить `Titlebar` вместо инлайн-бара; гидрация env на маунте;
  монтировать `SettingsDialog`; удалить палитру.
- `src/features/workflow/store.ts` — + `hydrateEnv`.
- `src/features/workflow/WorkflowEnvControl.tsx` — стиль триггера под `WorkflowSelector`.
- `src/features/workflow/ViewSwitcher.tsx` — английские лейблы.
- `src/features/workflow/{FocusView,LedgerView,ListView}.tsx` — убрать упоминания ⌘K.
- **Удалить:** `src/features/catalog/CommandPalette.tsx`, `src/features/catalog/CommandPalette.test.tsx`.
- `src/app/WorkflowApp.test.tsx` — убрать мок палитры; обновить ожидания под новую раскладку.

## Тестирование (TDD, subagent-driven)

- `ViewSwitcher`: рендерит английские лейблы `Ledger / List / Focus`.
- `workflowStore.hydrateEnv`: проставляет `envName` активного workflow и **не** дёргает `envActiveSet`.
- `WorkflowApp`: на маунте вызывает `envActiveGet` и гидрирует env (мок IPC).
- `WorkflowApp`: кнопка настроек открывает `SettingsDialog`; командной палитры и ⌘K-обработчика
  больше нет (негативный тест на отсутствие).
- `WorkflowEnvControl`: триггер без `font-mono`, классы совпадают с `WorkflowSelector`.

Перетаскивание и кнопки окна — поведение Tauri-рантайма, юнит-тестами не покрываются;
проверяются ручной верификацией в собранном приложении.

Сборка: `pnpm build` → затем компиляция `src-tauri` (требует готового `dist/`, см. CLAUDE.md).

## Вне объёма

- Персист всего workflow-стора (несколько workflow, view-mode, активный workflow).
- Любые изменения бэкенда env, логики `EnvSwitcherMenu`/диалогов.
- Адаптивные брейкпоинты титлбара (не нужны после удаления ⌘K-строки).
- Замена/доработка функциональности поиска по реквестам (палитра удаляется без замены).
