# Handshaker — MVP Design Spec

**Дата:** 2026-05-26
**Статус:** проект, до утверждения пользователем
**Бранч:** `claude/zealous-mayer-dfa9b5`

---

## 1. Продукт

**Handshaker** — кроссплатформенный desktop-клиент (macOS + Windows) для внутренних gRPC-сервисов. Tagline: *«pull the handles — we'll handle the handshake»*.

Ключевые отличия от Postman:

- Контракт сервиса подтягивается автоматически через **gRPC Server Reflection** — никаких локальных `.proto`.
- При клике на сохранённый запрос контракт **автоматически освежается** при изменении target — то, что в Postman приходится делать руками.
- Авто-получение и **on-demand refresh** Bearer-токена (OAuth2 client_credentials) per-env конфиг на любом узле.

Один активный gRPC-коннекшен в окне за раз. Unary RPC в MVP; streaming, HTTP-клиент, импорт/экспорт коллекций — в next-step.

### Spine продукта (что чинить первым)

1. Юзер вводит произвольный `host:port` → Connect.
2. Reflection (v1 → v1alpha fallback) собирает FileDescriptorSet, сборка → `prost-reflect::DescriptorPool`.
3. Юзер выбирает метод через method picker (hybrid tree + search).
4. Заполняет JSON body, нажимает Send.
5. Получает status + response JSON + trailing metadata.

Всё остальное (коллекции, env, OAuth2) — слои поверх spine.

---

## 2. Архитектура

### 2.1 Workspace

```
handshaker/
├── Cargo.toml                 # workspace, resolver="2"
├── crates/
│   └── handshaker-core/       # OS-независимое ядро; без tonic-типов наружу
└── src-tauri/                 # Tauri-обвязка, тонкие command-обёртки
```

Frontend (`src/`) — на верхнем уровне рядом с `src-tauri/` (стандартный layout Tauri).

### 2.2 Принципы

- **SRP**: каждый модуль / тип / функция делает ровно одну вещь.
- **KISS**: вводим абстракцию только когда без неё больно. Никаких trait’ов «на будущее».
- **Core OS-independent**: `handshaker-core` не знает о Tauri, путях, keyring, browser. Платформенное — только в `src-tauri`.
- **Transport-abstraction**: tonic используется только внутри `grpc/transport/tonic_impl`. Остальной core зависит от trait’а `GrpcTransport` — облегчает миграцию на CNCF `grpc` crate в будущем.
- **Никаких codegen-stub’ов для целевых сервисов**: вся работа через `DescriptorPool` + `DynamicMessage`.

---

## 3. Layout `handshaker-core`

```
crates/handshaker-core/src/
├── lib.rs
├── error.rs                   # CoreError enum (единый для core)
├── env/
│   ├── mod.rs                 # Environment, EnvironmentStore (trait)
│   └── in_memory.rs           # InMemoryEnvironmentStore (MVP)
├── resolver/
│   ├── mod.rs                 # VariableSet, resolve()
│   └── tests.rs               # multi-pass + cycle detection
├── auth/
│   ├── mod.rs                 # AuthProvider trait, AuthCredentials, BearerAuthProvider
│   ├── factory.rs             # build_provider(SavedAuthConfig, cache) -> AuthProvider
│   ├── token_source.rs        # trait TokenSource + AuthContext
│   ├── static_source.rs       # EnvVar TokenSource (MVP)
│   ├── token_cache/
│   │   ├── mod.rs             # trait TokenCache
│   │   └── in_memory.rs       # InMemoryTokenCache (concurrent-safe)
│   └── oauth2/
│       ├── mod.rs             # next-step OAuth2 TokenSource skeleton
│       └── client_credentials.rs
├── collections/
│   ├── mod.rs                 # Collection, Folder, SavedRequest, Item enum, AuthByEnv
│   ├── ids.rs                 # CollectionId, ItemId (UUID v7 wrappers)
│   ├── resolution.rs          # resolve_request(item, ancestors, env) -> EffectiveRequest
│   ├── in_memory.rs           # InMemoryCollectionStore (MVP)
│   ├── file_store.rs          # next-step: per-collection JSON files
│   └── io/                    # next-step: native + postman_v21 import/export skeletons
├── grpc/
│   ├── mod.rs
│   ├── connection.rs          # GrpcTarget, GrpcConnection (одна на app state)
│   ├── transport/
│   │   ├── mod.rs             # GrpcTransport trait
│   │   ├── tonic_impl.rs      # TonicTransport (единственная имплементация в MVP)
│   │   └── skip_verify.rs     # rustls custom ServerCertVerifier для skip_verify
│   ├── descriptor/
│   │   ├── mod.rs             # сборка FileDescriptorProto[] → DescriptorPool
│   │   └── tests.rs           # transitive deps, дубликаты, циклы
│   ├── reflection/
│   │   ├── mod.rs
│   │   ├── proto.rs           # Re-export типов из tonic-reflection
│   │   ├── codec.rs           # streaming-codec
│   │   ├── stream.rs          # bidi-streaming client: list_services, file_by_symbol
│   │   └── fallback.rs        # v1 → v1alpha
│   ├── invoke/
│   │   ├── mod.rs             # invoke_unary(...)
│   │   ├── codec.rs           # DynamicCodec (Encode=Decode=DynamicMessage)
│   │   ├── path.rs            # /package.Service/Method
│   │   └── metadata.rs        # apply auth + custom metadata, lowercase keys
│   ├── catalog/
│   │   ├── mod.rs             # ServiceCatalog: services -> methods -> MessageSchema
│   │   └── build.rs           # build_catalog(&DescriptorPool)
│   ├── contract.rs            # activate(target) -> (DescriptorPool, ServiceCatalog)
│   └── contract_cache/
│       ├── mod.rs             # trait ContractCache
│       └── in_memory.rs       # InMemoryContractCache (key = resolved target + tls)
└── http/
    ├── mod.rs                 # next-step
    ├── client.rs              # trait HttpClient (post_form)
    └── client_reqwest.rs      # next-step
```

---

## 4. Зафиксированные решения

| Тема | Решение |
|---|---|
| Активных gRPC-коннекшенов | Один. `Option<GrpcConnection>` в Tauri State. |
| Контракт за один раз | `DescriptorPool` — единый источник правды для reflection и invoke. |
| Reflection | v1 (`grpc.reflection.v1.ServerReflection`) → v1alpha fallback. Bidi-streaming. |
| Reflection auth | Без auth — reflection всегда unauthenticated. |
| Invoke auth | `AuthProvider` инжектит metadata. |
| Metadata case | Auto-lowercase ключей перед отправкой (HTTP/2, matches grpc-go / grpc-dart). |
| Initial metadata | Не показываем в UI. |
| Trailing metadata | Показываем в Response Trailers таб. |
| Target (saved) | Нет типа `SavedTarget`. Адрес — text-template с `{{var}}` в `SavedRequest.address_template`. На транспортном уровне резолвится в `GrpcTarget { address, tls, skip_verify }`. Никакого inheritance для address. |
| Environments | `EnvironmentStore` trait + `InMemoryEnvironmentStore`; одна «Default» env в MVP. |
| Active env | Глобальное состояние; влияет на variable resolution и auth выбор. |
| {{var}} resolver | Multi-pass (limit=4), priority `env > collection`, values only, cycle detection. |
| Variable scope | env-scope + collection-scope. Per-folder/per-request variables — нет. |
| Auth model | `AuthByEnv { configs: HashMap<env_name, SavedAuthConfig> }` на Collection / Folder / Request с inheritance (nearest `Some` wins). |
| Auth types | `None`, `EnvVar`, `OAuth2(ClientCredentials)`. |
| Token refresh | **Lazy on-demand**: при invoke если `now >= expires_at` — refresh, потом запрос. Без proactive timers. |
| Token storage | env var name в файле коллекции; значение читается из `std::env`. (MVP-техдолг: значение живёт in-memory plaintext; keyring — next-step.) |
| Collection hierarchy | Postman-style recursive `Item` (Folder \| Request). Глубина не ограничена. |
| Saved responses | Не моделируем. |
| TLS | bool per-Request с inheritance от Collection (default `true`). |
| TLS skip-verify | bool per-Collection (rustls custom ServerCertVerifier, помечен как unsafe в UI). |
| Persistence | Архитектурный placeholder: per-collection JSON `<data_dir>/handshaker/collections/<uuid>.json` (atomic temp+rename). **Не реализуем в MVP** — `InMemoryCollectionStore`. |
| HTTP backend | Архитектурный placeholder. Импл — next-step. |
| Contract auto-refresh | Click на saved request → resolve ancestors → проверить ContractCache → hit или reflection. Кнопка «Refresh contract» — manual. |
| Sidebar | Только Collections. Reflected services — через method picker dropdown в main pane. |
| Window layout | Postman-style: sidebar (Collections) \| main pane (Request top → Response bottom, vertical split). |
| Main pane content | Selection-driven: Collection / Folder / Request → разные секции. |
| Theme | dark-only, без toggle. Shadcn new-york OKLCH палитра. Light mode — next-step. |

---

## 5. Модели данных (Rust)

### 5.1 Errors

```rust
#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("invalid target: {0}")]
    InvalidTarget(String),
    #[error("not connected")]
    NotConnected,
    #[error("reflection disabled on server: {hint}")]
    ReflectionDisabled { hint: String },
    #[error("reflection error: {0}")]
    Reflection(String),
    #[error("descriptor build failed: {0}")]
    DescriptorBuild(String),
    #[error("service not found: {service}")]
    ServiceNotFound { service: String },
    #[error("method not found: {service}/{method}")]
    MethodNotFound { service: String, method: String },
    #[error("encode request failed: {0}")]
    EncodeRequest(String),
    #[error("decode response failed: {0}")]
    DecodeResponse(String),
    #[error("unresolved variable: {name}")]
    UnresolvedVariable { name: String },
    #[error("variable cycle: chain {chain:?}")]
    VariableCycle { chain: Vec<String> },
    #[error("transport error: {0}")]
    Transport(String),
    #[error("auth error: {0}")]
    Auth(String),
    #[error("gRPC status {code}: {message}")]
    GrpcStatus { code: i32, message: String },
    #[error("not implemented (MVP): {0}")]
    NotImplemented(String),
}
```

### 5.2 Environment + Variables

```rust
pub struct Environment {
    pub name: String,            // unique, [a-zA-Z_][a-zA-Z0-9_-]*
    pub variables: HashMap<String, String>,
}

pub trait EnvironmentStore: Send + Sync {
    fn list(&self) -> Vec<Environment>;
    fn get(&self, name: &str) -> Option<Environment>;
    fn upsert(&self, env: Environment) -> Result<(), CoreError>;
    fn delete(&self, name: &str) -> Result<(), CoreError>;
}

pub struct VariableSet<'a> {
    pub env: &'a HashMap<String, String>,
    pub collection: &'a HashMap<String, String>,
}

/// Multi-pass resolver, limit=4, cycle detection.
pub fn resolve(template: &str, vars: &VariableSet) -> Result<String, CoreError>;
```

Resolver:
- Регэксп `\{\{([a-zA-Z_][a-zA-Z0-9_-]*)\}\}`.
- Up to 4 passes. На каждом проходе если ни одна подстановка не сработала — выходим.
- Если после 4-х проходов остались `{{...}}` — `CoreError::VariableCycle`.
- Если переменная не найдена ни в env ни в collection — `CoreError::UnresolvedVariable`.
- Priority: env > collection (env-значение перекрывает одноимённое collection).

### 5.3 Auth

```rust
pub enum SavedAuthConfig {
    None,
    EnvVar(EnvVarAuthConfig),
    OAuth2ClientCredentials(OAuth2ClientCredentialsConfig),
}

pub struct EnvVarAuthConfig {
    pub env_var: String,         // e.g. "HANDSHAKER_PROD_TOKEN"
    pub header_name: String,     // default "authorization"
    pub prefix: String,          // default "Bearer "
}

pub struct OAuth2ClientCredentialsConfig {
    pub token_endpoint: String,
    pub client_id: String,
    pub client_secret_var: String,  // env var NAME, не plaintext
    pub scope: Option<String>,
    pub extra_form_params: HashMap<String, String>,
    pub header_name: String,        // default "authorization"
    pub prefix: String,             // default "Bearer "
}

pub struct AuthByEnv {
    pub configs: HashMap<String, SavedAuthConfig>,
}

pub struct AuthCredentials {
    pub header_name: String,
    pub header_value: String,
}

pub struct AuthContext<'a> {
    pub env_name: &'a str,
    pub config: &'a SavedAuthConfig,
}

#[async_trait::async_trait]
pub trait TokenSource: Send + Sync {
    async fn get_token(&self, ctx: &AuthContext<'_>) -> Result<String, CoreError>;
    async fn force_refresh(&self, ctx: &AuthContext<'_>) -> Result<String, CoreError>;
}

pub struct CachedToken {
    pub token: String,
    pub expires_at: std::time::Instant,
}

pub trait TokenCache: Send + Sync {
    fn get(&self, key: &str) -> Option<CachedToken>;
    fn put(&self, key: String, value: CachedToken);
    fn invalidate(&self, key: &str);
}

#[async_trait::async_trait]
pub trait AuthProvider: Send + Sync {
    async fn credentials(&self, env_name: &str) -> Result<Option<AuthCredentials>, CoreError>;
}

pub struct BearerAuthProvider {
    auth_by_env: AuthByEnv,
    source: Arc<dyn TokenSource>,
    cache: Arc<dyn TokenCache>,
}
```

### 5.4 Token refresh (lazy on-demand)

**MVP**: `OAuth2ClientCredentialsSource::get_token` возвращает `CoreError::NotImplemented` — HTTP backend ещё нет (next-step). Логика, которая будет реализована вместе с HTTP-клиентом:

```rust
// inside OAuth2ClientCredentialsSource::get_token (next-step impl)
let key = cache_key(env_name, &config); // hash of endpoint + client_id + scope
if let Some(cached) = self.cache.get(&key) {
    if std::time::Instant::now() < cached.expires_at {
        return Ok(cached.token);
    }
}
// per-key Mutex дедуплицирует concurrent invokes: один refresh, остальные ждут
let _guard = self.refresh_locks.acquire(&key).await; // см. ниже
if let Some(cached) = self.cache.get(&key) {
    if std::time::Instant::now() < cached.expires_at {
        return Ok(cached.token);
    }
}
let resp = self.http.post_form(&config.token_endpoint, &form_body).await?;
let token = parse_token_response(resp)?;
let cached = CachedToken {
    token: token.access_token.clone(),
    expires_at: std::time::Instant::now() + Duration::from_secs(token.expires_in),
};
self.cache.put(key, cached);
Ok(token.access_token)
```

`refresh_locks` — структура `LockMap<String, tokio::sync::Mutex<()>>` (HashMap под `parking_lot::Mutex`, lazily создающая `tokio::Mutex` per cache_key). API: `acquire(&key) -> OwnedMutexGuard<()>`. Один refresh на ключ; параллельные вызовы ждут на этом Mutex и при выходе видят свежий cached token.

### 5.5 Collections

```rust
pub struct CollectionId(pub uuid::Uuid);
pub struct ItemId(pub uuid::Uuid);

pub struct Collection {
    pub id: CollectionId,
    pub name: String,
    pub items: Vec<Item>,
    pub variables: HashMap<String, String>,
    pub auth_by_env: AuthByEnv,
    pub default_tls: bool,           // default true
    pub skip_tls_verify: bool,       // default false; UI помечен как unsafe
}

pub enum Item {
    Folder(Folder),
    Request(SavedRequest),
}

pub struct Folder {
    pub id: ItemId,
    pub name: String,
    pub items: Vec<Item>,
    pub auth_by_env: AuthByEnv,      // override от Collection; пустые configs = inherit
    // No TLS / address fields: TLS живёт на Collection + Request, address — только на Request.
}

pub struct SavedRequest {
    pub id: ItemId,
    pub name: String,
    pub address_template: String,    // e.g. "{{uri-root}}"
    pub service: String,             // e.g. "users.UserService"
    pub method: String,              // e.g. "GetUser"
    pub body_template: String,       // JSON template с {{var}}
    pub metadata: HashMap<String, String>,
    pub auth_by_env: AuthByEnv,
    pub tls_override: Option<bool>,
}

pub struct EffectiveRequest {
    pub target: GrpcTarget,
    pub service: String,
    pub method: String,
    pub body_json: String,
    pub metadata: HashMap<String, String>,
    pub auth: Option<AuthCredentials>,
}

pub fn resolve_request(
    request: &SavedRequest,
    ancestors: &[&AuthByEnv],
    collection: &Collection,
    active_env: &Environment,
) -> Result<EffectiveRequest, CoreError>;
```

Inheritance walk:
1. Auth: ищем nearest `Some(SavedAuthConfig)` сверху вниз (Request → Folder(s) → Collection); если есть конфиг для `active_env.name` — берём, иначе следующий ancestor.
2. TLS: `request.tls_override.unwrap_or(collection.default_tls)`.
3. Variables: `VariableSet { env: active_env.variables, collection: collection.variables }`.

### 5.6 gRPC

```rust
pub struct GrpcTarget {
    pub address: String,             // host:port (resolved, без {{}})
    pub tls: bool,
    pub skip_verify: bool,
}

pub struct GrpcConnection {
    pub target: GrpcTarget,
    pub transport: Arc<dyn GrpcTransport>,
    pub pool: prost_reflect::DescriptorPool,
    pub catalog: ServiceCatalog,
}

#[async_trait::async_trait]
pub trait GrpcTransport: Send + Sync {
    async fn channel(&self, target: &GrpcTarget) -> Result<TonicChannel, CoreError>;
    async fn unary_dynamic(
        &self,
        channel: TonicChannel,
        method_path: String,
        request_codec: DynamicCodec,
        request: DynamicMessage,
        metadata: HashMap<String, String>,
    ) -> Result<UnaryOutcome, CoreError>;
}
```

`DynamicCodec`:

```rust
pub struct DynamicCodec {
    pub request_descriptor: MessageDescriptor,
    pub response_descriptor: MessageDescriptor,
}

impl tonic::codec::Codec for DynamicCodec {
    type Encode = DynamicMessage;
    type Decode = DynamicMessage;
    type Encoder = DynamicEncoder;
    type Decoder = DynamicDecoder;
    fn encoder(&mut self) -> Self::Encoder { ... }
    fn decoder(&mut self) -> Self::Decoder { ... }
}
```

### 5.7 Reflection

- `grpc.reflection.v1.ServerReflection / ServerReflectionInfo` — bidi streaming.
- Запросы: `list_services`, `file_containing_symbol`, transitive `file_by_filename` для dependencies.
- Fallback: при `Unimplemented` / `NotFound` на v1 — повторяем тот же сценарий с `grpc.reflection.v1alpha.ServerReflection`.
- Сборка `DescriptorPool`: добавляем FileDescriptorProto в зависимости-first порядке. Циклы → `CoreError::DescriptorBuild`.

### 5.8 Contract cache

```rust
pub trait ContractCache: Send + Sync {
    fn get(&self, key: &ContractKey) -> Option<Arc<CachedContract>>;
    fn put(&self, key: ContractKey, value: Arc<CachedContract>);
    fn invalidate(&self, key: &ContractKey);
    fn invalidate_all(&self);
}

pub struct ContractKey {
    pub address: String,    // resolved
    pub tls: bool,
}

pub struct CachedContract {
    pub pool: prost_reflect::DescriptorPool,
    pub catalog: ServiceCatalog,
    pub fetched_at: chrono::DateTime<chrono::Utc>,
}
```

Когда `activate(target)` — сначала смотрим в cache, иначе reflection и сохраняем.

---

## 6. IPC contract (Tauri ↔ React)

### 6.1 Технология

- **tauri-specta v2** для генерации `src/ipc/bindings.ts` (commands + events + types).
- Все commands возвращают `Result<T, IpcError>`. `IpcError` — тегированный union с discriminator `"type"` для типизированной narrow логики в TS.

### 6.2 Commands (MVP)

Сигнатуры ниже — pseudo-Rust для краткости (`?` означает `Option`). Реальные `#[tauri::command]` функции принимают `tauri::State`-параметры и `tauri-specta` генерирует точные TS-типы.

| Команда | Назначение |
|---|---|
| `env_list()` | Все environments. |
| `env_upsert(env: Environment)` | Создать/обновить. |
| `env_delete(name)` | Удалить. |
| `env_active_get()` | Текущий активный env. |
| `env_active_set(name)` | Сменить. |
| `collection_list()` | Все коллекции (только meta). |
| `collection_get(id)` | Полное дерево по id. |
| `collection_upsert(collection)` | Создать/обновить collection целиком. |
| `collection_delete(id)` | Удалить. Idempotent. |
| `collection_set_variables(id, vars)` | Сохранить переменные (фронт дебансит вызовы на 300 ms). |
| `collection_add_item(collection_id, parent_id, item)` | Add (id client-side). Idempotent (return Ok если уже есть). |
| `collection_rename_item(collection_id, item_id, name)` | Rename. Idempotent. |
| `collection_move_item(collection_id, item_id, new_parent_id, position)` | Atomic move. |
| `collection_duplicate_item(collection_id, item_id)` | Глубокая копия с новыми uuid v7. |
| `collection_delete_item(collection_id, item_id)` | Idempotent delete. |
| `collection_restore_item(collection_id, snapshot, parent_id, position)` | Undo поддержки. |
| `auth_set_for_env(collection_id, item_id?, env_name, config)` | Установить SavedAuthConfig для (узел, env). `None` = удалить (reset to inherited). |
| `grpc_connect(target: GrpcTarget)` | Установить активное соединение + reflection. Cache-hit прозрачен. |
| `grpc_disconnect()` | Сбросить активное соединение. |
| `grpc_refresh_contract(target)` | Forced reflection. |
| `grpc_invoke_unary(req: InvokeRequest)` | Послать unary. Возвращает `InvokeOutcome`. |
| `token_force_refresh(collection_id, item_id?, env_name)` | Очистить кэш + сразу refresh. |

### 6.3 Events (MVP)

| Event | Когда |
|---|---|
| `ContractUpdated { target_key }` | После reflection (manual или auto) — для UI обновления catalog. |
| `ConnectionStateChanged { connected: bool, target?: GrpcTarget }` | После connect/disconnect. |

### 6.4 IpcError

```typescript
type IpcError =
  | { type: "InvalidTarget"; message: string }
  | { type: "NotConnected" }
  | { type: "ReflectionDisabled"; hint: string }
  | { type: "Reflection"; message: string }
  | { type: "DescriptorBuild"; message: string }
  | { type: "ServiceNotFound"; service: string }
  | { type: "MethodNotFound"; service: string; method: string }
  | { type: "EncodeRequest"; message: string }
  | { type: "DecodeResponse"; message: string }
  | { type: "UnresolvedVariable"; name: string }
  | { type: "VariableCycle"; chain: string[] }
  | { type: "Transport"; message: string }
  | { type: "Auth"; message: string }
  | { type: "GrpcStatus"; code: number; message: string }
  | { type: "NotImplemented"; message: string };
```

---

## 7. Frontend stack

- **React 18 + Vite + TypeScript** (strict).
- **Tailwind v4** + **shadcn/ui** (компоненты: button, input, dialog, alert-dialog, dropdown-menu, context-menu, resizable, scroll-area, tabs, tooltip, command, select, popover, separator, breadcrumb).
- **Monaco Editor** — lazy-loaded через `React.lazy` для request/response JSON. JSON language с `prost-reflect`-генерированной JSON schema (next-step) — в MVP голый JSON.
- **Zustand** — single store (active env, active connection, current selection, draft request, pending undos).
- **sonner** — toasts.
- **Lucide-react** — иконки.
- **react-arborist** или собственный tree-component (KISS — пишем сами на ul/li с keyboard nav).
- Без TanStack Query — IPC fast enough.

### Folder layout

```
src/
├── App.tsx                    # верхняя раскладка
├── ipc/
│   ├── bindings.ts            # generated by tauri-specta
│   ├── client.ts              # тонкая обёртка с типизированным error narrowing
│   └── events.ts              # subscribe to Tauri events
├── store/
│   ├── app-store.ts           # zustand
│   └── pending-undos.ts       # snapshot map для optimistic delete
├── features/
│   ├── envs/                  # EnvSwitcher, EditEnvDialog
│   ├── collections/           # CollectionsSidebar, Tree, ContextMenus, SaveDialog, MoveToDialog
│   ├── auth/                  # EditAuthDialog
│   ├── method-picker/         # MethodPickerDialog (Hybrid: tree + search)
│   ├── connect/               # AddressBar, ConnectionState
│   ├── invoke/                # RequestEditor, BodyEditor (Monaco), MetadataEditor, SendButton
│   ├── response/              # ResponsePanel, BodyView (Monaco r/o), TrailersView, StatusBar
│   └── views/                 # CollectionView, FolderView, RequestView, EmptyStates
├── components/                # shadcn primitives + small shared UI
├── lib/
│   ├── monaco.ts              # lazy loader + theme
│   ├── cn.ts
│   ├── format.ts
│   └── uuid.ts                # uuid v7
└── styles/globals.css         # tailwind + theme tokens (OKLCH)
```

---

## 8. UI design

### 8.1 Общая раскладка окна

```
┌──────────────────────────────────────────────────────────┐
│  Handshaker                              Prod ▾   ⚙       │  ← header (slim)
├────────────┬─────────────────────────────────────────────┤
│ Collections│  «breadcrumb»  Collection│Folder│Request    │
│ ▾ My Svcs  │  ─────────────────────────────────────────  │
│   ▸ users  │  (selection-driven content)                 │
│   ▸ pay    │                                             │
│            │  ─────────────────────────────────────────  │
│ [⊕ + New]  │  Response panel (status, body, trailers)    │
└────────────┴─────────────────────────────────────────────┘
```

- **Header**: бренд слева, env-pill справа (`Prod ▾`, без префикса), `⚙` settings. Глобален.
- **Sidebar (left)**: только Collections. Reflected services — не показываем здесь.
- **Main pane**: vertical split (Request top → Response bottom для Request view).
- Разделители resizable (через shadcn `Resizable`).

### 8.2 Sidebar / Collections tree

- Один tree-компонент. Узлы: Collection / Folder / Request.
- Двойной клик по имени узла = inline rename (тот же UI как через F2).
- Right-click → context menu:
  - **Collection root**: New Folder, New Request, Rename (F2), Duplicate, Delete (⌫).
  - **Folder**: New Folder, New Request, Rename, Duplicate, Move to…, Delete.
  - **Request**: Open (↵), Rename, Duplicate, Move to…, Delete.
- Никакого Edit Target / Edit Auth / Refresh contract в меню — это содержимое main pane.
- Hover на узле подсвечивает строку; selected — фон `--muted`.
- Keyboard nav: ↑↓ navigate, → раскрыть, ← свернуть, ↵ open.
- Empty state: «No collections yet» + кнопка `+ New Collection`.

### 8.3 Method picker (⌘K)

- **Hybrid**: tree + search input сверху.
- shadcn `Command` palette base + `react-arborist` или custom tree.
- Пока пусто в поиске — показываем дерево services → methods.
- Ввод текста → дерево схлопывается в плоский filtered список с full-path подсветкой `package.Service / method`.
- Esc — close. ↵ — выбрать.

### 8.4 Main pane — selection-driven content

#### Collection view

- Breadcrumb (последний сегмент editable): `<CollectionName>` + pill `Collection`.
- Section: **Variables · collection scope** — таблица `key | value | ×`:
  - empty-row внизу с placeholder’ом `Add variable`;
  - resolution preview под каждой строкой («→ `value`», или «→ `value` from env Prod» если из env);
  - `×` visible на hover строки, скрыт у empty-row;
  - валидация ключа `[a-zA-Z_][a-zA-Z0-9_-]*` — красная подсветка input при невалидном;
  - дубликат — warning под строкой; resolver берёт последнее.
- Section: **Default TLS** — checkbox `on/off` (default on).
- Section: **Auth · {active_env}** — select Type + кнопка `Edit Auth for {env}…`.
- Section: **Contract cache** — статус кэша + кнопка `↻ Refresh contract`.

#### Folder view

- Breadcrumb: `<Collection> / <Folder>`.
- Section: **Auth · {active_env}**:
  - Если конфига нет — строка «Inherited from `<ancestor>` → `<Type>`» + кнопка `Override`.
  - Если override активен — full form + кнопка `Reset to inherited` (destructive style).

#### Request view

```
┌─ breadcrumb: Coll / Folder / RequestName ─────── Request ─┐
│                                                            │
│  [🔒]  [{{uri-root}}    ]  [users.UserService/GetUser ▾]   │
│                                              [ Send  ⌘↵ ]  │
│  → resolves: api.prod:8443 · TLS inherited from My Svcs   │
│                                                            │
│  ┌Body  Metadata (2)  Settings─────────────────────────┐  │
│  │ { "user_id": "{{uid}}" }                            │  │
│  │                                                      │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ─── Response ──────────────────────────────────────────   │
│  ● OK · 142ms · 1.2KB                                      │
│  ┌Body  Trailers (1)──────────────────────────────────┐   │
│  │ { "name": "Alice", "email": "..." }                │   │
│  └─────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────┘
```

- Address bar: TLS toggle (🔒 / 🔓), address input (`{{var}}` highlighted), method picker dropdown trigger, Send button.
- Под address bar — однострочный preview: resolved address + источник TLS.
- Request tabs: `Body | Metadata (n) | Settings`.
  - `Body`: Monaco JSON, theme — shadcn-dark подобный (zinc).
  - `Metadata`: таблица key/value (с empty-row + hover delete как у Variables).
  - `Settings`: per-request Auth override + TLS override (если кликнули 🔒 в address bar — здесь автоматически появляется override). Address правится прямо в address-bar выше — отдельной секции не нужно.
- Response panel: status bar + tabs `Body | Trailers (n)`. Body — Monaco read-only. Status bar:
  - зелёная точка + OK · ms · size, или
  - красная точка + `<CODE>` · message · ms.

### 8.5 Save Request диалог

- Открывается на ⌘S из ad-hoc request (не привязанного к SavedRequest).
- Поля:
  - `Name` (input, дефолт = service + method).
  - `Destination` (mini-tree picker), последний элемент `+ New collection…`.
- Если активный request уже привязан к SavedRequest — ⌘S делает Update без диалога; ⌘⇧S всегда открывает Save As… с этим же диалогом.

### 8.6 Edit Auth диалог

- Открывается с кнопки `Edit Auth for {env}…` (на Collection или после Override на Folder/Request).
- Header: «Edit Auth — `<NodeName>`» + переиспользованный env-switcher (тот же widget из header окна — смена внутри диалога меняет глобальный env).
- Поля:
  - `Auth Type`: None / EnvVar / OAuth2.
  - `Grant type`: client_credentials (MVP — единственный).
  - `Token endpoint`, `Scope`, `Client ID`, `Client secret (env var name)`.
  - `Header name` (default `authorization`), `Prefix` (default `Bearer `).
  - Collapsible **Extra form params** (key/value table).
- Footer: `Reset to inherited` (destructive, слева) | `Cancel` | `Save`.

### 8.7 Empty states

- **Cold start (no collections, no connection)**: главная зона — иконка ⚡ + «Connect to a gRPC service» + кнопки `Connect to address` (primary), `+ New Collection` (outline). Sidebar пустой со своей кнопкой `+ New Collection`.
- **Connected, нет метода**: address bar активен (зелёная точка), центральная зона — иконка 🔍 + «Pick a method» + подсказка `⌘K` + кнопка `Open method picker`. Send — disabled.
- **Has collections, ничего не выбрано**: центральная зона — иконка → + «Open a request» + одна CTA `Connect to address`.

### 8.8 Visual style (final)

**Только dark mode в MVP. Палитра — shadcn new-york.**

```css
.dark {
  --background:           oklch(0.145 0 0);
  --foreground:           oklch(0.985 0 0);
  --card:                 oklch(0.205 0 0);
  --card-foreground:      oklch(0.985 0 0);
  --popover:              oklch(0.205 0 0);
  --popover-foreground:   oklch(0.985 0 0);
  --primary:              oklch(0.922 0 0);
  --primary-foreground:   oklch(0.205 0 0);
  --secondary:            oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted:                oklch(0.269 0 0);
  --muted-foreground:     oklch(0.708 0 0);
  --accent:               oklch(0.269 0 0);
  --accent-foreground:    oklch(0.985 0 0);
  --destructive:          oklch(0.704 0.191 22.216);
  --border:               oklch(1 0 0 / 10%);
  --input:                oklch(1 0 0 / 15%);
  --ring:                 oklch(0.556 0 0);
  --sidebar:              oklch(0.205 0 0);
  --sidebar-foreground:   oklch(0.985 0 0);
  --sidebar-border:       oklch(1 0 0 / 10%);
  --radius:               0.625rem;
}
```

- Шрифт: system stack `ui-sans-serif, -apple-system, "Inter", system-ui, sans-serif`. Monospace для кода/адресов/JSON: `ui-monospace, "JetBrains Mono", monospace`.
- Иконки: Lucide-react.
- Теней не используем; глубина — через `--card` + 10% white `--border`.
- Variables `{{name}}` подсвечены желтоватым `oklch(0.78 0.16 80)` в местах ввода адресов/body.
- Resolved variable preview зелёным `oklch(0.7 0.16 145)` (#22c55e-подобный).
- Destructive — `oklch(0.704 0.191 22.216)` (красный).

---

## 9. Hotkeys

| Контекст | Keys | Действие |
|---|---|---|
| Global | `⌘K` / `Ctrl+K` | Открыть method picker |
| Global | `⌘E` | Открыть env-switcher |
| Global | `⌘,` | Settings |
| Global | `⌘N` | New Request |
| Global | `⌘L` | Focus address bar |
| Request | `⌘↵` | Send |
| Request | `⌘S` | Save (или Update) |
| Request | `⌘⇧S` | Save As… |
| Collection view | `⌘R` | Refresh contract |
| Sidebar tree | `F2` | Rename |
| Sidebar tree | `⌫` | Delete (с undo-toast) |
| Sidebar tree | `↵` | Open / expand |
| Sidebar tree | `↑↓` | Navigate |
| Sidebar tree | `→ ←` | Expand / collapse |
| Dialog | `Esc` | Cancel |
| Dialog | `⌘↵` | Submit primary |
| Picker | `↑↓` | Navigate |
| Picker | `↵` | Select |
| Picker | `Esc` | Close |

Все `⌘` на Windows = `Ctrl` (Tauri `CmdOrCtrl`).

---

## 10. Optimistic UI

### 10.1 Карта мутаций

| Действие | Подход |
|---|---|
| Add (request, folder, collection) | Optimistic. UUID v7 client-side. |
| Delete item | Optimistic + undo (5s). |
| Rename | Optimistic. Error → revert. |
| Move to… | Optimistic, атомарный IPC `collection_move_item`. |
| Duplicate | Optimistic, deep copy с новыми uuid. |
| Variables edit (key/value typing) | Debounced 300ms IPC. UI и resolution preview — мгновенно. |
| Variable row delete | Optimistic, без undo (легко переввести). |
| TLS toggle 🔒 | Optimistic; кликнув inherited — создаёт override. |
| Edit Auth save | Optimistic. Error → re-open dialog с unsaved changes. |
| Reset to inherited | Optimistic + undo (5s). |
| Override (создать local) | Optimistic. |
| Switch env | Optimistic (UI перерисовывается); persist active_env на disk через debounced IPC. |
| Body / Metadata typing | Frontend draft; для linked SavedRequest — debounced 300ms IPC. |
| Method select из picker | Optimistic. |
| Send (invoke) | НЕ оптимистично — спиннер «Sending…». |
| Connect | НЕ оптимистично — спиннер «Connecting and fetching contract…». |
| Refresh contract | НЕ оптимистично. |
| Token force refresh | НЕ оптимистично. |

### 10.2 Правила

- **Single source of truth — Zustand**. Все мутации через actions store; IPC — side effect.
- **Per-node serialization**: pending mutations на один `item_id` — упорядочены (queue).
- **Idempotent IPC**: повторный delete с тем же id = Ok; rename с тем же name = Ok. Безопасный retry.
- **Snapshot для destructive**: `structuredClone` перед delete, reset-to-inherited, удалением variable, move.
- **Severity ошибок**:
  - *Recoverable* (timeout, busy) → retry-button в toast;
  - *Validation* (duplicate name, invalid var key) → revert + inline error;
  - *Fatal* (storage corrupted) → toast + Copy error + Tauri logs.
- **Pending indicator** появляется после 500ms (если IPC отвечает быстрее — без UI-шевеления).
- **Window close**: flush all pending mutations синхронно.
- **Conflict detection** — отложено (один клиент в MVP).

### 10.3 Toasts

- Позиция: top-right (sonner).
- Длительности: success 3s, info 4s, error persist до dismiss/action.
- Стек до 3, остальные в очереди.
- Batching: одинаковые события за 200ms группируются (sonner native).
- Undo-toast: 5s, кнопка `Undo` восстанавливает по snapshot через `collection_restore_item`.

### 10.4 Inline error panels

Показываются в main pane (response area или соответствующем view) вместо toast, когда:

- `ReflectionDisabled` — нужно объяснение + action (Retry / Copy error).
- `Cannot connect` (Transport down) — Retry / Edit variables.
- gRPC `UNAUTHENTICATED` или другие not-OK status — Force refresh token / Copy error.
- `UnresolvedVariable` — Open Variables…
- `VariableCycle` — указать chain.

Стиль панели: `--card` фон с примесью destructive (red tint), border destructive 50%, иконка ⚠.

---

## 11. Testing

### 11.1 Core unit tests

| Модуль | Покрытие |
|---|---|
| `resolver` | env > collection priority; multi-pass; cycle detection; unresolved error; невалидный ключ. |
| `descriptor` | сборка по корректному набору FileDescriptorProto; missing dependency error; цикл. |
| `reflection::fallback` | v1 → v1alpha при Unimplemented. |
| `invoke::codec` | round-trip JSON ↔ DynamicMessage для разных типов (scalars, enums, repeated, oneof, well-known timestamp). |
| `invoke::path` | формирование `/package.Service/Method`. |
| `invoke::metadata` | lowercase ключей, redaction `authorization` в логах. |
| `auth::token_cache` | concurrency: дедупликация refresh под нагрузкой. |
| `auth::oauth2::client_credentials` (когда придёт HTTP) | parse expires_in / token_type; error на invalid_client. |
| `collections::resolution` | inheritance auth, TLS override, variable resolve. |

### 11.2 Integration tests

- Локальный mock gRPC-сервер (на tonic) с включённым reflection v1 и/или v1alpha:
  - happy path connect + list + invoke;
  - reflection disabled → понятная error;
  - v1alpha-only сервер → fallback works;
  - unary roundtrip с DynamicMessage.

### 11.3 Frontend

- Unit-тесты Zustand actions (jest/vitest):
  - optimistic delete + undo restores state;
  - optimistic add then IPC error reverts state;
  - move_to between folders.
- Component-тесты ключевых форм (vitest + React Testing Library):
  - Edit Auth dialog: переключение Type скрывает/показывает поля;
  - Variables table: add empty-row materialize, hover-delete visible.

### 11.4 E2E — отложено в next-step

Tauri WebDriver / Playwright + tauri-driver. Не в MVP.

---

## 12. Toolchain

- **Rust**: stable channel, edition 2021. `rustfmt`, `clippy --all-targets -- -D warnings`.
- **Cargo**: `resolver = "2"`. Workspace.
- **Tauri 2.x**: capabilities/permissions — strict least-privilege. Окно с дефолтным набором + IPC доступы только для наших commands.
- **Node**: pnpm. Vite. TypeScript `strict`.
- **tauri-specta** v2 — генерация TS bindings при build.
- **CI** (next-step): GitHub Actions matrix macos-latest + windows-latest, `cargo clippy`, `cargo test`, `pnpm test`, `pnpm build`. Без code-signing/notarization в MVP.

---

## 13. Безопасность / приватность

- **Никогда не логируем секреты.** Поля `auth_token`, `client_secret` — никогда не попадают в `tracing::field`. Metadata-значение для ключа `authorization` (lowercase) — в логах заменяется на `<redacted>`.
- **Secret storage MVP**: значения OAuth2 client_secret и static EnvVar токенов читаются из `std::env`. **MVP-техдолг**: значения живут in-memory plaintext — нарушает ТЗ rule 10 «Never store secrets in plaintext». Перенос в `keyring` (через `SecretStore` trait в `src-tauri`) — next-step.
- **Файлы коллекции**: хранят только имена env-переменных, не сами секреты.
- **TLS skip_verify**: явно помечен в UI как «unsafe»; обведён красным, дополнительный confirm при первом включении.
- **Tauri capabilities**: разрешаем только наши commands + `core:event:default`. Никакого fs/shell/dialog без специфической необходимости.

---

## 14. Out of scope (next-steps)

Не в MVP, но архитектурно учтено:

- **Streaming RPCs** — server/client/bidi.
- **HTTP backend** — REST/JSON Postman-style. Скелет в `core::http` + IPC commands.
- **OAuth2 реальный refresh** — нужен HTTP backend; в MVP `OAuth2ClientCredentialsSource::get_token` возвращает `NotImplemented`.
- **Persistence на диск** — `FileCollectionStore` (per-collection JSON, atomic temp+rename).
- **Импорт/экспорт коллекций** — native format + Postman v2.1 (gRPC коллекции в Postman не экспортируются — только импорт-через-конверсию).
- **Keyring SecretStore** — macOS Keychain + Windows Credential Manager.
- **Light theme + system toggle**.
- **Drag&drop** в дереве — пока только `Move to…`.
- **Multi-tab requests** — пока single-request.
- **Stale-while-revalidate** для contract — пока only manual refresh + cache hit/miss.
- **Saved responses (examples)** — не моделируем.
- **CI matrix + installers** — GH Actions + `.dmg` / `.msi` через tauri-action, code signing.
- **E2E tests** — tauri-driver.
- **Monaco JSON schema из protobuf** — генерация JSON Schema из MessageDescriptor.

---

## 15. Связи и ссылки

- ТЗ — в системном промпте (Russian-language master brief).
- Visual references — `https://ui.shadcn.com/`.
- Memory rules — `C:\Users\1337\.claude\projects\C--dev-rust-handshaker\memory\MEMORY.md`:
  - `feedback_verify_technical_claims` — verify with context7 + WebSearch.
  - `feedback_ui_transparent_mechanics` — no engine-internals badges in sidebar/trees.
- Brainstorm artefacts — `.superpowers/brainstorm/1261-1779819338/content/` (15 HTML мокапов, сохранены в gitignore).
