# OAuth2 client-credentials для коллекций — дизайн

**Дата:** 2026-06-12 · **Статус:** утверждён пользователем (брейншторм в сессии)

## Use-case

Для запросов в production нужен Bearer-токен от OIDC-эндпоинта
(`…/openid-connect/token`): `POST` с `grant_type=client_credentials`,
`client_id`, `client_secret`, `scope` → ответ `access_token`, `expires_in`,
`token_type`, `scope`. Токен прикладывается к gRPC-вызовам коллекции и
обновляется при истечении. Авторизация нужна **только в продовом окружении**,
не всегда.

В core уже есть задел: `SavedAuthConfig::OAuth2ClientCredentials` парсится и
персистится, но `resolve_auth` возвращает `NotImplemented` (master §5.4,
deferred). Эта фича реализует отложенное.

## Принятые решения (брейншторм)

| Вопрос | Решение |
|---|---|
| Где живёт secret | Все поля конфига — шаблоны с `{{var}}`; куда класть секрет, решает пользователь (вариант C) |
| Кэш токена | In-memory в Rust-бэкенде, на время сессии; на диск не попадает (вариант A) |
| Обновление | Лениво при Send: жив и до истечения > 30 с skew → используем, иначе синхронный фетч (вариант A) |
| `UNAUTHENTICATED` (16) | Инвалидировать кэш, показать ошибку, **без** авто-retry (вариант A) |
| Проверка конфига | Кнопка **Get token** в редакторе: тестовый фетч + инлайн-результат (вариант A) |
| Слой логики | Core (`auth/oauth2.rs`): фетч + кэш + провайдер; src-tauri — managed state + тонкий IPC (вариант 1) |
| Заголовок | Настраиваемые `header_name` (дефолт `authorization`) и `prefix` (дефолт `Bearer `) |
| Привязка к окружению | Список `environments` на auth-конфиге: пусто = активен всегда; иначе — только в перечисленных окружениях (вариант A; полная `AuthByEnv`-карта отвергнута как избыточная) |

## 1. Модель данных (core)

`OAuth2ClientCredentialsConfig`:

```rust
pub struct OAuth2ClientCredentialsConfig {
    pub token_url: String,      // шаблон, может содержать {{var}}
    pub client_id: String,      // шаблон
    pub client_secret: String,  // шаблон (БЫЛО: client_secret_env_var)
    pub scopes: Vec<String>,    // элементы — шаблоны
    pub header_name: String,    // дефолт "authorization"
    pub prefix: String,         // дефолт "Bearer "
    pub environments: Vec<String>, // пусто = все окружения
}
```

- `client_secret_env_var` → `client_secret`: прямое переименование без
  serde-alias — вариант никогда не создавался через UI, персистентных данных
  с ним быть не должно.
- `header_name` / `prefix` / `environments` получают `#[serde(default = …)]` —
  старые записи (если бы были) и свежесозданные конфиги читаются без миграции.
- `scopes` остаётся `Vec<String>`; в UI — одно поле через пробел; в запросе к
  IdP — `scope`, склеенный пробелами (опускается, если пусто).
- **`environments` добавляется и в `EnvVarAuthConfig`** (тот же дефолт пусто =
  все) — скоупинг по окружениям консистентен для Bearer / API key / OAuth2.
  Отсутствующее поле в существующих `collections.json` десериализуется в
  «все окружения» — поведение не меняется.
- Пара (header_name, prefix) НЕ входит в ключ кэша: кэш хранит голый
  `access_token`, заголовок собирается при выдаче.

Гейт-хелпер в core: `fn auth_active_for_env(environments: &[String],
active_env: Option<&str>) -> bool` — пусто → `true`; иначе `active_env`
должен входить в список («No environment» = `None` → не входит → auth не
применяется). Используется и в `resolve_request`
(`crates/handshaker-core/src/collections/resolve.rs`), и фронтом (зеркальная
однострочная проверка).

## 2. Core: модуль `auth/oauth2.rs`

- **Фетч**: `POST {token_url}`, тело `application/x-www-form-urlencoded`:
  `grant_type=client_credentials`, `client_id`, `client_secret`, `scope`
  (если непуст). HTTP-клиент — `reqwest` (rustls, без openssl).
- **Ответ**: `access_token` обязателен (нет → `CoreError::Auth`);
  `expires_in` отсутствует → считаем 300 с; `token_type` игнорируем
  (префикс заголовка настраивается пользователем).
- **`TokenCache`** — чистая структура без I/O:
  `HashMap<CacheKey, CachedToken { access_token, expires_at }>`.
  Ключ = хэш **резолвнутых** `(token_url, client_id, client_secret, scopes)`.
  `get_fresh(key, now)` отдаёт токен, только если `expires_at - now > 30 с`
  (skew). Время передаётся параметром → тесты без сети и сна.
- **`Oauth2TokenProvider`** — `Mutex<TokenCache>` + `reqwest::Client`:
  `async fn header_for(&self, cfg: &OAuth2ClientCredentialsConfig)
  -> Result<AuthCredentials, CoreError>`: кэш-хит → собрать заголовок;
  промах → фетч, положить в кэш, собрать заголовок
  (`header_name: prefix + access_token`). Дедупликации конкурентных фетчей
  нет — single-user desktop, YAGNI.
- **Ошибки** → `CoreError::Auth` с HTTP-статусом и `error` /
  `error_description` из тела ответа IdP, если распарсились. Секрет и токен
  в тексты ошибок и логи не попадают.
- `resolve_auth` (sync) остаётся для `None`/`EnvVar`; oauth2-ветка живёт в
  async-провайдере.

## 3. IPC (src-tauri)

`Oauth2TokenProvider` — в managed state (`AppState`). Конфиг приходит с
фронта **уже `{{var}}`-резолвнутым**.

- `auth_resolve(config)` — сигнатура не меняется; oauth2-ветка идёт через
  провайдер вместо `NotImplemented`.
- Новая `auth_oauth2_fetch_token(config) -> { expires_in_secs: u64 }` —
  принудительный фетч мимо кэша (кнопка Get token), результат кладётся в кэш.
- Новая `auth_invalidate(config)` — удаляет запись кэша (вызывается фронтом
  после `UNAUTHENTICATED`).

## 4. Фронтенд

- **`resolveAuthHeader`** (`src/features/workflow/actions.ts`):
  1. гейт по окружению: `environments` непуст и активное окружение не в
     списке → `{ kind: "none" }` (запрос идёт без заголовка);
  2. для oauth2 — резолв `{{var}}` в `token_url`/`client_id`/`client_secret`/
     `scopes` существующим `ipc.varsResolve`; нерезолвленная переменная →
     `{ kind: "error" }` с именем переменной;
  3. дальше тот же `ipc.authResolve`.
- **После Send**: `status_code === 16` при oauth2-auth → best-effort
  `ipc.authInvalidate(resolvedConfig)`; авто-retry нет — следующий Send
  возьмёт свежий токен.
- **`SavedAuthEditor`** (`src/features/catalog/overview/SavedAuthEditor.tsx`):
  - read-only заглушка oauth2 удаляется; в тоггл добавляется четвёртая опция
    **OAuth2**: поля Token URL, Client ID, Client secret, Scope
    (одной строкой через пробел) + свёрнутые/второстепенные Header name и
    Prefix (предзаполнены дефолтами);
  - кнопка **Get token**: резолв vars → `auth_oauth2_fetch_token` →
    инлайн-результат («Token acquired · expires in N min» / текст ошибки IdP);
  - строка **«Apply in environments»** — мульти-выбор из существующих
    окружений (popover с чекбоксами; ничего не выбрано = все окружения);
    видна для Bearer / API key / OAuth2;
  - маппинг формы — `authConfigMap.ts`.

## 5. Тесты

- **Core**: кэш (истечение, skew, состав ключа — header_name/prefix не
  влияют), сборка form-body, парсинг ответа (включая отсутствие `expires_in`
  и отсутствие `access_token`), `auth_active_for_env`; один интеграционный
  тест фетча на локальном mock-сервере (wiremock): успех + ошибка IdP.
- **Фронт (vitest)**: round-trip `authConfigMap`, рендер oauth2-формы +
  Get token (успех/ошибка), oauth2-ветка `resolveAuthHeader` (env-гейт,
  резолв vars, нерезолвленная переменная), инвалидация на код 16.

## Вне scope

- Авто-retry запроса после инвалидации токена.
- Фоновое обновление токена по таймеру.
- Дедупликация конкурентных token-фетчей.
- Полная per-env карта auth (`AuthByEnv`) — структура остаётся в core как
  задел master-спеки, в модель узлов не вшивается.
- Другие grant-типы (authorization_code, refresh_token и т.д.).
