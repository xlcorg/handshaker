# Dynamic built-in variables (`{{$guid}}` etc.) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** 🎉 DONE 2026-06-30 · rebase+ff в `main` `0ba7bfa` · спека `docs/superpowers/specs/archive/2026-06-29-dynamic-builtin-vars-design.md`

Реализована subagent-driven (6 задач TDD, spec+quality ревью на каждой + финальное ревью =
READY TO MERGE). 6 билтинов `$guid/$guid7/$timestamp/$unixMs/$isoTimestamp/$randomInt`, генерация
один раз в `grpc_invoke_oneshot` через инъектируемый `BuiltinGenerator`; ядро лишь распознаёт их
(`dynamic_vars`), пользовательская переменная того же имени побеждает. Только фича `v4` у `uuid`;
ISO-8601 вручную (Хиннант), `$randomInt` из байтов v4-UUID — без новых крейтов. Два UI-фоллоуапа по
живому фидбеку (`653ce89`+`a667f2a`+`0ba7bfa`): подсветка `{{$var}}` фиолетовым и в редакторе тела
(Monarch-токен `variable.dynamic`) + отключение rainbow bracket-pair colorization на уровне языка
(`colorizedBracketPairs:[]`). Ребейз на `da56d0b` чист (единственный пересекающийся `messages.ts`
смержился автоматически — разные namespace). Гейт: cargo (core 219 · src-tauri 73 · doctest) ·
vitest 1170 · pnpm build (tsc+vite) · bindings no-drift. Остаток — live WebView2-проход.

**Goal:** Шаблоны `{{var}}` получают 6 встроенных подстановок (`$guid`, `$guid7`, `$timestamp`, `$unixMs`, `$isoTimestamp`, `$randomInt`), которые при отправке заменяются сгенерированным значением; в превью они подсвечиваются как «динамические» и предлагаются автокомплитом.

**Architecture:** Распознавание в ядре + генерация в команде инвока (Подход 1). `vars_resolve` (превью + юзер-вары Send) остаётся чистым: он *узнаёт* билтины (новое поле отчёта `dynamic_vars`), не подставляет и не флагует их. Генерация — один раз, в `grpc_invoke_oneshot`, над телом и значениями метаданных, реальным генератором. Per-occurrence свежесть; пользовательская переменная того же имени побеждает (классифицируем только то, что осталось неподставленным).

**Tech Stack:** Rust (`handshaker-core`, `src-tauri`) · `uuid` (v4+v7) · React/TS (`src`) · Monaco · vitest · tauri-specta bindings.

**Зависимости:** единственное изменение — включить фичу `v4` у `uuid`. ISO-8601 считается вручную (алгоритм Хиннанта, без новых крейтов); `$randomInt` берётся из байтов v4-UUID. `time`/`rand`/`chrono` НЕ добавляются (упрощение против спеки §«Зависимости», которая делегировала решение плану).

**Предусловие сборки:** Rust-компиляция `src-tauri` (и бинаря `export-bindings`) требует существующего `dist/` (`generate_context!`). В свежем worktree сначала `pnpm install` и `pnpm build`. См. `project_worktree_needs_dist_build`.

---

## File Structure

**Создаются:**
- `crates/handshaker-core/src/vars/builtins.rs` — набор билтинов (`is_builtin`), трейт `BuiltinGenerator`, прод-генератор `SystemBuiltins`, чистая `expand_builtins`. Единственный источник истины генерации.
- `src/features/vars/builtins.ts` — фронт-зеркало набора: `BUILTIN_NAMES`, `isBuiltinName`, `BUILTIN_CANDIDATES` (кандидаты автокомплита). Синхронизируется с ядровым `is_builtin`.
- `src/features/vars/builtins.test.ts` — тесты фронт-зеркала.

**Модифицируются:**
- `Cargo.toml:43` — фича `v4` у `uuid`.
- `crates/handshaker-core/src/vars/mod.rs` — `pub mod builtins;`; `ResolutionReport.dynamic_vars`; split остатка на unresolved/dynamic; `resolve_string` не падает на билтине.
- `src-tauri/src/ipc/vars.rs` — `ResolutionReportIpc.dynamic_vars` + маппинг.
- `src-tauri/src/commands/grpc.rs` — `expand_builtins` над `request_json`+`metadata` в `grpc_invoke_oneshot`.
- `src/ipc/bindings.ts` — регенерация (трекается в git).
- `src/features/vars/candidates.ts` — `VarOrigin` += `"builtin"`; `buildVarCandidates` дописывает билтины.
- `src/features/vars/candidates.test.ts` — обновить под билтины.
- `src/features/vars/useVarResolve.ts` — `VarTokenState` += `"dynamic"`; `useTokenResolveStates` классифицирует по `dynamic_vars`.
- `src/features/vars/VarHighlightInput.tsx` — рендер `"dynamic"` → класс `vh-dynamic`.
- `src/features/vars/VarSuggestDropdown.tsx` — стиль тега для origin `"builtin"`.
- `src/styles/globals.css` — класс `.vh-dynamic`.
- `src/lib/messages.ts` — `vars.builtin` (тег + описания).

---

## Task 1: Core — модуль `builtins` (распознавание + генерация)

**Files:**
- Modify: `Cargo.toml:43`
- Create: `crates/handshaker-core/src/vars/builtins.rs`
- Modify: `crates/handshaker-core/src/vars/mod.rs` (добавить `pub mod builtins;` + при необходимости `pub(super)` для `VAR_RE`)

- [ ] **Step 1: Включить фичу `v4` у `uuid`**

В `Cargo.toml` заменить строку 43:

```toml
uuid = { version = "1", features = ["v4", "v7", "serde"] }
```

- [ ] **Step 2: Сделать `VAR_RE` доступным подмодулю**

В `crates/handshaker-core/src/vars/mod.rs` дочерний модуль `builtins` видит приватные элементы родителя, поэтому менять видимость `VAR_RE` НЕ обязательно. Просто добавить объявление подмодуля сразу под `use`-блоком (после строки `use crate::error::CoreError;`):

```rust
pub mod builtins;
```

- [ ] **Step 3: Написать падающий тест — создать `builtins.rs` с тестами**

Создать `crates/handshaker-core/src/vars/builtins.rs`:

```rust
//! Built-in (dynamic) variables: `{{$guid}}`, `{{$timestamp}}`, … — names that are
//! GENERATED at send time rather than looked up. Recognition (`is_builtin`) is shared
//! with the resolver (it reports builtins separately from unresolved vars); GENERATION
//! is injected via [`BuiltinGenerator`] so the core stays deterministic in tests.
//!
//! Per-occurrence semantics: [`expand_builtins`] generates a fresh value for EACH
//! `{{$name}}` occurrence (two `{{$guid}}` → two different GUIDs). Mirror of the
//! frontend set in `src/features/vars/builtins.ts` — keep in sync.

use uuid::Uuid;

use super::VAR_RE;

/// True for a recognized built-in name (always `$`-prefixed). The `$` prefix makes
/// collision with user variables practically impossible; an unknown `$foo` is NOT a
/// builtin and stays a normal (unresolved) variable.
pub fn is_builtin(name: &str) -> bool {
    matches!(
        name,
        "$guid" | "$guid7" | "$timestamp" | "$unixMs" | "$isoTimestamp" | "$randomInt"
    )
}

/// Generates a value for a built-in name, or `None` if the name is not a builtin
/// (caller leaves the `{{…}}` literal untouched). Injected so production uses real
/// clock/uuid/rng while tests use a deterministic fake.
pub trait BuiltinGenerator {
    fn generate(&self, name: &str) -> Option<String>;
}

/// Production generator: real UUIDs, system clock, UUID-derived randomness.
pub struct SystemBuiltins;

impl BuiltinGenerator for SystemBuiltins {
    fn generate(&self, name: &str) -> Option<String> {
        Some(match name {
            "$guid" => Uuid::new_v4().to_string(),
            "$guid7" => Uuid::now_v7().to_string(),
            "$timestamp" => unix_secs().to_string(),
            "$unixMs" => unix_millis().to_string(),
            "$isoTimestamp" => iso8601_utc(unix_secs()),
            "$randomInt" => random_int_0_1000().to_string(),
            _ => return None,
        })
    }
}

fn unix_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn unix_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// Integer in `0..=1000` (Postman parity) from the 122 random bits of a v4 UUID.
/// Modulo bias over 1001 is ~2^-112 — negligible for generated test data; avoids a
/// dedicated RNG crate.
fn random_int_0_1000() -> u32 {
    let n = u128::from_le_bytes(Uuid::new_v4().into_bytes());
    (n % 1001) as u32
}

/// `YYYY-MM-DDThh:mm:ssZ` (UTC, second precision) from Unix seconds.
fn iso8601_utc(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (hh, mm, ss) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}Z")
}

/// Days since 1970-01-01 → (year, month, day). Howard Hinnant's `civil_from_days`
/// (http://howardhinnant.github.io/date_algorithms.html), valid for the full range.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = (if z >= 0 { z } else { z - 146_096 }) / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Replace EACH `{{$name}}` occurrence with a freshly generated value (per-occurrence).
/// Non-builtin `{{…}}` (and any text) is copied verbatim. Pure given `gen`.
pub fn expand_builtins(s: &str, gen: &impl BuiltinGenerator) -> String {
    let mut out = String::with_capacity(s.len());
    let mut last = 0;
    for caps in VAR_RE.captures_iter(s) {
        let whole = caps.get(0).unwrap();
        let name = caps.get(1).unwrap().as_str();
        out.push_str(&s[last..whole.start()]);
        match gen.generate(name) {
            Some(v) => out.push_str(&v),
            None => out.push_str(whole.as_str()),
        }
        last = whole.end();
    }
    out.push_str(&s[last..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    /// Deterministic fake: returns `"<name>#<seq>"`, proving per-occurrence freshness
    /// (each call advances the counter) without real generation.
    struct SeqBuiltins {
        n: Cell<u32>,
    }
    impl BuiltinGenerator for SeqBuiltins {
        fn generate(&self, name: &str) -> Option<String> {
            if !is_builtin(name) {
                return None;
            }
            let i = self.n.get();
            self.n.set(i + 1);
            Some(format!("{name}#{i}"))
        }
    }

    #[test]
    fn is_builtin_known_and_unknown() {
        assert!(is_builtin("$guid"));
        assert!(is_builtin("$guid7"));
        assert!(is_builtin("$isoTimestamp"));
        assert!(!is_builtin("$foo")); // $-prefixed but not a known builtin
        assert!(!is_builtin("guid")); // no $-prefix → user var
        assert!(!is_builtin("host"));
    }

    #[test]
    fn expand_is_per_occurrence() {
        let gen = SeqBuiltins { n: Cell::new(0) };
        let out = expand_builtins("{{$guid}}-{{$guid}}", &gen);
        assert_eq!(out, "$guid#0-$guid#1"); // two occurrences → two distinct values
    }

    #[test]
    fn expand_leaves_non_builtin_untouched() {
        let gen = SeqBuiltins { n: Cell::new(0) };
        let out = expand_builtins("{{host}} {{$guid}} {{x.y}}", &gen);
        assert_eq!(out, "{{host}} $guid#0 {{x.y}}");
    }

    #[test]
    fn system_guid_is_valid_v4_and_v7() {
        let g4 = SystemBuiltins.generate("$guid").unwrap();
        let u4 = Uuid::parse_str(&g4).unwrap();
        assert_eq!(u4.get_version_num(), 4);
        let g7 = SystemBuiltins.generate("$guid7").unwrap();
        let u7 = Uuid::parse_str(&g7).unwrap();
        assert_eq!(u7.get_version_num(), 7);
        assert_ne!(g4, SystemBuiltins.generate("$guid").unwrap()); // fresh each call
    }

    #[test]
    fn system_timestamps_and_randomint() {
        let secs: u64 = SystemBuiltins.generate("$timestamp").unwrap().parse().unwrap();
        let ms: u128 = SystemBuiltins.generate("$unixMs").unwrap().parse().unwrap();
        assert!(secs > 1_700_000_000); // sanity: after 2023
        assert!(ms >= secs as u128 * 1000); // ms is finer-grained
        let n: u32 = SystemBuiltins.generate("$randomInt").unwrap().parse().unwrap();
        assert!(n <= 1000);
        assert!(SystemBuiltins.generate("$nope").is_none());
    }

    #[test]
    fn iso_known_vectors() {
        assert_eq!(iso8601_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso8601_utc(86_400), "1970-01-02T00:00:00Z");
        assert_eq!(iso8601_utc(1_609_459_200), "2021-01-01T00:00:00Z");
        assert_eq!(iso8601_utc(1_609_459_200 + 3661), "2021-01-01T01:01:01Z");
    }
}
```

- [ ] **Step 4: Запустить тесты — убедиться, что компилируется и проходит**

Run: `cargo test -p handshaker-core vars::builtins`
Expected: PASS (все тесты модуля `builtins`).

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml Cargo.lock crates/handshaker-core/src/vars/builtins.rs crates/handshaker-core/src/vars/mod.rs
git commit -m "feat(core): builtin dynamic-var generators ($guid, timestamps, randomInt)"
```

---

## Task 2: Core — распознавание билтинов в резолве (`dynamic_vars`)

**Files:**
- Modify: `crates/handshaker-core/src/vars/mod.rs`

- [ ] **Step 1: Написать падающие тесты**

Добавить в `#[cfg(test)] mod tests` в `crates/handshaker-core/src/vars/mod.rs`:

```rust
    #[test]
    fn builtin_is_recognized_not_unresolved() {
        let env = map(&[]);
        let coll = map(&[]);
        let r = resolve_template_with_diagnostics("{{$guid}}", &vs(&env, &coll));
        assert_eq!(r.resolved, "{{$guid}}"); // left literal — expanded later, on send
        assert!(r.unresolved_vars.is_empty());
        assert_eq!(r.dynamic_vars, vec!["$guid".to_string()]);
        assert!(r.cycle_chain.is_none());
    }

    #[test]
    fn unknown_dollar_name_is_unresolved_not_dynamic() {
        let env = map(&[]);
        let coll = map(&[]);
        let r = resolve_template_with_diagnostics("{{$nope}}", &vs(&env, &coll));
        assert_eq!(r.unresolved_vars, vec!["$nope".to_string()]);
        assert!(r.dynamic_vars.is_empty());
    }

    #[test]
    fn mixed_user_and_builtin() {
        let env = map(&[("host", "api.dev")]);
        let coll = map(&[]);
        let r = resolve_template_with_diagnostics(
            "{{host}}/{{$guid}}/{{missing}}",
            &vs(&env, &coll),
        );
        assert_eq!(r.resolved, "api.dev/{{$guid}}/{{missing}}");
        assert_eq!(r.unresolved_vars, vec!["missing".to_string()]);
        assert_eq!(r.dynamic_vars, vec!["$guid".to_string()]);
    }

    #[test]
    fn user_var_named_dollar_guid_wins_over_builtin() {
        // A defined `$guid` is substituted in the pass loop, so it never reaches
        // builtin classification — user wins, dynamic_vars empty.
        let env = map(&[("$guid", "USERVALUE")]);
        let coll = map(&[]);
        let r = resolve_template_with_diagnostics("{{$guid}}", &vs(&env, &coll));
        assert_eq!(r.resolved, "USERVALUE");
        assert!(r.dynamic_vars.is_empty());
        assert!(r.unresolved_vars.is_empty());
    }

    #[test]
    fn builtin_dedup_first_appearance() {
        let env = map(&[]);
        let coll = map(&[]);
        let r = resolve_template_with_diagnostics(
            "{{$guid}} {{$timestamp}} {{$guid}}",
            &vs(&env, &coll),
        );
        assert_eq!(r.dynamic_vars, vec!["$guid".to_string(), "$timestamp".to_string()]);
    }

    #[test]
    fn resolve_string_does_not_error_on_builtin() {
        let env = map(&[]);
        let coll = map(&[]);
        let s = resolve_string("id={{$guid}}", &vs(&env, &coll)).unwrap();
        assert_eq!(s, "id={{$guid}}"); // left literal for send-time expansion
    }
```

- [ ] **Step 2: Запустить — убедиться, что падает компиляцией/ассертами**

Run: `cargo test -p handshaker-core vars::tests::builtin_is_recognized_not_unresolved`
Expected: FAIL — поле `dynamic_vars` ещё не существует (ошибка компиляции).

- [ ] **Step 3: Добавить поле и split-классификацию**

В `crates/handshaker-core/src/vars/mod.rs`:

3a. В структуру `ResolutionReport` (после поля `cycle_chain`) добавить:

```rust
    /// Recognized built-in tokens (`$`-prefixed, known set), first-appearance order,
    /// deduped. NOT substituted — left literal `{{$name}}` for send-time expansion.
    pub dynamic_vars: Vec<String>,
```

3b. Заменить функцию `collect_unresolved` на split-вариант:

```rust
/// Split remaining `{{name}}` matches into (non-builtin unresolved, builtin dynamic),
/// each deduplicated in first-appearance order.
fn collect_remaining(s: &str) -> (Vec<String>, Vec<String>) {
    let mut unresolved: Vec<String> = Vec::new();
    let mut dynamic: Vec<String> = Vec::new();
    for caps in VAR_RE.captures_iter(s) {
        let name = caps.get(1).unwrap().as_str();
        if builtins::is_builtin(name) {
            if !dynamic.iter().any(|n| n == name) {
                dynamic.push(name.to_string());
            }
        } else if !unresolved.iter().any(|n| n == name) {
            unresolved.push(name.to_string());
        }
    }
    (unresolved, dynamic)
}
```

3c. В `resolve_template_with_diagnostics` заменить блок, начинающийся со `let unresolved_vars = collect_unresolved(&current);` … до `ResolutionReport { … }`, на:

```rust
    let (unresolved_vars, dynamic_vars) = collect_remaining(&current);

    let cycle_chain = if !converged && !unresolved_vars.is_empty() {
        detect_cycle(&unresolved_vars, vars)
    } else {
        None
    };

    let final_unresolved = if cycle_chain.is_some() {
        Vec::new()
    } else {
        unresolved_vars
    };

    ResolutionReport {
        resolved: current,
        unresolved_vars: final_unresolved,
        cycle_chain,
        dynamic_vars,
    }
```

(`resolve_string` не меняется: оно читает `cycle_chain`/`unresolved_vars`; билтины теперь не попадают в `unresolved_vars`, поэтому ошибки не будет автоматически.)

- [ ] **Step 4: Запустить весь модуль vars**

Run: `cargo test -p handshaker-core vars::`
Expected: PASS (новые + все прежние тесты vars — прежние не сравнивают структуру целиком, только поля, поэтому новое поле их не ломает).

- [ ] **Step 5: Commit**

```bash
git add crates/handshaker-core/src/vars/mod.rs
git commit -m "feat(core): resolver reports builtins as dynamic_vars (not unresolved)"
```

---

## Task 3: IPC — `ResolutionReportIpc.dynamic_vars` + регенерация bindings

**Files:**
- Modify: `src-tauri/src/ipc/vars.rs`
- Modify: `src/ipc/bindings.ts` (через регенератор)

- [ ] **Step 1: Написать падающий тест маппинга**

Добавить в конец `src-tauri/src/ipc/vars.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ipc_report_carries_dynamic_vars() {
        let core = ResolutionReport {
            resolved: "id={{$guid}}".into(),
            unresolved_vars: vec![],
            cycle_chain: None,
            dynamic_vars: vec!["$guid".into()],
        };
        let ipc: ResolutionReportIpc = core.into();
        assert_eq!(ipc.dynamic_vars, vec!["$guid".to_string()]);
        assert_eq!(ipc.resolved, "id={{$guid}}");
    }
}
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `cargo test -p handshaker ipc::vars`
Expected: FAIL — `ResolutionReportIpc` не имеет поля `dynamic_vars` (ошибка компиляции).

- [ ] **Step 3: Добавить поле + маппинг**

В `src-tauri/src/ipc/vars.rs`:

3a. В `struct ResolutionReportIpc` (после `cycle_chain`):

```rust
    pub dynamic_vars: Vec<String>,
```

3b. В `impl From<ResolutionReport> for ResolutionReportIpc` (в инициализатор `Self { … }` после `cycle_chain: r.cycle_chain,`):

```rust
            dynamic_vars: r.dynamic_vars,
```

- [ ] **Step 4: Запустить тест**

Run: `cargo test -p handshaker ipc::vars`
Expected: PASS.

- [ ] **Step 5: Регенерировать TS-биндинги**

Предусловие: `dist/` существует (иначе `pnpm build` один раз).

Run: `cargo run -p handshaker --bin export-bindings --features export-bindings`
Expected: вывод `wrote …/src/ipc/bindings.ts`; в `src/ipc/bindings.ts` тип `ResolutionReportIpc` теперь содержит `dynamic_vars: string[]`.

Проверка дрейфа:

Run: `git diff --stat src/ipc/bindings.ts`
Expected: единственное изменение — добавленное поле `dynamic_vars` в `ResolutionReportIpc`.

- [ ] **Step 6: Commit (rust + bindings вместе)**

```bash
git add src-tauri/src/ipc/vars.rs src/ipc/bindings.ts
git commit -m "feat(ipc): expose dynamic_vars on ResolutionReportIpc + regen bindings"
```

---

## Task 4: IPC — генерация билтинов в `grpc_invoke_oneshot`

**Files:**
- Modify: `src-tauri/src/commands/grpc.rs`

- [ ] **Step 1: Написать падающий тест helper'а**

Добавить в `#[cfg(test)] mod tests` в `src-tauri/src/commands/grpc.rs`:

```rust
    use std::collections::HashMap;
    use handshaker_core::vars::builtins::BuiltinGenerator;
    use crate::ipc::invoke::InvokeRequest;

    struct FakeGen;
    impl BuiltinGenerator for FakeGen {
        fn generate(&self, name: &str) -> Option<String> {
            match name {
                "$guid" => Some("GUID".into()),
                _ => None,
            }
        }
    }

    #[test]
    fn expands_builtins_in_body_and_metadata() {
        let mut req = InvokeRequest {
            service: "s".into(),
            method: "m".into(),
            request_json: r#"{"id":"{{$guid}}","k":"{{kept}}"}"#.into(),
            metadata: HashMap::from([("x-id".into(), "{{$guid}}".into())]),
        };
        expand_request_builtins(&mut req, &FakeGen);
        assert_eq!(req.request_json, r#"{"id":"GUID","k":"{{kept}}"}"#);
        assert_eq!(req.metadata.get("x-id").unwrap(), "GUID");
    }
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `cargo test -p handshaker commands::grpc::tests::expands_builtins_in_body_and_metadata`
Expected: FAIL — `expand_request_builtins` не определена.

- [ ] **Step 3: Добавить helper и вызвать его в команде**

В `src-tauri/src/commands/grpc.rs`:

3a. Рядом с `grpc_invoke_oneshot` (над функцией) добавить generic-helper:

```rust
/// Expand built-in dynamic variables (`{{$guid}}`, …) in the request body and each
/// metadata VALUE, in place. Per-occurrence: each `{{$name}}` gets a fresh value.
/// Metadata keys are left untouched. Generic over the generator for testability.
fn expand_request_builtins(
    request: &mut InvokeRequest,
    gen: &impl handshaker_core::vars::builtins::BuiltinGenerator,
) {
    use handshaker_core::vars::builtins::expand_builtins;
    request.request_json = expand_builtins(&request.request_json, gen);
    for v in request.metadata.values_mut() {
        *v = expand_builtins(v, gen);
    }
}
```

3b. Убедиться, что `InvokeRequest` импортирован в файле (вверху среди `use crate::ipc::…`). Если нет — добавить:

```rust
use crate::ipc::invoke::InvokeRequest;
```

3c. В теле `grpc_invoke_oneshot` сделать `request` мутабельным и раскрыть билтины перед `invoke_unary`. Заменить начало `let work = async move {` … и вызов так, чтобы внутри блока было:

```rust
    let work = async move {
        let mut request = request;
        expand_request_builtins(&mut request, &handshaker_core::vars::builtins::SystemBuiltins);
        let transport = Arc::new(TonicTransport::new());
        let conn = activate(target, transport, cache.as_ref()).await?;
        let outcome = invoke_unary(
            &conn,
            &request.service,
            &request.method,
            &request.request_json,
            request.metadata,
            max_bytes,
        )
        .await?;
        Ok::<InvokeOutcomeIpc, IpcError>(outcome.into())
    };
```

- [ ] **Step 4: Запустить тест + сборку команды**

Run: `cargo test -p handshaker commands::grpc`
Expected: PASS (новый тест + прежние target_key-тесты).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/grpc.rs
git commit -m "feat(ipc): expand builtin vars in invoke request body + metadata"
```

---

## Task 5: Frontend — билтин-кандидаты автокомплита

**Files:**
- Create: `src/features/vars/builtins.ts`
- Create: `src/features/vars/builtins.test.ts`
- Modify: `src/lib/messages.ts`
- Modify: `src/features/vars/candidates.ts`
- Modify: `src/features/vars/candidates.test.ts`
- Modify: `src/features/vars/VarSuggestDropdown.tsx`

- [ ] **Step 1: Добавить копирайтинг в `messages.ts`**

В `src/lib/messages.ts` заменить блок `vars: { suggest: { … } }` на:

```ts
  vars: {
    suggest: {
      moreResults: (count: number) => `…${count} more — keep typing`,
    },
    builtin: {
      /** Tag shown on a builtin candidate (origin is "builtin" in data). */
      tag: "dynamic",
      /** name → one-line description (shown as the candidate preview). */
      desc: {
        $guid: "v4 GUID · generated on send",
        $guid7: "v7 GUID (time-ordered) · generated on send",
        $timestamp: "Unix time, seconds · generated on send",
        $unixMs: "Unix time, milliseconds · generated on send",
        $isoTimestamp: "ISO-8601 UTC · generated on send",
        $randomInt: "Random integer 0–1000 · generated on send",
      } as Record<string, string>,
    },
  },
```

- [ ] **Step 2: Написать падающий тест фронт-зеркала**

Создать `src/features/vars/builtins.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BUILTIN_NAMES, isBuiltinName, BUILTIN_CANDIDATES } from "./builtins";

describe("builtins", () => {
  it("recognizes known $-names only", () => {
    expect(isBuiltinName("$guid")).toBe(true);
    expect(isBuiltinName("$isoTimestamp")).toBe(true);
    expect(isBuiltinName("$foo")).toBe(false);
    expect(isBuiltinName("guid")).toBe(false);
  });

  it("exposes one candidate per builtin, origin builtin, description as value", () => {
    expect(BUILTIN_CANDIDATES).toHaveLength(BUILTIN_NAMES.length);
    const guid = BUILTIN_CANDIDATES.find((c) => c.name === "$guid")!;
    expect(guid.origin).toBe("builtin");
    expect(guid.value).toMatch(/GUID/);
  });
});
```

- [ ] **Step 3: Запустить — убедиться, что падает**

Run: `pnpm vitest run src/features/vars/builtins.test.ts`
Expected: FAIL — модуль `./builtins` не существует.

- [ ] **Step 4: Создать `builtins.ts` + расширить `VarOrigin`**

4a. В `src/features/vars/candidates.ts` заменить первую строку:

```ts
export type VarOrigin = "env" | "collection" | "builtin";
```

4b. Создать `src/features/vars/builtins.ts`:

```ts
import type { VarCandidate } from "./candidates";
import { messages } from "@/lib/messages";

/** Built-in dynamic variables. MIRROR of the core `is_builtin` set
 *  (crates/handshaker-core/src/vars/builtins.rs) — keep in sync. */
export const BUILTIN_NAMES = [
  "$guid",
  "$guid7",
  "$timestamp",
  "$unixMs",
  "$isoTimestamp",
  "$randomInt",
] as const;

export type BuiltinName = (typeof BUILTIN_NAMES)[number];

export function isBuiltinName(name: string): boolean {
  return (BUILTIN_NAMES as readonly string[]).includes(name);
}

/** Autocomplete candidates appended to every var surface; the description rides the
 *  `value` slot (shown as the candidate preview / detail). */
export const BUILTIN_CANDIDATES: VarCandidate[] = BUILTIN_NAMES.map((name) => ({
  name,
  value: messages.vars.builtin.desc[name] ?? "",
  origin: "builtin",
}));
```

4c. В `src/features/vars/candidates.ts` дописать билтины в конец результата `buildVarCandidates`. Добавить импорт вверху файла:

```ts
import { BUILTIN_CANDIDATES } from "./builtins";
```

и заменить `return out;` (последняя строка функции) на:

```ts
  out.push(...BUILTIN_CANDIDATES);
  return out;
```

- [ ] **Step 5: Обновить тест `candidates.test.ts` под билтины**

В `src/features/vars/candidates.test.ts` любые ассерты на точную длину/полный массив результата `buildVarCandidates` скорректировать: билтины теперь всегда добавляются в хвост. Добавить явный тест:

```ts
import { BUILTIN_NAMES } from "./builtins";

it("appends builtin candidates after user vars", () => {
  const out = buildVarCandidates({ host: "api.dev" }, {});
  const names = out.map((c) => c.name);
  // user var first, builtins at the tail in declared order
  expect(names[0]).toBe("host");
  expect(names.slice(-BUILTIN_NAMES.length)).toEqual([...BUILTIN_NAMES]);
  expect(out.at(-BUILTIN_NAMES.length)!.origin).toBe("builtin");
});
```

(Если в файле есть тест вида `expect(buildVarCandidates(...)).toEqual([...])` с полным массивом — заменить на проверку префикса пользовательских кандидатов, либо добавить ожидаемые билтины в хвост.)

- [ ] **Step 6: Тег `builtin` в выпадашке plain-инпута**

В `src/features/vars/VarSuggestDropdown.tsx` заменить span тега (блок `c.origin === "env" ? … : …`) на трёхветочный + кастомный текст для builtin:

```tsx
          <span
            className={cn(
              "shrink-0 rounded px-1.5 py-px text-[10px]",
              c.origin === "env"
                ? "bg-ok/15 text-ok"
                : c.origin === "builtin"
                  ? "bg-accent text-accent-foreground"
                  : "bg-warn/15 text-warn",
            )}
          >
            {c.origin === "builtin" ? messages.vars.builtin.tag : c.origin}
          </span>
```

(`messages` уже импортирован в этом файле.)

- [ ] **Step 7: Запустить фронт-тесты vars**

Run: `pnpm vitest run src/features/vars/`
Expected: PASS (builtins.test, candidates.test, прочие vars-тесты).

- [ ] **Step 8: Commit**

```bash
git add src/features/vars/builtins.ts src/features/vars/builtins.test.ts src/features/vars/candidates.ts src/features/vars/candidates.test.ts src/features/vars/VarSuggestDropdown.tsx src/lib/messages.ts
git commit -m "feat(ui): builtin vars in {{ autocomplete (catalog + dropdown tag)"
```

---

## Task 6: Frontend — «динамическая» подсветка токена (Вариант A)

**Files:**
- Modify: `src/features/vars/useVarResolve.ts`
- Modify: `src/features/vars/VarHighlightInput.tsx`
- Modify: `src/styles/globals.css`
- Modify: `src/features/vars/useVarResolve` тест-файл при наличии, иначе тест в `VarHighlightInput.test.tsx`

- [ ] **Step 1: Написать падающий тест классификации**

В `src/features/vars/VarHighlightInput.test.tsx` (или соседний тест useVarResolve) добавить тест, что билтин-токен красится `vh-dynamic`. Пример (адаптировать под существующие хелперы рендера в файле):

```tsx
it("paints a builtin token as dynamic", async () => {
  // resolver: builtin → dynamic_vars set, nothing unresolved
  const resolver = vi.fn(async (t: string) => ({
    resolved: t,
    unresolved_vars: [] as string[],
    cycle_chain: null,
    dynamic_vars: t.includes("$guid") ? ["$guid"] : [],
  }));
  const { container } = render(
    <VarHighlightInput value="{{$guid}}" onChange={() => {}} resolver={resolver} />,
  );
  // token states are debounced (300ms)
  await waitFor(() =>
    expect(container.querySelector(".vh-dynamic")).not.toBeNull(),
  );
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm vitest run src/features/vars/VarHighlightInput.test.tsx -t "dynamic"`
Expected: FAIL — класс `vh-dynamic` не рендерится (состояние "dynamic" ещё не существует).

- [ ] **Step 3: Добавить состояние "dynamic" в резолв**

В `src/features/vars/useVarResolve.ts`:

3a. Расширить тип:

```ts
export type VarTokenState = "resolved" | "error" | "dynamic";
```

3b. В `useTokenResolveStates`, в `.then((r): VarTokenState => …)` заменить тело на:

```ts
            .then((r): VarTokenState =>
              r.cycle_chain != null || r.unresolved_vars.length > 0
                ? "error"
                : r.dynamic_vars.length > 0
                  ? "dynamic"
                  : "resolved",
            )
```

- [ ] **Step 4: Рендерить класс `vh-dynamic`**

В `src/features/vars/VarHighlightInput.tsx`, в маппинге сегментов заменить тернарник className токена на трёхветочный:

```tsx
              className={cn(
                "rounded-[3px]",
                tokenStates[seg.varName] == null
                  ? undefined
                  : tokenStates[seg.varName] === "error"
                    ? "vh-error"
                    : tokenStates[seg.varName] === "dynamic"
                      ? "vh-dynamic"
                      : "vh-resolved",
              )}
```

- [ ] **Step 5: Добавить CSS-класс `.vh-dynamic`**

В `src/styles/globals.css` сразу после строки `.vh-error      { … }` (≈ строка 434) добавить scheme-независимый «динамический» стиль (фиолетовый акцент, отличимый и от resolved-синего, и от error-красного; dark-only приложение):

```css
.vh-dynamic    { background: rgb(168 143 230 / .14); color: #a88fe6; }
```

- [ ] **Step 6: Запустить тест + затронутые vars-тесты**

Run: `pnpm vitest run src/features/vars/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/vars/useVarResolve.ts src/features/vars/VarHighlightInput.tsx src/features/vars/VarHighlightInput.test.tsx src/styles/globals.css
git commit -m "feat(ui): paint builtin {{$var}} tokens as dynamic in VarHighlightInput"
```

---

## Task 7: Полный гейт + верификация

**Files:** нет (проверочная задача).

- [ ] **Step 1: Прогнать весь гейт**

```bash
cargo test --workspace
pnpm lint        # tsc
pnpm vitest run
pnpm build       # tsc + vite
```
Expected: всё зелёное; число тестов выросло на новые (core ~+9, src-tauri ~+2, vitest ~+4).

- [ ] **Step 2: Проверить отсутствие дрейфа bindings**

```bash
cargo run -p handshaker --bin export-bindings --features export-bindings
git diff --stat src/ipc/bindings.ts
```
Expected: пусто (уже закоммичено в Task 3 — повторная генерация не даёт изменений).

- [ ] **Step 3: Live-проверка (WebView2, ручная)**

Чеклист (см. спеку §«Тестирование», Live):
- `{{$guid}}` и `{{$guid7}}` в теле → Send → валидные UUID (v4/v7); два вхождения `{{$guid}}` — разные.
- `{{$timestamp}}` / `{{$unixMs}}` / `{{$isoTimestamp}}` → текущее время; `{{$randomInt}}` в 0–1000.
- Превью адреса/редактора переменных: билтин-токен фиолетовый (`vh-dynamic`), не значение.
- Автокомплит: набор `{{$` предлагает билтины с описанием и тегом «dynamic»; в теле (Monaco) — тоже.
- `{{$foo}}` (неизвестный) — красный (unresolved).
- Пользовательская env-переменная `$guid` (если задать) перекрывает билтин.

---

## Self-Review (выполнено при написании)

- **Покрытие спеки:** набор (Task 1) · `$`-синтаксис без смены grammar (грамматика не трогается; recognition в Task 1/2) · приоритет user-wins (Task 2 тест `user_var_named_dollar_guid_wins`) · per-occurrence (Task 1 тест) · превью Вариант A (Task 6 + описания Task 5) · recognize-in-core + expand-in-invoke (Task 2/4) · `dynamic_vars` сквозной (Task 2/3) · вне scope (auth/host/reflection не раскрываются — `resolve_string` лишь узнаёт, Task 2). Все пункты покрыты.
- **Плейсхолдеры:** нет — весь код приведён.
- **Согласованность типов:** `dynamic_vars: Vec<String>`/`string[]` единообразно (core→ipc→bindings); `BuiltinGenerator`/`expand_builtins`/`is_builtin`/`SystemBuiltins` совпадают между Task 1, 2, 4; `VarOrigin` "builtin" совпадает между candidates.ts, builtins.ts, VarSuggestDropdown.tsx; `VarTokenState` "dynamic" совпадает между useVarResolve.ts и VarHighlightInput.tsx.
- **Замечание:** «описание-тултип на каждый токен при ховере» из Вариант A доставляется через автокомплит-кандидаты (описание в `value`) + цветовую метку, а НЕ через per-token hover (бэкдроп `pointer-events-none`). Это сознательное сужение; honest-описание сохранено. Per-token hover-тултип — возможный follow-up.
