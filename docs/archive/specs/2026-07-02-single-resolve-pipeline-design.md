# Спека — один резолв-пайплайн: боевой Send через ядровый `resolve_request`

**Статус:** 🎉 DONE 2026-07-02 (реализовано, ff в `main`; план —
`docs/superpowers/plans/archive/2026-07-02-single-resolve-pipeline.md`, статус-баннер
там — источник истины). Дизайн утверждён архитектурным ревью + grilling 2026-07-01/02;
ADR — [`docs/adr/0001-send-resolves-in-core.md`](../../../adr/0001-send-resolves-in-core.md).
**Тип:** бэкенд (core + IPC) + фронтенд (удаление TS-зеркала). **Bindings дрейфят
осознанно** (новые команды `grpc_send`/`auth_effective`, уход `grpc_invoke_oneshot`) —
дрейф коммитится, no-drift-гейт проверяется на финале.
**Issues:** `xlcorg/handshaker` #1–#6 (все `ready-for-agent`, брифы в комментариях).

## Проблема

Резолв-пайплайн (переменные → TLS → metadata → auth) существует **дважды**:

- **Ядро** — `resolve_request(request, collection, active_env) → EffectiveRequest`
  ([resolve.rs](../../../crates/handshaker-core/src/collections/resolve.rs)): 10 тестов,
  **ноль продакшен-вызовов** (мёртвый код по deletion-тесту).
- **Фронт** — боевое TS-зеркало в
  [actions.ts](../../../src/features/workflow/actions.ts): `pickEffectiveAuth` (:190,
  коммент «Mirrors core resolve_auth_chain»), `resolveOauthConfig` (:208),
  `resolveAuthHeader` (:247), `sendStep` (:279) + `resolveStepTemplates`
  ([resolve.ts](../../../src/features/workflow/resolve.ts)). Синхронизация с ядром —
  только комментариями.

Класс багов «UI решил одно, ядро умеет другое» уже дал два инцидента:

1. **16 UNAUTHENTICATED на каждом вызове** — живой Send видел только `step.auth` и
   терял auth коллекции (исторический live-fix `pickEffectiveAuth`).
2. **`skip_tls_verify` молча игнорируется** — UI даёт включить флаг у коллекции
   (`CollectionOverview.tsx:83`), но все боевые вызовы хардкодят `skip_verify: false`
   (actions.ts:79, :100, :302; `useDraftReflection.ts:66`). Ядровый `resolve_request`
   флаг чтит — но его никто не зовёт. **Живой баг.**

Дополнительное трение: `grpc_invoke_oneshot` принимает опции россыпью позиционных
параметров (`request_id, timeout_ms, max_message_bytes`) — каждая новая опция ломает
все сигнатуры насквозь (кандидат №2 ревью, решено делать одним заходом).

## Решение (по ADR-0001)

Резолв-пайплайн живёт **только в ядре**. Фронт шлёт сырые шаблоны + ctx-ссылки и не
содержит копий правил резолва и auth — даже для отображения.

### Ядро (глоссарий — [CONTEXT.md](../../../crates/handshaker-core/CONTEXT.md))

- **`resolve_request` становится async** и принимает `Option<&Collection>` (unbound
  draft = пустые collection-vars, без collection-auth, verify по умолчанию) +
  `&dyn TokenSource`.
- **Auth расколот**: чистый sync **pick** (`pick_auth_config` — выбор выигрывающего
  конфига по цепочке request → collection с env-гейтом) и async **materialization**
  (конфиг → заголовок; EnvVar — чтение OS-энва, OAuth2 — токен через token source).
  Старое одношаговое `resolve_auth` и его заглушка
  `CoreError::NotImplemented("oauth2 token fetch")` умирают.
- **Token source** — шов получения OAuth2-токена по уже разрешённому конфигу. Два
  адаптера: боевой `Oauth2TokenProvider` (с токен-кэшем) и тестовый фейк.
  `{{var}}`-резолв oauth-полей происходит в ядре **до** token source — ключ кэша
  (resolved token_url+client_id+secret+scopes) не меняется.
- **Resolve failure** — типизированный отказ через `resolve_template_with_diagnostics`:
  `ResolveFailure { unresolved: Vec<String>, cycle: Option<Vec<String>> }` — полный
  дедуплицированный список в порядке встречи, не «первая ошибка» (паритет с
  TS-`resolveStepTemplates`, который так уже умеет).
- **Билтины** (`{{$guid}}` и др.) резолв-пайплайн не считает неразрешёнными — они
  остаются литералами до фазы экспансии билтинов (bucket `dynamic_vars` уже есть).

### IPC (глоссарий — [CONTEXT.md](../../../src-tauri/CONTEXT.md))

- **`grpc_send(draft, ctx, request_id, opts)`** — замена `grpc_invoke_oneshot` **на
  месте** (у старой команды ровно один боевой вызов — `sendStep`). Владеет цепочкой:
  резолв-пайплайн → экспансия билтинов → `invoke_unary` (внутри существующего
  `race_cancel_timeout`).
- **Send ctx** = `{ collection_id?, env_name? }` — именно **ссылки**: коллекцию и
  окружение команда читает из своих сторов сама.
- **Call options** = `CallOptions { timeout_ms, max_message_bytes }` — одно растущее
  значение от UI до транспорта вместо позиционной россыпи. `request_id` — **не**
  call option (ключ отмены, свой жизненный цикл) — остаётся отдельным параметром.
- На **16 UNAUTHENTICATED** команда инвалидирует токен-кэш (авторетрая нет — как
  сейчас); фронтовый invalidate-хэндл умирает.
- Новый **`IpcError::UnresolvedVars`** несёт `ResolveFailure` на фронт.
- Новая команда **`auth_effective(step_auth, ctx)`** — «какой auth действует» для
  Auth-таба и снапшота истории (UI не держит копию правила pick).

### Фронт

- `sendStep` = сбор черновика + вызов `grpc_send` + маппинг ошибок.
- **Удаляются вместе с тестами**: `pickEffectiveAuth`, `resolveAuthHeader`,
  `resolveOauthConfig`, `resolveStepTemplates`, `AuthDeps`, invalidate-хэндл.
- Auth-таб (`CallPanel.tsx:81`) и снапшот истории — async-хук на `auth_effective`,
  перечитывается по `envRevision`/смене origin.
- `resolveAddressSafe` **остаётся** (адрес нужен фронту до Send — reflection,
  TLS-замок в host).
- Оверлеи `VarsResolveCtxIpc` для **редакторов** (подсветка `{{var}}`) — не Send,
  не трогаются.

### Поведенческий фикс

`collection.skip_tls_verify` начинает реально работать: на Send (слайс #5) и на
reflection/message-schema (слайс #6, независимый).

## Слайсы (vertical slices = issues #1–#6)

| # | Слайс | Блокеры |
|---|-------|---------|
| 1 | core: раскол auth на pick/materialize + полный отчёт резолв-пайплайна (префактор) | — |
| 2 | CallOptions: пер-вызовные опции одним значением от UI до транспорта | — |
| 3 | core: шов Token source — async резолв-пайплайн с OAuth2 | #1 |
| 4 | auth_effective: UI спрашивает эффективный auth у ядра | #1 |
| 5 | grpc_send: боевой Send через резолв-пайплайн ядра (замена grpc_invoke_oneshot) | #2, #3 |
| 6 | reflection/schema: чтить collection.skip_tls_verify | — |

Детальные acceptance-критерии — в брифах issues.

## Тестирование (TDD, red→green)

- **Core**: 10 тестов `resolve.rs` эволюционируют (async-сигнатура, фейковый token
  source); новые — полный отчёт unresolved+cycle, oauth-поля резолвятся до token
  source (ключ кэша), pick с env-гейтом как чистая функция, unbound draft
  (`None`-коллекция).
- **IPC**: `grpc_send` с неразрешённой переменной → `UnresolvedVars` с полным
  списком; 16 → инвалидация кэша; `auth_effective` для цепочки request/collection/
  env-гейт; CallOptions доезжает до транспорта.
- **Фронт**: тесты зеркала удаляются вместе с ним; хук `auth_effective`
  (ревизия по env); `sendStep` — маппинг `UnresolvedVars` в существующий UI-показ.
- **Гейт**: `cargo test --workspace` (включая крейтовый `tests/`-каталог — урок
  traceId!) · vitest · `tsc -b` · `vite build` · bindings-дрейф закоммичен и стабилен.
- **Live (WebView2), человеческий гейт**: OIDC-эндпойнт (OAuth2-коллекция шлёт Send
  без фронтового резолва токена; 16 → инвалидация → следующий Send берёт свежий
  токен) + self-signed сервер (skip_tls_verify на Send и reflection); черновик без
  коллекции; неразрешённая `{{var}}` показывает полный список.

## Вне scope (YAGNI)

- Стриминговые вызовы (invoke_unary — единственный путь).
- Авторетрай на 16 (осознанно нет — как сейчас).
- Перевод редакторных `{{var}}`-оверлеев (`vars_resolve`) на новый пайплайн.
- Экспорт «без секретов», прогрев токен-кэша, refresh-token flow.
- Кросс-языковые тест-векторы (кандидат №9 ревью) — TS-сторона умирает, сверять
  становится нечего.

## Затронутые файлы (ориентир)

- `crates/handshaker-core/src/auth/mod.rs` — раскол pick/materialize, смерть
  `NotImplemented`; `auth/oauth2.rs` — трейт TokenSource поверх провайдера.
- `crates/handshaker-core/src/collections/resolve.rs` — async `resolve_request`,
  `Option<&Collection>`, `ResolveFailure`, полный отчёт.
- `crates/handshaker-core/src/grpc/transport/*` + `invoke/*` — CallOptions до
  транспорта.
- `src-tauri/src/commands/grpc.rs` — `grpc_send`, `auth_effective`, смерть
  `grpc_invoke_oneshot`; `src-tauri/src/ipc/*` — `CallOptionsIpc`, `SendCtxIpc`,
  `IpcError::UnresolvedVars`, `EffectiveAuthIpc`.
- `src/features/workflow/actions.ts` (−~150 строк зеркала), `resolve.ts` (умирает),
  `CallPanel.tsx`, `useDraftReflection.ts`, `src/ipc/client.ts`, `bindings.ts`
  (генерируется).
- Строки ошибок для пользователя — через `src/lib/messages.ts` (правило ui-strings).
