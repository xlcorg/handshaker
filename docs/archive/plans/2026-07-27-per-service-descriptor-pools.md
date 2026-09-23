# Per-Service Descriptor Pools Implementation Plan

**Status:** 🎉 DONE — all 9 tasks implemented, reviewed, and merged to `main`. Gate green
(`cargo test --workspace` · `pnpm lint` · `pnpm test`); live pass against the reporting
.NET endpoint confirmed by the user. No frontend source file changed.

One correction to the plan's premise: `src/ipc/bindings.ts` **is** regenerated, contrary to
the "not regenerated" claim below. No `#[tauri::command]` signature and no `*Ipc` DTO
changed — but two doc comments on command functions did (`grpc_build_request_skeleton`,
`grpc_message_schema`, "the pool" → "the pools" / "the pool set"), and specta exports Rust
doc comments as JSDoc. The regen is a 2-line comment-only diff, verified stable against
`cargo run -p handshaker --bin export-bindings --features export-bindings`.

Where the shipped code deviates from the task text below, the deviation was deliberate and
reviewed — the spec (`specs/archive/2026-07-27-per-service-descriptor-pools-design.md`) was
reconciled against the code and is the accurate design record. Notable deviations:

- `build_pool_set` takes `&[FileDescriptorProto]`, not `Vec` (the caller keeps the corpus).
- Stage 2 visits service-declaring files in **file-name order**; without it "first
  definition wins" picks a different winner per process, since the corpus arrives from a
  `HashMap` drain.
- Stage 3 compares **top-level** names only, qualified by `package`.
- `CachedContract.files` is `Arc<Vec<FileDescriptorProto>>` — `activate()` runs per Send,
  and a bare `Vec` made every send deep-clone the corpus.
- `build_pool`'s internal `pool assembly: ` label was dropped; the composed error is the
  entire user-facing string once the IPC boundary strips the `thiserror` prefix.
- Task 5's `PoolSet::push_for_test` was **not** kept — the catalog tests drive the real
  `build_pool_set` instead, which also covers the chain end to end.
- Several tests beyond the plan pin rules that deliberate one-line mutations survived
  without: root-first closure order, package-qualified prune names, the
  `enum_type`/`extension`/`service` retains, the `dependency`-on-the-winner append, the
  `activate` → `FileContractCache` → reload path, and `for_service` routing on a
  multi-pool set.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A gRPC server whose reflection response defines the same symbol in two
descriptor files must still yield a usable service catalog, instead of failing activation
with `pool assembly: name '…' is already defined in file '…'`.

**Architecture:** Replace the connection's single `DescriptorPool` with a `PoolSet` — a
small vector of pools plus a `service full name → pool index` map. `build_pool_set` fills
it in three stages: one pool for everything (the fast path, unchanged behaviour for
healthy servers); on failure, one pool per service built from that service's own
transitive file closure; and for a closure that is still self-conflicting, a
first-definition-wins symbol prune. All existing pool consumers already know the service
name, so they switch to `pools.for_service(name)`.

**Tech Stack:** Rust, `prost-reflect` 0.14 (`DescriptorPool`), `prost-types`
(`FileDescriptorProto`), `tonic` / `tonic-reflection` for the in-process test servers.

**Spec:** `docs/superpowers/specs/2026-07-27-per-service-descriptor-pools-design.md`

---

## Background you need

- `crates/handshaker-core/src/grpc/descriptor.rs` owns pool assembly. `build_pool(files)`
  wraps `DescriptorPool::add_file_descriptor_protos`.
- `prost-reflect` deduplicates by **file name**. Two different file names declaring the
  same fully-qualified symbol is a hard error, and `DescriptorPool::build_files` rolls the
  entire pool back on any error — so one duplicate loses every service.
- `activate()` (`grpc/contract.rs`) is the only production caller: reflect → build pool →
  build catalog → cache.
- `prost_types::FileDescriptorProto` has generated accessors `name()`, `package()` that
  return `&str` (empty string when the field is `None`).
- Run a single core test with `cargo test -p handshaker-core <test_name>`.

## File structure

| File | Responsibility after this plan |
|---|---|
| `crates/handshaker-core/src/grpc/descriptor.rs` | `build_pool` (unchanged), plus `PoolSet` and the three-stage `build_pool_set`, plus private `service_closure` / `prune_duplicate_symbols` |
| `crates/handshaker-core/src/grpc/catalog/build.rs` | `build_catalog(&PoolSet)` — merges services across pools |
| `crates/handshaker-core/src/grpc/connection.rs` | `GrpcConnection.pools: PoolSet` |
| `crates/handshaker-core/src/grpc/contract_cache.rs` | `CachedContract { files, pools, catalog, fetched_at }` |
| `crates/handshaker-core/src/grpc/file_contract_cache.rs` | persists the **raw corpus**, rebuilds the `PoolSet` on load |
| `crates/handshaker-core/src/grpc/invoke/mod.rs`, `invoke/schema.rs` | resolve a service through `PoolSet::for_service` |
| `crates/handshaker-core/src/grpc/testing.rs` | fixtures carry the raw corpus too |
| `src-tauri/src/commands/grpc.rs` | four call sites pass `&…pools` |
| `crates/handshaker-core/tests/common/mod.rs` | a conflicting-descriptor reflection server |

No `#[tauri::command]` signature and no `*Ipc` DTO changes, so `src/ipc/bindings.ts` is
**not** regenerated and no frontend file is touched.

---

### Task 1: `PoolSet` and stage 1 (fast path)

Introduce the type and the entry point. Nothing switches over yet — `build_pool` and every
existing caller stay exactly as they are, so the workspace keeps compiling.

**Files:**
- Modify: `crates/handshaker-core/src/grpc/descriptor.rs`
- Modify: `crates/handshaker-core/src/grpc/mod.rs:28`

- [ ] **Step 1: Write the failing tests**

Append to the `mod tests` block at the bottom of
`crates/handshaker-core/src/grpc/descriptor.rs` (it already has `use super::*;` and the
`make_simple_file()` helper):

```rust
    #[test]
    fn healthy_corpus_uses_a_single_pool() {
        let set = build_pool_set(&[make_simple_file()]).expect("build pool set");
        assert_eq!(set.pool_count(), 1, "healthy corpus must not leave the fast path");
        assert!(set.for_service("test.Echo").is_some());
        assert!(set.for_service("test.Nope").is_none());
    }

    #[test]
    fn empty_input_rejected_by_pool_set() {
        let err = build_pool_set(&[]).unwrap_err();
        assert!(matches!(err, CoreError::DescriptorBuild(_)));
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cargo test -p handshaker-core healthy_corpus_uses_a_single_pool
```

Expected: FAIL to compile — `cannot find function 'build_pool_set' in this scope`.

- [ ] **Step 3: Implement `PoolSet` and stage 1**

In `crates/handshaker-core/src/grpc/descriptor.rs`, replace the `use` block at the top:

```rust
use crate::error::CoreError;
use prost_reflect::DescriptorPool;
use prost_types::FileDescriptorProto;
use std::collections::HashMap;
```

and add below `build_pool` (keep `build_pool` untouched):

```rust
/// One or more descriptor pools plus a `service full name → pool index` map.
///
/// Healthy servers produce exactly one pool. A server that declares the same symbol in
/// two files gets one pool per service, so a conflict between two services no longer
/// costs the whole endpoint.
#[derive(Clone)]
pub struct PoolSet {
    pools: Vec<DescriptorPool>,
    by_service: HashMap<String, usize>,
}

impl PoolSet {
    /// Wrap one already-assembled pool, indexing every service it declares.
    pub fn from_pool(pool: DescriptorPool) -> Self {
        let mut set = Self { pools: Vec::new(), by_service: HashMap::new() };
        set.push(pool);
        set
    }

    /// The pool that can resolve `full_name`, or `None` if no pool declares that service.
    pub fn for_service(&self, full_name: &str) -> Option<&DescriptorPool> {
        self.by_service.get(full_name).map(|&i| &self.pools[i])
    }

    /// Every pool, in insertion order. Used to project the catalog.
    pub fn pools(&self) -> impl Iterator<Item = &DescriptorPool> {
        self.pools.iter()
    }

    /// How many pools back this set. `1` means the fast path held.
    pub fn pool_count(&self) -> usize {
        self.pools.len()
    }

    fn push(&mut self, pool: DescriptorPool) {
        let idx = self.pools.len();
        // Collect first: `pool.services()` borrows `pool`, which we are about to move.
        let names: Vec<String> = pool.services().map(|s| s.full_name().to_string()).collect();
        self.pools.push(pool);
        for name in names {
            self.by_service.insert(name, idx);
        }
    }
}

/// Assemble `files` into a `PoolSet`.
///
/// Stage 1: one pool for everything. Healthy servers stop here and pay exactly what they
/// paid before this existed. Later stages are added in subsequent tasks.
pub fn build_pool_set(files: &[FileDescriptorProto]) -> Result<PoolSet, CoreError> {
    if files.is_empty() {
        return Err(CoreError::DescriptorBuild(
            "no FileDescriptorProto received from server".into(),
        ));
    }
    let pool = build_pool(files.to_vec())?;
    Ok(PoolSet::from_pool(pool))
}
```

Then widen the re-export in `crates/handshaker-core/src/grpc/mod.rs:28`:

```rust
pub use descriptor::{build_pool, build_pool_set, PoolSet};
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cargo test -p handshaker-core --lib descriptor
```

Expected: PASS — including the pre-existing `empty_input_rejected`,
`single_file_builds_and_resolves_service`, `unresolved_import_is_rejected`.

- [ ] **Step 5: Commit**

```bash
git add crates/handshaker-core/src/grpc/descriptor.rs crates/handshaker-core/src/grpc/mod.rs
git commit -m "feat(grpc): PoolSet with single-pool fast path"
```

---

### Task 2: Stage 2 — per-service isolation

The fix for the reported bug. When one pool cannot hold everything, give each service its
own pool built from its own transitive file closure.

**Files:**
- Modify: `crates/handshaker-core/src/grpc/descriptor.rs`

- [ ] **Step 1: Write the failing test**

Append to `mod tests` in `crates/handshaker-core/src/grpc/descriptor.rs`. This fixture is
the reported shape: two services, two files, one shared message name — with **different
fields**, so the test proves each service keeps its own copy rather than merely proving
"no error".

```rust
    /// One file: `package test; message Shared { string <field> = 1; }
    /// service <svc> { rpc Call (Shared) returns (Shared); }`
    fn file_with_own_shared(file: &str, svc: &str, field: &str) -> FileDescriptorProto {
        FileDescriptorProto {
            name: Some(file.into()),
            package: Some("test".into()),
            syntax: Some("proto3".into()),
            message_type: vec![DescriptorProto {
                name: Some("Shared".into()),
                field: vec![FieldDescriptorProto {
                    name: Some(field.into()),
                    number: Some(1),
                    r#type: Some(FieldType::String as i32),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            service: vec![ServiceDescriptorProto {
                name: Some(svc.into()),
                method: vec![MethodDescriptorProto {
                    name: Some("Call".into()),
                    input_type: Some(".test.Shared".into()),
                    output_type: Some(".test.Shared".into()),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    #[test]
    fn duplicate_symbol_across_services_isolates_into_one_pool_each() {
        let files = vec![
            file_with_own_shared("a.proto", "SvcA", "a_only"),
            file_with_own_shared("b.proto", "SvcB", "b_only"),
        ];
        // Sanity: the single-pool path really does reject this corpus.
        assert!(build_pool(files.clone()).is_err());

        let set = build_pool_set(&files).expect("isolation must rescue this corpus");
        assert_eq!(set.pool_count(), 2);

        let a = set.for_service("test.SvcA").expect("SvcA resolves");
        let b = set.for_service("test.SvcB").expect("SvcB resolves");

        // Each service must see ITS OWN copy of test.Shared, not the other's.
        let a_shared = a.get_message_by_name("test.Shared").unwrap();
        let b_shared = b.get_message_by_name("test.Shared").unwrap();
        assert!(a_shared.get_field_by_name("a_only").is_some());
        assert!(a_shared.get_field_by_name("b_only").is_none());
        assert!(b_shared.get_field_by_name("b_only").is_some());
        assert!(b_shared.get_field_by_name("a_only").is_none());
    }
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cargo test -p handshaker-core duplicate_symbol_across_services_isolates_into_one_pool_each
```

Expected: FAIL — `isolation must rescue this corpus: DescriptorBuild("pool assembly: name
'test.Shared' is already defined in file 'a.proto'")`.

- [ ] **Step 3: Implement stage 2**

In `crates/handshaker-core/src/grpc/descriptor.rs`, replace the body of `build_pool_set`
with the version below and add `service_closure` beneath it. `HashSet` joins the imports:

```rust
use std::collections::{HashMap, HashSet};
```

```rust
/// Assemble `files` into a `PoolSet`.
///
/// Stage 1: one pool for everything — the fast path, and what healthy servers use.
/// Stage 2: on any stage-1 failure, one pool per service, built from that service's own
/// transitive `dependency` closure. Cross-service duplicate symbols vanish here because
/// the two copies land in different pools.
pub fn build_pool_set(files: &[FileDescriptorProto]) -> Result<PoolSet, CoreError> {
    if files.is_empty() {
        return Err(CoreError::DescriptorBuild(
            "no FileDescriptorProto received from server".into(),
        ));
    }

    if let Ok(pool) = build_pool(files.to_vec()) {
        return Ok(PoolSet::from_pool(pool));
    }

    let index: HashMap<&str, &FileDescriptorProto> =
        files.iter().map(|f| (f.name(), f)).collect();

    let mut set = PoolSet { pools: Vec::new(), by_service: HashMap::new() };
    for file in files.iter().filter(|f| !f.service.is_empty()) {
        let pool = build_pool(service_closure(&index, file))?;
        set.push(pool);
    }
    Ok(set)
}

/// The transitive `dependency` closure of `root`, root first and the rest sorted by file
/// name so the result is deterministic. Dependencies missing from `index` are skipped —
/// the pool build is what reports them.
fn service_closure(
    index: &HashMap<&str, &FileDescriptorProto>,
    root: &FileDescriptorProto,
) -> Vec<FileDescriptorProto> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut closure: Vec<FileDescriptorProto> = Vec::new();
    let mut stack = vec![root.name().to_string()];

    while let Some(name) = stack.pop() {
        if !seen.insert(name.clone()) {
            continue;
        }
        let Some(file) = index.get(name.as_str()) else {
            continue;
        };
        for dep in &file.dependency {
            if !seen.contains(dep.as_str()) {
                stack.push(dep.clone());
            }
        }
        closure.push((*file).clone());
    }

    if closure.len() > 1 {
        closure[1..].sort_by(|a, b| a.name().cmp(b.name()));
    }
    closure
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cargo test -p handshaker-core --lib descriptor
```

Expected: PASS, including `healthy_corpus_uses_a_single_pool` (still one pool).

- [ ] **Step 5: Commit**

```bash
git add crates/handshaker-core/src/grpc/descriptor.rs
git commit -m "feat(grpc): isolate each service in its own descriptor pool"
```

---

### Task 3: A service that cannot be assembled costs only itself

Stage 2 currently propagates the first per-service failure with `?`, which reinstates the
all-or-nothing behaviour we are removing. Skip the broken service, keep the rest, and only
fail when nothing at all could be assembled.

**Files:**
- Modify: `crates/handshaker-core/src/grpc/descriptor.rs`

- [ ] **Step 1: Write the failing tests**

Append to `mod tests` in `crates/handshaker-core/src/grpc/descriptor.rs`:

```rust
    /// `package test; service <svc> { rpc Call (Shared) returns (Shared); }` importing a
    /// file the server never returned — unassemblable on its own.
    fn file_with_dangling_import(file: &str, svc: &str) -> FileDescriptorProto {
        FileDescriptorProto {
            name: Some(file.into()),
            package: Some("test".into()),
            syntax: Some("proto3".into()),
            dependency: vec!["never/sent.proto".into()],
            service: vec![ServiceDescriptorProto {
                name: Some(svc.into()),
                method: vec![MethodDescriptorProto {
                    name: Some("Call".into()),
                    input_type: Some(".test.Shared".into()),
                    output_type: Some(".test.Shared".into()),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    #[test]
    fn unassemblable_service_is_skipped_others_survive() {
        let files = vec![
            file_with_own_shared("a.proto", "SvcA", "a_only"),
            file_with_own_shared("b.proto", "SvcB", "b_only"),
            file_with_dangling_import("c.proto", "SvcC"),
        ];
        let set = build_pool_set(&files).expect("two healthy services must survive");
        assert_eq!(set.pool_count(), 2);
        assert!(set.for_service("test.SvcA").is_some());
        assert!(set.for_service("test.SvcB").is_some());
        assert!(set.for_service("test.SvcC").is_none());
    }

    #[test]
    fn no_assemblable_service_is_fatal() {
        let err = build_pool_set(&[file_with_dangling_import("c.proto", "SvcC")]).unwrap_err();
        match err {
            CoreError::DescriptorBuild(msg) => {
                assert!(msg.contains("no service could be assembled"), "got: {msg}");
            }
            other => panic!("expected DescriptorBuild, got {other:?}"),
        }
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cargo test -p handshaker-core unassemblable_service_is_skipped_others_survive
```

Expected: FAIL — `two healthy services must survive: DescriptorBuild("pool assembly: …
never/sent.proto …")`, because stage 2 still uses `?`.

- [ ] **Step 3: Make per-service failure non-fatal**

In `crates/handshaker-core/src/grpc/descriptor.rs`, replace the stage-2 loop and the
return in `build_pool_set` with:

```rust
    let mut set = PoolSet { pools: Vec::new(), by_service: HashMap::new() };
    let mut first_error: Option<String> = None;

    for file in files.iter().filter(|f| !f.service.is_empty()) {
        match build_pool(service_closure(&index, file)) {
            Ok(pool) => set.push(pool),
            Err(e) => {
                eprintln!(
                    "descriptor pool: skipping services declared in {}: {e}",
                    file.name()
                );
                first_error.get_or_insert_with(|| e.to_string());
            }
        }
    }

    if set.pool_count() == 0 {
        return Err(CoreError::DescriptorBuild(format!(
            "no service could be assembled from the server's descriptors: {}",
            first_error.unwrap_or_else(|| "no file declares a service".into())
        )));
    }
    Ok(set)
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cargo test -p handshaker-core --lib descriptor
```

Expected: PASS (7 tests in the module).

- [ ] **Step 5: Commit**

```bash
git add crates/handshaker-core/src/grpc/descriptor.rs
git commit -m "feat(grpc): skip only the services that cannot be assembled"
```

---

### Task 4: Stage 3 — prune duplicate symbols inside one closure

Isolation cannot help a service whose own import closure declares a symbol twice. Keep the
first definition, drop the later ones, and point the losing file at the winner so its
remaining references still resolve.

**Files:**
- Modify: `crates/handshaker-core/src/grpc/descriptor.rs`

- [ ] **Step 1: Write the failing test**

Append to `mod tests` in `crates/handshaker-core/src/grpc/descriptor.rs`:

```rust
    /// `package test; message <msg> { string <field> = 1; }` in its own file.
    fn file_with_message(file: &str, msg: &str, field: &str) -> FileDescriptorProto {
        FileDescriptorProto {
            name: Some(file.into()),
            package: Some("test".into()),
            syntax: Some("proto3".into()),
            message_type: vec![DescriptorProto {
                name: Some(msg.into()),
                field: vec![FieldDescriptorProto {
                    name: Some(field.into()),
                    number: Some(1),
                    r#type: Some(FieldType::String as i32),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    #[test]
    fn duplicate_inside_one_closure_is_pruned_service_survives() {
        // svc.proto imports both dep1.proto and dep2.proto, and BOTH declare test.Dup.
        let mut dep2 = file_with_message("dep2.proto", "Dup", "from_dep2");
        dep2.message_type.push(DescriptorProto {
            name: Some("Other".into()),
            field: vec![FieldDescriptorProto {
                name: Some("z".into()),
                number: Some(1),
                r#type: Some(FieldType::String as i32),
                ..Default::default()
            }],
            ..Default::default()
        });

        let svc = FileDescriptorProto {
            name: Some("svc.proto".into()),
            package: Some("test".into()),
            syntax: Some("proto3".into()),
            dependency: vec!["dep1.proto".into(), "dep2.proto".into()],
            service: vec![ServiceDescriptorProto {
                name: Some("SvcD".into()),
                method: vec![MethodDescriptorProto {
                    name: Some("Call".into()),
                    input_type: Some(".test.Dup".into()),
                    output_type: Some(".test.Other".into()),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        };

        let files = vec![file_with_message("dep1.proto", "Dup", "from_dep1"), dep2, svc];
        let set = build_pool_set(&files).expect("pruning must rescue this closure");

        let pool = set.for_service("test.SvcD").expect("SvcD resolves");
        let dup = pool.get_message_by_name("test.Dup").unwrap();
        // dep1.proto sorts before dep2.proto, so its definition wins.
        assert!(dup.get_field_by_name("from_dep1").is_some());
        assert!(dup.get_field_by_name("from_dep2").is_none());
        // The losing file keeps everything that was not a duplicate.
        assert!(pool.get_message_by_name("test.Other").is_some());
    }
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cargo test -p handshaker-core duplicate_inside_one_closure_is_pruned_service_survives
```

Expected: FAIL — `pruning must rescue this closure: DescriptorBuild("no service could be
assembled …")`, because the closure still contains both `test.Dup` definitions.

- [ ] **Step 3: Implement pruning as the stage-3 retry**

In `crates/handshaker-core/src/grpc/descriptor.rs`, change the stage-2 build line inside
the loop from

```rust
        match build_pool(service_closure(&index, file)) {
```

to

```rust
        let closure = service_closure(&index, file);
        let built = build_pool(closure.clone())
            .or_else(|_| build_pool(prune_duplicate_symbols(closure)));
        match built {
```

and add these functions below `service_closure`:

```rust
/// Drop duplicate **top-level** definitions from `files`, keeping the first file that
/// declares each fully-qualified name and giving the losing file a `dependency` on the
/// winner so its surviving references still resolve.
///
/// Only top-level names are compared: a nested type is reachable only through its parent,
/// so dropping the parent takes its nested types with it.
///
/// This is lossy — where two copies differ, the first one wins for everybody in the
/// closure. It runs only after per-service isolation has already failed.
fn prune_duplicate_symbols(mut files: Vec<FileDescriptorProto>) -> Vec<FileDescriptorProto> {
    // fully-qualified name -> name of the file that owns it
    let mut owner: HashMap<String, String> = HashMap::new();

    for file in files.iter_mut() {
        let package = file.package().to_string();
        let file_name = file.name().to_string();
        let mut extra_deps: HashSet<String> = HashSet::new();

        let mut keep = |name: &str| {
            let full_name = if package.is_empty() {
                name.to_string()
            } else {
                format!("{package}.{name}")
            };
            match owner.get(&full_name) {
                None => {
                    owner.insert(full_name, file_name.clone());
                    true
                }
                Some(first) => {
                    if first != &file_name {
                        extra_deps.insert(first.clone());
                    }
                    false
                }
            }
        };

        file.message_type.retain(|m| keep(m.name()));
        file.enum_type.retain(|e| keep(e.name()));
        file.extension.retain(|x| keep(x.name()));
        file.service.retain(|s| keep(s.name()));
        drop(keep);

        for dep in extra_deps {
            if !file.dependency.contains(&dep) {
                file.dependency.push(dep);
            }
        }
    }

    files
}
```

If the borrow checker rejects the closure capturing `owner` and `extra_deps` across the
four `retain` calls, hoist it to a free function instead and call it four times:

```rust
fn claim(
    owner: &mut HashMap<String, String>,
    extra_deps: &mut HashSet<String>,
    package: &str,
    file_name: &str,
    name: &str,
) -> bool {
    let full_name = if package.is_empty() {
        name.to_string()
    } else {
        format!("{package}.{name}")
    };
    match owner.get(&full_name) {
        None => {
            owner.insert(full_name, file_name.to_string());
            true
        }
        Some(first) => {
            if first != file_name {
                extra_deps.insert(first.clone());
            }
            false
        }
    }
}
```

with call sites shaped like:

```rust
        file.message_type
            .retain(|m| claim(&mut owner, &mut extra_deps, &package, &file_name, m.name()));
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cargo test -p handshaker-core --lib descriptor
```

Expected: PASS (8 tests). `unassemblable_service_is_skipped_others_survive` still passes —
pruning cannot invent a file the server never sent, so `SvcC` is still skipped.

- [ ] **Step 5: Commit**

```bash
git add crates/handshaker-core/src/grpc/descriptor.rs
git commit -m "feat(grpc): prune duplicate symbols within a service closure"
```

---

### Task 5: `build_catalog` projects a `PoolSet`

**Files:**
- Modify: `crates/handshaker-core/src/grpc/catalog/build.rs`
- Modify: `crates/handshaker-core/src/grpc/contract.rs:41`
- Modify: `crates/handshaker-core/src/grpc/file_contract_cache.rs:185`
- Modify: `crates/handshaker-core/src/grpc/testing.rs:125,136`
- Modify: `crates/handshaker-core/tests/contract_cache.rs:27`

- [ ] **Step 1: Write the failing test**

Append to `mod tests` in `crates/handshaker-core/src/grpc/catalog/build.rs`:

```rust
    #[test]
    fn catalog_merges_services_across_pools_sorted_and_deduped() {
        use crate::grpc::descriptor::PoolSet;

        let beta = build_pool(vec![FileDescriptorProto {
            name: Some("beta.proto".into()),
            package: Some("test".into()),
            syntax: Some("proto3".into()),
            message_type: vec![DescriptorProto {
                name: Some("Empty".into()),
                ..Default::default()
            }],
            service: vec![ServiceDescriptorProto {
                name: Some("Beta".into()),
                method: vec![MethodDescriptorProto {
                    name: Some("Zeta".into()),
                    input_type: Some(".test.Empty".into()),
                    output_type: Some(".test.Empty".into()),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        }])
        .unwrap();

        let mut set = PoolSet::from_pool(beta);
        // A second pool that re-declares test.Empty — exactly what isolation produces.
        set.push_for_test(
            build_pool(vec![FileDescriptorProto {
                name: Some("alpha.proto".into()),
                package: Some("test".into()),
                syntax: Some("proto3".into()),
                message_type: vec![DescriptorProto {
                    name: Some("Empty".into()),
                    ..Default::default()
                }],
                service: vec![ServiceDescriptorProto {
                    name: Some("Alpha".into()),
                    method: vec![MethodDescriptorProto {
                        name: Some("Foo".into()),
                        input_type: Some(".test.Empty".into()),
                        output_type: Some(".test.Empty".into()),
                        ..Default::default()
                    }],
                    ..Default::default()
                }],
                ..Default::default()
            }])
            .unwrap(),
        );

        let cat = build_catalog(&set);
        assert_eq!(cat.services.len(), 2);
        assert_eq!(cat.services[0].full_name, "test.Alpha");
        assert_eq!(cat.services[1].full_name, "test.Beta");
    }
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cargo test -p handshaker-core catalog_merges_services_across_pools
```

Expected: FAIL to compile — `no method named 'push_for_test'` and
`build_catalog` expects `&DescriptorPool`.

- [ ] **Step 3: Implement**

In `crates/handshaker-core/src/grpc/descriptor.rs`, expose the internal `push` for tests
by adding this to `impl PoolSet` (right under `push`):

```rust
    /// Test-only: append a pool, indexing its services. Production code goes through
    /// `build_pool_set`.
    #[cfg(test)]
    pub fn push_for_test(&mut self, pool: DescriptorPool) {
        self.push(pool);
    }
```

Replace the top of `crates/handshaker-core/src/grpc/catalog/build.rs`:

```rust
//! Project a `PoolSet` into a stable `ServiceCatalog`.

use crate::grpc::catalog::{MethodEntry, ServiceCatalog, ServiceEntry};
use crate::grpc::descriptor::PoolSet;

/// Snapshot every service across every pool in `pools` into a `ServiceCatalog`. Services
/// are sorted by full_name for a stable list; methods keep their `.proto` definition
/// order. A service declared in more than one pool is listed once.
pub fn build_catalog(pools: &PoolSet) -> ServiceCatalog {
    let mut services: Vec<ServiceEntry> = pools
        .pools()
        .flat_map(|pool| pool.services())
        .map(|s| {
            let methods: Vec<MethodEntry> = s
                .methods()
                .map(|m| MethodEntry {
                    name: m.name().to_string(),
                    path: format!("/{}/{}", s.full_name(), m.name()),
                    input_message: m.input().full_name().to_string(),
                    output_message: m.output().full_name().to_string(),
                    client_streaming: m.is_client_streaming(),
                    server_streaming: m.is_server_streaming(),
                })
                .collect();
            ServiceEntry {
                full_name: s.full_name().to_string(),
                methods,
            }
        })
        .collect();
    services.sort_by(|a, b| a.full_name.cmp(&b.full_name));
    services.dedup_by(|a, b| a.full_name == b.full_name);
    ServiceCatalog { services }
}
```

The pre-existing test `services_sorted_methods_in_definition_order` needs its one call
site wrapped — change

```rust
        let pool = build_pool(vec![simple_file_with_two_services()]).unwrap();
        let cat = build_catalog(&pool);
```

to

```rust
        let pool = build_pool(vec![simple_file_with_two_services()]).unwrap();
        let cat = build_catalog(&crate::grpc::descriptor::PoolSet::from_pool(pool));
```

Wrap the four production/fixture call sites the same way. In
`crates/handshaker-core/src/grpc/contract.rs:41`:

```rust
    let pool = build_pool(files)?;
    let catalog = build_catalog(&crate::grpc::descriptor::PoolSet::from_pool(pool.clone()));
```

(Task 6 replaces this with `build_pool_set` outright; this keeps the tree compiling.)

In `crates/handshaker-core/src/grpc/file_contract_cache.rs:185`,
`crates/handshaker-core/src/grpc/testing.rs:125` and `:136`, and
`crates/handshaker-core/tests/contract_cache.rs:27`, replace `build_catalog(&pool)` with
`build_catalog(&PoolSet::from_pool(pool.clone()))`, importing `PoolSet` from
`handshaker_core::grpc` in the integration test and from `crate::grpc::descriptor` inside
the crate.

- [ ] **Step 4: Run the full core suite**

```bash
cargo test -p handshaker-core
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/handshaker-core
git commit -m "refactor(grpc): build_catalog projects a PoolSet"
```

---

### Task 6: Carry a `PoolSet` on the connection and the cache entry

The type flip. Every consumer already knows the service name, so each becomes a
`for_service` lookup. No new tests — the existing suite is the check.

**Files:**
- Modify: `crates/handshaker-core/src/grpc/connection.rs:82`
- Modify: `crates/handshaker-core/src/grpc/contract_cache.rs:9,28-32,78-84`
- Modify: `crates/handshaker-core/src/grpc/contract.rs`
- Modify: `crates/handshaker-core/src/grpc/invoke/mod.rs:59-92,111-113`
- Modify: `crates/handshaker-core/src/grpc/invoke/schema.rs:79-89`
- Modify: `crates/handshaker-core/src/grpc/mod.rs:29-34`
- Modify: `crates/handshaker-core/src/grpc/testing.rs:123-146`
- Modify: `crates/handshaker-core/src/grpc/file_contract_cache.rs` (tests block)
- Modify: `src-tauri/src/commands/grpc.rs:14,129,135,158,165`

- [ ] **Step 1: `GrpcConnection` carries pools**

In `crates/handshaker-core/src/grpc/connection.rs:82`:

```rust
    pub pools: crate::grpc::descriptor::PoolSet,
```

- [ ] **Step 2: `CachedContract` carries the corpus and the pools**

In `crates/handshaker-core/src/grpc/contract_cache.rs`, replace the `prost_reflect` import
with:

```rust
use prost_types::FileDescriptorProto;

use crate::grpc::descriptor::PoolSet;
```

and the struct with:

```rust
/// A cached contract: the raw descriptor corpus as fetched, the pools assembled from it,
/// and the projected catalog. The corpus is kept because it — not the assembled pools —
/// is what gets persisted, so a reload can rebuild the pools deterministically.
#[derive(Clone)]
pub struct CachedContract {
    pub files: Vec<FileDescriptorProto>,
    pub pools: PoolSet,
    pub catalog: ServiceCatalog,
    pub fetched_at: std::time::SystemTime,
}
```

Update the module's `sample_contract()` test helper (around line 78):

```rust
    fn sample_contract() -> CachedContract {
        CachedContract {
            files: vec![],
            pools: PoolSet::from_pool(prost_reflect::DescriptorPool::new()),
            catalog: ServiceCatalog { services: vec![] },
            fetched_at: std::time::SystemTime::UNIX_EPOCH,
        }
    }
```

- [ ] **Step 3: `activate` builds a `PoolSet`**

In `crates/handshaker-core/src/grpc/contract.rs`, change the import on line 10 to

```rust
use crate::grpc::descriptor::build_pool_set;
```

and the body from line 27 onward to:

```rust
    if let Some(cached) = cache.get(&key) {
        return Ok(GrpcConnection {
            target,
            transport,
            channel,
            pools: cached.pools,
            catalog: cached.catalog,
        });
    }

    // clone — TonicChannel is cheap to Clone (Arc internally); reflection consumes
    // its copy, the original stays in GrpcConnection for subsequent invokes.
    let (_services_listed, files) = list_and_fetch_files(channel.clone()).await?;
    let pools = build_pool_set(&files)?;
    let catalog = build_catalog(&pools);

    cache.put(
        key,
        CachedContract {
            files,
            pools: pools.clone(),
            catalog: catalog.clone(),
            fetched_at: std::time::SystemTime::now(),
        },
    );

    Ok(GrpcConnection { target, transport, channel, pools, catalog })
```

- [ ] **Step 4: Invoke and schema resolve through `for_service`**

In `crates/handshaker-core/src/grpc/invoke/mod.rs`, rename and rewrite:

```rust
pub fn build_request_skeleton(
    connection: &GrpcConnection,
    service: &str,
    method: &str,
) -> Result<String, CoreError> {
    build_request_skeleton_from_pools(&connection.pools, service, method)
}

/// Build a pretty-printed JSON skeleton for a method's input message, from a pool set.
///
/// Pool-set-based variant so callers without a live `GrpcConnection` (e.g. the lazy
/// connect-on-Send command surface) can build a skeleton straight from a cached contract.
pub fn build_request_skeleton_from_pools(
    pools: &crate::grpc::descriptor::PoolSet,
    service: &str,
    method: &str,
) -> Result<String, CoreError> {
    let svc = pools
        .for_service(service)
        .and_then(|p| p.get_service_by_name(service))
        .ok_or_else(|| CoreError::ServiceNotFound {
            service: service.to_string(),
        })?;
```

leaving the rest of that function unchanged. In `invoke_unary` (line 111) replace the
service lookup with:

```rust
    let svc = connection
        .pools
        .for_service(service)
        .and_then(|p| p.get_service_by_name(service))
        .ok_or_else(|| CoreError::ServiceNotFound {
            service: service.to_string(),
        })?;
```

The two unit tests at lines 166 and 173 call `build_request_skeleton_from_pool(&pool, …)`
— change them to
`build_request_skeleton_from_pools(&crate::grpc::descriptor::PoolSet::from_pool(pool), …)`
(bind the `PoolSet` to a local first, since both tests reuse it).

In `crates/handshaker-core/src/grpc/invoke/schema.rs:79`, apply the same treatment:

```rust
pub fn build_message_schema_from_pools(
    pools: &crate::grpc::descriptor::PoolSet,
    service: &str,
    method: &str,
    side: MessageSide,
) -> Result<MessageSchema, CoreError> {
    let svc = pools
        .for_service(service)
        .and_then(|p| p.get_service_by_name(service))
        .ok_or_else(|| CoreError::ServiceNotFound {
            service: service.to_string(),
        })?;
```

and update its five test call sites (lines 659, 663, 667, 698, 700) to wrap `pool` in
`PoolSet::from_pool(pool.clone())`.

- [ ] **Step 5: Update the re-exports**

In `crates/handshaker-core/src/grpc/mod.rs`, rename inside the `invoke` re-export list:

```rust
pub use invoke::{
    build_message_schema_from_pools, build_request_skeleton, build_request_skeleton_from_pools,
    extract_status_details, invoke_unary, CallOptions, EnumNode, EnumValueNode, FieldNode,
    FieldValueKind, FieldViolation, HelpLink, MessageNode, MessageSchema, MessageSide,
    PreconditionViolation, QuotaViolation, StatusDetail, UnaryOutcome,
};
```

and mirror the rename in `crates/handshaker-core/src/grpc/invoke/mod.rs:19` (the
`pub use schema::{…}` line).

- [ ] **Step 6: Update the test fixtures**

In `crates/handshaker-core/src/grpc/testing.rs`, add next to `fixture_pool()`:

```rust
/// The raw corpus behind `fixture_pool()` — what a `CachedContract` persists.
pub fn fixture_files() -> Vec<prost_types::FileDescriptorProto> {
    fixture_pool().file_descriptor_protos().cloned().collect()
}
```

and rewrite the two constructors:

```rust
pub fn fixture_cached_contract() -> crate::grpc::contract_cache::CachedContract {
    let pools = crate::grpc::descriptor::PoolSet::from_pool(fixture_pool());
    let catalog = crate::grpc::catalog::build::build_catalog(&pools);
    crate::grpc::contract_cache::CachedContract {
        files: fixture_files(),
        pools,
        catalog,
        fetched_at: std::time::SystemTime::UNIX_EPOCH,
    }
}

pub fn fake_connection(transport: Arc<dyn GrpcTransport>) -> GrpcConnection {
    let pools = crate::grpc::descriptor::PoolSet::from_pool(fixture_pool());
    let catalog = crate::grpc::catalog::build::build_catalog(&pools);
    // Lazy channel to a bogus address — never used by FakeTransport, but the field must exist.
    let channel = tonic::transport::Channel::from_static("http://127.0.0.1:1").connect_lazy();
    GrpcConnection {
        target: GrpcTarget::new("127.0.0.1:1", false, false).unwrap(),
        transport,
        channel,
        pools,
        catalog,
    }
}
```

In `crates/handshaker-core/src/grpc/file_contract_cache.rs`, update `sample_contract()`
(line 183) and the two assertions that read `.pool` (lines 210 and 247):

```rust
    fn sample_contract() -> CachedContract {
        let files: Vec<prost_types::FileDescriptorProto> =
            sample_pool().file_descriptor_protos().cloned().collect();
        let pools = crate::grpc::descriptor::PoolSet::from_pool(sample_pool());
        let catalog = build_catalog(&pools);
        CachedContract {
            files,
            pools,
            catalog,
            fetched_at: UNIX_EPOCH + Duration::from_millis(FETCHED_MS),
        }
    }
```

```rust
        assert!(got.pools.for_service("test.Echo").is_some());
```

```rust
        assert!(reloaded
            .get(&key("good:1", false))
            .unwrap()
            .pools
            .for_service("test.Echo")
            .is_some());
```

In `crates/handshaker-core/tests/contract_activate.rs:26`:

```rust
    assert!(conn
        .pools
        .for_service("test.Echo")
        .unwrap()
        .get_message_by_name("test.Ping")
        .is_some());
```

In `crates/handshaker-core/tests/contract_cache.rs:22-37`, build the contract from the
fixture corpus:

```rust
    let set: prost_types::FileDescriptorSet =
        Message::decode(&common::fixture_descriptor_set_bytes()[..]).unwrap();
    let pools = handshaker_core::grpc::build_pool_set(&set.file).unwrap();
    let catalog = build_catalog(&pools);

    let cache = InMemoryContractCache::new();
    cache.put(
        key,
        handshaker_core::grpc::CachedContract {
            files: set.file,
            pools,
            catalog,
            fetched_at: std::time::SystemTime::UNIX_EPOCH,
        },
    );
```

and drop the now-unused `use prost_reflect::DescriptorPool;` from that file.

- [ ] **Step 7: Update the IPC command layer**

In `src-tauri/src/commands/grpc.rs`, line 14 renames the two imports:

```rust
    activate, build_message_schema_from_pools, build_request_skeleton_from_pools, CallOptions,
```

and the four call sites become:

```rust
        return Ok(build_request_skeleton_from_pools(&cached.pools, &service, &method)?);
```
```rust
        Ok::<String, IpcError>(build_request_skeleton_from_pools(&conn.pools, &service, &method)?)
```
```rust
        return Ok(build_message_schema_from_pools(&cached.pools, &service, &method, side.into())?.into());
```
```rust
            build_message_schema_from_pools(&conn.pools, &service, &method, side.into())?.into(),
```

- [ ] **Step 8: Run the whole workspace suite**

```bash
cargo test --workspace
```

Expected: PASS. If `grpc/contract.rs` still references `build_pool` or `pool`, the compiler
names the line.

- [ ] **Step 9: Commit**

```bash
git add crates/handshaker-core src-tauri/src/commands/grpc.rs
git commit -m "refactor(grpc): resolve services through a PoolSet"
```

---

### Task 7: Persist the raw corpus, rebuild pools on load

**Files:**
- Modify: `crates/handshaker-core/src/grpc/file_contract_cache.rs`

- [ ] **Step 1: Write the failing tests**

Append to `mod tests` in `crates/handshaker-core/src/grpc/file_contract_cache.rs`:

```rust
    #[test]
    fn conflicting_corpus_round_trips_as_multiple_pools() {
        use prost_types::{DescriptorProto, ServiceDescriptorProto};

        // Two files, same message name, one service each — the isolation case.
        let mk = |file: &str, svc: &str| FileDescriptorProto {
            name: Some(file.into()),
            package: Some("test".into()),
            syntax: Some("proto3".into()),
            message_type: vec![DescriptorProto {
                name: Some("Shared".into()),
                ..Default::default()
            }],
            service: vec![ServiceDescriptorProto {
                name: Some(svc.into()),
                method: vec![MethodDescriptorProto {
                    name: Some("Call".into()),
                    input_type: Some(".test.Shared".into()),
                    output_type: Some(".test.Shared".into()),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        };
        let files = vec![mk("a.proto", "SvcA"), mk("b.proto", "SvcB")];
        let pools = crate::grpc::descriptor::build_pool_set(&files).unwrap();
        let catalog = build_catalog(&pools);

        let dir = tempfile::tempdir().unwrap();
        let k = key("dupes:443", true);
        let cache = FileContractCache::load(dir.path().to_path_buf()).unwrap();
        cache.put(
            k.clone(),
            CachedContract {
                files,
                pools,
                catalog,
                fetched_at: UNIX_EPOCH + Duration::from_millis(FETCHED_MS),
            },
        );
        drop(cache);

        let reloaded = FileContractCache::load(dir.path().to_path_buf()).unwrap();
        let got = reloaded.get(&k).expect("entry survives reload");
        assert_eq!(got.pools.pool_count(), 2);
        assert!(got.pools.for_service("test.SvcA").is_some());
        assert!(got.pools.for_service("test.SvcB").is_some());
    }

    #[test]
    fn old_format_entry_is_skipped_on_load() {
        let dir = tempfile::tempdir().unwrap();
        // An entry written before this change: a `pool` field, no `files` field.
        std::fs::write(
            dir.path().join("00.json"),
            br#"{"schema_version":1,"data":{"address":"h:1","tls":false,"pool":[],"catalog":{"services":[]},"fetched_at":0}}"#,
        )
        .unwrap();

        let reloaded = FileContractCache::load(dir.path().to_path_buf()).unwrap();
        assert!(reloaded.get(&key("h:1", false)).is_none());
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cargo test -p handshaker-core conflicting_corpus_round_trips_as_multiple_pools
```

Expected: FAIL to compile — `PersistedContract` has no `files` field and `read_entry`
returns a pool.

- [ ] **Step 3: Implement**

In `crates/handshaker-core/src/grpc/file_contract_cache.rs`, replace the `prost_reflect`
import with:

```rust
use prost::Message as _;
use prost_types::FileDescriptorSet;

use crate::grpc::descriptor::build_pool_set;
```

Update the persisted shape (line 22-31):

```rust
/// On-disk shape of one cached contract. `files` is the **raw** descriptor corpus as the
/// server sent it, encoded as a protobuf `FileDescriptorSet`; the pools are rebuilt from
/// it on load. Storing raw rather than post-assembly keeps restoration deterministic —
/// after pruning, one file name can have different contents in different pools.
/// `fetched_at` is epoch-ms.
#[derive(Serialize, Deserialize)]
struct PersistedContract {
    address: String,
    tls: bool,
    files: Vec<u8>,
    catalog: ServiceCatalog,
    fetched_at: i64,
}
```

`read_entry` (line 77):

```rust
    fn read_entry(path: &Path) -> Result<(ContractKey, CachedContract), CoreError> {
        let p: PersistedContract = read_json(path)?;
        let set = FileDescriptorSet::decode(p.files.as_slice())
            .map_err(|e| CoreError::DescriptorBuild(format!("decode cached descriptors: {e}")))?;
        let pools = build_pool_set(&set.file)?;
        let key = ContractKey { address: p.address, tls: p.tls };
        let contract = CachedContract {
            files: set.file,
            pools,
            catalog: p.catalog,
            fetched_at: UNIX_EPOCH + Duration::from_millis(p.fetched_at.max(0) as u64),
        };
        Ok((key, contract))
    }
```

`persist` (line 100):

```rust
        let payload = PersistedContract {
            address: key.address.clone(),
            tls: key.tls,
            files: FileDescriptorSet { file: contract.files.clone() }.encode_to_vec(),
            catalog: contract.catalog.clone(),
            fetched_at,
        };
```

Note the existing `put_then_reload_round_trips_pool_catalog_and_timestamp` test now
exercises the corpus path unchanged — `sample_contract()` already supplies `files`.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cargo test -p handshaker-core --lib file_contract_cache
```

Expected: PASS. The old-format entry is rejected by `read_json` (missing `files`), caught
by the existing skip-and-log arm in `load`.

- [ ] **Step 5: Commit**

```bash
git add crates/handshaker-core/src/grpc/file_contract_cache.rs
git commit -m "refactor(grpc): persist the raw descriptor corpus in the contract cache"
```

---

### Task 8: End-to-end proof against a duplicate-symbol server

`tonic-reflection` indexes symbols into a `HashMap` with last-write-wins and never
validates for duplicates, so it will happily serve a conflicting descriptor set — which is
what makes this test possible.

**Files:**
- Modify: `crates/handshaker-core/tests/common/mod.rs`
- Modify: `crates/handshaker-core/tests/contract_activate.rs`

- [ ] **Step 1: Write the failing test**

Append to `crates/handshaker-core/tests/common/mod.rs`:

```rust
/// Build a `FileDescriptorSet` shaped like a code-first .NET server: two services in two
/// files, each carrying its OWN copy of a shared DTO message name.
///
/// ```proto
/// // file: dupes/a.proto      // file: dupes/b.proto
/// package dupes;              package dupes;
/// message SharedDto {         message SharedDto {
///   string a_only = 1; }        string b_only = 1; }
/// service SvcA {              service SvcB {
///   rpc Call (SharedDto) returns (SharedDto); }
/// ```
pub fn fixture_duplicate_symbol_set_bytes() -> Vec<u8> {
    let build = |file: &str, svc: &str, field: &str| FileDescriptorProto {
        name: Some(file.to_string()),
        package: Some("dupes".to_string()),
        syntax: Some("proto3".to_string()),
        message_type: vec![DescriptorProto {
            name: Some("SharedDto".to_string()),
            field: vec![FieldDescriptorProto {
                name: Some(field.to_string()),
                number: Some(1),
                r#type: Some(FieldType::String as i32),
                ..Default::default()
            }],
            ..Default::default()
        }],
        service: vec![ServiceDescriptorProto {
            name: Some(svc.to_string()),
            method: vec![MethodDescriptorProto {
                name: Some("Call".to_string()),
                input_type: Some(".dupes.SharedDto".to_string()),
                output_type: Some(".dupes.SharedDto".to_string()),
                ..Default::default()
            }],
            ..Default::default()
        }],
        ..Default::default()
    };
    let set = FileDescriptorSet {
        file: vec![
            build("dupes/a.proto", "SvcA", "a_only"),
            build("dupes/b.proto", "SvcB", "b_only"),
        ],
    };
    let mut buf = Vec::new();
    set.encode(&mut buf).expect("encode FileDescriptorSet");
    buf
}

/// Spawn a v1 reflection server hosting the duplicate-symbol fixture.
pub async fn spawn_reflection_server_v1_with_duplicate_symbol(
) -> (SocketAddr, oneshot::Sender<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let reflection = tonic_reflection::server::Builder::configure()
        .register_encoded_file_descriptor_set(&fixture_duplicate_symbol_set_bytes())
        .build_v1()
        .expect("build v1 reflection service");

    let (tx, rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        let incoming = tokio_stream::wrappers::TcpListenerStream::new(listener);
        let _ = tonic::transport::Server::builder()
            .add_service(reflection)
            .serve_with_incoming_shutdown(incoming, async {
                rx.await.ok();
            })
            .await;
    });
    (addr, tx)
}
```

Append to `crates/handshaker-core/tests/contract_activate.rs`:

```rust
#[tokio::test]
async fn activate_survives_a_duplicate_symbol_server() {
    let (addr, _shutdown) = common::spawn_reflection_server_v1_with_duplicate_symbol().await;
    let target = GrpcTarget::new(addr.to_string(), false, false).unwrap();
    let transport = Arc::new(TonicTransport::new());

    let cache = handshaker_core::grpc::InMemoryContractCache::new();
    let conn = activate(target, transport, &cache)
        .await
        .expect("a duplicate symbol must not cost the whole endpoint");

    assert!(conn.catalog.services.iter().any(|s| s.full_name == "dupes.SvcA"));
    assert!(conn.catalog.services.iter().any(|s| s.full_name == "dupes.SvcB"));

    // Each service resolves its own copy of the shared DTO.
    let a = conn.pools.for_service("dupes.SvcA").unwrap();
    let b = conn.pools.for_service("dupes.SvcB").unwrap();
    assert!(a
        .get_message_by_name("dupes.SharedDto")
        .unwrap()
        .get_field_by_name("a_only")
        .is_some());
    assert!(b
        .get_message_by_name("dupes.SharedDto")
        .unwrap()
        .get_field_by_name("b_only")
        .is_some());
}
```

- [ ] **Step 2: Run the test to verify it fails**

Stash the core fix to confirm the test actually reproduces the bug:

```bash
cargo test -p handshaker-core activate_survives_a_duplicate_symbol_server
```

Expected: PASS with the fix in place. To prove the test has teeth, temporarily change
`build_pool_set`'s stage-1 line to `return Ok(PoolSet::from_pool(build_pool(files.to_vec())?));`,
re-run, and confirm it FAILS with `pool assembly: name 'dupes.SharedDto' is already
defined in file 'dupes/a.proto'` — then revert that edit.

- [ ] **Step 3: Run the whole workspace suite**

```bash
cargo test --workspace
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add crates/handshaker-core/tests
git commit -m "test(grpc): activate survives a duplicate-symbol reflection server"
```

---

### Task 9: Gate, banners, handoff

**Files:**
- Modify: `docs/superpowers/specs/2026-07-27-per-service-descriptor-pools-design.md`
- Modify: `docs/superpowers/plans/2026-07-27-per-service-descriptor-pools.md`
- Modify: `CLAUDE.md` ("Active work")

- [ ] **Step 1: Run the full gate**

```bash
cargo test --workspace
```

```bash
pnpm lint
```

```bash
pnpm test
```

All three must be green. `pnpm lint` and `pnpm test` are required even though no IPC DTO
changed — the project rule exists because a shape change is invisible to a cargo-only gate,
and running them costs less than finding out later.

- [ ] **Step 2: Confirm `src/ipc/bindings.ts` is untouched**

```bash
git status --short src/ipc/bindings.ts
```

Expected: empty output. If it shows as modified, an IPC DTO changed after all — regenerate
with `cargo run -p handshaker --bin export-bindings --features export-bindings --quiet` and
commit the result.

- [ ] **Step 3: Hand off the live check**

The reporting .NET endpoint is not reachable from the agent. Ask the user to run:

```bash
pnpm tauri:dev
```

and confirm that connecting to the endpoint now lists the services and that clicking a
method loads its request skeleton. Do not mark the feature done before this passes.

- [ ] **Step 4: Mark the banners and archive**

After the live check passes: set the spec's status line to `🎉 DONE`, add a matching
banner at the top of this plan, then `git mv` both into their `archive/` directories and
refresh the "Active work" section of `CLAUDE.md` per
`.claude/rules/archiving-completed-work.md`.

```bash
git mv docs/superpowers/specs/2026-07-27-per-service-descriptor-pools-design.md docs/superpowers/specs/archive/
git mv docs/superpowers/plans/2026-07-27-per-service-descriptor-pools.md docs/superpowers/plans/archive/
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs(archive): per-service descriptor pools plan+spec"
```

- [ ] **Step 6: Squash and merge**

Per `.claude/rules/squashing-feature-branches.md`, squash the implementation commits into
one `feat(grpc): per-service descriptor pools` commit (the `docs(archive)` commit stays
separate), rebase onto the current `main`, and fast-forward.
