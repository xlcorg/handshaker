# Handshaker — agent instructions

Handshaker is a desktop gRPC client (Tauri 2 + React 18 + Rust).
Workspace: `crates/handshaker-core` (OS-independent core) · `src-tauri` (IPC) ·
`src` (React frontend).

## Active work

No active feature (between features).

Latest merged: **single resolve pipeline** — battle Send routes through the core
`resolve_request` (vars → TLS → metadata → auth resolved once, in core, per ADR-0001).
Banner: `docs/superpowers/plans/archive/2026-07-02-single-resolve-pipeline.md` ·
memory `project_single_resolve_pipeline_done`.

Integration branch is `main`; features run in isolated worktree branches (`claude/*`)
and land fast-forward. Before merging, squash the branch into clean, cohesive history —
`.claude/rules/squashing-feature-branches.md`. The source of truth for any feature's
status is its `archive/` plan banner and `git log main`, not this section.

## Build / test / run

Package manager is **pnpm** (`pnpm@9`). Rust is a Cargo workspace
(`crates/handshaker-core` + `src-tauri`).

- Lint / typecheck — `pnpm lint` (`tsc -b`)
- Frontend tests — `pnpm test` (`vitest run`)
- Core / IPC tests — `cargo test --workspace`
- Run the app — `pnpm tauri:dev`
- Format — `pnpm format`

**The gate** (green before any fast-forward merge) = `pnpm lint` + `pnpm test` +
`cargo test --workspace`. An IPC/DTO shape change is invisible to a cargo-only gate —
always run `pnpm lint` and the full `pnpm test`, and sync the TS fixtures.

Do **not** run a standalone `vite` alongside `tauri:dev`, and don't verify in a plain
browser — `getCurrentWindow` crashes outside Tauri (blank page). Verify via `pnpm tauri:dev`.

**Fresh worktree:** run `pnpm install`, then build `dist/` **before** compiling
`src-tauri` — `generate_context!` requires `dist/`.

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

Config for Matt Pocock's engineering skills (`triage`, `to-issues`, `to-prd`,
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
