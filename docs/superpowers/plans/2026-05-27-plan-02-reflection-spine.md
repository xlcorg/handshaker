# Plan #2 — Reflection Spine

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Юзер вводит произвольный `host:port`, жмёт Connect — Handshaker открывает gRPC-канал, делает Server Reflection (v1 → v1alpha fallback), собирает `prost_reflect::DescriptorPool` и `ServiceCatalog`, и UI показывает список сервисов и их методов. Это spine продукта: всё остальное (invoke, auth, collections) ложится на эту инфраструктуру.

**Architecture:**
- В `handshaker-core` появляется модуль `grpc/` с чёткими границами: `connection` (value types), `transport` (trait + tonic impl), `reflection` (streaming client с fallback), `descriptor` (сборка `DescriptorPool`), `catalog` (services → methods → message schemas), `contract` (top-level `activate(target)`).
- Tonic-типы ИЗОЛИРОВАНЫ в `grpc/transport/tonic_impl.rs` и `grpc/reflection/*`. Остальная часть core работает с `prost_reflect::DescriptorPool` и нашими типами.
- Server Reflection клиент использует ГЕНЕРИРОВАННЫЙ `tonic_reflection::pb::v1::server_reflection_client::ServerReflectionClient` (и его v1alpha близнеца) — не пишем proto-кодек руками.
- `src-tauri` получает `Mutex<Option<GrpcConnection>>` в state + три команды (`grpc_connect`, `grpc_disconnect`, `grpc_refresh_contract`) + два события (`ContractUpdated`, `ConnectionStateChanged`).
- UI: cold-start экран заменяется на минимальную проводку — input адреса, Connect, список сервисов/методов из catalog. Полный UI из spec §8 — Plan #7-#8.

**Tech Stack (зафиксированные версии и фичи):**
- `tonic = "0.14"` с features `tls-ring`, `tls-native-roots` (default `transport` + `channel` остаются).
- `tonic-reflection = "0.14"` с default feature `server` (содержит generated client + server-builder для тестов).
- `prost = "0.13"`, `prost-types = "0.13"`, `prost-reflect = "0.14"` (workspace).
- `tokio-stream = "0.1"`, `futures-util = "0.3"`, `async-trait = "0.1"` (workspace), `http = "1"`.
- Frontend: использует уже стоящие `@tauri-apps/api` + shadcn `Button`, `Input` (`pnpm dlx shadcn@latest add input`).

**Источники (memory rule `feedback_verify_technical_claims`):**
- [tonic-reflection 0.14 — pb::v1 + pb::v1alpha](https://docs.rs/tonic-reflection/0.14.5/tonic_reflection/pb/index.html)
- [ServerReflectionClient.server_reflection_info](https://docs.rs/tonic-reflection/0.14.5/tonic_reflection/pb/v1/server_reflection_client/struct.ServerReflectionClient.html)
- [tonic-reflection server Builder](https://docs.rs/tonic-reflection/0.14.5/tonic_reflection/server/index.html)
- [prost-reflect::DescriptorPool API](https://docs.rs/prost-reflect/0.14/prost_reflect/struct.DescriptorPool.html)
- [tonic::client::Grpc API](https://docs.rs/tonic/0.14.5/tonic/client/struct.Grpc.html)
- [tonic ClientTlsConfig](https://docs.rs/tonic/latest/tonic/transport/channel/struct.ClientTlsConfig.html)
- [hyperium/tonic#891 — custom rustls ServerCertVerifier requires hyper-rustls workaround](https://github.com/hyperium/tonic/issues/891) (обоснование: `skip_verify=true` deferred to a follow-up plan)
- [gRPC Server Reflection protocol (v1 proto)](https://github.com/grpc/grpc/blob/master/src/proto/grpc/reflection/v1/reflection.proto)

**Out of scope (next plans):**
- **Dynamic unary invoke** — codec + invoke pipeline. **Plan #3.**
- **`skip_verify=true`** — требует hyper-rustls connector + tower-service вместо `Channel::tls_config`. Возвращаем `CoreError::NotImplemented` для этого кейса. Включим в Plan #3 либо отдельный «security-knobs» под-план.
- **Streaming RPC** — server/client/bidi user-facing. Только сам reflection stream используется внутренне.
- **Auth (token injection)** — Plan #5. Reflection per spec §4 идёт **без auth**, так что это нас не блокирует.
- **Variables / collections / env** — Plan #4-#6. UI здесь принимает прямой адрес `host:port`.
- **ContractCache** — заложен в spec §5.8, но реальная имплементация — Plan #6 (когда появятся коллекции). В Plan #2 каждый Connect делает свежую reflection.
- **Method picker UI (⌘K)**, response panel, Monaco editor, env switcher — Plan #7-#8.

---

## Execution errata 2026-05-27

The following deviations and observations surfaced during Plan #2 execution. Future re-runs of this plan should use the corrections below.

1. **`spawn_bare_server` cannot use bare `Server::serve_with_shutdown(addr, signal)`.** Tonic 0.14's bare `Server` has no 2-arg `serve_with_shutdown`; only the `Router` returned by `add_service(svc)` does. Fix: register `tonic_health::server::HealthServer` as a filler service so the listener speaks full HTTP/2 + gRPC. Unmatched reflection paths automatically return `Unimplemented`. Added `tonic-health = "0.14"` as a `[dev-dependencies]` entry on `handshaker-core` (workspace-pinned).

2. **TOCTOU race in `pick_addr`.** The plan's original `pick_addr` bound a `TcpListener` and dropped it before tonic re-bound the same port — under parallel test execution the OS could reassign the port. Fix: each spawner now binds the `TcpListener` itself and feeds it to tonic via `serve_with_incoming_shutdown(TcpListenerStream::new(listener), signal)`. Removed the 50ms sleeps that papered over the race.

3. **`tonic-reflection` `FileDescriptorResponse.file_descriptor_proto` is `Vec<bytes::Bytes>`, not `Vec<Vec<u8>>`.** The plan's `extend(fdr.file_descriptor_proto)` was a type mismatch. Fix: `.extend(fdr.file_descriptor_proto.into_iter().map(|b| b.to_vec()))`.

4. **Reflection v1 read-to-EOF.** The plan's V1Adapter included an `expected/received/break` mechanism. This is fragile against conforming servers that may send N responses per request. Fix: read the bidi response stream to natural EOF — the server closes after our `drop(tx)` signals end of requests. Also switched `mpsc::channel(16)` to `mpsc::unbounded_channel()` to avoid self-deadlock when a single batch enqueues more than 15 dependencies.

5. **Files without `.name` are an error, not silently dropped.** `algorithm::decode_fdp` returns `CoreError::DescriptorBuild` for both prost decode failure and missing `name`, surfacing what would otherwise be silent data loss.

6. **`reflection_disabled` test assertion strengthened.** `hint.contains("v1") && hint.contains("v1alpha")` was a false-positive trap (`"v1alpha"` contains `"v1"`). Fixed to `hint.contains("v1:") && hint.contains("v1alpha:")` — both substrings present by construction in `fallback.rs`'s combined-hint format.

7. **`handshaker-core` stays specta-free (spec rule 1).** Task 10 initially added `specta::Type` derives to `ServiceCatalog`/`ServiceEntry`/`MethodEntry`, dragging the Tauri-binding ecosystem into the supposedly OS-independent core. Fix: keep the core types serde-only; add wrapper types `ServiceCatalogIpc`/`ServiceEntryIpc`/`MethodEntryIpc` in `src-tauri/src/ipc/catalog.rs` that derive `specta::Type` and convert `From<...>`. `ConnectOutcome.catalog` and `grpc_refresh_contract`'s return use the wrapper.

8. **`grpc_disconnect` scoped the mutex with a `{ }` block.** Plan's original code held the `MutexGuard` across the `.emit(&app)` call — latent deadlock if any future event handler triggers another grpc command. Fix matches the pattern in `grpc_connect` / `grpc_refresh_contract`.

9. **Plan's `Builder::serve_with_shutdown(addr, signal)` is on `Router`, not bare `Server`.** Plan §Task 4 documentation should note this — every spawner builds a `Router` via `add_service` before calling `serve_with_incoming_shutdown`.

10. **`skip_verify=true` deferred.** As planned, the implementation returns `CoreError::NotImplemented("skip_verify=true is deferred to a follow-up plan (requires hyper-rustls connector)")`. Real implementation will require either a hyper-rustls + tower-service stack, or a future tonic version exposing `with_custom_certificate_verifier`. Track for Plan #3 or a dedicated security-knobs sub-plan.

11. **`prost-reflect ["serde"]` feature is unused in Plan #2** but kept enabled — Plan #3's dynamic-invoke pipeline needs `DynamicMessage` JSON ser/de.

12. **`reflection/{v1,v1alpha,fallback}` are intentionally `pub mod`** — integration tests under `tests/` need the typed entry points. The re-exports at `reflection::*` give app code a clean facade; the double exposure is harmless.

13. **`AppReady` placeholder event removed.** It was a Plan #1 smoke marker; the frontend doesn't need a separate "ready" signal because it can poll `app_version()` on mount. Removed cleanly in Task 10.

The inline task content above reflects the original plan; consult this errata for the actual landed shape.

---

## File map

Создаём в `handshaker-core`:

```
crates/handshaker-core/src/
├── lib.rs                                    ← модифицируется (re-export grpc::*)
└── grpc/
    ├── mod.rs                                ← pub mod tree
    ├── connection.rs                         ← GrpcTarget + GrpcConnection
    ├── transport/
    │   ├── mod.rs                            ← GrpcTransport trait, TonicChannel alias
    │   └── tonic_impl.rs                     ← TonicTransport: channel() для tls=false и tls=true
    ├── reflection/
    │   ├── mod.rs                            ← публичный API: list_and_fetch_files(channel)
    │   ├── algorithm.rs                      ← generic-version reflection-stream цикл (типы через trait)
    │   ├── v1.rs                             ← V1Adapter — конкретные типы из pb::v1
    │   ├── v1alpha.rs                        ← V1AlphaAdapter — конкретные типы из pb::v1alpha
    │   └── fallback.rs                       ← orchestration: v1 → v1alpha
    ├── descriptor.rs                         ← build_pool(files) -> DescriptorPool
    ├── catalog/
    │   ├── mod.rs                            ← ServiceCatalog, MethodEntry, MessageSchema (data types)
    │   └── build.rs                          ← build_catalog(&DescriptorPool) -> ServiceCatalog
    └── contract.rs                           ← activate(target, &transport) -> GrpcConnection
```

Тесты (integration):

```
crates/handshaker-core/tests/
├── common/
│   └── mod.rs                                ← FileDescriptorSet fixture + test-server helpers
├── reflection_v1.rs                          ← happy path: v1-only server
├── reflection_v1alpha_fallback.rs            ← v1alpha-only server: fallback должен сработать
├── reflection_disabled.rs                    ← server без reflection: ReflectionDisabled
└── contract_activate.rs                      ← end-to-end через TonicTransport (plaintext)
```

Меняем в `src-tauri`:

```
src-tauri/src/
├── lib.rs                                    ← register grpc commands + events + crypto provider init
├── state.rs                                  ← добавляется connection: Mutex<Option<Arc<GrpcConnection>>>
├── commands/
│   ├── mod.rs                                ← register grpc module
│   ├── meta.rs                               ← без изменений (app_version остаётся)
│   ├── events.rs                             ← (new) ContractUpdated, ConnectionStateChanged
│   └── grpc.rs                               ← (new) grpc_connect, grpc_disconnect, grpc_refresh_contract
└── Cargo.toml                                ← добавить tokio sync feature если ещё нет
```

Меняем в `src/`:

```
src/
├── App.tsx                                   ← заменяет cold-start placeholder
├── features/
│   └── connect/
│       ├── ConnectPanel.tsx                  ← (new) address input + TLS toggle + Connect button
│       └── CatalogList.tsx                   ← (new) services → methods (list, не tree пока)
├── ipc/
│   ├── bindings.ts                           ← regenerated by export-bindings
│   ├── client.ts                             ← добавить grpcConnect/Disconnect/RefreshContract wrappers
│   └── events.ts                             ← (new) subscribeToContractUpdated, subscribeToConnectionState
└── styles/globals.css                        ← без изменений
```

Меняем в `Cargo.toml` (workspace):

```
- handshaker-core/Cargo.toml: добавить tonic, tonic-reflection, prost*, tokio, tokio-stream, async-trait, futures-util, http, bytes deps
- Cargo.toml workspace: добавить tokio-stream, futures-util, http, bytes в workspace.dependencies
```

---

### Task 1: Wire Plan #2 dependencies

**Files:**
- Modify: `Cargo.toml` (workspace `[workspace.dependencies]`)
- Modify: `crates/handshaker-core/Cargo.toml`
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Добавить новые пины в workspace `[workspace.dependencies]`**

Открой `Cargo.toml` в корне репо. После строки `prost-reflect = { version = "0.14", features = ["serde"] }` добавь:

```toml
# Plan #2 — Reflection spine
tokio-stream = "0.1"
futures-util = "0.3"
http = "1"
bytes = "1"
```

Никакие старые пины не меняем (tonic, tonic-reflection, prost-* уже есть).

- [ ] **Step 2: Подключить deps в `crates/handshaker-core/Cargo.toml`**

Замени блок `[dependencies]` в `crates/handshaker-core/Cargo.toml` на:

```toml
[dependencies]
thiserror.workspace = true
serde = { workspace = true, features = ["derive"] }
tokio = { workspace = true, features = ["rt-multi-thread", "macros", "sync", "time"] }
tokio-stream.workspace = true
futures-util.workspace = true
async-trait.workspace = true
http.workspace = true
bytes.workspace = true

# gRPC + reflection + descriptors
tonic = { workspace = true, features = ["tls-ring", "tls-native-roots"] }
tonic-reflection.workspace = true  # default `server` feature даёт client + server-builder для тестов
prost.workspace = true
prost-types.workspace = true
prost-reflect.workspace = true     # features ["serde"] из workspace

[dev-dependencies]
tokio = { workspace = true, features = ["macros", "rt-multi-thread"] }
```

`unsafe_code = "forbid"` в `[lints.rust]` оставляем без изменений.

- [ ] **Step 3: Подключить `tokio` sync в src-tauri, если ещё нет**

Открой `src-tauri/Cargo.toml`. В блоке `[dependencies]` найди строку с `tokio.workspace = true`. Замени на:

```toml
tokio = { workspace = true, features = ["sync", "rt-multi-thread", "macros", "time"] }
```

Это даёт `tokio::sync::Mutex`, который мы используем в state.

Также добавь зависимость на async-trait и handshaker-core grpc реэкспорты:

```toml
async-trait.workspace = true
```

(handshaker-core уже подключён.)

- [ ] **Step 4: Проверить, что workspace всё ещё резолвится**

Запусти:

```bash
cargo metadata --format-version=1 --no-deps > nul
```

Ожидаемо: команда отрабатывает без ошибок (Windows `> nul`; на mac/linux замени на `> /dev/null`). Если cargo ругается на пин — fix и повтори.

- [ ] **Step 5: Полный `cargo build -p handshaker-core` всё ещё должен проходить**

Run:

```bash
cargo build -p handshaker-core
```

Expected: PASS (модулей мы пока не создали — компилируется только `error.rs`, но с новыми deps в `Cargo.toml` cargo должен только подтянуть их и проверить совместимость).

- [ ] **Step 6: Commit**

```bash
git add Cargo.toml crates/handshaker-core/Cargo.toml src-tauri/Cargo.toml
git commit -m "chore(plan-2): wire tonic/tonic-reflection/prost-reflect deps"
```

---

### Task 2: GrpcTarget value type

**Files:**
- Create: `crates/handshaker-core/src/grpc/mod.rs`
- Create: `crates/handshaker-core/src/grpc/connection.rs`
- Modify: `crates/handshaker-core/src/lib.rs`

- [ ] **Step 1: Создать каркас grpc-модуля**

Создай файл `crates/handshaker-core/src/grpc/mod.rs`:

```rust
//! gRPC subsystem: target, transport, reflection, descriptors, catalog, connection orchestration.
//!
//! Tonic types are confined to `transport::tonic_impl` and `reflection`. The rest of the core
//! talks `prost_reflect::DescriptorPool` and the data types defined here.

pub mod connection;

pub use connection::GrpcTarget;
```

- [ ] **Step 2: Написать failing test для `GrpcTarget::new` (валидация)**

Создай файл `crates/handshaker-core/src/grpc/connection.rs`:

```rust
//! GrpcTarget — resolved address + TLS flags. No `{{var}}` here.

use crate::error::CoreError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct GrpcTarget {
    /// `host:port`, already resolved (no `{{var}}`).
    pub address: String,
    /// `true` → TLS (`https://`). `false` → plaintext h2c (`http://`).
    pub tls: bool,
    /// `true` → skip TLS cert verification. **Not implemented in Plan #2.**
    pub skip_verify: bool,
}

impl GrpcTarget {
    /// Construct + validate.
    ///
    /// Rules:
    /// - `address` non-empty.
    /// - `address` contains exactly one `:`.
    /// - Port is a valid u16 (1..=65535).
    /// - Host is non-empty.
    pub fn new(address: impl Into<String>, tls: bool, skip_verify: bool) -> Result<Self, CoreError> {
        let address = address.into();
        if address.is_empty() {
            return Err(CoreError::InvalidTarget("address is empty".into()));
        }
        let (host, port) = address.rsplit_once(':').ok_or_else(|| {
            CoreError::InvalidTarget(format!("address must be host:port, got `{address}`"))
        })?;
        if host.is_empty() {
            return Err(CoreError::InvalidTarget(format!(
                "host is empty in `{address}`"
            )));
        }
        let port_num: u16 = port
            .parse()
            .map_err(|_| CoreError::InvalidTarget(format!("invalid port `{port}` in `{address}`")))?;
        if port_num == 0 {
            return Err(CoreError::InvalidTarget(format!(
                "port must be 1..=65535, got 0 in `{address}`"
            )));
        }
        Ok(Self {
            address,
            tls,
            skip_verify,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_valid_hostport() {
        let t = GrpcTarget::new("api.prod.example.com:8443", true, false).unwrap();
        assert_eq!(t.address, "api.prod.example.com:8443");
        assert!(t.tls);
        assert!(!t.skip_verify);
    }

    #[test]
    fn accepts_ipv4() {
        let t = GrpcTarget::new("127.0.0.1:50051", false, false).unwrap();
        assert_eq!(t.address, "127.0.0.1:50051");
    }

    #[test]
    fn rejects_empty_address() {
        let err = GrpcTarget::new("", false, false).unwrap_err();
        assert!(matches!(err, CoreError::InvalidTarget(_)));
    }

    #[test]
    fn rejects_missing_port() {
        let err = GrpcTarget::new("api.prod", true, false).unwrap_err();
        assert!(matches!(err, CoreError::InvalidTarget(_)));
    }

    #[test]
    fn rejects_empty_host() {
        let err = GrpcTarget::new(":8443", true, false).unwrap_err();
        assert!(matches!(err, CoreError::InvalidTarget(_)));
    }

    #[test]
    fn rejects_nonnumeric_port() {
        let err = GrpcTarget::new("api.prod:nope", true, false).unwrap_err();
        assert!(matches!(err, CoreError::InvalidTarget(_)));
    }

    #[test]
    fn rejects_zero_port() {
        let err = GrpcTarget::new("api.prod:0", true, false).unwrap_err();
        assert!(matches!(err, CoreError::InvalidTarget(_)));
    }

    #[test]
    fn rejects_overflow_port() {
        let err = GrpcTarget::new("api.prod:99999", true, false).unwrap_err();
        assert!(matches!(err, CoreError::InvalidTarget(_)));
    }
}
```

- [ ] **Step 3: Re-export через `lib.rs`**

Открой `crates/handshaker-core/src/lib.rs`. Замени содержимое на:

```rust
//! handshaker-core — OS-independent core.
//!
//! Modules grow plan-by-plan: error (plan 1), grpc/* (plans 2-3), env+resolver (plan 4),
//! auth (plan 5), collections (plan 6).

pub mod error;
pub mod grpc;

pub use error::CoreError;
pub use grpc::GrpcTarget;
```

- [ ] **Step 4: Запустить тесты — все 8 должны проходить**

Run:

```bash
cargo test -p handshaker-core grpc::connection::
```

Expected: 8/8 passed.

- [ ] **Step 5: Commit**

```bash
git add crates/handshaker-core/src/grpc/mod.rs crates/handshaker-core/src/grpc/connection.rs crates/handshaker-core/src/lib.rs
git commit -m "feat(core): GrpcTarget value type with validation"
```

---

### Task 3: GrpcTransport trait + TonicTransport (plaintext channel)

**Files:**
- Create: `crates/handshaker-core/src/grpc/transport/mod.rs`
- Create: `crates/handshaker-core/src/grpc/transport/tonic_impl.rs`
- Modify: `crates/handshaker-core/src/grpc/mod.rs`

- [ ] **Step 1: Создать `transport/mod.rs` — trait + type alias**

Создай файл `crates/handshaker-core/src/grpc/transport/mod.rs`:

```rust
//! Transport abstraction. Tonic-specific channel lives in `tonic_impl`.
//!
//! The trait surface stays minimal in Plan #2: only `channel(...)` for opening an HTTP/2
//! connection. `unary_dynamic(...)` joins in Plan #3 (dynamic invoke).

pub mod tonic_impl;

use crate::error::CoreError;
use crate::grpc::connection::GrpcTarget;

/// Re-export so callers don't reach into `tonic::transport` directly.
pub type TonicChannel = tonic::transport::Channel;

#[async_trait::async_trait]
pub trait GrpcTransport: Send + Sync {
    /// Open a fresh HTTP/2 channel to `target`.
    async fn channel(&self, target: &GrpcTarget) -> Result<TonicChannel, CoreError>;
}

pub use tonic_impl::TonicTransport;
```

- [ ] **Step 2: Failing test — plaintext channel resolves localhost:0 endpoint string**

Создай файл `crates/handshaker-core/src/grpc/transport/tonic_impl.rs`:

```rust
//! Concrete `GrpcTransport` backed by `tonic::transport::Channel`.

use crate::error::CoreError;
use crate::grpc::connection::GrpcTarget;
use crate::grpc::transport::{GrpcTransport, TonicChannel};
use tonic::transport::Endpoint;

#[derive(Debug, Default, Clone)]
pub struct TonicTransport {
    _private: (),
}

impl TonicTransport {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait::async_trait]
impl GrpcTransport for TonicTransport {
    async fn channel(&self, target: &GrpcTarget) -> Result<TonicChannel, CoreError> {
        if target.skip_verify {
            return Err(CoreError::NotImplemented(
                "skip_verify=true is deferred to a follow-up plan (requires hyper-rustls connector)"
                    .into(),
            ));
        }
        let scheme = if target.tls { "https" } else { "http" };
        let uri = format!("{scheme}://{}", target.address);
        let mut endpoint = Endpoint::from_shared(uri.clone())
            .map_err(|e| CoreError::Transport(format!("endpoint `{uri}`: {e}")))?;

        if target.tls {
            let tls = tonic::transport::ClientTlsConfig::new().with_native_roots();
            endpoint = endpoint
                .tls_config(tls)
                .map_err(|e| CoreError::Transport(format!("tls config for `{uri}`: {e}")))?;
        }

        endpoint
            .connect()
            .await
            .map_err(|e| CoreError::Transport(format!("connect `{uri}`: {e}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn skip_verify_returns_not_implemented() {
        let t = TonicTransport::new();
        let target = GrpcTarget::new("127.0.0.1:65535", true, true).unwrap();
        let err = t.channel(&target).await.unwrap_err();
        assert!(matches!(err, CoreError::NotImplemented(_)));
    }

    #[tokio::test]
    async fn plaintext_unreachable_returns_transport_error() {
        let t = TonicTransport::new();
        // Port 1 is reserved + unbound — guaranteed `Transport` error, not `InvalidTarget`.
        let target = GrpcTarget::new("127.0.0.1:1", false, false).unwrap();
        let err = t.channel(&target).await.unwrap_err();
        assert!(matches!(err, CoreError::Transport(_)), "got {err:?}");
    }
}
```

- [ ] **Step 3: Прокинуть mod в `grpc/mod.rs`**

Открой `crates/handshaker-core/src/grpc/mod.rs`. Замени содержимое на:

```rust
//! gRPC subsystem: target, transport, reflection, descriptors, catalog, connection orchestration.
//!
//! Tonic types are confined to `transport::tonic_impl` and `reflection`. The rest of the core
//! talks `prost_reflect::DescriptorPool` and the data types defined here.

pub mod connection;
pub mod transport;

pub use connection::GrpcTarget;
pub use transport::{GrpcTransport, TonicChannel, TonicTransport};
```

- [ ] **Step 4: Запустить тесты**

Run:

```bash
cargo test -p handshaker-core grpc::transport
```

Expected: 2/2 passed.

- [ ] **Step 5: Commit**

```bash
git add crates/handshaker-core/src/grpc/mod.rs crates/handshaker-core/src/grpc/transport
git commit -m "feat(core): GrpcTransport trait + plaintext/system-roots TLS channel"
```

---

### Task 4: Test fixture — minimal FileDescriptorSet + in-process reflection servers

**Files:**
- Create: `crates/handshaker-core/tests/common/mod.rs`

This task creates shared test infrastructure used by tasks 5-9. No production code yet — only test helpers.

- [ ] **Step 1: Создать общий тестовый модуль**

Создай файл `crates/handshaker-core/tests/common/mod.rs`:

```rust
//! Shared test helpers: a tiny hand-crafted `FileDescriptorSet` + in-process gRPC servers
//! that expose Server Reflection (v1, v1alpha, or none).
//!
//! Used by tests/reflection_*.rs and tests/contract_*.rs.

#![allow(dead_code)] // each integration-test binary uses a subset.

use prost::Message;
use prost_types::{
    DescriptorProto, FieldDescriptorProto, FileDescriptorProto, FileDescriptorSet,
    MethodDescriptorProto, ServiceDescriptorProto, field_descriptor_proto::Type as FieldType,
};
use std::net::SocketAddr;
use tokio::net::TcpListener;
use tokio::sync::oneshot;

/// Build a minimal `FileDescriptorSet` containing one file:
///
/// ```proto
/// syntax = "proto3";
/// package test;
/// message Ping { string id = 1; }
/// message Pong { string id = 1; string echoed = 2; }
/// service Echo {
///   rpc Send (Ping) returns (Pong);
/// }
/// ```
pub fn fixture_descriptor_set_bytes() -> Vec<u8> {
    let ping = DescriptorProto {
        name: Some("Ping".to_string()),
        field: vec![FieldDescriptorProto {
            name: Some("id".to_string()),
            number: Some(1),
            r#type: Some(FieldType::String as i32),
            ..Default::default()
        }],
        ..Default::default()
    };
    let pong = DescriptorProto {
        name: Some("Pong".to_string()),
        field: vec![
            FieldDescriptorProto {
                name: Some("id".to_string()),
                number: Some(1),
                r#type: Some(FieldType::String as i32),
                ..Default::default()
            },
            FieldDescriptorProto {
                name: Some("echoed".to_string()),
                number: Some(2),
                r#type: Some(FieldType::String as i32),
                ..Default::default()
            },
        ],
        ..Default::default()
    };
    let service = ServiceDescriptorProto {
        name: Some("Echo".to_string()),
        method: vec![MethodDescriptorProto {
            name: Some("Send".to_string()),
            input_type: Some(".test.Ping".to_string()),
            output_type: Some(".test.Pong".to_string()),
            ..Default::default()
        }],
        ..Default::default()
    };
    let file = FileDescriptorProto {
        name: Some("test/echo.proto".to_string()),
        package: Some("test".to_string()),
        syntax: Some("proto3".to_string()),
        message_type: vec![ping, pong],
        service: vec![service],
        ..Default::default()
    };
    let set = FileDescriptorSet { file: vec![file] };
    let mut buf = Vec::new();
    set.encode(&mut buf).expect("encode FileDescriptorSet");
    buf
}

/// Pick a free TCP port by binding to 127.0.0.1:0 and reading back the assigned port.
async fn pick_addr() -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    drop(listener);
    addr
}

/// Spawn a tonic server exposing reflection over the v1 protocol.
/// Returns `(address, shutdown_sender)`. Drop the sender to stop the server.
pub async fn spawn_reflection_server_v1() -> (SocketAddr, oneshot::Sender<()>) {
    let addr = pick_addr().await;
    let reflection = tonic_reflection::server::Builder::configure()
        .register_encoded_file_descriptor_set(&fixture_descriptor_set_bytes())
        .build_v1()
        .expect("build v1 reflection service");

    let (tx, rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        let _ = tonic::transport::Server::builder()
            .add_service(reflection)
            .serve_with_shutdown(addr, async {
                rx.await.ok();
            })
            .await;
    });
    // tiny pause to let the listener bind
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    (addr, tx)
}

/// Spawn a tonic server exposing reflection ONLY over the v1alpha protocol.
pub async fn spawn_reflection_server_v1alpha() -> (SocketAddr, oneshot::Sender<()>) {
    let addr = pick_addr().await;
    let reflection = tonic_reflection::server::Builder::configure()
        .register_encoded_file_descriptor_set(&fixture_descriptor_set_bytes())
        .build_v1alpha()
        .expect("build v1alpha reflection service");

    let (tx, rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        let _ = tonic::transport::Server::builder()
            .add_service(reflection)
            .serve_with_shutdown(addr, async {
                rx.await.ok();
            })
            .await;
    });
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    (addr, tx)
}

/// Spawn a tonic server with NO reflection service registered.
/// Useful to exercise the `ReflectionDisabled` path.
pub async fn spawn_bare_server() -> (SocketAddr, oneshot::Sender<()>) {
    let addr = pick_addr().await;
    let (tx, rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        // Empty server: any RPC returns Unimplemented at the HTTP/2 layer.
        let _ = tonic::transport::Server::builder()
            .serve_with_shutdown(addr, async {
                rx.await.ok();
            })
            .await;
    });
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    (addr, tx)
}
```

**Note**: `Builder::build_v1` and `Builder::build_v1alpha` are the two builders exposed by
`tonic_reflection::server`. If `build_v1alpha` is not yet stable in 0.14.x (some 0.14
releases lag), substitute `build` (deprecated alias for `build_v1alpha`) — adjust at the
moment of execution by reading
`https://docs.rs/tonic-reflection/0.14.5/tonic_reflection/server/struct.Builder.html`.

- [ ] **Step 2: Smoke-проверка компиляции common-модуля через минимальный тест**

Создай файл `crates/handshaker-core/tests/common_smoke.rs`:

```rust
mod common;

#[test]
fn fixture_descriptor_set_is_nonempty() {
    let bytes = common::fixture_descriptor_set_bytes();
    assert!(!bytes.is_empty());
    assert!(bytes.len() < 4096, "fixture should be tiny, got {} bytes", bytes.len());
}

#[tokio::test]
async fn v1_server_spawns_and_listens() {
    let (addr, shutdown) = common::spawn_reflection_server_v1().await;
    assert_eq!(addr.ip().to_string(), "127.0.0.1");
    assert_ne!(addr.port(), 0);
    drop(shutdown);
}
```

- [ ] **Step 3: Запустить тесты**

Run:

```bash
cargo test -p handshaker-core --test common_smoke
```

Expected: 2/2 passed. Если `build_v1alpha` / `build_v1` ругаются — посмотри ошибку компилятора и согласно текущей документации tonic-reflection 0.14.x подставь правильный метод (`build`, `build_v1`, `build_v1alpha`). Зафиксируй выбор в `tests/common/mod.rs`.

- [ ] **Step 4: Commit**

```bash
git add crates/handshaker-core/tests/common crates/handshaker-core/tests/common_smoke.rs
git commit -m "test(core): shared fixture + in-process reflection server helpers"
```

---

### Task 5: Reflection v1 — single-version streaming client

**Files:**
- Create: `crates/handshaker-core/src/grpc/reflection/mod.rs`
- Create: `crates/handshaker-core/src/grpc/reflection/algorithm.rs`
- Create: `crates/handshaker-core/src/grpc/reflection/v1.rs`
- Modify: `crates/handshaker-core/src/grpc/mod.rs`
- Create: `crates/handshaker-core/tests/reflection_v1.rs`

- [ ] **Step 1: Создать каркас `reflection/`**

Создай файл `crates/handshaker-core/src/grpc/reflection/mod.rs`:

```rust
//! gRPC Server Reflection client.
//!
//! Public API: `list_and_fetch_files_v1(channel)` (this task). Fallback wrapper
//! `list_and_fetch_files(channel)` lands in the next task.

pub(crate) mod algorithm;
pub mod v1;

pub use v1::list_and_fetch_files_v1;
```

- [ ] **Step 2: Написать алгоритм reflection-стрима через trait**

Создай файл `crates/handshaker-core/src/grpc/reflection/algorithm.rs`:

```rust
//! Reflection algorithm parametrised over a `ReflectionAdapter`.
//!
//! The two generated clients (`pb::v1::ServerReflectionClient`, `pb::v1alpha::ServerReflectionClient`)
//! have identical SHAPE but different concrete request/response types. We isolate the
//! tonic-specific bits behind `ReflectionAdapter` and write the streaming loop once.

use crate::error::CoreError;
use crate::grpc::transport::TonicChannel;
use async_trait::async_trait;
use prost::Message;
use prost_types::FileDescriptorProto;
use std::collections::{HashMap, HashSet, VecDeque};

#[async_trait]
pub(crate) trait ReflectionAdapter {
    /// Human-readable version label for error messages, e.g. "v1" / "v1alpha".
    fn version_label(&self) -> &'static str;

    /// Open a bidi `ServerReflectionInfo` stream and return:
    ///   - a sender we can push `MessageRequest`s into (`Send` items),
    ///   - a receiver that yields raw `FileDescriptorResponse` bytes batches OR error markers.
    ///
    /// The implementation drives the underlying tonic streaming client.
    async fn run_session(
        &self,
        channel: TonicChannel,
        plan: SessionPlan,
    ) -> Result<SessionOutcome, CoreError>;
}

/// One-shot plan: services to list (always `""`) + symbols to fetch + filenames to fetch.
/// We accumulate everything in memory and let the adapter execute the streaming dance.
pub(crate) struct SessionPlan {
    pub list_services: bool,
    pub symbols: Vec<String>,
    pub filenames: Vec<String>,
}

pub(crate) struct SessionOutcome {
    pub services: Vec<String>,
    /// Raw `FileDescriptorProto` bytes returned by the server (potentially with duplicates).
    pub file_proto_bytes: Vec<Vec<u8>>,
}

/// Top-level recipe: `list_services` → for each service, `file_containing_symbol(service)` →
/// for each returned file, follow `.dependency` until closure. Returns the decoded
/// deduplicated `FileDescriptorProto`s and the service list.
pub(crate) async fn run<A: ReflectionAdapter + Send + Sync>(
    adapter: &A,
    channel: TonicChannel,
) -> Result<(Vec<String>, Vec<FileDescriptorProto>), CoreError> {
    // Pass 1: list services.
    let listed = adapter
        .run_session(
            channel.clone(),
            SessionPlan {
                list_services: true,
                symbols: vec![],
                filenames: vec![],
            },
        )
        .await?;
    if listed.services.is_empty() {
        return Err(CoreError::Reflection(format!(
            "{} server returned empty service list",
            adapter.version_label()
        )));
    }

    // Pass 2: file_containing_symbol for each service. Then crawl dependencies.
    let pending_symbols = listed.services.clone();
    let fetched = adapter
        .run_session(
            channel.clone(),
            SessionPlan {
                list_services: false,
                symbols: pending_symbols,
                filenames: vec![],
            },
        )
        .await?;

    let mut by_name: HashMap<String, FileDescriptorProto> = HashMap::new();
    let mut queue: VecDeque<String> = VecDeque::new();
    let mut requested: HashSet<String> = HashSet::new();

    for bytes in &fetched.file_proto_bytes {
        let fdp = FileDescriptorProto::decode(&bytes[..]).map_err(|e| {
            CoreError::DescriptorBuild(format!(
                "decode FileDescriptorProto from {} server: {e}",
                adapter.version_label()
            ))
        })?;
        for dep in &fdp.dependency {
            if !requested.contains(dep) {
                queue.push_back(dep.clone());
                requested.insert(dep.clone());
            }
        }
        if let Some(name) = fdp.name.clone() {
            requested.insert(name.clone());
            by_name.insert(name, fdp);
        }
    }

    // Crawl dependencies until the queue drains.
    while !queue.is_empty() {
        let batch: Vec<String> = queue.drain(..).collect();
        let resp = adapter
            .run_session(
                channel.clone(),
                SessionPlan {
                    list_services: false,
                    symbols: vec![],
                    filenames: batch,
                },
            )
            .await?;
        for bytes in &resp.file_proto_bytes {
            let fdp = FileDescriptorProto::decode(&bytes[..]).map_err(|e| {
                CoreError::DescriptorBuild(format!(
                    "decode FileDescriptorProto from {} server: {e}",
                    adapter.version_label()
                ))
            })?;
            for dep in &fdp.dependency {
                if !requested.contains(dep) {
                    queue.push_back(dep.clone());
                    requested.insert(dep.clone());
                }
            }
            if let Some(name) = fdp.name.clone() {
                if !by_name.contains_key(&name) {
                    by_name.insert(name, fdp);
                }
            }
        }
    }

    let files = by_name.into_values().collect::<Vec<_>>();
    Ok((listed.services, files))
}
```

- [ ] **Step 3: Имплементировать `V1Adapter` через generated client**

Создай файл `crates/handshaker-core/src/grpc/reflection/v1.rs`:

```rust
//! v1 adapter: drives `tonic_reflection::pb::v1::server_reflection_client::ServerReflectionClient`.

use crate::error::CoreError;
use crate::grpc::reflection::algorithm::{self, ReflectionAdapter, SessionOutcome, SessionPlan};
use crate::grpc::transport::TonicChannel;
use async_trait::async_trait;
use prost_types::FileDescriptorProto;
use tokio_stream::wrappers::ReceiverStream;
use tonic::Code;
use tonic_reflection::pb::v1::server_reflection_client::ServerReflectionClient;
use tonic_reflection::pb::v1::server_reflection_request::MessageRequest;
use tonic_reflection::pb::v1::server_reflection_response::MessageResponse;
use tonic_reflection::pb::v1::ServerReflectionRequest;

pub struct V1Adapter;

#[async_trait]
impl ReflectionAdapter for V1Adapter {
    fn version_label(&self) -> &'static str {
        "v1"
    }

    async fn run_session(
        &self,
        channel: TonicChannel,
        plan: SessionPlan,
    ) -> Result<SessionOutcome, CoreError> {
        let mut client = ServerReflectionClient::new(channel);

        // Build the request stream.
        let (tx, rx) = tokio::sync::mpsc::channel::<ServerReflectionRequest>(16);
        let mut expected: usize = 0;
        if plan.list_services {
            tx.send(make_list_services_request())
                .await
                .map_err(|_| CoreError::Reflection("send list_services: channel closed".into()))?;
            expected += 1;
        }
        for sym in &plan.symbols {
            tx.send(make_file_containing_symbol_request(sym))
                .await
                .map_err(|_| CoreError::Reflection("send file_containing_symbol: channel closed".into()))?;
            expected += 1;
        }
        for fname in &plan.filenames {
            tx.send(make_file_by_filename_request(fname))
                .await
                .map_err(|_| CoreError::Reflection("send file_by_filename: channel closed".into()))?;
            expected += 1;
        }
        drop(tx); // close the sender so the server side completes.

        let response = client
            .server_reflection_info(ReceiverStream::new(rx))
            .await
            .map_err(|st| map_status(st))?;
        let mut stream = response.into_inner();

        let mut services = Vec::new();
        let mut file_proto_bytes: Vec<Vec<u8>> = Vec::new();
        let mut received = 0usize;

        while let Some(item) = stream
            .message()
            .await
            .map_err(|st| map_status(st))?
        {
            received += 1;
            let Some(msg) = item.message_response else {
                continue;
            };
            match msg {
                MessageResponse::ListServicesResponse(list) => {
                    for s in list.service {
                        services.push(s.name);
                    }
                }
                MessageResponse::FileDescriptorResponse(fdr) => {
                    file_proto_bytes.extend(fdr.file_descriptor_proto);
                }
                MessageResponse::ErrorResponse(e) => {
                    return Err(CoreError::Reflection(format!(
                        "v1 server error: code={} {}",
                        e.error_code, e.error_message
                    )));
                }
                MessageResponse::AllExtensionNumbersResponse(_) => {
                    // ignored — we don't ask for extension numbers.
                }
            }
            if received >= expected {
                break;
            }
        }

        Ok(SessionOutcome {
            services,
            file_proto_bytes,
        })
    }
}

fn make_list_services_request() -> ServerReflectionRequest {
    ServerReflectionRequest {
        host: String::new(),
        message_request: Some(MessageRequest::ListServices(String::new())),
    }
}

fn make_file_containing_symbol_request(symbol: &str) -> ServerReflectionRequest {
    ServerReflectionRequest {
        host: String::new(),
        message_request: Some(MessageRequest::FileContainingSymbol(symbol.to_string())),
    }
}

fn make_file_by_filename_request(filename: &str) -> ServerReflectionRequest {
    ServerReflectionRequest {
        host: String::new(),
        message_request: Some(MessageRequest::FileByFilename(filename.to_string())),
    }
}

/// Translate tonic `Status` into our `CoreError`. `Unimplemented` is the signal the caller
/// uses to trigger v1alpha fallback (the wrapper in `reflection/fallback.rs`).
fn map_status(st: tonic::Status) -> CoreError {
    match st.code() {
        Code::Unimplemented => CoreError::ReflectionDisabled {
            hint: format!("v1 unimplemented: {}", st.message()),
        },
        _ => CoreError::Reflection(format!("v1 status {:?}: {}", st.code(), st.message())),
    }
}

/// Public single-version entry point used by tests and by the fallback wrapper.
pub async fn list_and_fetch_files_v1(
    channel: TonicChannel,
) -> Result<(Vec<String>, Vec<FileDescriptorProto>), CoreError> {
    algorithm::run(&V1Adapter, channel).await
}
```

- [ ] **Step 4: Подключить в `grpc/mod.rs`**

Открой `crates/handshaker-core/src/grpc/mod.rs`. Замени содержимое на:

```rust
//! gRPC subsystem: target, transport, reflection, descriptors, catalog, connection orchestration.
//!
//! Tonic types are confined to `transport::tonic_impl` and `reflection`. The rest of the core
//! talks `prost_reflect::DescriptorPool` and the data types defined here.

pub mod connection;
pub mod reflection;
pub mod transport;

pub use connection::GrpcTarget;
pub use transport::{GrpcTransport, TonicChannel, TonicTransport};
```

- [ ] **Step 5: Failing integration test — v1 happy path**

Создай файл `crates/handshaker-core/tests/reflection_v1.rs`:

```rust
mod common;

use handshaker_core::grpc::reflection::list_and_fetch_files_v1;
use tonic::transport::Endpoint;

#[tokio::test]
async fn v1_returns_service_and_descriptor() {
    let (addr, _shutdown) = common::spawn_reflection_server_v1().await;
    let channel = Endpoint::from_shared(format!("http://{}", addr))
        .unwrap()
        .connect()
        .await
        .unwrap();

    let (services, files) = list_and_fetch_files_v1(channel).await.expect("v1 reflection");

    assert!(
        services.iter().any(|s| s == "test.Echo"),
        "expected `test.Echo` in services, got {services:?}"
    );
    assert!(
        files.iter().any(|f| f.name.as_deref() == Some("test/echo.proto")),
        "expected `test/echo.proto` in files, got {:?}",
        files.iter().map(|f| f.name.clone()).collect::<Vec<_>>()
    );
}
```

- [ ] **Step 6: Запустить тесты**

Run:

```bash
cargo test -p handshaker-core --test reflection_v1
```

Expected: 1/1 passed. Если падает — диагностируй: чаще всего проблема в импортах из `tonic_reflection::pb::v1::*` (метод `build_v1` vs `build` на server-builder, см. ремарку в Task 4 Step 1).

- [ ] **Step 7: Commit**

```bash
git add crates/handshaker-core/src/grpc crates/handshaker-core/tests/reflection_v1.rs
git commit -m "feat(core): reflection v1 client (list_services + file fetch + dep crawl)"
```

---

### Task 6: v1alpha adapter + fallback wrapper

**Files:**
- Create: `crates/handshaker-core/src/grpc/reflection/v1alpha.rs`
- Create: `crates/handshaker-core/src/grpc/reflection/fallback.rs`
- Modify: `crates/handshaker-core/src/grpc/reflection/mod.rs`
- Create: `crates/handshaker-core/tests/reflection_v1alpha_fallback.rs`
- Create: `crates/handshaker-core/tests/reflection_disabled.rs`

- [ ] **Step 1: Имплементировать `V1AlphaAdapter`**

Создай файл `crates/handshaker-core/src/grpc/reflection/v1alpha.rs`:

```rust
//! v1alpha adapter: structural twin of `V1Adapter`, talks to v1alpha generated client.

use crate::error::CoreError;
use crate::grpc::reflection::algorithm::{self, ReflectionAdapter, SessionOutcome, SessionPlan};
use crate::grpc::transport::TonicChannel;
use async_trait::async_trait;
use prost_types::FileDescriptorProto;
use tokio_stream::wrappers::ReceiverStream;
use tonic::Code;
use tonic_reflection::pb::v1alpha::server_reflection_client::ServerReflectionClient;
use tonic_reflection::pb::v1alpha::server_reflection_request::MessageRequest;
use tonic_reflection::pb::v1alpha::server_reflection_response::MessageResponse;
use tonic_reflection::pb::v1alpha::ServerReflectionRequest;

pub struct V1AlphaAdapter;

#[async_trait]
impl ReflectionAdapter for V1AlphaAdapter {
    fn version_label(&self) -> &'static str {
        "v1alpha"
    }

    async fn run_session(
        &self,
        channel: TonicChannel,
        plan: SessionPlan,
    ) -> Result<SessionOutcome, CoreError> {
        let mut client = ServerReflectionClient::new(channel);

        let (tx, rx) = tokio::sync::mpsc::channel::<ServerReflectionRequest>(16);
        let mut expected: usize = 0;
        if plan.list_services {
            tx.send(make_list_services_request())
                .await
                .map_err(|_| CoreError::Reflection("send list_services: channel closed".into()))?;
            expected += 1;
        }
        for sym in &plan.symbols {
            tx.send(make_file_containing_symbol_request(sym))
                .await
                .map_err(|_| CoreError::Reflection("send file_containing_symbol: channel closed".into()))?;
            expected += 1;
        }
        for fname in &plan.filenames {
            tx.send(make_file_by_filename_request(fname))
                .await
                .map_err(|_| CoreError::Reflection("send file_by_filename: channel closed".into()))?;
            expected += 1;
        }
        drop(tx);

        let response = client
            .server_reflection_info(ReceiverStream::new(rx))
            .await
            .map_err(|st| map_status(st))?;
        let mut stream = response.into_inner();

        let mut services = Vec::new();
        let mut file_proto_bytes: Vec<Vec<u8>> = Vec::new();
        let mut received = 0usize;

        while let Some(item) = stream
            .message()
            .await
            .map_err(|st| map_status(st))?
        {
            received += 1;
            let Some(msg) = item.message_response else {
                continue;
            };
            match msg {
                MessageResponse::ListServicesResponse(list) => {
                    for s in list.service {
                        services.push(s.name);
                    }
                }
                MessageResponse::FileDescriptorResponse(fdr) => {
                    file_proto_bytes.extend(fdr.file_descriptor_proto);
                }
                MessageResponse::ErrorResponse(e) => {
                    return Err(CoreError::Reflection(format!(
                        "v1alpha server error: code={} {}",
                        e.error_code, e.error_message
                    )));
                }
                MessageResponse::AllExtensionNumbersResponse(_) => {}
            }
            if received >= expected {
                break;
            }
        }

        Ok(SessionOutcome {
            services,
            file_proto_bytes,
        })
    }
}

fn make_list_services_request() -> ServerReflectionRequest {
    ServerReflectionRequest {
        host: String::new(),
        message_request: Some(MessageRequest::ListServices(String::new())),
    }
}

fn make_file_containing_symbol_request(symbol: &str) -> ServerReflectionRequest {
    ServerReflectionRequest {
        host: String::new(),
        message_request: Some(MessageRequest::FileContainingSymbol(symbol.to_string())),
    }
}

fn make_file_by_filename_request(filename: &str) -> ServerReflectionRequest {
    ServerReflectionRequest {
        host: String::new(),
        message_request: Some(MessageRequest::FileByFilename(filename.to_string())),
    }
}

fn map_status(st: tonic::Status) -> CoreError {
    match st.code() {
        Code::Unimplemented => CoreError::ReflectionDisabled {
            hint: format!("v1alpha unimplemented: {}", st.message()),
        },
        _ => CoreError::Reflection(format!("v1alpha status {:?}: {}", st.code(), st.message())),
    }
}

pub async fn list_and_fetch_files_v1alpha(
    channel: TonicChannel,
) -> Result<(Vec<String>, Vec<FileDescriptorProto>), CoreError> {
    algorithm::run(&V1AlphaAdapter, channel).await
}
```

- [ ] **Step 2: Имплементировать fallback wrapper**

Создай файл `crates/handshaker-core/src/grpc/reflection/fallback.rs`:

```rust
//! v1 → v1alpha fallback. The CALLER passes a `TonicChannel` and gets back the union of
//! services + descriptors. We try v1 first; on `ReflectionDisabled` we retry with v1alpha.
//!
//! If BOTH versions are unimplemented, we surface a single `ReflectionDisabled` with a
//! hint that mentions both versions.

use crate::error::CoreError;
use crate::grpc::reflection::v1::list_and_fetch_files_v1;
use crate::grpc::reflection::v1alpha::list_and_fetch_files_v1alpha;
use crate::grpc::transport::TonicChannel;
use prost_types::FileDescriptorProto;

pub async fn list_and_fetch_files(
    channel: TonicChannel,
) -> Result<(Vec<String>, Vec<FileDescriptorProto>), CoreError> {
    match list_and_fetch_files_v1(channel.clone()).await {
        Ok(ok) => Ok(ok),
        Err(CoreError::ReflectionDisabled { hint: v1_hint }) => {
            match list_and_fetch_files_v1alpha(channel).await {
                Ok(ok) => Ok(ok),
                Err(CoreError::ReflectionDisabled { hint: alpha_hint }) => {
                    Err(CoreError::ReflectionDisabled {
                        hint: format!(
                            "neither v1 nor v1alpha reflection is enabled on the target \
                             (v1: {v1_hint}; v1alpha: {alpha_hint}). Enable Server Reflection \
                             on the server, then retry."
                        ),
                    })
                }
                Err(other) => Err(other),
            }
        }
        Err(other) => Err(other),
    }
}
```

- [ ] **Step 3: Re-export через `reflection/mod.rs`**

Замени содержимое `crates/handshaker-core/src/grpc/reflection/mod.rs` на:

```rust
//! gRPC Server Reflection client.
//!
//! - `list_and_fetch_files_v1` — single-version entry point against v1.
//! - `list_and_fetch_files_v1alpha` — single-version entry point against v1alpha.
//! - `list_and_fetch_files` — production entry point: v1 first, fallback to v1alpha.

pub(crate) mod algorithm;
pub mod fallback;
pub mod v1;
pub mod v1alpha;

pub use fallback::list_and_fetch_files;
pub use v1::list_and_fetch_files_v1;
pub use v1alpha::list_and_fetch_files_v1alpha;
```

- [ ] **Step 4: Integration test — v1alpha-only server, fallback should succeed**

Создай файл `crates/handshaker-core/tests/reflection_v1alpha_fallback.rs`:

```rust
mod common;

use handshaker_core::grpc::reflection::list_and_fetch_files;
use tonic::transport::Endpoint;

#[tokio::test]
async fn fallback_uses_v1alpha_when_v1_unimplemented() {
    let (addr, _shutdown) = common::spawn_reflection_server_v1alpha().await;
    let channel = Endpoint::from_shared(format!("http://{}", addr))
        .unwrap()
        .connect()
        .await
        .unwrap();

    let (services, files) = list_and_fetch_files(channel).await.expect("fallback");

    assert!(services.iter().any(|s| s == "test.Echo"));
    assert!(files.iter().any(|f| f.name.as_deref() == Some("test/echo.proto")));
}
```

- [ ] **Step 5: Integration test — neither v1 nor v1alpha — clear `ReflectionDisabled`**

Создай файл `crates/handshaker-core/tests/reflection_disabled.rs`:

```rust
mod common;

use handshaker_core::CoreError;
use handshaker_core::grpc::reflection::list_and_fetch_files;
use tonic::transport::Endpoint;

#[tokio::test]
async fn bare_server_yields_reflection_disabled() {
    let (addr, _shutdown) = common::spawn_bare_server().await;
    let channel = Endpoint::from_shared(format!("http://{}", addr))
        .unwrap()
        .connect()
        .await
        .unwrap();

    let err = list_and_fetch_files(channel).await.unwrap_err();
    match err {
        CoreError::ReflectionDisabled { hint } => {
            assert!(
                hint.to_lowercase().contains("v1") && hint.to_lowercase().contains("v1alpha"),
                "hint should mention both protocols, got `{hint}`"
            );
        }
        other => panic!("expected ReflectionDisabled, got {other:?}"),
    }
}
```

- [ ] **Step 6: Запустить тесты**

Run:

```bash
cargo test -p handshaker-core --test reflection_v1 --test reflection_v1alpha_fallback --test reflection_disabled
```

Expected: 3/3 passed.

- [ ] **Step 7: Commit**

```bash
git add crates/handshaker-core/src/grpc/reflection crates/handshaker-core/tests/reflection_v1alpha_fallback.rs crates/handshaker-core/tests/reflection_disabled.rs
git commit -m "feat(core): reflection v1alpha + v1→v1alpha fallback"
```

---

### Task 7: DescriptorPool assembly

**Files:**
- Create: `crates/handshaker-core/src/grpc/descriptor.rs`
- Modify: `crates/handshaker-core/src/grpc/mod.rs`

- [ ] **Step 1: Failing unit test — empty input fails clearly**

Создай файл `crates/handshaker-core/src/grpc/descriptor.rs`:

```rust
//! Assemble a `prost_reflect::DescriptorPool` from a flat list of `FileDescriptorProto`s.
//!
//! `prost_reflect`'s `add_file_descriptor_protos` already handles dependency ordering and
//! detects cycles / unresolved imports. We wrap it with our error type.

use crate::error::CoreError;
use prost_reflect::DescriptorPool;
use prost_types::FileDescriptorProto;

/// Build a fresh pool from a list of file descriptors. Returns
/// `CoreError::DescriptorBuild` on cycles, dangling imports, or duplicate file names.
pub fn build_pool(files: Vec<FileDescriptorProto>) -> Result<DescriptorPool, CoreError> {
    if files.is_empty() {
        return Err(CoreError::DescriptorBuild(
            "no FileDescriptorProto received from server".into(),
        ));
    }
    let mut pool = DescriptorPool::new();
    pool.add_file_descriptor_protos(files)
        .map_err(|e| CoreError::DescriptorBuild(format!("pool assembly: {e}")))?;
    Ok(pool)
}

#[cfg(test)]
mod tests {
    use super::*;
    use prost_types::{
        DescriptorProto, FieldDescriptorProto, FileDescriptorProto, MethodDescriptorProto,
        ServiceDescriptorProto, field_descriptor_proto::Type as FieldType,
    };

    fn make_simple_file() -> FileDescriptorProto {
        FileDescriptorProto {
            name: Some("test/echo.proto".into()),
            package: Some("test".into()),
            syntax: Some("proto3".into()),
            message_type: vec![
                DescriptorProto {
                    name: Some("Ping".into()),
                    field: vec![FieldDescriptorProto {
                        name: Some("id".into()),
                        number: Some(1),
                        r#type: Some(FieldType::String as i32),
                        ..Default::default()
                    }],
                    ..Default::default()
                },
                DescriptorProto {
                    name: Some("Pong".into()),
                    field: vec![FieldDescriptorProto {
                        name: Some("id".into()),
                        number: Some(1),
                        r#type: Some(FieldType::String as i32),
                        ..Default::default()
                    }],
                    ..Default::default()
                },
            ],
            service: vec![ServiceDescriptorProto {
                name: Some("Echo".into()),
                method: vec![MethodDescriptorProto {
                    name: Some("Send".into()),
                    input_type: Some(".test.Ping".into()),
                    output_type: Some(".test.Pong".into()),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    #[test]
    fn empty_input_rejected() {
        let err = build_pool(vec![]).unwrap_err();
        assert!(matches!(err, CoreError::DescriptorBuild(_)));
    }

    #[test]
    fn single_file_builds_and_resolves_service() {
        let pool = build_pool(vec![make_simple_file()]).expect("build pool");
        let svc = pool
            .get_service_by_name("test.Echo")
            .expect("Echo service must be in pool");
        assert_eq!(svc.full_name(), "test.Echo");
        assert_eq!(svc.methods().count(), 1);
        let m = svc.methods().next().unwrap();
        assert_eq!(m.name(), "Send");
        assert_eq!(m.input().full_name(), "test.Ping");
        assert_eq!(m.output().full_name(), "test.Pong");
    }

    #[test]
    fn unresolved_import_is_rejected() {
        let bad = FileDescriptorProto {
            name: Some("a.proto".into()),
            package: Some("a".into()),
            syntax: Some("proto3".into()),
            dependency: vec!["missing/b.proto".into()],
            ..Default::default()
        };
        let err = build_pool(vec![bad]).unwrap_err();
        assert!(matches!(err, CoreError::DescriptorBuild(_)));
    }
}
```

- [ ] **Step 2: Подключить в `grpc/mod.rs`**

Открой `crates/handshaker-core/src/grpc/mod.rs`. Замени на:

```rust
//! gRPC subsystem: target, transport, reflection, descriptors, catalog, connection orchestration.

pub mod connection;
pub mod descriptor;
pub mod reflection;
pub mod transport;

pub use connection::GrpcTarget;
pub use descriptor::build_pool;
pub use transport::{GrpcTransport, TonicChannel, TonicTransport};
```

- [ ] **Step 3: Запустить тесты**

Run:

```bash
cargo test -p handshaker-core grpc::descriptor::
```

Expected: 3/3 passed.

- [ ] **Step 4: Commit**

```bash
git add crates/handshaker-core/src/grpc/descriptor.rs crates/handshaker-core/src/grpc/mod.rs
git commit -m "feat(core): build DescriptorPool from FileDescriptorProtos"
```

---

### Task 8: ServiceCatalog from DescriptorPool

**Files:**
- Create: `crates/handshaker-core/src/grpc/catalog/mod.rs`
- Create: `crates/handshaker-core/src/grpc/catalog/build.rs`
- Modify: `crates/handshaker-core/src/grpc/mod.rs`

- [ ] **Step 1: Определить data-types каталога**

Создай файл `crates/handshaker-core/src/grpc/catalog/mod.rs`:

```rust
//! Service catalog: stable, UI-friendly snapshot of services → methods → message schemas
//! derived from a `DescriptorPool`. **Read-only**. The pool stays the source of truth;
//! catalog is a projection optimised for rendering.

pub mod build;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServiceCatalog {
    pub services: Vec<ServiceEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServiceEntry {
    /// Fully-qualified, e.g. `test.Echo`.
    pub full_name: String,
    pub methods: Vec<MethodEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MethodEntry {
    /// Short name, e.g. `Send`.
    pub name: String,
    /// gRPC path used at invoke time, e.g. `/test.Echo/Send`.
    pub path: String,
    /// Fully-qualified input message name, e.g. `test.Ping`.
    pub input_message: String,
    /// Fully-qualified output message name, e.g. `test.Pong`.
    pub output_message: String,
    pub client_streaming: bool,
    pub server_streaming: bool,
}

pub use build::build_catalog;
```

- [ ] **Step 2: Failing unit test — build_catalog on a known pool**

Создай файл `crates/handshaker-core/src/grpc/catalog/build.rs`:

```rust
//! Project a `DescriptorPool` into a stable `ServiceCatalog`.

use crate::grpc::catalog::{MethodEntry, ServiceCatalog, ServiceEntry};
use prost_reflect::DescriptorPool;

/// Snapshot all services in `pool` into a `ServiceCatalog`. Services are sorted by
/// full_name for stable UI rendering.
pub fn build_catalog(pool: &DescriptorPool) -> ServiceCatalog {
    let mut services: Vec<ServiceEntry> = pool
        .services()
        .map(|s| {
            let mut methods: Vec<MethodEntry> = s
                .methods()
                .map(|m| MethodEntry {
                    name: m.name().to_string(),
                    path: format!("/{}/{}", s.full_name(), m.name()),
                    input_message: m.input().full_name().to_string(),
                    output_message: m.output().full_name().to_string(),
                    client_streaming: m.is_client_streaming(),
                    server_streaming: m.is_server_streaming(),
                })
                .collect();
            methods.sort_by(|a, b| a.name.cmp(&b.name));
            ServiceEntry {
                full_name: s.full_name().to_string(),
                methods,
            }
        })
        .collect();
    services.sort_by(|a, b| a.full_name.cmp(&b.full_name));
    ServiceCatalog { services }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grpc::descriptor::build_pool;
    use prost_types::{
        DescriptorProto, FieldDescriptorProto, FileDescriptorProto, MethodDescriptorProto,
        ServiceDescriptorProto, field_descriptor_proto::Type as FieldType,
    };

    fn simple_file_with_two_services() -> FileDescriptorProto {
        FileDescriptorProto {
            name: Some("test/multi.proto".into()),
            package: Some("test".into()),
            syntax: Some("proto3".into()),
            message_type: vec![DescriptorProto {
                name: Some("Empty".into()),
                field: vec![FieldDescriptorProto {
                    name: Some("nothing".into()),
                    number: Some(1),
                    r#type: Some(FieldType::String as i32),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            service: vec![
                ServiceDescriptorProto {
                    name: Some("Beta".into()),
                    method: vec![MethodDescriptorProto {
                        name: Some("Zeta".into()),
                        input_type: Some(".test.Empty".into()),
                        output_type: Some(".test.Empty".into()),
                        ..Default::default()
                    }],
                    ..Default::default()
                },
                ServiceDescriptorProto {
                    name: Some("Alpha".into()),
                    method: vec![
                        MethodDescriptorProto {
                            name: Some("Bar".into()),
                            input_type: Some(".test.Empty".into()),
                            output_type: Some(".test.Empty".into()),
                            client_streaming: Some(true),
                            server_streaming: Some(false),
                            ..Default::default()
                        },
                        MethodDescriptorProto {
                            name: Some("Foo".into()),
                            input_type: Some(".test.Empty".into()),
                            output_type: Some(".test.Empty".into()),
                            ..Default::default()
                        },
                    ],
                    ..Default::default()
                },
            ],
            ..Default::default()
        }
    }

    #[test]
    fn catalog_is_sorted_and_method_paths_correct() {
        let pool = build_pool(vec![simple_file_with_two_services()]).unwrap();
        let cat = build_catalog(&pool);
        assert_eq!(cat.services.len(), 2);
        assert_eq!(cat.services[0].full_name, "test.Alpha");
        assert_eq!(cat.services[1].full_name, "test.Beta");

        let alpha = &cat.services[0];
        assert_eq!(alpha.methods.len(), 2);
        assert_eq!(alpha.methods[0].name, "Bar");
        assert_eq!(alpha.methods[0].path, "/test.Alpha/Bar");
        assert!(alpha.methods[0].client_streaming);
        assert!(!alpha.methods[0].server_streaming);
        assert_eq!(alpha.methods[1].name, "Foo");
        assert_eq!(alpha.methods[1].path, "/test.Alpha/Foo");
        assert_eq!(alpha.methods[1].input_message, "test.Empty");
        assert_eq!(alpha.methods[1].output_message, "test.Empty");
    }
}
```

- [ ] **Step 3: Re-export через `grpc/mod.rs`**

Замени содержимое `crates/handshaker-core/src/grpc/mod.rs` на:

```rust
//! gRPC subsystem: target, transport, reflection, descriptors, catalog, connection orchestration.

pub mod catalog;
pub mod connection;
pub mod descriptor;
pub mod reflection;
pub mod transport;

pub use catalog::{MethodEntry, ServiceCatalog, ServiceEntry, build_catalog};
pub use connection::GrpcTarget;
pub use descriptor::build_pool;
pub use transport::{GrpcTransport, TonicChannel, TonicTransport};
```

- [ ] **Step 4: Запустить тесты**

Run:

```bash
cargo test -p handshaker-core grpc::catalog::
```

Expected: 1/1 passed.

- [ ] **Step 5: Commit**

```bash
git add crates/handshaker-core/src/grpc/catalog crates/handshaker-core/src/grpc/mod.rs
git commit -m "feat(core): ServiceCatalog projection from DescriptorPool"
```

---

### Task 9: GrpcConnection + activate() orchestration

**Files:**
- Modify: `crates/handshaker-core/src/grpc/connection.rs`
- Create: `crates/handshaker-core/src/grpc/contract.rs`
- Modify: `crates/handshaker-core/src/grpc/mod.rs`
- Create: `crates/handshaker-core/tests/contract_activate.rs`

- [ ] **Step 1: Расширить `connection.rs` — `GrpcConnection` struct**

Открой `crates/handshaker-core/src/grpc/connection.rs`. В конец файла (после `mod tests`) добавь:

```rust
use std::sync::Arc;

use crate::grpc::catalog::ServiceCatalog;

/// Live connection state — the result of `activate()`. Holds the channel-bearing transport
/// plus the assembled descriptor pool and projected catalog. **NOT** `Clone`: there's at most
/// one live connection in the app (per spec §4 "Activated gRPC connections = 1").
pub struct GrpcConnection {
    pub target: GrpcTarget,
    pub transport: Arc<dyn crate::grpc::GrpcTransport>,
    pub pool: prost_reflect::DescriptorPool,
    pub catalog: ServiceCatalog,
}

impl std::fmt::Debug for GrpcConnection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GrpcConnection")
            .field("target", &self.target)
            .field("services", &self.catalog.services.len())
            .finish()
    }
}
```

- [ ] **Step 2: Написать `contract.rs` — `activate()`**

Создай файл `crates/handshaker-core/src/grpc/contract.rs`:

```rust
//! Top-level orchestration: open channel → run reflection → build pool → build catalog.

use std::sync::Arc;

use crate::error::CoreError;
use crate::grpc::catalog::build_catalog;
use crate::grpc::connection::{GrpcConnection, GrpcTarget};
use crate::grpc::descriptor::build_pool;
use crate::grpc::reflection::list_and_fetch_files;
use crate::grpc::transport::GrpcTransport;

/// Open a channel to `target`, retrieve the contract via reflection (v1 → v1alpha fallback),
/// and return a ready-to-use `GrpcConnection`.
pub async fn activate(
    target: GrpcTarget,
    transport: Arc<dyn GrpcTransport>,
) -> Result<GrpcConnection, CoreError> {
    let channel = transport.channel(&target).await?;
    let (_services_listed, files) = list_and_fetch_files(channel).await?;
    let pool = build_pool(files)?;
    let catalog = build_catalog(&pool);
    Ok(GrpcConnection {
        target,
        transport,
        pool,
        catalog,
    })
}
```

- [ ] **Step 3: Подключить в `grpc/mod.rs`**

Замени содержимое `crates/handshaker-core/src/grpc/mod.rs` на:

```rust
//! gRPC subsystem: target, transport, reflection, descriptors, catalog, connection orchestration.

pub mod catalog;
pub mod connection;
pub mod contract;
pub mod descriptor;
pub mod reflection;
pub mod transport;

pub use catalog::{MethodEntry, ServiceCatalog, ServiceEntry, build_catalog};
pub use connection::{GrpcConnection, GrpcTarget};
pub use contract::activate;
pub use descriptor::build_pool;
pub use transport::{GrpcTransport, TonicChannel, TonicTransport};
```

- [ ] **Step 4: End-to-end integration test**

Создай файл `crates/handshaker-core/tests/contract_activate.rs`:

```rust
mod common;

use std::sync::Arc;

use handshaker_core::grpc::{activate, GrpcTarget, TonicTransport};

#[tokio::test]
async fn activate_against_v1_server_yields_catalog() {
    let (addr, _shutdown) = common::spawn_reflection_server_v1().await;
    let target = GrpcTarget::new(addr.to_string(), false, false).unwrap();
    let transport = Arc::new(TonicTransport::new());

    let conn = activate(target, transport).await.expect("activate");

    assert!(conn.catalog.services.iter().any(|s| s.full_name == "test.Echo"));
    let echo = conn
        .catalog
        .services
        .iter()
        .find(|s| s.full_name == "test.Echo")
        .unwrap();
    assert_eq!(echo.methods.len(), 1);
    assert_eq!(echo.methods[0].path, "/test.Echo/Send");
    // Smoke: the pool resolves the input message.
    assert!(conn.pool.get_message_by_name("test.Ping").is_some());
}

#[tokio::test]
async fn activate_against_v1alpha_server_falls_back_and_succeeds() {
    let (addr, _shutdown) = common::spawn_reflection_server_v1alpha().await;
    let target = GrpcTarget::new(addr.to_string(), false, false).unwrap();
    let transport = Arc::new(TonicTransport::new());

    let conn = activate(target, transport).await.expect("activate w/ fallback");

    assert!(conn.catalog.services.iter().any(|s| s.full_name == "test.Echo"));
}
```

- [ ] **Step 5: Запустить тесты**

Run:

```bash
cargo test -p handshaker-core --test contract_activate
```

Expected: 2/2 passed.

- [ ] **Step 6: Full workspace test gate**

Run:

```bash
cargo test -p handshaker-core
```

Expected: ALL pass — все unit + integration тесты handshaker-core.

- [ ] **Step 7: Commit**

```bash
git add crates/handshaker-core/src/grpc/connection.rs crates/handshaker-core/src/grpc/contract.rs crates/handshaker-core/src/grpc/mod.rs crates/handshaker-core/tests/contract_activate.rs
git commit -m "feat(core): activate(target) — channel → reflection → pool → catalog"
```

---

### Task 10: Tauri commands + events + state

**Files:**
- Modify: `src-tauri/src/state.rs`
- Create: `src-tauri/src/commands/grpc.rs`
- Create: `src-tauri/src/commands/events.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/commands/meta.rs` (remove `AppReady`)
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Расширить `state.rs`**

Замени содержимое `src-tauri/src/state.rs` на:

```rust
//! Tauri-side app state. Fields land per plans #2-#6.

use std::sync::Arc;

use handshaker_core::grpc::GrpcConnection;
use tokio::sync::Mutex;

#[derive(Default)]
pub struct AppState {
    /// At most one active gRPC connection per spec §4.
    pub connection: Mutex<Option<Arc<GrpcConnection>>>,
    // plan #5: pub env_store: Arc<dyn EnvironmentStore>,
    // plan #6: pub collection_store: Arc<dyn CollectionStore>,
}
```

- [ ] **Step 2: Определить события**

Создай файл `src-tauri/src/commands/events.rs`:

```rust
//! Tauri-specta events emitted by the gRPC subsystem.

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri_specta::Event;

/// Emitted whenever the active connection's contract has been (re)built.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct ContractUpdated {
    /// Stable key identifying the target whose contract just refreshed.
    pub target_key: String,
}

/// Emitted on connect / disconnect.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct ConnectionStateChanged {
    pub connected: bool,
    pub target: Option<TargetSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct TargetSummary {
    pub address: String,
    pub tls: bool,
    pub skip_verify: bool,
}

impl From<&handshaker_core::grpc::GrpcTarget> for TargetSummary {
    fn from(t: &handshaker_core::grpc::GrpcTarget) -> Self {
        Self {
            address: t.address.clone(),
            tls: t.tls,
            skip_verify: t.skip_verify,
        }
    }
}
```

- [ ] **Step 3: Имплементировать gRPC команды**

Создай файл `src-tauri/src/commands/grpc.rs`:

```rust
//! gRPC commands — thin wrappers around `handshaker_core::grpc::*`. NO business logic.

use std::sync::Arc;

use handshaker_core::grpc::{activate, GrpcTarget, ServiceCatalog, TonicTransport};
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Manager, State};
use tauri_specta::Event;

use crate::commands::events::{ConnectionStateChanged, ContractUpdated, TargetSummary};
use crate::ipc::IpcError;
use crate::state::AppState;

#[derive(Debug, Deserialize, Type)]
pub struct ConnectInput {
    pub address: String,
    pub tls: bool,
    pub skip_verify: bool,
}

#[derive(Debug, Serialize, Type)]
pub struct ConnectOutcome {
    pub target: TargetSummary,
    pub catalog: ServiceCatalog,
}

fn target_key(t: &GrpcTarget) -> String {
    format!(
        "{}|tls={}|skip_verify={}",
        t.address, t.tls, t.skip_verify
    )
}

#[tauri::command]
#[specta::specta]
pub async fn grpc_connect(
    app: AppHandle,
    state: State<'_, AppState>,
    input: ConnectInput,
) -> Result<ConnectOutcome, IpcError> {
    let target = GrpcTarget::new(input.address, input.tls, input.skip_verify)?;
    let transport = Arc::new(TonicTransport::new());

    let conn = activate(target.clone(), transport).await?;
    let summary: TargetSummary = (&conn.target).into();
    let key = target_key(&conn.target);
    let catalog = conn.catalog.clone();

    {
        let mut slot = state.connection.lock().await;
        *slot = Some(Arc::new(conn));
    }

    ContractUpdated {
        target_key: key.clone(),
    }
    .emit(&app)
    .ok();
    ConnectionStateChanged {
        connected: true,
        target: Some(summary.clone()),
    }
    .emit(&app)
    .ok();

    Ok(ConnectOutcome {
        target: summary,
        catalog,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn grpc_disconnect(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let mut slot = state.connection.lock().await;
    *slot = None;
    ConnectionStateChanged {
        connected: false,
        target: None,
    }
    .emit(&app)
    .ok();
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn grpc_refresh_contract(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ServiceCatalog, IpcError> {
    let target = {
        let slot = state.connection.lock().await;
        let conn = slot.as_ref().ok_or(IpcError::NotConnected)?;
        conn.target.clone()
    };

    let transport = Arc::new(TonicTransport::new());
    let conn = activate(target.clone(), transport).await?;
    let catalog = conn.catalog.clone();
    let key = target_key(&conn.target);

    {
        let mut slot = state.connection.lock().await;
        *slot = Some(Arc::new(conn));
    }

    ContractUpdated { target_key: key }.emit(&app).ok();
    Ok(catalog)
}

// Smoke unit tests — we can't easily spin a Tauri app in cargo test, so only test
// the pure helper.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn target_key_is_stable_for_equivalent_target() {
        let a = GrpcTarget::new("api.prod:8443", true, false).unwrap();
        let b = GrpcTarget::new("api.prod:8443", true, false).unwrap();
        assert_eq!(target_key(&a), target_key(&b));
    }

    #[test]
    fn target_key_differs_on_tls_flag() {
        let a = GrpcTarget::new("api.prod:8443", true, false).unwrap();
        let b = GrpcTarget::new("api.prod:8443", false, false).unwrap();
        assert_ne!(target_key(&a), target_key(&b));
    }
}
```

- [ ] **Step 4: Зарегистрировать новые модули в `commands/mod.rs`**

Замени содержимое `src-tauri/src/commands/mod.rs` на:

```rust
pub mod events;
pub mod grpc;
pub mod meta;
```

- [ ] **Step 5: Убрать `AppReady` из `meta.rs` (заменяется на реальные события)**

Замени содержимое `src-tauri/src/commands/meta.rs` на:

```rust
use specta::Type;

/// Smoke-command: returns version from Cargo.toml. Proves tauri-specta wiring works.
#[tauri::command]
#[specta::specta]
pub fn app_version() -> AppVersion {
    AppVersion {
        version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

#[derive(serde::Serialize, Type)]
pub struct AppVersion {
    pub version: String,
}
```

(`AppReady` удалён. Если фронтенду нужен сигнал "app ready" — он сам узнаёт по успешному ответу первой команды.)

- [ ] **Step 6: Зарегистрировать команды + события в `lib.rs`**

Замени содержимое `src-tauri/src/lib.rs` на:

```rust
//! Handshaker Tauri shell library.

pub mod commands;
pub mod ipc;
mod state;

use commands::events::{ConnectionStateChanged, ContractUpdated};
use commands::grpc::{grpc_connect, grpc_disconnect, grpc_refresh_contract};
use commands::meta::app_version;
use specta_typescript::Typescript;
use state::AppState;
use tauri_specta::{collect_commands, collect_events, Builder};

/// Build a `tauri_specta::Builder` populated with every command and event the
/// app exposes. Used by both `run()` and the `export-bindings` helper binary.
pub fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            app_version,
            grpc_connect,
            grpc_disconnect,
            grpc_refresh_contract,
        ])
        .events(collect_events![ContractUpdated, ConnectionStateChanged])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Install rustls' default crypto provider once at process start. tonic 0.14 with
    // `tls-ring` does NOT install it automatically; without this the first TLS handshake
    // panics with "no process-level CryptoProvider available".
    rustls::crypto::ring::default_provider()
        .install_default()
        .expect("install rustls ring provider");

    let specta_builder = specta_builder();

    #[cfg(debug_assertions)]
    {
        let out = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("src")
            .join("ipc")
            .join("bindings.ts");
        specta_builder
            .export(
                Typescript::default()
                    .formatter(specta_typescript::formatter::prettier)
                    .header(
                        "// @ts-nocheck\n\
                         // AUTO-GENERATED by tauri-specta. Do NOT edit.\n",
                    ),
                &out,
            )
            .expect("failed to export tauri-specta bindings");
    }

    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(specta_builder.invoke_handler())
        .setup(move |app| {
            specta_builder.mount_events(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 7: Добавить `rustls` в `src-tauri/Cargo.toml`**

Открой `src-tauri/Cargo.toml`. В блок `[dependencies]` добавь:

```toml
rustls = { version = "0.23", default-features = false, features = ["ring"] }
```

(`default-features = false` — отключаем `aws-lc-rs` default, оставляем только `ring`, который согласован с tonic feature `tls-ring`.)

- [ ] **Step 8: Регенерация bindings**

Run:

```bash
cargo run -p handshaker --bin export-bindings --quiet
```

Expected: `src/ipc/bindings.ts` пере-записан и содержит `grpcConnect`, `grpcDisconnect`, `grpcRefreshContract`, события `ContractUpdated`, `ConnectionStateChanged` и тип `ConnectInput`, `ConnectOutcome`, `TargetSummary`, `ServiceCatalog`, etc.

Sanity-check глазами: открой `src/ipc/bindings.ts` и убедись что эти имена там присутствуют.

- [ ] **Step 9: Сборка src-tauri**

Run:

```bash
cargo build -p handshaker
```

Expected: PASS. Если есть warning'и о неиспользуемом — оставь, fix-style edits — отдельно.

- [ ] **Step 10: Тесты грубо**

Run:

```bash
cargo test -p handshaker
```

Expected: PASS — unit тест `target_key_*` зелёный, существующие IpcError тесты зелёные.

- [ ] **Step 11: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/state.rs src-tauri/src/commands src-tauri/src/lib.rs src/ipc/bindings.ts
git commit -m "feat(tauri): grpc_connect/disconnect/refresh + ContractUpdated/ConnectionStateChanged events"
```

---

### Task 11: Frontend smoke — Connect panel + Catalog list

**Files:**
- Modify: `src/App.tsx`
- Create: `src/features/connect/ConnectPanel.tsx`
- Create: `src/features/connect/CatalogList.tsx`
- Modify: `src/ipc/client.ts`
- Create: `src/ipc/events.ts`
- Run: `pnpm dlx shadcn@latest add input` (adds `src/components/ui/input.tsx`)

- [ ] **Step 1: Установить shadcn Input**

Run:

```bash
pnpm dlx shadcn@latest add input
```

Expected: создаётся `src/components/ui/input.tsx`. Если pnpm dlx ругается на peer deps — добавь руками: `pnpm add @radix-ui/react-slot` уже стоит из Plan #1.

- [ ] **Step 2: Расширить `src/ipc/client.ts` — типизированные обёртки**

Замени содержимое `src/ipc/client.ts` на:

```ts
import { commands } from "./bindings";
import type {
  ConnectInput,
  ConnectOutcome,
  ServiceCatalog,
} from "./bindings";

/**
 * Thin typed wrapper layer. We unwrap `Result<T, IpcError>` from tauri-specta
 * here so feature code can use `await` directly and catch errors via try/catch.
 */

export async function appVersion(): Promise<string> {
  const r = await commands.appVersion();
  return r.version;
}

export async function grpcConnect(input: ConnectInput): Promise<ConnectOutcome> {
  const r = await commands.grpcConnect(input);
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function grpcDisconnect(): Promise<void> {
  const r = await commands.grpcDisconnect();
  if (r.status === "error") throw r.error;
}

export async function grpcRefreshContract(): Promise<ServiceCatalog> {
  const r = await commands.grpcRefreshContract();
  if (r.status === "error") throw r.error;
  return r.data;
}

export const ipc = {
  appVersion,
  grpcConnect,
  grpcDisconnect,
  grpcRefreshContract,
};
```

**Note:** tauri-specta v2 returns `Result` as `{ status: "ok", data } | { status: "error", error }`. If the generated shape in `bindings.ts` differs (older `2.0.0-rc.21` patterns sometimes throw directly), inspect `bindings.ts` after Task 10 Step 8 and adjust the unwrap accordingly. The principle: feature code uses `try/catch` with a typed `IpcError` exception.

- [ ] **Step 3: Создать `events.ts`**

Создай файл `src/ipc/events.ts`:

```ts
import { events } from "./bindings";
import type { ConnectionStateChanged, ContractUpdated } from "./bindings";

/** Subscribe to backend events. Returns an unlisten function. */
export function onConnectionStateChanged(
  handler: (e: ConnectionStateChanged) => void,
): Promise<() => void> {
  return events.connectionStateChanged.listen((evt) => handler(evt.payload));
}

export function onContractUpdated(
  handler: (e: ContractUpdated) => void,
): Promise<() => void> {
  return events.contractUpdated.listen((evt) => handler(evt.payload));
}
```

- [ ] **Step 4: Создать `ConnectPanel.tsx`**

Создай файл `src/features/connect/ConnectPanel.tsx`:

```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ipc } from "@/ipc/client";
import type { ServiceCatalog } from "@/ipc/bindings";

export interface ConnectPanelProps {
  onConnected: (catalog: ServiceCatalog) => void;
  onDisconnected: () => void;
  connected: boolean;
}

export function ConnectPanel(props: ConnectPanelProps) {
  const [address, setAddress] = useState("");
  const [tls, setTls] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConnect() {
    setBusy(true);
    setError(null);
    try {
      const outcome = await ipc.grpcConnect({
        address,
        tls,
        skip_verify: false,
      });
      props.onConnected(outcome.catalog);
    } catch (e: unknown) {
      // e is an IpcError tagged union
      const tagged = e as { type?: string; message?: string };
      setError(
        tagged.message ?? tagged.type ?? "unknown error (see console)",
      );
      console.error("grpc_connect failed:", e);
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    try {
      await ipc.grpcDisconnect();
      props.onDisconnected();
    } catch (e) {
      console.error("grpc_disconnect failed:", e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 max-w-xl">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="px-2 py-1 rounded border border-border text-sm hover:bg-accent"
          onClick={() => setTls((v) => !v)}
          disabled={busy || props.connected}
          aria-label="Toggle TLS"
        >
          {tls ? "🔒 TLS" : "🔓 plaintext"}
        </button>
        <Input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="host:port (e.g. api.prod:8443)"
          disabled={busy || props.connected}
          className="font-mono"
        />
        {props.connected ? (
          <Button
            onClick={handleDisconnect}
            disabled={busy}
            variant="secondary"
          >
            Disconnect
          </Button>
        ) : (
          <Button
            onClick={handleConnect}
            disabled={busy || address.length === 0}
          >
            {busy ? "Connecting…" : "Connect"}
          </Button>
        )}
      </div>
      {error && (
        <div className="text-sm text-destructive font-mono break-words">
          {error}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Создать `CatalogList.tsx`**

Создай файл `src/features/connect/CatalogList.tsx`:

```tsx
import type { ServiceCatalog } from "@/ipc/bindings";

export interface CatalogListProps {
  catalog: ServiceCatalog;
}

export function CatalogList({ catalog }: CatalogListProps) {
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
            {s.methods.map((m) => (
              <li key={m.path}>
                {m.name}
                <span className="text-xs ml-2">
                  ({m.input_message} → {m.output_message})
                </span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 6: Перепаять `App.tsx`**

Замени содержимое `src/App.tsx` на:

```tsx
import { useEffect, useState } from "react";
import { ConnectPanel } from "@/features/connect/ConnectPanel";
import { CatalogList } from "@/features/connect/CatalogList";
import {
  onConnectionStateChanged,
  onContractUpdated,
} from "@/ipc/events";
import { ipc } from "@/ipc/client";
import type { ServiceCatalog } from "@/ipc/bindings";

export default function App() {
  const [catalog, setCatalog] = useState<ServiceCatalog | null>(null);
  const [connected, setConnected] = useState(false);
  const [version, setVersion] = useState("");

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

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="px-6 py-3 border-b border-border flex items-center justify-between">
        <h1 className="text-base font-semibold">Handshaker</h1>
        <span className="text-xs text-muted-foreground font-mono">
          v{version}
        </span>
      </header>
      <section className="p-6 flex flex-col gap-6">
        <ConnectPanel
          connected={connected}
          onConnected={(c) => setCatalog(c)}
          onDisconnected={() => setCatalog(null)}
        />
        {catalog && <CatalogList catalog={catalog} />}
      </section>
    </main>
  );
}
```

- [ ] **Step 7: TS lint**

Run:

```bash
pnpm lint
```

Expected: PASS. Если ругается на missing types — проверь, что `src/ipc/bindings.ts` сгенерирован и содержит экспорты `ConnectInput`, `ConnectOutcome`, `ServiceCatalog`, `ContractUpdated`, `ConnectionStateChanged`.

- [ ] **Step 8: Vite build**

Run:

```bash
pnpm build
```

Expected: PASS (TS + Vite production build).

- [ ] **Step 9: Manual smoke — запустить dev и проверить против локального reflection-сервера**

Run in терминал #1 (in-process reflection server):

```bash
cargo test -p handshaker-core --test reflection_v1 -- --nocapture --ignored
```

Если у тебя нет идущего gRPC-сервера под рукой — можешь временно адаптировать один из integration test файлов как **long-running stub**, либо использовать реальный сервер вашей команды.

Run terminal #2:

```bash
pnpm tauri:dev
```

В окне:
1. Видишь header с версией и пустой Connect panel.
2. Введи адрес stub-сервера (например, `127.0.0.1:<port>` из stdout test stub).
3. Сними галку TLS (🔒 → 🔓).
4. Нажми Connect → busy → появляется список `test.Echo` / `Send (test.Ping → test.Pong)`.
5. Нажми Disconnect → каталог исчезает.

Дополнительно (если у вас есть реальный TLS gRPC-сервер с reflection):
6. Введи `host:port`, оставь TLS включённым.
7. Нажми Connect → список реальных сервисов.

Если что-то не работает — открой DevTools (`Cmd/Ctrl+Shift+I`) и смотри console + network.

- [ ] **Step 10: Commit**

```bash
git add src/App.tsx src/features/connect src/ipc/client.ts src/ipc/events.ts src/components/ui/input.tsx package.json pnpm-lock.yaml
git commit -m "feat(ui): connect panel + catalog list — wire reflection spine to frontend"
```

---

## Final verification

После всех 11 задач:

- [ ] **Полный гейт тестов**:

```bash
cargo test --workspace
pnpm lint && pnpm build
```

Expected: ALL pass.

- [ ] **Manual end-to-end smoke** (Task 11 Step 9 уже включает это, но повторим):
  - Подними in-process reflection server.
  - `pnpm tauri:dev`.
  - Connect → видишь catalog.
  - Disconnect → catalog очищен.
  - Re-connect — повторно работает.

- [ ] **Артефакты безопасности**:
  - Никаких токенов в commits.
  - `src-tauri/capabilities/default.json` остался least-privilege (`["core:default"]`) — мы не добавляли новых permissions, потому что наши команды — `#[tauri::command]`-функции, которые не требуют дополнительных capabilities.

- [ ] **Чеклист соответствия spec** (для финального code review):
  - [ ] §4 «Active gRPC connections = 1» → `Mutex<Option<Arc<GrpcConnection>>>` в `AppState`.
  - [ ] §4 «DescriptorPool — single source of truth» → каталог это projection того же пула, который пойдёт в Plan #3 для invoke.
  - [ ] §4 «Reflection v1 → v1alpha fallback, bidi» → `reflection/fallback.rs`.
  - [ ] §4 «Reflection auth — без auth» → не подключаем `AuthProvider` в `activate()`.
  - [ ] §6.2 commands: `grpc_connect`, `grpc_disconnect`, `grpc_refresh_contract` ✓.
  - [ ] §6.3 events: `ContractUpdated`, `ConnectionStateChanged` ✓.
  - [ ] §6.4 `IpcError` — все нужные варианты уже есть с Plan #1.
  - [ ] Spec rule 1 «Clean, OS-independent core» → `handshaker-core` не зависит от Tauri/dirs/keyring ✓.
  - [ ] Spec rule 2 «Thin Tauri layer» → команды чисто wrap-эры ✓.
  - [ ] Spec rule 3 «Reflection v1 + v1alpha fallback» ✓.
  - [ ] Spec rule 4 «Transport abstraction» → `GrpcTransport` trait, tonic типы только в `tonic_impl` + `reflection/v1.rs` + `reflection/v1alpha.rs` ✓.
  - [ ] Spec rule 5 «Dynamic unary invoke» — **out of scope** для Plan #2, переходит в Plan #3.
  - [ ] Spec rule 6 «Auto-authorization» — **out of scope** для Plan #2 (reflection без auth по спеке).
  - [ ] Spec rule 7 «Thin frontend» → UI просто рендерит ответ команд ✓.
  - [ ] Spec rule 8 «Typed IPC contract» → tauri-specta regenerated ✓.
  - [ ] Spec rule 9 «Least privilege» → capabilities не расширяли ✓.
  - [ ] Spec rule 10 «Cross-platform edges»:
    - Paths: не пишем на диск в Plan #2.
    - Secrets: не работаем с секретами.
    - rustls crypto provider init в `lib.rs` — кроссплатформенно идентичный.
  - [ ] Memory `feedback_ui_transparent_mechanics`: UI показывает только то, что нужно (адрес + список сервисов + ошибки). Никаких "engine internals" в виде кеш-индикаторов / auth-статусов — этого добра тут просто нет ещё.

---

## Next plan preview

После завершения Plan #2:
- **Plan #3 — Dynamic unary invoke**: `DynamicCodec`, `unary_dynamic` в transport, `grpc_invoke_unary` команда, frontend Send/Response panel с Monaco. Здесь же — `skip_verify=true` через hyper-rustls connector если нужно.
- **Plan #4 — Variables + Resolver + Environments**.
- **Plan #5 — Auth (EnvVar bearer)**.
- **Plan #6 — Collections + ContractCache**.
- **Plan #7-#8 — Frontend MVP (sidebar, method picker, full request/response UI)**.
