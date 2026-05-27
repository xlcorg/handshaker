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
| D1 | `skip_verify = true` — DEFERRED в отдельный security-knobs sub-plan. | Требует hyper-rustls connector + custom `ServerCertVerifier` ([hyperium/tonic#891](https://github.com/hyperium/tonic/issues/891)) — отдельный transport stack. Не смешиваем «безопасный TLS, который уже работает» с insecure режимом в одном плане. Spec rule 10 остаётся реализованным частично; `TonicTransport::channel` продолжает возвращать `CoreError::NotImplemented` при `skip_verify=true` (как зафиксировано Plan #2 errata #10). |
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
    mod.rs        MODIFY  + trait extension: unary_dynamic(channel, method_path,
                                                              codec, request, metadata)
                            per мастер-спека §5.6 (5 отдельных параметров, returns UnaryOutcome)
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
  error.rs        UNCHANGED — все нужные варианты (ServiceNotFound, MethodNotFound,
                          EncodeRequest, DecodeResponse, NotImplemented, Transport,
                          GrpcStatus) уже есть с Plan #1, используем как есть.
                          Trailing metadata живёт в UnaryOutcome, не в CoreError.
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
| (B) Хранить `channel` в `GrpcConnection`, передавать первым параметром в `unary_dynamic(channel, ...)` | Channel acquired раз в `activate()`, переиспользуется. KISS. | `TonicChannel` (re-exported alias `tonic::transport::Channel`) живёт в `connection.rs` — слабое расширение invariant'а «tonic confined to transport/reflection» |
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

`handshaker-core` остаётся без `specta` — wrapper-типы только в `src-tauri/src/ipc/` (продолжение invariant Plan #2 errata #7).

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

**Точная сигнатура `GrpcTransport` per мастер-спека §5.6 (строки 407-418):**

```rust
#[async_trait::async_trait]
pub trait GrpcTransport: Send + Sync {
    async fn channel(&self, target: &GrpcTarget) -> Result<TonicChannel, CoreError>;

    /// Plan #3 добавляет этот метод. Сигнатура — verbatim из мастер-спеки §5.6.
    async fn unary_dynamic(
        &self,
        channel: TonicChannel,
        method_path: String,                          // "/package.Service/Method"
        request_codec: DynamicCodec,
        request: prost_reflect::DynamicMessage,
        metadata: std::collections::HashMap<String, String>,
    ) -> Result<UnaryOutcome, CoreError>;
}
```

5 отдельных параметров. `DynamicCodec` несёт оба дескриптора (request + response), поэтому отдельный `response_descriptor` параметр не нужен. **НЕ** используем bundle-типы `UnaryRequest`/`UnaryResponse` — это было моё расхождение с мастер-спекой, теперь убрано.

**`UnaryOutcome` (определяется в `invoke/mod.rs`):**
```rust
pub struct UnaryOutcome {
    pub status_code: i32,                    // 0 = OK, иначе tonic::Code as i32
    pub status_message: String,              // например "OK" или "NOT_FOUND: ..."
    pub response_json: Option<String>,       // canonical proto3 JSON если status_code == 0
    pub trailing_metadata: std::collections::HashMap<String, String>,
    pub elapsed_ms: u64,                     // сетевой round-trip
}
```

**Транспорт сам производит `UnaryOutcome`** — измеряет таймиг, конвертит DynamicMessage → JSON через `prost-reflect`'s `Serialize` impl, ловит `tonic::Status` и кладёт его поля в `status_code`/`status_message`/`trailing_metadata`. gRPC статус != OK — **нормальный успех** транспорта (`Ok(UnaryOutcome { status_code: 5, ... })`), **не** `Err(CoreError)`.

`Err(CoreError)` транспорта зарезервирован под client-side провалы: `channel.ready()` упал → `Transport`, encode-фейл prost'а → `EncodeRequest`, JSON-сериализация ответа упала → `DecodeResponse`.

**`GrpcConnection` — extension of мастер-спеки §5.6:**
```rust
pub struct GrpcConnection {
    pub target: GrpcTarget,
    pub transport: Arc<dyn GrpcTransport>,
    pub channel: TonicChannel,                  // NEW: single shared channel
    pub pool: prost_reflect::DescriptorPool,
    pub catalog: ServiceCatalog,
}
```

Мастер-спека §5.6 показывает 4 поля. Plan #3 добавляет `channel: TonicChannel` — это **расширение, не нарушение**: трейт-сигнатура `unary_dynamic` принимает `channel` параметром (значит channel должен где-то жить), а acquire-per-call даёт лишний h2 handshake на каждый вызов. Альтернативы (cache в `TonicTransport` с `Mutex<HashMap<...>>`) — over-engineering. `connection.rs` импортирует только alias `crate::grpc::transport::TonicChannel`, не `tonic::transport::Channel` напрямую — границу не пробивает.

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

`invoke_unary` — тонкий координатор: резолвит дескрипторы, парсит request JSON в `DynamicMessage`, строит `DynamicCodec` и path, делегирует транспорту. Транспорт строит `UnaryOutcome` (с таймингом, JSON-ответом, trailing metadata, и `status_code != 0` для gRPC ошибок).

```
invoke_unary(conn, service: "test.Echo", method: "Send", request_json, metadata)

1. resolve_service: conn.pool.get_service_by_name(service)
      None → Err(CoreError::ServiceNotFound { service: service.into() })
2. resolve_method: svc.methods().find(|m| m.name() == method)
      None → Err(CoreError::MethodNotFound { service: service.into(),
                                              method: method.into() })
3. assert_unary: !m.is_client_streaming() && !m.is_server_streaming()
      false → Err(CoreError::NotImplemented("streaming RPC".into()))
4. parse_json: DynamicMessage::deserialize(input_desc,
                  &mut serde_json::Deserializer::from_str(request_json))
      Err(e) → Err(CoreError::EncodeRequest(e.to_string()))
5. build_codec: DynamicCodec { request_descriptor: input_desc,
                                response_descriptor: output_desc }
6. build_path: format!("/{service}/{method}")               // String, не PathAndQuery
7. delegate: conn.transport.unary_dynamic(
                  conn.channel.clone(),
                  path,
                  codec,
                  request_message,
                  metadata,
              ).await
8. AS-IS:
   - Ok(UnaryOutcome) → Ok(UnaryOutcome)
   - Err(CoreError)   → Err(CoreError)
```

`invoke_unary` **НЕ** меряет тайминг и **НЕ** строит JSON — оба относятся к транспортной зоне ответственности (там реальные сетевые миллисекунды; там же `DynamicCodec` с response_descriptor для serialize).

### `unary_dynamic` в `TonicTransport`

```rust
async fn unary_dynamic(
    &self,
    channel: TonicChannel,
    method_path: String,
    request_codec: DynamicCodec,
    request: DynamicMessage,
    metadata: HashMap<String, String>,
) -> Result<UnaryOutcome, CoreError> {
    let mut grpc = tonic::client::Grpc::new(channel);
    grpc.ready().await.map_err(|e| CoreError::Transport(e.to_string()))?;

    let path = method_path.parse::<http::uri::PathAndQuery>()
        .map_err(|e| CoreError::EncodeRequest(
            format!("invalid path `{method_path}`: {e}")))?;

    let mut tonic_req = tonic::Request::new(request);
    inject_ascii_metadata(tonic_req.metadata_mut(), &metadata)?;

    let started = std::time::Instant::now();
    let result = grpc.unary(tonic_req, path, request_codec).await;
    let elapsed_ms = started.elapsed().as_millis() as u64;

    match result {
        Ok(response) => {
            let trailing = metadata_to_map(response.metadata());
            let msg: DynamicMessage = response.into_inner();
            // prost-reflect impl Serialize for DynamicMessage (canonical proto3 JSON)
            let json = serde_json::to_string_pretty(&msg)
                .map_err(|e| CoreError::DecodeResponse(e.to_string()))?;
            Ok(UnaryOutcome {
                status_code: 0,
                status_message: "OK".into(),
                response_json: Some(json),
                trailing_metadata: trailing,
                elapsed_ms,
            })
        }
        Err(status) => Ok(UnaryOutcome {
            status_code: status.code() as i32,
            status_message: format!("{}: {}", status.code(), status.message()),
            response_json: None,
            trailing_metadata: metadata_to_map(status.metadata()),
            elapsed_ms,
        }),
    }
}
```

**Ключевое:** gRPC статус != OK возвращается как `Ok(UnaryOutcome { status_code: 5, ... })`, **не** как `Err(CoreError::GrpcStatus)`. Это согласуется с мастер-спекой §5.6 (где трейт-метод возвращает `Result<UnaryOutcome, CoreError>` — успех — это outcome, включая non-OK status). `CoreError::GrpcStatus` остаётся как defensive variant — invoke его не производит.

**`inject_ascii_metadata`:**
- Ключи: `tonic::metadata::AsciiMetadataKey::from_bytes` (запрещает `-bin` суффикс автоматически).
- Значения: `AsciiMetadataValue::try_from`.
- Ошибки → `CoreError::EncodeRequest("invalid metadata key/value: <detail>".into())`.
- Логирование: значения для ключа `authorization` (case-insensitive) → `<redacted>` в `tracing::debug` (mirror security req мастер-спеки §6.4).

**`metadata_to_map`:** только ASCII-ключи; binary метаданные пропускаем (без ошибки — просто не показываем).

## 7. Error mapping

### 7.1 Все нужные варианты уже есть с Plan #1 — не трогаем CoreError

Plan #1 предзаложил полный набор в `CoreError` и mapping в `IpcError` (см. `crates/handshaker-core/src/error.rs` + `src-tauri/src/ipc/error.rs`). Plan #3 использует их без изменений:

| Вариант | Сигнатура | Где в Plan #3 |
|---|---|---|
| `ServiceNotFound { service: String }` | struct | `invoke_unary` — service не найден в pool |
| `MethodNotFound { service: String, method: String }` | struct | `invoke_unary` — method не найден |
| `EncodeRequest(String)` | tuple | parse JSON / invalid metadata / неудача prost encode / invalid path |
| `DecodeResponse(String)` | tuple | DynamicMessage → JSON serialize fail |
| `Transport(String)` | tuple | `tonic::client::Grpc::ready()` fail |
| `NotImplemented(String)` | tuple | streaming RPC encountered, skip_verify=true |
| `GrpcStatus { code, message }` | struct | **defensive only** — invoke в Plan #3 не производит (см. §7.2) |

### 7.2 Почему `GrpcStatus` не модифицируется

Раньше в этой спеке я предлагал расширить `CoreError::GrpcStatus` полем `trailing_metadata`. **Отзываю** — это противоречило бы мастер-спеке §5.6, где трейт-сигнатура возвращает `Result<UnaryOutcome, CoreError>`: успешные gRPC ответы (включая status != OK) — это `Ok(UnaryOutcome { status_code, status_message, trailing_metadata, response_json: None, elapsed_ms })`, а не `Err`.

Trailing metadata теперь живёт в `UnaryOutcome`, не в `CoreError`. `CoreError::GrpcStatus { code, message }` остаётся в энуме defensively (для будущих планов и чтобы не ломать `IpcError::from` exhaustive match), но invoke в Plan #3 его не порождает.

### 7.3 IPC error mapping — без изменений

`IpcError` и `From<CoreError>` остаются как есть. Никаких новых вариантов, никаких изменений в `ipc::error::tests::from_core_error_exhaustive`.

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

Для `invoke/mod.rs` юнит-тестов — `FakeTransport { outcome: Mutex<Option<Result<UnaryOutcome, CoreError>>>, last_call: Mutex<Option<(String, HashMap<String, String>)>> }` (записывает `method_path` + `metadata` для verification).

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

1. **`DynamicCodec` + unit tests** — без сети, fixture descriptors из Plan #2 (Ping/Pong). Никаких изменений в `CoreError` / `IpcError` не нужно.
2. **`UnaryOutcome` value-type** в `invoke/mod.rs` (struct с status_code, status_message, response_json, trailing_metadata, elapsed_ms) + **trait extension** `GrpcTransport::unary_dynamic(channel, method_path, codec, request, metadata)` per мастер-спека §5.6.
3. **`GrpcConnection.channel` field + `activate()` обновлён** — channel сохраняется, передаётся в reflection `clone()`-ом. Обновить существующие конструкции `GrpcConnection { ... }` (в Plan #2 — `contract.rs`, plus tests) — добавить поле `channel`.
4. **`TonicTransport::unary_dynamic` impl** — собственно тонкая реализация поверх `tonic::client::Grpc::new(channel).unary(...)` с DynamicCodec, prost-reflect JSON serialize и измерением elapsed_ms. + unit test против неответного channel'а (`Transport`-error path).
5. **`spawn_echo_server` test helper** — fall back на тест-only crate с tonic-build, если custom NamedService окажется слишком сложным (R1).
6. **Integration tests** — `invoke_codec.rs` (round-trip), `invoke_unary.rs` (status=0 happy path), `invoke_status.rs` (status=5 NOT_FOUND), `invoke_trailers.rs` (trailing metadata captured).
7. **`invoke/skeleton.rs`** + unit tests (default values, MAX_DEPTH cycle guard, mutual recursion).
8. **`build_request_skeleton` public API** + `invoke_skeleton.rs` integration test.
9. **`invoke::invoke_unary`** + unit tests с `FakeTransport`. Self-contained — собирает все предыдущие куски: resolve service/method, parse JSON, build codec, build path, delegate to transport.
10. **IPC** — `InvokeRequest`/`InvokeOutcomeIpc` + `grpc_invoke_unary` + `grpc_build_request_skeleton` commands + регистрация в `lib.rs`, regenerate `bindings.ts`.
11. **Frontend lib** — `lib/monaco.ts` (lazy loader), `lib/grpc-status.ts` (statusName mapping).
12. **Frontend features/invoke** — `InvokePanel`, `BodyEditor` (Monaco lazy через Suspense).
13. **Frontend features/response** — `ResponsePanel`, `StatusBar`, `BodyView` (Monaco r/o), `TrailersView`.
14. **`CatalogList` modify + `App.tsx` layout** — selectedMethod state, ResizablePanelGroup vertical, click-handler с auto-skeleton fetch.
15. **`invoke_live.rs` `#[ignore]` test** + **manual UI smoke** acceptance gate против `127.0.0.1:5002`.
