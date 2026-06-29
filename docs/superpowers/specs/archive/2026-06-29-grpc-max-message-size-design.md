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
| Способ конфигурации | pref в Settings → Network — **дискретный слайдер** (вариант A: ползунок + readout + тики) |
| Стопы слайдера | степени двойки `1·2·4·8·16·32·64·128·256·512·1024 MiB`, **12-й (крайний правый) стоп = «Unlimited»** |
| Направление | **один лимит на оба** — recv + send (как grpcurl `-max-msg-sz`) |
| Область | **только invoke** (Send); reflection остаётся на дефолте 4 MiB (follow-up) |
| Дефолт | **16 MiB** (`16 * 1024 * 1024 = 16777216` байт) — индекс 4 на слайдере |
| Единица в UI | MiB (≥1024 показывается как GiB; крайний стоп — «Unlimited») |
| Проладка | голый `usize`-параметр через `invoke_unary` → `unary_dynamic` (YAGNI; не структура, не на codec) |
| Тест ядра | юнит-проверка прокладки параметра (FakeTransport фиксирует переданный лимит) |
| Процесс | subagent-driven TDD |

### Хранение и тип

- Pref хранится **в байтах** (зеркало `requestTimeoutMs`, который в мс). UI конвертит MiB ↔ байты.
- **«Unlimited» = сентинел `0`** (ноль байт как реальный лимит бессмыслен ⇒ 0 = «без лимита»;
  JSON-safe для localStorage, в отличие от `Infinity`, который `JSON.stringify` превращает в `null`).
- Через IPC — **`u32`** (specta отвергает `u64`; макс. конечный стоп 1024 MiB = `1073741824` влезает в `u32`).
  Граница IPC (команда) мапит: `0 → usize::MAX` (без лимита), иначе `value as usize`; ядро получает готовый `usize`.
- Дефолт `PREFS_DEFAULTS.maxMessageBytes = 16 * 1024 * 1024` (16 MiB).

### Проладка (FE → core) — зеркало пути `requestTimeoutMs`

| Слой | Файл | Правка |
|---|---|---|
| Pref | `src/lib/use-prefs.ts` | поле `maxMessageBytes: number` (байты, `0`=unlimited) + дефолт + `clampMessageBytes` + `MESSAGE_SIZE_STOPS` (массив байт-значений стопов, последний — `0`/unlimited) + `BYTES_PER_MIB` + хелперы `stopIndexFor(bytes)`/`formatMessageSize(bytes)` |
| Send | `src/features/workflow/actions.ts` | читает `readPrefs().maxMessageBytes`, передаёт в `grpcInvokeOneshot` как новый аргумент `maxMessageBytes` (опционально через `opts.maxMessageBytes`, дефолт из pref — зеркало `timeoutMs`) |
| IPC-клиент | `src/ipc/client.ts` | `grpcInvokeOneshot(..., maxMessageBytes)` (новый параметр после `timeoutMs`) |
| Bindings | `src/ipc/bindings.ts` | регенерация export-bindings (tracked-файл — коммитим вместе с правкой IPC) |
| Команда | `src-tauri/src/commands/grpc.rs` | `grpc_invoke_oneshot(..., max_message_bytes: u32)`; **сентинел-маппинг на границе IPC**: `let max = if max_message_bytes == 0 { usize::MAX } else { max_message_bytes as usize };` → передаёт `max` в `invoke_unary` |
| Core invoke | `crates/handshaker-core/src/grpc/invoke/mod.rs` | `invoke_unary(..., max_message_bytes: usize)` → передаёт в `unary_dynamic` (ядро о сентинеле не знает — получает уже готовый `usize`) |
| Core трейт | `crates/handshaker-core/src/grpc/transport/mod.rs` | `unary_dynamic(..., max_message_bytes: usize)` в трейте `GrpcTransport` |
| Core impl | `crates/handshaker-core/src/grpc/transport/tonic_impl.rs` | `Grpc::new(channel).max_decoding_message_size(max_message_bytes).max_encoding_message_size(max_message_bytes)` |
| Slider-компонент | `src/components/ui/slider.tsx` (новый) | shadcn-style обёртка на `radix-ui` `Slider` (пакет уже в зависимостях; новых npm-пакетов нет) |
| UI | `src/features/settings/NetworkPane.tsx` | новая группа «Message size» с дискретным слайдером (12 стопов, readout, тики; крайний стоп — «Unlimited»); индекс ↔ байты через `MESSAGE_SIZE_STOPS`/`stopIndexFor` |
| Строки | `src/lib/messages.ts` | новая копия для строки настройки (вкл. «Unlimited» и подсказку) + по правилу `.claude/rules/ui-strings.md` заодно централизовать существующие inline-строки `NetworkPane` (Request deadline) как фокус-чистку |

### Слайдер, стопы и хелперы (фронт)

```
BYTES_PER_MIB = 1024 * 1024
MESSAGE_SIZE_STOPS = [1,2,4,8,16,32,64,128,256,512,1024].map(m => m * BYTES_PER_MIB).concat(0)
// 12 элементов; последний 0 = «Unlimited». Индекс 4 (=16 MiB) — дефолт.

stopIndexFor(bytes): индекс ближайшего стопа (для unlimited/0 → последний индекс;
  для конечных — ближайший по значению, чтобы пережить чужой/старый pref).
formatMessageSize(bytes): 0 → "Unlimited"; ≥1024 MiB → "N GiB"; иначе "N MiB".
clampMessageBytes(b): нормализует в одно из значений MESSAGE_SIZE_STOPS
  (snap к ближайшему стопу; 0 проходит как unlimited). Гард на загрузку битого pref.
```

Слайдер — `radix-ui` `Slider` c `min=0 max=11 step=1`; значение = индекс в `MESSAGE_SIZE_STOPS`.
`onValueChange(i)` → `setPref("maxMessageBytes", MESSAGE_SIZE_STOPS[i])`. Readout = `formatMessageSize`.
(Архитектурно зеркалит `RequestDeadlineRow`, но дискретный слайдер вместо числового поля.)

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
- `grpc_invoke_oneshot` принимает `max_message_bytes` и передаёт дальше.
- **Сентинел-маппинг**: `0 → usize::MAX`, конечное значение → `as usize` (чистый юнит на хелпер-функцию
  маппинга, вынесенную из команды, чтобы тестировать без `State`/сети).

**Frontend (vitest):**
- `MESSAGE_SIZE_STOPS` — 12 элементов, последний `0` (unlimited), индекс 4 = 16 MiB.
- `PREFS_DEFAULTS.maxMessageBytes === 16 * 1024 * 1024`.
- `stopIndexFor` — конечное → ближайший стоп; `0` → последний индекс; битое значение → ближайший.
- `formatMessageSize` — `0`→"Unlimited", `1073741824`→"1 GiB", `16777216`→"16 MiB".
- `actions.ts` (`sendStep`) передаёт `maxMessageBytes` из pref в `grpcInvokeOneshot` (вкл. кейс `0`).
- `NetworkPane` — движение слайдера коммитит соответствующий байт-стоп в pref; крайний стоп → `0`.

**Гейт:** `cargo test --workspace` · vitest · tsc · vite build · bindings no-drift.

## Вне scope (явно)

- Reflection-путь (describe/contract) — остаётся на дефолте tonic 4 MiB; отдельный follow-up,
  механизм идентичен (`ServerReflectionClient::max_decoding_message_size`).
- Раздельные recv/send лимиты.
- Произвольный ввод точного числа (вариант B отклонён) — только дискретные стопы слайдера.
- Улучшение текста ошибки 11 с подсказкой на настройку.
