# Collection links v3 — reliable open, user-defined order, hyperlink look

> **Status: ACTIVE** · Spec issue: [#27](https://github.com/xlcorg/handshaker/issues/27)
> · Tickets: #24 (open fix), #25 (reorder), #26 (hyperlink look)
> · Decisions from the 2026-07-22 grilling session. Glossary updated
> (`crates/handshaker-core/CONTEXT.md` — Collection link: effective URL,
> empty-link visibility, user-defined order).

## Problem Statement

Clicking a collection link whose URL was entered without a scheme
(`grafana.corp/d/abc`) shows a «Could not open» toast instead of opening the
browser — the link looks openable but never opens. Links also render in creation
order with no way to put the important ones first, and the chip styling
(bordered chip + external-link icon) doesn't read as "this is a link I can
click".

## Solution

A collection link always opens its **effective URL** — the resolved URL,
defaulted to `https://` when no `scheme://` prefix is present — so scheme-less
URLs open exactly as they would in a browser's address bar. Links with an empty
URL are never presented as openable: they show as broken rows while editing and
don't render as chips at all. Link order is user-defined: rows in the edit
dialog drag-reorder by a grip handle, and every display surface follows that
order. Chips become plain hyperlink-styled text (accent color, hover underline,
pointer cursor, no icon/border) so they read as links.

## User Stories

1. As a Handshaker user, I want a link typed as `grafana.corp/d/abc` to open `https://grafana.corp/d/abc`, so that I don't have to remember to type the scheme.
2. As a Handshaker user, I want the chip hover title to show the effective URL (with the defaulted scheme), so that I can see exactly what will open before clicking.
3. As a Handshaker user, I want a link to `localhost:8080` to open `https://localhost:8080`, so that host:port shorthand works like in a browser.
4. As a Handshaker user, I want a `{{host}}/dash` template whose var resolves scheme-less to still open with `https://` defaulted, so that templates and literals behave identically.
5. As a Handshaker user, I want a URL that already has a scheme (`http://…`) opened untouched, so that explicit schemes are always respected.
6. As a Handshaker user, I want a link with a non-http(s) scheme to keep showing the «Could not open» toast, so that a genuinely unopenable link fails loudly instead of silently.
7. As a Handshaker user, I want a nameless link's chip labeled with the host of its effective URL, so that scheme-less and schemed links are labeled consistently.
8. As a Handshaker user, I want a link whose URL is empty to be invisible in the strip/header/overflow, so that half-filled edits never produce dead chips.
9. As a Handshaker user, I want an empty-URL row marked broken in the edit dialog, so that I can see which stored link is incomplete.
10. As a Handshaker user, I want the ghost «Add link» chip shown when every stored link has an empty URL, so that the strip never looks populated with nothing clickable.
11. As a Handshaker user, I want to drag link rows by a grip handle in the edit dialog, so that I can put the most-used links first.
12. As a Handshaker user, I want the strip, header chips, and «+N» overflow menu to follow my chosen order, so that reordering has a visible effect everywhere.
13. As a Handshaker user, I want my link order persisted with the collection, so that it survives restarts and reloads.
14. As a Handshaker user, I want link chips rendered as accent-colored text that underlines on hover with a pointer cursor, so that I instantly recognize them as clickable links.
15. As a Handshaker user, I want broken links shown red and inert without an underline, so that I can tell a dead link from an openable one at a glance.
16. As a Handshaker user, I want pending (still-resolving) links muted and inert, so that I never click a link before its target is known.
17. As a Handshaker user, I want the «＋ Add link» ghost and «+N» overflow trigger to stay button-like, so that actions and links stay visually distinct.
18. As a Handshaker user, I want the ↗ open button on dialog rows kept, so that I can test a link while editing it.

## Implementation Decisions

- **Effective URL rule** lives in the frontend link classifier (the pure
  classification shared by strip chips, header chips, and dialog rows) — not in
  core resolve, which stays scheme-agnostic, and not at the open call, so hover
  titles/labels always match what actually opens. Applied after var-resolve for
  templated URLs; stored value stays exactly as typed.
- **Scheme detection**: a URL "has a scheme" iff it starts with a `scheme://`
  prefix (same lexical rule the host extractor already uses). Consequence
  accepted: `mailto:x@y` (no `//`) also gets `https://` prefixed — marginal for
  this feature's domain (dashboards/logs/docs).
- **Empty URL**: classified broken (dedicated title string) with no
  https-defaulting; a resolved-to-empty template is treated the same. Display
  surfaces filter empty-URL links out before rendering; the empty state (ghost
  chip) keys off the filtered list, while the edit dialog always shows all rows.
- **Nameless chip label** = host of the effective URL, falling back to the
  trimmed input when no host is extractable.
- **Reorder**: native HTML5 drag on dialog rows via a grip handle — the same
  idiom and shared reorder helper as environment rows. The new order flows
  through the existing rows-change callback and persists through the existing
  collection upsert; no schema or IPC changes (links were already an ordered
  list — the order simply becomes user-defined).
- **Hyperlink look**: chips lose the border and the external-link icon; label is
  accent-colored, underlined on hover, pointer cursor. State styling: broken =
  red, inert, no underline; pending = muted, inert. Ghost chip and overflow
  trigger unchanged as buttons.
- **Open failure surface** unchanged: opener-seam rejection (foreign scheme)
  still raises the existing toast.
- All new user-facing strings go through the central messages module.

## Testing Decisions

- Test external behavior only: what classification a URL yields, what the chip
  shows/does, what order the change callback emits — never internal helper
  structure.
- **Pure-function unit tests** for the link classifier and label (effective-URL
  defaulting, scheme detection edges — `localhost:8080`, `mailto:`, templates,
  blank/whitespace, resolved-to-empty).
- **Component tests** for strip/header/overflow/dialog through the existing
  resolve-injection props: empty-chip filtering, ghost state, hyperlink styling
  states (ready/broken/pending), click calls the mocked openExternal seam with
  the effective URL, drag-reorder emits the reordered rows.
- Prior art: existing strip/dialog component tests and the env reorder helper
  tests.

## Out of Scope

- Browser-style heuristics beyond the `://` rule (no port-based scheme
  sniffing); no support for opening non-http(s) schemes.
- Normalizing/mutating the stored URL on save.
- Reordering chips by dragging them directly in the strip/header.
- Any backend/IPC/schema change; any change to var-resolve.
- Toast copy rework.

## Further Notes

Tickets #24–#26 land as one worktree branch, one squashed commit per ticket,
gated on `pnpm lint` + `pnpm test` + `cargo test --workspace` before
fast-forward to `main`.

A stood-down WIP branch `claude/links-open-fix` (worktree) already carries green
implementation commits for #24 and #25 — reuse or discard when the tickets are
picked up.
