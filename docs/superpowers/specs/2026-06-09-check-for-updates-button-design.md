# Manual "Check for updates" button — design

**Дата:** 2026-06-09 · **Статус:** spec, ожидает ревью · **Связ. фича:**
[auto-update](archive/2026-06-07-auto-update-design.md) (этот спек — её deferred
follow-up: «a manual 'Check for updates' button in Settings → About»).

## Цель

Дать пользователю вручную запустить проверку обновлений из двух мест:

1. иконка-кнопка в тайтлбаре (быстрый доступ без открытия настроек);
2. кнопка в Settings → About (рядом со строкой версии).

**Всё общение с пользователем — через тост.** По нажатию кнопки запускается
проверка, и **всегда появляется тост**, содержимое которого зависит от
результата:

- идёт проверка → loading-тост «Checking for updates…»;
- обновление найдено → тост с действиями «Update now» / «Later» (как сейчас при
  автопроверке);
- обновлений нет → тост «You're on the latest version.» (сам исчезает);
- ошибка → тост «Couldn't check for updates.» (сам исчезает);
- загрузка/ошибка установки → как сейчас (`downloading` / `installError`).

Инлайн-статуса в About нет — панель содержит только кнопку.

**Авто-проверка на старте остаётся «тихой»:** тост показывается только если
найдено обновление (текущее поведение). Тост «You're on the latest version» и
loading «Checking…» появляются **только для ручной проверки** — иначе при каждом
запуске приложения всплывал бы шумный тост. Значит, проверка должна помечаться
как ручная (manual) либо автоматическая (mount).

Все UI-строки — английские (как и весь остальной интерфейс приложения).

## Контекст (что уже есть)

- `src/features/updater/useUpdateCheck.ts` — хук-машина состояний над
  `@tauri-apps/plugin-updater`. Фазы: `idle | checking | available | upToDate |
  downloading | installError | error`. Сейчас проверяет обновление **только один
  раз при монтировании** (`useEffect` с пустыми зависимостями); метода для
  повторной проверки нет. Экспортирует `install()` и `dismiss()`.
- `src/features/updater/UpdateToast.tsx` — headless-компонент: показывает один
  sonner-тост для фаз `available` / `downloading` / `installError`, гасит его для
  остальных. **Будет расширен** (см. §5): для ручной проверки добавляются
  `checking` / `upToDate` / `error`.
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

### 1. `useUpdateCheck` — `recheck()` + флаг `manual`

Вынести логику проверки из mount-`useEffect` в стабильный
`recheck = useCallback(...)`, который вызывается и на mount, и наружу.

- `recheck()` ставит `phase: "checking"`, затем по результату — `available`
  (с `version`, сохранив `Update` в `updateRef`) / `upToDate` / `error`.
- **Флаг `manual`** в возвращаемом состоянии: `recheck()` извне ставит
  `manual: true`; авто-вызов на mount — `manual: false`. Тост по нему решает,
  показывать ли результат «тихих» фаз (`checking` / `upToDate` / `error`).
- **Guard:** если уже идёт `checking` или `downloading` — no-op (через
  `inFlightRef`), чтобы повторные клики не накладывались и не запускали загрузку
  дважды. `install()` тоже выставляет `inFlight`, чтобы `recheck` не вмешивался в
  идущую загрузку.
- Сохранить unmount-safety: `mountedRef`, чтобы не звать `setState` после
  размонтирования.
- `install()` и `dismiss()` — поведение без изменений. `recheck` и `manual`
  добавляются в интерфейс `UseUpdateCheck`.

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
  `animate-spin`, кнопка `disabled` (защита от двойного клика; результат всё равно
  придёт тостом);
- `available` → тултип «Update available»;
- иначе → тултип «Check for updates».

`aria-label` кнопки — «Check for updates» (стабильный, для тестов). Пропсы
опциональны ⇒ существующие рендеры `Titlebar` в тестах не трогаем. `WorkflowApp`
передаёт `onCheckForUpdates={update.recheck}` и `updatePhase={update.phase}`.

### 4. Settings → About — кнопка

В `AboutPane` через `useUpdater()` добавить группу `SettingsGroup title="Updates"`
с **одной кнопкой** «Check for updates» (стиль мелких кнопок приложения; `onClick`
→ `recheck`; `disabled`, пока `checking` / `downloading`). Инлайн-статуса нет —
результат показывает тост.

### 5. `UpdateToast` — добавить результат ручной проверки

Расширить headless-логику. Тост по-прежнему морфит один и тот же `id` через
фазы. Поведение:

- `available` → тост с действиями «Update now» / «Later» (как сейчас) — **всегда**
  (и при авто-, и при ручной проверке).
- `downloading` → loading «Downloading… N%» — **всегда**.
- `installError` → error «Update failed.» + «Retry» / «Later» — **всегда**.
- `checking` → loading «Checking for updates…» — **только если `manual`**.
- `upToDate` → success «You're on the latest version.» с конечной длительностью
  (сам исчезает) — **только если `manual`**.
- `error` → error «Couldn't check for updates.» с конечной длительностью —
  **только если `manual`**.
- `idle` → погасить наш тост.

Авто-проверка на старте (`manual: false`): `checking` / `upToDate` / `error` тост
не рождают (тихо), `available` — рождает. Это сохраняет текущее «тихое» поведение
старта.

`UpdateToast` получает новый проп `manual: boolean`; `WorkflowApp` передаёт
`manual={update.manual}`.

## Тестирование (TDD)

- `useUpdateCheck.test.tsx` (дополнить): `recheck()` повторно зовёт `check` и
  переводит в `available`; `recheck()` ставит `manual: true`, авто-mount —
  `manual: false`; `recheck()` — no-op во время `downloading`.
- `UpdateToast.test.tsx` (дополнить): при `manual` фаза `upToDate` → success-тост
  «You're on the latest version.»; `error` → error-тост; `checking` → loading.
  При `manual: false` те же фазы тост не показывают; `available` показывает в
  обоих случаях.
- `Titlebar.test.tsx` (дополнить): при переданном `onCheckForUpdates` есть кнопка
  с `aria-label` «Check for updates», клик вызывает колбэк; при
  `updatePhase="checking"` кнопка `disabled`.
- `AboutPane.test.tsx` (новый): кнопка «Check for updates» есть; клик зовёт
  `recheck`. Рендер под `UpdaterContext.Provider` с фейковым значением; мок
  `@/ipc/client` (`ipc.appVersion`).
- `updaterContext` (опционально): `useUpdater()` бросает вне провайдера.
- `WorkflowApp.test.tsx`: существующий тест тоста остаётся зелёным; провайдер
  внутренний ⇒ churn нет.

Полный прогон `pnpm test` + `pnpm lint` зелёные.

## Вне scope

- Периодические проверки по таймеру.
- Рендер changelog / release notes в тосте.
- Apple notarization / Windows Authenticode (отдельные deferred follow-up'ы
  основной фичи).

## Файлы

| Файл | Изменение |
|------|-----------|
| `src/features/updater/useUpdateCheck.ts` | + `recheck()`, флаг `manual`, guard, в интерфейс |
| `src/features/updater/useUpdateCheck.test.tsx` | + тесты на `recheck` / `manual` |
| `src/features/updater/updaterContext.tsx` | новый: `UpdaterContext` + `useUpdater` |
| `src/features/updater/UpdateToast.tsx` | + результат ручной проверки (`checking`/`upToDate`/`error`), проп `manual` |
| `src/features/updater/UpdateToast.test.tsx` | + тесты manual-фаз |
| `src/app/WorkflowApp.tsx` | обернуть в провайдер; пропсы в `Titlebar`; `manual` в `UpdateToast` |
| `src/features/shell/Titlebar.tsx` | + опц. пропсы + иконка-кнопка |
| `src/features/shell/Titlebar.test.tsx` | + тест кнопки |
| `src/features/settings/AboutPane.tsx` | + группа Updates (одна кнопка) |
| `src/features/settings/AboutPane.test.tsx` | новый |
