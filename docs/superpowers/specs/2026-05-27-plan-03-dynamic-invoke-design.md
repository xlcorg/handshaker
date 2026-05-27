# Plan #3 — Dynamic Unary Invoke (Design)

**Date:** 2026-05-27
**Branch:** `claude/plan-03-dynamic-invoke`
**Realizes spec rule:** §5 «Dynamic unary invoke. Do NOT generate per-service stubs. Use the low-level `tonic::client::Grpc` with a CUSTOM `Codec` that encodes/decodes `prost_reflect::DynamicMessage` (from the shared DescriptorPool), and call the method by its path `/package.Service/Method`.»

## 0. Источники и предыдущие документы

Этот документ **дополняет** мастер-спеку, не повторяя её. Если есть сомнения — мастер-спека приоритетна.

- **Мастер-спека:** [`docs/superpowers/specs/2026-05-26-handshaker-mvp-design.md`](../specs/2026-05-26-handshaker-mvp-design.md) (особенно §5 invoke rule, §6.4 error map, §7 dependencies, §8 UI design)
- **Plan #1:** [`docs/superpowers/plans/2026-05-26-plan-01-skeleton.md`](../plans/2026-05-26-plan-01-skeleton.md) — workspace + scaffolding + tauri-specta + dark theme.
- **Plan #2:** [`docs/superpowers/plans/2026-05-27-plan-02-reflection-spine.md`](../plans/2026-05-27-plan-02-reflection-spine.md) — reflection spine, DescriptorPool, ConnectPanel, CatalogList (содержит 13-item errata, на которое ссылаемся в техрешениях).

## 1. Цель и scope

**Цель:** реализовать dynamic unary invoke без статической генерации stubs, чтобы Handshaker мог вызывать ЛЮБОЙ метод ЛЮБОГО gRPC-сервера, для которого получен `DescriptorPool` через reflection.

**Acceptance:** в running app пользователь подключается к произвольному gRPC (`127.0.0.1:5002` — testbed для этого плана), кликает на unary метод в `CatalogList`, видит автогенерированный JSON-скелет в Monaco-редакторе, может его отредактировать, нажимает Send, получает `status_code`, `status_message`, response JSON, trailing metadata и `elapsed_ms`.

**Только unary RPC.** Streaming (server/client/bidi) — out of scope.

## 2. Решения, принятые в brainstorm

| # | Решение | Обоснование |
|---|---|---|
| D1 | `skip_verify = true` — DEFERRED в отдельный security-knobs sub-plan. | Требует hyper-rustls connector + custom `ServerCertVerifier` ([hyperium/tonic#891](https://github.com/hyperium/tonic/issues/891)) — отдельный transport stack. Не смешиваем «безопасный TLS, который уже работает» с insecure режимом в одном плане. Spec rule 10 остаётся реализованным частично; `TonicTransport::connect` продолжает возвращать `CoreError::NotImplemented` при `skip_verify=true`. |
| D2 | Auto-skeleton с дефолтами по proto3 — заполняем body editor при клике на метод. | Лучший UX без method picker / schema panel (которые в Plan #6-7). Юзер видит структуру сразу. |
| D3 | E2E против живого `127.0.0.1:5002` — через `#[ignore]` integration test. | Воспроизводимо локально, ловит баги codec'а против реальных схем (потенциально с WKT). Не блокирует CI. Дополнительно — manual UI smoke перед merge. |
| D4 | Monaco editor (lazy-loaded) — с Plan #3, согласно спеке §7. | Спека прямо требует Monaco для request/response (line 542). Раньше handoff-doc предложил textarea — это противоречит мастер-спеке. |
| D5 | Только Body section, без табов (Metadata/Settings) в Plan #3. | KISS — табы вводим, когда появляется второй таб (Metadata в Plan #5 — Auth). Никаких disabled-плейсхолдеров (memory rule `feedback_ui_transparent_mechanics`). |
| D6 | Trailing metadata — collapsible под body, не таб. | Тот же KISS. Станет табом, когда появится третий вид (или когда Body редкость, а Trailers активно используются). |
| D7 | Initial metadata НЕ капчуем в `UnaryOutcome`. | Не нужно для unary use-case (отладочные claims обычно в trailing). Поле можно добавить без breaking change позже. |
| D8 | gRPC status != OK — нормальный outcome `UnaryOutcome`, НЕ `Err(CoreError)`. | Различение «server вернул error» vs «client failure» — критично для UX: первое = красный baджик в response panel, второе = toast «something went wrong». |
| D9 | `metadata: HashMap<String, String>` уже принимается в IPC `InvokeRequest`. | Pre-wiring для Plan #5 (Auth). В UI Plan #3 поле не доступно — IPC принимает пустой map. |
| D10 | Только ASCII metadata в MVP. Binary (`-bin` суффикс) — отвергаем с `CoreError::EncodeRequest`. | YAGNI — никто пока не запрашивал. |
| D11 | `MAX_DEPTH = 4` для skeleton + cycle-guard через `HashSet<full_name>`. | Защита от стек-оверфлоу на recursive типах (`Node { Node child }`). `4` — компромисс: достаточно для типичных вложенных messages, не разворачивает «вселенную» от `google.protobuf.Struct`. |
| D12 | Доверяем reflection для well-known types. Если сервер не отдал `google/protobuf/timestamp.proto` как dependency — `EncodeRequest`/`DecodeResponse` с конкретной причиной. | YAGNI — встроенный WKT-набор как fallback пока не нужен. Если против `127.0.0.1:5002` поймаем реальную проблему — добавим в follow-up. |

## 3. Архитектура и файловая структура

### 3.1 Core (`crates/handshaker-core`)

```
src/grpc/
  transport/
    mod.rs        MODIFY  + UnaryRequest, UnaryResponse value-types
                          + trait extension: unary_dynamic(channel, request)
    tonic_impl.rs MODIFY  + impl unary_dynamic for TonicTransport
    codec.rs      NEW     DynamicCodec, DynamicEncoder, DynamicDecoder
  invoke/
    mod.rs        NEW     pub async fn invoke_unary(...)
                          pub async fn build_request_skeleton(conn, service, method) → Result<String>
                          pub struct UnaryOutcome
    skeleton.rs   NEW     pub(crate) fn build_default_json_skeleton(MessageDescriptor) → Value
  connection.rs   MODIFY  + add field `channel: TonicChannel` (single shared channel,
                            acquired once в activate(); см. §3.1.1 ниже)
  contract.rs     MODIFY  активация передаёт `channel.clone()` в reflection,
                          сохраняет оригинал в GrpcConnection
  error.rs        MODIFY  расширить ТОЛЬКО `GrpcStatus`:
                          + добавить поле `trailing_metadata: HashMap<String, String>`
                          (остальные нужные варианты — ServiceNotFound, MethodNotFound,
                          EncodeRequest, DecodeResponse, NotImplemented — уже существуют
                          из Plan #1, используем как есть)
  mod.rs / lib.rs MODIFY  + pub re-exports: invoke_unary, UnaryOutcome,
                                            build_request_skeleton
```

**Принципы:**
- `codec.rs` ничего не знает про `GrpcConnection` / transport — оперирует только `MessageDescriptor`. Юнит-тестируется без сети.
- `invoke/mod.rs` ничего не знает про tonic — оперирует `GrpcTransport` trait. Юнит-тестируется через fake transport.
- `tonic`-типы заперты в `transport/*` + `reflection/*` (как уже зафиксировано в Plan #2). Plan #3 **расширяет область** на `connection.rs` для поля `channel: TonicChannel` — pragmatic relaxation, см. §3.1.1.
- `DescriptorPool` остаётся single source of truth — `invoke_unary` резолвит `MethodDescriptor` из `conn.pool`, не дублирует.

### 3.1.1 Решение: где хранить `TonicChannel`

**Проблема:** trait метод `unary_dynamic` нуждается в `TonicChannel`. Если acquire'ить через `transport.channel(&target).await?` на каждый invoke — это новый h2-handshake (и DNS, и TLS) **на каждый вызов**. Невыносимо для UX.

**Альтернативы:**

| Вариант | Pro | Con |
|---|---|---|
| (A) Кэш в `TonicTransport` (HashMap<GrpcTarget, TonicChannel>) | Trait stays clean | TonicTransport получает state (Mutex), теряет `Default+Clone`, усложняется тестирование |
| (B) Хранить `channel` в `GrpcConnection`, передавать в `unary_dynamic(channel, request)` | Channel acquired раз в `activate()`, переиспользуется. KISS. | `TonicChannel` (re-exported alias `tonic::transport::Channel`) живёт в `connection.rs` — слабая расширение «tonic confined to transport/reflection» |
| (C) `unary_dynamic(target, request)` — transport сам резолвит channel | Минимум кода у вызывающего | Либо state (см. A), либо handshake-per-call |

**Выбираем (B).** Pragmatic relaxation invariant'а Plan #2: `TonicChannel` теперь видим из `grpc/connection.rs` через уже-существующий re-export `crate::grpc::transport::TonicChannel`. Это **не** утечка `tonic::*` глобально — alias держит boundary. Формальное переподтверждение в Plan #3 implementation: `connection.rs` импортирует только alias `TonicChannel`, не `tonic::transport::Channel` напрямую.

### 3.2 IPC (`src-tauri`)

```
src/
  ipc/
    invoke.rs    NEW     InvokeRequest, InvokeOutcomeIpc + From impls
  commands/
    grpc.rs      MODIFY  + #[tauri::command] grpc_invoke_unary,
                          + #[tauri::command] grpc_build_request_skeleton
  lib.rs         MODIFY  + регистрация обоих commands в tauri_specta::collect_commands![]
                          + в invoke_handler
```

`handshaker-core` остаётся без `specta` — wrapper-типы только в `src-tauri/src/ipc/` (продолжение invariant Plan #2 errata #10).

### 3.3 Frontend (`src/`)

```
src/
  lib/
    monaco.ts            NEW     lazy loader + dark theme + EDITOR_OPTIONS
    grpc-status.ts       NEW     statusName(code: number) → "OK"|"NOT_FOUND"|...
  features/
    invoke/
      InvokePanel.tsx    NEW     header (svc/method) + BodyEditor + Send
      BodyEditor.tsx     NEW     <Suspense fallback={Spinner}> + Monaco lazy
    response/
      ResponsePanel.tsx  NEW     StatusBar + BodyView + TrailersView
      StatusBar.tsx      NEW     dot color + code name + elapsed + size
      BodyView.tsx       NEW     Monaco read-only
      TrailersView.tsx   NEW     collapsible <details> с key/value list
    connect/
      CatalogList.tsx    MODIFY  onClick(method) → setSelectedMethod
  ipc/
    client.ts            MODIFY  + invokeUnary(req), buildRequestSkeleton(svc, m)
  components/ui/
    resizable.tsx        NEW (если ещё нет от shadcn)  — для vertical split
  App.tsx                MODIFY  + selectedMethod useState
                                 + <ResizablePanelGroup direction="vertical">
                                   с InvokePanel сверху и ResponsePanel снизу
                                   (показывается, когда есть selectedMethod)
```

**Interim layout** (Plan #3 не финал, см. §4 ниже):
- `ConnectPanel` + `CatalogList` остаются в main pane наверху (Plan #2 layout).
- При выборе метода ниже разворачивается `ResizablePanelGroup` с Invoke и Response.
- Финальная раскладка спеки §8.1 (sidebar=Collections, main pane=Request view с picker) собирается постепенно: Plan #6 — Collections sidebar, Plan #7 — method picker, тогда же `CatalogList` уходит из main pane.

## 4. Value-типы

### 4.1 Core boundary types

**Существующая в Plan #2 trait-сигнатура:**
```rust
#[async_trait::async_trait]
pub trait GrpcTransport: Send + Sync {
    async fn channel(&self, target: &GrpcTarget) -> Result<TonicChannel, CoreError>;
}
```

**Plan #3 расширяет:**
```rust
// transport/mod.rs

pub struct UnaryRequest {
    pub path: http::uri::PathAndQuery,
    pub message: prost_reflect::DynamicMessage,
    pub response_descriptor: prost_reflect::MessageDescriptor,
    pub metadata: std::collections::HashMap<String, String>,
}

pub struct UnaryResponse {
    pub message: prost_reflect::DynamicMessage,
    pub trailing_metadata: std::collections::HashMap<String, String>,
}

#[async_trait::async_trait]
pub trait GrpcTransport: Send + Sync {
    async fn channel(&self, target: &GrpcTarget) -> Result<TonicChannel, CoreError>;
    /// Выполнить unary-вызов на уже открытом канале.
    /// `channel` берётся по value (cheap clone of `tonic::transport::Channel`).
    async fn unary_dynamic(
        &self,
        channel: TonicChannel,
        request: UnaryRequest,
    ) -> Result<UnaryResponse, CoreError>;
}
```

**`GrpcConnection` (modified):**
```rust
pub struct GrpcConnection {
    pub target: GrpcTarget,
    pub transport: Arc<dyn GrpcTransport>,
    pub channel: TonicChannel,                  // NEW: single shared channel
    pub pool: prost_reflect::DescriptorPool,
    pub catalog: ServiceCatalog,
}
```

**`activate()` (modified):**
```rust
pub async fn activate(target: GrpcTarget, transport: Arc<dyn GrpcTransport>)
    -> Result<GrpcConnection, CoreError>
{
    let channel = transport.channel(&target).await?;
    let (_listed, files) = list_and_fetch_files(channel.clone()).await?;
    let pool = build_pool(files)?;
    let catalog = build_catalog(&pool);
    Ok(GrpcConnection { target, transport, channel, pool, catalog })
}
```

### 4.2 Public invoke API

```rust
// invoke/mod.rs

pub struct UnaryOutcome {
    pub status_code: i32,
    pub status_message: String,
    pub response_json: Option<String>,
    pub trailing_metadata: std::collections::HashMap<String, String>,
    pub elapsed_ms: u64,
}

pub async fn invoke_unary(
    connection: &GrpcConnection,
    service: &str,
    method: &str,
    request_json: &str,
    metadata: std::collections::HashMap<String, String>,
) -> Result<UnaryOutcome, CoreError>;

pub fn build_request_skeleton(
    connection: &GrpcConnection,
    service: &str,
    method: &str,
) -> Result<String, CoreError>;
```

### 4.3 IPC types

```rust
// ipc/invoke.rs

#[derive(serde::Deserialize, specta::Type)]
pub struct InvokeRequest {
    pub service: String,
    pub method: String,
    pub request_json: String,
    pub metadata: std::collections::HashMap<String, String>,
}

#[derive(serde::Serialize, specta::Type)]
pub struct InvokeOutcomeIpc {
    pub status_code: i32,
    pub status_message: String,
    pub response_json: Option<String>,
    pub trailing_metadata: std::collections::HashMap<String, String>,
    pub elapsed_ms: u64,
}

impl From<handshaker_core::invoke::UnaryOutcome> for InvokeOutcomeIpc { /* trivial */ }
```

## 5. DynamicCodec

```rust
// transport/codec.rs

use prost::Message;
use prost_reflect::{DynamicMessage, MessageDescriptor};
use tonic::codec::{Codec, DecodeBuf, Decoder, EncodeBuf, Encoder};

pub struct DynamicCodec {
    pub request_descriptor: MessageDescriptor,
    pub response_descriptor: MessageDescriptor,
}

pub struct DynamicEncoder;

pub struct DynamicDecoder {
    response_descriptor: MessageDescriptor,
}

impl Codec for DynamicCodec {
    type Encode = DynamicMessage;
    type Decode = DynamicMessage;
    type Encoder = DynamicEncoder;
    type Decoder = DynamicDecoder;

    fn encoder(&mut self) -> Self::Encoder { DynamicEncoder }
    fn decoder(&mut self) -> Self::Decoder {
        DynamicDecoder { response_descriptor: self.response_descriptor.clone() }
    }
}

impl Encoder for DynamicEncoder {
    type Item = DynamicMessage;
    type Error = tonic::Status;
    fn encode(&mut self, item: Self::Item, dst: &mut EncodeBuf<'_>) -> Result<(), Self::Error> {
        item.encode(dst).map_err(|e| tonic::Status::internal(format!("encode: {e}")))
    }
}

impl Decoder for DynamicDecoder {
    type Item = DynamicMessage;
    type Error = tonic::Status;
    fn decode(&mut self, src: &mut DecodeBuf<'_>) -> Result<Option<Self::Item>, Self::Error> {
        let mut msg = DynamicMessage::new(self.response_descriptor.clone());
        msg.merge(src).map_err(|e| tonic::Status::internal(format!("decode: {e}")))?;
        Ok(Some(msg))
    }
}
```

- `Send + 'static` тривиально (нет внутреннего state, кроме `MessageDescriptor` — он `Send + Clone`).
- Один codec на один call (per spec §5 рекомендация).

## 6. invoke_unary flow

```
1. resolve_service: conn.pool.get_service_by_name(service)
      None → Err(CoreError::ServiceNotFound { service })
2. resolve_method: service.methods().find(|m| m.name() == method)
      None → Err(CoreError::MethodNotFound { service, method })
3. assert_unary: !m.is_client_streaming() && !m.is_server_streaming()
      else → Err(CoreError::NotImplemented { feature: "streaming RPC" })
4. parse_json: DynamicMessage::deserialize(input_desc, json)
      Err(e) → Err(CoreError::EncodeRequest(e.to_string()))
5. build_path: PathAndQuery::from_maybe_shared(format!("/{service}/{method}"))
      Err(_) → unreachable (валидные имена идут из дескриптора), но всё равно
               маппим в EncodeRequest для defensive coding
6. measure: started = Instant::now()
7. call: conn.transport.unary_dynamic(UnaryRequest { ... }).await
8. classify:
   - Ok(UnaryResponse { message, trailing_metadata }):
        // prost-reflect impl Serialize for DynamicMessage (canonical proto3 JSON):
        json = serde_json::to_string_pretty(&message)
              Err(e) → Err(CoreError::DecodeResponse(e.to_string()))
        return UnaryOutcome { status_code: 0, status_message: "OK",
                              response_json: Some(json), trailing_metadata,
                              elapsed_ms }
   - Err(CoreError::GrpcStatus { code, message, trailing_metadata }):
        return UnaryOutcome { status_code: code, status_message: message,
                              response_json: None, trailing_metadata,
                              elapsed_ms }
   - Err(other): propagate
```

### `unary_dynamic` в `TonicTransport`

```rust
async fn unary_dynamic(&self, channel: TonicChannel, req: UnaryRequest)
    -> Result<UnaryResponse, CoreError>
{
    let mut grpc = tonic::client::Grpc::new(channel);
    grpc.ready().await.map_err(|e| CoreError::Transport(e.to_string()))?;

    let codec = DynamicCodec {
        request_descriptor: req.message.descriptor(),
        response_descriptor: req.response_descriptor.clone(),
    };

    let mut tonic_req = tonic::Request::new(req.message);
    inject_ascii_metadata(tonic_req.metadata_mut(), &req.metadata)?;

    let response = match grpc.unary(tonic_req, req.path, codec).await {
        Ok(r) => r,
        Err(status) => {
            return Err(CoreError::GrpcStatus {
                code: status.code() as i32,
                message: format!("{}: {}", status.code(), status.message()),
                trailing_metadata: metadata_to_map(status.metadata()),
            });
        }
    };

    let trailing = metadata_to_map(response.metadata());
    Ok(UnaryResponse { message: response.into_inner(),
                       trailing_metadata: trailing })
}
```

**`inject_ascii_metadata`:**
- Ключи: `tonic::metadata::AsciiMetadataKey::from_bytes` (запрещает `-bin` суффикс автоматически).
- Значения: `AsciiMetadataValue::try_from`.
- Ошибки → `CoreError::EncodeRequest("invalid metadata key/value: <detail>".into())`.
- Логирование: значения для ключа `authorization` (case-insensitive) → `<redacted>` в `tracing::debug` (mirror security req мастер-спеки §6.4).

**`metadata_to_map`:** только ASCII-ключи; binary метаданные пропускаем (без ошибки — просто не показываем).

## 7. Error mapping

### 7.1 Существующие варианты (Plan #1 — используем как есть)

Plan #1 предзаложил полный набор вариантов в `CoreError` и mapping в `IpcError` (см. `crates/handshaker-core/src/error.rs` + `src-tauri/src/ipc/error.rs`):

| Вариант | Сигнатура (текущая) | Где будем использовать в Plan #3 |
|---|---|---|
| `ServiceNotFound { service: String }` | struct | `invoke_unary` — service не найден в pool |
| `MethodNotFound { service: String, method: String }` | struct | `invoke_unary` — method не найден |
| `EncodeRequest(String)` | tuple | parse JSON, invalid metadata, неудача encode |
| `DecodeResponse(String)` | tuple | DynamicMessage → JSON serialize fail |
| `Transport(String)` | tuple | `tonic::client::Grpc::ready()` fail |
| `NotImplemented(String)` | tuple | streaming RPC encountered |
| `GrpcStatus { code, message }` | struct | gRPC status != OK — **MODIFY** ниже |

### 7.2 Единственное изменение `CoreError`: `GrpcStatus` обогащается trailing_metadata

```rust
// BEFORE (Plan #1):
GrpcStatus { code: i32, message: String },

// AFTER (Plan #3):
GrpcStatus {
    code: i32,
    message: String,
    trailing_metadata: std::collections::HashMap<String, String>,
},
```

`Display` остаётся `"gRPC status {code}: {message}"` — trailing_metadata в строку не включаем (это `HashMap`, неинформативно для человека).

**Обновляются:**
- Существующий тест `error::tests::grpc_status_renders_code_and_message` — добавить `trailing_metadata: Default::default()`.
- `IpcError::GrpcStatus` — добавить поле `trailing_metadata: HashMap<String, String>` + serde + specta.
- `IpcError::from(CoreError::GrpcStatus { code, message, trailing_metadata })` — копирует поле.
- `ipc::error::tests::from_core_error_exhaustive` — корректируем `cases` (`trailing_metadata: Default::default()` в одной строке).

### 7.3 `GrpcStatus` — internal transit-error

`CoreError::GrpcStatus` производится ТОЛЬКО `TonicTransport::unary_dynamic` на ошибочный `tonic::Status` и ловится ТОЛЬКО `invoke_unary` (превращается в `UnaryOutcome { status_code, status_message, trailing_metadata, response_json: None }`).

Через `Result<InvokeOutcomeIpc, IpcError>` границу `CoreError::GrpcStatus` НИКОГДА не уходит в Plan #3 flow (`invoke_unary` всегда отдаёт `Ok(UnaryOutcome)` в этом сценарии). Соответствующий `IpcError::GrpcStatus` остаётся в энуме defensively (на случай других paths в будущих планах + чтобы не ломать `IpcError::from` exhaustive match).

## 8. Skeleton generation

```rust
// invoke/skeleton.rs

use prost_reflect::{Kind, MessageDescriptor};
use serde_json::{json, Map, Value};
use std::collections::HashSet;

const MAX_DEPTH: usize = 4;

pub fn build_default_json_skeleton(desc: &MessageDescriptor) -> Value {
    build_message(desc, 0, &mut HashSet::new())
}

fn build_message(desc: &MessageDescriptor, depth: usize, visiting: &mut HashSet<String>) -> Value {
    if depth >= MAX_DEPTH || !visiting.insert(desc.full_name().to_string()) {
        return json!("...");
    }
    let mut obj = Map::new();
    for field in desc.fields() {
        let v = if field.is_list()      { json!([]) }
                else if field.is_map()  { json!({}) }
                else                    { default_for_kind(&field.kind(), depth, visiting) };
        obj.insert(field.json_name().to_string(), v);
    }
    visiting.remove(desc.full_name());
    Value::Object(obj)
}

fn default_for_kind(kind: &Kind, depth: usize, visiting: &mut HashSet<String>) -> Value {
    use Kind::*;
    match kind {
        Double | Float => json!(0.0),
        Int32 | Sint32 | Sfixed32 | Int64 | Sint64 | Sfixed64
            | Uint32 | Fixed32 | Uint64 | Fixed64 => json!(0),
        Bool   => json!(false),
        String => json!(""),
        Bytes  => json!(""),
        Enum(e)    => json!(e.default_value().name()),
        Message(m) => build_message(m, depth + 1, visiting),
    }
}

pub fn build_request_skeleton(
    connection: &GrpcConnection,
    service: &str,
    method: &str,
) -> Result<String, CoreError> {
    // resolve_service + resolve_method как в invoke_unary, но без streaming-check
    // и без call; берём input_desc, вызываем build_default_json_skeleton,
    // serde_json::to_string_pretty.
}
```

**Почему не через `DynamicMessage::default() + serialize`:**
1. prost-reflect's default `SerializeOptions { emit_unpopulated_fields: false }` НЕ эмитит поля со zero-value — получим `{}`.
2. С `emit_unpopulated_fields: true` — эмитит, но для recursive types провалится в бесконечную рекурсию.
3. Нет защиты от циклов (`Node { Node child }`).

Ручной обход дескриптора даёт детерминированный, безопасный результат и читабельный placeholder `"..."` для cycle/depth-cutoff.

## 9. UI surface

Следует спеке §8 максимально, насколько позволяет наличие готовых частей. Где мастер-спека требует то, что ещё не построено (Collections, method picker), оставляем placeholder layout из Plan #2.

### 9.1 Layout (Plan #3 интерим)

```
┌──────────────────────────────────────────────────────────┐
│  Handshaker                                                │  ← header (Plan #1)
├──────────────────────────────────────────────────────────┤
│  ConnectPanel (address, Connect/Disconnect)               │  ← Plan #2
├──────────────────────────────────────────────────────────┤
│  CatalogList (services → methods)                         │  ← Plan #2 MODIFY:
│                                                            │     onClick → setSelectedMethod
├══════════════════════════════════════════════════════════┤  ← ResizablePanelGroup vertical
│  InvokePanel:                                              │     (показывается только если
│    test.Echo / Send                          [ Send ⌘↵ ]   │      selectedMethod !== null)
│    ┌─────────────────────────────────────────────────┐    │
│    │ { "id": "" }                ← Monaco JSON       │    │
│    └─────────────────────────────────────────────────┘    │
├──────────────────────────────────────────────────────────┤  ← ResizableHandle
│  ResponsePanel:                                            │
│    ● OK · 142ms · 1.2KB        ← StatusBar (Plan #3)      │
│    ┌─────────────────────────────────────────────────┐    │
│    │ { "id": "abc", "echoed": "hello" }  ← Monaco r/o│    │
│    └─────────────────────────────────────────────────┘    │
│    ▸ Trailers (0)              ← collapsible (not tab)    │
└──────────────────────────────────────────────────────────┘
```

### 9.2 Поведение

- **Method click** в `CatalogList` → `setSelectedMethod({ service, method })` →
  `App.tsx` рендерит `<ResizablePanelGroup>` ниже catalog'а →
  `InvokePanel` сразу вызывает `grpcBuildRequestSkeleton(service, method)` → skeleton в Monaco.
- **Replace warning:** если в editor'е уже непустой текст и он != skeleton предыдущего метода — нативный `window.confirm("Replace current request body?")`.
- **Send:** клик / `⌘↵` (на macOS) / `Ctrl+Enter` (Windows). Перед вызовом: `JSON.parse(body)` — если throw, кнопка disabled + inline-toast с reason; иначе IPC.
- **Send in flight:** кнопка disabled + spinner; redraw response panel сразу как пришёл outcome.
- **Status bar:**
  - dot цвет: зелёный `oklch(0.7 0.16 145)` если `status_code === 0`, красный `oklch(0.704 0.191 22.216)` иначе.
  - text: `<statusName(code)> · <elapsed_ms>ms · <size>` где `size` = `response_json` length в UTF-8 байтах (`new TextEncoder().encode(s).length`), форматированный как KB если ≥ 1024 (`1.2KB`).
- **Response body:** Monaco read-only. Если `response_json === null` — body section пустая (status bar показывает только код/ms).
- **Trailers:** `<details>` element. Closed по умолчанию. Список `<dt>key</dt> <dd>value</dd>`. Пусто если 0 ключей — `<details>` не рендерим вовсе.

### 9.3 Monaco lazy-load

```ts
// src/lib/monaco.ts
import { lazy } from 'react';

export const MonacoEditor = lazy(() =>
  import('@monaco-editor/react').then(m => ({ default: m.Editor }))
);

export const EDITOR_OPTIONS = {
  fontSize: 13,
  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  automaticLayout: true,
  tabSize: 2,
  insertSpaces: true,
} as const;

export const READ_ONLY_OPTIONS = { ...EDITOR_OPTIONS, readOnly: true } as const;

export const MONACO_THEME = 'vs-dark'; // shadcn new-york dark fits vs-dark
```

`<BodyEditor>` / `<BodyView>` оборачивают `<MonacoEditor>` в `<Suspense fallback={<Spinner />}>`. Initial bundle не раздувается.

### 9.4 Что НЕ строим в Plan #3 (явно)

- Metadata tab/editor — Plan #5 (Auth).
- Settings tab (per-request TLS/Auth override) — после Plan #6.
- Method picker dialog (⌘K) — Plan #7.
- Collections sidebar — Plan #6.
- Variable substitution `{{var}}` в body — Plan #4.
- JSON schema validation в Monaco из proto — next-step (мастер-спека line 542).
- Save Request dialog — Plan #6.
- Cancel в полёте — не в MVP.

## 10. Тестовая стратегия

### 10.1 Юнит-тесты (`#[cfg(test)]`)

| Модуль | Тесты |
|---|---|
| `transport/codec.rs` | encode known message → expected bytes; decode bytes → expected message; round-trip простой Ping; round-trip nested message; round-trip repeated; round-trip enum. |
| `invoke/skeleton.rs` | empty message → `{}`; все scalar kinds → правильные дефолты; repeated → `[]`; map → `{}`; nested message → recursive build; enum → имя дефолтного value; self-referencing message обрезается `"..."` после MAX_DEPTH; mutual recursion (`A→B→A`) обрезается. |
| `invoke/mod.rs` | ServiceNotFound на пустом pool; MethodNotFound; streaming method → NotImplemented; невалидный JSON → EncodeRequest; binary metadata key → EncodeRequest; `authorization` value redacted в логах (через `tracing-test`). |
| `error.rs` | Display-строки новых вариантов. |

Для `invoke/mod.rs` юнит-тестов — `FakeTransport { response: Mutex<Option<Result<UnaryResponse, CoreError>>> }`.

### 10.2 Интеграционные тесты (`crates/handshaker-core/tests/`)

| Файл | Сервер | Проверяет |
|---|---|---|
| `invoke_codec.rs` | — | encode→decode round-trip над разными схемами (scalars, nested, repeated, map, enum, oneof) — без сети. |
| `invoke_unary.rs` | `spawn_echo_server()` | end-to-end JSON → wire → JSON; `status_code=0`; `elapsed_ms > 0`. |
| `invoke_status.rs` | `spawn_echo_server()` с флагом «вернуть NOT_FOUND» | `UnaryOutcome { status_code: 5, status_message: "NOT_FOUND: ...", response_json: None }`. |
| `invoke_trailers.rs` | `spawn_echo_server()` с инжекцией trailers | `trailing_metadata` содержит ожидаемые lowercase-ключи. |
| `invoke_skeleton.rs` | `spawn_reflection_server_v1_with_deps` | после activate, `build_request_skeleton` возвращает JSON, парсится, содержит nested `h.trace_id: ""`. |
| `invoke_live.rs` (`#[ignore]`) | `$HANDSHAKER_LIVE_TARGET` (default `127.0.0.1:5002`) | activate → pick first non-reflection unary method → skeleton → invoke; проверка `elapsed_ms > 0` И ((status=0, response_json Some) OR (status!=0, status_message non-empty)). |

### 10.3 Echo-server test helper — узкое место

`spawn_echo_server()` должен быть **полноценным tonic-сервером**, который:
1. Реагирует на reflection (используем `tonic_reflection` как в Plan #2 fixture).
2. Реагирует на unary call `/test.Echo/Send` через **DynamicCodec** + custom service-impl, возвращающий `Pong { id, echoed: format!("echo: {id}") }`.

Реализация через `tonic::server::NamedService` + custom `tower::Service` над `DynamicMessage` — нетривиально, но один раз, и используется в трёх тестах. **Первая задача того раздела Plan #3 — построить helper и убедиться, что работает.** Если окажется слишком сложно — fall back на статический tonic-build тест-сервер в отдельной test-only crate (худший вариант: +deps complexity, +5 минут билда, но без custom transport code).

### 10.4 Manual UI smoke

Финальная задача плана:
1. `cargo tauri dev`
2. Подключиться к `127.0.0.1:5002`
3. Дождаться catalog'а; выбрать любой unary method
4. Увидеть автогенерированный JSON skeleton в Monaco
5. Нажать Send
6. Увидеть response panel: status bar (зелёная точка + OK + ms + size), Monaco r/o с response JSON, trailers (если есть).

Acceptance: проходит без UI freeze, без panic в логах, без ошибок в DevTools console.

## 11. Открытые риски и mitigation

| # | Риск | Mitigation |
|---|---|---|
| R1 | `spawn_echo_server` через custom tonic Service окажется слишком сложным. | Fall back на тест-only crate с tonic-build (отдельный target). Решение принимается после первой имплементации в Plan #3. |
| R2 | `127.0.0.1:5002` сервер использует google.protobuf.\* и не отдаёт их descriptor'ы через reflection. | Поймаем в `invoke_live.rs` как `DecodeResponse` или `EncodeRequest` с понятным reason. Если воспроизведётся — добавим WKT embedding как follow-up. |
| R3 | Monaco bundle size — initial load slow на debug build. | Lazy-load через `React.lazy` — Monaco не входит в initial chunk; первый рендер `<InvokePanel>` тянет ~3MB JS (Monaco). Acceptable trade-off для desktop app. |
| R4 | `tonic::client::Grpc::ready().await` может зависнуть, если channel в плохом состоянии. | Timeout не в MVP (`tonic::Channel` уже имеет connect_timeout из Plan #2). Если в `invoke_live` поймаем — добавим per-call timeout в errata. |
| R5 | tauri-specta bindings регенерация. | Следуем pattern Plan #1/#2: regenerate `src/ipc/bindings.ts` через `cargo run -p handshaker --bin export-bindings` после добавления `grpc_invoke_unary` / `grpc_build_request_skeleton`. Frontend lint (`pnpm lint`) проверит, что новые типы (`InvokeRequest`, `InvokeOutcomeIpc`) корректно потребляются. |

## 12. Источники, проверенные перед сдачей дизайна

| Источник | URL | Использовано для |
|---|---|---|
| tonic 0.14.5 `Grpc::unary` | <https://docs.rs/tonic/0.14.5/tonic/client/struct.Grpc.html> | сигнатура `unary(req, path, codec)`, требование `ready().await` |
| tonic 0.14.5 `Codec` trait | <https://docs.rs/tonic/0.14.5/tonic/codec/trait.Codec.html> | требование `Send + 'static` на Encode/Decode типах |
| prost-reflect `DynamicMessage` | <https://docs.rs/prost-reflect/0.14/prost_reflect/struct.DynamicMessage.html> | `::new(MessageDescriptor)`, `serialize` через serde, `deserialize` через serde |
| prost-reflect `SerializeOptions` | <https://docs.rs/prost-reflect/0.14/prost_reflect/struct.SerializeOptions.html> | обоснование «не используем emit_unpopulated_fields» для skeleton |
| hyperium/tonic#891 | <https://github.com/hyperium/tonic/issues/891> | обоснование D1 (skip_verify defer) |
| @monaco-editor/react | <https://www.npmjs.com/package/@monaco-editor/react> | lazy-load pattern + `Editor` named export |
| Memory rule `feedback_verify_technical_claims` | local | требование цитировать источники |
| Memory rule `feedback_ui_transparent_mechanics` | local | обоснование D5/D6 (без disabled tabs) |
| Memory rule `preference_subagent_driven_default` | local | execution mode после writing-plans |

## 13. Что попадёт в Plan #3 implementation

В порядке зависимости (writing-plans уточнит TDD-разбивку каждой задачи):

1. **`CoreError::GrpcStatus` + IPC mapping** — добавить поле `trailing_metadata`, обновить существующие тесты `error::tests::grpc_status_renders_code_and_message` + `ipc::error::tests::from_core_error_exhaustive` + добавить тест на serde JSON round-trip нового поля.
2. **`DynamicCodec` + unit tests** — без сети, fixture descriptors из Plan #2.
3. **`UnaryRequest`/`UnaryResponse` value-types** + **trait extension** `GrpcTransport::unary_dynamic(channel, request)`.
4. **`GrpcConnection.channel` field + `activate()` обновлён** — channel сохраняется, передаётся в reflection `clone()`-ом. Обновить любые существующие конструкции `GrpcConnection { ... }` в тестах Plan #2 — добавить `channel` поле (либо `From<TestFixture>` builder для тестов).
5. **`TonicTransport::unary_dynamic` impl** + unit tests (skip_verify-style — `ready` против неответного channel'а).
6. **`spawn_echo_server` test helper** — fall back на тест-only crate с tonic-build, если custom NamedService окажется слишком сложным (R1).
7. **Integration tests** — `invoke_codec.rs`, `invoke_unary.rs`, `invoke_status.rs`, `invoke_trailers.rs`.
8. **`invoke/skeleton.rs`** + unit tests (default values, MAX_DEPTH cycle guard, mutual recursion).
9. **`build_request_skeleton` public API** + `invoke_skeleton.rs` integration test.
10. **`invoke::invoke_unary`** + unit tests с `FakeTransport`. Self-contained — собирает все предыдущие куски.
11. **IPC** — `InvokeRequest`/`InvokeOutcomeIpc` + `grpc_invoke_unary` + `grpc_build_request_skeleton` commands + регистрация в `lib.rs`.
12. **Frontend lib** — `lib/monaco.ts`, `lib/grpc-status.ts`.
13. **Frontend features/invoke** — `InvokePanel`, `BodyEditor`.
14. **Frontend features/response** — `ResponsePanel`, `StatusBar`, `BodyView`, `TrailersView`.
15. **`CatalogList` modify + `App.tsx` layout** — selectedMethod state, ResizablePanelGroup, click-handler.
16. **`invoke_live.rs` `#[ignore]` test** + **manual UI smoke** acceptance gate.
