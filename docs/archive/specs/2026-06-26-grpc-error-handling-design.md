# gRPC error handling — structured details + regex-free классификация — дизайн

**Статус:** 📝 SPEC — готов к плану (branch `claude/bold-kilby-5f1f0c`). Утверждён пользователем 2026-06-26.
**Дата:** 2026-06-26
**Объём:** backend (handshaker-core + IPC) + frontend; новая dep `tonic-types`; bindings regen
**Frontend / IPC / bindings:** трогаются все три

## Проблема

Текущая обработка gRPC-ошибок делит их на два класса (сознательный инвариант — не-OK
gRPC-статус это `Ok(UnaryOutcome)`, а не `Err`):

1. **gRPC-статус** (сервер ответил не-OK): [`tonic_impl.rs`](../../../crates/handshaker-core/src/grpc/transport/tonic_impl.rs)
   строит `UnaryOutcome { status_code, status_message, response_json: None, trailing_metadata }`.
   [`ErrorView`](../../../src/features/response/ErrorView.tsx) рисует код · имя · статичное
   описание · `status_message` · время.
2. **Клиент/транспорт** (до сервера не дошло / локальный encode-decode): [`CoreError`](../../../crates/handshaker-core/src/error.rs)
   → [`IpcError`](../../../src-tauri/src/ipc/error.rs) (богатый tagged union) → throw на фронт.

Два расхождения с best practice (сверено: [gRPC Error guide](https://grpc.io/docs/guides/error/),
[Google AIP-193](https://google.aip.dev/193), [error_details.proto](https://github.com/googleapis/googleapis/blob/master/google/rpc/error_details.proto)):

- **① Структурные детали (`grpc-status-details-bin`) выбрасываются.** Стандартная
  «richer error model» — `google.rpc.Status` с `details: repeated Any` (типы `ErrorInfo`,
  `BadRequest`, `RetryInfo`, …). Именно они делают ошибку сервера actionable; grpcurl/
  Postman/Insomnia их декодируют. Код сам помечает это deferred ([`ErrorView.tsx`](../../../src/features/response/ErrorView.tsx)
  — плашка «details недоступны»). Бинарь лежит в трейлере `grpc-status-details-bin`;
  сейчас `metadata_to_map` ASCII-only, `-bin`-ключи отбрасываются.
- **② Фронт переклассифицирует ошибку regex'ом по плоской строке.** Backend строит
  структурный `IpcError`, фронт его схлопывает (`errorToMessage`) и заново парсит текст
  ([`classifyTransportError`](../../../src/features/workflow/netDiagnostics.ts) — `/connection refused|econnrefused|refused/i`
  и т.п.). Хрупко: платформенные/локализованные OS-строки и рефактор сообщений тихо
  ломают классификацию. Cancel/timeout распознаются по sentinel-строкам.

## Утверждённые решения (из брейншторма)

- **Объём:** только ① + ②. ③ дубль кода в `status_message`, ④ headers-таб, ⑤ Retry-
  кнопка/авто-ретрай, ⑥ Copy error, decode кастомных Any — отдельные follow-up'ы.
- **Рендер деталей (①):** типизированно, **все 10 стандартных** типов `google.rpc`.
  Кастомные (не из стандартных) Any в v1 не декодируем (редкость — отмечаем в коде).
- **Классификация транспорта (②):** **в ядре**, фронт без regex вовсе. cancel/timeout →
  отдельные `IpcError`-варианты; refused/tls/dns → structured `kind`, классифицируется в Rust.

## Архитектура

Два независимых трека, сходятся в общем response-слое.

### Трек ① — структурные детали сервер-ошибки

**Backend (handshaker-core)**

Новая dep: `tonic-types = "0.14"` (version-aligned с `tonic 0.14`; подтверждено — крейт
`hyperium/tonic`, `StatusExt::get_error_details_vec()` отдаёт `Vec<ErrorDetail>` —
enum над 10 стандартными типами).

Новый модуль `crates/handshaker-core/src/grpc/invoke/status_details.rs` — serde-DTO
(specta-free, как весь core):

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum StatusDetail {
    ErrorInfo { reason: String, domain: String, metadata: BTreeMap<String, String> },
    BadRequest { violations: Vec<FieldViolation> },         // { field, description }
    RetryInfo { retry_delay_ms: Option<u64> },
    QuotaFailure { violations: Vec<QuotaViolation> },       // { subject, description }
    PreconditionFailure { violations: Vec<PreconditionViolation> }, // { kind, subject, description }
    DebugInfo { stack_entries: Vec<String>, detail: String },
    RequestInfo { request_id: String, serving_data: String },
    ResourceInfo { resource_type: String, resource_name: String, owner: String, description: String },
    Help { links: Vec<HelpLink> },                          // { description, url }
    LocalizedMessage { locale: String, message: String },
}

pub fn extract_status_details(status: &tonic::Status) -> Vec<StatusDetail>;
```

`extract_status_details` — поверх tonic-types `get_error_details_vec()`: каждый
`ErrorDetail`-вариант маппится в наш DTO 1:1. Порядок и кратность сохраняются (Vec).
`RetryInfo.retry_delay` (prost `Duration`) → `retry_delay_ms`.

`UnaryOutcome` получает поле `status_details: Vec<StatusDetail>` (пусто на success/когда
деталей нет). Заполняется в Err-ветке `tonic_impl.rs::unary_dynamic`:

```rust
Err(status) => Ok(UnaryOutcome {
    status_code: status.code() as i32,
    status_message: format!("{}: {}", status.code(), status.message()),
    response_json: None,
    trailing_metadata: metadata_to_map(status.metadata()),
    status_details: extract_status_details(&status),  // ← новое
    elapsed_ms,
}),
```

Success-ветка → `status_details: Vec::new()`.

**IPC**

`InvokeOutcomeIpc` ([`src-tauri/src/ipc/invoke.rs`](../../../src-tauri/src/ipc/invoke.rs))
получает `status_details: Vec<StatusDetailIpc>` — зеркальный tagged union
(`#[serde(tag = "type")]` + `specta::Type`, как у `IpcError`), `From<StatusDetail>`.
core остаётся specta-free; DTO живёт в core (serde), IPC-зеркало — в src-tauri.
Regen `bindings.ts` (он **tracked**, коммитим вместе с правкой IPC).

**Frontend**

Новый `src/features/response/StatusDetails.tsx` — реестр `type → презентационный
под-компонент`:

- `ErrorInfo` — reason-бейдж (mono) · domain · metadata-таблица (как KVTable).
- `BadRequest` — список `field → description`.
- `RetryInfo` — «Retryable · рекомендованная задержка N s» (данными; **кнопки Retry нет** — это ⑤).
- `QuotaFailure` / `PreconditionFailure` — списки нарушений.
- `Help` — список ссылок (внешние URL — открываются штатным механизмом приложения).
- `LocalizedMessage` — локализованный текст (+ locale-тег).
- `DebugInfo` / `RequestInfo` / `ResourceInfo` — компактные key-value блоки.

[`ErrorView`](../../../src/features/response/ErrorView.tsx) на месте текущей плашки
«details недоступны» рендерит `<StatusDetails details={outcome.status_details} />`, если
массив непуст; иначе — честная строка «No structured details» (старый текст про «требуется
backend» удаляется — backend теперь это умеет). UI-тексты в [`messages.ts`](../../../src/lib/messages.ts).

### Трек ② — структурная клиент/транспорт-ошибка, фронт без regex

**Backend**

Pure-классификатор в core (рядом с `CoreError` или новый `error_class.rs`):

```rust
pub enum ConnectKind { Refused, Tls, Dns, Other }
pub fn classify_connect_error(message: &str) -> ConnectKind;
```

Переносит знание из фронтового regex в тестируемый Rust (тесты против реальных
tonic/OS-строк: `connection refused` / `os error 10061`, `certificate`/`tls handshake`,
`dns`/`failed to lookup`).

`IpcError` ([`src-tauri/src/ipc/error.rs`](../../../src-tauri/src/ipc/error.rs)):

- Новый вариант `Cancelled` (был sentinel `"request cancelled"`).
- Новый вариант `DeadlineExceeded { timeout_ms: u32 }` (был `timed_out_msg`).
- `Transport { message }` → `Transport { kind: TransportKindIpc, message }`, где
  `TransportKindIpc ∈ { Refused, Tls, Dns, Other }`. `From<CoreError::Transport>`
  проставляет `kind` через `classify_connect_error`.

[`race_cancel_timeout`](../../../src-tauri/src/commands/grpc.rs) отдаёт `IpcError::Cancelled` /
`IpcError::DeadlineExceeded { timeout_ms }` напрямую (вместо `Transport { message: sentinel }`).
Константа `CANCELLED_MSG` и `timed_out_msg` удаляются.

**Frontend**

- [`netDiagnostics.ts`](../../../src/features/workflow/netDiagnostics.ts): regex-`RULES`
  удаляются. Остаётся `kind → hint` map (UI-текст для refused/tls/dns/timeout/cancelled/other).
  `isCancelSentinel` / `CANCELLED_SENTINEL` удаляются — cancel определяется по
  `error.type === "Cancelled"`.
- IPC-клиент / [`actions.ts`](../../../src/features/workflow/actions.ts): брошенная
  `IpcError` сохраняется **структурно** (не `errorToMessage`-строкой). `SendResult kind:"error"`
  несёт типизированный `IpcError` (union уже в bindings). cancel → `{kind:"cancelled"}`
  по `.type === "Cancelled"`; остальное → `{kind:"error", error}`.
- [`ClientErrorView`](../../../src/features/response/ClientErrorView.tsx) принимает
  структурную ошибку и switch'ит по `kind` (`Transport.kind` / `Cancelled` /
  `DeadlineExceeded` / прочие `IpcError`-типы вроде `EncodeRequest`/`DecodeResponse`/`Auth`)
  → face + hint. Regex исчезает. `DeadlineExceeded` показывает фактический `timeout_ms`.

## Поток данных

- **success** → `outcome.status_code == 0`, `status_details: []` → `ResponseBody` (без изменений).
- **server non-OK** → `Ok(outcome)`, `status_code != 0` + `status_details` → `ErrorView`
  (код · имя · message · **типизированные детали**).
- **client/transport** → throw **структурной** `IpcError` → `sendStep` ловит → `SendResult`
  → `ClientErrorView` по `kind`.

## Почему так, а не иначе

- **Детали на `UnaryOutcome`, не на `CoreError`** — не-OK статус это `Ok(outcome)`;
  детали принадлежат исходу, а не ошибочному пути. Симметрично с `trailing_metadata`.
- **Декод через `tonic-types`, не вручную** — крейт даёт типизированные структуры из
  живого `tonic::Status` (он уже в руках в Err-ветке), без возни с base64-трейлером и
  дескрипторами `google.rpc`. Идиоматичный клиентский путь.
- **Классификация транспорта в core** — single source of truth, юнит-тестируемо против
  реальных платформенных строк; фронтовый regex против всех типов ошибок (хрупкий) уходит.
- **cancel/timeout — отдельные варианты, а не строки** — control-flow (cancel → idle,
  timeout → face с таймаутом) становится точным `.type`-матчем, не fuzzy-поиском слова.

## Тестирование (TDD по слоям)

**core (Rust):**
- `extract_status_details` round-trip: собрать `tonic::Status` с деталями server-builder'ом
  tonic-types (`Status::with_error_details(...)`) → извлечь → проверить маппинг каждого
  из 10 типов (минимум ErrorInfo · BadRequest · RetryInfo предметно).
- `classify_connect_error`: refused / tls / dns / other против реальных строк.
- success-путь: `status_details` пуст.

**IPC (Rust):**
- `From<StatusDetail>` для `StatusDetailIpc` (exhaustive, как `from_core_error_exhaustive`).
- `From<CoreError::Transport>` проставляет ожидаемый `kind`.
- `IpcError::Cancelled` / `DeadlineExceeded` сериализуются с правильным `type`-тегом.
- `race_cancel_timeout` отдаёт `Cancelled` на cancel и `DeadlineExceeded` на таймаут
  (правка существующих тестов в `commands/grpc.rs`).

**frontend (vitest):**
- `StatusDetails` — по компоненту на каждый тип детали (рендер полей).
- `ErrorView` — с деталями рисует `<StatusDetails>`, без деталей — «no structured details».
- `ClientErrorView` — switch по `kind` (refused/tls/dns/timeout/cancelled/encode/decode/auth),
  без обращения к regex; `DeadlineExceeded` показывает timeout.
- `actions.ts` — структурная `IpcError` доезжает до `SendResult` (cancel по `.type`).

**Гейт:** `cargo test --workspace` · vitest · `tsc` · `vite build` · bindings no-drift.

## Вне объёма (YAGNI / follow-up)

- ③ дубль кода в `status_message` (`"{code}: {message}"` + бейдж уже показывает код).
- ④ headers-таб (initial-метадата отдельно от trailers).
- ⑤ кнопка Retry / авто-ретрай по `RetryInfo` (детали **показываем**, действий не добавляем).
- ⑥ Copy error (полный структурный ошибочный ответ в буфер).
- decode кастомных (не из 10 стандартных) `Any` — потребовал бы тащить google.rpc-протоколы.
