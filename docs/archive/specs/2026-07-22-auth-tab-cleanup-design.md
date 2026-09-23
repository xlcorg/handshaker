# Collection Authorization tab cleanup — placeholder, prefix, stale env, VarHighlightInput, messages

> **Status: 🎉 DONE** · Spec issue: [#28](https://github.com/xlcorg/handshaker/issues/28)
> · Tickets: #29 (strings → messages, prefactor), #30 (glossary accepted risks),
> #31 (header-name placeholder + visible API-key prefix), #32 (stale-env marking),
> #33 (OAuth2 fields on `VarHighlightInput`) — all merged to `main`.
> · Decisions from the 2026-07-22 grilling session against the live code. Glossary
> updated (`src/CONTEXT.md` — placeholder seeding, Bearer presentation label,
> kind-switch overwrite, dead-env marking, Get-token vs Send resolve divergence).
> No storage/IPC schema change; the Send spine is untouched.

## Problem Statement

The collection window's **Authorization** tab works, but is rough around the edges:

- The Header name fields come **prefilled** with the default (`authorization` /
  `x-api-key`), so choosing a custom header means manually erasing text first; users
  expect the default to be a hint (placeholder), not content.
- An **API key** config with a saved prefix shows no Prefix field at all — the stored
  value is invisible and uneditable from the UI.
- The **"Apply in environments"** gate silently keeps environment names that no longer
  exist (deleted or renamed envs), so the button shows a mix of live and dead names and
  the user can't tell why auth stopped applying somewhere.
- The **OAuth2 fields** (Token URL, Client ID, Client secret, Scope) accept
  `{{variables}}` but are plain inputs — no highlighting or autocomplete, unlike the
  collection link URL field which already has `VarHighlightInput`.
- Every user-facing string in the editor is an **inline literal**, violating the repo's
  `ui-strings` rule (single source of truth in `messages`).

## Solution

Tidy the Authorization tab in place, without changing the storage schema or the Send spine:

- Header name becomes a true placeholder field: empty input showing the kind default in
  grey; a stored value equal to the default seeds the field empty. Empty persists as the
  default (existing domain rule). Prefix stays a prefilled value — an empty prefix is a
  meaningful state ("no prefix").
- API key gains a visible, editable Prefix field.
- Dead environment names in "Apply in environments" are visibly marked
  (muted/struck-through with a hint) and can be unchecked; no backend cascade.
- OAuth2 fields migrate to `VarHighlightInput` with candidates = active env + collection
  variables (honest to what Send resolves).
- All user-facing strings move to the central `messages` module.
- Accepted trade-offs are written down in the frontend domain glossary (`src/CONTEXT.md`).

## User Stories

1. As a gRPC client user, I want the Header name field to show the default header as a grey placeholder, so that I can type a custom header without erasing prefilled text first.
2. As a gRPC client user, I want an empty Header name to persist as the kind's default (`authorization` for OAuth2, `x-api-key` for API key), so that leaving the field blank still produces a working config.
3. As a gRPC client user, I want a saved config whose header equals the default to reopen as an empty field with the placeholder, so that the editor keeps signalling "this is the default" rather than presenting it as my own input.
4. As a gRPC client user, I want the Prefix field to keep its explicit value (including empty = "no prefix"), so that I can send a bare token without a scheme word.
5. As a gRPC client user, I want the API key section to show an editable Prefix field, so that a stored prefix is visible and changeable instead of hidden.
6. As a gRPC client user, I want a config saved as `authorization` + `Bearer ` to display as Bearer regardless of which tab I typed it in, so that the same stored data always has one canonical presentation.
7. As a gRPC client user, I want dead environment names in "Apply in environments" to be visibly marked, so that I notice when a rename/delete broke my gating.
8. As a gRPC client user, I want to be able to uncheck a dead environment name, so that I can clean the gating list myself.
9. As a gRPC client user, I want live environment names to keep working in the gating popover exactly as before, so that the marking changes nothing for healthy configs.
10. As a gRPC client user, I want `{{var}}` tokens in Token URL, Client ID, Client secret and Scope to be highlighted as resolvable/unresolvable, so that I spot typos before sending.
11. As a gRPC client user, I want variable autocomplete in the OAuth2 fields, so that I can insert env/collection variables without remembering their names.
12. As a gRPC client user, I want the highlight verdict to reflect what Send will actually resolve (env + collection variables), so that the editor doesn't cry wolf on variables that work at send time.
13. As a gRPC client user, I want the "Get token" button to keep its current strict behavior (resolves from env only), so that my existing token-testing workflow is unchanged.
14. As a translator/maintainer, I want every string of the Authorization tab in the central messages module, so that changing the language is one edit in one file.
15. As a maintainer, I want the Bearer-as-presentation-label rule and the accepted risks (kind-switch overwrite, Get-token vs Send resolve scope) recorded in the frontend glossary, so that future sessions don't re-litigate them.

## Implementation Decisions

- **No storage or IPC schema change.** `SavedAuthConfig` stays a single-variant tagged
  enum; the Send spine (`resolve_request`, `pick_auth_config`) is untouched.
- **Header name placeholder semantics** live in the form-mapping module (`authConfigMap`):
  `configToForm` seeds the form's header field empty when the stored value equals the kind
  default; `formToConfig` keeps the existing empty→default normalization at persist time.
  The input renders the default as `placeholder`.
- **Prefix is never placeholder-mapped**: empty prefix round-trips as empty (meaningful
  "no prefix").
- **API key section** renders a Prefix input alongside Header name and Value.
- **Bearer is a presentation label**, not a stored kind: `env_var` with header
  `authorization` + prefix `Bearer ` renders as Bearer; the flip after re-open is accepted
  and documented. No stored "chosen tab" field.
- **Kind-switch overwrite risk accepted**: switching the kind persists immediately and the
  store holds only the active variant; the in-session edit buffer (re-seeded only on
  collection change) is the only guard. No toast/undo. Documented in the glossary.
- **"Get token" resolves from env only** (status quo), while Send resolves env + collection
  variables; the divergence is accepted and documented.
- **Dead env names**: computed client-side by diffing `environments` against the fetched
  env list; rendered muted/struck-through with a "deleted" hint in the popover and the
  summary button. No cascade on env rename/delete.
- **OAuth2 fields** (Token URL, Client ID, Client secret, Scope) migrate to
  `VarHighlightInput`; the collection overview passes the same variable candidates and
  resolve context it already builds for the Variables/Links blocks (env + unsaved
  collection var rows).
- **Strings**: all user-facing literals of the auth editor (labels, toggle options, hints,
  toasts, statuses) move to the `messages` module under a new auth namespace;
  state-dependent copy becomes functions per the ui-strings rule.
- **Glossary updates** in the frontend `CONTEXT.md`: Header-name placeholder semantics
  (extends the existing "empty → kind default at persist" entry), "Bearer is a presentation
  label", accepted risks (kind-switch overwrite, Get-token/Send resolve divergence). No
  ADR — everything is reversible.

## Testing Decisions

Existing seams only; test external behavior, not implementation:

- **`authConfigMap` pure tests** (existing file) — round-trips for: default header ↔ empty
  form field, custom header preserved, apikey prefix round-trip, empty prefix stays empty,
  Bearer inference from the canonical pair. This is the primary seam.
- **`SavedAuthEditor` RTL tests** (existing file) — placeholder visible on empty field and
  gone when typing; API key Prefix field present and editable; dead env names marked and
  uncheckable; OAuth2 fields expose highlighting input; copy comes from `messages`.
- **`CollectionOverview` RTL tests** (existing file) — wiring only: variable candidates and
  seed key reach the auth editor.
- Prior art: current `authConfigMap.test.ts` round-trip tests and `SavedAuthEditor.test.tsx`
  interaction tests; `LinksBlock`/`QuickLinksStrip` tests for `VarHighlightInput` assertions.

## Out of Scope

- Client secret masking (password-style input) — separate decision.
- Cascading env rename/delete into collections' `environments` lists — possible future ticket.
- Changing "Get token" or Send resolve scopes.
- Store/IPC schema changes (multi-variant auth drafts, stored kind tab).
- Toast/undo for kind switches.
- The request-level Auth tab (read-only inherited view) in the workflow panel.

## Further Notes

Decisions were reached in a grilling session on 2026-07-22 against the live code; the
send-side resolve behavior (env + collection vars for OAuth2 fields) was verified in core
before accepting the Get-token divergence.
