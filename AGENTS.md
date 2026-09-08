# Repository Guidelines

## Project Structure & Module Organization

Handshaker is a desktop gRPC client built with Tauri 2, React, TypeScript, and Rust.

- `src/features/`: feature UI; `src/components/ui/`: shared primitives; `src/lib/`: utilities and centralized UI copy.
- `src/ipc/client.ts`: frontend IPC facade; `src/ipc/bindings.ts`: tracked, generated bindings.
- `src-tauri/`: desktop shell, commands, IPC DTOs, and capabilities.
- `crates/handshaker-core/`: platform-independent domain logic and gRPC transport; integration tests in `tests/`.
- `assets/`: branding; `scripts/`: release tooling; `docs/`: plans, specs, and architecture. Start domain exploration with `CONTEXT-MAP.md`.

Keep dependencies flowing from React through the IPC facade and Tauri adapters into core. The frontend never calls gRPC directly.

## Build, Test, and Development Commands

Use Node 20, pnpm 9, and stable Rust with rustfmt/Clippy.

- `pnpm install`: install dependencies.
- `pnpm build`: typecheck and build `dist/`; run before compiling Tauri in a fresh checkout.
- `pnpm tauri:dev`: run the desktop app with hot reload. Verify UI here; browser-only execution lacks Tauri APIs. Do not run a separate Vite instance alongside it.
- `pnpm tauri:build`: build the production desktop app.
- `pnpm lint`: TypeScript checks; `pnpm format`: format frontend sources with Prettier.
- `cargo fmt --all`: format Rust; `cargo clippy --workspace --all-targets -- -D warnings`: lint Rust.

After Rust command/DTO changes, regenerate and commit bindings:

```sh
cargo run -p handshaker --bin export-bindings --features export-bindings --quiet
```

## Coding Style & Naming Conventions

Follow `.editorconfig`: two-space indentation, four spaces for Rust, LF endings, and final newlines. Use PascalCase for React components/types, camelCase for TypeScript functions, and snake_case for Rust functions/modules. Match neighboring filenames. Keep user-facing strings in `src/lib/messages.ts`. Consume generated bindings through the IPC facade.

## Testing Guidelines

Before merging, run `pnpm lint`, `pnpm test`, and `cargo test --workspace`. Frontend tests use Vitest, jsdom, and React Testing Library; colocate `*.test.ts`/`*.test.tsx`. Script tests use `scripts/*.test.mjs`. Run targeted frontend tests with `pnpm vitest run <path>`. Add regression coverage for behavior changes; no numeric coverage threshold is configured. Update TypeScript fixtures when IPC shapes change.

## Commit & Pull Request Guidelines

Use scoped Conventional Commits, such as `feat(grpc): ...` or `fix(tls): ...`. Squash feature work into cohesive commits before merging into `main`; keep release bumps separate. PRs should describe the behavior change, link relevant issues/specs, report validation, and include screenshots for visible UI changes.

## Agent-Specific Instructions

When `.codegraph/` exists, use `codegraph explore "<symbol or question>"` or the CodeGraph MCP tool before text searches or source reads. Do not create an index automatically.
