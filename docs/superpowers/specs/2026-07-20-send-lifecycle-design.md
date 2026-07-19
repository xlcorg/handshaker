# One home for the Send lifecycle — design

Статус: 📐 спека утверждена (2026-07-20), план — далее.

Кандидат из архитектурного ревью: Send-цикл размазан по ~8 фронтовым модулям,
CallPanel и FocusView соавторствуют его жизненный цикл, а auth для executed-снапшота
берётся из **отдельного** `auth_effective`-фетча, который может разойтись с auth,
реально использованным `grpc_send` (stale-окно). Цель — одна глубокая точка входа
(`useSend`) и снапшот-как-факт из ядра.

Соответствует ADR-0001 и завершает его: одно правило pick — один дом, теперь и для
снапшота истории. Секреты в разрешённом виде через фронт по-прежнему не гуляют.

## Решения (грилинг)

1. **Скоуп**: обе части — IPC-изменение + фронтовый `useSend`.
2. **Провод**: `grpc_send` возвращает обёртку `SendReportIpc`, не расширенный
   `InvokeOutcomeIpc` (outcome остаётся чистым результатом invoke).
3. **Владелец**: `useSend` сам коммитит executed-снапшот и `bumpUsage` (при
   переданном `origin`); `onExecuted`-проп умирает.
4. **Поглощение**: `stepPatchFromSendResult`, `shouldRecordExecuted`,
   `buildExecutedStep` становятся внутренностями `useSend`; `sendStep`/`cancelStep`
   остаются IO-адаптером в `actions.ts`.

## Ядро (`crates/handshaker-core`)

- `EffectiveRequest` + поле `picked_auth: Option<SavedAuthConfig>` — выигравший
  конфиг в **шаблонной** форме (как хранится в коллекции). `resolve_request` уже
  вычисляет `picked` (resolve.rs, auth pick) и дропает — теперь кладёт в результат.
  `None` = unauthenticated.
- TLS дополнительно не нужен: уже лежит в `eff.target`.

## IPC (`src-tauri`)

Новый DTO в `ipc/invoke.rs`:

```rust
pub struct SendReportIpc {
    pub outcome: InvokeOutcomeIpc,
    pub auth_used: SavedAuthConfigIpc, // шаблоны; kind=none — unauthenticated
    pub tls_used: bool,                // из eff.target
}
```

- `grpc_send` / `grpc_send_impl` → `Result<SendReportIpc, IpcError>`.
  `auth_used`/`tls_used` снимаются с `eff` **до** move в work-кложу.
- Материализованный заголовок не возвращается (ADR-0001: секреты не гуляют).
- Термин **Send report** — в `src-tauri/CONTEXT.md` (Language).
- Регенерация `src/ipc/bindings.ts` обязательна; `client.ts::grpcSend` — новый тип.

## Фронт (`src/features/workflow`)

Новый модуль `useSend.ts`:

```ts
useSend(step, { envName, onPatch, origin? }): { send, cancel }
```

- `send()` владеет циклом: гейт `status === "sending"` → `requestId` →
  `sendStep` → внутренний `applySendResult` (патч; при ok — executed-снапшот с
  `auth: report.auth_used`, `tls: report.tls_used`) →
  `workflowStore.commitExecutedStep` + `useCatalog().bumpUsage(origin)` — только
  при переданном `origin` (Focus-режим). Ledger/List `origin` не передают —
  историю не пишут, как и сейчас.
- `onPatch` — параметр: Focus → `updateDraft`, Ledger/List → `updateStep`.
- `actions.ts`: `SendResult.ok` теперь несёт `report: SendReportIpc`;
  экспорты `stepPatchFromSendResult` / `shouldRecordExecuted` /
  `buildExecutedStep` удаляются.
- `CallPanelProps`: минус `onExecuted`, минус мёртвый `originAuth`
  (задокументирован как неиспользуемый, но всё ещё дриллится из FocusView);
  плюс `origin?`.
- `useEffectiveAuth` остаётся **только** для Auth-таба (живое отображение по
  ADR-0001); из снапшот-пути уходит.

## Тесты

- **Rust**: `resolve.rs` — assert'ы `picked_auth` (request-wins,
  collection-fallback, env-gate, none); юнит на маппинг `eff → SendReportIpc`.
- **TS**: новый `useSend.test.ts` (мок `sendStep`): ok → патч+коммит+bump;
  unresolved → error-патч; cancelled → draft; гейт повторного Send; снапшот
  берёт auth/tls из report, не из `useEffectiveAuth`. Обновить `actions.test.ts`
  (форма `SendResult`), синк моков `grpcSend` в фикстурах, CallPanel-тесты без
  `onExecuted`.
- **Гейт**: `pnpm lint` + `pnpm test` + `cargo test --workspace` + регенерация
  биндингов (IPC-shape меняется — cargo-only гейта недостаточно).
