# Сохранение тела ответа в файл

**Статус:** 📝 СПЕКА (дизайн утверждён 2026-06-30, уточнён 10 вопросами; план +
исполнение — TBD).
**Ветка:** `claude/pedantic-colden-c29193`
**Дата:** 2026-06-30

## Цель

Сейчас тело gRPC-ответа можно только смотреть во вьюере (read-only Monaco,
`BodyView mode="response"`) и копировать отдельные значения / сохранять отдельные
base64-значения в файл (правый клик → `Save decoded base64 to file…` /
`Save base64 to file…`). **Нельзя сохранить весь ответ целиком в файл.**

Добавляем возможность сохранить **тело ответа** (pretty-printed JSON) в файл через
нативный диалог «Save As» — из трёх точек входа:

1. **пункт контекстного меню** во вьюере ответа («Save response to file…»);
2. **иконка** `Download` в шапке панели ответа;
3. **хоткей `Ctrl/Cmd+S`**, когда фокус в панели ответа.

Все три аффордансы делают одно и то же и переиспользуют один общий код. После
сохранения — тост с кнопкой **«Show in folder»** (reveal-in-folder).

## Не-цели (v1 scope, YAGNI)

- **Сохранение метаданных** (status, trailers, headers, тайминг/размер) — отвергнуто:
  пользователь выбрал «только тело». Полная «запись вызова» — кандидат на отдельную
  фичу.
- **Save для тела запроса** (симметрия) — вне scope: запрос редактируем и легко
  копируется. Общий хелпер делаем универсальным, но проводим только в ответ.
- **Выбор формата при сохранении** (body-only vs full record) — не делаем.
- **Выбор pretty vs compact** — не нужен: `response_json` приходит pretty (бэкенд:
  `serde_json::Serializer::pretty`, `grpc/transport/tonic_impl.rs`), сохраняем verbatim.
- **Персист папки сохранения между запусками** — нет: полагаемся на системный диалог
  (он сам помнит последнюю папку в пределах сессии). Без нового pref.
- **Ограничение/предупреждение на большие тела** — нет: локальная запись файла быстра,
  пишем как есть.
- **Экспорт нескольких ответов / истории разом** — вне scope.
- **Сохранение ошибочных ответов** — у gRPC unary-ошибки тела нет (`response_json`
  = `None`), сохранять нечего; аффорданс отсутствует при error/idle/sending.

## Решения по 10 уточняющим вопросам (2026-06-30)

| # | Вопрос | Решение |
|---|--------|---------|
| 1 | Кодировка / переводы строк | **UTF-8, LF verbatim** (пишем `response_json` как есть) |
| 2 | Папка по умолчанию | **Системная** (без персиста) |
| 3 | Хоткей | **Ctrl/Cmd+S** при фокусе в ответе |
| 4 | Фильтр расширений | **Без фильтра**, `.json` в имени |
| 5 | Иконка | **Download** (lucide) |
| 6 | History-режим | **Везде, где есть тело** (и активный черновик, и история) |
| 7 | Таймстамп | **Локальное время** |
| 8 | Тост | **«Show in folder»** (reveal-in-folder) |
| 9 | Симметрия с запросом | **Только ответ** |
| 10 | Большие тела | **Без ограничений** |

## Ключевые факты кодовой базы (проверено)

- Полное тело ответа лежит в `outcome.response_json: Option<String>` и **уже
  pretty-printed**. Отображение в Monaco может быть **элидировано** (`elide.ts`,
  preview + бейдж размера) — значит, сохранять надо именно `response_json`, а **не**
  `editor.getValue()`.
- Имя метода (`step.method`, короткое — напр. `GetUser`) доступно там, где
  рендерится `ResponsePanel` (через `ResponseSlot`), **в т.ч. в history-режиме**.
- **Прецедент сохранения в файл уже есть**: `commands/base64.rs` содержит приватный
  хелпер `save_bytes_via_dialog` (неблокирующий нативный Save-As через
  `tauri-plugin-dialog` + `std::fs::write`; `Ok(Some(path))`/`Ok(None)`/`Err`) и
  публичные команды `base64_save` / `base64_save_encoded`. Хелпер переиспользуем,
  но заперт в модуле base64; публичные команды base64-специфичны.
- **Тост с action-кнопкой**: sonner уже умеет (паттерн в `updater/UpdateToast.tsx`).
  Гоча (память `project_sonner_button_gotchas`): action-кнопка авто-закрывает тост —
  для «Show in folder» это ок (после reveal тост и так не нужен).
- **`tauri-plugin-opener` в проекте НЕТ** — нужен для reveal-in-folder (новая
  зависимость, см. ниже).
- `src/ipc/bindings.ts` — **git-tracked**: регенерацию коммитим вместе с IPC.
- Все user-facing строки → `src/lib/messages.ts` (правило `.claude/rules/ui-strings.md`).
- Хоткеи в проекте — чистый предикат + capture/scoped listener (паттерн
  `src/features/shell/*`: zoom/wordWrap/splitDirection; память
  `project_env_cycle_hotkey_done`): матчить **физическую** клавишу `e.code`, гарды
  AltGr/Shift/repeat.

## Выбранный подход (Подход 1 из брейншторма)

Обобщённая IPC-команда «записать текст в выбранный файл» + общий фронтенд-хелпер,
который дёргают все поверхности. Имя файла строит фронт (чистая, тестируемая функция).
Команды `base64_save*` остаются нетронутыми. Отвергнуты: Подход 2 (имя считает бэкенд —
логика именования уходит из тестируемого FE-слоя) и Подход 3 (свернуть
`base64_save_encoded` — трогает отгруженную команду).

## Архитектура

### Бэкенд (Rust)

- **Новый модуль `src-tauri/src/commands/dialog.rs`.** Переносим
  `save_bytes_via_dialog` сюда как `pub(crate) async fn`; `commands/base64.rs` зовёт
  его оттуда (чистый рефактор-переезд, поведение base64 не меняется).
- **Новая команда** `file_save_text(app, text: String, default_name: String)
  -> Result<Option<String>, String>`: пишет `text.as_bytes()` (UTF-8 verbatim, без
  трансформации переводов строк) через `save_bytes_via_dialog`. `Ok(Some(path))` =
  сохранено · `Ok(None)` = отменено · `Err(msg)` = ошибка. **Без extension-фильтра**
  (macOS `NSSavePanel` иначе лочит расширение); `.json` несёт `default_name`.
- **Новая зависимость `tauri-plugin-opener`** (для «Show in folder»): добавить в
  `src-tauri/Cargo.toml` (workspace) + `@tauri-apps/plugin-opener` в `package.json`,
  инициализировать `.plugin(tauri_plugin_opener::init())` в `lib.rs`, выдать
  permission `opener:allow-reveal-item-in-dir` в capability-файле. Reveal зовётся
  **с фронта** (`revealItemInDir(path)`) — отдельная IPC-команда не нужна.
- **Регистрация** `file_save_text` в `lib.rs` (`generate_handler!` + specta) →
  **регенерировать `src/ipc/bindings.ts`** и закоммитить.

### Фронтенд

- **Чистый модуль `src/features/response/responseFileName.ts`:**
  `responseFileName(method: string, now: Date): string`.
  - Метод непустой → `<sanitized-method>-<ts>.json`; пустой/пробельный →
    `response-<ts>.json`.
  - `sanitized-method`: безопасные символы (буквы/цифры/`_`/`-`), прочее выкинуть.
  - `<ts>`: **локальное** время, filesystem-safe `YYYY-MM-DDTHH-MM-SS` (берём
    локальные компоненты `Date`, двоеточия → `-`). Чистая (детерминированная при
    заданном `now`) → юнит-тест.
- **IPC-обёртка** `fileSaveText(text, defaultName): Promise<string | null>` в
  `src/ipc/client.ts`.
- **Оркестратор `src/features/response/saveResponse.ts`:**
  `saveResponseToFile(text: string, method: string): void` — строит имя через
  `responseFileName(method, new Date())`, зовёт `fileSaveText`, и репортит:
  - успех → тост `Saved to <path>` **с action-кнопкой «Show in folder»**, которая
    зовёт `revealItemInDir(path)` (`@tauri-apps/plugin-opener`);
  - отмена (`null`) → без тоста;
  - ошибка → error-тост `Couldn't save`.
- **Пункт контекстного меню** (BodyView, response-mode): document-wide экшен
  «Save response to file…», вешается рядом с `foldActions`. BodyView получает
  опциональный проп `onSaveBody?: () => void` (response-only) и регистрирует экшен,
  только когда он задан; `run` зовёт `onSaveBody()`. Экшен без keybinding (только
  `contextMenuGroupId`).
- **Хоткей `Ctrl/Cmd+S`** (новый чистый модуль `src/features/response/saveHotkey.ts`):
  предикат `isSaveResponseHotkey(e)` (физ. `e.code === "KeyS"`, Ctrl/Cmd, гарды
  AltGr/Shift/Alt/repeat). Слушатель вешается на **корневой контейнер
  `ResponsePanel`** (`onKeyDown`), что естественно скоупит его на focus-within
  (Monaco не биндит Ctrl+S → keydown всплывает); при срабатывании `preventDefault`
  (гасит «save page» WebView2) + зовёт сохранение. Гейт: только когда есть
  сохраняемое тело. **Намеренно НЕ через Monaco `addCommand`** — он глобальный/
  last-wins и затёр бы биндинг в редакторе запроса (память
  `project_monaco_addcommand_global`).
- **Иконка в шапке** `ResponsePanel`: кнопка-иконка `Download` (lucide), тултип
  «Save response to file». **Видна только** при `state === "success"` &&
  `outcome?.response_json != null`. Клик → тот же `saveResponseToFile`.
- **Проводка метода:** `ResponseSlot` передаёт `method={step.method}` в
  `ResponsePanel` (доступен всегда, в т.ч. history). `ResponsePanel` строит
  `onSaveBody = () => saveResponseToFile(json, method)` и (а) вешает на иконку,
  (б) на хоткей, (в) пробрасывает вниз через `ResponseBody` → `BodyView`.

## Поток данных

```
outcome.response_json (полный pretty JSON)  +  method = step.method
        │
        ▼
ResponsePanel: onSaveBody = () => saveResponseToFile(json, method)
   ├─► иконка Download (видна при success+body)
   ├─► Ctrl/Cmd+S (onKeyDown на корне панели, focus-within, preventDefault)
   └─► ResponseBody → BodyView(onSaveBody)
         context-menu «Save response to file…» (document-wide)
        │
        ▼
saveResponseToFile(text, method)
   responseFileName(method, new Date())  → "GetUser-2026-06-30T15-30-12.json"
   fileSaveText(text, defaultName)        → IPC file_save_text
       save_bytes_via_dialog              → нативный Save-As + fs::write (UTF-8/LF)
          Ok(Some(path)) | Ok(None) | Err
   тост:
     success → "Saved to <path>" [Show in folder → revealItemInDir(path)]
     cancel  → (тишина)
     error   → "Couldn't save"
```

## Краевые случаи и решения

- **Элизия:** сохраняем `response_json` целиком, не текст редактора.
- **Только success-тело:** иконка/хоткей активны лишь при success+body; пункт меню
  есть там, где рендерится BodyView. У unary-ошибки тела нет — консистентно.
- **History-режим:** аффордансы работают и для прошлых ответов (`method` доступен).
- **Отмена диалога** (`Ok(None)`): без тоста.
- **Пустой/пробельный метод:** фолбэк-имя `response-<ts>.json`.
- **WebView2 «save page»:** хоткей `preventDefault`-ит дефолтное действие.
- **Перезапись файла:** ответственность нативного диалога (он сам спрашивает overwrite).
- **`revealItemInDir` desktop-only:** приложение десктопное (Win/macOS) — ок.

## Строки (messages.ts)

Namespace `response` (создать при отсутствии):

- `saveToFileMenu` → `"Save response to file…"` (пункт меню — многоточие сигналит
  открытие диалога).
- `saveToFileTooltip` → `"Save response to file"` (тултип иконки — без многоточия).
- `showInFolder` → `"Show in folder"` (action-кнопка тоста).
- **Централизовать** сейчас-инлайновые тосты из `BodyView.tsx`:
  `savedTo(path) => \`Saved to ${path}\`` и `saveFailed => "Couldn't save"`
  (правило ui-strings; заменить инлайны на `messages.response.*`, затрагивает и
  существующие base64-save-тосты).

## Тестирование

- **vitest:**
  - `responseFileName`: метод присутствует → `<method>-<ts>.json`; пустой →
    `response-<ts>.json`; санитизация; формат локального таймстампа (детерминированно
    при фиксированном `now`).
  - `isSaveResponseHotkey`: Ctrl/Cmd+S (по `code`) → true; AltGr/Shift/Alt/без
    модификатора/repeat → false.
  - BodyView (response-mode): экшен «Save response to file…» присутствует и его `run`
    зовёт `onSaveBody`; в request-mode экшена нет.
  - ResponsePanel: иконка видна только при success+body; клик и Ctrl/Cmd+S зовут
    сохранение; тост содержит action «Show in folder», клик зовёт `revealItemInDir`
    (мок IPC + плагина opener).
- **Rust:** путь нативного диалога не юнит-тестируем (как у base64). Гейт —
  компиляция + существующие тесты зелёные.
- **Гейт фичи:** `cargo test --workspace` · vitest · `tsc -b` · `vite build` ·
  bindings no-drift.
- **Остаток после code-complete:** живой WebView2-проход (реальный success-ответ:
  правый клик → Save; иконка; Ctrl/Cmd+S; отмена без тоста; «Show in folder»
  открывает Explorer/Finder с выделенным файлом; большое элидированное тело
  сохраняется целиком; русская раскладка для хоткея).

## Источники

- Прецедент: `src-tauri/src/commands/base64.rs` (`save_bytes_via_dialog`,
  `base64_save_encoded`); спека
  `docs/superpowers/specs/archive/2026-06-15-base64-value-decoder-design.md`.
- Pretty-сериализация: `crates/handshaker-core/src/grpc/transport/tonic_impl.rs`.
- `tauri-plugin-opener` `revealItemInDir` + permission `opener:allow-reveal-item-in-dir`:
  [Opener | Tauri](https://v2.tauri.app/plugin/opener/),
  [@tauri-apps/plugin-opener](https://v2.tauri.app/reference/javascript/opener/).
