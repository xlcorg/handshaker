# Plan #3 — Dynamic Unary Invoke

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать dynamic unary invoke поверх Plan #2 reflection spine — пользователь подключается к произвольному gRPC, кликает на метод, видит auto-skeleton в Monaco, нажимает Send, получает status + JSON response + trailing metadata + elapsed_ms.

**Architecture:** `DynamicCodec` (поверх `prost_reflect::DynamicMessage`) живёт в `transport/codec.rs`; `GrpcTransport` trait расширяется методом `unary_dynamic(channel, method_path, codec, request, metadata) -> UnaryOutcome` (точная сигнатура из мастер-спеки §5.6); `invoke::invoke_unary` — тонкий координатор, который резолвит дескрипторы из `DescriptorPool`, парсит request JSON и делегирует транспорту. Frontend получает `InvokePanel` (Monaco lazy-load для request) + `ResponsePanel` (status bar + Monaco read-only + trailers).

**Tech Stack:**
- Rust: `tonic 0.14` (`Grpc::unary` + custom `Codec`), `prost-reflect 0.14` (`DynamicMessage`, serde feature), `tokio`, `async-trait`.
- Frontend: `@monaco-editor/react` 4.x (lazy через `React.lazy`), shadcn `resizable` (через `react-resizable-panels`).
- Tests: `tonic-health 0.14` уже dev-dep (Plan #2 errata #1).

**Источники (memory rule `feedback_verify_technical_claims`):**
- [tonic 0.14.5 `Grpc::unary`](https://docs.rs/tonic/0.14.5/tonic/client/struct.Grpc.html) — сигнатура `unary(request, path, codec)`, требование `ready().await`
- [tonic 0.14.5 `Codec` trait](https://docs.rs/tonic/0.14.5/tonic/codec/trait.Codec.html) — Encode/Decode типы должны быть `Send + 'static`
- [prost-reflect `DynamicMessage`](https://docs.rs/prost-reflect/0.14/prost_reflect/struct.DynamicMessage.html) — `::new(MessageDescriptor)`, `merge` (Decode), `encode` (Encode), serde Serialize/Deserialize при включённой `serde` feature
- [prost-reflect `MessageDescriptor`](https://docs.rs/prost-reflect/0.14/prost_reflect/struct.MessageDescriptor.html) — `fields()`, `full_name()`
- [prost-reflect `FieldDescriptor` / `Kind`](https://docs.rs/prost-reflect/0.14/prost_reflect/enum.Kind.html) — для skeleton логики
- [@monaco-editor/react README](https://www.npmjs.com/package/@monaco-editor/react) — `Editor` named export, lazy pattern
- [shadcn resizable](https://ui.shadcn.com/docs/components/resizable) — `pnpm dlx shadcn@latest add resizable`

**Out of scope (отложено в будущие планы):**
- Streaming RPCs (server/client/bidi) — не в MVP.
- `skip_verify = true` — отдельный security-knobs sub-plan, hyper-rustls connector ([hyperium/tonic#891](https://github.com/hyperium/tonic/issues/891)). В Plan #3 `TonicTransport::channel` продолжает возвращать `CoreError::NotImplemented` для `skip_verify=true`.
- Metadata UI editor — Plan #5 (Auth).
- Settings tab (per-request overrides) — Plan #?? после Plan #6.
- Variable substitution `{{var}}` — Plan #4 (Variables + Resolver + Env).
- Method picker dialog (⌘K) — Plan #7 (Frontend foundation).
- Collections sidebar — Plan #6.
- Authorization token injection — Plan #5.
- JSON schema validation в Monaco — мастер-спека помечает как next-step.

---

## File map

**Создаём в `handshaker-core`:**

```
crates/handshaker-core/src/grpc/
├── transport/
│   └── codec.rs                  ← NEW: DynamicCodec, DynamicEncoder, DynamicDecoder
└── invoke/
    ├── mod.rs                    ← NEW: pub invoke_unary, pub UnaryOutcome,
    │                                     pub build_request_skeleton
    └── skeleton.rs               ← NEW: build_default_json_skeleton (pub(crate))
```

**Модифицируем в `handshaker-core`:**

```
crates/handshaker-core/src/
├── grpc/
│   ├── mod.rs                    ← + pub mod invoke; pub use re-exports
│   ├── connection.rs             ← + поле GrpcConnection.channel: TonicChannel
│   ├── contract.rs               ← activate() сохраняет channel
│   └── transport/
│       ├── mod.rs                ← + trait метод unary_dynamic(...)
│       └── tonic_impl.rs         ← + impl unary_dynamic для TonicTransport
└── lib.rs                        ← + re-export invoke API
```

**Создаём тесты:**

```
crates/handshaker-core/tests/
├── common/mod.rs                 ← MODIFY: + spawn_echo_server() helper
├── invoke_codec.rs               ← NEW: encode→decode round-trip (без сети)
├── invoke_unary.rs               ← NEW: end-to-end happy path
├── invoke_status.rs              ← NEW: server returns NOT_FOUND → status_code=5
├── invoke_trailers.rs            ← NEW: trailing metadata capture
├── invoke_skeleton.rs            ← NEW: build_request_skeleton против deps fixture
└── invoke_live.rs                ← NEW: #[ignore] тест против 127.0.0.1:5002
```

**Модифицируем в `src-tauri`:**

```
src-tauri/src/
├── ipc/
│   ├── mod.rs                    ← + pub mod invoke; pub use InvokeRequest, InvokeOutcomeIpc
│   └── invoke.rs                 ← NEW: InvokeRequest, InvokeOutcomeIpc + From impl
├── commands/
│   └── grpc.rs                   ← + grpc_invoke_unary, grpc_build_request_skeleton
└── lib.rs                        ← + регистрация обоих commands в collect_commands![]
```

**Frontend:**

```
src/
├── lib/
│   ├── monaco.ts                 ← NEW: lazy loader + EDITOR_OPTIONS + theme
│   └── grpc-status.ts            ← NEW: statusName(code) helper
├── features/
│   ├── invoke/
│   │   ├── InvokePanel.tsx       ← NEW
│   │   └── BodyEditor.tsx        ← NEW (Monaco через Suspense)
│   ├── response/
│   │   ├── ResponsePanel.tsx     ← NEW
│   │   ├── StatusBar.tsx         ← NEW
│   │   ├── BodyView.tsx          ← NEW (Monaco read-only)
│   │   └── TrailersView.tsx      ← NEW (collapsible <details>)
│   └── connect/
│       └── CatalogList.tsx       ← MODIFY: onClick → setSelectedMethod
├── ipc/
│   ├── client.ts                 ← + grpcInvokeUnary, grpcBuildRequestSkeleton
│   └── bindings.ts               ← регенерируется через export-bindings
├── components/ui/
│   └── resizable.tsx             ← NEW (через shadcn add resizable)
└── App.tsx                       ← + selectedMethod state, ResizablePanelGroup
```

---

## Task 1: DynamicCodec + round-trip unit tests

Создаём изолированный codec над `DynamicMessage`. Без сети, без транспорта. Юнит-тестируется напрямую — encode-bytes-decode round-trip против fixture-дескриптора.

**Files:**
- Create: `crates/handshaker-core/src/grpc/transport/codec.rs`
- Modify: `crates/handshaker-core/src/grpc/transport/mod.rs` (добавить `pub mod codec;`)

- [ ] **Step 1: Создать пустой файл `transport/codec.rs`**

Создай файл `crates/handshaker-core/src/grpc/transport/codec.rs` с минимальным содержимым (чтобы тесты ниже скомпилировались до имплементации):

```rust
//! Codec для DynamicMessage. Один codec на один call (per мастер-спека §5.6).
//!
//! Параметризуется парой MessageDescriptor'ов из общего DescriptorPool;
//! tonic::client::Grpc вызывает encoder/decoder для encode request + decode response.

use prost::Message;
use prost_reflect::{DynamicMessage, MessageDescriptor};
use tonic::codec::{Codec, DecodeBuf, Decoder, EncodeBuf, Encoder};
```

- [ ] **Step 2: Зарегистрировать модуль в `transport/mod.rs`**

В `crates/handshaker-core/src/grpc/transport/mod.rs` после `pub mod tonic_impl;` добавь:

```rust
pub mod codec;

pub use codec::DynamicCodec;
```

- [ ] **Step 3: Написать failing-тест — encode→decode round-trip Ping**

В конце `crates/handshaker-core/src/grpc/transport/codec.rs` добавь блок:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use prost_reflect::DescriptorPool;
    use prost_types::FileDescriptorSet;

    /// Минимальный pool с message `test.Ping { string id = 1 }` для round-trip тестов.
    fn ping_pool() -> DescriptorPool {
        // Используем fixture байтов из common test helper'а (пересобираем здесь, чтобы codec.rs
        // оставался unit-тестируемым без integration test infra). Структура:
        // syntax = "proto3"; package test; message Ping { string id = 1; }
        use prost::Message as _;
        use prost_types::{field_descriptor_proto::Type as Ty, *};
        let ping = DescriptorProto {
            name: Some("Ping".to_string()),
            field: vec![FieldDescriptorProto {
                name: Some("id".to_string()),
                number: Some(1),
                r#type: Some(Ty::String as i32),
                ..Default::default()
            }],
            ..Default::default()
        };
        let file = FileDescriptorProto {
            name: Some("test/ping.proto".to_string()),
            package: Some("test".to_string()),
            syntax: Some("proto3".to_string()),
            message_type: vec![ping],
            ..Default::default()
        };
        let set = FileDescriptorSet { file: vec![file] };
        let mut buf = Vec::new();
        set.encode(&mut buf).expect("encode set");
        let mut pool = DescriptorPool::new();
        pool.add_file_descriptor_set(set).expect("add set");
        pool
    }

    fn ping_descriptor() -> MessageDescriptor {
        ping_pool()
            .get_message_by_name("test.Ping")
            .expect("test.Ping in pool")
    }

    #[test]
    fn roundtrip_ping_with_id() {
        let desc = ping_descriptor();
        let mut req = DynamicMessage::new(desc.clone());
        req.set_field_by_name(
            "id",
            prost_reflect::Value::String("hello".to_string()),
        );

        // Encode через DynamicEncoder
        let mut codec = DynamicCodec {
            request_descriptor: desc.clone(),
            response_descriptor: desc.clone(),
        };
        let mut encoder = codec.encoder();
        let mut buf = bytes::BytesMut::new();
        let mut encode_buf = EncodeBuf::new(&mut buf);
        encoder.encode(req.clone(), &mut encode_buf).expect("encode");
        assert!(!buf.is_empty(), "encoded bytes should be non-empty");

        // Decode через DynamicDecoder
        let mut decoder = codec.decoder();
        let mut decode_buf = DecodeBuf::new(&mut buf, buf.len());
        let decoded = decoder
            .decode(&mut decode_buf)
            .expect("decode")
            .expect("Some");
        assert_eq!(decoded.descriptor().full_name(), "test.Ping");
        let id = decoded
            .get_field_by_name("id")
            .expect("field id present")
            .as_str()
            .expect("string")
            .to_string();
        assert_eq!(id, "hello");
    }

    #[test]
    fn roundtrip_empty_message_decodes_to_defaults() {
        let desc = ping_descriptor();
        let req = DynamicMessage::new(desc.clone()); // id = "" default

        let mut codec = DynamicCodec {
            request_descriptor: desc.clone(),
            response_descriptor: desc.clone(),
        };
        let mut encoder = codec.encoder();
        let mut buf = bytes::BytesMut::new();
        let mut encode_buf = EncodeBuf::new(&mut buf);
        encoder.encode(req, &mut encode_buf).expect("encode");

        let mut decoder = codec.decoder();
        let mut decode_buf = DecodeBuf::new(&mut buf, buf.len());
        let decoded = decoder
            .decode(&mut decode_buf)
            .expect("decode")
            .expect("Some");
        // proto3 default for string = "" — поле может отсутствовать в wire format,
        // но get_field_by_name по дефолту возвращает default value.
        let id = decoded
            .get_field_by_name("id")
            .expect("field id present")
            .as_str()
            .expect("string")
            .to_string();
        assert_eq!(id, "");
    }
}
```

- [ ] **Step 4: Прогнать тесты — должно упасть на отсутствии типов**

Run:
```bash
cargo test -p handshaker-core --lib codec::tests
```
Expected: FAIL — `DynamicCodec`, `DynamicEncoder`, `DynamicDecoder` не определены.

Если в `Cargo.toml` ещё нет `bytes` (Plan #2 cleanup убрал его) — добавь только в `[dev-dependencies]`:

```toml
[dev-dependencies]
tokio = { workspace = true, features = ["macros", "rt-multi-thread"] }
bytes = "1"
```

- [ ] **Step 5: Реализовать DynamicCodec/Encoder/Decoder**

В `crates/handshaker-core/src/grpc/transport/codec.rs` (между use-блоком и `#[cfg(test)]`) добавь:

```rust
/// Codec для динамических protobuf-сообщений. Несёт descriptor'ы request и response
/// той Method'ы, которую вызываем — `tonic::client::Grpc` вызывает `encoder()`
/// перед отправкой и `decoder()` после получения.
pub struct DynamicCodec {
    pub request_descriptor: MessageDescriptor,
    pub response_descriptor: MessageDescriptor,
}

/// Encoder — без внутреннего state. DynamicMessage сам несёт свой descriptor
/// и реализует `prost::Message::encode`.
pub struct DynamicEncoder;

/// Decoder — содержит response descriptor, чтобы создать `DynamicMessage::new`
/// и заполнить его из wire bytes через `merge`.
pub struct DynamicDecoder {
    response_descriptor: MessageDescriptor,
}

impl Codec for DynamicCodec {
    type Encode = DynamicMessage;
    type Decode = DynamicMessage;
    type Encoder = DynamicEncoder;
    type Decoder = DynamicDecoder;

    fn encoder(&mut self) -> Self::Encoder {
        DynamicEncoder
    }

    fn decoder(&mut self) -> Self::Decoder {
        DynamicDecoder {
            response_descriptor: self.response_descriptor.clone(),
        }
    }
}

impl Encoder for DynamicEncoder {
    type Item = DynamicMessage;
    type Error = tonic::Status;

    fn encode(&mut self, item: Self::Item, dst: &mut EncodeBuf<'_>) -> Result<(), Self::Error> {
        item.encode(dst)
            .map_err(|e| tonic::Status::internal(format!("dynamic encode: {e}")))
    }
}

impl Decoder for DynamicDecoder {
    type Item = DynamicMessage;
    type Error = tonic::Status;

    fn decode(&mut self, src: &mut DecodeBuf<'_>) -> Result<Option<Self::Item>, Self::Error> {
        let mut msg = DynamicMessage::new(self.response_descriptor.clone());
        msg.merge(src)
            .map_err(|e| tonic::Status::internal(format!("dynamic decode: {e}")))?;
        Ok(Some(msg))
    }
}
```

- [ ] **Step 6: Прогнать тесты — должно пройти**

Run:
```bash
cargo test -p handshaker-core --lib codec::tests
```
Expected: PASS — 2 tests pass.

- [ ] **Step 7: Clippy**

Run:
```bash
cargo clippy -p handshaker-core --all-targets -- -D warnings
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add crates/handshaker-core/src/grpc/transport/codec.rs \
        crates/handshaker-core/src/grpc/transport/mod.rs \
        crates/handshaker-core/Cargo.toml
git commit -m "feat(grpc): DynamicCodec над DynamicMessage + round-trip tests"
```

---

## Task 2: GrpcConnection.channel + activate() update

Добавляем поле `channel: TonicChannel` в `GrpcConnection` и сохраняем его в `activate()`. Это подготовка к Task 4 — `unary_dynamic` примет channel параметром и invoke получит его из connection.

**Files:**
- Modify: `crates/handshaker-core/src/grpc/connection.rs`
- Modify: `crates/handshaker-core/src/grpc/contract.rs`
- Modify: `crates/handshaker-core/tests/contract_activate.rs` (test reference adjustments)

- [ ] **Step 1: Написать failing-тест — `GrpcConnection` имеет channel field**

В `crates/handshaker-core/src/grpc/connection.rs` в существующем `#[cfg(test)] mod tests` (рядом с `accepts_valid_hostport`) добавь:

```rust
    #[test]
    fn grpc_connection_struct_has_channel_field() {
        // Compile-only тест: если поле `channel: TonicChannel` исчезнет, не скомпилируется.
        fn _accepts_channel(c: &super::GrpcConnection) -> &crate::grpc::transport::TonicChannel {
            &c.channel
        }
    }
```

- [ ] **Step 2: Прогнать тест — должно не скомпилироваться**

Run:
```bash
cargo test -p handshaker-core --lib grpc::connection::tests::grpc_connection_struct_has_channel_field
```
Expected: COMPILE FAIL — `no field 'channel' on type 'GrpcConnection'`.

- [ ] **Step 3: Добавить поле `channel` в `GrpcConnection`**

В `crates/handshaker-core/src/grpc/connection.rs` импорт top-of-file:

```rust
use crate::grpc::transport::TonicChannel;
```

Замени определение `GrpcConnection` на:

```rust
/// Live connection state — the result of `activate()`. Holds the channel-bearing transport
/// plus the assembled descriptor pool and projected catalog. **NOT** `Clone`: there's at most
/// one live connection in the app (per spec §4 "Activated gRPC connections = 1").
///
/// `channel` хранится здесь, чтобы invoke не делал лишний h2-handshake на каждый вызов —
/// один Channel acquired в `activate()` и переиспользуется. Plan #3 §3.1.1 объясняет
/// почему это pragmatic relaxation invariant'а Plan #2 «tonic confined to transport/reflection».
pub struct GrpcConnection {
    pub target: GrpcTarget,
    pub transport: Arc<dyn crate::grpc::GrpcTransport>,
    pub channel: TonicChannel,
    pub pool: prost_reflect::DescriptorPool,
    pub catalog: ServiceCatalog,
}
```

Найди `impl std::fmt::Debug for GrpcConnection` и оставь без изменений (channel не показываем в Debug — `tonic::transport::Channel` не impl Debug в полезном виде).

- [ ] **Step 4: Обновить `activate()` в `contract.rs` — сохранить channel**

В `crates/handshaker-core/src/grpc/contract.rs` замени тело `activate` на:

```rust
pub async fn activate(
    target: GrpcTarget,
    transport: Arc<dyn GrpcTransport>,
) -> Result<GrpcConnection, CoreError> {
    let channel = transport.channel(&target).await?;
    // clone — TonicChannel дешёвый Clone (Arc внутри), reflection consume его свою копию,
    // оригинал останется в GrpcConnection для последующих invoke.
    let (_services_listed, files) = list_and_fetch_files(channel.clone()).await?;
    let pool = build_pool(files)?;
    let catalog = build_catalog(&pool);
    Ok(GrpcConnection {
        target,
        transport,
        channel,
        pool,
        catalog,
    })
}
```

- [ ] **Step 5: Прогнать unit-test`channel` field + полный test suite**

Run:
```bash
cargo test -p handshaker-core --lib
cargo test -p handshaker-core --tests
```
Expected: ALL PASS (включая существующий `contract_activate.rs` integration тест).

Если `contract_activate.rs` (или другой test) явно конструирует `GrpcConnection { ... }` без `channel` — он упадёт на компиляции. В таких местах добавь поле `channel: transport.channel(&target).await?` или используй уже-результат `activate()` (предпочтительно).

- [ ] **Step 6: Clippy**

```bash
cargo clippy -p handshaker-core --all-targets -- -D warnings
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add crates/handshaker-core/src/grpc/connection.rs \
        crates/handshaker-core/src/grpc/contract.rs
git commit -m "feat(grpc): GrpcConnection.channel — reuse single Channel across invokes"
```

---

## Task 3: GrpcTransport::unary_dynamic trait extension + UnaryOutcome type

Расширяем trait методом `unary_dynamic` точно по сигнатуре мастер-спеки §5.6. `UnaryOutcome` value-type живёт в новом модуле `invoke/mod.rs`.

**Files:**
- Create: `crates/handshaker-core/src/grpc/invoke/mod.rs`
- Modify: `crates/handshaker-core/src/grpc/mod.rs` (добавить `pub mod invoke;`)
- Modify: `crates/handshaker-core/src/grpc/transport/mod.rs` (trait extension)
- Modify: `crates/handshaker-core/src/lib.rs` (re-export)
- Modify: `crates/handshaker-core/src/grpc/transport/tonic_impl.rs` (stub impl)

- [ ] **Step 1: Создать `invoke/mod.rs` с `UnaryOutcome`**

Создай файл `crates/handshaker-core/src/grpc/invoke/mod.rs`:

```rust
//! Dynamic unary invoke API.
//!
//! - `UnaryOutcome` — единый тип результата вызова: status + JSON response + trailing metadata + timing.
//! - `invoke_unary` — будет добавлено в Task 9. В Task 3 определяем только тип.

use std::collections::HashMap;

/// Результат одного unary вызова. `status_code == 0` означает успех (response_json — `Some`).
/// Любой другой код — нормальный gRPC статус != OK (response_json `None`); в этом случае
/// `status_message` содержит `{Code}: {message}` (например `"NOT_FOUND: user does not exist"`).
///
/// Client-side провалы (transport / encode / decode) возвращаются как `Err(CoreError)`,
/// не как UnaryOutcome со status != 0. См. Plan #3 §6.
#[derive(Debug, Clone)]
pub struct UnaryOutcome {
    pub status_code: i32,
    pub status_message: String,
    pub response_json: Option<String>,
    pub trailing_metadata: HashMap<String, String>,
    pub elapsed_ms: u64,
}
```

- [ ] **Step 2: Зарегистрировать модуль в `grpc/mod.rs`**

В `crates/handshaker-core/src/grpc/mod.rs` после строки `pub mod transport;` (порядок не важен — в alphabet'е) добавь:

```rust
pub mod invoke;
```

В конце того же файла добавь re-export для удобства:

```rust
pub use invoke::UnaryOutcome;
```

- [ ] **Step 3: Re-export из `lib.rs`**

В `crates/handshaker-core/src/lib.rs` найди блок `pub use` и добавь:

```rust
pub use grpc::UnaryOutcome;
```

- [ ] **Step 4: Написать failing-тест на trait — у `GrpcTransport` есть метод `unary_dynamic`**

В `crates/handshaker-core/src/grpc/transport/mod.rs` (в конец файла) добавь:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    /// Compile-only test: trait должен экспонировать метод `unary_dynamic` с точной
    /// сигнатурой из мастер-спеки §5.6.
    #[allow(dead_code)]
    fn _trait_has_unary_dynamic<T: GrpcTransport>(
        t: &T,
        channel: TonicChannel,
        method_path: String,
        request_codec: crate::grpc::transport::DynamicCodec,
        request: prost_reflect::DynamicMessage,
        metadata: std::collections::HashMap<String, String>,
    ) -> impl std::future::Future<Output = Result<crate::grpc::UnaryOutcome, crate::error::CoreError>> + use<'_, T>
    {
        t.unary_dynamic(channel, method_path, request_codec, request, metadata)
    }
}
```

- [ ] **Step 5: Прогнать — должно не скомпилироваться**

Run:
```bash
cargo build -p handshaker-core --tests
```
Expected: COMPILE FAIL — `no method 'unary_dynamic' for trait GrpcTransport`.

- [ ] **Step 6: Добавить метод `unary_dynamic` в trait**

В `crates/handshaker-core/src/grpc/transport/mod.rs` замени блок trait определения на:

```rust
#[async_trait::async_trait]
pub trait GrpcTransport: Send + Sync {
    /// Открыть HTTP/2 канал к `target`. Plan #2.
    async fn channel(&self, target: &GrpcTarget) -> Result<TonicChannel, CoreError>;

    /// Выполнить unary RPC на уже открытом канале. Plan #3 — сигнатура из мастер-спеки §5.6.
    ///
    /// - `channel` берётся по value (Clone из `GrpcConnection.channel`).
    /// - `method_path` — `/package.Service/Method`.
    /// - `request_codec` — `DynamicCodec` с обоими descriptor'ами.
    /// - `request` — уже-распарсенный DynamicMessage (JSON parsing делает invoke_unary).
    /// - `metadata` — ASCII keys; binary (`-bin`) суффикс отвергается `EncodeRequest`.
    ///
    /// Возвращает `UnaryOutcome` для ВСЕХ gRPC ответов, включая status != OK.
    /// `Err(CoreError)` только для client-side провалов (channel ready fail, encode/decode).
    async fn unary_dynamic(
        &self,
        channel: TonicChannel,
        method_path: String,
        request_codec: DynamicCodec,
        request: prost_reflect::DynamicMessage,
        metadata: std::collections::HashMap<String, String>,
    ) -> Result<crate::grpc::UnaryOutcome, CoreError>;
}
```

- [ ] **Step 7: Stub implementation в `TonicTransport` (упадёт с `NotImplemented` — настоящий impl в Task 4)**

В `crates/handshaker-core/src/grpc/transport/tonic_impl.rs` в `impl GrpcTransport for TonicTransport` после `channel(...)` добавь:

```rust
    async fn unary_dynamic(
        &self,
        _channel: TonicChannel,
        _method_path: String,
        _request_codec: crate::grpc::transport::DynamicCodec,
        _request: prost_reflect::DynamicMessage,
        _metadata: std::collections::HashMap<String, String>,
    ) -> Result<crate::grpc::UnaryOutcome, CoreError> {
        Err(CoreError::NotImplemented(
            "unary_dynamic — настоящий impl в Plan #3 Task 4".into(),
        ))
    }
```

- [ ] **Step 8: Прогнать — должно скомпилироваться, _trait_has_unary_dynamic должен пройти**

Run:
```bash
cargo test -p handshaker-core --lib
```
Expected: PASS (existing tests + новый compile-only test).

- [ ] **Step 9: Clippy**

```bash
cargo clippy -p handshaker-core --all-targets -- -D warnings
```
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add crates/handshaker-core/src/grpc/invoke \
        crates/handshaker-core/src/grpc/mod.rs \
        crates/handshaker-core/src/grpc/transport/mod.rs \
        crates/handshaker-core/src/grpc/transport/tonic_impl.rs \
        crates/handshaker-core/src/lib.rs
git commit -m "feat(grpc): trait GrpcTransport::unary_dynamic + UnaryOutcome type (stub impl)"
```

---

## Task 4: TonicTransport::unary_dynamic — настоящая реализация + unit test

Реализуем `unary_dynamic` поверх `tonic::client::Grpc::new(channel).unary(...)`. Меряем elapsed_ms, конвертим DynamicMessage → canonical JSON через prost-reflect serde, ловим `tonic::Status` и кладём в UnaryOutcome.

**Files:**
- Modify: `crates/handshaker-core/src/grpc/transport/tonic_impl.rs`

- [ ] **Step 1: Написать failing-тест — Transport error на неответном channel**

В `crates/handshaker-core/src/grpc/transport/tonic_impl.rs` в `#[cfg(test)] mod tests` (рядом с `skip_verify_returns_not_implemented`) добавь:

```rust
    #[tokio::test]
    async fn unary_dynamic_returns_transport_error_on_dead_channel() {
        use crate::grpc::transport::DynamicCodec;
        use crate::grpc::UnaryOutcome;
        use prost::Message as _;
        use prost_reflect::{DescriptorPool, DynamicMessage};
        use prost_types::{field_descriptor_proto::Type as Ty, *};
        use std::collections::HashMap;

        // Bind a port and immediately drop the listener — connect to it will fail.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        drop(listener);

        // Open a lazy channel — connect_lazy не падает сразу, но первый ready().await
        // (внутри unary_dynamic) увидит, что порт закрыт.
        let channel = tonic::transport::Channel::from_shared(format!("http://{addr}"))
            .unwrap()
            .connect_lazy();

        // Минимальный pool для DynamicCodec.
        let ping = DescriptorProto {
            name: Some("Ping".to_string()),
            field: vec![FieldDescriptorProto {
                name: Some("id".to_string()),
                number: Some(1),
                r#type: Some(Ty::String as i32),
                ..Default::default()
            }],
            ..Default::default()
        };
        let file = FileDescriptorProto {
            name: Some("test/ping.proto".to_string()),
            package: Some("test".to_string()),
            syntax: Some("proto3".to_string()),
            message_type: vec![ping],
            ..Default::default()
        };
        let set = FileDescriptorSet { file: vec![file] };
        let mut pool = DescriptorPool::new();
        pool.add_file_descriptor_set(set).expect("add set");
        let desc = pool.get_message_by_name("test.Ping").unwrap();

        let codec = DynamicCodec {
            request_descriptor: desc.clone(),
            response_descriptor: desc.clone(),
        };
        let request = DynamicMessage::new(desc);

        let t = TonicTransport::new();
        let result: Result<UnaryOutcome, _> = t
            .unary_dynamic(
                channel,
                "/test.Ping/Send".to_string(),
                codec,
                request,
                HashMap::new(),
            )
            .await;

        let err = result.expect_err("dead channel should fail before any successful unary");
        assert!(
            matches!(err, CoreError::Transport(_)),
            "expected Transport variant, got {err:?}"
        );
    }
```

- [ ] **Step 2: Прогнать тест — должно упасть на NotImplemented (stub из Task 3)**

Run:
```bash
cargo test -p handshaker-core --lib unary_dynamic_returns_transport_error_on_dead_channel
```
Expected: FAIL — `err` будет `CoreError::NotImplemented`, не `CoreError::Transport`.

- [ ] **Step 3: Заменить stub на настоящую реализацию**

В `crates/handshaker-core/src/grpc/transport/tonic_impl.rs` после existing imports добавь:

```rust
use crate::grpc::transport::DynamicCodec;
use crate::grpc::UnaryOutcome;
use prost_reflect::DynamicMessage;
use std::collections::HashMap;
```

Замени stub `unary_dynamic` на полную реализацию:

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
        grpc.ready()
            .await
            .map_err(|e| CoreError::Transport(format!("channel not ready: {e}")))?;

        let path: http::uri::PathAndQuery = method_path
            .parse()
            .map_err(|e| CoreError::EncodeRequest(format!("invalid path `{method_path}`: {e}")))?;

        let mut tonic_req = tonic::Request::new(request);
        inject_ascii_metadata(tonic_req.metadata_mut(), &metadata)?;

        let started = std::time::Instant::now();
        let result = grpc.unary(tonic_req, path, request_codec).await;
        let elapsed_ms = started.elapsed().as_millis() as u64;

        match result {
            Ok(response) => {
                let trailing = metadata_to_map(response.metadata());
                let msg: DynamicMessage = response.into_inner();
                // prost-reflect impl Serialize for DynamicMessage = canonical proto3 JSON.
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
}

/// Положить ASCII-метаданные из HashMap в `tonic::metadata::MetadataMap`.
/// Binary (`-bin` суффикс) отвергаем — это упрощение MVP (Plan #3 §2 D10).
fn inject_ascii_metadata(
    md: &mut tonic::metadata::MetadataMap,
    pairs: &HashMap<String, String>,
) -> Result<(), CoreError> {
    for (k, v) in pairs {
        let key = tonic::metadata::AsciiMetadataKey::from_bytes(k.to_lowercase().as_bytes())
            .map_err(|e| CoreError::EncodeRequest(format!("invalid metadata key `{k}`: {e}")))?;
        let value = tonic::metadata::AsciiMetadataValue::try_from(v.as_str())
            .map_err(|e| CoreError::EncodeRequest(format!("invalid metadata value for `{k}`: {e}")))?;
        md.insert(key, value);
    }
    Ok(())
}

/// Достать ASCII-ключи из MetadataMap. Binary-ключи (`-bin`) пропускаем без ошибки.
fn metadata_to_map(md: &tonic::metadata::MetadataMap) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for kv in md.iter() {
        if let tonic::metadata::KeyAndValueRef::Ascii(k, v) = kv {
            if let Ok(s) = v.to_str() {
                out.insert(k.to_string(), s.to_string());
            }
        }
    }
    out
}
```

Удали лишний `}` если он образовался — в исходном файле был один `impl ... { channel }` блок, теперь там два метода и фрагменты функций после `}`. Структура должна быть:

```rust
#[async_trait::async_trait]
impl GrpcTransport for TonicTransport {
    async fn channel(...) -> ... { ... }
    async fn unary_dynamic(...) -> ... { ... }
}

fn inject_ascii_metadata(...) -> ... { ... }
fn metadata_to_map(...) -> ... { ... }

#[cfg(test)]
mod tests { ... }
```

- [ ] **Step 4: Прогнать новый тест — должно пройти**

Run:
```bash
cargo test -p handshaker-core --lib unary_dynamic_returns_transport_error_on_dead_channel
```
Expected: PASS.

- [ ] **Step 5: Прогнать ВСЕ тесты — ничего не должно сломаться**

```bash
cargo test -p handshaker-core
```
Expected: ALL PASS.

- [ ] **Step 6: Clippy**

```bash
cargo clippy -p handshaker-core --all-targets -- -D warnings
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add crates/handshaker-core/src/grpc/transport/tonic_impl.rs
git commit -m "feat(grpc): TonicTransport::unary_dynamic over tonic::client::Grpc"
```

---

## Task 5: `spawn_echo_server` test helper

Добавляем в `tests/common/mod.rs` helper, который поднимает tonic-сервер с reflection (через уже существующий fixture) + custom unary-сервис, реализующий `test.Echo/Send` через `tower::Service<http::Request<...>>`. Без `tonic-build`, без статических stub'ов — нужно для invoke_unary integration tests.

**Архитектурный риск (R1 в spec'е):** если ручной `tower::Service` окажется слишком сложным, fall back на отдельный test-only crate с tonic-build. Решение принимается в Step 4 ниже.

**Files:**
- Modify: `crates/handshaker-core/tests/common/mod.rs`

- [ ] **Step 1: Прочитать существующий common/mod.rs и понять патерны**

Открой `crates/handshaker-core/tests/common/mod.rs`. Помни:
- `fixture_descriptor_set_bytes()` строит `test.Echo/Send(Ping) → Pong`.
- `spawn_reflection_server_v1` поднимает tonic Server с tonic-reflection и `serve_with_incoming_shutdown` (TOCTOU-safe per errata #2).
- Используется `tokio_stream::wrappers::TcpListenerStream`.
- HealthServer как filler в `spawn_bare_server` — пример регистрации custom-сервиса.

- [ ] **Step 2: Добавить `EchoConfig` + `EchoSvc` через ручной `tonic::server::NamedService`**

В конец `crates/handshaker-core/tests/common/mod.rs` добавь:

```rust
use crate::common; // self-import for documentation; in tests this isn't needed
```

Удали эту строку — это для documentation. Реально добавляй прямо:

```rust
use std::sync::Arc;
use tokio::sync::Mutex;

/// Конфигурация поведения EchoSvc — нужна для status_code / trailers / canned response.
#[derive(Clone, Default, Debug)]
pub struct EchoConfig {
    /// Если `Some(code)` — Echo.Send возвращает gRPC статус с этим кодом (вместо OK).
    /// Используется `invoke_status` тестом (code = 5 NOT_FOUND).
    pub return_status: Option<i32>,
    /// Дополнительные trailing metadata, которые сервер инжектит в ответ.
    pub trailers: std::collections::HashMap<String, String>,
}

/// In-process gRPC сервер, реализующий `test.Echo/Send(Ping) → Pong { id, echoed }` через
/// DynamicCodec (без tonic-build / static stubs). Также экспонирует reflection,
/// чтобы клиент в Plan #3 тестах мог сделать activate() и invoke за один раз.
///
/// `EchoConfig` управляется атомарно — тесты могут поднять сервер с разной конфигурацией.
pub async fn spawn_echo_server(config: EchoConfig) -> (SocketAddr, oneshot::Sender<()>) {
    use prost_reflect::{DescriptorPool, DynamicMessage};

    // Используем тот же fixture, что и в reflection-test'ах — гарантия совместимости.
    let mut pool = DescriptorPool::new();
    pool.add_file_descriptor_set(
        prost::Message::decode(&fixture_descriptor_set_bytes()[..]).expect("decode fixture set"),
    )
    .expect("add fixture to pool");

    let ping_desc = pool
        .get_message_by_name("test.Ping")
        .expect("test.Ping in pool");
    let pong_desc = pool
        .get_message_by_name("test.Pong")
        .expect("test.Pong in pool");

    let svc = EchoService {
        ping_desc,
        pong_desc,
        config: Arc::new(Mutex::new(config)),
    };

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let (tx, rx) = oneshot::channel::<()>();

    let reflection = tonic_reflection::server::Builder::configure()
        .register_encoded_file_descriptor_set(&fixture_descriptor_set_bytes())
        .build_v1()
        .expect("build v1 reflection service");

    tokio::spawn(async move {
        let incoming = tokio_stream::wrappers::TcpListenerStream::new(listener);
        let _ = tonic::transport::Server::builder()
            .add_service(reflection)
            .add_service(svc)
            .serve_with_incoming_shutdown(incoming, async {
                rx.await.ok();
            })
            .await;
    });
    (addr, tx)
}

/// Custom unary service для `/test.Echo/Send`. Реализован через `tower::Service`
/// + tonic helpers, без tonic-build кодгена.
#[derive(Clone)]
struct EchoService {
    ping_desc: prost_reflect::MessageDescriptor,
    pong_desc: prost_reflect::MessageDescriptor,
    config: Arc<Mutex<EchoConfig>>,
}

impl tonic::server::NamedService for EchoService {
    const NAME: &'static str = "test.Echo";
}

impl<B> tower::Service<http::Request<B>> for EchoService
where
    B: http_body::Body<Data = bytes::Bytes> + Send + 'static,
    B::Error: Into<Box<dyn std::error::Error + Send + Sync>> + Send + 'static,
{
    type Response = http::Response<tonic::body::Body>;
    type Error = std::convert::Infallible;
    type Future = std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<Self::Response, Self::Error>> + Send>,
    >;

    fn poll_ready(
        &mut self,
        _cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Result<(), Self::Error>> {
        std::task::Poll::Ready(Ok(()))
    }

    fn call(&mut self, req: http::Request<B>) -> Self::Future {
        let path = req.uri().path().to_string();
        let ping_desc = self.ping_desc.clone();
        let pong_desc = self.pong_desc.clone();
        let config = self.config.clone();

        Box::pin(async move {
            if path != "/test.Echo/Send" {
                // Любой другой путь — Unimplemented.
                let mut grpc = tonic::server::Grpc::new(
                    crate::common::dynamic_codec_for(ping_desc.clone(), pong_desc.clone()),
                );
                let svc_call = |_req: tonic::Request<prost_reflect::DynamicMessage>| async move {
                    Err::<tonic::Response<prost_reflect::DynamicMessage>, _>(tonic::Status::unimplemented(
                        format!("unknown path `{path}`"),
                    ))
                };
                let resp = grpc.unary(EchoUnary { svc_call }, req).await;
                return Ok(resp);
            }

            let codec = crate::common::dynamic_codec_for(ping_desc.clone(), pong_desc.clone());
            let mut grpc = tonic::server::Grpc::new(codec);

            let config_snapshot = config.lock().await.clone();
            let svc = EchoSvc {
                pong_desc: pong_desc.clone(),
                config: config_snapshot,
            };
            let resp = grpc.unary(svc, req).await;
            Ok(resp)
        })
    }
}

/// Wrapper для tonic::server::UnaryService trait.
struct EchoSvc {
    pong_desc: prost_reflect::MessageDescriptor,
    config: EchoConfig,
}

impl tonic::server::UnaryService<prost_reflect::DynamicMessage> for EchoSvc {
    type Response = prost_reflect::DynamicMessage;
    type Future = std::pin::Pin<
        Box<
            dyn std::future::Future<Output = Result<tonic::Response<Self::Response>, tonic::Status>>
                + Send,
        >,
    >;

    fn call(&mut self, request: tonic::Request<prost_reflect::DynamicMessage>) -> Self::Future {
        let pong_desc = self.pong_desc.clone();
        let config = self.config.clone();
        Box::pin(async move {
            if let Some(code) = config.return_status {
                let mut status = tonic::Status::new(
                    tonic::Code::from_i32(code),
                    format!("server returned configured status code {code}"),
                );
                for (k, v) in &config.trailers {
                    let key = tonic::metadata::AsciiMetadataKey::from_bytes(k.as_bytes())
                        .map_err(|e| tonic::Status::internal(format!("trailer key: {e}")))?;
                    let value = tonic::metadata::AsciiMetadataValue::try_from(v.as_str())
                        .map_err(|e| tonic::Status::internal(format!("trailer value: {e}")))?;
                    status.metadata_mut().insert(key, value);
                }
                return Err(status);
            }
            let req = request.into_inner();
            let id = req
                .get_field_by_name("id")
                .and_then(|v| v.as_str().map(|s| s.to_string()))
                .unwrap_or_default();
            let mut pong = prost_reflect::DynamicMessage::new(pong_desc);
            pong.set_field_by_name("id", prost_reflect::Value::String(id.clone()));
            pong.set_field_by_name(
                "echoed",
                prost_reflect::Value::String(format!("echo: {id}")),
            );
            let mut response = tonic::Response::new(pong);
            for (k, v) in &config.trailers {
                let key = tonic::metadata::AsciiMetadataKey::from_bytes(k.as_bytes())
                    .map_err(|e| tonic::Status::internal(format!("trailer key: {e}")))?;
                let value = tonic::metadata::AsciiMetadataValue::try_from(v.as_str())
                    .map_err(|e| tonic::Status::internal(format!("trailer value: {e}")))?;
                response.metadata_mut().insert(key, value);
            }
            Ok(response)
        })
    }
}

/// Helper для tonic::server::Grpc — оборачивает async closure в правильный UnaryService.
struct EchoUnary<F> {
    svc_call: F,
}

impl<F, Fut> tonic::server::UnaryService<prost_reflect::DynamicMessage> for EchoUnary<F>
where
    F: FnMut(
            tonic::Request<prost_reflect::DynamicMessage>,
        ) -> Fut
        + Send,
    Fut: std::future::Future<
            Output = Result<tonic::Response<prost_reflect::DynamicMessage>, tonic::Status>,
        > + Send
        + 'static,
{
    type Response = prost_reflect::DynamicMessage;
    type Future = std::pin::Pin<
        Box<
            dyn std::future::Future<Output = Result<tonic::Response<Self::Response>, tonic::Status>>
                + Send,
        >,
    >;
    fn call(&mut self, req: tonic::Request<prost_reflect::DynamicMessage>) -> Self::Future {
        Box::pin((self.svc_call)(req))
    }
}

/// Production-side helper: построить DynamicCodec из пары дескрипторов.
pub fn dynamic_codec_for(
    request_descriptor: prost_reflect::MessageDescriptor,
    response_descriptor: prost_reflect::MessageDescriptor,
) -> handshaker_core::grpc::transport::DynamicCodec {
    handshaker_core::grpc::transport::DynamicCodec {
        request_descriptor,
        response_descriptor,
    }
}
```

Также убедись, что top-of-file импорты содержат:

```rust
use std::net::SocketAddr;
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use prost::Message;
```

(если каких-то нет — добавь).

- [ ] **Step 3: Smoke test для нового helper'а — поднять и сразу остановить**

Добавь в `crates/handshaker-core/tests/common_smoke.rs` (этот файл уже есть из Plan #2) тест:

```rust
#[tokio::test]
async fn spawn_echo_server_binds_and_shuts_down() {
    let (addr, stop) = common::spawn_echo_server(common::EchoConfig::default()).await;
    assert!(addr.port() > 0);
    drop(stop);
    // No assertion on shutdown — drop signal'ит rx; task завершится в background.
}
```

- [ ] **Step 4: Прогнать тест — должно скомпилироваться и пройти**

Run:
```bash
cargo test -p handshaker-core --test common_smoke spawn_echo_server_binds_and_shuts_down
```
Expected: PASS.

**Если падает на компиляции** (типичные грабли с tower::Service / tonic::server::Grpc API в 0.14):
1. Открой [tonic 0.14 server module docs](https://docs.rs/tonic/0.14.5/tonic/server/index.html) — там примеры NamedService + Grpc::unary.
2. Если компилируется но runtime-проблемы — добавь `tracing_subscriber::fmt::init()` в начало теста, прогоняй с `RUST_LOG=trace`.
3. **R1 fall-back** (если ручной impl не складывается): создай test-only crate `crates/handshaker-core/tests-grpc-stubs/` с `build.rs` через `tonic-build`, генерирующий статические Echo stubs. Подключи как `[dev-dependencies]` в handshaker-core. Документируй в errata.

- [ ] **Step 5: Clippy**

```bash
cargo clippy -p handshaker-core --tests -- -D warnings
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/handshaker-core/tests/common/mod.rs \
        crates/handshaker-core/tests/common_smoke.rs
git commit -m "test(grpc): spawn_echo_server helper для invoke integration tests"
```

---

## Task 6: invoke_codec.rs — DynamicCodec end-to-end round-trip

Integration test: encode-bytes-decode через codec против разных схем (scalars, nested, repeated). Без сети — чисто codec behavior.

**Files:**
- Create: `crates/handshaker-core/tests/invoke_codec.rs`

- [ ] **Step 1: Создать тест с round-trip для Ping + nested PingX**

Создай файл `crates/handshaker-core/tests/invoke_codec.rs`:

```rust
//! End-to-end DynamicCodec round-trip против разных fixture-схем.
//! Без сети — encode → bytes → decode → assert fields.

mod common;

use bytes::BytesMut;
use handshaker_core::grpc::transport::DynamicCodec;
use prost::Message;
use prost_reflect::{DescriptorPool, DynamicMessage, Value};
use tonic::codec::{Codec, DecodeBuf, EncodeBuf};

fn pool_simple() -> DescriptorPool {
    let mut pool = DescriptorPool::new();
    let set = prost_types::FileDescriptorSet::decode(&common::fixture_descriptor_set_bytes()[..])
        .expect("decode fixture set");
    pool.add_file_descriptor_set(set).expect("add to pool");
    pool
}

fn pool_with_deps() -> DescriptorPool {
    let mut pool = DescriptorPool::new();
    let set = prost_types::FileDescriptorSet::decode(
        &common::fixture_descriptor_set_with_deps_bytes()[..],
    )
    .expect("decode with-deps set");
    pool.add_file_descriptor_set(set).expect("add to pool");
    pool
}

#[test]
fn roundtrip_ping_pong() {
    let pool = pool_simple();
    let ping = pool.get_message_by_name("test.Ping").unwrap();
    let pong = pool.get_message_by_name("test.Pong").unwrap();

    let mut req = DynamicMessage::new(ping.clone());
    req.set_field_by_name("id", Value::String("abc".to_string()));

    let mut codec = DynamicCodec {
        request_descriptor: ping,
        response_descriptor: pong.clone(),
    };
    let mut encoder = codec.encoder();
    let mut buf = BytesMut::new();
    let mut encode_buf = EncodeBuf::new(&mut buf);
    encoder.encode(req, &mut encode_buf).expect("encode");
    assert!(!buf.is_empty());

    // Decoder configured для pong descriptor'а, но bytes на самом деле от Ping —
    // тест прогоняет round-trip Ping→Ping (используем Ping в качестве response_desc).
    let mut codec_ping = DynamicCodec {
        request_descriptor: pong.clone(),
        response_descriptor: pool_simple().get_message_by_name("test.Ping").unwrap(),
    };
    let mut decoder = codec_ping.decoder();
    let mut decode_buf = DecodeBuf::new(&mut buf, buf.len());
    let decoded = decoder.decode(&mut decode_buf).expect("decode").unwrap();
    let id = decoded
        .get_field_by_name("id")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .expect("id");
    assert_eq!(id, "abc");
}

#[test]
fn roundtrip_nested_message_with_deps() {
    let pool = pool_with_deps();
    let ping_x = pool.get_message_by_name("test.PingX").unwrap();
    let header = pool.get_message_by_name("test.Header").unwrap();

    // Build nested: PingX { h: Header { trace_id: "tid" }, id: "outer" }
    let mut nested = DynamicMessage::new(header);
    nested.set_field_by_name("trace_id", Value::String("tid".to_string()));

    let mut outer = DynamicMessage::new(ping_x.clone());
    outer.set_field_by_name("h", Value::Message(nested));
    outer.set_field_by_name("id", Value::String("outer".to_string()));

    let mut codec = DynamicCodec {
        request_descriptor: ping_x.clone(),
        response_descriptor: ping_x.clone(),
    };
    let mut encoder = codec.encoder();
    let mut buf = BytesMut::new();
    let mut encode_buf = EncodeBuf::new(&mut buf);
    encoder.encode(outer, &mut encode_buf).expect("encode");

    let mut decoder = codec.decoder();
    let mut decode_buf = DecodeBuf::new(&mut buf, buf.len());
    let decoded = decoder.decode(&mut decode_buf).expect("decode").unwrap();
    let id = decoded
        .get_field_by_name("id")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .expect("id");
    assert_eq!(id, "outer");
    let h = decoded.get_field_by_name("h").unwrap();
    let h_msg = h.as_message().expect("h is message");
    let trace = h_msg
        .get_field_by_name("trace_id")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .expect("trace_id");
    assert_eq!(trace, "tid");
}
```

- [ ] **Step 2: Прогнать тесты**

Run:
```bash
cargo test -p handshaker-core --test invoke_codec
```
Expected: 2 PASS.

- [ ] **Step 3: Commit**

```bash
git add crates/handshaker-core/tests/invoke_codec.rs
git commit -m "test(grpc): DynamicCodec round-trip against simple + nested fixtures"
```

---

## Task 7: invoke/skeleton.rs — JSON skeleton from descriptor

Чистая функция `build_default_json_skeleton(MessageDescriptor) → serde_json::Value` с MAX_DEPTH=4 + cycle guard.

**Files:**
- Create: `crates/handshaker-core/src/grpc/invoke/skeleton.rs`
- Modify: `crates/handshaker-core/src/grpc/invoke/mod.rs` (добавить `mod skeleton;`)

- [ ] **Step 1: Создать skeleton.rs с failing tests**

Создай файл `crates/handshaker-core/src/grpc/invoke/skeleton.rs`:

```rust
//! Auto-skeleton: построить серде-JSON-объект со всеми полями сообщения в их proto3
//! default значениях. Используется UI'ем при клике на метод в catalog'е.

use prost_reflect::{Kind, MessageDescriptor};
use serde_json::{json, Map, Value};
use std::collections::HashSet;

/// Максимальная глубина вложенности при разворачивании nested messages.
/// Защита от stack overflow на recursive типах (`Node { Node child }`).
pub(crate) const MAX_DEPTH: usize = 4;

/// Построить JSON-скелет сообщения с дефолтными значениями.
///
/// Принципы:
/// - scalars → `0` / `false` / `""` / `0.0`
/// - bytes → `""` (base64-empty)
/// - enum → имя дефолтного варианта (proto3 — обычно tag 0)
/// - repeated → `[]`
/// - map → `{}`
/// - message → рекурсивный обход
/// - depth ≥ MAX_DEPTH или повторное посещение сообщения → `"..."` placeholder.
pub fn build_default_json_skeleton(desc: &MessageDescriptor) -> Value {
    build_message(desc, 0, &mut HashSet::new())
}

fn build_message(desc: &MessageDescriptor, depth: usize, visiting: &mut HashSet<String>) -> Value {
    let name = desc.full_name().to_string();
    if depth >= MAX_DEPTH || !visiting.insert(name.clone()) {
        return json!("...");
    }
    let mut obj = Map::new();
    for field in desc.fields() {
        let value = if field.is_list() {
            json!([])
        } else if field.is_map() {
            json!({})
        } else {
            default_for_kind(&field.kind(), depth, visiting)
        };
        obj.insert(field.json_name().to_string(), value);
    }
    visiting.remove(&name);
    Value::Object(obj)
}

fn default_for_kind(kind: &Kind, depth: usize, visiting: &mut HashSet<String>) -> Value {
    use Kind::*;
    match kind {
        Double | Float => json!(0.0),
        Int32 | Sint32 | Sfixed32 | Int64 | Sint64 | Sfixed64
        | Uint32 | Fixed32 | Uint64 | Fixed64 => json!(0),
        Bool => json!(false),
        String => json!(""),
        Bytes => json!(""),
        Enum(e) => json!(e.default_value().name()),
        Message(m) => build_message(m, depth + 1, visiting),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use prost::Message as _;
    use prost_reflect::DescriptorPool;
    use prost_types::{field_descriptor_proto::Type as Ty, *};

    fn pool_with(set: FileDescriptorSet) -> DescriptorPool {
        let mut pool = DescriptorPool::new();
        let mut buf = Vec::new();
        set.encode(&mut buf).expect("encode");
        let decoded = FileDescriptorSet::decode(&buf[..]).expect("roundtrip");
        pool.add_file_descriptor_set(decoded).expect("add");
        pool
    }

    fn scalar_message_pool() -> DescriptorPool {
        let m = DescriptorProto {
            name: Some("M".into()),
            field: vec![
                FieldDescriptorProto {
                    name: Some("s".into()),
                    number: Some(1),
                    r#type: Some(Ty::String as i32),
                    ..Default::default()
                },
                FieldDescriptorProto {
                    name: Some("i".into()),
                    number: Some(2),
                    r#type: Some(Ty::Int32 as i32),
                    ..Default::default()
                },
                FieldDescriptorProto {
                    name: Some("b".into()),
                    number: Some(3),
                    r#type: Some(Ty::Bool as i32),
                    ..Default::default()
                },
                FieldDescriptorProto {
                    name: Some("d".into()),
                    number: Some(4),
                    r#type: Some(Ty::Double as i32),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        pool_with(FileDescriptorSet {
            file: vec![FileDescriptorProto {
                name: Some("t.proto".into()),
                package: Some("t".into()),
                syntax: Some("proto3".into()),
                message_type: vec![m],
                ..Default::default()
            }],
        })
    }

    #[test]
    fn scalars_get_proto3_defaults() {
        let pool = scalar_message_pool();
        let desc = pool.get_message_by_name("t.M").unwrap();
        let v = build_default_json_skeleton(&desc);
        assert_eq!(v["s"], json!(""));
        assert_eq!(v["i"], json!(0));
        assert_eq!(v["b"], json!(false));
        assert_eq!(v["d"], json!(0.0));
    }

    #[test]
    fn repeated_becomes_empty_array() {
        let m = DescriptorProto {
            name: Some("Repeated".into()),
            field: vec![FieldDescriptorProto {
                name: Some("items".into()),
                number: Some(1),
                r#type: Some(Ty::String as i32),
                label: Some(field_descriptor_proto::Label::Repeated as i32),
                ..Default::default()
            }],
            ..Default::default()
        };
        let pool = pool_with(FileDescriptorSet {
            file: vec![FileDescriptorProto {
                name: Some("r.proto".into()),
                package: Some("r".into()),
                syntax: Some("proto3".into()),
                message_type: vec![m],
                ..Default::default()
            }],
        });
        let desc = pool.get_message_by_name("r.Repeated").unwrap();
        let v = build_default_json_skeleton(&desc);
        assert_eq!(v["items"], json!([]));
    }

    #[test]
    fn recursive_self_referencing_message_caps_at_max_depth() {
        // message Node { Node child = 1; string label = 2; }
        let node = DescriptorProto {
            name: Some("Node".into()),
            field: vec![
                FieldDescriptorProto {
                    name: Some("child".into()),
                    number: Some(1),
                    r#type: Some(Ty::Message as i32),
                    type_name: Some(".r.Node".into()),
                    ..Default::default()
                },
                FieldDescriptorProto {
                    name: Some("label".into()),
                    number: Some(2),
                    r#type: Some(Ty::String as i32),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let pool = pool_with(FileDescriptorSet {
            file: vec![FileDescriptorProto {
                name: Some("r.proto".into()),
                package: Some("r".into()),
                syntax: Some("proto3".into()),
                message_type: vec![node],
                ..Default::default()
            }],
        });
        let desc = pool.get_message_by_name("r.Node").unwrap();
        let v = build_default_json_skeleton(&desc);
        // На depth=0 — full message. На depth=1 — visiting already contains "r.Node",
        // поэтому child становится "...".
        assert_eq!(v["label"], json!(""));
        assert_eq!(v["child"], json!("..."));
    }
}
```

- [ ] **Step 2: Зарегистрировать модуль в `invoke/mod.rs`**

В `crates/handshaker-core/src/grpc/invoke/mod.rs` после definition `UnaryOutcome` (или в начале файла после `use`) добавь:

```rust
pub(crate) mod skeleton;
```

- [ ] **Step 3: Прогнать тесты**

Run:
```bash
cargo test -p handshaker-core --lib grpc::invoke::skeleton::tests
```
Expected: 3 PASS.

- [ ] **Step 4: Clippy**

```bash
cargo clippy -p handshaker-core --all-targets -- -D warnings
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/handshaker-core/src/grpc/invoke
git commit -m "feat(invoke): build_default_json_skeleton with MAX_DEPTH cycle guard"
```

---

## Task 8: build_request_skeleton public API + integration test

Тонкая обёртка `pub fn build_request_skeleton(conn, service, method) → Result<String, CoreError>` — резолвит method'у из `conn.pool` и вызывает skeleton.

**Files:**
- Modify: `crates/handshaker-core/src/grpc/invoke/mod.rs` (добавить `build_request_skeleton`)
- Create: `crates/handshaker-core/tests/invoke_skeleton.rs`

- [ ] **Step 1: Написать failing integration test**

Создай файл `crates/handshaker-core/tests/invoke_skeleton.rs`:

```rust
mod common;

use handshaker_core::grpc::contract::activate;
use handshaker_core::grpc::connection::GrpcTarget;
use handshaker_core::grpc::invoke::build_request_skeleton;
use handshaker_core::grpc::transport::TonicTransport;
use serde_json::Value;
use std::sync::Arc;

#[tokio::test]
async fn skeleton_for_echo_with_deps() {
    let (addr, _stop) = common::spawn_reflection_server_v1_with_deps().await;
    let target = GrpcTarget::new(addr.to_string(), false, false).unwrap();
    let transport: Arc<dyn handshaker_core::grpc::transport::GrpcTransport> =
        Arc::new(TonicTransport::new());
    let conn = activate(target, transport).await.expect("activate");

    let json_str =
        build_request_skeleton(&conn, "test.EchoWithDeps", "Send").expect("skeleton");
    let v: Value = serde_json::from_str(&json_str).expect("valid JSON");
    // PingX { h: Header { trace_id }, id }
    assert_eq!(v["id"], serde_json::json!(""));
    assert!(v["h"].is_object(), "h must be nested Header object");
    assert_eq!(v["h"]["traceId"], serde_json::json!(""));
}

#[tokio::test]
async fn skeleton_returns_method_not_found() {
    let (addr, _stop) = common::spawn_reflection_server_v1().await;
    let target = GrpcTarget::new(addr.to_string(), false, false).unwrap();
    let transport: Arc<dyn handshaker_core::grpc::transport::GrpcTransport> =
        Arc::new(TonicTransport::new());
    let conn = activate(target, transport).await.expect("activate");

    let err = build_request_skeleton(&conn, "test.Echo", "Nope").unwrap_err();
    assert!(matches!(
        err,
        handshaker_core::error::CoreError::MethodNotFound { .. }
    ));
}
```

- [ ] **Step 2: Прогнать — должно упасть на отсутствии `build_request_skeleton`**

Run:
```bash
cargo test -p handshaker-core --test invoke_skeleton
```
Expected: COMPILE FAIL — `no function 'build_request_skeleton'` в `invoke::*`.

- [ ] **Step 3: Реализовать `build_request_skeleton` в `invoke/mod.rs`**

В `crates/handshaker-core/src/grpc/invoke/mod.rs` добавь в конец файла:

```rust
use crate::error::CoreError;
use crate::grpc::connection::GrpcConnection;
use crate::grpc::invoke::skeleton::build_default_json_skeleton;

/// Собрать pretty-printed JSON skeleton input-сообщения метода. Используется UI'ем
/// при клике на метод в catalog'е — заполняет body editor дефолтными значениями.
pub fn build_request_skeleton(
    connection: &GrpcConnection,
    service: &str,
    method: &str,
) -> Result<String, CoreError> {
    let svc = connection
        .pool
        .get_service_by_name(service)
        .ok_or_else(|| CoreError::ServiceNotFound {
            service: service.to_string(),
        })?;
    let m = svc
        .methods()
        .find(|m| m.name() == method)
        .ok_or_else(|| CoreError::MethodNotFound {
            service: service.to_string(),
            method: method.to_string(),
        })?;
    let input_desc = m.input();
    let value = build_default_json_skeleton(&input_desc);
    serde_json::to_string_pretty(&value).map_err(|e| CoreError::EncodeRequest(e.to_string()))
}
```

- [ ] **Step 4: Прогнать тесты — должно пройти**

Run:
```bash
cargo test -p handshaker-core --test invoke_skeleton
```
Expected: 2 PASS.

- [ ] **Step 5: Clippy**

```bash
cargo clippy -p handshaker-core --all-targets -- -D warnings
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/handshaker-core/src/grpc/invoke/mod.rs \
        crates/handshaker-core/tests/invoke_skeleton.rs
git commit -m "feat(invoke): build_request_skeleton — JSON template for UI request editor"
```

---

## Task 9: invoke_unary public API + FakeTransport unit tests

Полная реализация `invoke_unary` — резолвит service/method, парсит JSON, строит codec и path, делегирует транспорту. Юнит-тестируется через `FakeTransport`.

**Files:**
- Modify: `crates/handshaker-core/src/grpc/invoke/mod.rs`

- [ ] **Step 1: Написать failing unit-тесты в `invoke/mod.rs`**

В конец `crates/handshaker-core/src/grpc/invoke/mod.rs` добавь:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::CoreError;
    use crate::grpc::transport::{DynamicCodec, GrpcTransport, TonicChannel};
    use async_trait::async_trait;
    use prost::Message as _;
    use prost_reflect::{DescriptorPool, DynamicMessage};
    use std::collections::HashMap;
    use std::sync::Arc;
    use tokio::sync::Mutex;

    /// Fixture pool со схемой test.Echo / Send.
    fn fixture_pool() -> DescriptorPool {
        // Тот же набор байтов, что и в integration test'ах — собран здесь руками
        // (юнит-тест не должен зависеть от tests/common/).
        use prost_types::{field_descriptor_proto::Type as Ty, *};
        let ping = DescriptorProto {
            name: Some("Ping".into()),
            field: vec![FieldDescriptorProto {
                name: Some("id".into()),
                number: Some(1),
                r#type: Some(Ty::String as i32),
                ..Default::default()
            }],
            ..Default::default()
        };
        let pong = DescriptorProto {
            name: Some("Pong".into()),
            field: vec![FieldDescriptorProto {
                name: Some("id".into()),
                number: Some(1),
                r#type: Some(Ty::String as i32),
                ..Default::default()
            }],
            ..Default::default()
        };
        let service = ServiceDescriptorProto {
            name: Some("Echo".into()),
            method: vec![MethodDescriptorProto {
                name: Some("Send".into()),
                input_type: Some(".test.Ping".into()),
                output_type: Some(".test.Pong".into()),
                ..Default::default()
            }],
            ..Default::default()
        };
        let file = FileDescriptorProto {
            name: Some("t.proto".into()),
            package: Some("test".into()),
            syntax: Some("proto3".into()),
            message_type: vec![ping, pong],
            service: vec![service],
            ..Default::default()
        };
        let set = FileDescriptorSet { file: vec![file] };
        let mut buf = Vec::new();
        set.encode(&mut buf).unwrap();
        let mut pool = DescriptorPool::new();
        pool.add_file_descriptor_set(FileDescriptorSet::decode(&buf[..]).unwrap())
            .unwrap();
        pool
    }

    /// Test seam — захватывает последний вызов unary_dynamic и возвращает
    /// предзаданный outcome. channel() не используется в invoke unit тестах
    /// (вся логика — до transport).
    #[derive(Default)]
    struct FakeTransport {
        outcome: Mutex<Option<Result<UnaryOutcome, CoreError>>>,
        last_path: Mutex<Option<String>>,
        last_metadata: Mutex<Option<HashMap<String, String>>>,
    }

    impl FakeTransport {
        fn with_outcome(o: Result<UnaryOutcome, CoreError>) -> Arc<Self> {
            let t = Arc::new(Self::default());
            *t.outcome.try_lock().unwrap() = Some(o);
            t
        }
    }

    #[async_trait]
    impl GrpcTransport for FakeTransport {
        async fn channel(
            &self,
            _target: &crate::grpc::connection::GrpcTarget,
        ) -> Result<TonicChannel, CoreError> {
            Err(CoreError::NotImplemented("FakeTransport.channel".into()))
        }

        async fn unary_dynamic(
            &self,
            _channel: TonicChannel,
            method_path: String,
            _codec: DynamicCodec,
            _request: DynamicMessage,
            metadata: HashMap<String, String>,
        ) -> Result<UnaryOutcome, CoreError> {
            *self.last_path.lock().await = Some(method_path);
            *self.last_metadata.lock().await = Some(metadata);
            self.outcome.lock().await.take().expect("outcome set")
        }
    }

    fn fake_connection(transport: Arc<dyn GrpcTransport>) -> crate::grpc::connection::GrpcConnection
    {
        let pool = fixture_pool();
        let catalog = crate::grpc::catalog::build::build_catalog(&pool);
        // Channel — фиктивный (lazy на несуществующий адрес).
        let channel = tonic::transport::Channel::from_static("http://127.0.0.1:1")
            .connect_lazy();
        crate::grpc::connection::GrpcConnection {
            target: crate::grpc::connection::GrpcTarget::new("127.0.0.1:1", false, false)
                .unwrap(),
            transport,
            channel,
            pool,
            catalog,
        }
    }

    #[tokio::test]
    async fn unknown_service_returns_service_not_found() {
        let t = FakeTransport::with_outcome(Err(CoreError::NotImplemented("unreached".into())));
        let conn = fake_connection(t);
        let err = invoke_unary(&conn, "no.Such", "Send", "{}", HashMap::new())
            .await
            .unwrap_err();
        assert!(
            matches!(err, CoreError::ServiceNotFound { ref service } if service == "no.Such"),
            "got {err:?}"
        );
    }

    #[tokio::test]
    async fn unknown_method_returns_method_not_found() {
        let t = FakeTransport::with_outcome(Err(CoreError::NotImplemented("unreached".into())));
        let conn = fake_connection(t);
        let err = invoke_unary(&conn, "test.Echo", "Nope", "{}", HashMap::new())
            .await
            .unwrap_err();
        assert!(
            matches!(err, CoreError::MethodNotFound { service, method }
                if service == "test.Echo" && method == "Nope"),
            "got {err:?}"
        );
    }

    #[tokio::test]
    async fn invalid_json_returns_encode_request() {
        let t = FakeTransport::with_outcome(Err(CoreError::NotImplemented("unreached".into())));
        let conn = fake_connection(t);
        let err = invoke_unary(&conn, "test.Echo", "Send", "not json {", HashMap::new())
            .await
            .unwrap_err();
        assert!(matches!(err, CoreError::EncodeRequest(_)), "got {err:?}");
    }

    #[tokio::test]
    async fn happy_path_passes_path_and_metadata_to_transport() {
        let canned = UnaryOutcome {
            status_code: 0,
            status_message: "OK".into(),
            response_json: Some(r#"{"id":"echo"}"#.into()),
            trailing_metadata: HashMap::new(),
            elapsed_ms: 42,
        };
        let t = FakeTransport::with_outcome(Ok(canned.clone()));
        let captured = t.clone();
        let conn = fake_connection(t);

        let mut metadata = HashMap::new();
        metadata.insert("x-request-id".into(), "abc".into());

        let outcome = invoke_unary(&conn, "test.Echo", "Send", r#"{"id":"hi"}"#, metadata)
            .await
            .expect("invoke");
        assert_eq!(outcome.status_code, 0);
        assert_eq!(outcome.response_json.as_deref(), Some(r#"{"id":"echo"}"#));
        assert_eq!(outcome.elapsed_ms, 42);

        assert_eq!(
            captured.last_path.lock().await.as_deref(),
            Some("/test.Echo/Send")
        );
        assert_eq!(
            captured
                .last_metadata
                .lock()
                .await
                .as_ref()
                .unwrap()
                .get("x-request-id")
                .map(String::as_str),
            Some("abc")
        );
    }
}
```

- [ ] **Step 2: Прогнать — должно упасть на отсутствии `invoke_unary`**

Run:
```bash
cargo test -p handshaker-core --lib grpc::invoke::tests
```
Expected: COMPILE FAIL — `no function 'invoke_unary'`.

- [ ] **Step 3: Реализовать `invoke_unary`**

В `crates/handshaker-core/src/grpc/invoke/mod.rs` после `build_request_skeleton` добавь:

```rust
use crate::grpc::transport::DynamicCodec;

/// Сделать unary RPC.
///
/// 1. Резолвит `service`/`method` из `connection.pool`. NotFound → `ServiceNotFound`/`MethodNotFound`.
/// 2. Проверяет, что метод unary (не streaming). Streaming → `NotImplemented`.
/// 3. Парсит `request_json` в `DynamicMessage` через prost-reflect serde. Fail → `EncodeRequest`.
/// 4. Строит `DynamicCodec` + path `/{service}/{method}`.
/// 5. Делегирует `connection.transport.unary_dynamic(...)`.
///
/// Возвращает `UnaryOutcome` AS-IS — gRPC статус != OK там приходит как `status_code != 0`,
/// не как Err.
pub async fn invoke_unary(
    connection: &GrpcConnection,
    service: &str,
    method: &str,
    request_json: &str,
    metadata: std::collections::HashMap<String, String>,
) -> Result<UnaryOutcome, CoreError> {
    let svc = connection
        .pool
        .get_service_by_name(service)
        .ok_or_else(|| CoreError::ServiceNotFound {
            service: service.to_string(),
        })?;
    let m = svc
        .methods()
        .find(|m| m.name() == method)
        .ok_or_else(|| CoreError::MethodNotFound {
            service: service.to_string(),
            method: method.to_string(),
        })?;

    if m.is_client_streaming() || m.is_server_streaming() {
        return Err(CoreError::NotImplemented(format!(
            "streaming RPC not supported in MVP (method `{service}/{method}`)"
        )));
    }

    let input_desc = m.input();
    let output_desc = m.output();

    let mut deserializer = serde_json::Deserializer::from_str(request_json);
    let request_msg = prost_reflect::DynamicMessage::deserialize(input_desc.clone(), &mut deserializer)
        .map_err(|e| CoreError::EncodeRequest(e.to_string()))?;
    // Consume trailing whitespace / detect trailing junk.
    deserializer
        .end()
        .map_err(|e| CoreError::EncodeRequest(e.to_string()))?;

    let codec = DynamicCodec {
        request_descriptor: input_desc,
        response_descriptor: output_desc,
    };
    let path = format!("/{service}/{method}");

    connection
        .transport
        .unary_dynamic(connection.channel.clone(), path, codec, request_msg, metadata)
        .await
}
```

- [ ] **Step 4: Re-export из `grpc/mod.rs` + `lib.rs`**

В `crates/handshaker-core/src/grpc/mod.rs` рядом с `pub use invoke::UnaryOutcome;` добавь:

```rust
pub use invoke::{build_request_skeleton, invoke_unary};
```

В `crates/handshaker-core/src/lib.rs` рядом с `pub use grpc::UnaryOutcome;` добавь:

```rust
pub use grpc::{build_request_skeleton, invoke_unary};
```

- [ ] **Step 5: Прогнать unit-тесты**

Run:
```bash
cargo test -p handshaker-core --lib grpc::invoke::tests
```
Expected: 4 PASS.

- [ ] **Step 6: Полный test suite**

```bash
cargo test -p handshaker-core
```
Expected: ALL PASS.

- [ ] **Step 7: Clippy**

```bash
cargo clippy -p handshaker-core --all-targets -- -D warnings
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add crates/handshaker-core/src/grpc/invoke/mod.rs \
        crates/handshaker-core/src/grpc/mod.rs \
        crates/handshaker-core/src/lib.rs
git commit -m "feat(invoke): invoke_unary — public coordinator with FakeTransport unit tests"
```

---

## Task 10: Integration tests — invoke_unary, invoke_status, invoke_trailers

End-to-end тесты против `spawn_echo_server`. Эти тесты проверяют, что весь pipeline (DynamicCodec + invoke_unary + TonicTransport::unary_dynamic + EchoSvc) работает вместе.

**Files:**
- Create: `crates/handshaker-core/tests/invoke_unary.rs`
- Create: `crates/handshaker-core/tests/invoke_status.rs`
- Create: `crates/handshaker-core/tests/invoke_trailers.rs`

- [ ] **Step 1: Создать `invoke_unary.rs` — happy path**

Создай файл `crates/handshaker-core/tests/invoke_unary.rs`:

```rust
mod common;

use handshaker_core::grpc::connection::GrpcTarget;
use handshaker_core::grpc::contract::activate;
use handshaker_core::grpc::invoke::invoke_unary;
use handshaker_core::grpc::transport::TonicTransport;
use std::collections::HashMap;
use std::sync::Arc;

#[tokio::test]
async fn echo_send_returns_pong_with_echoed_id() {
    let (addr, _stop) = common::spawn_echo_server(common::EchoConfig::default()).await;
    let target = GrpcTarget::new(addr.to_string(), false, false).unwrap();
    let transport: Arc<dyn handshaker_core::grpc::transport::GrpcTransport> =
        Arc::new(TonicTransport::new());
    let conn = activate(target, transport).await.expect("activate");

    let outcome = invoke_unary(
        &conn,
        "test.Echo",
        "Send",
        r#"{"id":"hello"}"#,
        HashMap::new(),
    )
    .await
    .expect("invoke");

    assert_eq!(outcome.status_code, 0, "status: {}", outcome.status_message);
    let json = outcome.response_json.expect("response_json present");
    let v: serde_json::Value = serde_json::from_str(&json).expect("valid JSON");
    assert_eq!(v["id"], serde_json::json!("hello"));
    assert_eq!(v["echoed"], serde_json::json!("echo: hello"));
    // elapsed_ms может быть 0 на быстрых машинах — это OK, мы только проверяем что поле есть.
    let _ = outcome.elapsed_ms;
}
```

- [ ] **Step 2: Прогнать `invoke_unary.rs`**

```bash
cargo test -p handshaker-core --test invoke_unary
```
Expected: PASS.

- [ ] **Step 3: Создать `invoke_status.rs` — server returns NOT_FOUND**

Создай файл `crates/handshaker-core/tests/invoke_status.rs`:

```rust
mod common;

use handshaker_core::grpc::connection::GrpcTarget;
use handshaker_core::grpc::contract::activate;
use handshaker_core::grpc::invoke::invoke_unary;
use handshaker_core::grpc::transport::TonicTransport;
use std::collections::HashMap;
use std::sync::Arc;

#[tokio::test]
async fn server_not_found_appears_as_status_code_5() {
    let config = common::EchoConfig {
        return_status: Some(5), // NOT_FOUND
        trailers: HashMap::new(),
    };
    let (addr, _stop) = common::spawn_echo_server(config).await;
    let target = GrpcTarget::new(addr.to_string(), false, false).unwrap();
    let transport: Arc<dyn handshaker_core::grpc::transport::GrpcTransport> =
        Arc::new(TonicTransport::new());
    let conn = activate(target, transport).await.expect("activate");

    let outcome = invoke_unary(
        &conn,
        "test.Echo",
        "Send",
        r#"{"id":"x"}"#,
        HashMap::new(),
    )
    .await
    .expect("invoke (status != OK is Ok, not Err)");

    assert_eq!(outcome.status_code, 5);
    assert!(
        outcome.status_message.contains("NotFound") || outcome.status_message.contains("NOT_FOUND"),
        "status_message = {}",
        outcome.status_message
    );
    assert!(outcome.response_json.is_none());
}
```

- [ ] **Step 4: Прогнать `invoke_status.rs`**

```bash
cargo test -p handshaker-core --test invoke_status
```
Expected: PASS.

- [ ] **Step 5: Создать `invoke_trailers.rs` — trailing metadata capture**

Создай файл `crates/handshaker-core/tests/invoke_trailers.rs`:

```rust
mod common;

use handshaker_core::grpc::connection::GrpcTarget;
use handshaker_core::grpc::contract::activate;
use handshaker_core::grpc::invoke::invoke_unary;
use handshaker_core::grpc::transport::TonicTransport;
use std::collections::HashMap;
use std::sync::Arc;

#[tokio::test]
async fn trailing_metadata_is_captured() {
    let mut trailers = HashMap::new();
    trailers.insert("x-trace-id".to_string(), "trace-123".to_string());
    trailers.insert("x-server-hostname".to_string(), "echo-1".to_string());

    let config = common::EchoConfig {
        return_status: None, // OK response
        trailers: trailers.clone(),
    };
    let (addr, _stop) = common::spawn_echo_server(config).await;
    let target = GrpcTarget::new(addr.to_string(), false, false).unwrap();
    let transport: Arc<dyn handshaker_core::grpc::transport::GrpcTransport> =
        Arc::new(TonicTransport::new());
    let conn = activate(target, transport).await.expect("activate");

    let outcome = invoke_unary(
        &conn,
        "test.Echo",
        "Send",
        r#"{"id":"trail"}"#,
        HashMap::new(),
    )
    .await
    .expect("invoke");

    assert_eq!(outcome.status_code, 0);
    assert_eq!(
        outcome.trailing_metadata.get("x-trace-id").map(String::as_str),
        Some("trace-123")
    );
    assert_eq!(
        outcome
            .trailing_metadata
            .get("x-server-hostname")
            .map(String::as_str),
        Some("echo-1")
    );
}
```

- [ ] **Step 6: Прогнать `invoke_trailers.rs`**

```bash
cargo test -p handshaker-core --test invoke_trailers
```
Expected: PASS.

- [ ] **Step 7: Полный test suite + clippy**

```bash
cargo test -p handshaker-core
cargo clippy -p handshaker-core --all-targets -- -D warnings
```
Expected: ALL PASS.

- [ ] **Step 8: Commit**

```bash
git add crates/handshaker-core/tests/invoke_unary.rs \
        crates/handshaker-core/tests/invoke_status.rs \
        crates/handshaker-core/tests/invoke_trailers.rs
git commit -m "test(grpc): invoke_unary/status/trailers — end-to-end через spawn_echo_server"
```

---

## Task 11: IPC wrappers + Tauri commands

`InvokeRequest` / `InvokeOutcomeIpc` живут в `src-tauri/src/ipc/invoke.rs`. Две команды `grpc_invoke_unary` и `grpc_build_request_skeleton`. Регенерируем `bindings.ts`.

**Files:**
- Create: `src-tauri/src/ipc/invoke.rs`
- Modify: `src-tauri/src/ipc/mod.rs`
- Modify: `src-tauri/src/commands/grpc.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Создать `ipc/invoke.rs`**

Создай файл `src-tauri/src/ipc/invoke.rs`:

```rust
//! IPC wrapper-типы для unary invoke. handshaker-core остаётся specta-free,
//! specta::Type derive только здесь.

use handshaker_core::grpc::UnaryOutcome;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;

#[derive(Debug, Deserialize, Type)]
pub struct InvokeRequest {
    pub service: String,
    pub method: String,
    pub request_json: String,
    pub metadata: HashMap<String, String>,
}

#[derive(Debug, Serialize, Type)]
pub struct InvokeOutcomeIpc {
    pub status_code: i32,
    pub status_message: String,
    pub response_json: Option<String>,
    pub trailing_metadata: HashMap<String, String>,
    pub elapsed_ms: u64,
}

impl From<UnaryOutcome> for InvokeOutcomeIpc {
    fn from(o: UnaryOutcome) -> Self {
        Self {
            status_code: o.status_code,
            status_message: o.status_message,
            response_json: o.response_json,
            trailing_metadata: o.trailing_metadata,
            elapsed_ms: o.elapsed_ms,
        }
    }
}
```

- [ ] **Step 2: Зарегистрировать модуль в `ipc/mod.rs`**

В `src-tauri/src/ipc/mod.rs` добавь:

```rust
pub mod invoke;

pub use invoke::{InvokeOutcomeIpc, InvokeRequest};
```

(оставь существующие `pub mod catalog; pub mod error;` и их re-exports).

- [ ] **Step 3: Добавить commands в `commands/grpc.rs`**

В `src-tauri/src/commands/grpc.rs` после существующих команд (grpc_connect / grpc_disconnect / grpc_refresh_contract) добавь:

```rust
use crate::ipc::{InvokeOutcomeIpc, InvokeRequest};

/// Send unary RPC через активное соединение.
///
/// `Result<InvokeOutcomeIpc, IpcError>` — status != OK приходит в `InvokeOutcomeIpc.status_code`,
/// не как `Err`. Err — только client-side (NotConnected, transport, encode/decode).
#[tauri::command]
#[specta::specta]
pub async fn grpc_invoke_unary(
    state: tauri::State<'_, crate::state::AppState>,
    request: InvokeRequest,
) -> Result<InvokeOutcomeIpc, crate::ipc::IpcError> {
    let conn = {
        let guard = state.connection.lock().await;
        guard
            .as_ref()
            .ok_or(crate::ipc::IpcError::NotConnected)?
            .clone()
    };
    // Mutex отпущен — invoke может занять время, лучше не блокировать.

    let outcome = handshaker_core::grpc::invoke::invoke_unary(
        &conn,
        &request.service,
        &request.method,
        &request.request_json,
        request.metadata,
    )
    .await?;
    Ok(outcome.into())
}

/// Построить JSON skeleton для request body выбранного метода.
#[tauri::command]
#[specta::specta]
pub async fn grpc_build_request_skeleton(
    state: tauri::State<'_, crate::state::AppState>,
    service: String,
    method: String,
) -> Result<String, crate::ipc::IpcError> {
    let conn = {
        let guard = state.connection.lock().await;
        guard
            .as_ref()
            .ok_or(crate::ipc::IpcError::NotConnected)?
            .clone()
    };
    Ok(handshaker_core::grpc::invoke::build_request_skeleton(
        &conn,
        &service,
        &method,
    )?)
}
```

- [ ] **Step 4: Зарегистрировать обе команды в `lib.rs`**

В `src-tauri/src/lib.rs` найди `tauri_specta::collect_commands![...]` и добавь обе:

```rust
let specta_builder = tauri_specta::Builder::<tauri::Wry>::new()
    .commands(tauri_specta::collect_commands![
        crate::commands::meta::app_version,
        crate::commands::grpc::grpc_connect,
        crate::commands::grpc::grpc_disconnect,
        crate::commands::grpc::grpc_refresh_contract,
        crate::commands::grpc::grpc_invoke_unary,
        crate::commands::grpc::grpc_build_request_skeleton,
    ])
    .events(tauri_specta::collect_events![
        crate::commands::events::ContractUpdated,
        crate::commands::events::ConnectionStateChanged,
    ]);
```

(Имена и точная структура — следуй существующему паттерну в `lib.rs` — могут немного отличаться от примера выше.)

И в `.invoke_handler(tauri::generate_handler![...])` добавь обе функции в список.

- [ ] **Step 5: Регенерировать bindings.ts**

```bash
cargo run -p handshaker --bin export-bindings
```
Expected: stdout говорит "wrote .../src/ipc/bindings.ts". Файл должен содержать `InvokeRequest`, `InvokeOutcomeIpc`, и оба новых command'а.

- [ ] **Step 6: Прогнать backend build + tests**

```bash
cargo build -p handshaker
cargo test --workspace
```
Expected: ALL PASS.

- [ ] **Step 7: Прогнать frontend lint (bindings.ts должен типизироваться)**

```bash
pnpm lint
```
Expected: PASS — TS компилируется с новыми типами.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/ipc/invoke.rs \
        src-tauri/src/ipc/mod.rs \
        src-tauri/src/commands/grpc.rs \
        src-tauri/src/lib.rs \
        src/ipc/bindings.ts
git commit -m "feat(ipc): grpc_invoke_unary + grpc_build_request_skeleton commands"
```

---

## Task 12: Frontend lib — monaco.ts + grpc-status.ts

Lazy Monaco loader + status code → name mapper.

**Files:**
- Create: `src/lib/monaco.ts`
- Create: `src/lib/grpc-status.ts`
- Modify: `package.json` (add `@monaco-editor/react`)

- [ ] **Step 1: Установить Monaco**

```bash
pnpm add @monaco-editor/react
```

Это добавит `@monaco-editor/react` (~4.7.x) + transient `monaco-editor`.

- [ ] **Step 2: Создать `src/lib/monaco.ts`**

```ts
import { lazy } from "react";

/**
 * Lazy-loaded Monaco editor. Initial bundle stays small; первый рендер `<MonacoEditor>`
 * тянет ~3MB JS на demand.
 *
 * Re-exports default export from `@monaco-editor/react` as named `MonacoEditor`.
 */
export const MonacoEditor = lazy(async () => {
  const mod = await import("@monaco-editor/react");
  return { default: mod.default };
});

export const EDITOR_OPTIONS = {
  fontSize: 13,
  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  automaticLayout: true,
  tabSize: 2,
  insertSpaces: true,
  wordWrap: "on",
} as const;

export const READ_ONLY_OPTIONS = {
  ...EDITOR_OPTIONS,
  readOnly: true,
} as const;

/**
 * Monaco theme — `vs-dark` подходит к shadcn new-york OKLCH dark палитре.
 * (Custom theme регистрация — отдельный сабплан.)
 */
export const MONACO_THEME = "vs-dark" as const;
```

- [ ] **Step 3: Создать `src/lib/grpc-status.ts`**

```ts
/**
 * gRPC канонические status codes (https://grpc.github.io/grpc/core/md_doc_statuscodes.html).
 * `statusName(0)` → `"OK"`, `statusName(5)` → `"NOT_FOUND"`, и т.д.
 */
const NAMES: Record<number, string> = {
  0: "OK",
  1: "CANCELLED",
  2: "UNKNOWN",
  3: "INVALID_ARGUMENT",
  4: "DEADLINE_EXCEEDED",
  5: "NOT_FOUND",
  6: "ALREADY_EXISTS",
  7: "PERMISSION_DENIED",
  8: "RESOURCE_EXHAUSTED",
  9: "FAILED_PRECONDITION",
  10: "ABORTED",
  11: "OUT_OF_RANGE",
  12: "UNIMPLEMENTED",
  13: "INTERNAL",
  14: "UNAVAILABLE",
  15: "DATA_LOSS",
  16: "UNAUTHENTICATED",
};

export function statusName(code: number): string {
  return NAMES[code] ?? `CODE_${code}`;
}

/**
 * Размер JSON в UTF-8 bytes, форматированный как `123B` / `1.2KB` / `3.4MB`.
 */
export function formatBytes(s: string | null | undefined): string {
  if (s == null) return "0B";
  const bytes = new TextEncoder().encode(s).length;
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
```

- [ ] **Step 4: TS lint**

```bash
pnpm lint
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/monaco.ts src/lib/grpc-status.ts package.json pnpm-lock.yaml
git commit -m "feat(ui): monaco lazy loader + grpc status code mapping helpers"
```

---

## Task 13: shadcn Resizable + extend ipc client.ts

Установим `Resizable` через shadcn CLI; расширим `src/ipc/client.ts` обёртками вокруг новых команд.

**Files:**
- Create: `src/components/ui/resizable.tsx` (через shadcn add)
- Modify: `src/ipc/client.ts`

- [ ] **Step 1: Добавить shadcn `resizable`**

```bash
pnpm dlx shadcn@latest add resizable
```

Это создаст `src/components/ui/resizable.tsx` + добавит `react-resizable-panels` в `package.json`.

- [ ] **Step 2: Расширить `src/ipc/client.ts` обёртками**

В `src/ipc/client.ts` добавь после существующих обёрток (`grpcConnect`, `grpcDisconnect`, `grpcRefreshContract`):

```ts
import type { InvokeRequest, InvokeOutcomeIpc } from "./bindings";

export async function grpcInvokeUnary(req: InvokeRequest): Promise<InvokeOutcomeIpc> {
  const r = await commands.grpcInvokeUnary(req);
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function grpcBuildRequestSkeleton(
  service: string,
  method: string,
): Promise<string> {
  const r = await commands.grpcBuildRequestSkeleton(service, method);
  if (r.status === "error") throw r.error;
  return r.data;
}
```

И в `export const ipc = { ... }` добавь:

```ts
  grpcInvokeUnary,
  grpcBuildRequestSkeleton,
```

- [ ] **Step 3: TS lint + build**

```bash
pnpm lint && pnpm build
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/resizable.tsx src/ipc/client.ts package.json pnpm-lock.yaml
git commit -m "feat(ui): shadcn resizable + grpcInvokeUnary/Skeleton client wrappers"
```

---

## Task 14: InvokePanel + BodyEditor (request side)

Header (svc/method) + Monaco JSON editor + Send button. При selectedMethod change — fetch skeleton, replace body с confirm если editor not empty.

**Files:**
- Create: `src/features/invoke/InvokePanel.tsx`
- Create: `src/features/invoke/BodyEditor.tsx`

- [ ] **Step 1: Создать `BodyEditor.tsx`**

```tsx
import { Suspense } from "react";
import { MonacoEditor, EDITOR_OPTIONS, MONACO_THEME } from "@/lib/monaco";

export interface BodyEditorProps {
  value: string;
  onChange: (next: string) => void;
}

export function BodyEditor({ value, onChange }: BodyEditorProps) {
  return (
    <Suspense
      fallback={
        <div className="text-sm text-muted-foreground p-4">Loading editor…</div>
      }
    >
      <MonacoEditor
        height="100%"
        defaultLanguage="json"
        theme={MONACO_THEME}
        value={value}
        onChange={(v) => onChange(v ?? "")}
        options={EDITOR_OPTIONS}
      />
    </Suspense>
  );
}
```

- [ ] **Step 2: Создать `InvokePanel.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { BodyEditor } from "./BodyEditor";
import { ipc } from "@/ipc/client";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

export interface SelectedMethod {
  service: string;
  method: string;
}

export interface InvokePanelProps {
  selected: SelectedMethod;
  onOutcome: (outcome: InvokeOutcomeIpc) => void;
  onError: (message: string) => void;
}

export function InvokePanel({ selected, onOutcome, onError }: InvokePanelProps) {
  const [body, setBody] = useState<string>("{}");
  const [busy, setBusy] = useState(false);

  // При смене метода — подгрузить skeleton. Если body не пустой и != дефолтный {},
  // спросить подтверждение.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const skeleton = await ipc.grpcBuildRequestSkeleton(
          selected.service,
          selected.method,
        );
        if (cancelled) return;
        const isEmpty = body.trim() === "" || body.trim() === "{}";
        if (
          isEmpty ||
          window.confirm("Replace current request body with the method's skeleton?")
        ) {
          setBody(skeleton);
        }
      } catch (e) {
        const tagged = e as { type?: string; message?: string };
        onError(tagged.message ?? tagged.type ?? "failed to load skeleton");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- body intentionally not a dep
  }, [selected.service, selected.method]);

  async function handleSend() {
    // Validate JSON locally first — better error than backend round-trip.
    try {
      JSON.parse(body);
    } catch (e) {
      onError(`Invalid JSON: ${(e as Error).message}`);
      return;
    }

    setBusy(true);
    try {
      const outcome = await ipc.grpcInvokeUnary({
        service: selected.service,
        method: selected.method,
        request_json: body,
        metadata: {},
      });
      onOutcome(outcome);
    } catch (e) {
      const tagged = e as { type?: string; message?: string };
      onError(tagged.message ?? tagged.type ?? "invoke failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <div className="font-mono text-sm">
          <span className="text-muted-foreground">{selected.service}</span>
          <span className="mx-1">/</span>
          <span className="font-semibold">{selected.method}</span>
        </div>
        <Button onClick={handleSend} disabled={busy} size="sm">
          {busy ? "Sending…" : "Send"}
        </Button>
      </div>
      <div className="flex-1">
        <BodyEditor value={body} onChange={setBody} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: TS lint + build (без интеграции в App.tsx пока)**

```bash
pnpm lint && pnpm build
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/invoke
git commit -m "feat(ui): InvokePanel + BodyEditor — Monaco request editor with auto-skeleton"
```

---

## Task 15: ResponsePanel + StatusBar + BodyView + TrailersView

Read-only Monaco для response JSON + status bar (traffic-light dot + code/ms/size) + collapsible trailers.

**Files:**
- Create: `src/features/response/ResponsePanel.tsx`
- Create: `src/features/response/StatusBar.tsx`
- Create: `src/features/response/BodyView.tsx`
- Create: `src/features/response/TrailersView.tsx`

- [ ] **Step 1: Создать `StatusBar.tsx`**

```tsx
import { statusName, formatBytes } from "@/lib/grpc-status";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

export interface StatusBarProps {
  outcome: InvokeOutcomeIpc;
}

export function StatusBar({ outcome }: StatusBarProps) {
  const ok = outcome.status_code === 0;
  const dotColor = ok ? "bg-[oklch(0.7_0.16_145)]" : "bg-destructive";
  const codeText = statusName(outcome.status_code);
  const size = formatBytes(outcome.response_json);
  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-border text-sm font-mono">
      <span className={`inline-block w-2 h-2 rounded-full ${dotColor}`} />
      <span className="font-semibold">{codeText}</span>
      <span className="text-muted-foreground">·</span>
      <span className="text-muted-foreground">{outcome.elapsed_ms}ms</span>
      <span className="text-muted-foreground">·</span>
      <span className="text-muted-foreground">{size}</span>
      {!ok && (
        <span className="ml-2 text-destructive text-xs truncate">
          {outcome.status_message}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Создать `BodyView.tsx`**

```tsx
import { Suspense } from "react";
import { MonacoEditor, READ_ONLY_OPTIONS, MONACO_THEME } from "@/lib/monaco";

export interface BodyViewProps {
  json: string;
}

export function BodyView({ json }: BodyViewProps) {
  return (
    <Suspense
      fallback={
        <div className="text-sm text-muted-foreground p-4">Loading viewer…</div>
      }
    >
      <MonacoEditor
        height="100%"
        defaultLanguage="json"
        theme={MONACO_THEME}
        value={json}
        options={READ_ONLY_OPTIONS}
      />
    </Suspense>
  );
}
```

- [ ] **Step 3: Создать `TrailersView.tsx`**

```tsx
export interface TrailersViewProps {
  trailers: Record<string, string>;
}

export function TrailersView({ trailers }: TrailersViewProps) {
  const entries = Object.entries(trailers);
  if (entries.length === 0) return null;
  return (
    <details className="border-t border-border px-4 py-2 text-sm">
      <summary className="cursor-pointer text-muted-foreground">
        Trailers ({entries.length})
      </summary>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs">
        {entries.map(([k, v]) => (
          <FragmentRow key={k} k={k} v={v} />
        ))}
      </dl>
    </details>
  );
}

function FragmentRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="break-all">{v}</dd>
    </>
  );
}
```

- [ ] **Step 4: Создать `ResponsePanel.tsx`**

```tsx
import { StatusBar } from "./StatusBar";
import { BodyView } from "./BodyView";
import { TrailersView } from "./TrailersView";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

export interface ResponsePanelProps {
  outcome: InvokeOutcomeIpc;
}

export function ResponsePanel({ outcome }: ResponsePanelProps) {
  return (
    <div className="flex flex-col h-full">
      <StatusBar outcome={outcome} />
      <div className="flex-1">
        {outcome.response_json !== null && outcome.response_json !== undefined ? (
          <BodyView json={outcome.response_json} />
        ) : (
          <div className="text-sm text-muted-foreground p-4 italic">
            No response body (status code {outcome.status_code}).
          </div>
        )}
      </div>
      <TrailersView trailers={outcome.trailing_metadata} />
    </div>
  );
}
```

- [ ] **Step 5: TS lint + build**

```bash
pnpm lint && pnpm build
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/response
git commit -m "feat(ui): ResponsePanel + StatusBar + BodyView + TrailersView"
```

---

## Task 16: Wire CatalogList → App.tsx → InvokePanel + ResponsePanel

Подключаем выбор метода: клик в CatalogList устанавливает selectedMethod, App.tsx рендерит ResizablePanelGroup с Invoke (top) + Response (bottom).

**Files:**
- Modify: `src/features/connect/CatalogList.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Расширить `CatalogList.tsx` — onSelect prop**

Замени содержимое `src/features/connect/CatalogList.tsx` на:

```tsx
import type { ServiceCatalog } from "@/ipc/bindings";
import type { SelectedMethod } from "@/features/invoke/InvokePanel";

export interface CatalogListProps {
  catalog: ServiceCatalog;
  selected: SelectedMethod | null;
  onSelect: (m: SelectedMethod) => void;
}

export function CatalogList({ catalog, selected, onSelect }: CatalogListProps) {
  if (catalog.services.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No services in catalog.
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-4">
      {catalog.services.map((s) => (
        <li key={s.full_name} className="flex flex-col gap-1">
          <div className="font-semibold font-mono text-sm">{s.full_name}</div>
          <ul className="flex flex-col gap-0.5 pl-4 text-sm font-mono text-muted-foreground">
            {s.methods.map((m) => {
              const isSelected =
                selected?.service === s.full_name && selected?.method === m.name;
              return (
                <li key={m.path}>
                  <button
                    type="button"
                    onClick={() => onSelect({ service: s.full_name, method: m.name })}
                    className={`text-left w-full hover:text-foreground transition-colors ${
                      isSelected ? "text-foreground font-medium" : ""
                    }`}
                  >
                    {m.name}
                    <span className="text-xs ml-2 text-muted-foreground">
                      ({m.input_message} → {m.output_message})
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Расширить `App.tsx`**

Замени содержимое `src/App.tsx` на:

```tsx
import { useEffect, useState } from "react";
import { ConnectPanel } from "@/features/connect/ConnectPanel";
import { CatalogList } from "@/features/connect/CatalogList";
import { InvokePanel, type SelectedMethod } from "@/features/invoke/InvokePanel";
import { ResponsePanel } from "@/features/response/ResponsePanel";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  onConnectionStateChanged,
  onContractUpdated,
} from "@/ipc/events";
import { ipc } from "@/ipc/client";
import type { ServiceCatalog, InvokeOutcomeIpc } from "@/ipc/bindings";

export default function App() {
  const [catalog, setCatalog] = useState<ServiceCatalog | null>(null);
  const [connected, setConnected] = useState(false);
  const [version, setVersion] = useState("");
  const [selected, setSelected] = useState<SelectedMethod | null>(null);
  const [outcome, setOutcome] = useState<InvokeOutcomeIpc | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ipc.appVersion().then(setVersion).catch(console.error);
  }, []);

  useEffect(() => {
    let unlistenA: (() => void) | undefined;
    let unlistenB: (() => void) | undefined;
    onConnectionStateChanged((e) => setConnected(e.connected)).then(
      (fn) => (unlistenA = fn),
    );
    onContractUpdated((e) => console.log("contract updated:", e.target_key)).then(
      (fn) => (unlistenB = fn),
    );
    return () => {
      unlistenA?.();
      unlistenB?.();
    };
  }, []);

  // При disconnect — почистить selected и outcome.
  useEffect(() => {
    if (!connected) {
      setSelected(null);
      setOutcome(null);
    }
  }, [connected]);

  return (
    <main className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="px-6 py-3 border-b border-border flex items-center justify-between shrink-0">
        <h1 className="text-base font-semibold">Handshaker</h1>
        <span className="text-xs text-muted-foreground font-mono">v{version}</span>
      </header>
      <section className="p-6 flex flex-col gap-6 shrink-0">
        <ConnectPanel
          connected={connected}
          onConnected={(c) => setCatalog(c)}
          onDisconnected={() => setCatalog(null)}
        />
        {catalog && (
          <CatalogList
            catalog={catalog}
            selected={selected}
            onSelect={(m) => {
              setSelected(m);
              setOutcome(null);
              setError(null);
            }}
          />
        )}
      </section>
      {selected && (
        <div className="flex-1 min-h-[60vh] border-t border-border">
          <ResizablePanelGroup direction="vertical">
            <ResizablePanel defaultSize={50} minSize={20}>
              <InvokePanel
                selected={selected}
                onOutcome={(o) => {
                  setOutcome(o);
                  setError(null);
                }}
                onError={(m) => setError(m)}
              />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize={50} minSize={20}>
              {error ? (
                <div className="p-4 text-sm text-destructive font-mono break-words">
                  {error}
                </div>
              ) : outcome ? (
                <ResponsePanel outcome={outcome} />
              ) : (
                <div className="p-4 text-sm text-muted-foreground italic">
                  Press Send to invoke.
                </div>
              )}
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 3: TS lint + build**

```bash
pnpm lint && pnpm build
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/features/connect/CatalogList.tsx
git commit -m "feat(ui): wire CatalogList → InvokePanel + ResponsePanel via ResizablePanelGroup"
```

---

## Task 17: invoke_live.rs #[ignore] test + manual UI smoke gate

Воспроизводимый тест против живого `127.0.0.1:5002` + manual UI smoke acceptance gate.

**Files:**
- Create: `crates/handshaker-core/tests/invoke_live.rs`

- [ ] **Step 1: Создать `invoke_live.rs`**

```rust
//! Live-server smoke test. Запускается явно через `cargo test --test invoke_live -- --ignored`.
//! Не блокирует CI — `#[ignore]` пропускает по умолчанию.
//!
//! По умолчанию подключается к `127.0.0.1:5002`. Можно переопределить через
//! `HANDSHAKER_LIVE_TARGET=host:port cargo test --test invoke_live -- --ignored --nocapture`.

mod common;

use handshaker_core::grpc::connection::GrpcTarget;
use handshaker_core::grpc::contract::activate;
use handshaker_core::grpc::invoke::{build_request_skeleton, invoke_unary};
use handshaker_core::grpc::transport::TonicTransport;
use std::collections::HashMap;
use std::sync::Arc;

const DEFAULT_TARGET: &str = "127.0.0.1:5002";

fn live_target() -> String {
    std::env::var("HANDSHAKER_LIVE_TARGET").unwrap_or_else(|_| DEFAULT_TARGET.to_string())
}

#[tokio::test]
#[ignore = "requires a real gRPC server with reflection at HANDSHAKER_LIVE_TARGET"]
async fn live_target_reflects_and_invokes_first_unary_method() {
    let address = live_target();
    println!("[invoke_live] target = {address}");

    let target = GrpcTarget::new(address.clone(), false, false).unwrap();
    let transport: Arc<dyn handshaker_core::grpc::transport::GrpcTransport> =
        Arc::new(TonicTransport::new());
    let conn = activate(target, transport).await.expect("activate live");

    // Найти первый non-reflection unary метод.
    let mut chosen: Option<(String, String)> = None;
    for svc in &conn.catalog.services {
        if svc.full_name.starts_with("grpc.reflection.") {
            continue;
        }
        for m in &svc.methods {
            // ServiceCatalog не выдаёт is_streaming флаги в Plan #2; полагаемся на
            // pool для проверки. Если в catalog'е streaming методы не помечены —
            // invoke_unary всё равно вернёт NotImplemented, и мы пропустим.
            chosen = Some((svc.full_name.clone(), m.name.clone()));
            break;
        }
        if chosen.is_some() {
            break;
        }
    }
    let (svc_name, method_name) =
        chosen.expect("live server должен иметь хотя бы один non-reflection метод");
    println!("[invoke_live] picked method = {svc_name}/{method_name}");

    let skeleton = build_request_skeleton(&conn, &svc_name, &method_name).expect("skeleton");
    println!("[invoke_live] skeleton = {skeleton}");

    match invoke_unary(&conn, &svc_name, &method_name, &skeleton, HashMap::new()).await {
        Ok(outcome) => {
            println!(
                "[invoke_live] outcome: status={} ({}), ms={}",
                outcome.status_code, outcome.status_message, outcome.elapsed_ms,
            );
            // Не делаем strong assertion на status_code — server мог легально вернуть
            // INVALID_ARGUMENT для skeleton'а со всеми дефолтами. Главное — нет panic'а
            // и outcome корректно populated.
            if outcome.status_code == 0 {
                assert!(outcome.response_json.is_some());
            } else {
                assert!(!outcome.status_message.is_empty());
            }
        }
        Err(handshaker_core::error::CoreError::NotImplemented(msg)) => {
            // Streaming method случайно попался — это OK, skip.
            println!("[invoke_live] picked method was streaming; skipping ({msg})");
        }
        Err(e) => panic!("invoke_live unexpected client-side error: {e:?}"),
    }
}
```

- [ ] **Step 2: Прогнать `invoke_live` против `127.0.0.1:5002`**

```bash
cargo test -p handshaker-core --test invoke_live -- --ignored --nocapture
```
Expected: PASS. Логи покажут picked method, skeleton, outcome.

Если падает с `Transport` — убедись, что 127.0.0.1:5002 действительно слушает и отдаёт reflection. Если падает с `EncodeRequest`/`DecodeResponse` — это потенциальный baг codec'а с реальной схемой, **diagnose и fix перед merge** (см. R2 в spec'е).

- [ ] **Step 3: Manual UI smoke**

Запусти полный UI:

```bash
pnpm tauri:dev
```

В появившемся окне:

1. Введи `127.0.0.1:5002` в адресном поле.
2. Сними галку 🔒 → 🔓 (plaintext).
3. Нажми Connect → должны появиться сервисы и методы.
4. Кликни на любой unary метод → внизу появляется Invoke panel с auto-skeleton'ом в Monaco.
5. (По желанию) поправь skeleton.
6. Нажми Send → Response panel показывает status bar (зелёная точка OK / красная с кодом), Monaco r/o с JSON, trailers (если есть).
7. Кликни на другой метод → confirm-диалог про replace body, accept → body заменён.
8. Disconnect → Invoke и Response panel'и исчезают.

**Acceptance:** все 8 шагов проходят без panic в `cargo tauri dev` stderr, без ошибок в DevTools console.

- [ ] **Step 4: Final test gate**

```bash
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
pnpm lint && pnpm build
```
Expected: ALL PASS (за исключением `#[ignore]` тестов, которые пропущены по умолчанию).

- [ ] **Step 5: Commit**

```bash
git add crates/handshaker-core/tests/invoke_live.rs
git commit -m "test(invoke): invoke_live.rs — #[ignore] smoke против 127.0.0.1:5002"
```

---

## Final verification

После всех 17 задач — финальный sanity check перед merge:

- [ ] `cargo test --workspace` — ALL PASS.
- [ ] `cargo clippy --workspace --all-targets -- -D warnings` — clean.
- [ ] `pnpm lint && pnpm build` — clean.
- [ ] `cargo test -p handshaker-core --test invoke_live -- --ignored --nocapture` — PASS against `127.0.0.1:5002`.
- [ ] Manual UI smoke (Task 17 Step 3) — все 8 шагов проходят.
- [ ] Никаких новых `unwrap`/`expect` в production code (`expect` только в тестах).
- [ ] `handshaker-core/Cargo.toml` НЕ содержит `specta` — wrapper-типы только в `src-tauri/src/ipc/`.
- [ ] `tonic`-imports только в `transport/*` + `reflection/*` + `connection.rs` (last — `TonicChannel` alias only).
- [ ] `src-tauri/capabilities/default.json` не расширялся — least-privilege (только `core:default`).

**Spec compliance checklist** (мастер-спека и Plan #3 design):

- [ ] §5 «Dynamic unary invoke» — реализовано через DynamicCodec + invoke_unary + TonicTransport::unary_dynamic.
- [ ] §5 «Do NOT generate per-service stubs» — никаких tonic-build для целевых сервисов (только для test helper если fall-back R1 сработал).
- [ ] §5 «UNARY ONLY» — streaming методы возвращают NotImplemented.
- [ ] §5 «JSON in → DynamicMessage → unary call → DynamicMessage → JSON out» — flow в invoke_unary.
- [ ] §5 «Capture gRPC status code, message, response payload, trailing metadata, and timing» — все 5 в UnaryOutcome.
- [ ] §6.4 IpcError mapping — все варианты доступны и `from_core_error_exhaustive` passes.
- [ ] §7 Monaco editor lazy-loaded — через React.lazy в `lib/monaco.ts`.
- [ ] §8.4 Request view layout — InvokePanel с method header + Send.
- [ ] §8.4 Response panel — StatusBar (зелёная/красная точка) + BodyView + Trailers.
- [ ] Memory rule `feedback_ui_transparent_mechanics` — никаких engine-internals badges в Catalog/sidebar.
- [ ] Memory rule `feedback_verify_technical_claims` — источники tonic 0.14 / prost-reflect 0.14 / monaco-editor цитированы в header'е.
- [ ] Plan #2 errata invariants сохранены: specta-free core (errata #7), scoped-lock в Tauri command'ах (errata #8), at-most-one connection в AppState (errata #10).

---

## Next plan preview

После Plan #3:
- **Plan #4 — Variables + Resolver + Environments**: `{{var}}` substitution в request body, env-scope variables, multi-pass resolver.
- **Plan #5 — Auth (EnvVar bearer)**: AuthProvider trait, metadata injection для unary + reflection, secret store через keyring.
- **Plan #6 — Collections + ContractCache**: Postman-style sidebar tree, SavedRequest model, cache-on-reconnect.
- **Plan #7 — Frontend foundation**: method picker dialog ⌘K, env switcher, full hotkey map.
- **Plan #8 — Frontend polish**: Save Request dialog, error toasts via sonner, settings panel.
- **Security knobs sub-plan**: `skip_verify=true` через hyper-rustls custom ServerCertVerifier (см. spec D1).
