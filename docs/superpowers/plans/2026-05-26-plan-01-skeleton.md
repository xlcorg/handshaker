# Plan #1 — Project Skeleton

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Greenfield-репозиторий доводим до состояния «компилится и открывает пустое окно с тёмной shadcn-палитрой» на Windows и macOS, с готовой проводкой tauri-specta (типизированный IPC) и одной smoke-командой `app_version()`. Никакой бизнес-логики — только каркас, на который ляжет реальная работа из планов #2-#8.

**Architecture:** Cargo workspace (`crates/handshaker-core` + `src-tauri`) + Vite/React/TS frontend на верхнем уровне. `handshaker-core` пока содержит только `CoreError`. `src-tauri` собирает Tauri 2 app, регистрирует `app_version` через `tauri-specta v2`, экспортит `src/ipc/bindings.ts` при `cargo run`. Frontend — пустая cold-start экранка на shadcn dark-теме (палитра из spec §8.8).

**Tech Stack (зафиксированные версии):**
- Rust stable, edition 2021
- `tauri` 2.11, `tauri-build` 2.0, `tauri-specta` =2.0.0-rc.21, `specta` =2.0.0-rc.22, `specta-typescript` =0.0.9
- `thiserror` 2, `serde` 1, `serde_json` 1
- Node + `pnpm`, Vite 6, React 18, TypeScript 5 strict
- Tailwind v4 (`@tailwindcss/vite`), shadcn/ui (new-york, dark-only)
- `@tauri-apps/api` 2, `lucide-react`, `clsx`, `tailwind-merge`

**Источники (memory rule `feedback_verify_technical_claims`):**
- [Tauri 2 capabilities](https://v2.tauri.app/security/capabilities/), [Tauri config](https://v2.tauri.app/develop/configuration-files/), [tauri crate](https://crates.io/crates/tauri)
- [tauri-specta GitHub](https://github.com/specta-rs/tauri-specta), [docs/v2](https://github.com/specta-rs/website/blob/main/content/docs/tauri-specta/v2.mdx)
- [shadcn/ui Vite install](https://ui.shadcn.com/docs/installation/vite), [Tailwind v4 in shadcn](https://ui.shadcn.com/docs/tailwind-v4)
- [tonic crate](https://crates.io/crates/tonic), [prost-reflect](https://crates.io/crates/prost-reflect) — будут пинены в Plan #2.

**Out of scope (next plans):**
- Никакой gRPC-логики, reflection, invoke, auth, collections, env, resolver — это планы #2-#6.
- Никаких shadcn-компонентов кроме `Button` (cold-start использует один) — остальные ставим по мере необходимости в feature-планах #7-#8.
- Никаких иконок приложения — используем placeholder’ы Tauri.

---

## Errata applied 2026-05-27

The following corrections were applied after Plan #1 execution surfaced issues. Future re-runs of this plan should use the corrected content below (inline). Original-vs-corrected summary:

1. **Task 5 `package.json` scripts** — `"lint": "tsc -b --noEmit"` was wrong (`tsc -b` doesn't accept `--noEmit`; `noEmit` is set per-tsconfig). Use `"lint": "tsc -b"`.
2. **Task 5 `tsconfig.node.json`** — needs `composite: true` + `declaration` + `emitDeclarationOnly` + non-noEmit `outDir`; the original snippet had `"noEmit": true` which is incompatible with project references.
3. **Task 5 `package.json` dependencies** — must include `"class-variance-authority": "^0.7.1"` (shadcn Button requires it).
4. **Task 5 Step 7.5** — must write `src/vite-env.d.ts` with `/// <reference types="vite/client" />` because `noUncheckedSideEffectImports` plus the CSS side-effect import in `main.tsx` needs Vite client type declarations.
5. **Task 7 Step 5** — should edit `src-tauri/src/lib.rs` (not `main.rs`); Tauri 2 standard split keeps `main.rs` as a thin wrapper around `pub fn run()` in `lib.rs`.
6. **Task 7 Step 6.5** — add a dedicated `[[bin]] export-bindings` because the `cfg(debug_assertions)` export inside `run()` only fires when the windowed app starts; on Windows the `#[cfg(test)]` export path crashes with `STATUS_ENTRYPOINT_NOT_FOUND`.
7. **Task 4 Step 5 icon URL** — `examples/api/src-tauri/icons/icon.png` 404s on `tauri-apps/tauri@dev`; use `crates/tauri-cli/templates/app/src-tauri/icons/icon.png` instead.
8. **Task 8 prerequisite** — if `src/ipc/bindings.ts` is missing, run `cargo run -p handshaker --bin export-bindings --quiet` before `pnpm tauri:dev`.

The inline Step content below has been edited to reflect these corrections.

---

## File map

Создаём:

```
handshaker/
├── Cargo.toml                                ← workspace
├── rust-toolchain.toml
├── .nvmrc
├── .editorconfig
├── package.json
├── pnpm-lock.yaml                            ← создаст pnpm
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── index.html
├── components.json                           ← shadcn config
├── crates/
│   └── handshaker-core/
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs
│           └── error.rs
├── src-tauri/
│   ├── Cargo.toml
│   ├── build.rs
│   ├── tauri.conf.json
│   ├── capabilities/
│   │   └── default.json
│   ├── icons/                                ← скопированы из Tauri template
│   │   ├── 32x32.png
│   │   ├── 128x128.png
│   │   ├── 128x128@2x.png
│   │   ├── icon.icns
│   │   ├── icon.ico
│   │   └── icon.png
│   └── src/
│       ├── main.rs
│       ├── state.rs
│       ├── ipc/
│       │   ├── mod.rs
│       │   └── error.rs                       ← IpcError + From<CoreError>
│       └── commands/
│           ├── mod.rs
│           └── meta.rs                        ← app_version()
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── styles/
    │   └── globals.css
    ├── ipc/
    │   ├── bindings.ts                        ← generated by tauri-specta
    │   └── client.ts                          ← typed wrapper
    └── lib/
        └── cn.ts
```

Меняем:
- `.gitignore` — добавляем `node_modules`, `dist`, `src-tauri/target`, `src-tauri/gen`, `src/ipc/bindings.ts`.

---

### Task 1: Repository hygiene — .gitignore + editorconfig + nvmrc

**Files:**
- Modify: `.gitignore`
- Create: `.editorconfig`
- Create: `.nvmrc`

- [ ] **Step 1: Append frontend/Tauri patterns to `.gitignore`**

После строки `target` в существующем `.gitignore` дописываем:

```gitignore
# Node / Vite
node_modules
dist
dist-ssr

# Tauri build output
src-tauri/target
src-tauri/gen

# Generated by tauri-specta
src/ipc/bindings.ts

# OS junk
.DS_Store
Thumbs.db
```

- [ ] **Step 2: Create `.editorconfig`**

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
trim_trailing_whitespace = true

[*.rs]
indent_size = 4

[*.md]
trim_trailing_whitespace = false
```

- [ ] **Step 3: Create `.nvmrc`**

Содержимое — одна строка:

```
20
```

- [ ] **Step 4: Sanity check**

Run: `git status`
Expected: `.editorconfig`, `.nvmrc` — new; `.gitignore` — modified.

- [ ] **Step 5: Commit**

```bash
git add .gitignore .editorconfig .nvmrc
git commit -m "chore: ignore node/tauri build artefacts and pin tooling"
```

---

### Task 2: Cargo workspace + `handshaker-core` empty crate

**Files:**
- Create: `Cargo.toml` (workspace root)
- Create: `rust-toolchain.toml`
- Create: `crates/handshaker-core/Cargo.toml`
- Create: `crates/handshaker-core/src/lib.rs`

- [ ] **Step 1: Write `rust-toolchain.toml`**

```toml
[toolchain]
channel = "stable"
components = ["rustfmt", "clippy"]
```

- [ ] **Step 2: Write workspace `Cargo.toml`**

```toml
[workspace]
members = ["crates/handshaker-core", "src-tauri"]
resolver = "2"

[workspace.package]
edition = "2021"
rust-version = "1.74"
license = "Apache-2.0 OR MIT"
authors = ["Handshaker Authors"]

[workspace.dependencies]
thiserror = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["rt-multi-thread", "macros", "sync", "time"] }
async-trait = "0.1"

# Pinned at workspace level for reuse in plans #2-#6.
tonic = "0.14"
tonic-reflection = "0.14"
prost = "0.13"
prost-types = "0.13"
prost-reflect = { version = "0.14", features = ["serde"] }

# Tauri runtime + bindings generator
tauri = { version = "2.11", features = [] }
tauri-build = { version = "2", features = [] }
tauri-specta = { version = "=2.0.0-rc.21", features = ["derive", "typescript"] }
specta = "=2.0.0-rc.22"
specta-typescript = "=0.0.9"

[profile.release]
opt-level = 3
lto = "thin"
codegen-units = 1
strip = true
```

- [ ] **Step 3: Write `crates/handshaker-core/Cargo.toml`**

```toml
[package]
name = "handshaker-core"
version = "0.1.0"
edition.workspace = true
rust-version.workspace = true
license.workspace = true
authors.workspace = true
description = "OS-independent core for Handshaker: gRPC reflection, dynamic invoke, auth, collections."

[lints.rust]
unsafe_code = "forbid"

[dependencies]
thiserror.workspace = true
serde.workspace = true
```

- [ ] **Step 4: Write `crates/handshaker-core/src/lib.rs`**

```rust
//! handshaker-core — OS-independent core.
//!
//! Modules grow plan-by-plan: error (plan 1), grpc/* (plans 2-3), env+resolver (plan 4),
//! auth (plan 5), collections (plan 6).

pub mod error;

pub use error::CoreError;
```

- [ ] **Step 5: Verify it compiles**

Run: `cargo build -p handshaker-core`
Expected: `Compiling handshaker-core v0.1.0` → `Finished` без warnings.

- [ ] **Step 6: Commit**

```bash
git add Cargo.toml rust-toolchain.toml crates/
git commit -m "chore: scaffold cargo workspace with handshaker-core crate"
```

---

### Task 3: `CoreError` enum + Display tests

**Files:**
- Create: `crates/handshaker-core/src/error.rs`

TDD: пишем тест, видим compile-fail, добавляем enum, повторяем test.

- [ ] **Step 1: Write the failing test first**

Создать `crates/handshaker-core/src/error.rs`:

```rust
//! Single error type for handshaker-core. Every public API returns `Result<_, CoreError>`.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("invalid target: {0}")]
    InvalidTarget(String),
    #[error("not connected")]
    NotConnected,
    #[error("reflection disabled on server: {hint}")]
    ReflectionDisabled { hint: String },
    #[error("reflection error: {0}")]
    Reflection(String),
    #[error("descriptor build failed: {0}")]
    DescriptorBuild(String),
    #[error("service not found: {service}")]
    ServiceNotFound { service: String },
    #[error("method not found: {service}/{method}")]
    MethodNotFound { service: String, method: String },
    #[error("encode request failed: {0}")]
    EncodeRequest(String),
    #[error("decode response failed: {0}")]
    DecodeResponse(String),
    #[error("unresolved variable: {name}")]
    UnresolvedVariable { name: String },
    #[error("variable cycle: chain {chain:?}")]
    VariableCycle { chain: Vec<String> },
    #[error("transport error: {0}")]
    Transport(String),
    #[error("auth error: {0}")]
    Auth(String),
    #[error("gRPC status {code}: {message}")]
    GrpcStatus { code: i32, message: String },
    #[error("not implemented (MVP): {0}")]
    NotImplemented(String),
}

#[cfg(test)]
mod tests {
    use super::CoreError;

    #[test]
    fn invalid_target_renders_with_payload() {
        let e = CoreError::InvalidTarget("api.prod:bad".into());
        assert_eq!(e.to_string(), "invalid target: api.prod:bad");
    }

    #[test]
    fn reflection_disabled_uses_named_field() {
        let e = CoreError::ReflectionDisabled {
            hint: "enable reflection on server".into(),
        };
        assert_eq!(
            e.to_string(),
            "reflection disabled on server: enable reflection on server"
        );
    }

    #[test]
    fn variable_cycle_renders_chain() {
        let e = CoreError::VariableCycle {
            chain: vec!["a".into(), "b".into(), "a".into()],
        };
        assert_eq!(e.to_string(), r#"variable cycle: chain ["a", "b", "a"]"#);
    }

    #[test]
    fn grpc_status_renders_code_and_message() {
        let e = CoreError::GrpcStatus {
            code: 16,
            message: "UNAUTHENTICATED".into(),
        };
        assert_eq!(e.to_string(), "gRPC status 16: UNAUTHENTICATED");
    }
}
```

- [ ] **Step 2: Run tests, expect pass**

Run: `cargo test -p handshaker-core`
Expected: `4 passed; 0 failed`.

(TDD note: enum + test написаны вместе, потому что разделять enum-variant-по-варианту для plain data — overkill. Все четыре теста защищают форматы строк, которые потом приходят во frontend через `IpcError`.)

- [ ] **Step 3: Run clippy**

Run: `cargo clippy -p handshaker-core --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 4: Commit**

```bash
git add crates/handshaker-core/src/error.rs
git commit -m "feat(core): add CoreError enum with Display assertions"
```

---

### Task 4: `src-tauri` crate scaffold

**Files:**
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/build.rs`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/capabilities/default.json`
- Create: `src-tauri/icons/*` (placeholder PNGs)
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/state.rs`

- [ ] **Step 1: Write `src-tauri/Cargo.toml`**

```toml
[package]
name = "handshaker"
version = "0.1.0"
edition.workspace = true
rust-version.workspace = true
license.workspace = true
authors.workspace = true
description = "Handshaker desktop app (Tauri shell)."

[lib]
name = "handshaker_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build.workspace = true

[dependencies]
handshaker-core = { path = "../crates/handshaker-core" }
tauri = { workspace = true, features = ["devtools"] }
tauri-specta = { workspace = true }
specta = { workspace = true }
specta-typescript = { workspace = true }
serde.workspace = true
serde_json.workspace = true
thiserror.workspace = true
tokio.workspace = true

[features]
default = ["custom-protocol"]
custom-protocol = ["tauri/custom-protocol"]
```

- [ ] **Step 2: Write `src-tauri/build.rs`**

```rust
fn main() {
    tauri_build::build();
}
```

- [ ] **Step 3: Write `src-tauri/tauri.conf.json`**

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Handshaker",
  "version": "0.1.0",
  "identifier": "dev.handshaker.app",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:1420",
    "beforeDevCommand": "pnpm dev",
    "beforeBuildCommand": "pnpm build"
  },
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "Handshaker",
        "width": 1280,
        "height": 800,
        "minWidth": 1024,
        "minHeight": 600,
        "resizable": true,
        "decorations": true,
        "fullscreen": false
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": false,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

`"bundle.active": false` — мы не строим инсталляторы в MVP (это пункт next-step в спеке §14). Запустить как `cargo tauri dev` и `cargo tauri build --no-bundle` всё равно можно.

- [ ] **Step 4: Write `src-tauri/capabilities/default.json`**

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capability for the main window — only core IPC.",
  "windows": ["main"],
  "permissions": ["core:default"]
}
```

Принцип least-privilege (ТЗ rule 9 + спека §13): пускаем только `core:default`, fs/shell/dialog **не** включаем. Если в плане #7 понадобится `core:event:default` — добавим там.

- [ ] **Step 5: Create placeholder icons**

Tauri требует иконки даже при `bundle.active=false` (build.rs валидирует). Сгенерируйте простой 1024×1024 PNG любым способом (например, `npx @tauri-apps/cli icon ./logo.png` если есть logo, иначе скачайте placeholder с https://tauri.app/img/tauri-logo.png):

Run:

```powershell
mkdir src-tauri/icons
# Скачать placeholder Tauri логотипа
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri-cli/templates/app/src-tauri/icons/icon.png" -OutFile "src-tauri/icons/icon.png"
# Сгенерировать форматы
pnpm dlx @tauri-apps/cli icon src-tauri/icons/icon.png
```

Expected: создаются `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.ico` в `src-tauri/icons/`.

Если `pnpm dlx` пока не работает (pnpm установим в Task 5) — отложите этот шаг до окончания Task 5 и вернитесь, либо вручную создайте пять одинаковых PNG-файлов из одного source-изображения. Главное — файлы должны существовать к моменту первого `cargo build` src-tauri.

- [ ] **Step 6: Write `src-tauri/src/state.rs`**

```rust
//! Tauri-side app state. Будет наполняться по мере появления модулей (plans #2-#6).

#[derive(Default)]
pub struct AppState {
    // plan #2: pub connection: Mutex<Option<GrpcConnection>>,
    // plan #5: pub env_store: Arc<dyn EnvironmentStore>,
    // plan #6: pub collection_store: Arc<dyn CollectionStore>,
}
```

- [ ] **Step 7: Write `src-tauri/src/main.rs`**

```rust
// Prevents additional console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod state;

use state::AppState;

fn main() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

(IPC-команды добавим в Task 6 через tauri-specta — сейчас просто пустой handler.)

- [ ] **Step 8: Verify Rust side compiles**

Run: `cargo build -p handshaker`
Expected: `Compiling tauri-build`, `Compiling tauri`, …, `Compiling handshaker v0.1.0` → `Finished`. Warnings про `AppState` — игнорируем (поля добавим в следующих планах; временно `#[allow(dead_code)]` не ставим).

Если build падает на «icons not found» — вернитесь к Step 5.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/
git commit -m "feat(tauri): scaffold src-tauri shell with least-privilege capability"
```

---

### Task 5: Frontend scaffold — package.json + Vite + React + TS

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml` (если будем юзать pnpm workspace; не обязательно)
- Create: `tsconfig.json`, `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/App.tsx`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "handshaker",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build --no-bundle",
    "lint": "tsc -b",
    "format": "prettier --write \"src/**/*.{ts,tsx,css,md}\""
  },
  "dependencies": {
    "@tauri-apps/api": "^2",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^0.460.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "tailwind-merge": "^2.5.4"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2",
    "@tailwindcss/vite": "^4.0.0",
    "@types/node": "^22",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4",
    "prettier": "^3.4.2",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.6.3",
    "vite": "^6.0.3"
  },
  "packageManager": "pnpm@9.0.0"
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 3: Write `tsconfig.node.json`**

Composite-enabled version (required for project references — `noEmit: true` is incompatible with `composite: true`):

```json
{
  "compilerOptions": {
    "composite": true,
    "declaration": true,
    "emitDeclarationOnly": true,
    "outDir": "./node_modules/.tmp/tsconfig.node",
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 4: Write `vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
```

- [ ] **Step 5: Write `index.html`**

```html
<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Handshaker</title>
  </head>
  <body class="bg-background text-foreground antialiased">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Класс `dark` стоит сразу на `<html>` — light theme в MVP нет (spec §8.8).

- [ ] **Step 6: Write `src/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/globals.css";
import App from "@/App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 7: Write minimal `src/App.tsx` (placeholder, обогатим в Task 8)**

```tsx
export default function App() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="text-muted-foreground">Handshaker — loading…</p>
    </main>
  );
}
```

- [ ] **Step 7.5: Write `src/vite-env.d.ts`**

```ts
/// <reference types="vite/client" />
```

Required because `noUncheckedSideEffectImports: true` in `tsconfig.json` plus the CSS side-effect import in `main.tsx` (`import "@/styles/globals.css";`) needs the Vite client type declarations to register the side-effect modules. Without this file, `pnpm lint` fails with "Side effect import of …".

- [ ] **Step 8: Install dependencies**

Run: `pnpm install`
Expected: lockfile generated, no peer-dep errors.

(Если `pnpm` не установлен глобально: `corepack enable && corepack prepare pnpm@9 --activate`.)

- [ ] **Step 9: Verify TS compiles**

Run: `pnpm lint`
Expected: exit code 0 (после Task 6 globals.css будет существовать — TS-import не зачекаем сейчас на отсутствие `@/styles/globals.css`, потому что Vite-импорт CSS не проверяется TS). Если ошибка — переходим к Task 6 и возвращаемся.

- [ ] **Step 10: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json tsconfig.node.json vite.config.ts index.html src/
git commit -m "feat(frontend): scaffold vite+react+ts shell"
```

---

### Task 6: Tailwind v4 + shadcn config + dark theme tokens

**Files:**
- Create: `src/styles/globals.css`
- Create: `src/lib/cn.ts`
- Create: `components.json`

- [ ] **Step 1: Write `src/styles/globals.css` — Tailwind v4 + shadcn dark tokens (spec §8.8)**

```css
@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-var-token: var(--var-token);
  --color-var-resolved: var(--var-resolved);
  --radius-md: var(--radius);
  --radius-lg: calc(var(--radius) + 2px);
  --radius-sm: calc(var(--radius) - 2px);
  --font-sans: ui-sans-serif, -apple-system, "Inter", system-ui, sans-serif;
  --font-mono: ui-monospace, "JetBrains Mono", monospace;
}

/* MVP — dark only. См. spec §8.8. */
.dark,
:root {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);
  --sidebar: oklch(0.205 0 0);
  --sidebar-foreground: oklch(0.985 0 0);
  --sidebar-border: oklch(1 0 0 / 10%);
  --var-token: oklch(0.78 0.16 80);
  --var-resolved: oklch(0.7 0.16 145);
  --radius: 0.625rem;
}

* {
  border-color: var(--border);
}

html,
body,
#root {
  height: 100%;
}

body {
  font-family: var(--font-sans);
}
```

- [ ] **Step 2: Write `src/lib/cn.ts`**

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 3: Write `components.json` (shadcn config)**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/styles/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/cn",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

- [ ] **Step 4: Install a single shadcn Button (smoke component for Task 8)**

Run: `pnpm dlx shadcn@latest add button`
Expected: создаётся `src/components/ui/button.tsx` без ошибок. shadcn CLI прочитает `components.json` и `globals.css`, увидит Tailwind v4 — сгенерирует Button под новые токены.

- [ ] **Step 5: Verify Vite сборка прошла**

Run: `pnpm build`
Expected: `dist/` создаётся, нет TS-ошибок. Если падает на `Cannot find module '@/lib/cn'` — проверьте `tsconfig.json` paths.

- [ ] **Step 6: Commit**

```bash
git add src/styles src/lib src/components components.json
git commit -m "feat(frontend): tailwind v4 + shadcn new-york dark palette"
```

---

### Task 7: tauri-specta wiring — first IPC command `app_version`

**Files:**
- Create: `src-tauri/src/ipc/mod.rs`
- Create: `src-tauri/src/ipc/error.rs`
- Create: `src-tauri/src/commands/mod.rs`
- Create: `src-tauri/src/commands/meta.rs`
- Modify: `src-tauri/src/main.rs`
- Create: `src/ipc/client.ts`

`src/ipc/bindings.ts` появится автогенерацией — в git не комитим (см. .gitignore из Task 1). Frontend импортит из неё.

- [ ] **Step 1: Write `src-tauri/src/ipc/error.rs` — frontend-facing error**

```rust
//! IPC-facing error. Tagged union с дискриминатором "type" — фронт делает type-narrow.

use handshaker_core::CoreError;
use serde::Serialize;
use specta::Type;

#[derive(Debug, Serialize, Type)]
#[serde(tag = "type")]
pub enum IpcError {
    InvalidTarget { message: String },
    NotConnected,
    ReflectionDisabled { hint: String },
    Reflection { message: String },
    DescriptorBuild { message: String },
    ServiceNotFound { service: String },
    MethodNotFound { service: String, method: String },
    EncodeRequest { message: String },
    DecodeResponse { message: String },
    UnresolvedVariable { name: String },
    VariableCycle { chain: Vec<String> },
    Transport { message: String },
    Auth { message: String },
    GrpcStatus { code: i32, message: String },
    NotImplemented { message: String },
}

impl From<CoreError> for IpcError {
    fn from(e: CoreError) -> Self {
        match e {
            CoreError::InvalidTarget(m) => IpcError::InvalidTarget { message: m },
            CoreError::NotConnected => IpcError::NotConnected,
            CoreError::ReflectionDisabled { hint } => IpcError::ReflectionDisabled { hint },
            CoreError::Reflection(m) => IpcError::Reflection { message: m },
            CoreError::DescriptorBuild(m) => IpcError::DescriptorBuild { message: m },
            CoreError::ServiceNotFound { service } => IpcError::ServiceNotFound { service },
            CoreError::MethodNotFound { service, method } => {
                IpcError::MethodNotFound { service, method }
            }
            CoreError::EncodeRequest(m) => IpcError::EncodeRequest { message: m },
            CoreError::DecodeResponse(m) => IpcError::DecodeResponse { message: m },
            CoreError::UnresolvedVariable { name } => IpcError::UnresolvedVariable { name },
            CoreError::VariableCycle { chain } => IpcError::VariableCycle { chain },
            CoreError::Transport(m) => IpcError::Transport { message: m },
            CoreError::Auth(m) => IpcError::Auth { message: m },
            CoreError::GrpcStatus { code, message } => IpcError::GrpcStatus { code, message },
            CoreError::NotImplemented(m) => IpcError::NotImplemented { message: m },
        }
    }
}
```

- [ ] **Step 2: Write `src-tauri/src/ipc/mod.rs`**

```rust
pub mod error;
pub use error::IpcError;
```

- [ ] **Step 3: Write `src-tauri/src/commands/meta.rs`**

```rust
use specta::Type;
use tauri_specta::Event;

/// Smoke-command: возвращает версию из Cargo.toml. Доказывает что tauri-specta wiring работает.
#[tauri::command]
#[specta::specta]
pub fn app_version() -> AppVersion {
    AppVersion {
        version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

#[derive(serde::Serialize, Type)]
pub struct AppVersion {
    pub version: String,
}

/// Placeholder event — реальные события (ContractUpdated, ConnectionStateChanged) добавим в plan #2.
#[derive(Clone, serde::Serialize, serde::Deserialize, Type, Event)]
pub struct AppReady {
    pub version: String,
}
```

- [ ] **Step 4: Write `src-tauri/src/commands/mod.rs`**

```rust
pub mod meta;
```

- [ ] **Step 5: Edit `src-tauri/src/lib.rs` to wire tauri-specta**

Tauri 2 standard split: `main.rs` stays a thin wrapper around `pub fn run()` in `lib.rs` so mobile entry points (`#[cfg_attr(mobile, tauri::mobile_entry_point)]`) can attach. Edit `src-tauri/src/lib.rs`:

```rust
pub mod commands;
pub mod ipc;
mod state;

use commands::meta::{app_version, AppReady};
use specta_typescript::Typescript;
use state::AppState;
use tauri_specta::{collect_commands, collect_events, Builder};

pub fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .commands(collect_commands![app_version])
        .events(collect_events![AppReady])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = specta_builder();

    // Регенерим TS bindings при каждом cargo run в debug-режиме (only fires once the
    // windowed app starts — for manual regeneration use the `export-bindings` bin from Step 6.5).
    #[cfg(debug_assertions)]
    builder
        .export(
            Typescript::default()
                .formatter(specta_typescript::formatter::prettier)
                .header("// AUTO-GENERATED by tauri-specta. Do NOT edit.\n"),
            "../src/ipc/bindings.ts",
        )
        .expect("failed to export tauri-specta bindings");

    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

`commands` and `ipc` are `pub mod` so the `export-bindings` bin (Step 6.5) can reach them. `specta_builder()` is factored out so the bin reuses the same command set.

- [ ] **Step 6: Build src-tauri**

Run: `cargo build -p handshaker`
Expected: `Compiling handshaker v0.1.0` → `Finished`. Note that the `cfg(debug_assertions)` export inside `run()` only fires when the windowed app actually starts — `cargo build` alone will NOT generate `src/ipc/bindings.ts`. Use the `export-bindings` bin (next step).

**Note:** Файл `src/ipc/bindings.ts` НЕ комитим (см. `.gitignore`).

- [ ] **Step 6.5: Add `[[bin]] export-bindings` workaround**

The `cfg(debug_assertions)` export inside `run()` only fires when the windowed app starts. On Windows, the alternative `#[cfg(test)]` export-via-test path crashes with `STATUS_ENTRYPOINT_NOT_FOUND`. The reliable regeneration path is a dedicated bin target.

In `src-tauri/Cargo.toml`, add:

```toml
[[bin]]
name = "export-bindings"
path = "src/bin/export_bindings.rs"
```

Also add to `[package]` (so `cargo run -p handshaker` still launches the windowed app by default):

```toml
default-run = "handshaker"
```

Create `src-tauri/src/bin/export_bindings.rs`:

```rust
//! Standalone binary for regenerating tauri-specta bindings. Run with:
//!   cargo run -p handshaker --bin export-bindings --quiet
//! The cfg(debug_assertions) export inside lib.rs::run() only fires once the windowed
//! app starts; this bin is the manual regeneration path during dev.

use specta_typescript::Typescript;

fn main() {
    let builder = handshaker_lib::specta_builder();
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..").join("src").join("ipc").join("bindings.ts");
    builder
        .export(
            Typescript::default()
                .formatter(specta_typescript::formatter::prettier)
                .header("// AUTO-GENERATED by tauri-specta. Do NOT edit.\n"),
            &path,
        )
        .expect("failed to export tauri-specta bindings");
    eprintln!("wrote {}", path.display());
}
```

Run: `cargo run -p handshaker --bin export-bindings --quiet`
Expected: `wrote …/src/ipc/bindings.ts` printed, file appears.

- [ ] **Step 7: Sanity-check сгенерированный `src/ipc/bindings.ts`**

Run: `Get-Content src/ipc/bindings.ts | Select-Object -First 30`
Expected: видим что-то вроде:

```ts
// AUTO-GENERATED by tauri-specta. Do NOT edit.
import { invoke as TAURI_INVOKE } from "@tauri-apps/api/core";
// ...
export const commands = {
  async appVersion(): Promise<AppVersion> { ... }
};
export type AppVersion = { version: string };
export type AppReady = { version: string };
```

Точная форма зависит от tauri-specta rc — главное, что есть `commands.appVersion`.

- [ ] **Step 8: Write `src/ipc/client.ts` — typed wrapper**

```ts
import { commands, type AppVersion } from "@/ipc/bindings";

export const ipc = {
  appVersion: (): Promise<AppVersion> => commands.appVersion(),
};

export type { AppVersion };
```

- [ ] **Step 9: Commit (без bindings.ts)**

```bash
git add src-tauri/src/ipc src-tauri/src/commands src-tauri/src/main.rs src/ipc/client.ts
git commit -m "feat(ipc): wire tauri-specta with app_version smoke command"
```

---

### Task 8: Cold-start UI smoke + manual run verification

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Rewrite `src/App.tsx` — cold-start placeholder из spec §8.7**

```tsx
import { useEffect, useState } from "react";
import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ipc, type AppVersion } from "@/ipc/client";

export default function App() {
  const [version, setVersion] = useState<AppVersion | null>(null);

  useEffect(() => {
    ipc.appVersion().then(setVersion).catch((e) => {
      console.error("app_version failed", e);
    });
  }, []);

  return (
    <main className="grid min-h-screen place-items-center bg-background text-foreground">
      <div className="flex flex-col items-center gap-4">
        <Zap className="size-12 text-muted-foreground" />
        <h1 className="text-2xl font-medium">Connect to a gRPC service</h1>
        <p className="text-sm text-muted-foreground">
          {version ? `Handshaker v${version.version}` : "Handshaker"}
        </p>
        <Button disabled size="lg">
          Connect to address
        </Button>
      </div>
    </main>
  );
}
```

(Кнопка disabled — функциональность Connect появится в plan #7. Здесь визуальная проверка темы.)

- [ ] **Step 2: Build frontend**

Run: `pnpm build`
Expected: `dist/` собирается без ошибок.

- [ ] **Step 3: Manual run — открыть app в dev-режиме**

**Prerequisite:** if `src/ipc/bindings.ts` does not yet exist (e.g. fresh clone, or it has been deleted), run the bindings regen bin first — otherwise the Vite import will fail:

```sh
cargo run -p handshaker --bin export-bindings --quiet
```

Run: `pnpm tauri:dev`
Expected:
- Vite стартует на `http://localhost:1420`.
- Tauri окно открывается, размер ~1280×800.
- Тёмный фон (`oklch(0.145 0 0)` — почти чёрный).
- По центру: иконка Zap, заголовок «Connect to a gRPC service», под ним «Handshaker v0.1.0» (приходит через IPC!), кнопка «Connect to address» (disabled).
- В DevTools (`Cmd/Ctrl + Shift + I`) — нет красных ошибок.

Если версия не отображается («Handshaker» без номера) — IPC падает; проверьте `pnpm tauri:dev` console output и `src/ipc/bindings.ts`.

- [ ] **Step 4: Manual run — release build (без bundle)**

Run: `pnpm tauri:build`
Expected: завершается успешно с сообщением «Built …/handshaker[.exe]» или подобным.

(Этот шаг — проверка что release-pipeline работает; запускать бинарь не обязательно.)

- [ ] **Step 5: Cross-platform sanity (если есть доступ к второй ОС)**

Powered-user шаг: если есть доступ к macOS — повторите Step 3 на mac. Должно открываться окно с тем же layout’ом. **Если доступа нет — отметьте шаг как «не проверено локально» и оставьте для CI plan’а в будущем.**

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat(ui): cold-start placeholder with app_version IPC smoke"
```

---

## Acceptance criteria (Plan #1)

- [ ] `cargo build --workspace` проходит без warnings.
- [ ] `cargo test -p handshaker-core` — 4 теста passed.
- [ ] `cargo clippy --workspace --all-targets -- -D warnings` — пусто.
- [ ] `pnpm install && pnpm build` — успешно собрано в `dist/`.
- [ ] `pnpm tauri:dev` открывает окно с cold-start UI на тёмной shadcn-палитре; версия `0.1.0` приходит через IPC.
- [ ] `src/ipc/bindings.ts` генерится автоматически из Rust и **не в git**.
- [ ] `src-tauri/capabilities/default.json` содержит только `core:default` (least-privilege).
- [ ] Все 8 тасков закоммичены отдельными коммитами с conventional-message-форматом.

---

## Self-review

Прошёлся по spec ↔ plan #1 mapping:

| Spec section | Покрытие в plan #1 |
|---|---|
| §2.1 Workspace | Tasks 2 + 4 + 5 (cargo workspace + src-tauri + frontend layout). ✓ |
| §2.2 Принципы (SRP/KISS/transport abstraction) | План не вводит абстракций без нужды (нет GrpcTransport trait — ждём plan #2). ✓ |
| §5.1 CoreError | Task 3 — полный enum + Display-тесты. ✓ |
| §6.4 IpcError | Task 7 — tagged union + From<CoreError>. ✓ |
| §7 Frontend stack | Tasks 5+6 — Vite, React 18, TS strict, Tailwind v4, shadcn new-york, dark-only. ✓ |
| §8.7 Empty states «Cold start» | Task 8 — иконка + заголовок + disabled Connect. ✓ |
| §8.8 Visual style (OKLCH) | Task 6 — точные значения из спеки. ✓ |
| §12 Toolchain | Tasks 1+2+5 — rustfmt+clippy, pnpm, TS strict, capabilities least-privilege. ✓ |
| §13 Безопасность | Task 4 — capability содержит только `core:default`; иконки/секреты не светятся. ✓ |

Placeholder scan: нет TBD, TODO, «implement later» в плане. ✓

Type-consistency: `AppVersion`, `AppReady`, `CoreError`, `IpcError` — имена согласованы между tasks 3 и 7. `app_version()` → camelCase `appVersion` в TS (стандарт tauri-specta). ✓

Scope: план самодостаточен — выдаёт работающее окно и тестируемое ядро (Display-тесты CoreError). Следующий план #2 строит поверх этого reflection. ✓

---

## После завершения Plan #1

Следующий план (`#2 — Reflection spine`) добавит в `crates/handshaker-core/`:
- `grpc/connection.rs` — `GrpcTarget`, `GrpcConnection`
- `grpc/transport/` — `GrpcTransport` trait + `TonicTransport` + `skip_verify` rustls verifier
- `grpc/reflection/` — bidi streaming client + v1→v1alpha fallback
- `grpc/descriptor/` — сборка `DescriptorPool`
- `grpc/catalog/` — `services → methods → MessageSchema`
- `grpc/contract.rs` + `grpc/contract_cache/`
- IPC: `grpc_connect`, `grpc_disconnect`, `grpc_refresh_contract`
- Events: `ContractUpdated`, `ConnectionStateChanged`

Frontend остаётся cold-start’ом до plan’а #7-#8.
