# Handoff: Handshaker — gRPC / HTTP Desktop API Client

## Overview
Handshaker is a desktop client for invoking **gRPC** services — think "Postman, but for gRPC" — that also handles plain **HTTP/REST** endpoints. Users register a server by address (e.g. `orders.api.example.com:443`), discover its services via reflection, organize requests into **collections**, pick a `Service.Method` (or an HTTP verb + path), edit a request body in JSON, send it, and inspect the response (body, trailers, headers, errors).

The shipped workspace is **Focus**: one request in the main area (`src/features/workflow/FocusView.tsx`). A **collections-first sidebar** holds the saved requests, and clicking a collection opens **Collection Overview** (`src/features/catalog/overview/CollectionOverview.tsx`). Streaming gRPC ships next to unary gRPC and HTTP. This folder is the **visual-token source** (color, type, spacing, component shape). The in-design **Tweaks** panel is prototype-only.

> **Read these load-bearing decisions first.** Shipped behavior is the code plus the archived specs under `docs/archive/`. Sections below that describe request tabs, Server Overview, Server Browser, or the floating state bar are the prototype. Do not rebuild them. Do not change the tokens in **Design Tokens**.
>
> 0. **Streaming ships.** Unary gRPC, HTTP, and server / client / bidi streaming are in the product. Behavior: `docs/archive/2026-10-04-streaming-rpcs/spec.md`. A stream's response pane is `src/features/stream/StreamView.tsx` (Messages timeline, Headers, Trailers, Contract, Save messages, Assemble). Server-streaming uses Send, which becomes Cancel while the call is open. Client and bidi use Open, then Send message / End stream / Cancel (`src/features/workflow/DraftAddressBar.tsx`). The method picker and address bar show a `stream` / `client` / `bidi` badge (`src/features/shell/KindBadge.tsx`). The sidebar does not: every gRPC row is one `gRPC` mark (`src/features/catalog/RequestRow.tsx`, `GRPC_METHOD_MARK` in `src/features/http/model.ts`). The prototype's `streaming` scenario is a design preset, not a ban.
> 1. **The workspace is Focus, one request at a time.** Ledger and List are gone; Focus is the only request view ([#41](https://github.com/xlcorg/handshaker/pull/41)). The main area is `FocusView` or Collection Overview (`src/app/WorkflowApp.tsx`). `StreamView` is the response pane inside Focus (`ResponseSlot` in `src/features/workflow/CallPanel.tsx`), not a third main area. Opening a saved request or starting a draft replaces the current one (`src/features/catalog/actions.ts`). A dirty unbound draft confirms first (`src/features/catalog/DiscardDraftDialog.tsx`: Cancel / Save… / Discard). An origin-bound draft autosaves. There is no request-tab bar and no per-tab close. The prototype's `RequestTabs` bar, `tabs[]`, and `CloseConfirm` describe these design files only. The titlebar workflow menu (`src/features/workflow/WorkflowSelector.tsx`) can create named workflows; the open draft is one store-level field (`src/features/workflow/store.ts`), not one tab per request. Empty Focus shows "No active request — pick a method in the sidebar." (`messages.workflow.focus.noActiveRequest` in `src/lib/messages.ts`).
> 2. **Adding a server is address-first — there is no "Add server" dialog.** The sidebar **+** opens a menu (`src/features/catalog/SidebarShell.tsx`): New request, New HTTP request, New collection (`messages.catalog.sidebar`). That click does not itself start a draft. Ctrl/Cmd+N starts an empty gRPC Focus draft (`src/app/WorkflowApp.tsx` → `newRequestDraft` in `src/features/catalog/actions.ts`). New request in the menu does the same; New HTTP request calls `newHttpRequestDraft`. The address placeholder is `host:port`. There is no Connect button: a non-empty address reflects on its own, debounced (`src/features/workflow/useDraftReflection.ts`). The shipped bar is `src/features/workflow/DraftAddressBar.tsx` — TLS lock, host, method picker, and Send or Open. The prototype's separate Connect button and `newServer` scenario are design-file only.
> 3. **The sidebar is collections-first** (NOT servers-first, NOT service/history/collections tabs). The shipped tree is **Collection → (recursive) Folder → Request** (`src/features/catalog/CollectionNode.tsx`). There is **no server level**. A folder with no children still renders, and delete does not remove that parent (`FolderNode.tsx`, `removeItemFromTree` in `src/features/catalog/treeEdit.ts`). The `{ serverId, svc, mth }` registry sentence is the prototype; a shipped request is `SavedRequestIpc` (see Data shapes). Every collection / folder / request row is deletable via a hover **⋯** menu *and* a **right-click context menu**, then `ConfirmDeleteDialog`.
> 4. **The header is a single 36px title bar.** In the prototype: brand wordmark, env picker, sidebar / theme / settings, and the window controls. The 36px height stays. Off macOS the shipped bar shows the Handshaker wordmark (`!isMacOS` in `src/features/shell/Titlebar.tsx`). The rest of the bar is the workflow menu, environment control, sidebar toggle, split-direction toggle, update check, settings, and window controls off macOS. There is no theme button on the bar (`src/features/shell/Titlebar.test.tsx`). The document is forced dark in `src/main.tsx`. Do not insert a request-tab row under this bar.
> 5. **Clicking a collection opens its Collection Overview** in the main area. Shipped tabs are Overview, Authorization, and Variables (`src/features/catalog/overview/CollectionOverview.tsx`). There is no Settings tab; TLS defaults sit on Overview. The auth picker is None, Bearer, API key, and OAuth2 (`KIND_OPTIONS` in `src/features/catalog/overview/SavedAuthEditor.tsx`). Bearer and API key store an OS env-var name (`EnvVarAuthConfig.env_var` in `crates/handshaker-core/src/auth/mod.rs`). The OAuth2 client secret is a `{{var}}` template, not an env-var name (`OAuth2ClientCredentialsConfig.client_secret` in that file). Do not describe every auth field as an env-var name, and do not add a disabled Mutual TLS row.
> 6. **The env control is not the only colored dot.** It paints one marker (`paintMarker` in `src/features/workflow/WorkflowEnvControl.tsx`). Other colored dots ship on the stream statusline (`src/features/stream/StreamView.tsx`), the unbound-draft dirty mark (`src/features/workflow/FocusView.tsx`), and the update-available mark (`src/features/shell/Titlebar.tsx`). The prototype's per-server `dot` field in `data.js` is not a shipped server color tag. Do not remove the dots that ship.

## About the Design Files
The files in this bundle are **design references created in HTML/JSX** — a high-fidelity prototype, **not production code to copy directly**. The app already exists (Tauri 2 + React). Use this folder for color, type, spacing, and component shape. Behavior is the load-bearing list above, the code, and `docs/archive/`. Do not treat the prototype's scenarios as the product. The token names map 1:1 onto the shadcn-style primitives already in `src/components/ui/`.

The prototype uses inline React + Babel + Tailwind Play CDN for fast iteration. **Do not ship that stack** — it's a sketching tool, not a production build. Likewise the multi-file `*.jsx` split (components attached to `window`) is a prototype convenience; use real modules/imports in production.

## Fidelity
**High-fidelity (hifi).** Colors, typography, spacing, radii, interaction patterns, copy, and component shapes are all decided. Recreate pixel-perfectly using the target codebase's UI primitives.

## Top-level layout

The app is a fixed-size desktop window. Vertical stack:

```
┌──────────────────────────────────────────────────────────────────────┐
│ Titlebar  (36px, drag) — logo·name·env picker ╎ tools ╎ min/max/×      │
├───────────┬──────────────────────────────────────────────────────────┤
│           │ (no request-tab bar — Focus or Collection Overview)       │
│ Sidebar   ├──────────────────────────────────────────────────────────┤
│ (collec-  │ Address bar    (56px) — TLS / host / method picker / Send  │
│  tions    ├──────────────────────────────────────────────────────────┤
│  tree)    │ Request pane              │ Response pane                  │
│           │  - tabs (underline)       │  - body, or the stream timeline │
│ Checkout  │  - body / metadata / auth │  - trailers / headers          │
│ Identity  │                           │                                │
│ Edge/REST │   …OR the main area is:                                     │
│ Sandbox   │     · Collection Overview (clicking a collection)          │
│           │     · Focus empty state   (no active request)              │
│           │     · Server Overview / Browser — prototype only           │
│           │     · New-request / Disconnected hero — prototype only     │
├───────────┴──────────────────────────────────────────────────────────┤
│ StateBar  (floating pill, bottom-center) — scenario switcher (design)  │
└────────────────────────────────────────────────────────────────────────┘
```

The split between Request and Response panes is **horizontal by default** (stacked top/bottom — note: the `split` tweak default is `"horizontal"` which renders `flex-col`) and can be flipped to `vertical` (side-by-side) via the `split` tweak.

> **There is no separate top toolbar row.** The prototype puts the brand wordmark, environment picker, three utility buttons, and the window controls in the **single 36px title bar**. Shipped contents are decision 4.

## Screens / Views

The scenario table describes the **prototype** state switcher (one window, scenarios held per design-tab). The shipped main area is Focus or Collection Overview — not this scenario enum. A stream timeline is the response pane inside Focus (decision 1). The bottom floating state-bar exposes a subset as pills for review: `request`, `sending`, `success` (OK), `error`, `browse` (Browse), `env` (Env), `settings` (Settings). Other scenarios (`connected`, `idle`, `connecting`, `newServer`, `collection`, `server`, `streaming`) are reached through normal interaction in the prototype.

| Scenario     | What's visible in the main area                                                                       |
|--------------|------------------------------------------------------------------------------------------------------|
| `connected`  | Default. Request pane (body editor) + Response pane (idle).                                           |
| `request`    | Connected + a method selected; populated body.                                                       |
| `sending`    | Send button shows spinner + "Sending"; Response pane shows "Sending request…" empty state.           |
| `success`    | Response pane shows body / trailers / headers tabs with content; status pill = green "OK".            |
| `error`      | Response pane shows error body; status pill = red with grpc-status code.                              |
| `idle`       | DisconnectedHero with reconnect hint. (Reached by toggling TLS/Connect off; no state pill.)           |
| `connecting` | Hero shows spinner + "Negotiating TLS…" + host:port. (no pill)                                        |
| `newServer`  | **Blank request draft** — empty/focused address bar + `NewRequestHero`. The entry point for adding a server / opening a new request tab. |
| `collection` | **Collection Overview** panel fills the main area (opened by clicking a collection in the sidebar).   |
| `server`     | **Server Overview** panel fills the main area (Overview · Authorization · Variables for one server).  |
| `browse`     | **Server browser** — filter + multi-select methods to add to a collection.                            |
| `env`        | Environment modal open.                                                                               |
| `settings`   | Settings modal open.                                                                                  |
| `streaming`  | Prototype preset. Shipped pane is `StreamView` (decision 0), not this scenario.                      |

The scenario state-bar (`StateBar`, the floating pill at bottom-center) is **a design-review affordance only** — it lets reviewers flip between states. **Do not ship it.**

### Component-by-component

#### Titlebar (single header)
- Height: 36px (`h-9`). `bg-card`, bottom border `border-border`, `z-40`. Whole bar has `-webkit-app-region: drag` (class `tb-drag`); every interactive child opts out via `tb-nodrag`.
- **Left group** (`tb-nodrag`): 13px logo glyph (`Icons.Logo` — a chevron/diamond mark) + "Handshaker" wordmark (13px, semibold), then the **environment dropdown** — a compact outline button (`h-6`, `text-[11.5px]`) showing a colored env dot + env name + chevron. Dropdown (288px, `align="start"`): label "Environments", rows of `{ color dot, name, "N vars" }`, separator, "+ New environment", "Settings · Manage…".
  - The env dot is the **active environment** indicator, *not* a server tag — keep it.
- **Spacer** (`flex-1`).
- **Right utility group** (`tb-nodrag`, gap 2px): three 24×20px ghost buttons — **sidebar toggle** (PanelLeft), **theme toggle** (Sun/Moon), **settings** (gear). Hover = `bg-accent`. Tooltips `side="bottom"`.
- **Divider**: `h-3.5 w-px bg-border` hairline.
- **Window controls** (`tb-nodrag`, gap 2px): Minimize / Maximize / Close — 24×20px ghost buttons. Close hover = `bg-destructive`.

#### Request tabs bar (`RequestTabs`)
Prototype only. The shipped app has no request-tab bar (decision 1). The sizes below are the prototype's tab chrome, not a layout to rebuild.
- Height: 36px (`h-9`). `bg-card/50`, bottom border, `z-30`. A horizontally-scrolling row of tabs followed by a fixed **+** button (36px wide).
- **Each tab**: `min-w-[132px] max-w-[210px]`, `border-r border-border`, `pl-3 pr-1.5`. Active tab = `bg-background` with a 1.5px foreground bar across its **top** edge; inactive = transparent, `hover:bg-accent/40`.
  - Label: the saved-request name, else the method name, else the typed host, else "New request" — mono 12px, truncated. Active = `text-foreground`, inactive = `text-muted-foreground` (→ foreground on hover).
  - A new/unconnected tab shows a small `Plus` glyph before the label. A streaming method shows a `bg-stream` dot (prototype tab chrome; kind in the shipped app is the badge in decision 0, not a tab dot).
  - **Close affordance** (right): a 20px ghost button. When the tab is **dirty**, it shows a filled `bg-foreground/80` dot that swaps to an × on hover; the dot stays visible even when the tab isn't hovered. Clean tabs show the × only on hover/active.
  - **Middle-click** anywhere on the tab closes it (via `requestClose`, which routes through the dirty check).
- **+ button**: full-height, 36px wide, `Plus` icon, `hover:bg-accent/50`, `border-r`. Opens a new `newServer` draft tab.

#### Close-tab confirmation (`CloseConfirm`)
Prototype dialog for closing a dirty request tab. The shipped confirm is `DiscardDraftDialog` when replacing a dirty unbound draft (decision 1), not a per-tab close.
- A `Dialog` (`max-w-md`). Title "Unsaved changes", body *"'{label}' has edits that haven't been saved yet. Close it anyway?"*. Footer: **Cancel** (ghost) · **Discard** (outline, destructive-tinted text) · **Save & close** (primary). Only appears when closing a tab whose `dirty` flag is set.

#### Address bar (`ConnectionBar`, Postman-style)
Prototype layout. The shipped bar is `DraftAddressBar` (decision 2): no separate Connect button, and the method picker stays in the row.
- Height: 56px (`h-14`). Bottom border, `px-3.5`, `gap-2`. The shipped bar uses `h-14` as well (`DraftAddressBar.tsx`).
- Children, left to right:
  1. **TLS button** — 36×36 outline icon button. Lock when TLS on, Unlock when plaintext. Tooltip explains; click toggles.
  2. **Combined input shell** — `flex-1`, height 36, `rounded-md border bg-background`. Ring on focus-within. In a `newServer` draft it gets a persistent `border-ring ring-1 ring-ring` highlight. Contains:
     - **Host input** (`host:port`, mono 12.5px) at left (`w-[42%] min-w-[130px]`), transparent bg, no border. **Enter** triggers Connect while drafting.
     - When connected + a method selected: a 1px vertical divider (`bg-border`, inset) then the **MethodPicker** filling the rest.
     - Otherwise the remaining space shows a muted mono hint: `not connected` / `negotiating…` / `browsing methods…` / `enter a server address` / `press Connect to discover methods` / `select a method`.
  3. **Connect** button (when not connected) — primary, 36px. Disabled while a draft address is empty. While connecting → disabled spinner + "Connecting".
  4. **Send** button (when connected) — primary, 36px, `min-w-[88px]`, gap 1.5. `Send` icon + "Send"; while sending → spinner + "Sending". Disabled when no method, sending, or browsing.

#### Method picker (`MethodPicker`, in `panels.jsx`)
- Trigger: inline-flex button, mono 12.5px — cube icon + `serviceShort` (muted) + "/" + `methodName` (medium) + optional kind badge + chevron. Labels truncate (max ~150px in the address bar). Hover/open = `bg-accent`.
- Popover (~420px, no padding): a search input on top (h-40, leading search icon, trailing `esc` `Kbd`) over a scrollable list (max-h 360) grouped by service. Group header = small-caps label + cube icon. Method row = h-28, mono, `methodName` + `Request → Response` types (muted 10px) + kind dot.
- **Kind dot colors**: `unary` = muted-foreground/50, `server` = `--stream`, `client` = `--warn`, `bidi` = purple-400. Streaming kinds **do** surface: `KindBadge` and `KindDot` in `src/features/shell/KindBadge.tsx`. Leave these token names as written.
- Empty: "No methods match \"q\"".

#### Sidebar (collections-first — `sidebar.jsx`)
- Width: fixed (~300px via `SidebarShell`). **Header row**: filter input (leading filter icon, placeholder "Filter collections & requests") + a **+** ghost icon button (tooltip "New request" → opens a `newServer` draft) + an overflow **⋯** menu (`RowActions`): *New collection · Reveal active request · Expand all · Collapse all · Import collection… · Export collection…*.
- **Body**: the collection tree.
  - **Collection row** (`CollectionNode`): `h-24`-ish (`!h-[24px]`), 12px text, `text-foreground/80`. A chevron toggle sits at the far left (absolute); the row label is a button that **opens the Collection Overview** (`onOpenCollection`). Trailing mono request-count. Expanding reveals children.
  - **Folder row** (`FolderNode`, recursive): muted, 11.5px, chevron + folder icon + name + count. Shipped tree renders a folder with no children (`src/features/catalog/FolderNode.tsx`, `CollectionNode.tsx`). Empty folders are not hidden.
  - **Request row** (`RequestRow`): a left **type marker** (`ReqTypeTag`) then the label. Saved requests show their `name` in sans; bare pinned methods show the method name in mono. Active request gets a 2px foreground left bar + `isActive` styling. A right-anchored tooltip shows the full signature + target host.
  - **Type markers** (Postman-style, left gutter, prototype): gRPC unary = a quiet blue mono **"g"**; gRPC streaming = a stream arrow (`↓` server / `↑` client / `↕` bidi) in `--stream`; HTTP = a colored mono **verb** (`GET` green / `POST` amber / `PATCH` purple / `PUT` blue / `DELETE`→"DEL" red). Shipped tree (`RequestRow.tsx`): every gRPC request is the `gRPC` mark, HTTP is a verb badge, and kind arrows are not drawn. Do not hide streaming elsewhere because the tree has no arrows.
- **Row delete + actions**: hovering a row reveals a trailing **⋯** button; **right-clicking** the row opens the same menu *at the cursor* (`RowMenu`, a fixed-position floating list that closes on outside-click / Esc / scroll). Menu items vary by node type (collection / folder / request) but **Delete** is always present and is the only destructive (red) item — it stays red on hover via a `bg-destructive/10` tint. Deleting removes that node only. `removeItemFromTree` (`src/features/catalog/treeEdit.ts`) does not drop a parent folder that is left empty. The prototype's "prune now-empty folders" note is not the shipped delete.
- **Empty states**: no collections → a centered block with "New collection" + "Import collection…" buttons; a collection with no requests → an inline "No requests yet · + Add" row; filter with no matches → "Nothing matches \"q\"".

#### Collection Overview (`CollectionOverview` in `browser.jsx`; building blocks in `collection-overview.jsx`)
Opened by clicking a collection in the sidebar (`collection` scenario). Fills the main area; **not a modal**.
- **Header** (48px, `h-12`): Layers icon + **inline-editable title** (`CollectionTitle` — click to edit, Enter saves, Esc cancels, pencil affordance on hover) + a muted "N requests · M targets" summary + an **Export** outline button + a close **×**.
- **Tabs** (`COTabs`, underline style, with optional count hint). Shipped: **Overview · Authorization · Variables** (`CollectionOverview.tsx`). There is no Settings tab. The prototype's fourth Settings tab is design-file only. Body is a centered column (`max-w-[680px]`, variables `max-w-[min(90vw,960px)]`).
  - **Overview**: an empty-state callout if the collection has no requests; a **Description** block (`DescriptionBlock` — view / inline-edit / "Add a description" empty state, markdown-supported textarea); a **Targets** block (wrap of mono host chips); and a **Requests** block — the collection's saved requests + pinned methods grouped by folder (recursive `CO_Rows`), each row clickable to open the request (marker + label + signature + target host + a send glyph on hover).
  - **Authorization**: `SavedAuthEditor`. Kind picker: None, Bearer, API key, OAuth2. There is no Mutual TLS row, shown or disabled. Bearer and API key fields are an OS env-var name (`EnvVarField`). OAuth2 fields, including the client secret, are `{{var}}` templates (decision 5). The prototype's Basic / disabled mTLS / "every secret is an env-var name" copy is design-file only.
  - **Variables**: `VariablesBlock` — a Name/Value table of `{{name}}` collection variables with add/remove; empty state explains the `{{name}}` convention.
  - **TLS** ships on the Overview tab (`TlsBlock` in `CollectionOverview.tsx`), not on a Settings tab. The prototype Settings tab (TLS defaults + danger zone) is design-file only.
- **Delete confirm** is `ConfirmDeleteDialog` (`src/features/catalog/CollectionTree.tsx`), an alert dialog, not an in-panel overlay. The prototype's in-panel "Delete collection?" card is design-file only.

> `collection-overview.jsx` also contains a standalone `CollectionOverviewPanel` (an alternate single-/tabbed packaging used during exploration). The **shipping** path is `CollectionOverview` in `browser.jsx`, which reuses the building-block components (`COTabs`, `COBlock`, `CollectionTitle`, `DescriptionBlock`, `VariablesBlock`, `TlsBlock`, `AuthBlock`, `EnvVarField`, `MiniSelect`) exported from `collection-overview.jsx`.

#### Server Overview (`ServerOverview` in `browser.jsx`)
Prototype screen. There is no Server Overview component under `src/`. Shown in the prototype's `server` scenario. Fills the main area of the design files.
- **Header** (48px): server name + mono host + a reachability label (`Reachable` ok / `Slow` warn / `Unreachable` destructive) + a **Refresh** outline button + close ×.
- **Tabs** (underline): **Overview · Authorization · Variables**.
  - **Overview** (`SO_Overview`): a one-line summary ("exposes N methods across M services over gRPC/HTTP"), two KV cards (Connection: Host / TLS / Protocol; Catalog: Services / Methods / Reflection), then a filterable method list grouped by service — each method row clickable to open it in the editor.
  - **Authorization** (`SO_Auth`): a `ToggleGroup` (Bearer / API key / None), the matching field(s), and an "Inherit from environment" switch.
  - **Variables** (`SO_Vars`): a server-scoped variable table + "Add variable".

#### Server browser (`ServerBrowser` in `browser.jsx`)
Prototype screen. There is no Server Browser component under `src/`. Shown in the prototype's `browse` scenario.
- **Header** (48px): server name + host + (gRPC) a reflection summary chip + Update / settings / close.
- **Filter row** (44px): a search input ("Filter N methods…"), a gRPC-only "Streaming" toggle (a control on this prototype screen only — do not read it as hiding method kind in the picker), and a "shown of total" count.
- **Method list**: grouped by service; each row is a **checkbox** row (custom 14px check tile → `bg-primary` when checked, a 2px `bg-primary` left bar when selected) + method tag + name + `req → res` types.
- **Selection action bar** (52px, bottom): "N selected" + Clear, a target-collection chip, and a primary **Add to collection** button (disabled at 0).

> Selection accents here use the neutral `--primary` token — **no per-server color**.

#### Request pane (`RequestPanel`, `panels.jsx`)
- Pane head (40px, `h-10`): underline tabs `[Body] [Metadata 3] [Auth bearer]` on the left + ghost icon buttons (Beautify / Word-wrap / Copy) on the right. Backdrop blur, semi-transparent bg.
- **Body** tab: line-numbered JSON code view, mono 12.5px, syntax-highlighted via `--syntax-*` tokens (key=blue, string=green, number/bool/var=orange, punct=mid-gray). `{{vars}}` rendered in the number color. Editing an unbound draft sets `draftDirty` on `workflowStore`.
- **Metadata** tab: a 3-column Key / Value / delete table; `{{vars}}` in values styled as numbers.
- **Auth** tab: inline auth config (bearer token, etc).

#### Response pane (`ResponsePanel`, `panels.jsx`)
- Pane head: underline tabs `[Body] [Trailers (N)] [Headers (3)]` + right-aligned `RespMeta`: a colored status pill (OK=green `--ok` / error code=red `--destructive`), latency (`1ms`), size (`58B`) in mono 11px.
- **Empty states** for `idle` and `sending`: centered icon block + title + 1-line muted description.

#### Underline tabs (Linear/Vercel-style — load-bearing)
Used for the pane heads, the Collection Overview, and the Server Overview.
- Container fills the pane-head height (`self-stretch flex items-stretch gap-0.5`) so the underline aligns with the head's bottom border.
- Each tab: ghost button, gap 1.5, `px-2.5`, text 12.5px. Active = `text-foreground`; inactive = `text-muted-foreground` with `hover:text-foreground` (transition-colors).
- Optional inline hint/count: mono 10px, tabular-nums, muted (dimmer when inactive).
- **Active underline**: absolutely positioned `left-2 right-2 -bottom-px h-[1.5px] rounded-full bg-foreground`, sitting on top of the head's own `border-b`. No `TabsList` chrome / pill background.

#### Tweaks panel
A **design-time affordance**. **Don't ship the panel itself.** Do not add a theme toggle from it — the app stays dark (`src/main.tsx`). Sidebar and split direction already live in Settings (`src/features/settings/AppearancePane.tsx`).

#### New request draft / Disconnected hero (`app.jsx`)
Prototype copy. Shipped empty Focus is the one sentence in decision 1. `src/features/shell/Heroes.tsx` still contains this copy and nothing imports it.
- **`NewRequestHero`** (`newServer`): centered `+` tile, "New request" title, one line — *"Type a server address in the bar above and hit Connect. Handshaker runs reflection and lists every method — no dialog, no setup."* — and a `↑ address bar · ↵ to connect` hint. **No "Recent addresses" list and no `.proto` copy** (both removed deliberately). If you add a reflection-failure path, that's where a `.proto`/descriptor fallback would go.
- **`DisconnectedHero`** (`idle` / `connecting`): connecting shows a spinner + "Negotiating TLS…" + host; idle shows a "Disconnected" hero inviting reconnect or picking a method from the sidebar.

#### Dialogs — Environment + Settings (`modals.jsx`)
Both share `Dialog` / `DialogContent` from `shadcn.jsx`. Rules learned during iteration — keep them:
- **Size with inline `style`, not `max-w-*` classes.** `DialogContent` has a base `max-w-lg`; by CSS source-order an added `max-w-4xl`/`max-w-xl` class does **not** win, so the dialog silently stays small. Set `width` + `maxWidth: calc(100vw - 2rem)` (and a fixed `height` + `maxHeight: calc(100vh - 2rem)`) via inline style.
  - **Environment**: ~`width: 60rem`, `height: 660px`, viewport-bounded.
  - **Settings**: ~`width: 52rem`, `height: 640px`, viewport-bounded.
- **Bound to viewport + flex column** so header/footer never clip: `display:flex; flexDirection:column` on `DialogContent`, `flex-none` header/footer, `flex-1 min-h-0` scrolling body. Settings is a `flex-1 min-h-0` two-column grid `[200px_1fr]` (left = section nav, right = scrolling pane) — height must stay **constant across sections**.
- Keep `text-foreground` **and** `border-border` on `DialogContent` (a plain `border` without a color class inherits `currentColor`, which `text-foreground` would turn white).
- `DialogBody` is `grid gap-4 content-start overflow-y-auto overflow-x-hidden` (`content-start` stops sparse content stretching into big gaps).

## Interactions & behavior

- **Opening a request** (prototype called this tabs): Ctrl/Cmd+N, or New request in the sidebar **+** menu, starts a new gRPC draft in Focus (decision 2). The **+** click itself only opens that menu. Opening another request replaces the current one. A dirty unbound draft confirms (decision 1). There is no tab bar, middle-click close, or per-tab scenario.
- **Connect / Disconnect** (prototype only): address bar "Connect" → `connecting` → (fake ~850ms latency) → `connected`. Shipped reflection is decision 2, not this button.
- **Pick a method**: from the sidebar, the method picker, or a Collection Overview row. Sets the Focus draft's service and method. Server Overview rows are prototype-only.
- **Send**: primary button. Unary/HTTP → `sending` → `success` after ~750ms in the prototype. *Production: until the call resolves.* Streaming uses the timeline in decision 0 (Send/Cancel for server streams; Open / Send message / End stream / Cancel for client and bidi).
- **Open a collection**: click the collection row → Collection Overview in the main area (`WorkflowApp.tsx`). **Server overview** and **browse** are prototype scenarios only (no such screens under `src/`).
- **Delete** (collection / folder / request): hover ⋯ or right-click → **Delete**, then `ConfirmDeleteDialog`. Empty folders stay in the tree, and deleting a child does not remove its parent (decision above; `FolderNode.tsx`, `treeEdit.ts`).
- **Inline edits**: collection title (Enter/Esc), collection description (Save/Cancel/Esc), variables table rows, env-var auth fields.
- **Theme / env**: the prototype persists a theme toggle. The shipped app does not: `src/main.tsx` forces `dark`, and Settings has no theme control (`src/features/settings/AppearancePane.tsx`). The env dropdown still switches `{{var}}` substitution.
- **Beautify / Wrap / Copy** in the request pane head: act on the body editor (no-ops in prototype).

### Animations / transitions
- Tab underline: opacity 0↔1, `transition-opacity` (~150ms ease). Tab text: `transition-colors`.
- Prototype dialog animation: `fade-in` (.15s) backdrop + `zoom-in` (.15s, scale .96→1) card. Shipped delete confirm is `ConfirmDeleteDialog`, not an in-panel overlay.
- Send / connect spinner: 0.8s linear infinite, 1.5px border, transparent top.
- Dotted background glow: radial mask follows the cursor over the main area (`--mx`/`--my` CSS vars), `transition: opacity .25s`. Toggled by the `dots` tweak.
- Streaming status dot: 1.4s ease-in-out pulse. It ships as `.pulse-dot` (`src/styles/globals.css`, `animation: hs-pulse 1.4s ease-in-out infinite`) on the timeline footer and empty state (`src/features/stream/StreamView.tsx`). Do not drop it as deferred.

## State management

The prototype keeps per-request state in a `tabs[]` array. **Do not rebuild that.** Shipped state is one Focus draft on `workflowStore` (`src/features/workflow/store.ts`) plus a stream entry in `src/features/stream/streamStore.ts`. The table below is the prototype's shape.

| Per-tab key   | Type                                  | Notes                                                         |
|---------------|---------------------------------------|--------------------------------------------------------------|
| `id`          | string                                | tab id                                                       |
| `selected`    | `{ serverId, svc, mth, savedName? }` \| null | currently-selected method/request                     |
| `host`        | string                                | host:port                                                    |
| `tls`         | boolean                               | TLS on/off                                                   |
| `scenario`    | enum (see table)                      | drives the main area for this tab                            |
| `requestTab`  | `'body' \| 'metadata' \| 'auth'`      | request pane                                                 |
| `responseTab` | `'body' \| 'trailers' \| 'headers'`   | response pane                                                |
| `streamFrames`| array                                 | Prototype only. Shipped messages live in the stream store.  |
| `browseServerId` | string \| null                     | which server the browse/server overview targets             |
| `dirty`       | boolean                               | unsaved edits → close confirm                                |

| App-level key       | Type                              | Notes                                          |
|---------------------|-----------------------------------|------------------------------------------------|
| `tabs` / `activeId` | array / string                    | the open request tabs + which is active        |
| `query`             | string                            | sidebar filter                                 |
| `env`               | environment object                | active env from `data.js`                      |
| `envOpen`           | boolean                           | env dropdown open                              |
| `envModalOpen` / `settingsOpen` | boolean               | the two dialogs                                |
| `openCollectionId`  | string \| null                    | which collection the overview shows            |
| `closing`           | tab \| null                       | tab pending close-confirm                      |
| Tweaks              | persisted via host protocol       | theme/accent/density/sidebar/split/fontUi/fontMono/dots |

Production: replace the fake scenario timers (`setTimeout(... 750 / 850)`) with real gRPC/HTTP call lifecycles.

## Data shapes (`data.js`, `window.HS_DATA`)

Prototype fixtures. The shipped saved request is `SavedRequestIpc` in `src/ipc/bindings.ts` (a grpc template with `address_template`, `service`, and `method`, or an http template). Do not rebuild a separate server registry from this section.

The prototype model is a **server registry** + a **collections tree** that references it.

- **`servers[]`** — master registry. Each: `{ id, name, host, tls, dot, status: 'ok'|'slow'|'unreachable', proto: 'grpc'|'http', reflection: {services, methods}|null, services[] }`. A gRPC service is `{ name (FQN), short, methods[] }`; a gRPC method is `{ name, kind: 'unary'|'server'|'client'|'bidi', req, res }`. For HTTP servers, the single service has `short: ""` and methods are `{ name: '/path/{id}', verb: 'GET'|'POST'|'PATCH'|'PUT'|'DELETE', req, res }`.
- **`collections[]`** — the **sidebar tree** (collections-first). Each node has a `type`:
  - `collection`: `{ type, id, name, description, variables: [{id,k,v}], tls: {enabled, skipVerify}, authByEnv: { <envName>: {type, …} }, children[] }`.
  - `folder`: `{ type, id, name, children[] }` (recursive).
  - `request`: `{ type, id, serverId, svc, mth, name? }` — references a registry method; `name` present = a user-saved request, absent = a bare pinned method. Target host is resolved from `serverId`.
  - `authByEnv` in these fixtures is the prototype shape (`none` / `bearer` / `basic` / `apikey`, values as env-var names, `mtls` disabled). Shipped auth is decision 5: None, Bearer, API key, OAuth2. Do not rebuild Basic or a disabled Mutual TLS row from this fixture.
- **`collection`** (singular) — a legacy single-collection fixture used by `ServerBrowser` / `ServerOverview` (target chip + "add to collection"). Distinct from `collections[]`.
- **`environments[]`** — `{ name, color, host, vars }`.
- **`bodies`** — map of `"Service/Method"` (or `"/http/path"`) → array of `{ ln: string }` editor rows.
- **`responses`** — `{ success[], error[] }` sample bodies. **`trailers`** — KV pairs.
- **Helpers**: `HS_DATA.findServer(id)` and `HS_DATA.findMethod(serverId, svc, mth)` (returns the method def enriched with `svcShort`, `svcName`, `proto`).

## Design Tokens

### shadcn HSL tokens (match shadcn/ui zinc defaults)

Light (`:root`):
```
--background: 0 0% 100%      --foreground: 0 0% 3.9%
--card: 0 0% 100%            --card-foreground: 0 0% 3.9%
--popover: 0 0% 100%         --popover-foreground: 0 0% 3.9%
--primary: 0 0% 9%           --primary-foreground: 0 0% 98%
--secondary: 0 0% 96.1%      --secondary-foreground: 0 0% 9%
--muted: 0 0% 96.1%          --muted-foreground: 0 0% 45.1%
--accent: 0 0% 96.1%         --accent-foreground: 0 0% 9%
--destructive: 0 84.2% 60.2% --destructive-foreground: 0 0% 98%
--border: 0 0% 89.8%         --input: 0 0% 89.8%
--ring: 0 0% 3.9%            --radius: 0.5rem
```

Dark (`.dark`):
```
--background: 0 0% 3.9%      --foreground: 0 0% 98%
--card: 0 0% 3.9%            --popover: 0 0% 6%
--primary: 0 0% 98%          --primary-foreground: 0 0% 9%
--secondary: 0 0% 14.9%      --muted: 0 0% 14.9%
--muted-foreground: 0 0% 63.9%   --accent: 0 0% 14.9%
--destructive: 0 62.8% 30.6%     --border: 0 0% 14.9%
--input: 0 0% 14.9%          --ring: 0 0% 83.1%
```

> Note: the **accent (`--primary`)** is overridden at runtime from the `accent` tweak (default `#fafafa`) via `hexToHsl`, and `--ring` follows it in dark mode. The default look is a neutral near-white primary on near-black.

### Semantic status tokens (custom)
```
--ok / --ok-foreground         green   (light 142 65% 38% · dark 142 50% 55%)
--warn / --warn-foreground     amber   (light 38 80% 42%  · dark 38 70% 60%)
--stream / --stream-foreground blue    (light 200 65% 42% · dark 200 70% 65%)   ← keep this token; streaming ships (decision 0)
```
Use `--ok` for OK pills, `--destructive` for error pills, `--warn` for slow/skip-verify warnings. HTTP verb colors reuse these (GET=ok, POST=warn, PUT=stream, PATCH=purple-400, DELETE=destructive).

### Syntax tokens (`styles.css`)
```
--syntax-key:   hsl(210 60% 65%)   --syntax-str:   hsl(95 40% 65%)
--syntax-num:   hsl(38 60% 65%)    --syntax-punct: hsl(0 0% 45%)
```
Light-theme overrides darken these — see the `.light{}` block.

### Typography
- UI: **Inter** 400/500/600/700 (fallbacks Geist, system-ui). Tweakable to Geist / system.
- Mono: **JetBrains Mono** 400/500/600 (fallbacks Geist Mono, IBM Plex Mono, ui-monospace). Tweakable to Geist Mono / IBM Plex Mono.
- Sizes in use: 9px (HTTP verb tags), 9.5/10/10.5px (counts, caps labels, hints), 11–11.5px (meta, titlebar, badges), 12px (mono tree/table rows), 12.5px (tabs, body input, code), 13px (default body / headings), 14px (overview headers).
- Density tweak scales the root font-size: compact 12.5px / regular 13px / cozy 13.5px.

### Spacing & sizes (Tailwind 4px scale)
- Title bar / tabs bar: `h-9` (36px). Address bar: `h-14` (56px). Pane / overview head: `h-10`–`h-12` (40–48px). Filter/sub rows: `h-11` (44px). Inputs / icon buttons: `h-9` (36px), small `h-8`/`h-7`. Sidebar rows: ~22–24px. Sidebar width ~300px.

### Radii
- Window outer: 10px (`rounded-[10px]`). Cards/inputs/buttons: `--radius` 8px; `rounded-md` (6px) for tabs/dropdowns; `rounded-sm` (2px) for window controls; `rounded-full` for status dots and the tab underline.

### Shadows
- Window: outer border only (sits on a black letterbox; no body drop-shadow). Popovers/dropdowns/dialogs: shadcn `shadow-md` / `shadow-xl`.

## Component inventory (`shadcn.jsx`)
shadcn-style primitives present: `Button` (variants default/outline/ghost/secondary/destructive; sizes incl. `sm`/`xs`/`icon`/`icon-sm`), `Input`, `Badge`, `Switch`, `Separator`, `Tooltip` (with `side`), `Kbd`, `DropdownMenu` family (`Trigger/Content/Item/Label/Separator`), `Dialog` family (`Content/Header/Title/Description/Footer`), `ToggleGroup`, the boxy `Tabs/TabsList/TabsTrigger` (kept for any pill-style use — pane heads use the underline tabs instead), the `Sidebar*` shell components (`SidebarShell/Header/Input/Content/Group/Menu/MenuItem/MenuButton/MenuSub/...`), and a `cn` class-merge util. In production, map these to your shadcn/ui install (and `lucide-react` for icons).

## Assets
- Fonts: Google Fonts CDN — Inter + JetBrains Mono.
- Icons: hand-rolled inline SVG components in `icons.jsx` (Lucide-style 1.5px strokes). Swap for `lucide-react` in production (same visual style). `Icons.Logo` is the brand mark.
- No raster images.

## Files in this bundle
- `Handshaker.html` — entry point. Tailwind Play config, shadcn HSL tokens (light + dark) + status tokens, script imports (load order: `data.js` → `icons` → `shadcn` → `tweaks-panel` → `sidebar` → `panels` → `modals` → `collection-overview` → `browser` → `app`).
- `app.jsx` — prototype App root (its own multi-tab state — not the shipped workspace), `Titlebar`, `RequestTabs`, `CloseConfirm`, `ConnectionBar` (address bar), `NewRequestHero` / `DisconnectedHero`, `StateBar`, theme/font/accent effects, main-area router.
- `sidebar.jsx` — **collections-first** tree (`Sidebar`, `CollectionNode`, `FolderNode`, `RequestRow`), `RowMenu` / `RowActions` (hover-⋯ + right-click delete), type markers (`ReqTypeTag`/`MethodTag`/`MethodVerb`), `verbOf`.
- `panels.jsx` — `RequestPanel`, `ResponsePanel`, `MethodPicker`, `UnderlineTabs`, `MetadataView`, `KVTable`, `CodeView`, `RespMeta`, tokenizer, and the prototype `StreamView`. The shipped timeline is `src/features/stream/StreamView.tsx`.
- `browser.jsx` — `ServerBrowser`, `ServerOverview` (+ `SO_*` tabs), and the shipping `CollectionOverview` (+ `CO_*` row helpers).
- `collection-overview.jsx` — Collection-overview building blocks (`COTabs`, `COBlock`, `CollectionTitle`, `DescriptionBlock`, `VariablesBlock`, `TlsBlock`, `AuthBlock`, `EnvVarField`, `MiniSelect`) + the alternate `CollectionOverviewPanel`.
- `modals.jsx` — Environment modal, Settings modal. (There is **no** AddServerModal — adding a server is the `newServer` draft.)
- `shadcn.jsx` — shadcn-style primitives + `cn`.
- `icons.jsx` — inline SVG icon set.
- `data.js` — fixtures: server registry, collections tree, legacy single collection, environments, bodies, responses, trailers, + `findServer` / `findMethod` helpers.
- `styles.css` — scrollbars, syntax tokens, dotted background, spinner, pulse, label-cap, selection.
- `tweaks-panel.jsx` — design-time tweak controls (not shipping).

## Notes for the implementer
- **Focus is the workspace.** One request in the main area. Do not add a request-tab bar. See decision 1.
- **Adding a server is address-first** — there is **no Add-server dialog**. See decision 2. The sidebar **+** is a menu, not a draft button. Do not add a Connect button or a request-tab **+**.
- **The sidebar is collections-first.** Don't model a server level in the tree. Empty folders stay visible, and delete does not remove an empty parent. Collection/folder/request rows are deletable via hover **⋯** and right-click; confirm with `ConfirmDeleteDialog`.
- **Auth is None, Bearer, API key, or OAuth2.** Bearer and API key store an OS env-var name. The OAuth2 client secret is a `{{var}}` template, not an env-var name. There is no Mutual TLS row. See decision 5.
- **Dialog sizing must use inline `style`** (width/height + viewport-bounded max), because the base `max-w-lg` beats utility `max-w-*` by source order. Settings height must stay constant across sections. Keep `text-foreground` + `border-border` on `DialogContent`.
- The **address bar pattern** (TLS + host + method picker + Send in one row) and the **Linear/Vercel-style underline tabs** are load-bearing for the look. There is **no leading "/"** before the method picker — keep it gone.
- The MethodPicker should be **searchable** and **keyboard-navigable** (arrows + Enter + Esc) in production; the prototype only wires the click path.
- Keep the four semantic colors (`--ok / --warn / --destructive / --stream`) consistent wherever status surfaces (kind dots, HTTP verbs, pills, warnings).
- **Streaming ships.** Do not hide the timeline, the kind badge, or the stream controls. See decision 0 and `docs/archive/2026-10-04-streaming-rpcs/`.
- **Colored dots:** the env control is one of them, not the only one. See decision 6. Do not strip the stream, dirty, or update dots. The prototype per-server `dot` is not a shipped server color tag.
- **Don't ship the `StateBar`** (the floating bottom pill) or the **Tweaks panel**. Do not add a theme toggle from the tweaks (decision 4).
- The window chrome (`Titlebar`) is desktop-shell territory. On Tauri/Electron set `decorations: false` and reuse it; on web, relocate the env picker + utility buttons into your app shell rather than deleting them.
