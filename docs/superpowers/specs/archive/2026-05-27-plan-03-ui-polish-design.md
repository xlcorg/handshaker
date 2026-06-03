# Plan #3 UI Polish — Design

> Sub-plan / follow-up to [Plan #3 — Dynamic Unary Invoke](2026-05-27-plan-03-dynamic-invoke-design.md). Restores Monaco (bundled locally), brings Response panel closer to master spec §8.4 with Postman-style status placement, adds Send hotkey, reconciles deviations via errata.

## 0. Sources

- Master spec: `2026-05-26-handshaker-mvp-design.md` §8.4 (Main pane — Request view), §9 (Hotkeys).
- Plan #3 design: `2026-05-27-plan-03-dynamic-invoke-design.md` §9 (UI surface), D6 (`<details>` for trailers).
- Verified claims (memory rule):
  - `@monaco-editor/react` supports `loader.config({ monaco })` since v4.4.0 (installed: 4.7.0). [npm](https://www.npmjs.com/package/@monaco-editor/react)
  - Vite v6 supports `?worker` imports natively, no plugin needed.
  - Default `@monaco-editor/loader` fetches AMD modules from `cdn.jsdelivr.net`; can be a liability in offline / restricted-CSP environments. [Issue #217](https://github.com/suren-atoyan/monaco-react/issues/217)

## 1. Цель и scope

**Цель:** довести UI Plan #3 до состояния, ближе к мастер-спеке §8.4, без вторжения в зоны будущих плэнов.

**Что включено (L2):**
1. Monaco восстановлен в `BodyEditor` / `BodyView`, бандлится локально (без CDN).
2. Response panel: `<details>`-trailers → shadcn Tabs `Body | Trailers (n)`.
3. StatusBar — Postman-style: компактная pill справа от tab strip; status message — отдельная inline strip ниже tab strip только при ошибке.
4. Send hotkey `Ctrl+Enter` / `⌘↵` в `InvokePanel`.
5. Errata-файл, документирующий 6 deviations от мастер-спеки и Plan #3 design.

**Что НЕ включено (explicit deferrals):**
- Address bar §8.4 redesign (TLS toggle + address + method picker dropdown + Send в одну строку) — picker это Plan #7.
- Request tabs `Body | Metadata | Settings` — Metadata Plan #5, Settings Plan #6.
- «resolves: ... preview line» под address bar — Plan #4 (env + vars).
- `{{var}}` syntax highlighting в Monaco — Plan #4.
- JSON schema validation в Monaco из proto descriptors — отдельный sub-plan (мастер §7 line 542).
- Collections sidebar / breadcrumbs из §8.4 — Plan #6.

## 2. Зависимости

**Новые runtime:**
- `monaco-editor` (~4MB minified, lazy-chunked via Vite).

**Новые dev:**
- `@radix-ui/react-tabs` (приходит с `shadcn add tabs`).

**Уже установлено и не трогаем:** `@monaco-editor/react@4.7.0`, `@monaco-editor/loader` (транзитивно).

**shadcn add:**
```bash
pnpm dlx shadcn@latest add tabs
```

## 3. Файловая структура

| Файл | Действие |
|---|---|
| `src/lib/monaco.ts` | Rewrite: `loader.config({ monaco })` + Vite `?worker` imports |
| `src/features/invoke/BodyEditor.tsx` | Rewrite: `<MonacoEditor>` под `<Suspense>` |
| `src/features/invoke/InvokePanel.tsx` | Modify: Ctrl+Enter / ⌘↵ keydown listener |
| `src/features/response/BodyView.tsx` | Rewrite: `<MonacoEditor>` read-only |
| `src/features/response/ResponsePanel.tsx` | Rewrite: shadcn Tabs + Postman-style status |
| `src/features/response/StatusBar.tsx` | Modify: компактная inline pill (убрать message, padding, border) |
| `src/features/response/TrailersView.tsx` | Modify: убрать `<details>` обёртку — рендер только `<dl>` |
| `src/components/ui/tabs.tsx` | NEW — shadcn add |
| `package.json` | +`monaco-editor` |
| `pnpm-lock.yaml` | updated |
| `docs/superpowers/errata/2026-05-27-plan-03-ui-polish.md` | NEW |
| `vite.config.ts` | без изменений (`?worker` native в Vite 6) |

## 4. Monaco local bundle

### 4.1 `src/lib/monaco.ts`

```ts
import { lazy } from "react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import loader from "@monaco-editor/loader";

// Bundle Monaco locally — no CDN dependency. Desktop apps need to work offline.
self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === "json") return new jsonWorker();
    return new editorWorker();
  },
};
loader.config({ monaco });

// Lazy so the ~4MB Monaco bundle stays out of the initial chunk.
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

export const READ_ONLY_OPTIONS = { ...EDITOR_OPTIONS, readOnly: true } as const;

export const MONACO_THEME = "vs-dark" as const;
```

### 4.2 Workers загружаемые

| Worker | Грузим? | Почему |
|---|---|---|
| `editor.worker` | да | базовый, требуется Monaco |
| `json.worker` | да | request/response — JSON |
| ts/css/html/* workers | нет | не используются, экономим chunks |

### 4.3 BodyEditor / BodyView

Возвращаются к виду из Plan #3 design §9.3:

```tsx
// BodyEditor.tsx
export function BodyEditor({ value, onChange }: BodyEditorProps) {
  return (
    <Suspense fallback={<div className="text-sm text-muted-foreground p-4">Loading editor…</div>}>
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

// BodyView.tsx
export function BodyView({ json }: BodyViewProps) {
  return (
    <Suspense fallback={<div className="text-sm text-muted-foreground p-4">Loading viewer…</div>}>
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

### 4.4 Bundle size

- Initial bundle: ~217KB (unchanged — Monaco не входит).
- При первом монтировании `<BodyEditor>` или `<BodyView>` — lazy-загрузка ~4MB Monaco core + ~1MB JSON worker как отдельные chunks.

## 5. Response tabs + Postman-style status

### 5.1 Целевая раскладка

```
┌──────────────────────────────────────────────────────────┐
│ Body  Trailers (4)              ● INTERNAL · 1ms · 0B    │  ← tab strip + status справа
├──────────────────────────────────────────────────────────┤
│ ⚠ Internal error: Internal Server Error                  │  ← inline message ТОЛЬКО при !OK
├──────────────────────────────────────────────────────────┤
│ { ...Monaco JSON r/o, или "No response body..." }         │
└──────────────────────────────────────────────────────────┘
```

### 5.2 ResponsePanel.tsx

```tsx
import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StatusBar } from "./StatusBar";
import { BodyView } from "./BodyView";
import { TrailersView } from "./TrailersView";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

export interface ResponsePanelProps {
  outcome: InvokeOutcomeIpc;
}

export function ResponsePanel({ outcome }: ResponsePanelProps) {
  const [tab, setTab] = useState<"body" | "trailers">("body");
  const trailerCount = Object.keys(outcome.trailing_metadata ?? {}).length;
  const isError = outcome.status_code !== 0;

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as "body" | "trailers")} className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b border-border px-3">
        <TabsList className="bg-transparent p-0 h-9">
          <TabsTrigger value="body" className="text-xs">Body</TabsTrigger>
          <TabsTrigger value="trailers" className="text-xs">
            Trailers ({trailerCount})
          </TabsTrigger>
        </TabsList>
        <StatusBar outcome={outcome} />
      </div>
      {isError && outcome.status_message && (
        <div className="border-l-2 border-destructive bg-destructive/5 px-3 py-1.5 text-xs text-destructive">
          {outcome.status_message}
        </div>
      )}
      <TabsContent value="body" className="flex-1 min-h-0 m-0">
        {outcome.response_json !== null && outcome.response_json !== undefined ? (
          <BodyView json={outcome.response_json} />
        ) : (
          <div className="text-sm text-muted-foreground p-4 italic">
            No response body (status code {outcome.status_code}).
          </div>
        )}
      </TabsContent>
      <TabsContent value="trailers" className="flex-1 min-h-0 m-0 overflow-auto">
        <TrailersView trailers={outcome.trailing_metadata} />
      </TabsContent>
    </Tabs>
  );
}
```

### 5.3 StatusBar.tsx

```tsx
import { statusName, formatBytes } from "@/lib/grpc-status";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

export interface StatusBarProps {
  outcome: InvokeOutcomeIpc;
}

export function StatusBar({ outcome }: StatusBarProps) {
  const isOk = outcome.status_code === 0;
  const dotColor = isOk ? "bg-[oklch(0.7_0.16_145)]" : "bg-[oklch(0.704_0.191_22.216)]";
  const size = outcome.response_json
    ? new TextEncoder().encode(outcome.response_json).length
    : 0;
  return (
    <div className="flex items-center gap-2 text-xs font-mono">
      <span className={`inline-block w-2 h-2 rounded-full ${dotColor}`} aria-hidden />
      <span>{statusName(outcome.status_code)}</span>
      <span className="text-muted-foreground">·</span>
      <span>{outcome.elapsed_ms}ms</span>
      <span className="text-muted-foreground">·</span>
      <span>{formatBytes(size)}</span>
    </div>
  );
}
```

(Status message NOT included — it lives separately в ResponsePanel.)

### 5.4 TrailersView.tsx

```tsx
export interface TrailersViewProps {
  trailers: Partial<{ [key: string]: string }>;
}

export function TrailersView({ trailers }: TrailersViewProps) {
  const entries = Object.entries(trailers ?? {});
  if (entries.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground italic">No trailers.</div>;
  }
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 p-3 text-xs font-mono">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="break-all">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
```

### 5.5 Tab state behaviour

- `tab` — локальный `useState`, default `"body"`.
- НЕ сбрасывается при смене `outcome` — если юзер открыл Trailers и сделал новый Send, остаётся на Trailers.
- При смене `selected` (другой метод) — `outcome` сбрасывается в null, ResponsePanel не рендерится → state эфемерный, ничего сохранять не надо.

## 6. Hotkey ⌘↵ / Ctrl+Enter

### 6.1 InvokePanel.tsx

Добавляется `useEffect`:

```tsx
useEffect(() => {
  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !busy) {
      e.preventDefault();
      handleSend();
    }
  }
  window.addEventListener("keydown", onKeydown);
  return () => window.removeEventListener("keydown", onKeydown);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- handleSend captures body via closure
}, [busy, body, selected.service, selected.method]);
```

- Listener живёт пока InvokePanel смонтирован (после клика на метод).
- Не срабатывает если `busy === true`.
- `e.preventDefault()` — чтобы Monaco не вставил newline на Ctrl+Enter в editor focused state. (Monaco на Cmd/Ctrl+Enter по умолчанию ничего не делает в JSON, но preventDefault безопасен.)

### 6.2 Visual hint

Send button получает aria-keyshortcuts:

```tsx
<Button onClick={handleSend} disabled={busy} size="sm" aria-keyshortcuts="Control+Enter Meta+Enter">
  {busy ? "Sending…" : "Send"}
</Button>
```

Tooltip с `⌘↵ / Ctrl+Enter` — opt-in, можно отложить (shadcn Tooltip компонент нужно добавлять). На текущем шаге достаточно aria.

## 7. Тесты / verification

### 7.1 Что покрывают автоматические тесты

**Frontend юнит-тестов в проекте сейчас нет.** Verification — manual UI smoke против live gRPC сервиса (127.0.0.1:5002), как в Plan #3 Task 17.

### 7.2 Manual smoke checklist

После имплементации:

1. **Connect** → catalog populated. ✓ (regression: должно остаться рабочим)
2. **Click метод** → InvokePanel появляется, Monaco editor загружается (~1 sec на первый mount), skeleton отображается с syntax highlighting. ✓
3. **Edit JSON** в editor — autocomplete brackets, syntax check работают. ✓
4. **Send (button)** — outcome приходит, ResponsePanel показывает tabs. ✓
5. **Send (Ctrl+Enter / ⌘↵)** — outcome приходит. ✓
6. **OK response** — green dot, message strip отсутствует, Body tab показывает Monaco r/o с JSON. ✓
7. **Error response** (status_code != 0) — red dot, inline message strip под табами с текстом ошибки. ✓
8. **Trailers tab** — переключение работает, count корректный, `Trailers (0)` показывается. ✓
9. **Switch method** — Monaco не перемонтирует базу (lazy chunk кэшируется в браузере), skeleton обновляется. ✓
10. **Offline test** — отключить интернет, перезапустить Tauri, повторить п. 2-5 — всё работает. (offline-safe verification.)

### 7.3 Rust тесты

Не затрагиваются. `cargo test --workspace` — должен по-прежнему: 50 passed + 1 ignored.

### 7.4 Build verification

- `pnpm lint` (= `tsc -b`) — clean.
- `pnpm build` — Vite output показывает Monaco в отдельных chunks (`monaco-*.js`, `json-*.js` или подобное). Initial bundle ≤ 220KB.

## 8. Deviations & errata

Sub-plan создаёт расхождения с двумя предыдущими документами. Все они должны быть документированы в новом errata-файле.

### 8.1 `docs/superpowers/errata/2026-05-27-plan-03-ui-polish.md`

Содержит таблицу с 6 пунктами:

| # | Document § | Original | Revised | Reason |
|---|---|---|---|---|
| 1 | Plan #3 design D6 / §9.2 (Trailers) | `<details>` collapsible | shadcn Tabs `Body | Trailers (n)` | Приближение к мастер §8.4, прямой запрос пользователя |
| 2 | Plan #3 design §9.2 (Trailers 0-key) | «Не рендерим если 0 ключей» | Показываем `Trailers (0)` всегда | Layout stability — табы не должны появляться/исчезать |
| 3 | Plan #3 design §9.3 (Monaco loading) | `lazy(() => import('@monaco-editor/react'))` с default CDN loader | + `loader.config({ monaco })` + Vite `?worker` imports | Offline-safe для desktop app; устраняет CDN-зависимость |
| 4 | Master §8.4 (StatusBar) | Над табами отдельной строкой | Postman-style: справа от tab strip компактной pill | Лучше использует горизонтальное пространство; знакомо gRPC-пользователям из Postman/Bruno |
| 5 | Plan #3 design §9.2 (status message) | Inline в StatusBar | Отдельная inline-strip ниже tab strip, только при !OK | StatusBar справа должен быть компактен (limited width рядом с табами) |
| 6 | Master §9 (Send hotkey) | `⌘↵ / Ctrl+Enter` | Реализован в Plan #3 UI Polish (пропущено в Plan #3) | Master mandate; пропущен по недосмотру в Plan #3 §13 |

Errata-файл коммитится отдельным коммитом ДО implementation (как audit trail), затем references из commit-сообщений implementation коммитов.

## 9. Что НЕ строим в этом sub-plan (явно)

- Все Plan #4-#7 фичи из §8.4 (см. §1).
- Custom Monaco theme — `vs-dark` достаточно близок к shadcn new-york dark.
- Tooltip с keyshortcut hint — opt-in, не критичен.
- JSON schema generation из proto — отдельный sub-plan.
- Loading skeleton / shimmer для Monaco lazy load — fallback `"Loading editor…"` достаточен.

## 10. Открытые риски

| # | Risk | Mitigation |
|---|---|---|
| R1 | `self.MonacoEnvironment` сетится до `loader.config({ monaco })` import порядка — race? | Оба синхронные top-level statements в `monaco.ts`, исполняются в порядке записи. Документировано комментом. |
| R2 | Vite `?worker` тип не резолвится в TypeScript | Vite v6 предоставляет тип через `vite/client` (уже в `tsconfig.json`); если нет — добавить `/// <reference types="vite/client" />` в `vite-env.d.ts` |
| R3 | Monaco initial mount тормозит UI на медленных машинах | Lazy chunk + `<Suspense fallback="Loading editor…">` — пользователь видит явный feedback |
| R4 | Ctrl+Enter listener конфликтует с Monaco's built-in keybindings | Monaco не назначает Ctrl+Enter в JSON mode по умолчанию. `e.preventDefault()` страхует от случайного newline-вставления. |
| R5 | Bundle weight (~4MB Monaco) уменьшает install size acceptable? | Monaco — индустриальный стандарт (VS Code, GitHub web), 4MB для desktop app приемлемо. |

## 11. Что попадёт в implementation

| Task | File(s) | Type |
|---|---|---|
| 1 | `pnpm add monaco-editor`, `pnpm dlx shadcn@latest add tabs` | install |
| 2 | `src/lib/monaco.ts` rewrite | edit |
| 3 | `src/features/invoke/BodyEditor.tsx` rewrite | edit |
| 4 | `src/features/response/BodyView.tsx` rewrite | edit |
| 5 | `src/features/response/StatusBar.tsx` modify (компактная pill) | edit |
| 6 | `src/features/response/TrailersView.tsx` modify (без `<details>`) | edit |
| 7 | `src/features/response/ResponsePanel.tsx` rewrite (Tabs + inline message strip) | edit |
| 8 | `src/features/invoke/InvokePanel.tsx` modify (Ctrl+Enter listener) | edit |
| 9 | Errata write + commit | new file |
| 10 | Manual UI smoke против 127.0.0.1:5002 (10-step checklist из §7.2) | manual |
| 11 | Offline manual smoke (выключить сеть, повторить) | manual |
| 12 | `pnpm lint`, `pnpm build`, `cargo test --workspace` — final verification | verification |
