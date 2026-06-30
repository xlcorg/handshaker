# Сохранение тела ответа в файл

**Статус:** 📝 СПЕКА (дизайн утверждён 2026-06-30; план + исполнение — TBD).
**Ветка:** `claude/pedantic-colden-c29193`
**Дата:** 2026-06-30

## Цель

Сейчас тело gRPC-ответа можно только смотреть во вьюере (read-only Monaco,
`BodyView mode="response"`) и копировать отдельные значения / сохранять отдельные
base64-значения в файл (правый клик → `Save decoded base64 to file…` /
`Save base64 to file…`). **Нельзя сохранить весь ответ целиком в файл.**

Добавляем возможность сохранить **тело ответа** (pretty-printed JSON) в файл через
нативный диалог «Save As» — из двух точек входа:

1. **пункт контекстного меню** во вьюере ответа («Save response to file…»);
2. **иконка** в шапке панели ответа.

Обе аффордансы делают одно и то же и переиспользуют один общий код.

## Не-цели (v1 scope, YAGNI)

- **Сохранение метаданных** (status, trailers, headers, тайминг/размер) — отвергнуто:
  пользователь выбрал «только тело». Полная «запись вызова» — кандидат на отдельную
  фичу.
- **Выбор формата при сохранении** (body-only vs full record) — не делаем: одна
  команда, одно поведение.
- **Экспорт нескольких ответов / истории разом** — вне scope.
- **Сохранение ошибочных ответов** — у gRPC unary-ошибки тела нет (`response_json`
  = `None`), сохранять нечего. Аффорданса нет при error/idle/sending.
- **Выбор pretty vs compact** — не нужен: `response_json` уже приходит pretty
  (бэкенд сериализует через `serde_json::Serializer::pretty`,
  `grpc/transport/tonic_impl.rs`), сохраняем его **verbatim**.

## Ключевые факты кодовой базы (проверено)

- Полное тело ответа лежит в `outcome.response_json: Option<String>` и **уже
  pretty-printed**. Отображение в Monaco может быть **элидировано** (`elide.ts`,
  preview + бейдж размера у больших значений) — значит, сохранять надо именно
  `response_json`, а **не** `editor.getValue()`.
- Имя метода (`step.method`, короткое — напр. `GetUser`) доступно там, где
  рендерится `ResponsePanel` (через `ResponseSlot`), в т.ч. в history-режиме.
- **Прецедент сохранения в файл уже есть**: `commands/base64.rs` содержит приватный
  хелпер `save_bytes_via_dialog` (неблокирующий нативный Save-As через
  `tauri-plugin-dialog` + `std::fs::write`, `Ok(Some(path))`/`Ok(None)`/`Err`) и
  публичные команды `base64_save` / `base64_save_encoded`. Хелпер переиспользуем,
  но сейчас заперт в модуле base64; публичные команды — base64-специфичны.
- `src/ipc/bindings.ts` — **git-tracked** (не gitignored): регенерацию коммитим
  вместе с IPC-изменением.
- Все user-facing строки → `src/lib/messages.ts` (правило `.claude/rules/ui-strings.md`).

## Выбранный подход (Подход 1 из брейншторма)

Обобщённая IPC-команда «записать текст в выбранный файл» + общий фронтенд-хелпер,
который дёргают обе поверхности. Имя файла строит фронт (чистая, тестируемая функция).
Команды `base64_save*` остаются нетронутыми (ноль риска регресса).

Отвергнутые на брейншторме альтернативы: **Подход 2** (имя файла считает бэкенд) —
логика именования уходит из тестируемого FE-слоя, таймстамп из системных часов Rust;
**Подход 3** (свернуть `base64_save_encoded` в обобщённую команду) — трогает уже
отгруженную рабочую команду. Подходы 1 и 3 сходятся к одной обобщённой команде;
выбран 1 как наименее рискованный.

## Архитектура

### Бэкенд (Rust)

- **Новый модуль `src-tauri/src/commands/dialog.rs`.** Переносим
  `save_bytes_via_dialog` сюда как `pub(crate) async fn`; `commands/base64.rs`
  начинает звать его оттуда (поведение base64 не меняется — это чистый рефактор-переезд).
- **Новая команда** `file_save_text(app, text: String, default_name: String)
  -> Result<Option<String>, String>`: пишет `text.as_bytes()` через
  `save_bytes_via_dialog`. Семантика результата как у base64: `Ok(Some(path))` =
  сохранено · `Ok(None)` = отменено пользователем · `Err(msg)` = ошибка диалога/записи.
  **Без extension-фильтра** на диалоге (та же причина, что у base64: на macOS
  `NSSavePanel` залочил бы расширение и не дал выбрать своё); `.json` несёт
  `default_name` как предложение, не клетка.
- **Регистрация** в `lib.rs`: добавить в `tauri::generate_handler!`/specta-collect →
  **регенерировать `src/ipc/bindings.ts`** и закоммитить.

### Фронтенд

- **Чистый модуль `src/features/response/responseFileName.ts`:**
  `responseFileName(method: string, now: Date): string`.
  - Метод непустой → `<sanitized-method>-<ts>.json`.
  - Метод пустой/пробельный → `response-<ts>.json` (фолбэк).
  - `sanitized-method`: оставить безопасные для имени файла символы (буквы/цифры/`_`/`-`),
    прочее заменить/выкинуть (`step.method` — обычно голый идентификатор, но санитайзим
    защитно).
  - `<ts>`: filesystem-safe таймстамп `YYYY-MM-DDTHH-MM-SS` (двоеточия времени → `-`).
  - Чистая (детерминированная при заданном `now`) → юнит-тест в vitest.
- **IPC-обёртка** `fileSaveText(text, defaultName): Promise<string | null>` в
  `src/ipc/client.ts` (зеркало существующих `base64Save`/`base64SaveEncoded`).
- **Оркестратор `src/features/response/saveResponse.ts`:**
  `saveResponseToFile(text: string, method: string): void` — строит имя через
  `responseFileName(method, new Date())`, зовёт `fileSaveText`, репортит тостом
  (паттерн `reportSave`): успех → `Saved to <path>` · отмена (`null`) → без тоста ·
  ошибка → error-тост. Это переиспользуют **обе** поверхности.
- **Пункт контекстного меню** (BodyView, response-mode): document-wide экшен
  «Save response to file…», вешается рядом с `foldActions` (Collapse/Expand all —
  тоже document-wide). BodyView получает **опциональный проп** `onSaveBody?: () => void`
  (response-only) и регистрирует экшен, только когда он задан; экшен `run` зовёт
  `onSaveBody()`. BodyView не знает про имя файла/метод — это owns родитель. Экшен
  без keybinding (только `contextMenuGroupId`), как fold/decode-экшены.
- **Иконка в шапке** `ResponsePanel` (в правом кластере рядом с `RespMeta`): кнопка-иконка
  `Download` (lucide), тултип «Save response to file». **Видна только** когда есть
  сохраняемое тело (`state === "success"` && `outcome?.response_json != null`). Клик →
  тот же `saveResponseToFile`.
- **Проводка метода:** `ResponseSlot` передаёт `method={step.method}` в `ResponsePanel`
  (доступен всегда). `ResponsePanel` строит замыкание
  `onSaveBody = () => saveResponseToFile(json, method)` и (а) вешает его на иконку,
  (б) пробрасывает вниз через `ResponseBody` → `BodyView` как `onSaveBody`.

## Поток данных

```
outcome.response_json (полный pretty JSON)
        │
        ├─► ResponsePanel (method=step.method)
        │     onSaveBody = () => saveResponseToFile(json, method)
        │        ├─► иконка Download (success+body)         ┐
        │        └─► ResponseBody → BodyView(onSaveBody)    │ обе зовут
        │              context-menu «Save response to file…»┘ один хелпер
        │
        └─► saveResponseToFile(text, method)
              responseFileName(method, new Date())  → "GetUser-2026-06-30T15-30-12.json"
              fileSaveText(text, defaultName)        → IPC
                 file_save_text(text, default_name)  (Rust)
                    save_bytes_via_dialog            → нативный Save-As + fs::write
                       Ok(Some(path)) | Ok(None) | Err
              тост: Saved to <path> | (тишина при отмене) | error
```

## Краевые случаи и решения

- **Элизия:** сохраняем `response_json` целиком, не текст редактора.
- **Только success-тело:** иконка скрыта при idle/error/sending; пункт меню есть лишь
  там, где рендерится BodyView (success-тело). У unary-ошибки тела нет — консистентно.
- **Отмена диалога** (`Ok(None)`): без тоста (не ошибка).
- **Пустой/пробельный метод:** фолбэк-имя `response-<ts>.json`.
- **Дубликаты по таймстампу:** таймстамп с точностью до секунды делает имена
  практически уникальными между сохранениями; перезапись существующего файла —
  ответственность нативного диалога (он сам спрашивает overwrite).

## Строки (messages.ts)

Namespace `response` (создать при отсутствии):

- `saveToFileMenu` → `"Save response to file…"` (метка пункта меню — многоточие
  сигналит «откроется диалог», конвенция Monaco/нативных меню).
- `saveToFileTooltip` → `"Save response to file"` (тултип иконки — без многоточия).
- **Централизовать** сейчас-инлайновые тосты из `BodyView.tsx`:
  `savedTo(path) => \`Saved to ${path}\`` и `saveFailed => "Couldn't save"`
  (правило ui-strings; затрагивает и существующие base64-save-тосты — заменить инлайны
  на ссылки на `messages.response.*`).

## Тестирование

- **vitest:**
  - `responseFileName`: метод присутствует → `<method>-<ts>.json`; пустой → `response-<ts>.json`;
    санитизация небезопасных символов; формат таймстампа (детерминированно при фиксированном `now`).
  - BodyView (response-mode): экшен «Save response to file…» присутствует и его `run`
    вызывает `onSaveBody`; в request-mode экшена нет.
  - ResponsePanel: иконка видна только при success+body; клик зовёт сохранение (мок IPC).
- **Rust:** путь нативного диалога не юнит-тестируем (как и у base64 — там тесты
  покрывают только `inspect_impl`). Гейт — компиляция + существующие тесты зелёные.
- **Гейт фичи:** `cargo test --workspace` · vitest · `tsc -b` · `vite build` ·
  bindings no-drift.
- **Остаток после code-complete:** живой WebView2-проход (реальный success-ответ:
  правый клик → Save → файл записан с правильным именем; иконка в шапке — то же;
  отмена — без тоста; большое элидированное тело сохраняется целиком).

## Источники

- Прецедент в репозитории: `src-tauri/src/commands/base64.rs`
  (`save_bytes_via_dialog`, `base64_save_encoded`), спека
  `docs/superpowers/specs/archive/2026-06-15-base64-value-decoder-design.md`.
- Pretty-сериализация ответа: `crates/handshaker-core/src/grpc/transport/tonic_impl.rs`
  (`serde_json::Serializer::pretty`).
