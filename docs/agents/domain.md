# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

**This repo is multi-context** — a single Cargo+pnpm workspace split into three contexts:

- `crates/handshaker-core/` — OS-independent gRPC core (reflection, invoke, collections, env, auth)
- `src-tauri/` — Tauri IPC layer (commands, bindings, capabilities)
- `src/` — React 18 frontend

`CONTEXT-MAP.md` at the repo root points at one `CONTEXT.md` per context. System-wide decisions live in root `docs/adr/`; context-scoped decisions live under each context's own `docs/adr/`.

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root — it points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in. Also check the context's own `docs/adr/` (e.g. `crates/handshaker-core/docs/adr/`) for context-scoped decisions.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

Multi-context layout for this repo:

```
/
├── CONTEXT-MAP.md                      ← points at each context's CONTEXT.md
├── docs/adr/                           ← system-wide decisions
├── crates/handshaker-core/
│   ├── CONTEXT.md                      ← OS-independent gRPC core
│   └── docs/adr/                       ← core-specific decisions
├── src-tauri/
│   ├── CONTEXT.md                      ← Tauri IPC layer
│   └── docs/adr/                       ← IPC-specific decisions
└── src/
    ├── CONTEXT.md                      ← React frontend
    └── docs/adr/                       ← frontend-specific decisions
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the relevant context's `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
