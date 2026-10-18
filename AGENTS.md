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

After Rust command/DTO changes, or after editing `VAR_PATTERN`, the `classify` match, or `BUILTIN_NAMES`, regenerate and commit:

```sh
cargo run -p handshaker --bin export-bindings --features export-bindings --quiet
```

That writes `src/ipc/bindings.ts` and the three `*.gen.ts` var tables. Do not add this command to `pnpm lint`.

## Coding Style & Naming Conventions

Follow `.editorconfig`: two-space indentation, four spaces for Rust, LF endings, and final newlines. Use PascalCase for React components/types, camelCase for TypeScript functions, and snake_case for Rust functions/modules. Match neighboring filenames. Keep user-facing strings in `src/lib/messages.ts`. Consume generated bindings through the IPC facade.

## Testing Guidelines

Before merging, run `pnpm lint`, `pnpm test`, and `cargo test --workspace`. Frontend tests use Vitest, jsdom, and React Testing Library; colocate `*.test.ts`/`*.test.tsx`. Script tests use `scripts/*.test.mjs`. Run targeted frontend tests with `pnpm vitest run <path>`. Add regression coverage for behavior changes; no numeric coverage threshold is configured. Update TypeScript fixtures when IPC shapes change.

## Commit & Pull Request Guidelines

Use scoped Conventional Commits, such as `feat(grpc): ...` or `fix(tls): ...`. Squash feature work into cohesive commits before merging into `main`; keep release bumps separate. PRs should describe the behavior change, link relevant issues/specs, report validation, and include screenshots for visible UI changes.

## Rule table

| Rule | Check |
| --- | --- |
| A pull request runs `pnpm lint`, `pnpm test`, and `cargo test -p handshaker-core`. No commit in the pull request range contains `Co-authored-by`. The default Tauri capability grants `core:window:allow-start-dragging` and the window close permissions (`core:window:allow-close`, `core:window:allow-minimize`, `core:window:allow-toggle-maximize`, `core:window:allow-internal-toggle-maximize`). | `.github/workflows/ci.yml` runs those commands and `scripts/check-pr-trailers.mjs` on `base..head`. `src/features/shell/capabilities.test.ts` reads `src-tauri/capabilities/default.json`. |
| User-facing prose lives in `src/lib/messages.ts`. New prose literals outside that file are not allowed. A single kebab-case or snake_case token (such as `collection-filter`) is not prose. | `python3 scripts/check-prose-ratchet.py` fails when the prose hit count grows past `scripts/prose-ui.baseline`. |
| Parse token `expires_in` only in `ExpiresIn::from_token_json`. Callers see `ExpiresIn`, not a raw integer. Fractional, overflow, and negative values fail or clamp in that function. | `cargo test -p handshaker-core expires_in_from_token_json` — fractional body `1800.0` (`d5b88f0`) and overflowing `1e20` (`3932c5c`). `Number::as_u64` first fails the fractional test. |
| A resolve key is a `ResolveKey` built only by `resolveKey` in `src/features/workflow/resolveKey.ts`. Reflection, schema, auth, and highlight hooks take that type and have no default. | `python3 scripts/prototype/check_resolve_keys.py` |
| Echo-seeded editors (`SavedAuthEditor`, collection variable rows, collection link rows) keep their edit in `useEditBuffer` and reseed only when `seedKey` changes. A new server value with the same key does not replace the edit (`4b09613`). `SaveQueue` stays the environment editor. `DialogOverlay` and `Button` forward refs. Clearing a resolved `VarHighlightInput` keeps focus (`8b0a611`). The environment empty row keeps its id across keystrokes (`53bcda5`). | `pnpm vitest run src/features/edit/useEditBuffer.test.ts src/components/ui/forwardRef.test.tsx src/features/vars/VarHighlightInput.test.tsx src/features/envs/envEditor.test.ts` |
| The `{{var}}` pattern, scalar well-known names, and builtin names come from Rust. Do not hand-edit `src/features/vars/varGrammar.gen.ts`, `src/lib/wellKnown.gen.ts`, or `src/features/vars/builtins.gen.ts`. | `cargo test -p handshaker-core -- generated_var_tables_match_committed_files` fails on a hand-edit. `python3 scripts/check_var_tables.py` fails when Monaco misses a core `{{var}}` or the name sets diverge (`synthetic_wkt_drift_detected`). `pnpm lint` does not run `export-bindings`. |
| A single `keydown` listener lives in `src/features/shell/hotkeys.ts`. Other modules register chord rows. `capture` is a field on the row. The macOS word-wrap chord and the Cmd+E swallow are rows. | `src/features/shell/hotkeys.test.tsx` fails if `addEventListener("keydown"` appears under `src/` outside that file. |
| Bracket-pair colorization is `colorizedBracketPairs` on the `json-with-vars` language in `src/lib/monaco.ts`. The editor option `bracketPairColorization` is not used. `BodyView` toggles the minimap through `BodyEditor.setMinimap`. | `python3 scripts/check-bracket-colorization.py` fails if `bracketPairColorization` appears under `src` (the editor option from `a667f2a`) or if `colorizedBracketPairs` appears outside `src/lib/monaco.ts`. |

## Agent-Specific Instructions

When `.codegraph/` exists, use `codegraph explore "<symbol or question>"` or the CodeGraph MCP tool before text searches or source reads. Do not create an index automatically.
