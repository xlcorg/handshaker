# Handshaker

Cross-platform desktop client (macOS + Windows) for exploring and invoking internal gRPC services. Built on Tauri 2 + Rust + React/Vite/TypeScript + Tailwind v4 + shadcn/ui.

Tagline: *pull the handles — we'll handle the handshake*.

## Status

MVP under construction. Plan #1 (project skeleton) is complete. See `docs/superpowers/plans/` and `docs/superpowers/specs/`.

## Prerequisites

- Rust **stable** ≥ 1.80 (workspace pins via `rust-toolchain.toml`).
- Node 20 (see `.nvmrc`).
- **pnpm** 9+ (`corepack enable && corepack prepare pnpm@9 --activate`).
- macOS or Windows host. Linux is untested in MVP.

## First-time setup

```sh
pnpm install
```

## Development loop

1. Generate / refresh typed IPC bindings whenever Rust commands change:

   ```sh
   cargo run -p handshaker --bin export-bindings --features export-bindings --quiet
   ```

   This writes `src/ipc/bindings.ts` (gitignored). The dedicated bin is the regen path because the `cfg(debug_assertions)` export inside `lib.rs::run()` only fires when the windowed app actually starts. It is gated behind the `export-bindings` feature so `tauri build` doesn't try to bundle it (the bundler skips `[[bin]]` targets whose required-features are off).

2. Launch the dev app:

   ```sh
   pnpm tauri:dev
   ```

   Hot-reloads on frontend changes; Rust changes trigger a re-compile.

## Production-style build (without bundling)

```sh
pnpm tauri:build
```

(Bundle production with installers is `next-step` — `bundle.active=false` in `tauri.conf.json`.)

## Workspace layout

```
handshaker/
├── crates/handshaker-core/   OS-independent core (errors, gRPC, auth, collections — grows plan-by-plan)
├── src-tauri/                Tauri 2 shell: capabilities, IPC commands, app state
├── src/                      React + TS frontend (Vite, Tailwind v4, shadcn dark)
└── docs/superpowers/         specs + plans
```

## Checks

```sh
cargo build --workspace
cargo test -p handshaker-core
cargo clippy --workspace --all-targets -- -D warnings
pnpm lint
pnpm build
```

## Architecture notes

- `handshaker-core` is OS-independent and tonic-type-free outside the transport impl.
- Frontend talks to Rust only through typed `tauri-specta` bindings — never directly to gRPC.
- Single-source-of-truth descriptor pool via `prost-reflect` (lands in Plan #2).
- Auto-authorization via `AuthProvider` trait (lands in Plan #5).

## License

Apache-2.0 OR MIT.
