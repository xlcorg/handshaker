# Collection Vars Resolve + Indication — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Status: 📋 READY — не запускать без команды пользователя.**

**Goal:** Переменные коллекции участвуют в `{{var}}`-резолве на всех живых путях
(Send, адрес/reflection, OAuth2), а редакторы переменных (коллекции и окружения)
показывают строку-превью резолва под рядом.

**Architecture:** IPC `vars_resolve` получает опциональный `VarsResolveCtxIpc`
(`collection_id` для живых путей — бэкенд читает переменные из `collection_store`;
оверлеи `collection_vars`/`env_vars` для несохранённых рядов редакторов). На фронте
`Step` получает `collectionId` (источник — `DraftOrigin`, инвариант поддерживает
workflow store), хелперы `varsCtxFor`/`varsResolverFor` прокидывают контекст. Новый
компонент `VarResolveLine` — однострочное превью под рядом переменной. Ядро
(`resolve_template_with_diagnostics`, env > collection, до 4 проходов) не меняется.

**Tech Stack:** Rust (tauri 2, specta) · React 18 + TS · vitest + RTL · cargo test.

**Спека:** `docs/superpowers/specs/2026-06-13-collection-vars-resolve-design.md`.

**Отклонение от спеки (зафиксировано при планировании):**
`src/features/invoke/ResolvesPreview.tsx` оказался **мёртвым кодом** — нигде не
смонтирован (grep по `ResolvesPreview` находит только сам файл, тестов нет). Вместо
«добавить ему collectionId-проп» план **удаляет** его (конвенция проекта — мёртвый
код выпиливается: App.tsx, EnvPill). Его `hasVars`/стили переезжают в новый
`VarResolveLine`. Индикация unresolved на Send-пути уже есть
(`stepPatchFromSendResult` → «Unresolved variables: …») и остаётся.

**Worktree-дисциплина:** исполнять в выделенном worktree; сабагентам — `git -C
<worktree>` везде, контролёр сверяет ветку перед каждым коммитом
(см. memory `project_subagent_worktree_discipline`).

**Команды:** фронт `pnpm lint` (tsc -b) · `pnpm test` (vitest run); Rust
`cargo test --workspace`; биндинги
`cargo run -p handshaker --bin export-bindings --features export-bindings --quiet`;
сборка `pnpm build`. Свежий worktree: `pnpm install`, затем `pnpm build` **до**
компиляции `src-tauri` (`generate_context!` требует `dist/`).

---

## File map

| Файл | Изменение |
|---|---|
| `crates/handshaker-core/src/vars/mod.rs` | +1 characterization-тест (кросс-слойная вложенность) |
| `src-tauri/src/ipc/vars.rs` | +`VarsResolveCtxIpc` DTO |
| `src-tauri/src/commands/vars.rs` | `vars_resolve_impl(template, ctx)` + тесты |
| `src/ipc/bindings.ts` | regen (gitignored) |
| `src/ipc/client.ts` | `varsResolve(template, ctx = null)` |
| `src/features/workflow/model.ts` | `Step.collectionId` |
| `src/features/workflow/store.ts` | `setDraft`/`setDraftOrigin` синхронизируют `collectionId` |
| `src/features/workflow/actions.ts` | `varsCtxFor`/`varsResolverFor`, `CallTargetInit.collectionId`, прокидывание |
| `src/features/workflow/useDraftReflection.ts` | +`collectionId` параметр |
| `src/features/workflow/useMessageSchema.ts` | `SchemaTarget.collectionId` (+ в ключ кэша) |
| `src/features/workflow/CallPanel.tsx` | прокидывание `step.collectionId` во все резолв-точки |
| `src/features/vars/VarResolveLine.tsx` | **новый** компонент превью (+ `hasVars`) |
| `src/features/invoke/ResolvesPreview.tsx` | **удалить** (мёртвый код) |
| `src/features/catalog/overview/VariablesBlock.tsx` | опц. `resolveRow`/`resolveKey` + превью под рядом |
| `src/features/catalog/overview/CollectionOverview.tsx` | резолвер с оверлеем текущих рядов |
| `src/features/envs/VariablesTable.tsx` | опц. `resolveRow`/`resolveKey` + превью-ряд |
| `src/features/envs/EnvEditorDialog.tsx` | резолвер с `env_vars`-оверлеем |
| тесты | `vars/mod.rs`, `commands/vars.rs`, `store.test.ts`, `actions.test.ts`, `VarResolveLine.test.tsx`, `CollectionOverview.test.tsx`, `VariablesTable.test.tsx`, `EnvEditorDialog.test.tsx` |

---

### Task 1: Ядро — characterization-тест кросс-слойной вложенности

Алгоритм ядра уже умеет «значение collection-переменной ссылается на
env-переменную» (многопроходность + `lookup` env→collection), но ни один тест
это не фиксирует. Тест закрепляет контракт, на который опирается вся фича.

**Files:**
- Modify: `crates/handshaker-core/src/vars/mod.rs` (тест-модуль в конце файла)

- [ ] **Step 1: Написать тест**

В существующий `#[cfg(test)] mod tests` (переиспользуй локальные хелперы
построения мап, если они там есть; иначе — как ниже):

```rust
#[test]
fn collection_var_value_resolves_against_env_var() {
    // Репро бага: env `notes-api-root`, collection `uri-root = {{notes-api-root}}`.
    let env = std::collections::HashMap::from([(
        "notes-api-root".to_string(),
        "https://api.example.com".to_string(),
    )]);
    let collection = std::collections::HashMap::from([(
        "uri-root".to_string(),
        "{{notes-api-root}}".to_string(),
    )]);
    let vars = VariableSet { env: &env, collection: &collection };
    let r = resolve_template_with_diagnostics("{{uri-root}}/v1/notes", &vars);
    assert_eq!(r.resolved, "https://api.example.com/v1/notes");
    assert!(r.unresolved_vars.is_empty());
    assert!(r.cycle_chain.is_none());
}
```

- [ ] **Step 2: Запустить — ожидается PASS (фиксация поведения, не баг ядра)**

Run: `cargo test -p handshaker-core collection_var_value_resolves_against_env_var`
Expected: PASS. (Если FAIL — стоп: предпосылка спеки неверна, эскалировать.)

- [ ] **Step 3: Commit**

```bash
git add crates/handshaker-core/src/vars/mod.rs
git commit -m "test(core): lock cross-layer collection->env var resolution"
```

---

### Task 2: Бэкенд — `VarsResolveCtxIpc` + `vars_resolve(template, ctx)` + клиент

**Files:**
- Modify: `src-tauri/src/ipc/vars.rs`
- Modify: `src-tauri/src/commands/vars.rs`
- Regen: `src/ipc/bindings.ts` (gitignored)
- Modify: `src/ipc/client.ts:117-121`

- [ ] **Step 1: Написать падающие тесты в `src-tauri/src/commands/vars.rs`**

Заменить тест-модуль на (существующий тест обновляется на `None`):

```rust
#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use handshaker_core::auth::SavedAuthConfig;
    use handshaker_core::collections::ids::CollectionId;
    use handshaker_core::collections::Collection;

    use super::*;
    use crate::ipc::vars::VarsResolveCtxIpc;

    fn map(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[tokio::test]
    async fn vars_resolve_treats_active_none_as_empty_var_set() {
        let state = AppState::default(); // active = None, stores empty
        let report = state.vars_resolve_impl(r#"{"k":"{{x}}"}"#, None).await;
        assert_eq!(report.unresolved_vars, vec!["x".to_string()]);
        assert!(report.cycle_chain.is_none());
        assert_eq!(report.resolved, r#"{"k":"{{x}}"}"#);
    }

    #[tokio::test]
    async fn ctx_overlays_resolve_collection_var_against_env_var() {
        let state = AppState::default();
        let ctx = VarsResolveCtxIpc {
            collection_id: None,
            collection_vars: Some(map(&[("uri-root", "{{notes-api-root}}")])),
            env_vars: Some(map(&[("notes-api-root", "https://api.example.com")])),
        };
        let report = state.vars_resolve_impl("{{uri-root}}/v1/notes", Some(ctx)).await;
        assert_eq!(report.resolved, "https://api.example.com/v1/notes");
        assert!(report.unresolved_vars.is_empty());
    }

    #[tokio::test]
    async fn ctx_collection_id_reads_vars_from_store() {
        let state = AppState::default();
        let cid = CollectionId::new();
        state
            .collection_store
            .upsert(Collection {
                id: cid,
                name: "Notes".into(),
                items: vec![],
                variables: map(&[("uri-root", "{{notes-api-root}}")]),
                auth: SavedAuthConfig::None,
                default_tls: false,
                skip_tls_verify: false,
                pinned: false,
                description: None,
                created_at: 0.0,
                expanded: false,
            })
            .unwrap();
        let ctx = VarsResolveCtxIpc {
            collection_id: Some(cid.0.to_string()),
            collection_vars: None,
            env_vars: Some(map(&[("notes-api-root", "https://api.example.com")])),
        };
        let report = state.vars_resolve_impl("{{uri-root}}", Some(ctx)).await;
        assert_eq!(report.resolved, "https://api.example.com");
        assert!(report.unresolved_vars.is_empty());
    }

    #[tokio::test]
    async fn ctx_unknown_collection_id_is_empty_map_not_error() {
        let state = AppState::default();
        let ctx = VarsResolveCtxIpc {
            collection_id: Some("not-a-uuid".into()),
            collection_vars: None,
            env_vars: None,
        };
        let report = state.vars_resolve_impl("{{x}}", Some(ctx)).await;
        assert_eq!(report.unresolved_vars, vec!["x".to_string()]);
    }
}
```

(Если поля `Collection` не совпадут — сверься с
`crates/handshaker-core/src/collections/mod.rs:39-52`; вариант `SavedAuthConfig::None`
— `crates/handshaker-core/src/auth/mod.rs:79`.)

- [ ] **Step 2: Запустить — убедиться, что НЕ компилируется**

Run: `cargo test -p handshaker vars`
Expected: compile error — `VarsResolveCtxIpc` не существует, `vars_resolve_impl`
принимает 1 аргумент.

- [ ] **Step 3: DTO в `src-tauri/src/ipc/vars.rs`**

Добавить (к существующим импортам — `serde::Deserialize`, `std::collections::HashMap`):

```rust
use std::collections::HashMap;

use serde::Deserialize;

/// Optional resolve context for `vars_resolve`. All fields optional:
/// - `collection_id` — live paths; the backend reads the collection's vars from the store;
/// - `collection_vars` — editor overlay (unsaved rows); wins over `collection_id`;
/// - `env_vars` — env-editor overlay; wins over the active environment.
#[derive(Debug, Clone, Default, Deserialize, Type)]
pub struct VarsResolveCtxIpc {
    pub collection_id: Option<String>,
    pub collection_vars: Option<HashMap<String, String>>,
    pub env_vars: Option<HashMap<String, String>>,
}
```

- [ ] **Step 4: Реализация в `src-tauri/src/commands/vars.rs`**

```rust
//! Variable substitution IPC command. See spec §5.1 and
//! docs/superpowers/specs/2026-06-13-collection-vars-resolve-design.md.

use handshaker_core::vars::{resolve_template_with_diagnostics, ResolutionReport, VariableSet};
use tauri::State;

use crate::ipc::collection::parse_collection_id;
use crate::ipc::error::IpcError;
use crate::ipc::vars::{ResolutionReportIpc, VarsResolveCtxIpc};
use crate::state::AppState;

impl AppState {
    /// Inner logic for `vars_resolve`. Env vars: `ctx.env_vars` overlay, else the
    /// active environment, else empty. Collection vars: `ctx.collection_vars`
    /// overlay, else a store lookup by `ctx.collection_id` (unknown id ⇒ empty),
    /// else empty. `ctx = None` keeps the historical behaviour exactly.
    pub async fn vars_resolve_impl(
        &self,
        template: &str,
        ctx: Option<VarsResolveCtxIpc>,
    ) -> ResolutionReport {
        let ctx = ctx.unwrap_or_default();
        let env_owned = match ctx.env_vars {
            Some(vars) => vars,
            None => {
                let active = self.active_env.read().await.clone();
                active
                    .as_deref()
                    .and_then(|n| self.env_store.get(n))
                    .map(|e| e.variables)
                    .unwrap_or_default()
            }
        };
        let collection_owned = match ctx.collection_vars {
            Some(vars) => vars,
            None => ctx
                .collection_id
                .as_deref()
                .and_then(|id| parse_collection_id(id).ok())
                .and_then(|cid| self.collection_store.get(cid))
                .map(|c| c.variables)
                .unwrap_or_default(),
        };
        let vars = VariableSet {
            env: &env_owned,
            collection: &collection_owned,
        };
        resolve_template_with_diagnostics(template, &vars)
    }
}

#[tauri::command]
#[specta::specta]
pub async fn vars_resolve(
    state: State<'_, AppState>,
    template: String,
    ctx: Option<VarsResolveCtxIpc>,
) -> Result<ResolutionReportIpc, IpcError> {
    Ok(state.vars_resolve_impl(&template, ctx).await.into())
}
```

(`HashMap`-импорт в начале файла больше не нужен — старый
`let collection_owned: HashMap<…> = HashMap::new()` с TODO удалён.)

- [ ] **Step 5: Запустить тесты**

Run: `cargo test -p handshaker vars`
Expected: 4 PASS.

- [ ] **Step 6: Перегенерировать биндинги + обновить клиент**

Run: `cargo run -p handshaker --bin export-bindings --features export-bindings --quiet`

В `src/ipc/client.ts` (тип `VarsResolveCtxIpc` добавить в существующий
type-only импорт из `./bindings`):

```ts
export async function varsResolve(
  template: string,
  ctx: VarsResolveCtxIpc | null = null,
): Promise<ResolutionReportIpc> {
  const r = await commands.varsResolve(template, ctx);
  if (r.status === "error") throw r.error;
  return r.data;
}
```

- [ ] **Step 7: Фронт-гейт**

Run: `pnpm lint` → clean; `pnpm test` → все зелёные (существующие vi-моки
`varsResolve` совместимы — лишний аргумент моки игнорируют).

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/ipc/vars.rs src-tauri/src/commands/vars.rs src/ipc/client.ts
git commit -m "feat(ipc): vars_resolve takes optional collection/env resolve context"
```

---

### Task 3: Модель — `Step.collectionId`, инвариант в workflow store

Источник истины: `DraftOrigin.collectionId`. Store поддерживает инвариант
«origin задан ⇒ `draft.collectionId` = его collectionId», поэтому
`openSavedRequest` (открытие/quick-add/duplicate) и `handleSave` (биндинг после
сохранения unbound-черновика, `src/app/WorkflowApp.tsx:159`) не требуют правок.
Executed-снапшоты истории наследуют поле через спред в `buildExecutedStep`.

**Files:**
- Modify: `src/features/workflow/model.ts`
- Modify: `src/features/workflow/store.ts:66-72`
- Test: `src/features/workflow/store.test.ts`

- [ ] **Step 1: Написать падающие тесты в `store.test.ts` (describe "draft origin + dirty")**

```ts
it("setDraft(step, origin) stamps the origin's collectionId onto the step", () => {
  workflowStore.setDraft(
    newStep({ address: "h", tls: false, service: "S", method: "M" }),
    { collectionId: "c1", requestId: "r1" },
  );
  expect(workflowStore.getState().draft?.collectionId).toBe("c1");
});

it("setDraftOrigin patches the existing draft's collectionId (Save binding)", () => {
  workflowStore.setDraft(newStep({ address: "h", tls: false, service: "S", method: "M" }));
  expect(workflowStore.getState().draft?.collectionId).toBeNull();
  workflowStore.setDraftOrigin({ collectionId: "c1", requestId: "r1" });
  expect(workflowStore.getState().draft?.collectionId).toBe("c1");
});

it("setDraftOrigin(null) clears the draft's collectionId", () => {
  workflowStore.setDraft(
    newStep({ address: "h", tls: false, service: "S", method: "M" }),
    { collectionId: "c1", requestId: "r1" },
  );
  workflowStore.setDraftOrigin(null);
  expect(workflowStore.getState().draft?.collectionId).toBeNull();
});
```

- [ ] **Step 2: Запустить — FAIL**

Run: `pnpm vitest run src/features/workflow/store.test.ts`
Expected: FAIL (`collectionId` отсутствует на Step / undefined).

- [ ] **Step 3: Реализация**

`model.ts` — в `interface Step` (после `auth`):

```ts
  /** Owning collection of the saved request this step came from — the {{var}}
   *  resolve context. null = unbound draft (no collection variables). */
  collectionId: string | null;
```

в `newStep` init добавить `collectionId?: string | null;`, в возвращаемый объект —
`collectionId: init.collectionId ?? null,`.

`store.ts` — `setDraft`/`setDraftOrigin` (сохранить остальное тело как есть,
включая нотификацию подписчиков):

```ts
  setDraft(step: Step | null, origin: DraftOrigin | null = null) {
    const draft = step
      ? { ...step, collectionId: origin?.collectionId ?? step.collectionId ?? null }
      : null;
    state = { ...state, draft, draftOrigin: origin, draftDirty: false };
    // …existing emit/notify…
  },
  setDraftOrigin(origin: DraftOrigin | null) {
    const draft = state.draft
      ? { ...state.draft, collectionId: origin?.collectionId ?? null }
      : null;
    state = { ...state, draft, draftOrigin: origin, draftDirty: false };
    // …existing emit/notify…
  },
```

- [ ] **Step 4: Запустить — PASS + полный прогон**

Run: `pnpm vitest run src/features/workflow/store.test.ts` → PASS;
затем `pnpm test` + `pnpm lint` (новое обязательное поле `Step` может уронить
литералы Step в тестах — добить `collectionId: null` где требуется).
Expected: всё зелёное.

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/model.ts src/features/workflow/store.ts src/features/workflow/store.test.ts
git commit -m "feat(workflow): Step.collectionId stamped from draft origin"
```

---### Task 4: Прокинуть контекст коллекции через все живые резолв-пути

**Files:**
- Modify: `src/features/workflow/actions.ts`
- Modify: `src/features/workflow/useDraftReflection.ts`
- Modify: `src/features/workflow/useMessageSchema.ts`
- Modify: `src/features/workflow/CallPanel.tsx`
- Test: `src/features/workflow/actions.test.ts`

- [ ] **Step 1: Написать падающие тесты в `actions.test.ts`**

(переиспользуй существующие моки/фикстуры файла — `vi.mock("@/ipc/client")` и
passthrough-имплементацию `varsResolve` из его beforeEach):

```ts
import { varsCtxFor, varsResolverFor } from "./actions";

describe("varsCtxFor / varsResolverFor", () => {
  it("builds a collection ctx only when an id is present", () => {
    expect(varsCtxFor("c1")).toEqual({ collection_id: "c1", collection_vars: null, env_vars: null });
    expect(varsCtxFor(null)).toBeNull();
    expect(varsCtxFor(undefined)).toBeNull();
  });

  it("varsResolverFor passes the ctx to ipc.varsResolve", async () => {
    await varsResolverFor("c1")("{{x}}");
    expect(ipc.varsResolve).toHaveBeenCalledWith("{{x}}", {
      collection_id: "c1", collection_vars: null, env_vars: null,
    });
  });
});

it("sendStep resolves templates in the step's collection ctx", async () => {
  // мок grpcInvokeOneshot — как в существующих sendStep-тестах файла
  await sendStep({
    address: "{{uri-root}}", tls: false, service: "p.S", method: "M",
    requestJson: "{}", metadata: [], collectionId: "c1",
  });
  expect(ipc.varsResolve).toHaveBeenCalledWith("{{uri-root}}", {
    collection_id: "c1", collection_vars: null, env_vars: null,
  });
});

it("sendStep without a collection resolves with a null ctx", async () => {
  await sendStep({
    address: "h:1", tls: false, service: "p.S", method: "M",
    requestJson: "{}", metadata: [],
  });
  expect(ipc.varsResolve).toHaveBeenCalledWith("h:1", null);
});
```

- [ ] **Step 2: Запустить — FAIL**

Run: `pnpm vitest run src/features/workflow/actions.test.ts`
Expected: FAIL — `varsCtxFor` не экспортируется; `varsResolve` вызывается без ctx.

- [ ] **Step 3: Реализация в `actions.ts`**

Импорты: `VarsResolveCtxIpc` в type-импорт из `@/ipc/bindings`,
`type Resolver` из `./resolve`.

```ts
export interface CallTargetInit {
  address: string;
  tls: boolean;
  /** Owning collection for {{var}} resolution; null/omitted ⇒ no collection vars. */
  collectionId?: string | null;
}

/** Resolve ctx for a step bound to `collectionId`; null when unbound. */
export function varsCtxFor(collectionId: string | null | undefined): VarsResolveCtxIpc | null {
  return collectionId
    ? { collection_id: collectionId, collection_vars: null, env_vars: null }
    : null;
}

/** A Resolver with the collection ctx baked in — inject into resolve/auth deps. */
export function varsResolverFor(collectionId: string | null | undefined): Resolver {
  return (t) => ipc.varsResolve(t, varsCtxFor(collectionId));
}
```

`resolveAddressSafe` — новый параметр:

```ts
export async function resolveAddressSafe(
  address: string,
  collectionId: string | null = null,
): Promise<string> {
  try {
    return (await ipc.varsResolve(address, varsCtxFor(collectionId))).resolved;
  } catch {
    return address;
  }
}
```

`buildRequestSkeletonSafe` и `fetchMessageSchemaSafe` — внутри:
`const address = await resolveAddressSafe(target.address, target.collectionId ?? null);`

`sendStep` — в типе параметра `step` добавить `collectionId?: string | null;`,
резолв через бейкнутый резолвер:

```ts
    const r = await resolveStepTemplates(step, varsResolverFor(step.collectionId));
```

`createStepFromMethod` — в вызов `newStep` добавить
`collectionId: target.collectionId ?? null,`.

- [ ] **Step 4: Хуки**

`useDraftReflection.ts` — сигнатура и резолв:

```ts
export function useDraftReflection(
  address: string,
  tls: boolean,
  enabled = true,
  collectionId: string | null = null,
): DraftReflection {
```

внутри `run`: `const resolved = await resolveAddressSafe(addr, collectionId);`
и `collectionId` в deps-массив `useCallback` (`[address, tls, enabled, collectionId]`).

`useMessageSchema.ts` — `SchemaTarget` добавить `collectionId?: string | null;`;
ключ кэша и фетч:

```ts
  const { address, tls, service, method, collectionId = null } = target;
  const key = `${address}|${tls}|${service}|${method}|${side}|${collectionId ?? ""}`;
  // …
    void fetchMessageSchemaSafe({ address, tls, collectionId }, service, method, side).then(…);
```

(в deps эффекта добавить `collectionId`).

- [ ] **Step 5: `CallPanel.tsx`**

- импорт: `varsResolverFor` из `./actions`; `varsResolve` из `@/ipc/client`
  убрать, если больше не используется;
- `onSend`: `resolveAuthHeader(step.auth, activeWf.envName, { authResolve, varsResolve: varsResolverFor(step.collectionId) })`;
- `onResetBody`: target `{ address: step.address, tls: step.tls, collectionId: step.collectionId }`;
- `onSelectMethod` → `applyMethodSelection(…, { address: step.address, tls: step.tls, collectionId: step.collectionId }, …)`;
- `useDraftReflection(step.address, step.tls, !!editable, step.collectionId)`;
- `schemaTarget`: editable-ветка + `collectionId: step.collectionId`,
  history-плейсхолдер + `collectionId: null`.

- [ ] **Step 6: Запустить всё**

Run: `pnpm vitest run src/features/workflow/actions.test.ts` → PASS;
`pnpm test` → полный прогон зелёный (правка моков `useDraftReflection`/
`useMessageSchema`-тестов при необходимости); `pnpm lint` → clean.

- [ ] **Step 7: Commit**

```bash
git add src/features/workflow/actions.ts src/features/workflow/actions.test.ts src/features/workflow/useDraftReflection.ts src/features/workflow/useMessageSchema.ts src/features/workflow/CallPanel.tsx
git commit -m "feat(workflow): thread collection ctx through send/reflection/oauth2 resolve paths"
```

---

### Task 5: Компонент `VarResolveLine` (+ удалить мёртвый `ResolvesPreview`)

**Files:**
- Create: `src/features/vars/VarResolveLine.tsx`
- Delete: `src/features/invoke/ResolvesPreview.tsx`
- Test: `src/features/vars/VarResolveLine.test.tsx`

- [ ] **Step 1: Написать падающие тесты**

```tsx
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { VarResolveLine, hasVars } from "./VarResolveLine";

const report = (over: Partial<{ resolved: string; unresolved_vars: string[]; cycle_chain: string[] | null }> = {}) => ({
  resolved: "ok", unresolved_vars: [], cycle_chain: null, ...over,
});

async function flushDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

describe("hasVars", () => {
  it("detects {{name}} placeholders", () => {
    expect(hasVars("{{uri-root}}/v1")).toBe(true);
    expect(hasVars("plain")).toBe(false);
  });
});

describe("VarResolveLine", () => {
  it("renders nothing for a value without vars", () => {
    vi.useFakeTimers();
    const resolver = vi.fn();
    const { container } = render(<VarResolveLine value="plain" resolver={resolver} />);
    expect(container).toBeEmptyDOMElement();
    expect(resolver).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("shows the resolved value after the debounce", async () => {
    vi.useFakeTimers();
    const resolver = vi.fn(async () => report({ resolved: "https://api.example.com" }));
    render(<VarResolveLine value="{{notes-api-root}}" resolver={resolver} />);
    expect(screen.queryByText(/resolves/)).toBeNull(); // ещё дебаунс
    await flushDebounce();
    expect(screen.getByText(/→ resolves: https:\/\/api\.example\.com/)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("shows unresolved vars as a warning", async () => {
    vi.useFakeTimers();
    const resolver = vi.fn(async () => report({ unresolved_vars: ["notes-api-root"] }));
    render(<VarResolveLine value="{{notes-api-root}}" resolver={resolver} />);
    await flushDebounce();
    expect(screen.getByText(/⚠ Unresolved: notes-api-root/)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("shows a cycle chain as a warning", async () => {
    vi.useFakeTimers();
    const resolver = vi.fn(async () => report({ cycle_chain: ["a", "b", "a"] }));
    render(<VarResolveLine value="{{a}}" resolver={resolver} />);
    await flushDebounce();
    expect(screen.getByText(/⚠ Cycle: a → b → a/)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("re-resolves when resolveKey changes", async () => {
    vi.useFakeTimers();
    const resolver = vi.fn(async () => report());
    const { rerender } = render(
      <VarResolveLine value="{{x}}" resolver={resolver} resolveKey="k1" />,
    );
    await flushDebounce();
    rerender(<VarResolveLine value="{{x}}" resolver={resolver} resolveKey="k2" />);
    await flushDebounce();
    expect(resolver).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Запустить — FAIL (модуль не существует)**

Run: `pnpm vitest run src/features/vars/VarResolveLine.test.tsx`
Expected: FAIL — cannot resolve `./VarResolveLine`.

- [ ] **Step 3: Реализация `src/features/vars/VarResolveLine.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import type { ResolutionReportIpc } from "@/ipc/bindings";

const DEBOUNCE_MS = 300;

/** Detects a `{{name}}` placeholder. Same grammar the body preview used; names with
 *  spaces resolve in the core but are not detected here (pre-existing limitation). */
export function hasVars(s: string): boolean {
  return /\{\{[a-zA-Z_][a-zA-Z0-9_-]*\}\}/.test(s);
}

export interface VarResolveLineProps {
  /** The template string being edited (one variable row's value). */
  value: string;
  /** Performs the resolve — callers bake the ctx (collection/env overlays) in. */
  resolver: (t: string) => Promise<ResolutionReportIpc>;
  /** Stringified extra resolve inputs (sibling rows, active env); change ⇒ re-resolve. */
  resolveKey?: string;
  className?: string;
}

/** One-line resolve preview under a variable row:
 *  `→ resolves: …` / `⚠ Unresolved: …` / `⚠ Cycle: …`.
 *  Renders nothing while the value has no `{{…}}` or before the first resolve. */
export function VarResolveLine({ value, resolver, resolveKey, className }: VarResolveLineProps) {
  const [report, setReport] = useState<ResolutionReportIpc | null>(null);
  // Latest resolver in a ref so an inline-lambda prop doesn't refire the effect
  // every render — re-resolution is driven by `value`/`resolveKey` only.
  const resolverRef = useRef(resolver);
  resolverRef.current = resolver;

  useEffect(() => {
    if (!hasVars(value)) {
      setReport(null);
      return;
    }
    const t = setTimeout(() => {
      resolverRef.current(value).then(setReport).catch(() => setReport(null));
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, resolveKey]);

  if (!hasVars(value) || report === null) return null;

  let text: string;
  let destructive = false;
  if (report.cycle_chain) {
    text = `⚠ Cycle: ${report.cycle_chain.join(" → ")}`;
    destructive = true;
  } else if (report.unresolved_vars.length > 0) {
    text = `⚠ Unresolved: ${report.unresolved_vars.join(", ")}`;
    destructive = true;
  } else {
    text = `→ resolves: ${report.resolved}`;
  }

  return (
    <div
      className={cn(
        "text-xs font-mono overflow-hidden text-ellipsis whitespace-nowrap",
        destructive ? "text-destructive" : "text-muted-foreground",
        className,
      )}
      title={text}
    >
      {text}
    </div>
  );
}
```

- [ ] **Step 4: Удалить мёртвый `src/features/invoke/ResolvesPreview.tsx`**

```bash
git rm src/features/invoke/ResolvesPreview.tsx
```

(Перед удалением подтвердить grep'ом, что импортов нет:
`rg "ResolvesPreview" src` → только сам файл.)

- [ ] **Step 5: Запустить**

Run: `pnpm vitest run src/features/vars/VarResolveLine.test.tsx` → PASS;
`pnpm lint` → clean; `pnpm test` → полный прогон зелёный.

- [ ] **Step 6: Commit**

```bash
git add src/features/vars/VarResolveLine.tsx src/features/vars/VarResolveLine.test.tsx
git commit -m "feat(vars): VarResolveLine row preview; drop dead ResolvesPreview"
```

---

### Task 6: Превью в редакторе переменных коллекции

**Files:**
- Modify: `src/features/catalog/overview/VariablesBlock.tsx`
- Modify: `src/features/catalog/overview/CollectionOverview.tsx`
- Test: `src/features/catalog/overview/CollectionOverview.test.tsx`

- [ ] **Step 1: Написать падающий тест в `CollectionOverview.test.tsx`**

(моки файла уже содержат `varsResolve`-passthrough — `{ resolved: t, unresolved_vars: [], cycle_chain: null }`;
сделать его управляемым per-test через `vi.mocked`):

```tsx
it("shows a resolve preview under a variable row whose value has {{vars}}", async () => {
  vi.mocked(ipc.varsResolve).mockResolvedValue({
    resolved: "https://api.example.com",
    unresolved_vars: [],
    cycle_chain: null,
  });
  // collection fixture: variables = { "uri-root": "{{notes-api-root}}" } — расширь
  // существующую фикстуру коллекции этого файла.
  renderOverview(); // существующий хелпер файла; открыть таб Variables кликом
  await user.click(screen.getByText("Variables"));
  expect(await screen.findByText(/→ resolves: https:\/\/api\.example\.com/)).toBeInTheDocument();
  // ctx: текущие ряды редактора оверлеем
  expect(ipc.varsResolve).toHaveBeenCalledWith("{{notes-api-root}}", {
    collection_id: null,
    collection_vars: { "uri-root": "{{notes-api-root}}" },
    env_vars: null,
  });
});
```

(`findByText` ждёт дебаунс 300мс под реальными таймерами; если файл использует
fake timers — прогнать `advanceTimersByTimeAsync(300)` как в Task 5.)

- [ ] **Step 2: Запустить — FAIL**

Run: `pnpm vitest run src/features/catalog/overview/CollectionOverview.test.tsx`
Expected: FAIL — превью не рендерится.

- [ ] **Step 3: `VariablesBlock.tsx` — опциональные пропсы + превью**

Импорты: `import { VarResolveLine, hasVars } from "@/features/vars/VarResolveLine";`
и `import type { ResolutionReportIpc } from "@/ipc/bindings";`

```ts
interface VariablesBlockProps {
  rows: VarRow[];
  onChange: (nextRows: VarRow[]) => void;
  /** Optional per-row resolve preview; the caller bakes the ctx into the resolver. */
  resolveRow?: (value: string) => Promise<ResolutionReportIpc>;
  resolveKey?: string;
}
```

В рендере ряда — четвёртым ребёнком грид-контейнера (упадёт на вторую
грид-строку под колонкой Value):

```tsx
        <div key={row.id} className="group/var grid grid-cols-[1fr_1.4fr_28px] gap-x-2 gap-y-0.5 items-center">
          {/* …Input k, Input v, Tooltip — как есть… */}
          {resolveRow && hasVars(row.v) && (
            <div className="col-start-2">
              <VarResolveLine value={row.v} resolver={resolveRow} resolveKey={resolveKey} className="px-1 pb-0.5" />
            </div>
          )}
        </div>
```

(сигнатура компонента: `({ rows, onChange, resolveRow, resolveKey }: VariablesBlockProps)`;
`gap-2` на контейнере заменить на `gap-x-2 gap-y-0.5`, чтобы превью-строка не
получала вертикальный зазор 8px.)

- [ ] **Step 4: `CollectionOverview.tsx` — резолвер с оверлеем текущих рядов**

Импорты: `useCallback` в react-импорт; `useActiveWorkflow` из
`@/features/workflow/store`.

```tsx
function rowsToRecord(rows: VarRow[]): Record<string, string> {
  const rec: Record<string, string> = {};
  for (const r of rows) {
    const k = r.k.trim();
    if (k) rec[k] = r.v; // dup keys: last wins (как в persist)
  }
  return rec;
}
```

В компоненте (и переиспользовать `rowsToRecord` внутри `persistVars` вместо его
локального цикла):

```tsx
  const activeWf = useActiveWorkflow();
  const varsRecord = useMemo(() => rowsToRecord(varRows), [varRows]);
  // Unsaved editor rows overlay the stored collection vars; env = active env (backend).
  const resolveRow = useCallback(
    (t: string) =>
      ipc.varsResolve(t, { collection_id: null, collection_vars: varsRecord, env_vars: null }),
    [varsRecord],
  );
  const resolveKey = `${JSON.stringify(varsRecord)}|${activeWf.envName ?? ""}`;
```

Передать в таб Variables:

```tsx
              <VariablesBlock
                rows={varRows}
                onChange={(next) => {
                  setVarRows(next);
                  persistVars(next);
                }}
                resolveRow={resolveRow}
                resolveKey={resolveKey}
              />
```

- [ ] **Step 5: Запустить**

Run: `pnpm vitest run src/features/catalog/overview/CollectionOverview.test.tsx` → PASS;
`pnpm test` полный + `pnpm lint` → зелёные.

- [ ] **Step 6: Commit**

```bash
git add src/features/catalog/overview/VariablesBlock.tsx src/features/catalog/overview/CollectionOverview.tsx src/features/catalog/overview/CollectionOverview.test.tsx
git commit -m "feat(catalog): resolve preview under collection variable rows"
```

---

### Task 7: Превью в редакторе окружения

**Files:**
- Modify: `src/features/envs/VariablesTable.tsx`
- Modify: `src/features/envs/EnvEditorDialog.tsx`
- Test: `src/features/envs/VariablesTable.test.tsx`, `src/features/envs/EnvEditorDialog.test.tsx`

- [ ] **Step 1: Написать падающий тест в `VariablesTable.test.tsx`**

```tsx
it("shows a resolve preview row under a value with {{vars}}", async () => {
  const resolveRow = vi.fn(async () => ({
    resolved: "https://api.example.com",
    unresolved_vars: [],
    cycle_chain: null,
  }));
  render(
    <VariablesTable
      value={{ "uri-root": "{{notes-api-root}}" }}
      onChange={() => {}}
      resolveRow={resolveRow}
      resolveKey="k"
    />,
  );
  expect(await screen.findByText(/→ resolves: https:\/\/api\.example\.com/)).toBeInTheDocument();
  expect(resolveRow).toHaveBeenCalledWith("{{notes-api-root}}");
});

it("renders no preview row without a resolveRow prop", () => {
  render(<VariablesTable value={{ k: "{{x}}" }} onChange={() => {}} />);
  expect(screen.queryByText(/resolves|Unresolved/)).toBeNull();
});
```

- [ ] **Step 2: Запустить — FAIL**

Run: `pnpm vitest run src/features/envs/VariablesTable.test.tsx`
Expected: FAIL — проп не существует / превью нет.

- [ ] **Step 3: `VariablesTable.tsx`**

Импорты: `import { VarResolveLine, hasVars } from "@/features/vars/VarResolveLine";`,
`import type { ResolutionReportIpc } from "@/ipc/bindings";`

```ts
export interface VariablesTableProps {
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  /** Optional per-row resolve preview (env editor passes an env_vars-overlay resolver). */
  resolveRow?: (value: string) => Promise<ResolutionReportIpc>;
  resolveKey?: string;
}
```

В рендере, внутри `<Fragment>` после основного `<TableRow>` (паттерн ряда
duplicate-key):

```tsx
                {!isTrailingEmpty && resolveRow && hasVars(r.value) && (
                  <TableRow className="hover:bg-transparent border-b-0">
                    <TableCell colSpan={3} className="px-2 py-1">
                      <VarResolveLine value={r.value} resolver={resolveRow} resolveKey={resolveKey} />
                    </TableCell>
                  </TableRow>
                )}
```

(сигнатура: `({ value, onChange, resolveRow, resolveKey }: VariablesTableProps)`.)

- [ ] **Step 4: `EnvEditorDialog.tsx` — резолвер с `env_vars`-оверлеем**

`useCallback` в react-импорт; в компоненте:

```tsx
  // Preview resolves against the EDITED rows (not the persisted env) — honest for
  // unsaved changes and for a non-active environment. No collection ctx here.
  const resolveRow = useCallback(
    (t: string) => ipc.varsResolve(t, { collection_id: null, collection_vars: null, env_vars: vars }),
    [vars],
  );
```

```tsx
          <VariablesTable
            value={vars}
            onChange={setVars}
            resolveRow={resolveRow}
            resolveKey={JSON.stringify(vars)}
          />
```

В `EnvEditorDialog.test.tsx` — если мок `@/ipc/client` не содержит `varsResolve`,
добавить passthrough: `varsResolve: vi.fn(async (t: string) => ({ resolved: t, unresolved_vars: [], cycle_chain: null }))`,
и тест:

```tsx
it("resolves a row preview against the edited (unsaved) rows", async () => {
  // открыть диалог в edit-режиме с env, где значение содержит {{stage}},
  // используя фикстуры/хелперы этого файла
  expect(await screen.findByText(/→ resolves:|⚠ Unresolved/)).toBeInTheDocument();
  expect(ipc.varsResolve).toHaveBeenCalledWith(
    expect.stringContaining("{{"),
    expect.objectContaining({ env_vars: expect.any(Object) }),
  );
});
```

- [ ] **Step 5: Запустить**

Run: `pnpm vitest run src/features/envs` → PASS; `pnpm test` полный +
`pnpm lint` → зелёные.

- [ ] **Step 6: Commit**

```bash
git add src/features/envs/VariablesTable.tsx src/features/envs/VariablesTable.test.tsx src/features/envs/EnvEditorDialog.tsx src/features/envs/EnvEditorDialog.test.tsx
git commit -m "feat(envs): resolve preview under environment variable rows"
```

---

### Task 8: Финальный гейт + документация

🧹 **/clear-чекпойнт** — Task 8 можно выполнять свежей сессией.

- [ ] **Step 1: Полный гейт**

```bash
pnpm lint        # tsc clean
pnpm test        # vitest полный — все зелёные
cargo test --workspace
cargo run -p handshaker --bin export-bindings --features export-bindings --quiet
pnpm lint        # no-drift: после регена tsc по-прежнему clean
pnpm build
```

Expected: всё зелёное, реген биндингов не меняет поведение tsc.

- [ ] **Step 2: Финальное ревью ветки**

Спек-ревью + quality-ревью диффа ветки против спеки
(`docs/superpowers/specs/2026-06-13-collection-vars-resolve-design.md`) — процесс
проекта: superpowers:requesting-code-review.

- [ ] **Step 3: Обновить план-баннер и CLAUDE.md**

Статус-баннер этого плана → «🎉 feature-complete (код)»; в CLAUDE.md «Active work»
отразить статус. Остаток вне гейта: **живая проверка в WebView2** (репро
баг-репорта: env `notes-api-root` + collection `uri-root={{notes-api-root}}` +
`{{uri-root}}` в адресе ⇒ успешный Send; превью в обоих редакторах) — выполняет
пользователь/контролёр после сборки.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-06-13-collection-vars-resolve.md CLAUDE.md
git commit -m "docs(plan): collection-vars-resolve final gate + status"
```
