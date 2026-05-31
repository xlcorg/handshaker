# Handoff: Handshaker — gRPC / HTTP Desktop API Client

## Overview
Handshaker is a desktop client for invoking **gRPC** services — think "Postman, but for gRPC" — that also handles plain **HTTP/REST** endpoints. Users register a server by address (e.g. `orders.api.example.com:443`), discover its services via reflection, organize requests into **collections**, pick a `Service.Method` (or an HTTP verb + path), edit a request body in JSON, send it, and inspect the response (body, trailers, headers, errors).

The app is a **multi-tab workspace**: every open request is its own tab with independent state. A **collections-first sidebar** holds the saved requests; a **Collection Overview** and **Server Overview** present per-collection / per-server configuration; and an in-design **Tweaks** panel switches theme / density / fonts / layout.

> **Read these load-bearing decisions first:**
> 0. **MVP scope — no streaming.** The first release ships **unary gRPC calls + HTTP** only. Server/client/bidi streaming is **out of scope for the MVP**: there is no streaming response pane in shipped UI, no Stream state, no "Streaming" filter result surfaced to users. The `stream` color token, the `kind: server|client|bidi` fixtures, the stream arrows in the tree, and the `streaming` scenario all still exist in the design files (and the demo state-switcher can reach a streaming preset) but **must not surface in shipped UI**. Streaming is a post-MVP follow-up.
> 1. **The workspace is multi-tab.** Each open request is a tab (`RequestTabs` bar, directly under the title bar). A tab owns its own `selected` method, `host`, `tls`, `scenario`, and a `dirty` flag. **+** opens a new blank request tab; the middle-click or × closes a tab; closing a **dirty** tab prompts a *Save & close / Discard / Cancel* dialog (`CloseConfirm`).
> 2. **Adding a server is address-first — there is NO "Add server" dialog.** Pressing **+** (tab bar or sidebar) opens a *blank request draft* (`newServer` scenario): the address bar is empty + autofocused, the user types `host:port` and hits **Connect**. Discovery/registration happens implicitly by connecting. See **New request draft** below.
> 3. **The sidebar is collections-first** (NOT servers-first, NOT service/history/collections tabs). The tree is **Collection → (recursive) Folder → Request**. There is **no server level** in the tree — each *request* references a server method by `{ serverId, svc, mth }` and resolves its own target host from the server registry, so one collection freely mixes servers. Every collection / folder / request row is deletable via a hover **⋯** menu *and* a **right-click context menu**.
> 4. **The header is a single 36px title bar.** Brand wordmark, env picker, the three utility buttons (sidebar / theme / settings), and the window controls all live there.
> 5. **Clicking a collection opens its Collection Overview** in the main area (tabbed: Overview · Authorization · Variables · Settings). Auth secrets are referenced **by environment-variable name**, never as raw secrets. (`collection` scenario.)
> 6. **Server color tags were removed from the main UI.** The `dot` field still exists per server in `data.js` but isn't rendered. The only colored dot that stays is the **environment** indicator in the title bar.

## About the Design Files
The files in this bundle are **design references created in HTML/JSX** — a high-fidelity prototype showing intended look and behavior, **not production code to copy directly**. The task is to **recreate this design in the target codebase's environment** (a desktop shell — Tauri, Electron, or native — using whatever component system the target uses) following its established patterns and libraries. If no environment exists yet, pick the most appropriate stack: a **React + Tailwind + shadcn/ui** setup mirrors the prototype most directly (the token names map 1:1 to a shadcn/ui install); a native macOS/Windows app is also reasonable for a desktop API client.

The prototype uses inline React + Babel + Tailwind Play CDN for fast iteration. **Do not ship that stack** — it's a sketching tool, not a production build. Likewise the multi-file `*.jsx` split (components attached to `window`) is a prototype convenience; use real modules/imports in production.

## Fidelity
**High-fidelity (hifi).** Colors, typography, spacing, radii, interaction patterns, copy, and component shapes are all decided. Recreate pixel-perfectly using the target codebase's UI primitives.

## Top-level layout

The app is a fixed-size desktop window. Vertical stack:

```
┌──────────────────────────────────────────────────────────────────────┐
│ Titlebar  (36px, drag) — logo·name·env picker ╎ tools ╎ min/max/×      │
├───────────┬──────────────────────────────────────────────────────────┤
│           │ Request tabs   (36px) — [tab][tab][tab] … [+]              │
│ Sidebar   ├──────────────────────────────────────────────────────────┤
│ (collec-  │ Address bar    (56px) — TLS / host / method picker / Send  │
│  tions    ├──────────────────────────────────────────────────────────┤
│  tree)    │ Request pane              │ Response pane                  │
│           │  - tabs (underline)       │  - tabs (underline)            │
│ Checkout  │  - body / metadata / auth │  - body / trailers / headers   │
│ Identity  │                           │                                │
│ Edge/REST │   …OR the active tab's main area is one of:                │
│ Sandbox   │     · Collection Overview (clicking a collection)          │
│           │     · Server Overview     (server scenario)                │
│           │     · Server Browser      (browse scenario)                │
│           │     · New-request / Disconnected hero                      │
├───────────┴──────────────────────────────────────────────────────────┤
│ StateBar  (floating pill, bottom-center) — scenario switcher (design)  │
└────────────────────────────────────────────────────────────────────────┘
```

The split between Request and Response panes is **horizontal by default** (stacked top/bottom — note: the `split` tweak default is `"horizontal"` which renders `flex-col`) and can be flipped to `vertical` (side-by-side) via the `split` tweak.

> **There is no separate top toolbar row.** The brand wordmark, environment picker, the three utility buttons, and the window controls all live in the **single 36px title bar**.

## Screens / Views

There is one window; what fills the **main area** is driven by **scenarios** (held per-tab). The bottom floating state-bar exposes a subset as pills for review: `request`, `sending`, `success` (OK), `error`, `browse` (Browse), `env` (Env), `settings` (Settings). Other scenarios (`connected`, `idle`, `connecting`, `newServer`, `collection`, `server`, `streaming`) are reached through normal interaction.

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
| `streaming`  | **Out of MVP scope** — incremental frames pane + Cancel. Deferred. Do not ship.                       |

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
- Height: 36px (`h-9`). `bg-card/50`, bottom border, `z-30`. A horizontally-scrolling row of tabs followed by a fixed **+** button (36px wide).
- **Each tab**: `min-w-[132px] max-w-[210px]`, `border-r border-border`, `pl-3 pr-1.5`. Active tab = `bg-background` with a 1.5px foreground bar across its **top** edge; inactive = transparent, `hover:bg-accent/40`.
  - Label: the saved-request name, else the method name, else the typed host, else "New request" — mono 12px, truncated. Active = `text-foreground`, inactive = `text-muted-foreground` (→ foreground on hover).
  - A new/unconnected tab shows a small `Plus` glyph before the label. A streaming method shows a `bg-stream` dot (out of MVP scope visually).
  - **Close affordance** (right): a 20px ghost button. When the tab is **dirty**, it shows a filled `bg-foreground/80` dot that swaps to an × on hover; the dot stays visible even when the tab isn't hovered. Clean tabs show the × only on hover/active.
  - **Middle-click** anywhere on the tab closes it (via `requestClose`, which routes through the dirty check).
- **+ button**: full-height, 36px wide, `Plus` icon, `hover:bg-accent/50`, `border-r`. Opens a new `newServer` draft tab.

#### Close-tab confirmation (`CloseConfirm`)
- A `Dialog` (`max-w-md`). Title "Unsaved changes", body *"'{label}' has edits that haven't been saved yet. Close it anyway?"*. Footer: **Cancel** (ghost) · **Discard** (outline, destructive-tinted text) · **Save & close** (primary). Only appears when closing a tab whose `dirty` flag is set.

#### Address bar (`ConnectionBar`, Postman-style)
- Height: 56px (`h-14`). Bottom border, `px-3.5`, `gap-2`.
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
- **Kind dot colors**: `unary` = muted-foreground/50, `server` = `--stream`, `client` = `--warn`, `bidi` = purple-400. (Streaming kinds: don't surface in shipped MVP.)
- Empty: "No methods match \"q\"".

#### Sidebar (collections-first — `sidebar.jsx`)
- Width: fixed (~300px via `SidebarShell`). **Header row**: filter input (leading filter icon, placeholder "Filter collections & requests") + a **+** ghost icon button (tooltip "New request" → opens a `newServer` draft) + an overflow **⋯** menu (`RowActions`): *New collection · Reveal active request · Expand all · Collapse all · Import collection… · Export collection…*.
- **Body**: the collection tree.
  - **Collection row** (`CollectionNode`): `h-24`-ish (`!h-[24px]`), 12px text, `text-foreground/80`. A chevron toggle sits at the far left (absolute); the row label is a button that **opens the Collection Overview** (`onOpenCollection`). Trailing mono request-count. Expanding reveals children.
  - **Folder row** (`FolderNode`, recursive): muted, 11.5px, chevron + folder icon + name + count. **Empty folders are hidden.**
  - **Request row** (`RequestRow`): a left **type marker** (`ReqTypeTag`) then the label. Saved requests show their `name` in sans; bare pinned methods show the method name in mono. Active request gets a 2px foreground left bar + `isActive` styling. A right-anchored tooltip shows the full signature + target host.
  - **Type markers** (Postman-style, left gutter): gRPC unary = a quiet blue mono **"g"**; gRPC streaming = a stream arrow (`↓` server / `↑` client / `↕` bidi) in `--stream` (MVP: streaming hidden); HTTP = a colored mono **verb** (`GET` green / `POST` amber / `PATCH` purple / `PUT` blue / `DELETE`→"DEL" red).
- **Row delete + actions**: hovering a row reveals a trailing **⋯** button; **right-clicking** the row opens the same menu *at the cursor* (`RowMenu`, a fixed-position floating list that closes on outside-click / Esc / scroll). Menu items vary by node type (collection / folder / request) but **Delete** is always present and is the only destructive (red) item — it stays red on hover via a `bg-destructive/10` tint. Deleting prunes the node (and now-empty folders) from the tree (prototype tracks removed ids in local state).
- **Empty states**: no collections → a centered block with "New collection" + "Import collection…" buttons; a collection with no requests → an inline "No requests yet · + Add" row; filter with no matches → "Nothing matches \"q\"".

#### Collection Overview (`CollectionOverview` in `browser.jsx`; building blocks in `collection-overview.jsx`)
Opened by clicking a collection in the sidebar (`collection` scenario). Fills the main area; **not a modal**.
- **Header** (48px, `h-12`): Layers icon + **inline-editable title** (`CollectionTitle` — click to edit, Enter saves, Esc cancels, pencil affordance on hover) + a muted "N requests · M targets" summary + an **Export** outline button + a close **×**.
- **Tabs** (`COTabs`, underline style, with optional count hint): **Overview · Authorization · Variables · Settings**. Body is a centered `max-w-[720px]` scroll column.
  - **Overview**: an empty-state callout if the collection has no requests; a **Description** block (`DescriptionBlock` — view / inline-edit / "Add a description" empty state, markdown-supported textarea); a **Targets** block (wrap of mono host chips); and a **Requests** block — the collection's saved requests + pinned methods grouped by folder (recursive `CO_Rows`), each row clickable to open the request (marker + label + signature + target host + a send glyph on hover).
  - **Authorization**: per-environment auth (`AuthBlock`). A segmented environment selector, a method `MiniSelect` (No auth / Bearer / Basic / API key / **Mutual TLS — disabled** with a lock + tooltip), and an editor whose fields reference **environment-variable names** (`EnvVarField`, a `{}`-prefixed mono input), never raw secrets. Footer note reinforces "secrets live in the environment, never the collection."
  - **Variables**: `VariablesBlock` — a Name/Value table of `{{name}}` collection variables with add/remove; empty state explains the `{{name}}` convention.
  - **Settings**: **TLS defaults** (`TlsBlock` — "Use TLS by default" switch; "Skip certificate verification" switch that is only enabled when TLS is on, with a warning banner when active) + a **Danger zone** "Delete collection" (destructive button → in-panel confirm overlay).
- **Delete confirm**: an in-panel overlay (`absolute inset-0`, dimmed backdrop, centered card) — destructive icon, "Delete collection?", body naming the collection + request count, **Cancel** / **Delete** footer. Reads as part of the window, not a global modal.

> `collection-overview.jsx` also contains a standalone `CollectionOverviewPanel` (an alternate single-/tabbed packaging used during exploration). The **shipping** path is `CollectionOverview` in `browser.jsx`, which reuses the building-block components (`COTabs`, `COBlock`, `CollectionTitle`, `DescriptionBlock`, `VariablesBlock`, `TlsBlock`, `AuthBlock`, `EnvVarField`, `MiniSelect`) exported from `collection-overview.jsx`.

#### Server Overview (`ServerOverview` in `browser.jsx`)
Shown in the `server` scenario. Fills the main area.
- **Header** (48px): server name + mono host + a reachability label (`Reachable` ok / `Slow` warn / `Unreachable` destructive) + a **Refresh** outline button + close ×.
- **Tabs** (underline): **Overview · Authorization · Variables**.
  - **Overview** (`SO_Overview`): a one-line summary ("exposes N methods across M services over gRPC/HTTP"), two KV cards (Connection: Host / TLS / Protocol; Catalog: Services / Methods / Reflection), then a filterable method list grouped by service — each method row clickable to open it in the editor.
  - **Authorization** (`SO_Auth`): a `ToggleGroup` (Bearer / API key / None), the matching field(s), and an "Inherit from environment" switch.
  - **Variables** (`SO_Vars`): a server-scoped variable table + "Add variable".

#### Server browser (`ServerBrowser` in `browser.jsx`)
Shown in the `browse` scenario.
- **Header** (48px): server name + host + (gRPC) a reflection summary chip + Update / settings / close.
- **Filter row** (44px): a search input ("Filter N methods…"), a gRPC-only "Streaming" toggle (out of MVP scope), and a "shown of total" count.
- **Method list**: grouped by service; each row is a **checkbox** row (custom 14px check tile → `bg-primary` when checked, a 2px `bg-primary` left bar when selected) + method tag + name + `req → res` types.
- **Selection action bar** (52px, bottom): "N selected" + Clear, a target-collection chip, and a primary **Add to collection** button (disabled at 0).

> Selection accents here use the neutral `--primary` token — **no per-server color**.

#### Request pane (`RequestPanel`, `panels.jsx`)
- Pane head (40px, `h-10`): underline tabs `[Body] [Metadata 3] [Auth bearer]` on the left + ghost icon buttons (Beautify / Word-wrap / Copy) on the right. Backdrop blur, semi-transparent bg.
- **Body** tab: line-numbered JSON code view, mono 12.5px, syntax-highlighted via `--syntax-*` tokens (key=blue, string=green, number/bool/var=orange, punct=mid-gray). `{{vars}}` rendered in the number color. Editing sets the active tab's `dirty` flag.
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
A **design-time affordance**. Ship the values it produces (theme, accent, density, sidebar on/off, split orientation, fonts, dotted-bg) wired into real settings/prefs UI — **don't ship the panel itself**.

#### New request draft / Disconnected hero (`app.jsx`)
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

- **Tabs**: `+` (tab bar or sidebar) → new `newServer` draft tab. Click a tab to activate; middle-click or × to close. Closing a `dirty` tab → `CloseConfirm` (Save & close / Discard / Cancel). Closing the last tab replaces it with a fresh draft. Each tab keeps independent `selected` / `host` / `tls` / `scenario`.
- **Connect / Disconnect**: address bar "Connect" → `connecting` → (fake ~850ms latency) → `connected`. Toggling TLS while connected → `idle`. From a draft, Connect (or **Enter** in the host field) runs reflection and would add the server. *Production: trigger gRPC reflection, populate the registry + tree.*
- **Pick a method**: from the sidebar tree, the method picker, a Collection/Server Overview row. Sets the tab's `selected`, host, tls; loads the body template for `${svc}/${mth}` (HTTP keys use the path).
- **Send**: primary button. Unary/HTTP → `sending` → `success` after ~750ms. *Production: until the call resolves.* (Streaming kinds map to the deferred `streaming` scenario — out of MVP.)
- **Open a collection**: click the collection row → `collection` scenario → Collection Overview. **Open a server overview**: `server` scenario. **Browse a server**: `browse` scenario.
- **Delete** (collection / folder / request): hover ⋯ or right-click → **Delete**. Empty folders auto-hide. *Production: delete from the collection store.* Collection delete uses an in-panel confirm.
- **Inline edits**: collection title (Enter/Esc), collection description (Save/Cancel/Esc), variables table rows, env-var auth fields.
- **Theme toggle / Env dropdown**: persist theme; env switch affects `{{var}}` substitution.
- **Beautify / Wrap / Copy** in the request pane head: act on the body editor (no-ops in prototype).

### Animations / transitions
- Tab underline: opacity 0↔1, `transition-opacity` (~150ms ease). Tab text: `transition-colors`.
- Dialog / in-panel confirm: `fade-in` (.15s) backdrop + `zoom-in` (.15s, scale .96→1) card.
- Send / connect spinner: 0.8s linear infinite, 1.5px border, transparent top.
- Dotted background glow: radial mask follows the cursor over the main area (`--mx`/`--my` CSS vars), `transition: opacity .25s`. Toggled by the `dots` tweak.
- (Deferred) streaming dot pulse: 1.4s ease-in-out, opacity 1→.35→1.

## State management

Most state lives at `App` level (`useState` in the prototype — translate to your store of choice). **Per-request state is held in a `tabs[]` array**, one entry per open request:

| Per-tab key   | Type                                  | Notes                                                         |
|---------------|---------------------------------------|--------------------------------------------------------------|
| `id`          | string                                | tab id                                                       |
| `selected`    | `{ serverId, svc, mth, savedName? }` \| null | currently-selected method/request                     |
| `host`        | string                                | host:port                                                    |
| `tls`         | boolean                               | TLS on/off                                                   |
| `scenario`    | enum (see table)                      | drives the main area for this tab                            |
| `requestTab`  | `'body' \| 'metadata' \| 'auth'`      | request pane                                                 |
| `responseTab` | `'body' \| 'trailers' \| 'headers'`   | response pane                                                |
| `streamFrames`| array                                 | deferred (streaming, out of MVP)                             |
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

The model is a **server registry** + a **collections tree** that references it.

- **`servers[]`** — master registry. Each: `{ id, name, host, tls, dot, status: 'ok'|'slow'|'unreachable', proto: 'grpc'|'http', reflection: {services, methods}|null, services[] }`. A gRPC service is `{ name (FQN), short, methods[] }`; a gRPC method is `{ name, kind: 'unary'|'server'|'client'|'bidi', req, res }`. For HTTP servers, the single service has `short: ""` and methods are `{ name: '/path/{id}', verb: 'GET'|'POST'|'PATCH'|'PUT'|'DELETE', req, res }`.
- **`collections[]`** — the **sidebar tree** (collections-first). Each node has a `type`:
  - `collection`: `{ type, id, name, description, variables: [{id,k,v}], tls: {enabled, skipVerify}, authByEnv: { <envName>: {type, …} }, children[] }`.
  - `folder`: `{ type, id, name, children[] }` (recursive).
  - `request`: `{ type, id, serverId, svc, mth, name? }` — references a registry method; `name` present = a user-saved request, absent = a bare pinned method. Target host is resolved from `serverId`.
  - `authByEnv` value per env: `{ type: 'none'|'bearer'|'basic'|'apikey' }` plus `bearer:{tokenVar}` / `basic:{userVar,passVar}` / `apikey:{valueVar}` — **all values are env-variable NAMES**, not secrets. (`mtls` is a known type but **disabled** in the UI.)
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
--stream / --stream-foreground blue    (light 200 65% 42% · dark 200 70% 65%)   ← streaming = out of MVP; token stays for kind dots/arrows
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
- `app.jsx` — App root, **multi-tab** state, `Titlebar`, `RequestTabs`, `CloseConfirm`, `ConnectionBar` (address bar), `NewRequestHero` / `DisconnectedHero`, `StateBar`, theme/font/accent effects, main-area router.
- `sidebar.jsx` — **collections-first** tree (`Sidebar`, `CollectionNode`, `FolderNode`, `RequestRow`), `RowMenu` / `RowActions` (hover-⋯ + right-click delete), type markers (`ReqTypeTag`/`MethodTag`/`MethodVerb`), `verbOf`.
- `panels.jsx` — `RequestPanel`, `ResponsePanel`, `MethodPicker`, `UnderlineTabs`, `MetadataView`, `KVTable`, `CodeView`, `RespMeta`, tokenizer (+ deferred `StreamView`).
- `browser.jsx` — `ServerBrowser`, `ServerOverview` (+ `SO_*` tabs), and the shipping `CollectionOverview` (+ `CO_*` row helpers).
- `collection-overview.jsx` — Collection-overview building blocks (`COTabs`, `COBlock`, `CollectionTitle`, `DescriptionBlock`, `VariablesBlock`, `TlsBlock`, `AuthBlock`, `EnvVarField`, `MiniSelect`) + the alternate `CollectionOverviewPanel`.
- `modals.jsx` — Environment modal, Settings modal. (There is **no** AddServerModal — adding a server is the `newServer` draft.)
- `shadcn.jsx` — shadcn-style primitives + `cn`.
- `icons.jsx` — inline SVG icon set.
- `data.js` — fixtures: server registry, collections tree, legacy single collection, environments, bodies, responses, trailers, + `findServer` / `findMethod` helpers.
- `styles.css` — scrollbars, syntax tokens, dotted background, spinner, pulse, label-cap, selection.
- `tweaks-panel.jsx` — design-time tweak controls (not shipping).

## Notes for the implementer
- **Multi-tab is core.** Per-request state belongs to the tab, not the app. Closing a dirty tab must confirm.
- **Adding a server is address-first** (a `newServer` draft) — there is **no Add-server dialog**. Don't reintroduce one unless asked.
- **The sidebar is collections-first.** Don't model a server level in the tree; a request resolves its target from `serverId`. Collection/folder/request rows are deletable via hover **⋯** and right-click (single red **Delete**, opens at cursor, closes on outside-click / Esc / scroll).
- **Auth references env-variable names, never raw secrets** — everywhere auth appears (Collection Overview, Server Overview). `mtls` is shown but disabled.
- **Dialog sizing must use inline `style`** (width/height + viewport-bounded max), because the base `max-w-lg` beats utility `max-w-*` by source order. Settings height must stay constant across sections. Keep `text-foreground` + `border-border` on `DialogContent`.
- The **address bar pattern** (TLS + host + method picker + Send in one row) and the **Linear/Vercel-style underline tabs** are load-bearing for the look. There is **no leading "/"** before the method picker — keep it gone.
- The MethodPicker should be **searchable** and **keyboard-navigable** (arrows + Enter + Esc) in production; the prototype only wires the click path.
- Keep the four semantic colors (`--ok / --warn / --destructive / --stream`) consistent wherever status surfaces (kind dots, HTTP verbs, pills, warnings).
- **MVP = no streaming.** Don't surface streaming response panes, Stream pills, or the streaming filter result in shipped UI. The fixtures/tokens/arrows can stay dormant.
- **No server color tags.** Don't reintroduce per-server colored dots on tabs or headers; selection accents use `--primary`. The only colored dot that stays is the **env** dot in the title bar.
- **Don't ship the `StateBar`** (the floating bottom pill) or the **Tweaks panel** — both are design-review affordances. Ship the *values* the tweaks produce as real prefs.
- The window chrome (`Titlebar`) is desktop-shell territory. On Tauri/Electron set `decorations: false` and reuse it; on web, relocate the env picker + utility buttons into your app shell rather than deleting them.
