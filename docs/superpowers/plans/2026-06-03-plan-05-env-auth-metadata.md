# Env / Auth / Metadata (Plan #5) — OUTLINE

> ⚠️ **Outline only — NOT execution-ready.** Detail via `superpowers:writing-plans` when reached. Depends on Plans #1–#3.

**Goal:** Environment-on-workflow with `{{var}}` resolution, service-level auth and default metadata, request cancel + configurable timeout, and parallel sends.

**Spec refs:** §6 (env on workflow), §10 (env no per-step override; `{{var}}` in address/body/metadata; auth only on service; default metadata on service; Cancel+timeout; network diagnostics; parallel Send). Backend env/vars/auth modules already exist (`crates/handshaker-core/src/{env,vars,auth}`, IPC `env_*`, `vars_resolve`, `auth_set_for_env`).

## Outline tasks
- [ ] Env pill + switcher in titlebar bound to workflow; reuse existing `env_*` IPC.
- [ ] `{{var}}` resolution before Send (address + body + metadata) via existing `vars_resolve` (or core resolve); unresolved-variable error surfaced.
- [ ] Service-level auth config (None/EnvVar/OAuth2) reusing existing `auth` module + `auth_set_for_env`; applied to all steps of that service.
- [ ] Service-level default metadata inherited into new steps (editable per step).
- [ ] Cancel button + configurable timeout in settings; wire cancellation through invoke (new IPC if needed — currently `grpc_invoke_oneshot` is fire-and-wait).
- [ ] Explicit network/TLS diagnostics in error rendering (refused / TLS / DNS / timeout).
- [ ] Parallel Send (each step independent; per-step `sending` already isolated in store).

## 🧹 /clear-checkpoint at completion — redesign feature-complete.
