# Plan 03 — Pure front-end functions (mapping / grouping / sort+filter)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** ✅ done (`7b1b885..2903c8a`). 267/267 front-end tests green; the three new
modules are type-clean. NB: `pnpm lint` (`tsc -b`) still reports **15 pre-existing** errors
in dead legacy code (`src/features/collections/**`, `src/ipc/client.ts`) — plan-01 schema
fallout (`auth_by_env`/old metadata), unchanged by plan-03 and removed in plan-09. Verified
identical count (15) at `f47ee4f`, the pre-plan-03 tip, with 0 errors in `features/catalog`.
**Branch:** `redesign/workflow-ui-spec-plans`
**Phase:** 2 of spec §16 (`docs/superpowers/specs/2026-06-05-service-collection-sidebar-refactor-design.md`).
**Predecessors:** plan-01 (`cadaccd..625241b`), plan-02 (`41d29bf..0a33cae`) — both ✅ done.
The IPC types these functions consume (`SavedRequestIpc`, `CollectionIpc`, `FolderIpc`,
`ItemIpc`, `MetadataRowIpc`, `SavedAuthConfigIpc`) already exist in `src/ipc/bindings.ts`.

**Goal:** Add four pure, side-effect-free front-end modules under `src/features/catalog/`
that the sidebar, Save-dialog and ⌘K will compose later: step↔savedRequest mapping,
Save-path suggestion + existing-location lookup, and collection usage-aggregation +
sort + filter. No React, no IPC calls, no store — just functions over the existing types.

**Architecture:** Each module is one file with one responsibility, tested with Vitest
co-located as `*.test.ts`. Functions consume the generated IPC DTOs and the existing
workflow `Step` type, returning new values (immutable). No new shared types are
introduced except small local result interfaces exported from each module.

**Tech Stack:** TypeScript, Vitest, `@/` path alias (= `src/`).

## Build / test commands (repo root, PowerShell)

- Single test file: `pnpm test src/features/catalog/<file>.test.ts`
- All front-end tests: `pnpm test`
- Typecheck: `pnpm lint` (`tsc -b`)

## File structure (boundaries)

All new, under `src/features/catalog/` (the repurposed catalog feature; old model files
are deleted later in plan-09):

- `mapping.ts` + `mapping.test.ts` — `stepToSavedRequest` / `savedRequestToDraft`.
  "Draft" in the redesign = a `Step` with `status: "draft"` (the global pending-draft
  container is wired in plan-04); these functions therefore map **`Step` ↔ `SavedRequestIpc`**.
- `grouping.ts` + `grouping.test.ts` — `suggestSavePath` (Host > Service) and
  `findSavedLocations` (where a given method is already saved). Feeds the Save-dialog hint.
- `sort.ts` + `sort.test.ts` — collection-list presentation: `aggregateUsage`,
  `sortCollections` (alpha/created/recent/frequency, pinned-on-top) and `filterCollections`
  (name + service/method/address). Cohesive: "given collections + view options → ordered/
  filtered collections for the sidebar". (Filter lives here rather than a separate file to
  keep the index's locked catalog-file boundary; responsibility note above documents it.)

### Sequencing seam with plan-04 (auth on `Step`)

The current `Step` (`src/features/workflow/model.ts`) has **no inline `auth` field** — that
is introduced in plan-04 (phase 3), which also drops `serviceId`. Therefore in this plan:

- `stepToSavedRequest` emits `auth: { kind: "none" }` (auth is not yet on `Step`).
- `savedRequestToDraft` **drops** the saved request's `auth` (the draft `Step` cannot hold
  it yet) and sets `serviceId: null`.

**Follow-up (plan-04):** once `Step.auth: SavedAuthConfigIpc` exists, extend
`stepToSavedRequest` to copy `step.auth` and `savedRequestToDraft` to set it on the draft,
and add the corresponding round-trip auth assertions. This is called out again at the end
of this plan.

---

### Task 1: `mapping.ts` — `stepToSavedRequest`

**Files:**
- Create: `src/features/catalog/mapping.ts`
- Test: `src/features/catalog/mapping.test.ts`

Reference types: `Step`/`MetadataRow` from `src/features/workflow/model.ts:7-26`;
`SavedRequestIpc` = `{ id; name; address_template; service; method; body_template;
metadata: MetadataRowIpc[]; auth: SavedAuthConfigIpc; tls_override: boolean | null;
last_used_at: number | null; use_count: number }` (`src/ipc/bindings.ts:291`).
Both `MetadataRow` (workflow) and `MetadataRowIpc` are `{ key; value; enabled }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/catalog/mapping.test.ts
import { describe, it, expect } from "vitest";
import { stepToSavedRequest } from "./mapping";
import { newStep, type Step } from "@/features/workflow/model";

function step(over: Partial<Step> = {}): Step {
  return {
    ...newStep({ address: "localhost:5002", tls: false, service: "pkg.v1.Svc", method: "GetX" }),
    ...over,
  };
}

describe("stepToSavedRequest", () => {
  it("maps step fields onto a SavedRequestIpc with the given id and name", () => {
    const s = step({
      address: "{{host}}:443",
      tls: true,
      service: "pkg.v1.Svc",
      method: "GetX",
      requestJson: '{"id":"1"}',
      metadata: [{ key: "x-tenant", value: "acme", enabled: true }],
    });
    const saved = stepToSavedRequest(s, { id: "req-1", name: "GetX" });
    expect(saved).toEqual({
      id: "req-1",
      name: "GetX",
      address_template: "{{host}}:443",
      service: "pkg.v1.Svc",
      method: "GetX",
      body_template: '{"id":"1"}',
      metadata: [{ key: "x-tenant", value: "acme", enabled: true }],
      auth: { kind: "none" },
      tls_override: true,
      last_used_at: null,
      use_count: 0,
    });
  });

  it("copies metadata rows into a fresh array (no aliasing)", () => {
    const s = step({ metadata: [{ key: "a", value: "b", enabled: false }] });
    const saved = stepToSavedRequest(s, { id: "r", name: "n" });
    expect(saved.metadata).not.toBe(s.metadata);
    expect(saved.metadata).toEqual([{ key: "a", value: "b", enabled: false }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/catalog/mapping.test.ts`
Expected: FAIL — `stepToSavedRequest` is not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/features/catalog/mapping.ts
import type { SavedRequestIpc } from "@/ipc/bindings";
import type { Step } from "@/features/workflow/model";

/**
 * Build a `SavedRequestIpc` from an editor/executed `Step`.
 * Auth is emitted as `none` until `Step` carries inline auth (plan-04 follow-up).
 */
export function stepToSavedRequest(step: Step, opts: { id: string; name: string }): SavedRequestIpc {
  return {
    id: opts.id,
    name: opts.name,
    address_template: step.address,
    service: step.service,
    method: step.method,
    body_template: step.requestJson,
    metadata: step.metadata.map((r) => ({ key: r.key, value: r.value, enabled: r.enabled })),
    auth: { kind: "none" },
    tls_override: step.tls,
    last_used_at: null,
    use_count: 0,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/catalog/mapping.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/mapping.ts src/features/catalog/mapping.test.ts
git commit -m "feat(catalog): stepToSavedRequest pure mapping (plan-03)"
```

---

### Task 2: `mapping.ts` — `savedRequestToDraft` + round-trip

**Files:**
- Modify: `src/features/catalog/mapping.ts`
- Test: `src/features/catalog/mapping.test.ts`

`newStep` (`src/features/workflow/model.ts:37`) returns a `Step` with a fresh random `id`,
`status: "draft"`, `serviceId: null`, `outcome/error/requestId: null`. Tests must **not**
assert the generated `id`.

- [ ] **Step 1: Write the failing test** (append to `mapping.test.ts`)

```ts
import { savedRequestToDraft } from "./mapping";
import type { SavedRequestIpc } from "@/ipc/bindings";

function saved(over: Partial<SavedRequestIpc> = {}): SavedRequestIpc {
  return {
    id: "req-1",
    name: "GetX",
    address_template: "localhost:5002",
    service: "pkg.v1.Svc",
    method: "GetX",
    body_template: "{}",
    metadata: [],
    auth: { kind: "none" },
    tls_override: null,
    last_used_at: null,
    use_count: 0,
    ...over,
  };
}

describe("savedRequestToDraft", () => {
  it("produces a draft-status Step carrying the saved request's call fields", () => {
    const draft = savedRequestToDraft(
      saved({
        address_template: "{{host}}:443",
        tls_override: true,
        body_template: '{"id":"1"}',
        metadata: [{ key: "x", value: "y", enabled: true }],
      }),
    );
    expect(draft.status).toBe("draft");
    expect(draft.serviceId).toBeNull();
    expect(draft.address).toBe("{{host}}:443");
    expect(draft.tls).toBe(true);
    expect(draft.service).toBe("pkg.v1.Svc");
    expect(draft.method).toBe("GetX");
    expect(draft.requestJson).toBe('{"id":"1"}');
    expect(draft.metadata).toEqual([{ key: "x", value: "y", enabled: true }]);
  });

  it("treats a null tls_override as plaintext (false)", () => {
    expect(savedRequestToDraft(saved({ tls_override: null })).tls).toBe(false);
  });

  it("round-trips the call fields step -> saved -> draft (auth/id aside)", () => {
    const original = step({
      address: "api:443",
      tls: true,
      service: "pkg.v1.Svc",
      method: "Ping",
      requestJson: '{"n":1}',
      metadata: [{ key: "k", value: "v", enabled: false }],
    });
    const draft = savedRequestToDraft(stepToSavedRequest(original, { id: "x", name: "Ping" }));
    expect(draft.address).toBe(original.address);
    expect(draft.tls).toBe(original.tls);
    expect(draft.service).toBe(original.service);
    expect(draft.method).toBe(original.method);
    expect(draft.requestJson).toBe(original.requestJson);
    expect(draft.metadata).toEqual(original.metadata);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/catalog/mapping.test.ts`
Expected: FAIL — `savedRequestToDraft` is not exported.

- [ ] **Step 3: Write minimal implementation** (append to `mapping.ts`)

```ts
import { newStep, type Step } from "@/features/workflow/model";

/**
 * Populate a fresh draft `Step` (status "draft") from a saved request.
 * Drops the saved `auth` (the draft cannot hold inline auth until plan-04).
 */
export function savedRequestToDraft(saved: SavedRequestIpc): Step {
  return newStep({
    address: saved.address_template,
    tls: saved.tls_override ?? false,
    service: saved.service,
    method: saved.method,
    requestJson: saved.body_template,
    metadata: saved.metadata.map((r) => ({ key: r.key, value: r.value, enabled: r.enabled })),
  });
}
```

Note: change the Task-1 `import type { Step }` line to the combined
`import { newStep, type Step } from "@/features/workflow/model";` (single import).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/catalog/mapping.test.ts`
Expected: PASS (5 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/mapping.ts src/features/catalog/mapping.test.ts
git commit -m "feat(catalog): savedRequestToDraft + step round-trip (plan-03)"
```

---

### Task 3: `grouping.ts` — `suggestSavePath`

**Files:**
- Create: `src/features/catalog/grouping.ts`
- Test: `src/features/catalog/grouping.test.ts`

Spec §6: Save-dialog suggests a `Host > Service` path. Host = address with any trailing
`:port` stripped (templates like `{{host}}:443` keep `{{host}}`). Service = last
dot-segment of the full service name (`pkg.v1.PaymentService` → `PaymentService`). Empty
segments are dropped.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/catalog/grouping.test.ts
import { describe, it, expect } from "vitest";
import { suggestSavePath } from "./grouping";

describe("suggestSavePath", () => {
  it("returns [host, ServiceShortName]", () => {
    expect(suggestSavePath("localhost:5002", "payments.v1.PaymentService")).toEqual([
      "localhost",
      "PaymentService",
    ]);
  });

  it("keeps a templated host and strips the port", () => {
    expect(suggestSavePath("{{host}}:443", "Echo")).toEqual(["{{host}}", "Echo"]);
  });

  it("handles an address with no port", () => {
    expect(suggestSavePath("api.example.com", "pkg.Svc")).toEqual(["api.example.com", "Svc"]);
  });

  it("drops empty segments", () => {
    expect(suggestSavePath("", "")).toEqual([]);
    expect(suggestSavePath("localhost:1", "")).toEqual(["localhost"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/catalog/grouping.test.ts`
Expected: FAIL — `suggestSavePath` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/features/catalog/grouping.ts

/** Strip a trailing `:<digits>` port from an address; templates are preserved. */
function hostOf(address: string): string {
  const m = address.match(/^(.*):\d+$/);
  return (m ? m[1] : address).trim();
}

/** Last dot-segment of a full service name. */
function serviceShortName(service: string): string {
  const parts = service.split(".");
  return (parts[parts.length - 1] ?? "").trim();
}

/** Suggested `Host > Service` folder path for the Save dialog. */
export function suggestSavePath(address: string, service: string): string[] {
  return [hostOf(address), serviceShortName(service)].filter((s) => s.length > 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/catalog/grouping.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/grouping.ts src/features/catalog/grouping.test.ts
git commit -m "feat(catalog): suggestSavePath Host>Service hint (plan-03)"
```

---

### Task 4: `grouping.ts` — `findSavedLocations`

**Files:**
- Modify: `src/features/catalog/grouping.ts`
- Test: `src/features/catalog/grouping.test.ts`

Spec §6: the dialog also hints "where this method is already saved". Walk every collection's
item tree; a request matches when `service`, `method` **and** `address_template` all equal
the query. Return each match's location (collection + folder-name path + request id/name).

Types: `CollectionIpc` (`src/ipc/bindings.ts:258`), `ItemIpc` =
`({ type:"folder" } & FolderIpc) | ({ type:"request" } & SavedRequestIpc)` (`:282`),
`FolderIpc = { id; name; items: ItemIpc[] }` (`:272`).

- [ ] **Step 1: Write the failing test** (append to `grouping.test.ts`)

```ts
import { findSavedLocations } from "./grouping";
import type { CollectionIpc, ItemIpc, SavedRequestIpc } from "@/ipc/bindings";

function req(over: Partial<SavedRequestIpc> = {}): ItemIpc {
  return {
    type: "request",
    id: "r",
    name: "GetX",
    address_template: "localhost:5002",
    service: "pkg.v1.Svc",
    method: "GetX",
    body_template: "{}",
    metadata: [],
    auth: { kind: "none" },
    tls_override: null,
    last_used_at: null,
    use_count: 0,
    ...over,
  };
}

function folder(name: string, items: ItemIpc[], id = name): ItemIpc {
  return { type: "folder", id, name, items };
}

function col(over: Partial<CollectionIpc> = {}): CollectionIpc {
  return {
    id: "c",
    name: "C",
    items: [],
    variables: {},
    auth: { kind: "none" },
    default_tls: false,
    skip_tls_verify: false,
    pinned: false,
    description: null,
    created_at: 0,
    ...over,
  };
}

describe("findSavedLocations", () => {
  const match = { service: "pkg.v1.Svc", method: "GetX", address: "localhost:5002" };

  it("finds a nested request matching service+method+address and reports its folder path", () => {
    const target = req({ id: "r1", name: "saved-getx" });
    const collections = [
      col({
        id: "c1",
        name: "Payments",
        items: [folder("Host", [folder("Svc", [target])])],
      }),
    ];
    expect(findSavedLocations(collections, match)).toEqual([
      {
        collectionId: "c1",
        collectionName: "Payments",
        folderPath: ["Host", "Svc"],
        requestId: "r1",
        requestName: "saved-getx",
      },
    ]);
  });

  it("ignores requests that differ in any of service/method/address", () => {
    const collections = [
      col({
        items: [
          req({ id: "a", method: "Other" }),
          req({ id: "b", address_template: "other:1" }),
          req({ id: "c", service: "pkg.v1.Other" }),
        ],
      }),
    ];
    expect(findSavedLocations(collections, match)).toEqual([]);
  });

  it("reports a top-level request with an empty folder path", () => {
    const collections = [col({ id: "c2", name: "Root", items: [req({ id: "r2" })] })];
    expect(findSavedLocations(collections, match)).toEqual([
      {
        collectionId: "c2",
        collectionName: "Root",
        folderPath: [],
        requestId: "r2",
        requestName: "GetX",
      },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/catalog/grouping.test.ts`
Expected: FAIL — `findSavedLocations` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `grouping.ts`)

```ts
import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";

export interface SaveLocation {
  collectionId: string;
  collectionName: string;
  folderPath: string[]; // folder names from collection root to the request's parent
  requestId: string;
  requestName: string;
}

export interface SavedRequestMatch {
  service: string;
  method: string;
  address: string;
}

function collect(
  items: ItemIpc[],
  path: string[],
  match: SavedRequestMatch,
  collection: CollectionIpc,
  out: SaveLocation[],
): void {
  for (const it of items) {
    if (it.type === "folder") {
      collect(it.items, [...path, it.name], match, collection, out);
    } else if (
      it.service === match.service &&
      it.method === match.method &&
      it.address_template === match.address
    ) {
      out.push({
        collectionId: collection.id,
        collectionName: collection.name,
        folderPath: path,
        requestId: it.id,
        requestName: it.name,
      });
    }
  }
}

/** All saved requests across every collection whose call target equals `match`. */
export function findSavedLocations(
  collections: CollectionIpc[],
  match: SavedRequestMatch,
): SaveLocation[] {
  const out: SaveLocation[] = [];
  for (const c of collections) collect(c.items, [], match, c, out);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/catalog/grouping.test.ts`
Expected: PASS (7 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/grouping.ts src/features/catalog/grouping.test.ts
git commit -m "feat(catalog): findSavedLocations across collections (plan-03)"
```

---

### Task 5: `sort.ts` — `aggregateUsage`

**Files:**
- Create: `src/features/catalog/sort.ts`
- Test: `src/features/catalog/sort.test.ts`

Spec §5: "recent" = `max(last_used_at)` over descendant requests (null if none used);
"frequency" = `sum(use_count)` over descendant requests. Pure aggregation, no per-collection
counters.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/catalog/sort.test.ts
import { describe, it, expect } from "vitest";
import { aggregateUsage } from "./sort";
import type { CollectionIpc, ItemIpc, SavedRequestIpc } from "@/ipc/bindings";

function req(over: Partial<SavedRequestIpc> = {}): ItemIpc {
  return {
    type: "request",
    id: "r",
    name: "n",
    address_template: "a:1",
    service: "s",
    method: "m",
    body_template: "{}",
    metadata: [],
    auth: { kind: "none" },
    tls_override: null,
    last_used_at: null,
    use_count: 0,
    ...over,
  };
}

function folder(items: ItemIpc[]): ItemIpc {
  return { type: "folder", id: "f", name: "f", items };
}

function col(over: Partial<CollectionIpc> = {}): CollectionIpc {
  return {
    id: "c",
    name: "C",
    items: [],
    variables: {},
    auth: { kind: "none" },
    default_tls: false,
    skip_tls_verify: false,
    pinned: false,
    description: null,
    created_at: 0,
    ...over,
  };
}

describe("aggregateUsage", () => {
  it("sums use_count and takes the max last_used_at across nested requests", () => {
    const c = col({
      items: [
        req({ use_count: 2, last_used_at: 100 }),
        folder([req({ use_count: 3, last_used_at: 200 }), req({ use_count: 1, last_used_at: null })]),
      ],
    });
    expect(aggregateUsage(c)).toEqual({ lastUsedAt: 200, useCount: 6 });
  });

  it("reports null lastUsedAt and 0 useCount for an unused/empty collection", () => {
    expect(aggregateUsage(col())).toEqual({ lastUsedAt: null, useCount: 0 });
    expect(aggregateUsage(col({ items: [req()] }))).toEqual({ lastUsedAt: null, useCount: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/catalog/sort.test.ts`
Expected: FAIL — `aggregateUsage` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/features/catalog/sort.ts
import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";

export interface CollectionUsage {
  lastUsedAt: number | null; // max over descendant requests, null if none used
  useCount: number; // sum over descendant requests
}

function walk(items: ItemIpc[], acc: { last: number | null; count: number }): void {
  for (const it of items) {
    if (it.type === "folder") {
      walk(it.items, acc);
    } else {
      acc.count += it.use_count;
      if (it.last_used_at != null) {
        acc.last = acc.last == null ? it.last_used_at : Math.max(acc.last, it.last_used_at);
      }
    }
  }
}

/** Aggregate descendant-request usage for collection-level sorting. */
export function aggregateUsage(collection: CollectionIpc): CollectionUsage {
  const acc = { last: null as number | null, count: 0 };
  walk(collection.items, acc);
  return { lastUsedAt: acc.last, useCount: acc.count };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/catalog/sort.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/sort.ts src/features/catalog/sort.test.ts
git commit -m "feat(catalog): aggregateUsage for collection sorting (plan-03)"
```

---

### Task 6: `sort.ts` — `sortCollections`

**Files:**
- Modify: `src/features/catalog/sort.ts`
- Test: `src/features/catalog/sort.test.ts`

Spec §5: one global sort key — `alpha` (A→Z), `created` (newest `created_at` first),
`recent` (newest aggregated `last_used_at` first, unused last), `frequency` (highest summed
`use_count` first). **Pinned collections always float above unpinned**, sorted by the same
key within each group. Sort is pure (returns a new array) and stable.

- [ ] **Step 1: Write the failing test** (append to `sort.test.ts`)

```ts
import { sortCollections } from "./sort";

describe("sortCollections", () => {
  it("alpha: orders by name A->Z", () => {
    const out = sortCollections([col({ name: "B" }), col({ name: "A" }), col({ name: "C" })], "alpha");
    expect(out.map((c) => c.name)).toEqual(["A", "B", "C"]);
  });

  it("floats pinned collections above unpinned, sorted within each group", () => {
    const out = sortCollections(
      [col({ name: "A" }), col({ name: "Z", pinned: true }), col({ name: "M", pinned: true })],
      "alpha",
    );
    expect(out.map((c) => c.name)).toEqual(["M", "Z", "A"]);
  });

  it("created: newest created_at first", () => {
    const out = sortCollections(
      [col({ name: "old", created_at: 1 }), col({ name: "new", created_at: 9 })],
      "created",
    );
    expect(out.map((c) => c.name)).toEqual(["new", "old"]);
  });

  it("recent: highest aggregated last_used_at first, unused last", () => {
    const out = sortCollections(
      [
        col({ name: "stale", items: [req({ last_used_at: 5 })] }),
        col({ name: "fresh", items: [req({ last_used_at: 50 })] }),
        col({ name: "never", items: [req({ last_used_at: null })] }),
      ],
      "recent",
    );
    expect(out.map((c) => c.name)).toEqual(["fresh", "stale", "never"]);
  });

  it("frequency: highest summed use_count first", () => {
    const out = sortCollections(
      [
        col({ name: "lo", items: [req({ use_count: 1 })] }),
        col({ name: "hi", items: [req({ use_count: 9 })] }),
      ],
      "frequency",
    );
    expect(out.map((c) => c.name)).toEqual(["hi", "lo"]);
  });

  it("does not mutate the input array", () => {
    const input = [col({ name: "B" }), col({ name: "A" })];
    sortCollections(input, "alpha");
    expect(input.map((c) => c.name)).toEqual(["B", "A"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/catalog/sort.test.ts`
Expected: FAIL — `sortCollections` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `sort.ts`)

```ts
export type SortKey = "alpha" | "created" | "recent" | "frequency";

function byKey(a: CollectionIpc, b: CollectionIpc, key: SortKey): number {
  switch (key) {
    case "alpha":
      return a.name.localeCompare(b.name);
    case "created":
      return b.created_at - a.created_at; // newest first
    case "recent": {
      const al = aggregateUsage(a).lastUsedAt ?? -Infinity;
      const bl = aggregateUsage(b).lastUsedAt ?? -Infinity;
      return bl - al || a.name.localeCompare(b.name);
    }
    case "frequency": {
      const ac = aggregateUsage(a).useCount;
      const bc = aggregateUsage(b).useCount;
      return bc - ac || a.name.localeCompare(b.name);
    }
  }
}

/** Sort collections by the global key, pinned floated to the top. Pure (new array). */
export function sortCollections(collections: CollectionIpc[], key: SortKey): CollectionIpc[] {
  return [...collections].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || byKey(a, b, key),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/catalog/sort.test.ts`
Expected: PASS (8 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/sort.ts src/features/catalog/sort.test.ts
git commit -m "feat(catalog): sortCollections (alpha/created/recent/frequency, pinned-on-top) (plan-03)"
```

---

### Task 7: `sort.ts` — `filterCollections`

**Files:**
- Modify: `src/features/catalog/sort.ts`
- Test: `src/features/catalog/sort.test.ts`

Spec §5/§14: text filter over node name + request service/method/address (case-insensitive
substring). Returns a pruned tree: a request is kept when its name/service/method/address
matches; a folder/collection whose **own name** matches is kept whole (entire subtree);
otherwise a container is kept only if it has surviving descendants (non-matching branches
pruned). Empty query returns the input unchanged. Pure (no mutation of inputs).

- [ ] **Step 1: Write the failing test** (append to `sort.test.ts`)

```ts
import { filterCollections } from "./sort";

describe("filterCollections", () => {
  it("returns the input unchanged for an empty/whitespace query", () => {
    const input = [col({ name: "A" })];
    expect(filterCollections(input, "   ")).toBe(input);
  });

  it("keeps only requests matching service/method/address and prunes siblings + empty branches", () => {
    const hit = req({ id: "hit", service: "payments.v1.Pay", method: "Charge" });
    const miss = req({ id: "miss", service: "orders.v1.Ord", method: "List" });
    const out = filterCollections(
      [
        col({ id: "c1", name: "C1", items: [folder([hit, miss])] }),
        col({ id: "c2", name: "C2", items: [miss] }),
      ],
      "charge",
    );
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("c1");
    const f = out[0].items[0];
    expect(f.type).toBe("folder");
    if (f.type === "folder") {
      expect(f.items.map((i) => i.id)).toEqual(["hit"]);
    }
  });

  it("matches a request by name", () => {
    const out = filterCollections([col({ items: [req({ id: "x", name: "GetBalance" })] })], "balance");
    expect(out[0].items.map((i) => i.id)).toEqual(["x"]);
  });

  it("keeps a folder's whole subtree when the folder name matches", () => {
    const keep = folder([req({ id: "a" }), req({ id: "b" })]);
    // give the folder a matching name
    if (keep.type === "folder") keep.name = "Billing";
    const out = filterCollections([col({ items: [keep] })], "bill");
    const f = out[0].items[0];
    expect(f.type === "folder" && f.items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("keeps a whole collection when the collection name matches", () => {
    const out = filterCollections([col({ id: "c", name: "Payments", items: [req({ id: "a" })] })], "paym");
    expect(out).toHaveLength(1);
    expect(out[0].items.map((i) => i.id)).toEqual(["a"]);
  });

  it("returns [] when nothing matches", () => {
    expect(filterCollections([col({ items: [req()] })], "zzz")).toEqual([]);
  });

  it("does not mutate the input collection", () => {
    const input = [col({ id: "c", name: "C", items: [req({ id: "a" }), req({ id: "b", name: "keep" })] })];
    filterCollections(input, "keep");
    expect(input[0].items).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/catalog/sort.test.ts`
Expected: FAIL — `filterCollections` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `sort.ts`)

```ts
function nameMatches(name: string, q: string): boolean {
  return name.toLowerCase().includes(q);
}

function requestMatches(it: Extract<ItemIpc, { type: "request" }>, q: string): boolean {
  return [it.name, it.service, it.method, it.address_template].some((s) =>
    s.toLowerCase().includes(q),
  );
}

function filterItems(items: ItemIpc[], q: string): ItemIpc[] {
  const out: ItemIpc[] = [];
  for (const it of items) {
    if (it.type === "request") {
      if (requestMatches(it, q)) out.push(it);
    } else if (nameMatches(it.name, q)) {
      out.push(it); // folder name matches -> keep whole subtree
    } else {
      const kids = filterItems(it.items, q);
      if (kids.length) out.push({ ...it, items: kids });
    }
  }
  return out;
}

/** Prune the collection forest to nodes matching `query` (name/service/method/address). */
export function filterCollections(collections: CollectionIpc[], query: string): CollectionIpc[] {
  const q = query.trim().toLowerCase();
  if (!q) return collections;
  const out: CollectionIpc[] = [];
  for (const c of collections) {
    if (nameMatches(c.name, q)) {
      out.push(c); // collection name matches -> keep whole
      continue;
    }
    const items = filterItems(c.items, q);
    if (items.length) out.push({ ...c, items });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/catalog/sort.test.ts`
Expected: PASS (15 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/sort.ts src/features/catalog/sort.test.ts
git commit -m "feat(catalog): filterCollections tree prune (name/service/method/address) (plan-03)"
```

---

### Task 8: Whole-suite + typecheck gate

**Files:** none (verification only).

- [ ] **Step 1: Run the full front-end test suite**

Run: `pnpm test`
Expected: PASS — all existing tests plus the new `catalog/{mapping,grouping,sort}.test.ts`
(19 new cases) green.

- [ ] **Step 2: Typecheck**

Run: `pnpm lint`
Expected: the new `catalog/` modules contribute **zero** errors. NB `tsc -b` is repo-wide and
still surfaces 15 **pre-existing** errors in dead legacy code (`src/features/collections/**`,
`src/ipc/client.ts`) from the plan-01 schema change; these are removed in plan-09. Verify the
count is unchanged vs the pre-plan-03 tip (`f47ee4f` → 15) and that none are under
`features/catalog`.

- [ ] **Step 3: Update the plan-00 index status row**

In `docs/superpowers/plans/2026-06-05-plan-00-index.md`, change the `plan-03` row Status
from `outline` to `✅ done (<firstSha>..<lastSha>)` and flip this file's banner Status to
`✅ done`.

- [ ] **Step 4: Commit the status update**

```bash
git add docs/superpowers/plans/2026-06-05-plan-00-index.md docs/superpowers/plans/2026-06-05-plan-03-pure-functions.md
git commit -m "docs(plan-03): mark complete; update index row"
```

---

## Follow-ups (later plans, do NOT do here)

- **plan-04 (auth seam):** once `Step` gains `auth: SavedAuthConfigIpc` and drops
  `serviceId`, extend `stepToSavedRequest` to copy `step.auth` and `savedRequestToDraft` to
  set the draft's `auth`; add round-trip auth assertions to `mapping.test.ts`.
- **plan-05/06 consumers:** `useCatalogTree` / `SortControl` consume `sortCollections` +
  `filterCollections` + `aggregateUsage`; `SaveRequestDialog` consumes `suggestSavePath` +
  `findSavedLocations`; Save/⌘K consume `stepToSavedRequest` / `savedRequestToDraft`.

## Spec-coverage self-check

- §3 `step ↔ savedRequest` pure mapping → Tasks 1–2. ✅ (auth deferred per documented seam)
- §6 suggested `Host > Service` path + "where already saved" → Tasks 3–4. ✅
- §5 usage aggregation (recent=max, frequency=sum) → Task 5. ✅
- §5 global sort alpha/created/recent/frequency + pinned-on-top → Task 6. ✅
- §5/§14 filter by name + service/method/address → Task 7. ✅
- §16 phase-2 deliverables (`mapping.ts`, `grouping.ts`, usage-aggregation, sort/filter) → all. ✅
