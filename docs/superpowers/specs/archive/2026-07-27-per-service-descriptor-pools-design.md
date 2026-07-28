# Per-service descriptor pools — design

**Status:** 🎉 DONE — shipped, gate green, live pass against the reporting .NET endpoint
confirmed by the user. This document was reconciled against the shipped code before
archiving; where the implementation deviated from the original design, the design text was
corrected, not the code.
**Date:** 2026-07-27
**Scope:** `crates/handshaker-core/src/grpc` + 4 call sites in `src-tauri`. No IPC/DTO
change, no frontend change.

## 1. Problem

Activating a connection fails outright on servers whose reflection response defines the
same fully-qualified symbol in two different descriptor files:

```
pool assembly: name 'AttorneyLetterStateDto' is already defined in file '...'
```

The user hits this against a .NET server. Code-first stacks (protobuf-net.Grpc and
friends) synthesize one `.proto` file per service and embed a copy of every shared DTO
into each of them, so the same message name legitimately arrives from several files.

Today `activate()` funnels every file from every service into a single
`DescriptorPool`:

- `contract.rs:39-40` — `list_and_fetch_files()` returns one flat `Vec<FileDescriptorProto>`,
  `build_pool()` adds all of them in one `add_file_descriptor_protos` call.
- `prost-reflect` 0.14 deduplicates by **file name** only (`reflection/algorithm.rs:94`
  does the same upstream), so two distinct file names carrying the same symbol are a
  `DuplicateName` error.
- `DescriptorPool::build_files` **rolls the whole pool back** on any error. One bad
  symbol therefore costs the user every service on the endpoint, not just the affected
  one.

grpcurl and other reflection clients survive this because they never assemble a single
whole-server pool; they resolve descriptors per symbol.

## 2. Goals / non-goals

**Goals**

- A conflicting symbol costs at most the services that genuinely cannot be assembled —
  never the whole endpoint.
- Healthy servers keep today's behaviour bit for bit: one pool build, one pool, the same
  catalog. The only added cost is one copy of the raw corpus held per cached endpoint
  (see §5) — behind an `Arc`, so it is shared rather than cloned on every cache hit.
- Where two services declare same-named but structurally *different* messages, each
  service resolves against **its own** copy.

**Non-goals**

- Fixing the server. The descriptors are malformed by protoc's rules; we tolerate them.
- Surfacing per-service diagnostics in the UI. Failures are logged in core; the IPC
  surface is untouched.
- Streaming/Send-spine behaviour. Nothing on the invoke path changes beyond how a
  service's pool is looked up.

## 3. Approach

Replace the single `DescriptorPool` on the connection with a `PoolSet` — a small set of
pools plus a service-name index. `build_pool_set` fills it in three stages, each reached
only when the previous one fails:

**Stage 1 — single pool (fast path).** `build_pool(all files)`. On success the `PoolSet`
holds exactly one pool and every service points at it. Healthy servers never leave this
stage, so there is no regression in memory, cache size, or build time.

**Stage 2 — per-service isolation.** Index the corpus by file name. For every file that
declares at least one service, compute the transitive closure over `dependency` and build
that closure its own pool. This is pure local arithmetic over descriptors already
fetched — no additional reflection round-trips. Cross-service duplicates (the
`AttorneyLetterStateDto` case) disappear here, because the two copies now live in
different pools.

Service-declaring files are visited in **file-name order**, and each closure is emitted
root-first with the remainder sorted by file name. Both orderings are load-bearing:
the corpus reaches `build_pool_set` in whatever order the reflection crawl produced
(a `HashMap` drain, reseeded per process), so without them "the first definition wins"
would pick a different winner on every launch and the contract cache would freeze
whichever won that run.

A service that `list_services` reported but whose declaring file never arrived has no
closure to build and is absent from the catalog — the same outcome as today.

**Stage 3 — symbol pruning.** Only for a service whose own closure is self-conflicting.
Walk the closure collecting declared fully-qualified **top-level** names (messages,
enums, extensions, services). When a name repeats, drop the later definition and add the
owning file to the later file's `dependency` list, then rebuild. The service survives
with the first definition winning.

Only top-level names are compared: a nested type is reachable only through its parent, so
dropping the parent takes its nested types with it and a separate recursive walk would
buy nothing. Names are qualified by the file's `package`, so `pkg_a.Foo` and `pkg_b.Foo`
are distinct and both survive.

### Why isolation before pruning

Pruning picks one copy and points every reference at it. If two services declare
same-named but structurally different messages, a global prune would silently hand one
service the other's schema — a wrong-schema bug that looks like a working connection.
Isolation is lossless: each service keeps the copy its own descriptors declared. Pruning
is the lossy last resort, applied only inside a closure that has nowhere else to go.

### Detecting duplicates

Stage 3 finds duplicates by walking the corpus itself, not by parsing prost-reflect's
error text. The stage 1 → 2 transition triggers on **any** build error, so no error
introspection is needed there either.

### Rejected alternatives

*Global symbol dedup with a single pool* — keeps `DescriptorPool` on the connection and
changes no types, but rewrites third-party descriptors for every server and carries the
wrong-schema risk above. Rejected.

*Always per-service pools, no fast path* — uniform code, but every server pays N copies
of `google/protobuf/*` in memory and on disk. Rejected as a cost imposed on the healthy
majority to serve a broken minority.

## 4. Components

New in `crates/handshaker-core/src/grpc/descriptor.rs`:

```rust
pub struct PoolSet {
    pools: Vec<DescriptorPool>,
    by_service: HashMap<String, usize>,
}

impl PoolSet {
    pub fn from_pool(pool: DescriptorPool) -> Self;   // wrap one assembled pool
    pub fn for_service(&self, full_name: &str) -> Option<&DescriptorPool>;
    pub fn pools(&self) -> impl Iterator<Item = &DescriptorPool>;
    pub fn pool_count(&self) -> usize;   // observability + fast-path assertions in tests
}

pub fn build_pool_set(files: &[FileDescriptorProto]) -> Result<PoolSet, CoreError>;
```

`build_pool_set` borrows the corpus because the caller keeps it (it is what gets cached
and persisted) and because stages 2 and 3 re-read it per service. `build_pool` stays as
the stage-1 building block, but is narrowed to `pub(crate)` — after this change it has no
caller outside `descriptor.rs`. Private helpers: `service_closure(index, root) ->
Vec<FileDescriptorProto>` and `prune_duplicate_symbols(closure) ->
Vec<FileDescriptorProto>`.

The service index is populated first-wins, which must agree with `build_catalog`'s
keep-first `dedup_by` — otherwise the catalog would advertise one copy of a service while
`for_service` handed `invoke` another.

Changed:

| File | Change |
|---|---|
| `grpc/catalog/build.rs` | `build_catalog(&PoolSet)` — iterate every pool, collect services, stable sort by `full_name`, `dedup_by` keeping the first, methods keep proto order |
| `grpc/connection.rs:88` | `pub pool: DescriptorPool` → `pub pools: PoolSet` |
| `grpc/contract.rs:43` | `build_pool(files)` → `build_pool_set(&files)`; the raw corpus then moves into the cache entry alongside the `PoolSet` |
| `grpc/invoke/mod.rs:75` | `build_request_skeleton_from_pool(&DescriptorPool, …)` → `build_request_skeleton_from_pools(&PoolSet, …)`; body resolves `pools.for_service(service).and_then(\|p\| p.get_service_by_name(service))`, one `ok_or_else` for both misses |
| `grpc/invoke/mod.rs:117` | `invoke_unary` resolves the service through `connection.pools.for_service(...)` |
| `grpc/invoke/schema.rs:80` | same rename/lookup for `build_message_schema_from_pool` |
| `src-tauri/src/commands/grpc.rs:129,135,159,167` | `&cached.pool` / `&conn.pool` → `&cached.pools` / `&conn.pools` |

No `#[tauri::command]` signature or `*Ipc` DTO changes, and no frontend source file
changes. `src/ipc/bindings.ts` is still regenerated, though: two command doc comments
changed ("the pool" → "the pools" / "the pool set"), and specta exports Rust doc comments
as JSDoc. The diff is those two lines and nothing else — no shape change, so the TS
fixtures are unaffected.

## 5. Cache

`CachedContract { pool, catalog, fetched_at }` becomes
`{ files: Arc<Vec<FileDescriptorProto>>, pools: PoolSet, catalog, fetched_at }`. The
corpus is held alongside the pools rather than reconstructed from them — one extra copy
per cached endpoint, accepted to keep persistence exact (see below).

The `Arc` is not incidental. `Sender::send` calls `activate()` per request, and a cache
hit clones the whole `CachedContract` and then uses only `pools` and `catalog`. Before
this change that clone was `Arc`-cheap (`DescriptorPool` is `Arc`-backed); a bare `Vec`
would have made it a deep prost clone proportional to descriptor bytes on every send —
worst on exactly the bloated code-first corpora this change exists to support.

On disk, `PersistedContract.pool: Vec<u8>` becomes `files: Vec<u8>`
(`file_contract_cache.rs:37`) — still `FileDescriptorSet` bytes, but the **raw corpus as
fetched**, not a projection of the assembled pools. Loading re-runs `build_pool_set`.

Persisting raw rather than post-prune keeps restoration deterministic: a pruned file
can differ between the pools it landed in, so a pool-derived snapshot would have no
single well-defined form for that file name.

Old cache entries fail to deserialize under the renamed field. `read_entry` returns the
error and `load` logs and skips that file, so the endpoint re-reflects and the next `put`
overwrites the stale entry under the same deterministic filename. There is no quarantine
path here — `read_entry` uses `read_json`, not `read_json_or_recover`, so a rejected entry
never becomes a defaulted one. No migration step; the cache is disposable by contract, and
`schema_version` is deliberately **not** bumped — it is a single global constant shared
with the user-facing export bundle, so bumping it for a cache-only change would make older
builds reject collection imports.

## 6. Error handling

Fatal, as `CoreError::DescriptorBuild`:

- empty file list from the server (unchanged from today);
- **no** service could be assembled. The message names the **stage-1** cause — the reason
  the corpus could not be held in one pool — because reaching stage 2 at all proves stage 1
  failed, and that cause is the single most diagnostic fact about the endpoint. It is
  prost-reflect's own text, passed through verbatim (`name 'X' is already defined in file
  'Y'` — one file, not both). Composing a richer message from our own corpus walk was
  considered and dropped: the per-service causes already reach stderr, one line each.

`build_pool`'s internal `pool assembly: ` label is deliberately **not** applied, because
`thiserror`'s own `descriptor build failed: ` prefix is stripped at the IPC boundary
(`IpcError::DescriptorBuild` carries only the payload) and the frontend renders that
payload raw. The composed sentence therefore *is* the entire user-facing text, and an
internal stage label sitting mid-sentence would leak into it.

Non-fatal: a single service failing all three stages is excluded from the catalog and
logged with `eprintln!`, matching the rest of core (`tracing` is not a dependency and is
not being added for this). Note the consequence: such a service now disappears from the
catalog silently, where before it took the whole activation down loudly. That is the
intended trade — see the non-goals — but it is a behaviour change, and in a release
Windows build (`windows_subsystem = "windows"`) stderr is detached, so the log is
unreachable. Surfacing degradation in the UI stays out of scope; it would need an IPC
surface this change is explicitly avoiding.

The residual failure mode is a service whose descriptors are unfixable locally — for
instance a dangling `import` of a file the server never returned. Today such a server
fails activation entirely; after this change it costs that one service.

## 7. Testing

Unit, `descriptor.rs`:

1. healthy corpus → `pool_count() == 1` (guards the fast path against silent regression);
2. two services in two files declaring the same message name with **different fields** →
   two pools, both services resolve, and each resolves to its own copy (assert on the
   fields, not merely on the absence of an error);
3. duplicate inside one service's own closure → pruning applies, the service is present;
4. dangling import on one service → that service is dropped, the others survive;
5. empty input → error, unchanged.

Beyond the list above, the shipped suite also pins the rules that make the stages
deterministic — each was added because a deliberate one-line mutation survived without it:
the closure's root-first ordering, package-qualified name comparison in the prune, the
`enum_type` / `extension` / `service` retains, the `dependency`-on-the-winner append, and
the exact empty-corpus message.

Unit, elsewhere: `catalog/build.rs` merges a multi-pool set built through the real
`build_pool_set` (services sorted, deduped keeping the first, methods in proto order);
`file_contract_cache.rs` round-trips a conflicting corpus and skips an old-format entry;
`invoke` skeleton/schema resolve through `for_service`.

Integration: `tests/contract_activate.rs` and `tests/contract_cache.rs` follow the new
signatures, plus two tests that exercise the whole spine against a live
`tonic-reflection` server serving a conflicting descriptor set — one asserting `activate`
survives it and each service resolves its own copy of the shared DTO, one asserting the
disk cache written by `activate` survives a restart. A third pins that a request skeleton
built through `for_service` names the right service's fields on a multi-pool set; without
it, replacing `for_service` with "just take the first pool" passes the entire unit suite.

Gate before fast-forward: `cargo test --workspace` + `pnpm lint` + `pnpm test`.

A live pass against the reporting .NET endpoint via `pnpm tauri:dev` is required before
merge and can only be run by the user — the endpoint is not reachable from the agent.
