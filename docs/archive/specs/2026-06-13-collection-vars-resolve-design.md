# Резолв переменных коллекции + индикация резолва — дизайн

**Дата:** 2026-06-13 · **Статус:** утверждён (брейншторм в сессии)

## Проблема

Переменные коллекции не участвуют в `{{var}}`-резолве на живом пути. Репро:
в активном окружении есть `notes-api-root`; в настройках коллекции заведена
переменная `uri-root = {{notes-api-root}}`; ссылка `{{uri-root}}` в адресе/теле
не резолвится. Дополнительно: в редакторах переменных (коллекции и окружения)
нет никакой индикации — ни ошибки, ни успеха, ни возможности увидеть итоговое
значение.

### Корневая причина

Все поверхности фронта (Send, адрес для reflection/skeleton, OAuth2-поля,
превью body) резолвят шаблоны через один IPC — `vars_resolve`. Его реализация
(`src-tauri/src/commands/vars.rs`, `vars_resolve_impl`) подставляет только
активное окружение; на месте переменных коллекции — пустая мапа с TODO
«populated in Plan #6». Команда не принимает контекст коллекции, поэтому TODO
нельзя было закрыть тривиально.

Сам алгоритм ядра (`crates/handshaker-core/src/vars/mod.rs`,
`resolve_template_with_diagnostics`) — многопроходный (до 4 проходов,
приоритет env > collection), то есть цепочка
`{{uri-root}}` → `{{notes-api-root}}` → значение заработает, как только
переменные коллекции попадут в `VariableSet`. Ядро менять не нужно.

## Решение (подход A: контекст-параметр у `vars_resolve`)

Отвергнутые альтернативы: (B) фронт всегда передаёт мапы переменных — лишняя
обвязка, значения гоняются через фронт; (C) перенос резолва на бэкенд в момент
invoke через `resolve_request` — пересборка invoke-пути, несоразмерно багу и
расходится с принятым в OAuth2-фиче дизайном «фронт резолвит по активному
окружению».

### 1. IPC: `vars_resolve(template, ctx?)`

Новый опциональный параметр:

```rust
#[derive(Debug, Default, serde::Deserialize, specta::Type)]
pub struct VarsResolveCtx {
    /// Переменные коллекции берутся из стора по id (живые пути).
    pub collection_id: Option<String>,
    /// Оверлей переменных коллекции (несохранённые ряды редактора);
    /// при наличии выигрывает у collection_id.
    pub collection_vars: Option<HashMap<String, String>>,
    /// Оверлей env-переменных (ряды env-редактора); при наличии
    /// выигрывает у активного окружения.
    pub env_vars: Option<HashMap<String, String>>,
}
```

`vars_resolve_impl(template, ctx)`:

- `env` = `ctx.env_vars` ?? переменные активного окружения ?? пусто;
- `collection` = `ctx.collection_vars` ?? `collection_store.get(ctx.collection_id)?.variables` ?? пусто;
  неизвестный/удалённый `collection_id` — молча пустая мапа, не ошибка;
- дальше как сейчас: `resolve_template_with_diagnostics` (env > collection).

`ctx = None` ⇒ поведение идентично текущему. Биндинги перегенерировать
(no-drift гейт). В IPC-DTO нет u64 — ограничение specta не затрагивается.

Клиент: `varsResolve(template, ctx?)` в `src/ipc/client.ts`; существующие
вызовы без ctx валидны без изменений.

### 2. Живые пути фронта: прокинуть контекст коллекции

Источник `collectionId`: для origin-bound черновика — `draftOrigin.collectionId`
из workflow store; черновик без origin ⇒ `null` (переменных коллекции у него
нет — поведение прежнее).

Чтобы не менять сигнатуру `varsResolve`-зависимости во всех потребителях,
вводится фабрика-резолвер:

```ts
/** (t) => ipc.varsResolve(t, collectionId ? { collection_id: collectionId } : undefined) */
export function varsResolverFor(collectionId: string | null): (t: string) => Promise<ResolutionReportIpc>;
```

Точки прокидывания (везде вместо голого `ipc.varsResolve`):

- `sendStep` → `resolveStepTemplates` (адрес, body, metadata);
- `resolveAddressSafe` → `buildRequestSkeletonSafe`, `fetchMessageSchemaSafe`
  (reflection/skeleton/schema дозваниваются на тот же резолвнутый хост, что и Send);
- `resolveAuthHeader` / `resolveOauthConfig` (OAuth2-поля — auth и так
  per-collection) — `CallPanel` передаёт резолвер в `AuthDeps.varsResolve`.

> **Поправка при планировании (2026-06-13):** `ResolvesPreview` (превью body)
> оказался мёртвым кодом — нигде не смонтирован, тестов нет. Вместо прокидывания
> `collectionId` он **удаляется** (конвенция проекта); его `hasVars`/стили
> переезжают в `VarResolveLine`. Индикация unresolved на Send-пути
> (`stepPatchFromSendResult`) сохраняется.

Существующая индикация Send-времени («Unresolved variables: …» в
`stepPatchFromSendResult`) сохраняется и автоматически становится корректной.

### 3. UI: строка-превью резолва под рядом переменной

Новый переиспользуемый компонент `src/features/vars/VarResolveLine.tsx`:

```ts
interface VarResolveLineProps {
  value: string;                                        // значение ряда
  resolver: (t: string) => Promise<ResolutionReportIpc>;
  resolveKey?: unknown;                                 // доп. deps ре-резолва (соседние ряды, активный env)
}
```

Поведение — как у `ResolvesPreview` (паттерн пользователю знаком):

- рендерится только когда `value` содержит `{{…}}` (тот же `hasVars`-regex,
  вынести в общий модуль; расширение regex на имена с пробелами — вне скоупа);
- дебаунс 300мс; три состояния, та же типографика
  (`text-xs font-mono`, однострочный ellipsis, полное значение в `title`):
  - `→ resolves: <значение>` (muted);
  - `⚠ Unresolved: <список>` (destructive);
  - `⚠ Cycle: <a → b → a>` (destructive).

Точки монтирования:

- **`VariablesBlock` (настройки коллекции):** под рядом, во второй колонке
  грида (под Value). Резолвер ряда:
  `(t) => ipc.varsResolve(t, { collection_vars: rowsAsMap })` — несохранённые
  ряды редактора оверлеем, env = активное окружение бэкенда. `resolveKey` =
  `[rowsAsMap, activeEnv]` — правка соседнего ряда или смена окружения
  пере-резолвит.
- **`EnvEditorDialog` (ряды `ValueCell`):** резолвер
  `(t) => ipc.varsResolve(t, { env_vars: editedRowsAsMap })` — превью честное
  для несохранённых правок и для неактивного окружения; переменные коллекции
  здесь не участвуют (env-редактор глобален, контекста коллекции нет).

Семантика мап из рядов: пустые ключи отбрасываются; при дубликатах ключей
последний ряд выигрывает.

Секреты: превью показывает резолвнутые значения открыто — так же, как уже
делает `ResolvesPreview` для body. OAuth2 `client_secret` живёт в auth-конфиге,
не в переменных, и этим компонентом не рендерится.

## Тесты

- **Ядро:** кросс-слойный кейс — значение collection-переменной ссылается на
  env-переменную (`collection: uri-root={{notes-api-root}}`,
  `env: notes-api-root=…`, шаблон `{{uri-root}}` ⇒ итоговое значение).
- **Tauri (`vars_resolve_impl`):** ctx-варианты — `collection_id` (лукап из
  стора), оверлеи `collection_vars`/`env_vars`, неизвестный id ⇒ пусто,
  `ctx=None` ⇒ прежнее поведение.
- **Фронт (vitest):** `VarResolveLine` (3 состояния, дебаунс, скрытие без
  `{{…}}`); `VariablesBlock`/env-редактор с превью; прокидывание ctx —
  `sendStep`/`resolveAddressSafe`/OAuth2-пути зовут `varsResolve` с
  `collection_id` origin-bound черновика и без ctx для unbound. Полный прогон
  vitest (новые экспорты ломают частичные `vi.mock`).

## Гейт

tsc clean · vitest полный · cargo workspace tests · bindings no-drift · build;
живая проверка в WebView2: репро из баг-репорта (`uri-root={{notes-api-root}}`
в коллекции + `{{uri-root}}` в адресе ⇒ успешный Send) + превью в обоих
редакторах.

## Вне скоупа

- Перенос резолва invoke-пути на бэкенд (`resolve_request` остаётся
  для будущей унификации).
- Расширение `hasVars`-regex (имена с пробелами детектятся ядром, но не
  фронтовым превью — как и сейчас в body-превью).
- Индикация резолва в иных поверхностях (адресная строка и т.п.) — там уже
  есть Send-время ошибки.
