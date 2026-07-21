# Handshaker — agent instructions

Handshaker is a desktop gRPC client (Tauri 2 + React 18 + Rust).
Workspace: `crates/handshaker-core` (OS-independent core) · `src-tauri` (IPC) ·
`src` (React frontend).

## Active work

Active: **collection links** (spec #15) — #16 merged, **#17 next** (`{{var}}` resolution
of link URLs, unresolved-state marking, opening in the system browser).

Latest merged: **collection links CRUD** (#16) — `Collection.links` (`CollectionLink
{ name, url }`, `serde(default)`) persists through the collection upsert path and rides
bundle export/import; a "Links" block on the collection overview does add/edit/delete.
URLs stay `{{var}}` templates, rendered verbatim. Ticket: `gh issue view 16` ·
memory `project-collection-links-crud-done`.

Integration branch is `main`; features run in isolated worktree branches (`claude/*`)
and land fast-forward. Before merging, squash the branch into clean, cohesive history —
`.claude/rules/squashing-feature-branches.md`. The source of truth for any feature's
status is its `archive/` plan banner and `git log main`, not this section.

## Build / test / run

Package manager is **pnpm** (`pnpm@9`). Rust is a Cargo workspace
(`crates/handshaker-core` + `src-tauri`).

- Lint / typecheck — `pnpm lint` (`tsc -b`)
- Frontend tests — `pnpm test` (`vitest run`); single file — `pnpm vitest run <path>`
- Core / IPC tests — `cargo test --workspace`; single test —
  `cargo test -p handshaker-core <test_name>`
- Run the app — `pnpm tauri:dev`
- Format — `pnpm format`
- **Regen IPC bindings** after any Rust command/DTO change —
  `cargo run -p handshaker --bin export-bindings --features export-bindings --quiet`
  (rewrites the **tracked** `src/ipc/bindings.ts` — commit the regenerated file;
  `tauri dev` also regenerates it, prettier-formatted)

**The gate** (green before any fast-forward merge) = `pnpm lint` + `pnpm test` +
`cargo test --workspace`. An IPC/DTO shape change is invisible to a cargo-only gate —
always run `pnpm lint` and the full `pnpm test`, and sync the TS fixtures.

Do **not** run a standalone `vite` alongside `tauri:dev`, and don't verify in a plain
browser — `getCurrentWindow` crashes outside Tauri (blank page). Verify via `pnpm tauri:dev`.

**Fresh worktree:** run `pnpm install`, then build `dist/` **before** compiling
`src-tauri` — `generate_context!` requires `dist/`.

## Architecture

One-directional layering; the frontend never speaks gRPC itself:

React (`src/features/*`) → `src/ipc/client.ts` facade (sole consumer of the generated
`src/ipc/bindings.ts`) → `#[tauri::command]`s (`src-tauri/src/commands/*`) → `*Ipc` DTO
mirrors (`src-tauri/src/ipc/*`, `from_core`/`into_core`) → `crates/handshaker-core`.
The core is specta-free and tonic-free outside `grpc/transport`.

Invariants that span layers (ubiquitous language + details: `CONTEXT-MAP.md` →
per-context `CONTEXT.md`):

- The **Send spine** (resolve pipeline → builtin expansion → invoke → token
  invalidation on 16) lives in core exactly once, behind the shared `Sender`;
  `grpc_send` is an adapter (store reads, cancel/timeout race, wire mapping). The
  frontend sends `{{var}}` templates, never resolved values.
- **Auth pick** (which config wins) is sync core logic the UI asks over IPC;
  **auth materialization** (env var read / OAuth2 token fetch) is async, behind the
  token-source seam.

## Conventions — committed rules (`.claude/rules/`, auto-loaded)

- `ui-strings.md` — every user-facing string lives in `src/lib/messages.ts`
  (path-scoped to `src/**/*.{ts,tsx}`).
- `archiving-completed-work.md` — move finished plans/specs into `archive/` and refresh
  the "Active work" pointer.
- `squashing-feature-branches.md` — squash `claude/*` into cohesive history before ff.

## Compact instructions

On compaction, **always preserve**: the active plan path and which task is in progress;
the list of files changed this session and any uncommitted work; the build/test commands
used.

## Session cadence

Multi-session plan execution (`/clear` between tasks, `/compact` mid-task, 🧹 checkpoints,
the minimal post-`/clear` handoff). Default mode is **subagent-driven** — don't ask.
Details: `docs/agents/session-cadence.md`.

## Agent skills

Config for Matt Pocock's engineering skills (`triage`, `to-tickets`, `to-spec`,
`diagnosing-bugs`, `tdd`, `improve-codebase-architecture`, etc.). One-line summaries here;
details in `docs/agents/*.md`.

- **Issue tracker** — tasks live in GitHub Issues on `xlcorg/handshaker` (via `gh`);
  external PRs are **not** a triage surface. See `docs/agents/issue-tracker.md`.
- **Triage labels** — canonical vocabulary (`needs-triage`, `needs-info`,
  `ready-for-agent`, `ready-for-human`, `wontfix`); label strings match role names.
  See `docs/agents/triage-labels.md`.
- **Domain docs** — multi-context: root `CONTEXT-MAP.md` points to per-context
  `CONTEXT.md` (`handshaker-core` / `src-tauri` / `src`); ADRs in root and per-context
  `docs/adr/`. See `docs/agents/domain.md`.
