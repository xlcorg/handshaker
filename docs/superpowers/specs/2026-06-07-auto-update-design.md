# Автообновление приложения — дизайн

**Статус:** дизайн утверждён, готов к плану · **Дата:** 2026-06-07 · **Ветка:** `worktree-feat+auto-update`

## Проблема / цель

Разработка идёт на Windows, проверять программу нужно на рабочем MacBook. Сейчас
нет ни сборки десктоп-бандлов, ни механизма доставки новых версий. Цель — полный
конвейер **автообновления в стиле Postman**: приложение само проверяет наличие
новой версии при старте, показывает ненавязчивый баннер и по согласию пользователя
скачивает и ставит апдейт с перезапуском.

Платформы: **macOS + Windows**. Хостинг обновлений: **GitHub Releases** на публичном
репозитории (`xlcorg/handshaker` делается публичным). UX: **спросить пользователя**
(не тихо, не только вручную).

### Текущее состояние (что мешает)

- [src-tauri/tauri.conf.json](../../../src-tauri/tauri.conf.json): `bundle.active: false` —
  установщики/бандлы не собираются вообще.
- [package.json](../../../package.json): скрипт `tauri:build` идёт с `--no-bundle` —
  собирается голый бинарь.
- `.github/workflows/` отсутствует — CI нет.
- Updater-плагин не подключён (ни Rust, ни JS).

## Решение (обзор)

Четыре изолированных части, каждая со своей ответственностью и чёткой границей:

1. **Updater-движок** (`tauri-plugin-updater` + `tauri-plugin-process`) — даёт
   API `check() → downloadAndInstall() → relaunch()`. Не пишем, конфигурируем.
2. **Bundle/updater-конфиг** в `tauri.conf.json` — включаем бандлинг и артефакты
   апдейтера, прописываем публичный ключ и endpoint.
3. **CI релиз-воркфлоу** `.github/workflows/release.yml` — по git-тегу `v*` собирает,
   подписывает и публикует Release с `latest.json` через `tauri-apps/tauri-action`.
4. **In-app UX** `src/features/updater/` — хук `useUpdateCheck()` + баннер
   `UpdateBanner`. Проверка один раз при старте; баннер «Доступна версия X» с
   «Обновить» / «Позже».

Границы: UI знает только про хук → хук знает только про плагин-API → CI и конфиг
независимы от фронта.

## Детали по частям

### 1. Updater-движок (Rust + JS)

**Rust** (`src-tauri`):
- Зависимости (workspace-pinned, версия `2`): `tauri-plugin-updater`,
  `tauri-plugin-process` (нужен для перезапуска после установки).
- В `lib.rs` (билдер Tauri): `.plugin(tauri_plugin_updater::Builder::new().build())`
  и `.plugin(tauri_plugin_process::init())`.

**JS** (`src`): `@tauri-apps/plugin-updater`, `@tauri-apps/plugin-process`.

**ACL** ([src-tauri/capabilities/default.json](../../../src-tauri/capabilities/default.json)):
добавить `updater:default` и `process:allow-restart` (минимально-достаточные
разрешения; не `process:default`, чтобы не открывать лишнее).

### 2. Bundle / updater-конфиг (`tauri.conf.json`)

```jsonc
{
  "bundle": {
    "active": true,                 // было false
    "createUpdaterArtifacts": true, // генерировать .sig + latest.json
    "targets": "all"
  },
  "plugins": {
    "updater": {
      "pubkey": "<содержимое handshaker.key.pub>",
      "endpoints": [
        "https://github.com/xlcorg/handshaker/releases/latest/download/latest.json"
      ]
    }
  }
}
```

Также убрать `--no-bundle` из скрипта `tauri:build` в `package.json` (или завести
отдельный `tauri:build:bundle`) — иначе CI соберёт без бандлов.

> **macOS-таргет:** собираем **universal** (`--target universal-apple-darwin`) —
> один артефакт на Intel и Apple Silicon, один `latest.json` проще. Требует обоих
> Rust-таргетов на раннере (`tauri-action` ставит сам).

### 3. Подпись — три независимых механизма

#### 3.1. Подпись обновления (minisign) — обязательна

Пара ключей через `pnpm tauri signer generate -w ~/.tauri/handshaker.key` (с паролем).
- **Приватный ключ никогда не коммитим.**
- Публичный → `plugins.updater.pubkey` в `tauri.conf.json`.
- Приватный + пароль → GitHub Secrets: `TAURI_SIGNING_PRIVATE_KEY`,
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. CI ими подписывает артефакты; приложение
  проверяет подпись публичным ключом перед установкой.

Назначение: endpoint публичный, без подписи подменённый ответ привёл бы к установке
вредоносного апдейта с полными правами. К ОС эта подпись отношения не имеет.

#### 3.2. Подпись для ОС — прагматично, ad-hoc

- **macOS:** ad-hoc подпись (`signingIdentity: "-"`). На Apple Silicon ядро не
  запускает вообще неподписанный arm64-бинарь → без подписи «damaged». Ad-hoc даёт
  запуск; Gatekeeper при первом старте покажет «unidentified developer» → правый
  клик → «Открыть» (один раз на машину). Бесплатно, Apple-аккаунт не нужен.
- **Windows:** без сертификата SmartScreen покажет «Windows protected your PC» →
  «Подробнее» → «Всё равно запустить». Установщик и апдейтер работают.

#### 3.3. Вне scope (follow-up, не ломает архитектуру)

Полноценная подпись Apple Developer ID + нотаризация ($99/год) и Authenticode для
Windows. Добавляются позже только добавлением секретов и полей в CI — без правок
приложения и апдейтера.

> **Честная оговорка:** связка «ad-hoc + самозамена бандла апдейтером» в редких
> конфигурациях macOS может требовать повторного подтверждения после апдейта.
> Поэтому первый end-to-end апдейт — ручной шаг верификации.

### 4. CI релиз-воркфлоу (`.github/workflows/release.yml`)

- **Триггер:** push тега `v*`.
- **Матрица:** `macos-latest` (universal-apple-darwin) + `windows-latest`.
- **Шаги:** checkout → setup Node + pnpm → setup Rust (+ таргеты для mac) →
  `pnpm install` → `tauri-apps/tauri-action@v0` с `tagName`/`releaseName`,
  собирающий, подписывающий и публикующий Release с артефактами и `latest.json`.
- **Секреты:** `GITHUB_TOKEN` (встроенный, для публикации Release),
  `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

`latest.json` `tauri-action` генерирует сам из собранной версии; он попадает в тот же
Release, на который смотрит endpoint (`releases/latest/download/latest.json`).

### 5. In-app UX (`src/features/updater/`)

- **`useUpdateCheck()`** — хук-обёртка над `check()` из `@tauri-apps/plugin-updater`.
  Состояния: `idle → checking → available(update) | upToDate | error`; при согласии
  `downloading(progress) → готово`. Изолирует UI от плагин-API.
- **`UpdateBanner`** — ненавязчивый баннер «Доступна версия X». Кнопки «Обновить»
  (→ `downloadAndInstall()` с прогрессом, затем `relaunch()` из
  `@tauri-apps/plugin-process`) и «Позже» (скрыть до следующего запуска).
- **Триггер:** одна проверка при старте приложения. Авто-проверки по таймеру нет (YAGNI).
- Стилистика — в духе существующих типизированных тостов/баннеров проекта.

### 6. Версионирование и процесс релиза

Версия живёт в трёх файлах: `package.json`, `tauri.conf.json`, `Cargo.toml`. Апдейтер
сравнивает (semver) версию из `tauri.conf.json` собранного приложения с версией в
`latest.json`. **Git-тег версию не задаёт** — её задают файлы; тег лишь триггерит CI.

Процесс: поднять версию в файлах → коммит → `git tag vX.Y.Z` → `git push origin vX.Y.Z`
→ CI публикует Release.

**Единый источник правды (детали — в плане):** рекомендуемый вариант — убрать
`version` из `tauri.conf.json` (Tauri возьмёт из `package.json`), оставив синхрон
двух файлов. Альтернативы: скрипт `pnpm version:bump <x.y.z>` или ручной чек-лист.

## Тестирование

- **Хук/компонент апдейтера — по TDD.** Тесты на переходы состояний `useUpdateCheck`
  и поведение `UpdateBanner`; мокаем `@tauri-apps/plugin-updater` (`check` →
  объект апдейта / null / throw) и `@tauri-apps/plugin-process`. Покрывает
  UI-логику без реального бэкенда. Базовый прогон сейчас — 539 тестов зелёные.
- **CI** — проверяется фактом успешной сборки на первом теге (напр. `v0.1.0`).
- **End-to-end апдейт — ручной шаг.** Ставим `v0.1.0` на мак, пушим `v0.1.1`,
  убеждаемся: баннер появился, обновление встало, перезапуск прошёл.

## Вне scope (YAGNI)

Нотаризация Apple, подпись Windows, поэтапный rollout, дельта-апдейты, отдельный
публичный releases-репо, авто-проверка по таймеру, откат версий, changelog-рендер в
баннере. Всё — потенциальные follow-up'ы, ни один не требует переписывания ядра.

## Источники (Tauri 2, проверено через context7 / доку)

- Updater-плагин (конфиг, ключи, endpoints): https://v2.tauri.app/plugin/updater/
- Генерация ключей: `tauri signer generate`
- CI с tauri-action + подпись macOS: https://v2.tauri.app/distribute/pipelines/github/
  и https://v2.tauri.app/distribute/sign/macos/
- Tauri 2.11 (workspace-pinned), плагины версии `2`.
