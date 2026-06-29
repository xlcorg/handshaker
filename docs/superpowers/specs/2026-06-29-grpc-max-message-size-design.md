# Конфигурируемый лимит размера gRPC-сообщения

> **Статус:** 📝 SPEC — дизайн утверждён в брейншторме, план ещё не написан.
> **Дата:** 2026-06-29 · **Ветка:** `claude/hungry-boyd-bddcf6`

## Проблема

При вызове метода, чей ответ больше 4 MiB, приходит ошибка:

```
Error, decoded message length too large: found N bytes, the limit is: 4194304 bytes
```

Это **дефолтный лимит tonic** на размер декодируемого сообщения (`DEFAULT_MAX_RECV_MESSAGE_SIZE = 4 MiB`),
а не баг в коде. Клиент создаёт `tonic::client::Grpc::new(channel)` без настройки лимита
(`crates/handshaker-core/src/grpc/transport/tonic_impl.rs`), поэтому крупные ответы режутся
на декоде. tonic возвращает это как gRPC-статус `OUT_OF_RANGE (11)`, который и показывается
в error-face.

Аналог в C#: `GrpcChannelOptions.MaxReceiveMessageSize` (тоже 4 MB по умолчанию;
превышение → `RpcException` со `StatusCode.ResourceExhausted`).

## Решение

Новый пользовательский pref **`maxMessageBytes`** — потолок размера сообщения, настраиваемый
в Settings → Network. Применяется на unary-вызове и к приёму (`max_decoding_message_size`),
и к отправке (`max_encoding_message_size`) одним числом.

### Зафиксированные решения (брейншторм)

| Развилка | Решение |
|---|---|
| Способ конфигурации | pref в Settings → Network (не фикс-константа, не «unlimited») |
| Направление | **один лимит на оба** — recv + send (как grpcurl `-max-msg-sz`) |
| Область | **только invoke** (Send); reflection остаётся на дефолте 4 MiB (follow-up) |
| Дефолт | **16 MiB** (`16 * 1024 * 1024 = 16777216` байт) |
| Единица в UI | MiB |
| Проладка | голый `usize`-параметр через `invoke_unary` → `unary_dynamic` (вариант A, YAGNI) |
| Тест ядра | юнит-проверка прокладки параметра (FakeTransport фиксирует переданный лимит) |
| Процесс | subagent-driven TDD |

### Хранение и тип

- Pref хранится **в байтах** (зеркало `requestTimeoutMs`, который в мс). UI конвертит MiB ↔ байты.
- Через IPC — **`u32`** (specta отвергает `u64`; 16 MiB и даже 2 GiB влезают в `u32`).
  Ядро конвертит `u32 → usize` для tonic.
- Дефолт `PREFS_DEFAULTS.maxMessageBytes = 16 * 1024 * 1024`.

### Проладка (FE → core) — зеркало пути `requestTimeoutMs`

| Слой | Файл | Правка |
|---|---|---|
| Pref | `src/lib/use-prefs.ts` | поле `maxMessageBytes: number` (байты) + дефолт + `clampMessageBytes` (min 1 MiB, integer, cap 2 GiB) + константы `MESSAGE_BYTES_MIN`/`MESSAGE_BYTES_MAX`/`BYTES_PER_MIB` |
| Send | `src/features/workflow/actions.ts` | читает `readPrefs().maxMessageBytes`, передаёт в `grpcInvokeOneshot` как новый аргумент `maxMessageBytes` (опционально через `opts.maxMessageBytes`, дефолт из pref — зеркало `timeoutMs`) |
| IPC-клиент | `src/ipc/client.ts` | `grpcInvokeOneshot(..., maxMessageBytes)` (новый параметр после `timeoutMs`) |
| Bindings | `src/ipc/bindings.ts` | регенерация export-bindings (tracked-файл — коммитим вместе с правкой IPC) |
| Команда | `src-tauri/src/commands/grpc.rs` | `grpc_invoke_oneshot(..., max_message_bytes: u32)` → передаёт в `invoke_unary` |
| Core invoke | `crates/handshaker-core/src/grpc/invoke/mod.rs` | `invoke_unary(..., max_message_bytes: usize)` → передаёт в `unary_dynamic` |
| Core трейт | `crates/handshaker-core/src/grpc/transport/mod.rs` | `unary_dynamic(..., max_message_bytes: usize)` в трейте `GrpcTransport` |
| Core impl | `crates/handshaker-core/src/grpc/transport/tonic_impl.rs` | `Grpc::new(channel).max_decoding_message_size(n).max_encoding_message_size(n)` |
| UI | `src/features/settings/NetworkPane.tsx` | новая группа «Message size» с полем MiB (паттерн `RequestDeadlineRow`) |
| Строки | `src/lib/messages.ts` | новая копия для строки настройки + по правилу `.claude/rules/ui-strings.md` заодно централизовать существующие inline-строки `NetworkPane` (Request deadline) как фокус-чистку |

### `clampMessageBytes` (фронт)

```
MESSAGE_BYTES_MIN = 1 * 1024 * 1024        // 1 MiB
MESSAGE_BYTES_MAX = 2 * 1024 * 1024 * 1024 // 2 GiB (влезает в u32)
clampMessageBytes(b): NaN → MIN; иначе min(MAX, max(MIN, round(b)))
```

UI-поле работает в MiB: показывает `round(maxMessageBytes / BYTES_PER_MIB)`, при коммите
`clampMessageBytes(MiB * BYTES_PER_MIB)`. (Зеркало `RequestDeadlineRow`, который работает
в секундах поверх `requestTimeoutMs` в мс.)

### Поведение при превышении (не меняется)

Если ответ больше выставленного потолка — tonic возвращает gRPC-статус `OUT_OF_RANGE (11)`
с текстом `Error, decoded message length too large…`, который уже корректно показывается
в существующем `ErrorView`. После подъёма лимита он просто не срабатывает до нового потолка.
**Дополнительный UX не нужен** (опциональная будущая мелочь — подсказка «raise Max message
size in Settings» в теле ошибки 11; вне scope).

## Тестирование (TDD)

**Core (Rust):**
- `invoke_unary` прокидывает `max_message_bytes` в `unary_dynamic` — юнит через расширенный
  `FakeTransport` в `grpc/invoke/mod.rs` (фиксирует переданный лимит, как уже фиксирует
  `last_path`/`last_metadata`). Проверка прокладки, не реального tonic-эффекта.
- Существующие тесты `tonic_impl.rs` обновляются под новую сигнатуру (передают дефолтный лимит).

**Command (src-tauri):**
- `grpc_invoke_oneshot` принимает `max_message_bytes` и передаёт дальше (компиляция + сигнатура;
  поведенческой логики в команде нет — она тонкая обёртка).

**Frontend (vitest):**
- `clampMessageBytes` — границы (min/max/NaN/округление).
- `PREFS_DEFAULTS.maxMessageBytes === 16 * 1024 * 1024`.
- `actions.ts` (`sendStep`) передаёт `maxMessageBytes` из pref в `grpcInvokeOneshot`.
- `NetworkPane` — поле «Max message size» коммитит MiB → байты в pref.

**Гейт:** `cargo test --workspace` · vitest · tsc · vite build · bindings no-drift.

## Вне scope (явно)

- Reflection-путь (describe/contract) — остаётся на дефолте tonic 4 MiB; отдельный follow-up,
  механизм идентичен (`ServerReflectionClient::max_decoding_message_size`).
- Раздельные recv/send лимиты.
- Опция «unlimited» в UI.
- Улучшение текста ошибки 11 с подсказкой на настройку.
