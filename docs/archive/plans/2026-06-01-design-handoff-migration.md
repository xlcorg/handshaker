# Handshaker Design Handoff Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the updated Handshaker design (`docs/design_handoff_handshaker/`) into our existing Tauri + React + Tailwind + radix-ui codebase, using our components and patterns — not the prototype's CDN/Babel/window-export stack.

**Architecture:** The prototype is a multi-tab workspace with a collections-first sidebar, a Collection Overview, and address-first server connect. We re-implement that on our real stack. State moves from a single `draft` to a per-tab `tabs[]` array in `App.tsx`. The sidebar is rebuilt from `useCollections` (real IPC). Collection Overview is a new in-main-area panel wired to collection IPC. Server-registry-only features (Server Overview, Server Browser) and HTTP/REST are **out of scope this pass** (no backend support).

**Tech Stack:** React 18, TypeScript, Tailwind 4, radix-ui primitives, lucide-react, Monaco, Tauri v2, tauri-specta IPC bindings (`src/ipc/bindings.ts`).

**Verification model (read first):** This repo has **no test runner** (`package.json` exposes only `lint` = `tsc -b` and `build`). Per-task verification gate is therefore:
1. `pnpm lint` — typecheck passes (Run from repo root: `pnpm lint`).
2. `pnpm build` — production build passes.
3. Visual check via the `/run` skill (or `pnpm tauri:dev`) against the matching reference screen + README spec.
Commit after each task. Do **not** introduce a test framework — it is outside this design-migration's scope and the codebase pattern.

**Reference map (port from → into):**
| Reference file | Target |
|---|---|
| `app.jsx` `mkTab`/`RequestTabs`/`CloseConfirm`/`ConnectionBar`/heroes | `src/features/tabs/*`, `src/features/shell/*` |
| `sidebar.jsx` | `src/features/collections/tree/*` |
| `collection-overview.jsx` + `browser.jsx` `CollectionOverview` | `src/features/collections/overview/*` |
| `README.md` §§ Component-by-component, Design Tokens | sizing/colors/copy authority |

**Out of scope (decided with user 2026-06-01):** Server Overview, Server Browser, HTTP/REST UI + invoke, streaming response UI, any Rust/IPC changes, `StateBar`, `TweaksPanel`.

**Data-model adaptation (load-bearing — applies everywhere):**
The prototype references a server registry via `{ serverId, svc, mth }` and resolves host from `servers[]`. **Our model has no registry.** Each saved request (`SavedRequestIpc`) carries its own `address_template`, `service`, `method`, `body_template`, `metadata`, `auth_by_env`, `tls_override`. So:
- A "request" node = `SavedRequestIpc`; a "folder" node = `FolderIpc`; `ItemIpc = ({type:"folder"}&FolderIpc) | ({type:"request"}&SavedRequestIpc)`.
- Sidebar type marker is always the gRPC `"g"` glyph (HTTP deferred; streaming dormant). No `findMethod`/`findServer` lookups.
- "Targets" in Collection Overview = the distinct `address_template` values across the collection's requests.
- Selecting a request loads `address_template`/`service`/`method` into the active tab and fetches its body skeleton.
- Auth maps to `SavedAuthConfigIpc` = `none | env_var{env_var,header_name,prefix} | oauth_2_client_credentials`. UI auth methods: **No auth** → `none`; **Bearer** → `env_var{header_name:"authorization", prefix:"Bearer "}`; **API key** → `env_var{header_name:<custom>, prefix:""}`; **Basic** and **Mutual TLS** → shown **disabled** (lock + tooltip), because our model can't store two vars / client certs. OAuth is not surfaced in this UI.

---

## Phase 0 — Per-tab state model (foundation; everything depends on it)

Today `App.tsx` holds one `draft` + scattered `selected`/`outcome`/`sending`. We introduce a `tabs[]` array; each open request is a tab owning its own state. Scenarios kept: `connected`, `request`, `sending`, `success`, `error`, `idle`, `connecting`, `newServer`, `collection`. Dropped: `server`, `browse`, `streaming`.

### Task 0.1: Tab model + types

**Files:**
- Create: `src/features/tabs/tabModel.ts`

- [ ] **Step 1: Define the tab type and helpers.** Port `mkTab` semantics from `app.jsx:36-47`, adapted to our `DraftRequest` fields.

```ts
import { emptyDraft, type DraftRequest } from "@/features/collections/draft";
import { newId } from "@/lib/ids";
import type { SelectedMethod } from "@/features/shell/SelectedMethod";
import type { InvokeOutcomeIpc, ServiceCatalogIpc } from "@/ipc/bindings";

export type Scenario =
  | "connected" | "request" | "sending" | "success"
  | "error" | "idle" | "connecting" | "newServer" | "collection";

export type RequestTabState = {
  id: string;
  draft: DraftRequest;            // address, tls, service, method, body, metadata, auth, origin, dirty
  selected: SelectedMethod | null;
  catalog: ServiceCatalogIpc | null;
  scenario: Scenario;
  requestTab: "body" | "metadata" | "auth";
  responseTab: "body" | "trailers" | "headers";
  sending: boolean;
  outcome: InvokeOutcomeIpc | null;
  invokeError: string | null;
  reflectNote: string | null;
  openCollectionId: string | null; // when scenario === "collection"
};

export function mkTab(init: Partial<RequestTabState> = {}): RequestTabState {
  return {
    id: newId(),
    draft: init.draft ?? emptyDraft(),
    selected: init.selected ?? null,
    catalog: init.catalog ?? null,
    scenario: init.scenario ?? "newServer",
    requestTab: "body",
    responseTab: "body",
    sending: false,
    outcome: null,
    invokeError: null,
    reflectNote: null,
    openCollectionId: null,
    ...init,
  };
}

export function tabLabel(t: RequestTabState): string {
  if (t.draft.origin && t.selected) return t.selected.method;
  if (t.selected) return t.selected.method;
  const h = t.draft.address.trim();
  return h ? h : "New request";
}
```

- [ ] **Step 2: Verify.** Run `pnpm lint`. Expected: no type errors referencing `tabModel.ts`.
- [ ] **Step 3: Commit.** `git add src/features/tabs/tabModel.ts && git commit -m "feat(tabs): add per-tab state model"`

### Task 0.2: `useTabs` hook

**Files:**
- Create: `src/features/tabs/useTabs.ts`

- [ ] **Step 1: Implement the hook.** Port new/close/activate/patch from `app.jsx:49-103`. Closing the last tab replaces it with a fresh `newServer` draft. Dirty-close is surfaced via a `closing` pending tab (the confirm dialog lives in `App`).

```ts
import { useState, useCallback } from "react";
import { mkTab, type RequestTabState } from "./tabModel";

export function useTabs(initial?: RequestTabState[]) {
  const [tabs, setTabs] = useState<RequestTabState[]>(() => initial ?? [mkTab({ scenario: "newServer" })]);
  const [activeId, setActiveId] = useState<string>(() => (initial ?? [])[0]?.id ?? tabs[0].id);
  const [closing, setClosing] = useState<RequestTabState | null>(null);

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

  const patchTab = useCallback((id: string, p: Partial<RequestTabState> | ((t: RequestTabState) => Partial<RequestTabState>)) => {
    setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...(typeof p === "function" ? p(t) : p) } : t)));
  }, []);
  const patchActive = useCallback((p: Partial<RequestTabState> | ((t: RequestTabState) => Partial<RequestTabState>)) => {
    patchTab(active.id, p);
  }, [active.id, patchTab]);

  const newTab = useCallback(() => {
    const t = mkTab({ scenario: "newServer" });
    setTabs((ts) => [...ts, t]);
    setActiveId(t.id);
  }, []);

  const closeTab = useCallback((id: string) => {
    setTabs((ts) => {
      if (ts.length === 1) { const t = mkTab({ scenario: "newServer" }); setActiveId(t.id); return [t]; }
      const idx = ts.findIndex((x) => x.id === id);
      const next = ts.filter((x) => x.id !== id);
      setActiveId((cur) => (cur === id ? (next[idx] ?? next[idx - 1] ?? next[0]).id : cur));
      return next;
    });
  }, []);

  const requestClose = useCallback((t: RequestTabState) => {
    if (t.draft.dirty) setClosing(t); else closeTab(t.id);
  }, [closeTab]);

  return { tabs, setTabs, active, activeId, setActiveId, patchTab, patchActive, newTab, closeTab, requestClose, closing, setClosing };
}
```

- [ ] **Step 2: Verify.** `pnpm lint`. Expected: clean.
- [ ] **Step 3: Commit.** `git commit -am "feat(tabs): add useTabs hook"`

### Task 0.3: `RequestTabs` bar

**Files:**
- Create: `src/features/tabs/RequestTabs.tsx`

- [ ] **Step 1: Build the bar.** Port `app.jsx:410-476` exactly for sizing/behavior: `h-9 bg-card/50 border-b z-30`; each tab `min-w-[132px] max-w-[210px] border-r pl-3 pr-1.5`; active = `bg-background` + 1.5px top bar; inactive `hover:bg-accent/40`; label mono 12px truncate; `Plus` glyph before label when `!selected`; close button shows dirty dot (`bg-foreground/80`, swaps to × on hover, stays visible when dirty) else × on hover/active; middle-click (`onAuxClick` button===1) closes via `requestClose`; trailing 36px `+` button (`Plus`, `hover:bg-accent/50`, `border-r`). **Do not** render the streaming dot (MVP). Use `tabLabel` from `tabModel`.

Props: `{ tabs, activeId, onActivate, onClose, onNew }`. Use lucide `Plus`, `X`.

- [ ] **Step 2: Verify.** `pnpm lint`. Expected: clean.
- [ ] **Step 3: Commit.** `git commit -am "feat(tabs): RequestTabs bar"`

### Task 0.4: `CloseConfirm` dialog

**Files:**
- Create: `src/features/tabs/CloseConfirm.tsx`

- [ ] **Step 1: Build the dialog.** Port `app.jsx:479-498`. Our `Dialog` from `@/components/ui/dialog`. Title "Unsaved changes"; body `“{label}” has edits that haven't been saved yet. Close it anyway?`; footer **Cancel** (ghost) · **Discard** (outline, `text-destructive hover:bg-destructive/10 hover:text-destructive`) · **Save & close** (primary). Props `{ tab, onCancel, onDiscard, onSave }`; open when `tab != null`.

- [ ] **Step 2: Verify.** `pnpm lint`. Expected: clean.
- [ ] **Step 3: Commit.** `git commit -am "feat(tabs): CloseConfirm dialog"`

### Task 0.5: Rewire `App.tsx` onto the tab model

**Files:**
- Modify: `src/App.tsx` (replace single-draft state with `useTabs`)

- [ ] **Step 1: Replace state.** Swap `draft`/`selected`/`catalog`/`outcome`/`sending`/`reflectNote`/`guard` for `const tabs = useTabs()`. Read/write the **active** tab: derive `draft = active.draft`, `selected = active.selected`, etc., and route all setters through `tabs.patchActive`. Move the `describe` debounce, the catalog→selected auto-pick effect (`App.tsx:159-198`), and `handleSend`/`handleRefresh` to operate on the active tab (capture `active.id` for async completion, mirroring `app.jsx:165-176`). Render `<RequestTabs … />` between Titlebar and the main column. Replace the old `AlertDialog` unsaved-changes guard with `<CloseConfirm tab={tabs.closing} … />` whose **Save & close** opens `SaveRequestDialog`.
- [ ] **Step 2: Keep heroes/overview routing as placeholders for now** (return existing panes for non-`newServer`/`collection` scenarios). Phases 2 and 4 fill these in.
- [ ] **Step 3: Verify.** `pnpm lint && pnpm build`. App opens with a tab bar; +/close/middle-click/dirty-close all work; sending/selecting affect only the active tab.
- [ ] **Step 4: Commit.** `git commit -am "refactor(app): drive workspace from per-tab state"`

---

## Phase 1 — Single 36px titlebar (fold Toolbar in)

README §Titlebar: one `h-9` bar holds wordmark + env picker + sidebar/theme/settings + divider + window controls. Our `Toolbar` (h-12) and `Titlebar` (h-8) collapse into one.

### Task 1.1: Rewrite `Titlebar`, delete `Toolbar`

**Files:**
- Modify: `src/features/shell/Titlebar.tsx`
- Modify: `src/App.tsx` (remove `<Toolbar>`, pass env/settings props to `Titlebar`)
- Delete: `src/features/shell/Toolbar.tsx`

- [ ] **Step 1: Rebuild Titlebar.** Port `app.jsx:356-407` look, using our components. Structure: `tb-drag h-9 ... bg-card border-b z-40`. Left `tb-nodrag`: `LogoMark size={13}` + "Handshaker" (`text-[13px] font-semibold`) + `envSlot` (the `EnvPill`). Spacer `flex-1`. Right `tb-nodrag gap-0.5`: three `h-5 w-6 rounded-sm` ghost buttons — sidebar toggle (`PanelLeft`), theme toggle (`Sun`/`Moon`), settings (`Settings`), each `hover:bg-accent`. Divider `h-3.5 w-px bg-border`. Window controls (existing min/max/close), close `hover:bg-destructive`. Props: `{ envSlot: React.ReactNode; onOpenSettings: () => void }`; use `usePrefs` for sidebar/theme toggles. Drop the version badge from the header (version stays in Settings ▸ About).
- [ ] **Step 2: Update App.** Render `<Titlebar envSlot={<EnvPill …/>} onOpenSettings={() => setSettingsOpen(true)} />`; delete the `<Toolbar>` import + element; delete `Toolbar.tsx`.
- [ ] **Step 3: Verify.** `pnpm lint && pnpm build`. Single 36px header; env dropdown, theme, sidebar, settings, window controls all functional; drag region works.
- [ ] **Step 4: Commit.** `git commit -am "feat(shell): fold toolbar into single 36px titlebar"`

---

## Phase 2 — Address-first connect (newServer draft) + heroes

README §§ ConnectionBar, New request draft / Disconnected hero. Adds draft mode and the two hero empty-states; removes the stray leading "/".

### Task 2.1: ConnectionBar draft/connecting/connected modes

**Files:**
- Modify: `src/features/shell/ConnectionBar.tsx`
- Modify: `src/App.tsx` (wire `onConnect`, scenario)

- [ ] **Step 1: Extend props + behavior.** Add `draft: boolean`, `connecting: boolean`, `connected: boolean`, `onConnect: () => void`. Port `app.jsx:501-565`:
  - Draft mode: autofocus host input (`useEffect` + `setTimeout(...,40)`); shell gets `border-ring ring-1 ring-ring` (vs `border-input focus-within:ring-1`); **Enter** in host triggers `onConnect` when `host.trim()` non-empty.
  - Remove the leading `/` span (current `ConnectionBar.tsx:67`).
  - Hint text states (when no picker): `negotiating…` / `enter a server address` / `press Connect to discover methods` / `select a method` / `not connected`.
  - Buttons: when `!connected && !connecting` → **Connect** (primary, disabled if draft address empty); `connecting` → disabled spinner "Connecting"; `connected` → **Send** (existing). Keep Refresh only when connected.
- [ ] **Step 2: Wire App.** Add `onConnect`: from a `newServer`/`idle` draft → set tab `scenario:"connecting"`, then after `describe()` resolves set `connected` (replace the prototype's fake timer with the real `describe()` lifecycle — on success `connected`, on failure stay with `reflectNote`). Toggling TLS while connected → `idle`. `connected` is derived: `scenario` ∉ {idle, connecting, newServer}.
- [ ] **Step 3: Verify.** `pnpm lint && pnpm build`. New tab → empty focused address bar with ring; typing + Connect runs real reflection and reveals the method picker; TLS toggle drops to idle.
- [ ] **Step 4: Commit.** `git commit -am "feat(shell): address-first connect draft mode"`

### Task 2.2: NewRequestHero + DisconnectedHero

**Files:**
- Create: `src/features/shell/Heroes.tsx`
- Modify: `src/App.tsx` (render in main area by scenario)

- [ ] **Step 1: Build heroes.** Port `app.jsx:569-617` verbatim for copy/sizing. `NewRequestHero`: centered `+` tile, "New request", the exact one-liner ("Type a server address in the bar above and hit **Connect**. Handshaker runs reflection and lists every method — no dialog, no setup."), and `↑ address bar · ↵ to connect` hint (use our `Kbd`). **No** "Recent addresses" / `.proto` copy. `DisconnectedHero`: `connecting` → spinner + "Negotiating TLS…" + host; `idle` → "Disconnected" hero + reconnect copy.
- [ ] **Step 2: Route in App.** In the main area: `scenario === "newServer"` → `<NewRequestHero/>`; `scenario ∈ {idle, connecting}` → `<DisconnectedHero scenario host/>`; else the request/response panes (or Collection Overview, Phase 4).
- [ ] **Step 3: Verify.** `pnpm lint && pnpm build`. New tab shows NewRequestHero; idle/connecting show the right hero.
- [ ] **Step 4: Commit.** `git commit -am "feat(shell): new-request and disconnected heroes"`

---

## Phase 3 — Collections-first sidebar

README §Sidebar. Replace the tabbed (Services/History/Saved) shell with a single collections tree from `useCollections`. No server level; type marker `"g"`; hover-⋯ + right-click delete.

### Task 3.1: Extend `useCollections` for tree ops

**Files:**
- Modify: `src/features/collections/useCollections.ts`

- [ ] **Step 1: Expose the remaining IPC.** Add wrappers used by the tree: `renameItem(collectionId,itemId,name)` → `collectionRenameItem`; `deleteItem(collectionId,itemId)` → `collectionDeleteItem` (returns undo snapshot — store nothing for now, just refresh); `duplicateItem`; `moveItem`. Each calls the `commands.*` and then re-`load`s the affected collection. Keep return shape additive.
- [ ] **Step 2: Provide a `tree` view.** Add a `loadAll()` that loads every collection (`metas` → `load` each) into full `CollectionIpc[]`, memoized, refreshed on mutation. (Fixtures fallback: if `!isTauri()`, return an in-memory sample mirroring `data.js` `collections[]` so the tree renders in the browser preview.)
- [ ] **Step 3: Verify.** `pnpm lint`. Clean.
- [ ] **Step 4: Commit.** `git commit -am "feat(collections): tree CRUD + loadAll on useCollections"`

### Task 3.2: Tree utilities + RowMenu

**Files:**
- Create: `src/features/collections/tree/treeUtils.ts`
- Create: `src/features/collections/tree/RowMenu.tsx`
- Create: `src/features/collections/tree/ReqTypeTag.tsx`

- [ ] **Step 1: treeUtils.** Port `sidebar.jsx` `countRequests`, `allContainerIds`, `pathToSelected`, `filterNode` — retyped over `ItemIpc`/`CollectionIpc`. Match against `request.name`, `request.service`, `request.method`, `request.address_template`. A request is "saved" iff `name` is non-empty (our `SavedRequestIpc.name` is always a string; treat empty/whitespace as a bare pinned method).
- [ ] **Step 2: RowMenu.** Port `sidebar.jsx:107-182`: hover-⋯ button (absolute, `bg-background/85 backdrop-blur-sm`) **and** right-click (`onContextMenu`) open the same fixed floating list; closes on outside `pointerdown` / `Escape` / `scroll`. `Delete` is the only `danger` (red) item. Props `{ items: MenuItem[]; children; padRight? }`.
- [ ] **Step 3: ReqTypeTag.** Port the gRPC branch only: quiet `font-mono text-[11px] font-semibold text-stream/70` `"g"`. (HTTP verb + stream-arrow branches omitted this pass.)
- [ ] **Step 4: Verify.** `pnpm lint`. Clean.
- [ ] **Step 5: Commit.** `git commit -am "feat(collections): tree utils + row context menu"`

### Task 3.3: Tree nodes + sidebar shell

**Files:**
- Create: `src/features/collections/tree/CollectionsSidebar.tsx` (shell: filter input + New-request `+` + overflow ⋯; body = tree; empty states)
- Create: `src/features/collections/tree/CollectionNode.tsx`
- Create: `src/features/collections/tree/FolderNode.tsx`
- Create: `src/features/collections/tree/RequestRow.tsx`
- Modify: `src/App.tsx` (replace `<Sidebar>` + panes with `<CollectionsSidebar>`)
- Delete: `src/features/shell/Sidebar.tsx`, `SidebarServicesPane.tsx`, `SidebarHistoryPane.tsx`, `SidebarCollectionsPane.tsx`

- [ ] **Step 1: Build nodes.** Port `sidebar.jsx:364-455`, using plain divs/buttons (we have no shadcn `Sidebar*` family — keep the existing `aside w-[300px]` shell style, widened from 260 to ~300). Preserve sizes: collection row `!h-[24px] !text-[12px] text-foreground/80` with absolute left chevron + trailing mono count; folder row `!h-[22px] !text-[11.5px]` muted, chevron+folder+name+count, **empty folders hidden**; request row `!h-[22px] !text-[11.5px]` with `ReqTypeTag` + label (saved → `font-sans`, pinned → `font-mono`) + active 2px left bar + right-anchored tooltip (signature + `address_template`). Selecting a request calls `onSelect(req)`.
- [ ] **Step 2: Build shell.** Port `sidebar.jsx:232-360` header: filter input (leading filter icon, placeholder "Filter collections & requests") + New-request `+` (ghost, opens a `newServer` tab) + overflow ⋯ (`RowActions`: New collection · Reveal active · Expand all · Collapse all · Import… · Export…). Empty states: no collections (centered block + New collection / Import buttons); filter-no-match ("Nothing matches …"); per-collection no-requests inline row. Auto-open path to active request on mount.
- [ ] **Step 3: Wire App.** `onSelect(req)` → load into active tab: set `draft.address = req.address_template`, `selected = {service, method, kind: "unary"}`, fetch body skeleton (`ipc.grpcBuildRequestSkeleton` like the existing flow), set `draft.metadata`/`auth` from the saved request, `draft.origin = {collectionId, itemId}`, `dirty:false`. `onOpenCollection(col)` → set active tab `scenario:"collection"`, `openCollectionId: col.id`. Delete/rename via `useCollections`.
- [ ] **Step 4: Verify.** `pnpm lint && pnpm build`. Sidebar shows the real collections tree; expand/collapse, select-to-open, hover-⋯ + right-click delete, filter, empty states all behave.
- [ ] **Step 5: Commit.** `git commit -am "feat(collections): collections-first sidebar tree"`

---

## Phase 4 — Collection Overview

README §Collection Overview. New in-main-area panel (not a modal), tabs Overview · Authorization · Variables · Settings, opened by clicking a collection.

### Task 4.1: Overview building blocks

**Files:**
- Create: `src/features/collections/overview/COTabs.tsx`
- Create: `src/features/collections/overview/COBlock.tsx`
- Create: `src/features/collections/overview/EnvVarField.tsx`
- Create: `src/features/collections/overview/MiniSelect.tsx`
- Create: `src/features/collections/overview/CollectionTitle.tsx`
- Create: `src/features/collections/overview/DescriptionBlock.tsx`
- Create: `src/features/collections/overview/VariablesBlock.tsx`
- Create: `src/features/collections/overview/TlsBlock.tsx`
- Create: `src/features/collections/overview/AuthBlock.tsx`

- [ ] **Step 1: Port blocks.** Port `collection-overview.jsx:15-325` 1:1 for look/copy: `COTabs` (underline tabs with optional count hint, `h-9 px-3 border-b bg-card/40`), `COBlock` (icon + title + desc + `pl-[27px]` body), `EnvVarField` (`{}`-prefixed mono input, value is a **variable name**), `MiniSelect` (DropdownMenu with disabled+lock options), `CollectionTitle` (inline edit, Enter/Esc), `DescriptionBlock` (view/edit/empty, Save/Cancel/Esc), `VariablesBlock` (Name/Value grid + add/remove + empty state), `TlsBlock` (TLS switch + skip-verify only-when-TLS + warn banner), `AuthBlock` (env segmented selector + `MiniSelect` method + per-method env-var fields + footer note). Auth method options: `none`, `bearer`, `apikey` enabled; `basic`, `mtls` **disabled** with lock + tooltip ("Not supported by the current backend"). Wire each block's `onChange` up via props (controlled) rather than local-only state, so Task 4.2 can persist.
- [ ] **Step 2: Verify.** `pnpm lint`. Clean.
- [ ] **Step 3: Commit.** `git commit -am "feat(collections): collection-overview building blocks"`

### Task 4.2: CollectionOverview panel + persistence

**Files:**
- Create: `src/features/collections/overview/CollectionOverview.tsx`
- Modify: `src/App.tsx` (render when `scenario === "collection"`)
- Modify: `src/features/collections/useCollections.ts` (ensure `setVariables`, `authSetForEnv`, `delete` exposed)

- [ ] **Step 1: Build the panel.** Port `browser.jsx` `CollectionOverview` (shipping path) + `collection-overview.jsx:383-458` layout: header `h-12` (Layers + `CollectionTitle` + "N folders · M requests" summary + Export outline + close ×), `COTabs`, centered `max-w-[680px]` scroll body. Tabs:
  - **Overview**: empty-state callout if no requests; `DescriptionBlock`; **Targets** = distinct `address_template`s as mono chips; **Requests** grouped by folder (recursive rows, click → open request).
  - **Authorization**: `AuthBlock` over `data.environments` (our `envList`) and `collection.auth_by_env`.
  - **Variables**: `VariablesBlock` over `collection.variables`.
  - **Settings**: `TlsBlock` (from `collection.default_tls`/`skip_tls_verify`) + Danger-zone delete with the in-panel `absolute inset-0` confirm overlay (port `collection-overview.jsx:437-455`).
- [ ] **Step 2: Persist.** On block changes call IPC: title → `collectionUpsert`/rename; description → `collectionUpsert`; variables → `collectionSetVariables`; auth → `authSetForEnv(collectionId, null, envName, config)`; TLS → `collectionUpsert`; delete → `collectionDelete` then close panel + refresh tree. (Map UI auth ↔ `SavedAuthConfigIpc` per the data-model adaptation.) For `!isTauri()` preview, mutate the in-memory fixture.
- [ ] **Step 3: Route in App.** When active tab `scenario === "collection"`, render `<CollectionOverview collectionId={active.openCollectionId} onClose={…→ scenario:"connected"} onSelectMethod={…load request} />` instead of the panes.
- [ ] **Step 4: Verify.** `pnpm lint && pnpm build`. Click a collection → overview; edit title/description/variables/auth/TLS persists (reopen shows saved); delete asks in-panel then removes from the tree.
- [ ] **Step 5: Commit.** `git commit -am "feat(collections): collection overview panel"`

---

## Phase 5 — Request/Response panels polish + env-var auth

Our panes already match closely (underline tabs, Monaco body, metadata KV, RespMeta, empty states). This pass aligns tokens/copy and switches request auth to env-var references.

### Task 5.1: Request-pane auth → env-var references

**Files:**
- Modify: `src/features/invoke/AuthInline.tsx`

- [ ] **Step 1: Replace raw-secret inputs.** Current `AuthInline` collects raw bearer token / basic user+pass. Replace with the env-var-name model used in `AuthBlock`: methods `No auth` / `Bearer` / `API key` (functional via `env_var`); `Basic` / `Mutual TLS` disabled (lock + tooltip). Use `EnvVarField` (reuse from `overview/`). Persist into `draft.auth` as our `SavedAuthConfigIpc`. Keep the `ToggleGroup` styling.
- [ ] **Step 2: Verify.** `pnpm lint && pnpm build`. Auth tab references env-var names only; no raw-secret fields remain.
- [ ] **Step 3: Commit.** `git commit -am "feat(invoke): auth references env-var names, not secrets"`

### Task 5.2: Token/copy alignment pass

**Files:**
- Modify: `src/features/invoke/RequestPanel.tsx`, `src/features/response/ResponsePanel.tsx`, `RespMeta.tsx`, `EmptyState.tsx` (only where they diverge)

- [ ] **Step 1: Reconcile against README §§ Request pane / Response pane / Underline tabs.** Verify pane-head `h-10`, underline tab active bar `left-2 right-2 -bottom-px h-[1.5px] bg-foreground`, status pill colors (`--ok`/`--destructive`), latency/size mono 11px, idle/sending empty-state copy. Fix only mismatches (most already conform). Confirm **no streaming** surfaces (no Stream pill, no streaming response pane).
- [ ] **Step 2: Verify.** `pnpm lint && pnpm build`. Panes visually match the reference; success/error/idle/sending states correct.
- [ ] **Step 3: Commit.** `git commit -am "polish(panels): align request/response to design tokens"`

---

## Phase 6 — Cleanup & guardrails

### Task 6.1: Remove dead code; confirm review-only affordances absent

**Files:**
- Delete any now-unused: `src/features/shell/Sidebar.tsx` family (if not already removed in 3.3), `Toolbar.tsx` (removed in 1.1), `SidebarTab` type references.
- Modify: `src/App.tsx` (drop `sideTab`/`sideQuery` state + `SidebarTab` import)

- [ ] **Step 1: Grep + remove.** `rg "SidebarTab|SidebarServicesPane|SidebarHistoryPane|SidebarCollectionsPane|features/shell/Toolbar"` → remove every reference. Confirm there is **no** `StateBar` or `TweaksPanel` anywhere (there isn't — verify), and the tweak *values* (theme/density/sidebar/split/fonts/dots) remain wired through `usePrefs` + Settings.
- [ ] **Step 2: Verify.** `pnpm lint && pnpm build`. No unused-import/type errors; app boots clean.
- [ ] **Step 3: Commit.** `git commit -am "chore: remove superseded sidebar/toolbar code"`

### Task 6.2: Final visual sweep

- [ ] **Step 1:** Launch via `/run` (or `pnpm tauri:dev`). Walk every screen against README: titlebar, tabs (incl. dirty-close), address-first connect + heroes, collections tree (delete via ⋯ and right-click), Collection Overview (all four tabs + delete confirm), request/response panes, env dropdown, settings. Note any pixel/copy drift and fix inline.
- [ ] **Step 2: Commit** any fixes. `git commit -am "polish: final design-handoff sweep"`

---

## Self-review (coverage vs README)

- Multi-tab workspace + dirty-close confirm → Phase 0 ✓
- Single 36px titlebar → Phase 1 ✓
- Address-first connect (newServer draft, no Add-server dialog) + heroes → Phase 2 ✓
- Collections-first sidebar (Collection→Folder→Request, no server level), hover-⋯ + right-click delete, type markers → Phase 3 ✓
- Collection Overview (Overview/Auth/Variables/Settings), env-var auth, in-panel delete → Phase 4 ✓
- Auth by env-var name (request + collection) → Phases 4–5 ✓
- Underline tabs / tokens / panes polish → Phase 5 ✓
- No StateBar, no Tweaks panel, tweak values as real prefs → Phase 6 ✓ (already true)
- MVP: no streaming surfaced → enforced in Tasks 0.3, 5.2 ✓
- No server color tags (env dot only) → inherent (we never add per-server dots) ✓

**Deferred (out of scope, tracked for a follow-up plan):** Server Overview, Server Browser, HTTP/REST (sidebar verb tags, HTTP invoke, verb-colored markers), Basic/mTLS auth storage, streaming. These need backend work first.
