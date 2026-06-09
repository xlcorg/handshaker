# Manual "Check for updates" button — design

**Дата:** 2026-06-09 · **Статус:** spec, ожидает ревью · **Связ. фича:**
[auto-update](archive/2026-06-07-auto-update-design.md) (этот спек — её deferred
follow-up: «a manual 'Check for updates' button in Settings → About»).

## Цель

Дать пользователю вручную запустить проверку обновлений из двух мест:

1. иконка-кнопка в тайтлбаре (быстрый доступ без открытия настроек);
2. кнопка в Settings → About (рядом со строкой версии).

Найденное обновление показывается **уже существующим** sonner-тостом
(`UpdateToast`, действия «Update now» / «Later») — ровно как при автопроверке на
старте. В About при этом видна инлайн-строка статуса проверки.

Все UI-строки — английские (как и весь остальной интерфейс приложения).

## Контекст (что уже есть)

- `src/features/updater/useUpdateCheck.ts` — хук-машина состояний над
  `@tauri-apps/plugin-updater`. Фазы: `idle | checking | available | upToDate |
  downloading | installError | error`. Сейчас проверяет обновление **только один
  раз при монтировании** (`useEffect` с пустыми зависимостями); метода для
  повторной проверки нет. Экспортирует `install()` и `dismiss()`.
- `src/features/updater/UpdateToast.tsx` — headless-компонент: показывает один
  sonner-тост для фаз `available` / `downloading` / `installError`, гасит его для
  остальных. Менять не требуется.
- `src/app/WorkflowApp.tsx` — держит единственный инстанс `useUpdateCheck()` и
  рендерит `UpdateToast`. Также рендерит `Titlebar` и `SettingsDialog`.
- `src/features/shell/Titlebar.tsx` — чисто пропс-управляемый (`onOpenSettings`);
  ряд мелких иконок-кнопок с тултипами справа. Тесты рендерят его без контекстов.
- `src/features/settings/AboutPane.tsx` — внутри `SettingsDialog`; показывает
  версию через `ipc.appVersion()`. Своего теста пока нет.

## Архитектура: расшара состояния апдейтера

Кнопке в About нужен доступ к **тому же** инстансу хука, что и у тоста (чтобы
найденное обновление и его `Update`-объект были общими). Выбор — лёгкий React
context, по образцу существующего `CatalogProvider`:

- Новый файл `src/features/updater/updaterContext.tsx`: `UpdaterContext`
  (`createContext<UseUpdateCheck | null>(null)`) + хук `useUpdater()`, бросающий
  понятную ошибку вне провайдера.
- `WorkflowApp` продолжает звать `useUpdateCheck()` сам, но **оборачивает свой
  возвращаемый JSX** в `<UpdaterContext.Provider value={update}>`. Так
  `UpdateToast`, `Titlebar` и `SettingsDialog` (→ `AboutPane`) оказываются под
  провайдером. Провайдер внутренний для `WorkflowApp` ⇒ нулевой churn в его
  существующих тестах.

Отклонённые альтернативы: prop-drilling сквозь `SettingsDialog` (лишняя
связанность с тем, что к обновлениям отношения не имеет); второй независимый
инстанс хука в About (двойная проверка на mount, рассинхрон `Update`-объектов).

## Изменения по компонентам

### 1. `useUpdateCheck` — добавить `recheck()`

Вынести логику проверки из mount-`useEffect` в стабильный
`recheck = useCallback(...)`, который вызывается и на mount, и наружу.

- `recheck()` ставит `phase: "checking"`, затем по результату — `available`
  (с `version`, сохранив `Update` в `updateRef`) / `upToDate` / `error`.
- **Guard:** если уже идёт `checking` или `downloading` — no-op (через
  `inFlightRef`), чтобы повторные клики не накладывались и не запускали загрузку
  дважды. `install()` тоже выставляет `inFlight`, чтобы `recheck` не вмешивался в
  идущую загрузку.
- Сохранить unmount-safety: `mountedRef` (или флаг `cancelled`), чтобы не звать
  `setState` после размонтирования.
- `install()` и `dismiss()` — без изменений. `recheck` добавляется в интерфейс
  `UseUpdateCheck`.

### 2. Контекст апдейтера

Файл `src/features/updater/updaterContext.tsx` — `UpdaterContext` + `useUpdater()`
(см. «Архитектура»). `WorkflowApp` оборачивает поддерево.

### 3. Тайтлбар — иконка проверки

В `Titlebar` добавить **опциональные** пропсы:

- `onCheckForUpdates?: () => void`
- `updatePhase?: UpdatePhase`

Когда `onCheckForUpdates` передан — рендерить иконку-кнопку (`RefreshCw` из
`lucide-react`) рядом с кнопкой Settings, с тултипом и поведением по фазе:

- `checking` / `downloading` → тултип «Checking for updates…», иконка
  `animate-spin`, кнопка `disabled`;
- `available` → тултип «Update available»;
- иначе → тултип «Check for updates».

`aria-label` кнопки — «Check for updates» (стабильный, для тестов). Пропсы
опциональны ⇒ существующие рендеры `Titlebar` в тестах не трогаем. `WorkflowApp`
передаёт `onCheckForUpdates={update.recheck}` и `updatePhase={update.phase}`.

### 4. Settings → About — кнопка + статус

В `AboutPane` через `useUpdater()` добавить вторую группу
`SettingsGroup title="Updates"`:

- Кнопка «Check for updates» в стиле мелких кнопок приложения; лейбл меняется на
  «Checking…» и `disabled`, пока `checking` / `downloading`. `onClick` → `recheck`.
- Строка статуса под кнопкой по фазе:
  - `checking` → «Checking for updates…»
  - `upToDate` → «You're on the latest version.»
  - `available` → «Version {version} is available — see the notification.»
  - `downloading` → «Downloading… {progress}%»
  - `installError` → «Update failed. Try again.»
  - `error` → «Couldn't check for updates.»
  - `idle` → пусто (после dismiss).

Найденное обновление ставится на установку через тост (а не отдельной кнопкой
«Install» в About) — по решению на брейншторме.

## Тестирование (TDD)

- `useUpdateCheck.test.tsx` (дополнить): `recheck()` повторно зовёт `check` и
  переводит в `available`; `recheck()` — no-op во время `downloading`.
- `Titlebar.test.tsx` (дополнить): при переданном `onCheckForUpdates` есть кнопка
  с `aria-label` «Check for updates», клик вызывает колбэк; при
  `updatePhase="checking"` кнопка `disabled`.
- `AboutPane.test.tsx` (новый): кнопка есть; клик зовёт `recheck`; строка статуса
  соответствует фазе. Рендер под `UpdaterContext.Provider` с фейковым значением;
  мок `@/ipc/client` (`ipc.appVersion`).
- `updaterContext` (опционально): `useUpdater()` бросает вне провайдера.
- `WorkflowApp.test.tsx`: существующий тест тоста остаётся зелёным; провайдер
  внутренний ⇒ churn нет.

Полный прогон `pnpm test` + `pnpm lint` зелёные.

## Вне scope

- Периодические проверки по таймеру.
- Рендер changelog / release notes в тосте или About.
- Отдельная кнопка «Install» в About (установку ведёт тост).
- Apple notarization / Windows Authenticode (отдельные deferred follow-up'ы
  основной фичи).

## Файлы

| Файл | Изменение |
|------|-----------|
| `src/features/updater/useUpdateCheck.ts` | + `recheck()`, guard, в интерфейс |
| `src/features/updater/useUpdateCheck.test.tsx` | + тесты на `recheck` |
| `src/features/updater/updaterContext.tsx` | новый: `UpdaterContext` + `useUpdater` |
| `src/app/WorkflowApp.tsx` | обернуть в провайдер; пропсы в `Titlebar` |
| `src/features/shell/Titlebar.tsx` | + опц. пропсы + иконка-кнопка |
| `src/features/shell/Titlebar.test.tsx` | + тест кнопки |
| `src/features/settings/AboutPane.tsx` | + группа Updates (кнопка + статус) |
| `src/features/settings/AboutPane.test.tsx` | новый |
