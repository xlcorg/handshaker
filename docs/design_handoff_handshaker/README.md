# Handoff: Handshaker — gRPC Desktop Client

## Overview
Handshaker is a desktop client for invoking gRPC services — think "Postman, but for gRPC". Users connect to a host (e.g. `api.example.com:443`), discover services via reflection (or import `.proto` files), pick a `Service.Method`, edit a request body in JSON, and inspect the response (body, trailers, headers, streaming frames, errors).

This handoff covers the **single primary window** of the app: title bar, top toolbar, address bar, sidebar, request pane, response pane, scenario state-bar, and the in-design Tweaks panel that switches theme/density/fonts/layout.

## About the Design Files
The files in this bundle are **design references created in HTML/JSX** — a high-fidelity prototype showing intended look and behavior, **not production code to copy directly**. The task is to **recreate this design in the target codebase's environment** (likely a desktop shell — Tauri, Electron, or native — using whatever component system the target uses) following its established patterns and libraries. If no environment exists yet, pick the most appropriate stack (a React + Tailwind + shadcn/ui setup would mirror the prototype most directly; a native macOS/Windows app would also be reasonable for a gRPC client).

The prototype uses inline React + Babel + Tailwind Play CDN for fast iteration. Do not ship that stack — it's a sketching tool, not a production layout.

## Fidelity
**High-fidelity (hifi).** Colors, typography, spacing, radii, interaction patterns, copy, and component shapes are all decided. Recreate pixel-perfectly using the target codebase's UI primitives. The shadcn token names map 1:1 to a shadcn/ui install.

## Top-level layout

The app is a fixed-size desktop window. Vertical stack:

```
┌─────────────────────────────────────────────────────────────────┐
│ Titlebar           (32px, app-region: drag)                     │
├─────────────────────────────────────────────────────────────────┤
│ Toolbar            (48px) — brand, env picker, settings         │
├──────────┬──────────────────────────────────────────────────────┤
│          │ Address bar       (56px) — TLS / host / method / Send│
│ Sidebar  ├──────────────────────────────────────────────────────┤
│ (300px)  │ Request pane          │ Response pane                │
│          │  - tabs (underline)   │  - tabs (underline)          │
│ Services │  - body / metadata    │  - body / trailers / headers │
│ History  │  - auth               │  - streaming frames          │
│ Collect. │                       │                              │
├──────────┴──────────────────────────────────────────────────────┤
│ StateBar           (28px) — scenario switcher (design-only)     │
└─────────────────────────────────────────────────────────────────┘
```

The split between Request and Response panes is **vertical by default** (side-by-side) but can be flipped horizontal via the `split` tweak.

## Screens / Views

There is one screen; behavior is driven by **scenarios**:

| Scenario   | What's visible                                                                                  |
|------------|--------------------------------------------------------------------------------------------------|
| `idle`     | Sidebar shows "Not connected" empty state; main area shows DisconnectedHero with hint chips.    |
| `connecting` | Hero shows spinner + "Negotiating TLS…" + host:port; Connect button becomes "Connecting".     |
| `connected` | Sidebar lists discovered services; Request pane shows body editor; Response pane idle.        |
| `request`   | Connected + a method selected; same as `connected` with a populated body.                     |
| `sending`   | Send button shows spinner + "Sending"; Response pane shows "Sending request…" empty state.    |
| `success`   | Response pane shows body / trailers / headers tabs with content; status pill = green "OK".    |
| `error`     | Response pane shows error body; status pill = red with grpc-status code.                      |
| `streaming` | Response pane shows incremental frames with timestamps; Cancel button visible.                |
| `history`   | Sidebar switches to history tab.                                                              |
| `collections` | Sidebar switches to saved/collections tab.                                                  |
| `env`       | Environment modal open.                                                                       |
| `settings`  | Settings modal open.                                                                          |

The scenario state-bar at the bottom is **a design affordance**, not a shipping UI element — it's there so reviewers can flip between states. Do not ship it.

### Component-by-component

#### Titlebar
- Height: 32px. `bg-card`, bottom border `border-border`.
- Left: Anthropic-cube–style 13px logo icon + "Handshaker" word in `text-muted-foreground`, 11.5px, weight 500.
- Right: 3 traffic-light buttons (Minimize / Maximize / Close) — 24×20px ghost buttons. Close button hover = `bg-destructive`. Whole bar has `-webkit-app-region: drag`; buttons opt out via `no-drag`.

#### Toolbar
- Height: 48px. `bg-background/85 backdrop-blur-sm`, bottom border.
- Left: "Handshaker" 14px semibold + version badge (`v0.1.0`, mono 10px).
- Right group (gap 6px): sidebar toggle (ghost icon), theme toggle (ghost icon), env dropdown (outline button with colored dot + name + chevron), settings (ghost icon).
- Env dropdown content: label "Environments", list of `{ color dot, name, "N vars" }` rows, separator, "+ New environment", "Settings · Manage…". Width 288px.

#### Address bar (Postman-style)
- Height: 56px. Bottom border, no blur.
- Children, left to right:
  1. **TLS button** — 36×36 outline icon button. Lock icon when TLS on, Unlock when plaintext. Tooltip explains.
  2. **Combined input shell** — flex-1, height 36, `rounded-md border border-input bg-background`, ring on focus-within. Contains:
     - Host input (`host:port`, mono 12.5px) at left, no border, transparent bg, `rounded-l-md`.
     - 1px vertical divider (`bg-border`, vertically inset 6px).
     - "/" separator in muted-foreground/60, mono.
     - Method picker button (see below) filling remaining space.
     - When disconnected: host input alone + "not connected" / "negotiating…" hint in muted-foreground/70 mono 11.5px.
  3. **Send button** — primary, height 36, 88px min-width, gap 1.5. `Send` icon + "Send". When sending: spinner + "Sending". Disabled when `!selected || sending`.
  4. **Disconnect** — ghost 36×36 icon button (unlock icon, muted-foreground), tooltip "Disconnect". Only when connected.

#### Method picker (dropdown)
- Trigger: inline-flex button, mono 12.5px. Cube icon + `serviceShort` (muted) + "/" + `methodName` (foreground, medium weight) + optional kind badge (stream/client/bidi with colored dot) + chevron.
- Truncates each label at max 160px in the address bar.
- Hover/open: `bg-accent`.
- Popover: 420px wide, no padding, overflow hidden. Top has search input (h-40px, leading search icon, trailing `<Kbd>esc</Kbd>`), border-bottom. Below is a scrollable list (max-height 360px) grouped by service:
  - Group header: small caps label, 10.5px, letter-spacing 0.06em, cube icon.
  - Method row: button, h-28px, mono 12px, indent-32px, `methodName` (flex 1), `Request → Response` types in muted-foreground 10px, kind dot at right.
  - Kind dot colors: `unary` = muted-foreground/50, `server` = `--stream`, `client` = `--warn`, `bidi` = purple-400.
- Empty state: "No methods match \"q\"".

#### Sidebar
- Width: 300px. Bottom-aligned with the address bar above. Bottom border in `tab` row only.
- Tabs (`services` / `history` / `collections`) at top, then a search input, then content list.
- Disconnected: "Not connected" + small explainer + "Import .proto" outline button.

#### Request pane
- Pane head (40px): underline tabs `[Body] [Metadata 3] [Auth bearer]` on the left + ghost icon buttons (Beautify / Word wrap / Copy) on the right. Backdrop blur, semi-transparent bg.
- Body tab: line-numbered JSON code view, mono 12.5px, syntax-highlighted with `--syntax-*` tokens (key=blue, string=green, number=orange, punct=mid-gray, bool=orange). Variables `{{name}}` rendered as `--syntax-num` color.
- Metadata tab: 3-column table (Key / Value / delete) with header row, rows are mono 12px. Value `{{vars}}` styled as numbers.
- Auth tab: inline auth config (bearer token, etc).

#### Response pane
- Pane head: underline tabs `[Body] [Trailers (N)] [Headers (3)]` + right-aligned meta:
  - `streaming` shows red outline Cancel button with stop icon.
  - Always: RespMeta — colored status pill (OK=green / error code=red / "STREAM N frames"=blue), latency `1ms`, size `50B` in mono 11px.
- Empty states for `idle` and `sending` use a centered icon block + title + 1-line muted description.

#### Underline tabs (Linear/Vercel-style — important!)
- Container: `self-stretch flex items-stretch gap-0.5` (fills pane-head height so the underline aligns with its bottom border).
- Each tab: ghost button, gap 1.5, padding-x 10px, text 12.5px. Active = `text-foreground`. Inactive = `text-muted-foreground` with `hover:text-foreground` transition.
- Optional hint inline (e.g. count "3" or "bearer"): mono 10px, tabular-nums, muted-foreground (60% opacity if inactive).
- **Active underline**: absolutely positioned bar `left-2 right-2 -bottom-px h-[1.5px] rounded-full bg-foreground`. It must sit on top of the pane head's own `border-b` so the active tab visually connects to its content. No padding/box around the strip — no `TabsList` chrome.

#### Tweaks panel
- The Tweaks panel is **a design-time affordance**. Ship the values it produces (theme, density, etc) wired into real settings/prefs UI; don't ship the panel itself.

## Interactions & behavior

- **Connect / Disconnect**: address bar "Connect" → `connecting` scenario → after fake latency → `connected`. "Disconnect" → `idle`. In real impl: trigger gRPC reflection, populate services.
- **Method picker**: opening focuses the search input after 10ms. Up/down arrows + Enter would be the natural keyboard nav (not implemented in prototype). Esc closes. Selecting a method sets the body editor to the body template for `${svc}/${mth}`.
- **Send**: primary button in address bar. Disabled when no method or while sending. Unary methods → `sending` → `success` after 750ms (in production: until gRPC unary call resolves). Streaming methods → `streaming` (push frames as they arrive).
- **Cancel** (streaming): outline destructive button in response pane head → back to `connected`.
- **Beautify / Wrap / Copy** in request pane head: act on body editor (no-ops in prototype).
- **Theme toggle**: dark ↔ light. Persists.
- **Env dropdown**: switches active environment; affects `{{var}}` substitution in body/metadata.

### Animations / transitions

- Tab underline: opacity 0 ↔ 1, `transition-opacity` default (~150ms ease).
- Tab text color: `transition-colors`.
- Send button spinner: 0.8s linear infinite, 1.5px border with transparent top.
- Streaming dot pulse: 1.4s ease-in-out infinite, opacity 1 → .35 → 1.
- Dotted background glow: radial mask follows cursor, `transition: opacity .25s`.

## Design Tokens

### shadcn HSL tokens (already match shadcn/ui v0 defaults)

Light theme (`:root`):
```
--background: 0 0% 100%
--foreground: 0 0% 3.9%
--card: 0 0% 100%
--card-foreground: 0 0% 3.9%
--popover: 0 0% 100%
--popover-foreground: 0 0% 3.9%
--primary: 0 0% 9%
--primary-foreground: 0 0% 98%
--secondary: 0 0% 96.1%
--secondary-foreground: 0 0% 9%
--muted: 0 0% 96.1%
--muted-foreground: 0 0% 45.1%
--accent: 0 0% 96.1%
--accent-foreground: 0 0% 9%
--destructive: 0 84.2% 60.2%
--destructive-foreground: 0 0% 98%
--border: 0 0% 89.8%
--input: 0 0% 89.8%
--ring: 0 0% 3.9%
--radius: 0.5rem
```

Dark theme (`.dark`):
```
--background: 0 0% 3.9%
--foreground: 0 0% 98%
--card: 0 0% 3.9%
--popover: 0 0% 6%
--primary: 0 0% 98%
--primary-foreground: 0 0% 9%
--secondary: 0 0% 14.9%
--muted: 0 0% 14.9%
--muted-foreground: 0 0% 63.9%
--accent: 0 0% 14.9%
--destructive: 0 62.8% 30.6%
--border: 0 0% 14.9%
--input: 0 0% 14.9%
--ring: 0 0% 83.1%
```

### Semantic gRPC status tokens (custom)

```
--ok      / --ok-foreground       (green, e.g. hsl(142 50% 45%) / white)
--warn    / --warn-foreground     (amber, ~hsl(38 80% 55%) / black)
--stream  / --stream-foreground   (blue,  ~hsl(210 70% 55%) / white)
```
See `Handshaker.html` `:root` block for exact values per theme.

### Syntax tokens (in `styles.css`)

```
--syntax-key:    hsl(210 60% 65%)   /* keys (dark) */
--syntax-str:    hsl(95 40% 65%)    /* strings */
--syntax-num:    hsl(38 60% 65%)    /* numbers, vars, bools */
--syntax-punct:  hsl(0 0% 45%)
```
Light theme overrides darken these — see `.light{}` block.

### Typography

- UI: **Inter** 400/500/600/700 — fallbacks Geist, system-ui.
- Mono: **JetBrains Mono** 400/500/600 — fallbacks Geist Mono, IBM Plex Mono, ui-monospace.
- Sizes used: 10px (kind dots/hints), 10.5px (caps labels), 11px (tertiary meta), 11.5px (titlebar/badges), 12px (mono table rows), 12.5px (tabs, body input, code view), 13px (default body), 14px (toolbar wordmark).

### Spacing

Standard Tailwind scale (4px base). Notable callouts:
- Pane head: `h-10` (40px), `px-3.5` (14px), `gap-2.5` (10px).
- Address bar: `h-14` (56px), `px-3.5`, `gap-2` (8px).
- Inputs / buttons / outline-icon: `h-9` (36px).
- Underline tab padding: `px-2.5` (10px).
- Sidebar: 300px fixed.

### Radii

- Window outer: 10px (`rounded-[10px]`).
- Cards / inputs / buttons: `--radius` = 8px; `rounded-md` (6px) for tab pills and dropdowns; `rounded-sm` (2px) for titlebar window controls; `rounded-full` for status dots and the tab underline.

### Shadows

- Window outer border only — no drop shadow on the body (sits on black letterbox).
- Popovers/dropdowns: shadcn default (`shadow-md`).

## State management

State held at App level (`useState` in prototype — translate to your store of choice):

| Key            | Type                              | Notes                                          |
|----------------|-----------------------------------|------------------------------------------------|
| `scenario`     | enum (see table)                  | Drives most of the visible state               |
| `sideTab`      | `'services' \| 'history' \| 'collections'` | Sidebar tab                            |
| `query`        | string                            | Sidebar search                                 |
| `host`         | string                            | host:port                                      |
| `tls`          | boolean                           | TLS on/off                                     |
| `env`          | environment object                | Active env from `data.js`                      |
| `selected`     | `{svc, mth, kind}`                | Currently-selected method                      |
| `requestTab`   | `'body' \| 'metadata' \| 'auth'`  | Request pane                                   |
| `responseTab`  | `'body' \| 'trailers' \| 'headers'` | Response pane                                |
| `streamFrames` | array                             | Per-frame data for streaming methods           |
| Tweaks         | persisted via host protocol       | theme/accent/density/sidebar/split/fontUi/fontMono/dots |

Production: replace fake scenario timer (`setTimeout(... 750)`) with real gRPC call lifecycle. Streaming frames push as they arrive on the wire.

## Data shapes

See `data.js`. Highlights:
- `services[]`: `{ name, short, methods: [{ name, kind, req, res }] }`. `kind` ∈ `unary|server|client|bidi`.
- `bodies`: map of `"Service/Method"` → array of `{ ln: string }` rows for the editor.
- `responses`: success / error sample bodies.
- `trailers`: KV pairs.
- `environments`: `{ name, color, host, vars }`.
- `history` / `collections`: sample entries for sidebar tabs.

## Assets

- Fonts: Google Fonts CDN — Inter + JetBrains Mono.
- Icons: hand-rolled inline SVG components in `icons.jsx` (Lucide-style strokes, 1.5px). In production, swap for `lucide-react` (same visual style).
- No raster images.

## Files in this bundle

- `Handshaker.html` — entry point. Sets up Tailwind config, shadcn HSL tokens (light + dark), imports scripts.
- `app.jsx` — App root, scenario state, Titlebar, Toolbar, **ConnectionBar (address bar)**, DisconnectedHero, StateBar.
- `panels.jsx` — RequestPanel, ResponsePanel, **MethodPicker**, **UnderlineTabs**, MetadataView, KVTable, CodeView, StreamView, ErrorBody, RespMeta, tokenizer.
- `sidebar.jsx` — Sidebar with services/history/collections tabs.
- `modals.jsx` — Environment modal, Settings modal.
- `shadcn.jsx` — shadcn-style primitives (Button, Input, Badge, Tabs, Dialog, DropdownMenu, Tooltip, Switch, Separator, cn util). The boxy `Tabs/TabsList/TabsTrigger` here is **unused for pane heads** — pane heads use `UnderlineTabs` from `panels.jsx` instead. Keep boxy tabs around for any future use that wants pill-style.
- `icons.jsx` — Inline SVG icon set.
- `data.js` — Fixture data (services, bodies, responses, environments, history, collections).
- `styles.css` — Scrollbar, syntax tokens, dotted background, spinner, pulse, label-cap, selection.
- `tweaks-panel.jsx` — Design-time tweak controls (not shipping).

## Notes for the implementer

- The **address bar pattern (TLS + host + method picker + Send all in one row)** and the **Linear/Vercel-style underline tabs** are the two recent design decisions. Preserve them — they're load-bearing for the look.
- The MethodPicker dropdown should be **searchable** and **keyboard-navigable** (arrows + Enter + Esc) in production. The prototype only wires the click path.
- Status pills in `RespMeta` are tinted with the `--ok / --warn / --destructive / --stream` tokens — keep those four semantic colors consistent everywhere status surfaces (kind dots, badges, pills).
- Don't ship the `StateBar` at the bottom — it's a design-review-only switcher for scenarios.
- The window chrome (`Titlebar`) is desktop-shell territory. If targeting Tauri/Electron, set `decorations: false` and reuse it; if web, drop it entirely.
