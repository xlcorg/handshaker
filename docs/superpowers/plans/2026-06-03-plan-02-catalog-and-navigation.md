# Catalog & Navigation (Plan #2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A curated **catalog** (manually-added k8s services with session-cached reflection contracts) navigable from a **sidebar** (favorites + `service → proto-service → ● method` tree) and a **service-first ⌘K palette** (fuzzy service search → method list), so a call is created by picking a method — replacing Plan #1's temporary typed New-call inputs.

**Architecture:** Frontend-only milestone, building on Plan #1's workflow store/actions and the existing IPC (`grpcDescribe`, `grpcRefreshContract`, `grpcBuildRequestSkeleton`, `grpcInvokeOneshot`). A second session-only external store (`catalogStore`, same vanilla pub-sub + `useSyncExternalStore` pattern as `workflowStore` — the repo has **no Zustand**) holds one in-memory `Collection` of `CatalogService`s. Pure, unit-tested logic modules (`tree.ts` merge curated ↔ contract, `fuzzy.ts` rank) back the UI. The bridge action `openCallFromMethod` reuses Plan #1's `createStepFromMethod` + reducers to drop a step into the active workflow and switch it to Focus.

**Tech Stack:** React 18 + TypeScript (strict) + Tailwind/shadcn-ui (existing primitives only — no new deps; ⌘K + fuzzy hand-written) + Vitest + React Testing Library (already configured in Plan #1).

> **✅ EXECUTION STATUS — PLAN #2 COMPLETE (2026-06-04, subagent-driven):** All tasks 1–11
> implemented, committed, and two-stage-reviewed (spec + quality) on branch
> `redesign/workflow-ui-spec-plans`. A final whole-implementation review (opus) returned
> **ready to merge, no critical/important defects.**
>
> **Phase A (Tasks 1–5):** `model.ts` `6573c9d` · `tree.ts` `8c2f52a` · `fuzzy.ts` `9bd3056` ·
> `store.ts` `9d4ccb3` · `actions.ts` `b510fe6`.
> **Phase B (Tasks 6–11):**
> - Task 6 `AddServiceForm.tsx` → `147f860`
> - Task 7 `Sidebar.tsx`(+test) → `ed4bae6`
> - Task 8 `ServicePanel.tsx`(+test) → `5db4965`, review-fix (describe cancellation + auto-describe test) `82ef6d1`
> - Task 9 `CommandPalette.tsx`(+test) → `3f759eb`, review-fix (swallow describe rejection) `b49c650`
> - Task 10 `WorkflowApp.tsx` rewire + temp New-call entry removed → `9eef549`
> - Task 11 verification: full suite **60/60 green** (20 Plan #1 + 40 catalog); `pnpm lint`
>   (tsc -b) exit 0; `pnpm build` (vite) success.
>
> **Deferred follow-ups (out of Plan #2 scope):** (1) richer error surface in the ⌘K palette
> when reflection fails (currently swallowed → generic empty); (2) when Plan #3+ adds a
> remove-service UI, harden ServicePanel to `onClose()` if its service vanishes (today
> unreachable — no removal UI). Task 11 Step 3 (live-GUI smoke vs a reflection server) is a
> human step, still deferred.
> **At the 🧹 /clear-checkpoint at the bottom.** Next session: `/clear`, then start Plan #3.

**Scope notes (confirm at review):**
1. `Collection`/`CatalogService` are **frontend-only TS types** (session-only UI state, no persistence, no IPC payload) — same rationale as Plan #1's `Workflow`/`Step`. The reflection contract crossing IPC is the already-defined `ServiceCatalogIpc`.
2. **`skipVerify` is honored for reflection (`grpcDescribe`/`grpcRefreshContract`) but NOT for the actual invoke** — Plan #1's `createStepFromMethod` hard-codes `skip_verify: false` and only takes `{address, tls}`. Wiring `skipVerify` (and auth/default-metadata) into the call path is **Plan #5**. Kept in the model now because the DTO already has the field and reflection needs it for self-signed third-party servers.
3. Single in-memory collection (no multi-collection UI). Spec §2 says collections are "обычно мало"; multi-collection is YAGNI for this milestone.

---

## File Structure

**Created (pure logic + store + actions — Phase A):**
- `src/features/catalog/model.ts` — `Collection`, `CatalogService`, `CuratedMethod`, factories, key/curated helpers.
- `src/features/catalog/model.test.ts`
- `src/features/catalog/tree.ts` — `buildServiceTree` (merge curated ● ↔ contract ○) + `filterTree`.
- `src/features/catalog/tree.test.ts`
- `src/features/catalog/fuzzy.ts` — `fuzzyMatch` + `rankServices`.
- `src/features/catalog/fuzzy.test.ts`
- `src/features/catalog/store.ts` — `catalogStore` + `useCatalog` hook.
- `src/features/catalog/store.test.ts`
- `src/features/catalog/actions.ts` — `describeService`, `refreshContract`, `openCallFromMethod`.
- `src/features/catalog/actions.test.ts`

**Created (components — Phase B):**
- `src/features/catalog/AddServiceForm.tsx` — manual `host:port` add.
- `src/features/catalog/Sidebar.tsx` — favorites + collection tree + filter + add + ⌘K hint.
- `src/features/catalog/Sidebar.test.tsx`
- `src/features/catalog/ServicePanel.tsx` — service tree panel (coll ↔ contract, refresh, curate, create-call, show-all).
- `src/features/catalog/ServicePanel.test.tsx`
- `src/features/catalog/CommandPalette.tsx` — ⌘K two-stage service→method finder.
- `src/features/catalog/CommandPalette.test.tsx`

**Modified:**
- `src/app/WorkflowApp.tsx` — integrate sidebar + ⌘K + service panel; **remove the temporary New-call inputs** (Plan #1 Task 8).

**Untouched:** Plan #1's `model.ts`/`store.ts`/`reducers.ts`/`actions.ts`/`FocusView.tsx`/`AddressBar.tsx` (consumed, not edited). Old `App.tsx`, `features/tabs/*`, `features/collections/*` left in place (removed in later plans; build stays green).

---

## Task 1: Catalog domain model + factories

**Files:**
- Create: `src/features/catalog/model.ts`
- Test: `src/features/catalog/model.test.ts`

- [x] **Step 1: Write the failing test `src/features/catalog/model.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import {
  newCatalogService,
  newCollection,
  methodKey,
  isCurated,
} from "./model";

describe("newCatalogService", () => {
  it("creates a service with defaults and a unique id", () => {
    const a = newCatalogService({ address: "pay-api:443" });
    const b = newCatalogService({ address: "pay-api:443" });
    expect(a.id).not.toEqual(b.id);
    expect(a.address).toBe("pay-api:443");
    expect(a.label).toBe("pay-api:443"); // defaults to address
    expect(a.tls).toBe(false);
    expect(a.skipVerify).toBe(false);
    expect(a.thirdParty).toBe(false);
    expect(a.team).toBeNull();
    expect(a.favorite).toBe(false);
    expect(a.curated).toEqual([]);
    expect(a.contract).toBeNull();
    expect(a.contractFetchedAt).toBeNull();
  });

  it("uses an explicit label and flags when given", () => {
    const s = newCatalogService({
      address: "h:443",
      label: "Payments",
      tls: true,
      thirdParty: true,
      team: "billing",
    });
    expect(s.label).toBe("Payments");
    expect(s.tls).toBe(true);
    expect(s.thirdParty).toBe(true);
    expect(s.team).toBe("billing");
  });

  it("falls back to address when label is blank", () => {
    expect(newCatalogService({ address: "h:443", label: "   " }).label).toBe("h:443");
  });
});

describe("newCollection", () => {
  it("creates an empty collection", () => {
    expect(newCollection().services).toEqual([]);
  });
});

describe("methodKey / isCurated", () => {
  it("builds a stable key", () => {
    expect(methodKey("p.v1.S", "Get")).toBe("p.v1.S/Get");
  });
  it("detects curated membership", () => {
    const s = newCatalogService({ address: "h" });
    s.curated.push({ service: "p.v1.S", method: "Get" });
    expect(isCurated(s, "p.v1.S", "Get")).toBe(true);
    expect(isCurated(s, "p.v1.S", "List")).toBe(false);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/catalog/model.test.ts`
Expected: FAIL ("Failed to resolve import ./model").

- [x] **Step 3: Implement `src/features/catalog/model.ts`**

```ts
import { newId } from "@/lib/ids";
import type { ServiceCatalogIpc } from "@/ipc/bindings";

/** A curated method (●) — a proto service + method the team actively uses. */
export interface CuratedMethod {
  service: string; // proto service full name, e.g. "payments.v1.PaymentService"
  method: string; // method name, e.g. "GetPayment"
}

/** A k8s service the user added by hand (host:port + session reflection cache). */
export interface CatalogService {
  id: string;
  address: string; // host:port
  tls: boolean;
  skipVerify: boolean; // used for reflection only this milestone (see plan scope note 2)
  label: string; // friendly name; defaults to address
  thirdParty: boolean; // "сторонний" (другой команды)
  team: string | null; // owning team, shown for third-party services
  favorite: boolean; // ★
  curated: CuratedMethod[]; // ● methods
  contract: ServiceCatalogIpc | null; // session reflection cache
  contractFetchedAt: number | null; // epoch ms of last reflection read
}

export interface Collection {
  services: CatalogService[];
}

export function methodKey(service: string, method: string): string {
  return `${service}/${method}`;
}

export function newCatalogService(init: {
  address: string;
  tls?: boolean;
  skipVerify?: boolean;
  label?: string;
  thirdParty?: boolean;
  team?: string | null;
}): CatalogService {
  return {
    id: newId(),
    address: init.address,
    tls: init.tls ?? false,
    skipVerify: init.skipVerify ?? false,
    label: init.label?.trim() || init.address,
    thirdParty: init.thirdParty ?? false,
    team: init.team ?? null,
    favorite: false,
    curated: [],
    contract: null,
    contractFetchedAt: null,
  };
}

export function newCollection(): Collection {
  return { services: [] };
}

export function isCurated(svc: CatalogService, service: string, method: string): boolean {
  return svc.curated.some((c) => c.service === service && c.method === method);
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/catalog/model.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/features/catalog/model.ts src/features/catalog/model.test.ts
git commit -m "feat(catalog): domain model + factories"
```

---

## Task 2: Service tree merge (curated ● ↔ contract ○)

**Files:**
- Create: `src/features/catalog/tree.ts`
- Test: `src/features/catalog/tree.test.ts`

- [x] **Step 1: Write the failing test `src/features/catalog/tree.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { newCatalogService, type CatalogService } from "./model";
import { buildServiceTree, filterTree } from "./tree";
import type { ServiceCatalogIpc, MethodEntryIpc } from "@/ipc/bindings";

function method(name: string): MethodEntryIpc {
  return {
    name,
    path: `/p.v1.S/${name}`,
    input_message: `${name}Request`,
    output_message: `${name}Response`,
    client_streaming: false,
    server_streaming: false,
  };
}

const contract: ServiceCatalogIpc = {
  services: [
    { full_name: "p.v1.S", methods: [method("Get"), method("List")] },
    { full_name: "grpc.health.v1.Health", methods: [method("Check")] },
  ],
};

function svcWith(): CatalogService {
  const s = newCatalogService({ address: "h:443" });
  s.contract = contract;
  s.curated = [{ service: "p.v1.S", method: "Get" }];
  return s;
}

describe("buildServiceTree", () => {
  it("merges contract (○) with curated (●), sorted", () => {
    const tree = buildServiceTree(svcWith());
    expect(tree.map((p) => p.fullName)).toEqual(["grpc.health.v1.Health", "p.v1.S"]);
    const sNode = tree.find((p) => p.fullName === "p.v1.S")!;
    const get = sNode.methods.find((m) => m.method === "Get")!;
    const list = sNode.methods.find((m) => m.method === "List")!;
    expect(get.inCollection).toBe(true);
    expect(get.inContract).toBe(true);
    expect(get.entry).not.toBeNull();
    expect(list.inCollection).toBe(false);
    expect(list.inContract).toBe(true);
  });

  it("includes curated methods absent from the contract (stale), entry null", () => {
    const s = newCatalogService({ address: "h" });
    s.contract = contract;
    s.curated = [{ service: "p.v1.S", method: "Removed" }];
    const node = buildServiceTree(s).find((p) => p.fullName === "p.v1.S")!;
    const removed = node.methods.find((m) => m.method === "Removed")!;
    expect(removed.inCollection).toBe(true);
    expect(removed.inContract).toBe(false);
    expect(removed.entry).toBeNull();
  });

  it("works with no contract — curated-only tree", () => {
    const s = newCatalogService({ address: "h" });
    s.curated = [{ service: "p.v1.S", method: "Get" }];
    const tree = buildServiceTree(s);
    expect(tree).toHaveLength(1);
    expect(tree[0].methods[0]).toMatchObject({ method: "Get", inCollection: true, inContract: false });
  });
});

describe("filterTree", () => {
  it("showAll=false keeps only ● methods", () => {
    const out = filterTree(buildServiceTree(svcWith()), { showAll: false, query: "" });
    expect(out).toHaveLength(1); // only p.v1.S (has the curated Get); Health dropped
    expect(out[0].methods.map((m) => m.method)).toEqual(["Get"]);
  });

  it("showAll=true keeps ● and ○", () => {
    const out = filterTree(buildServiceTree(svcWith()), { showAll: true, query: "" });
    expect(out.map((p) => p.fullName)).toEqual(["grpc.health.v1.Health", "p.v1.S"]);
  });

  it("filters by method-name substring (case-insensitive) and drops empty services", () => {
    const out = filterTree(buildServiceTree(svcWith()), { showAll: true, query: "lis" });
    expect(out).toHaveLength(1);
    expect(out[0].fullName).toBe("p.v1.S");
    expect(out[0].methods.map((m) => m.method)).toEqual(["List"]);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/catalog/tree.test.ts`
Expected: FAIL (module not found).

- [x] **Step 3: Implement `src/features/catalog/tree.ts`**

```ts
import type { MethodEntryIpc } from "@/ipc/bindings";
import { isCurated, type CatalogService } from "./model";

export interface MethodNode {
  service: string; // proto service full name
  method: string;
  entry: MethodEntryIpc | null; // null when curated but absent from contract
  inCollection: boolean; // ●
  inContract: boolean; // ○ — present in reflection
}

export interface ProtoServiceNode {
  fullName: string;
  methods: MethodNode[];
}

/** Merge a service's reflection contract with its curated (●) set into a tree. */
export function buildServiceTree(svc: CatalogService): ProtoServiceNode[] {
  const byService = new Map<string, Map<string, MethodNode>>();
  const ensure = (full: string): Map<string, MethodNode> => {
    let m = byService.get(full);
    if (!m) {
      m = new Map();
      byService.set(full, m);
    }
    return m;
  };

  // 1. Contract methods (○, also ● when curated).
  if (svc.contract) {
    for (const s of svc.contract.services) {
      const bucket = ensure(s.full_name);
      for (const m of s.methods) {
        bucket.set(m.name, {
          service: s.full_name,
          method: m.name,
          entry: m,
          inContract: true,
          inCollection: isCurated(svc, s.full_name, m.name),
        });
      }
    }
  }

  // 2. Curated methods missing from the contract (stale / not-yet-reflected).
  for (const c of svc.curated) {
    const bucket = ensure(c.service);
    if (!bucket.has(c.method)) {
      bucket.set(c.method, {
        service: c.service,
        method: c.method,
        entry: null,
        inContract: false,
        inCollection: true,
      });
    }
  }

  return Array.from(byService.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([fullName, methods]) => ({
      fullName,
      methods: Array.from(methods.values()).sort((a, b) => a.method.localeCompare(b.method)),
    }));
}

export interface FilterTreeOpts {
  showAll: boolean; // false → only ● (in-collection); true → ● and ○
  query: string; // case-insensitive substring on method name
}

/** Filter a built tree for display, dropping now-empty proto-services. */
export function filterTree(tree: ProtoServiceNode[], opts: FilterTreeOpts): ProtoServiceNode[] {
  const needle = opts.query.trim().toLowerCase();
  return tree
    .map((ps) => ({
      fullName: ps.fullName,
      methods: ps.methods.filter((m) => {
        if (!opts.showAll && !m.inCollection) return false;
        if (needle && !m.method.toLowerCase().includes(needle)) return false;
        return true;
      }),
    }))
    .filter((ps) => ps.methods.length > 0);
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/catalog/tree.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/features/catalog/tree.ts src/features/catalog/tree.test.ts
git commit -m "feat(catalog): service tree merge (curated <-> contract)"
```

---

## Task 3: Fuzzy match + service ranking

**Files:**
- Create: `src/features/catalog/fuzzy.ts`
- Test: `src/features/catalog/fuzzy.test.ts`

- [x] **Step 1: Write the failing test `src/features/catalog/fuzzy.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { fuzzyMatch, rankServices } from "./fuzzy";
import { newCatalogService, type CatalogService } from "./model";

describe("fuzzyMatch", () => {
  it("matches an empty query against anything with score 0", () => {
    expect(fuzzyMatch("", "anything")).toEqual({ matched: true, score: 0, indices: [] });
  });

  it("matches a subsequence and records indices", () => {
    const r = fuzzyMatch("pay", "payment-api");
    expect(r.matched).toBe(true);
    expect(r.indices).toEqual([0, 1, 2]);
  });

  it("returns not-matched when chars are missing or out of order", () => {
    expect(fuzzyMatch("xyz", "payment").matched).toBe(false);
  });

  it("scores a prefix match higher than a scattered one", () => {
    const prefix = fuzzyMatch("pay", "payment-service");
    const scattered = fuzzyMatch("pay", "proxy-relay-yak");
    expect(prefix.score).toBeGreaterThan(scattered.score);
  });
});

describe("rankServices", () => {
  function svc(label: string, extra: Partial<CatalogService> = {}): CatalogService {
    return { ...newCatalogService({ address: `${label}:443`, label }), ...extra };
  }

  it("drops non-matching services and orders by score (best first)", () => {
    const services = [svc("order-api"), svc("payment-api"), svc("inventory")];
    const out = rankServices("pay", services);
    expect(out.map((r) => r.service.label)).toContain("payment-api");
    expect(out.find((r) => r.service.label === "inventory")).toBeUndefined();
    expect(out[0].service.label).toBe("payment-api");
  });

  it("matches on address when the label does not", () => {
    const s = svc("Billing", { address: "pay-internal:443" });
    const out = rankServices("pay", [s]);
    expect(out).toHaveLength(1);
  });

  it("breaks ties toward favorites", () => {
    const plain = svc("payment-a");
    const fav = svc("payment-b", { favorite: true });
    const out = rankServices("payment", [plain, fav]);
    expect(out[0].service.label).toBe("payment-b");
  });

  it("returns all services (score 0) for an empty query", () => {
    const out = rankServices("", [svc("a"), svc("b")]);
    expect(out).toHaveLength(2);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/catalog/fuzzy.test.ts`
Expected: FAIL (module not found).

- [x] **Step 3: Implement `src/features/catalog/fuzzy.ts`**

```ts
import type { CatalogService } from "./model";

export interface FuzzyResult {
  matched: boolean;
  score: number; // higher is better; 0 when query is empty
  indices: number[]; // matched char positions in the target
}

const WORD_BOUNDARY = ".:/_- ";

/**
 * Subsequence fuzzy match with bonuses for prefix, contiguity and word starts.
 * An empty query matches everything with score 0.
 */
export function fuzzyMatch(query: string, target: string): FuzzyResult {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (q.length === 0) return { matched: true, score: 0, indices: [] };

  const indices: number[] = [];
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    let found = -1;
    for (; ti < t.length; ti++) {
      if (t[ti] === ch) {
        found = ti;
        break;
      }
    }
    if (found < 0) return { matched: false, score: 0, indices: [] };
    indices.push(found);
    score += 1; // base point per matched char
    if (found === prev + 1) score += 5; // contiguity
    if (found === 0) score += 8; // prefix
    else if (WORD_BOUNDARY.includes(t[found - 1])) score += 3; // word start
    prev = found;
    ti = found + 1;
  }
  score += Math.max(0, 5 - (t.length - q.length) / 4); // prefer tighter targets
  return { matched: true, score, indices };
}

export interface RankedService {
  service: CatalogService;
  score: number;
  indices: number[]; // label match indices (for optional highlighting)
}

/** Rank services by fuzzy match on label (falling back to address); favorites break ties. */
export function rankServices(query: string, services: CatalogService[]): RankedService[] {
  const ranked: RankedService[] = [];
  for (const service of services) {
    const onLabel = fuzzyMatch(query, service.label);
    const onAddr = fuzzyMatch(query, service.address);
    if (!onLabel.matched && !onAddr.matched) continue;
    const best = onLabel.score >= onAddr.score ? onLabel : onAddr;
    let score = best.score;
    if (service.favorite) score += 2;
    ranked.push({ service, score, indices: onLabel.matched ? onLabel.indices : [] });
  }
  return ranked.sort(
    (a, b) => b.score - a.score || a.service.label.localeCompare(b.service.label),
  );
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/catalog/fuzzy.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/features/catalog/fuzzy.ts src/features/catalog/fuzzy.test.ts
git commit -m "feat(catalog): fuzzy match + service ranking"
```

---

## Task 4: Catalog store + React hook

**Files:**
- Create: `src/features/catalog/store.ts`
- Test: `src/features/catalog/store.test.ts`

- [x] **Step 1: Write the failing test `src/features/catalog/store.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { catalogStore } from "./store";
import type { ServiceCatalogIpc } from "@/ipc/bindings";

beforeEach(() => catalogStore.reset());

const contract: ServiceCatalogIpc = { services: [] };

describe("catalogStore", () => {
  it("starts empty", () => {
    expect(catalogStore.getState().collection.services).toEqual([]);
  });

  it("addService appends and notifies subscribers", () => {
    let calls = 0;
    const unsub = catalogStore.subscribe(() => calls++);
    const svc = catalogStore.addService({ address: "h:443", label: "Pay" });
    expect(calls).toBe(1);
    expect(catalogStore.services()).toHaveLength(1);
    expect(catalogStore.getService(svc.id)?.label).toBe("Pay");
    unsub();
  });

  it("removeService removes by id", () => {
    const svc = catalogStore.addService({ address: "h" });
    catalogStore.removeService(svc.id);
    expect(catalogStore.services()).toEqual([]);
  });

  it("toggleFavorite flips the flag", () => {
    const svc = catalogStore.addService({ address: "h" });
    catalogStore.toggleFavorite(svc.id);
    expect(catalogStore.getService(svc.id)?.favorite).toBe(true);
    catalogStore.toggleFavorite(svc.id);
    expect(catalogStore.getService(svc.id)?.favorite).toBe(false);
  });

  it("curateMethod adds once (idempotent); uncurateMethod removes", () => {
    const svc = catalogStore.addService({ address: "h" });
    catalogStore.curateMethod(svc.id, "p.S", "Get");
    catalogStore.curateMethod(svc.id, "p.S", "Get"); // dup ignored
    expect(catalogStore.getService(svc.id)?.curated).toEqual([{ service: "p.S", method: "Get" }]);
    catalogStore.uncurateMethod(svc.id, "p.S", "Get");
    expect(catalogStore.getService(svc.id)?.curated).toEqual([]);
  });

  it("setContract stores the contract and fetch time", () => {
    const svc = catalogStore.addService({ address: "h" });
    catalogStore.setContract(svc.id, contract, 1234);
    expect(catalogStore.getService(svc.id)?.contract).toBe(contract);
    expect(catalogStore.getService(svc.id)?.contractFetchedAt).toBe(1234);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/catalog/store.test.ts`
Expected: FAIL (module not found).

- [x] **Step 3: Implement `src/features/catalog/store.ts`**

```ts
import { useSyncExternalStore } from "react";
import type { ServiceCatalogIpc } from "@/ipc/bindings";
import {
  newCatalogService,
  newCollection,
  type CatalogService,
  type Collection,
} from "./model";

export interface CatalogState {
  collection: Collection;
}

function initialState(): CatalogState {
  return { collection: newCollection() };
}

let state: CatalogState = initialState();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function setServices(services: CatalogService[]) {
  state = { collection: { services } };
  emit();
}

function patchService(id: string, fn: (s: CatalogService) => CatalogService) {
  setServices(state.collection.services.map((s) => (s.id === id ? fn(s) : s)));
}

export const catalogStore = {
  getState(): CatalogState {
    return state;
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  reset() {
    state = initialState();
    emit();
  },
  services(): CatalogService[] {
    return state.collection.services;
  },
  getService(id: string): CatalogService | undefined {
    return state.collection.services.find((s) => s.id === id);
  },
  addService(init: Parameters<typeof newCatalogService>[0]): CatalogService {
    const svc = newCatalogService(init);
    setServices([...state.collection.services, svc]);
    return svc;
  },
  removeService(id: string) {
    setServices(state.collection.services.filter((s) => s.id !== id));
  },
  toggleFavorite(id: string) {
    patchService(id, (s) => ({ ...s, favorite: !s.favorite }));
  },
  curateMethod(id: string, service: string, method: string) {
    patchService(id, (s) =>
      s.curated.some((c) => c.service === service && c.method === method)
        ? s
        : { ...s, curated: [...s.curated, { service, method }] },
    );
  },
  uncurateMethod(id: string, service: string, method: string) {
    patchService(id, (s) => ({
      ...s,
      curated: s.curated.filter((c) => !(c.service === service && c.method === method)),
    }));
  },
  setContract(id: string, contract: ServiceCatalogIpc, fetchedAt: number) {
    patchService(id, (s) => ({ ...s, contract, contractFetchedAt: fetchedAt }));
  },
};

export function useCatalog(): CatalogState {
  return useSyncExternalStore(catalogStore.subscribe, catalogStore.getState);
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/catalog/store.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/features/catalog/store.ts src/features/catalog/store.test.ts
git commit -m "feat(catalog): session store + react hook"
```

---

## Task 5: Catalog async actions (describe / refresh / open-call)

**Files:**
- Create: `src/features/catalog/actions.ts`
- Test: `src/features/catalog/actions.test.ts`

- [x] **Step 1: Write the failing test `src/features/catalog/actions.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/ipc/client", () => ({
  grpcDescribe: vi.fn(),
  grpcRefreshContract: vi.fn(),
  grpcBuildRequestSkeleton: vi.fn(),
  grpcInvokeOneshot: vi.fn(),
}));

import * as ipc from "@/ipc/client";
import { catalogStore } from "./store";
import { workflowStore } from "@/features/workflow/store";
import { describeService, refreshContract, openCallFromMethod } from "./actions";
import type { ServiceCatalogIpc } from "@/ipc/bindings";

const contract: ServiceCatalogIpc = {
  services: [{ full_name: "p.v1.S", methods: [] }],
};

beforeEach(() => {
  vi.clearAllMocks();
  catalogStore.reset();
  workflowStore.reset();
});

describe("describeService", () => {
  it("reflects with the service target and caches the contract", async () => {
    vi.mocked(ipc.grpcDescribe).mockResolvedValue(contract);
    const svc = catalogStore.addService({ address: "pay:443", tls: true, skipVerify: true });
    const out = await describeService(svc);
    expect(out).toBe(contract);
    expect(ipc.grpcDescribe).toHaveBeenCalledWith({ address: "pay:443", tls: true, skip_verify: true });
    expect(catalogStore.getService(svc.id)?.contract).toBe(contract);
    expect(catalogStore.getService(svc.id)?.contractFetchedAt).not.toBeNull();
  });
});

describe("refreshContract", () => {
  it("force-refreshes and caches", async () => {
    vi.mocked(ipc.grpcRefreshContract).mockResolvedValue(contract);
    const svc = catalogStore.addService({ address: "h:443" });
    await refreshContract(svc);
    expect(ipc.grpcRefreshContract).toHaveBeenCalledWith({ address: "h:443", tls: false, skip_verify: false });
    expect(catalogStore.getService(svc.id)?.contract).toBe(contract);
  });
});

describe("openCallFromMethod", () => {
  it("creates a step in the active workflow and switches to focus", async () => {
    vi.mocked(ipc.grpcBuildRequestSkeleton).mockResolvedValue('{"id":""}');
    const svc = catalogStore.addService({ address: "ord:443", tls: true });
    await openCallFromMethod(svc, "ord.v1.OrderService", "GetOrder");
    const wf = workflowStore.activeWorkflow();
    expect(wf.steps).toHaveLength(1);
    expect(wf.steps[0]).toMatchObject({
      address: "ord:443",
      tls: true,
      service: "ord.v1.OrderService",
      method: "GetOrder",
    });
    expect(wf.activeStepId).toBe(wf.steps[0].id);
    expect(wf.view).toBe("focus");
  });

  it("opens in a fresh workflow when newWorkflow is set", async () => {
    vi.mocked(ipc.grpcBuildRequestSkeleton).mockResolvedValue("{}");
    const before = workflowStore.getState().workflows.length;
    const svc = catalogStore.addService({ address: "h:443" });
    await openCallFromMethod(svc, "p.S", "M", { newWorkflow: true });
    const st = workflowStore.getState();
    expect(st.workflows).toHaveLength(before + 1);
    expect(workflowStore.activeWorkflow().steps).toHaveLength(1);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/catalog/actions.test.ts`
Expected: FAIL (module not found).

- [x] **Step 3: Implement `src/features/catalog/actions.ts`**

```ts
import * as ipc from "@/ipc/client";
import type { GrpcTargetIpc, ServiceCatalogIpc } from "@/ipc/bindings";
import { workflowStore } from "@/features/workflow/store";
import { addStep, setView } from "@/features/workflow/reducers";
import { createStepFromMethod } from "@/features/workflow/actions";
import { catalogStore } from "./store";
import type { CatalogService } from "./model";

function targetOf(svc: CatalogService): GrpcTargetIpc {
  return { address: svc.address, tls: svc.tls, skip_verify: svc.skipVerify };
}

/** Reflect a service's contract (cache-first on the backend) and store it. */
export async function describeService(svc: CatalogService): Promise<ServiceCatalogIpc> {
  const catalog = await ipc.grpcDescribe(targetOf(svc));
  catalogStore.setContract(svc.id, catalog, Date.now());
  return catalog;
}

/** Force a fresh reflection read, bypassing the backend cache. */
export async function refreshContract(svc: CatalogService): Promise<ServiceCatalogIpc> {
  const catalog = await ipc.grpcRefreshContract(targetOf(svc));
  catalogStore.setContract(svc.id, catalog, Date.now());
  return catalog;
}

/**
 * Create a call from a catalog method and open it in Focus.
 * `newWorkflow` (⌥↵) starts a fresh workflow first.
 * NOTE: skipVerify/auth are NOT wired into the invoke path yet (Plan #5) —
 * `createStepFromMethod` only takes {address, tls}.
 */
export async function openCallFromMethod(
  svc: CatalogService,
  service: string,
  method: string,
  opts: { newWorkflow?: boolean } = {},
): Promise<void> {
  if (opts.newWorkflow) workflowStore.createWorkflow(method);
  const step = await createStepFromMethod({ address: svc.address, tls: svc.tls }, service, method);
  workflowStore.update((w) => setView(addStep(w, step), "focus"));
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/catalog/actions.test.ts`
Expected: PASS (5 tests).

- [x] **Step 5: Commit**

```bash
git add src/features/catalog/actions.ts src/features/catalog/actions.test.ts
git commit -m "feat(catalog): describe/refresh/open-call actions"
```

---

## 🧹 /clear-checkpoint — Phase A (catalog foundation) complete

Pure logic + store + actions are done and unit-tested. **End the session here**, `/clear`, re-read this plan, and continue at Task 6 (components).

---

## Task 6: Add-service form

**Files:**
- Create: `src/features/catalog/AddServiceForm.tsx`

- [x] **Step 1: Implement `src/features/catalog/AddServiceForm.tsx`**

```tsx
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { catalogStore } from "./store";

export function AddServiceForm({ onAdded }: { onAdded?: () => void }) {
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [tls, setTls] = useState(false);
  const [thirdParty, setThirdParty] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const addr = address.trim();
    if (!addr) return;
    catalogStore.addService({ address: addr, label: label.trim() || undefined, tls, thirdParty });
    setAddress("");
    setLabel("");
    setTls(false);
    setThirdParty(false);
    onAdded?.();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 p-3">
      <Input
        placeholder="host:port"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        className="h-8 font-mono text-xs"
        aria-label="service-address"
      />
      <Input
        placeholder="имя (необязательно)"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        className="h-8 text-xs"
        aria-label="service-label"
      />
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <label className="flex select-none items-center gap-1.5">
          <input type="checkbox" checked={tls} onChange={(e) => setTls(e.target.checked)} /> TLS
        </label>
        <label className="flex select-none items-center gap-1.5">
          <input
            type="checkbox"
            checked={thirdParty}
            onChange={(e) => setThirdParty(e.target.checked)}
          />{" "}
          сторонний
        </label>
        <div className="flex-1" />
        <Button type="submit" size="sm" disabled={!address.trim()}>
          Добавить
        </Button>
      </div>
    </form>
  );
}
```

- [x] **Step 2: Typecheck**

Run: `pnpm lint`
Expected: PASS.

- [x] **Step 3: Commit**

```bash
git add src/features/catalog/AddServiceForm.tsx
git commit -m "feat(catalog): add-service-manually form"
```

---

## Task 7: Sidebar (favorites + collection tree + ⌘K hint)

**Files:**
- Create: `src/features/catalog/Sidebar.tsx`
- Test: `src/features/catalog/Sidebar.test.tsx`

- [x] **Step 1: Implement `src/features/catalog/Sidebar.tsx`**

```tsx
import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, MoreHorizontal, Plus, Star } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { catalogStore, useCatalog } from "./store";
import { buildServiceTree, filterTree } from "./tree";
import { openCallFromMethod } from "./actions";
import { AddServiceForm } from "./AddServiceForm";
import type { CatalogService } from "./model";

export function Sidebar({
  onOpenService,
  onOpenPalette,
}: {
  onOpenService: (svc: CatalogService) => void;
  onOpenPalette: () => void;
}) {
  const { collection } = useCatalog();
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const favorites = collection.services.filter((s) => s.favorite);

  return (
    <div className="flex h-full w-64 flex-col border-r border-border bg-background">
      <div className="flex items-center gap-2 border-b border-border p-2">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Фильтр коллекции…"
          className="h-8 text-xs"
          aria-label="collection-filter"
        />
        <Button
          size="icon"
          variant="ghost"
          aria-label="add-service"
          onClick={() => setAdding((v) => !v)}
        >
          <Plus className="size-4" />
        </Button>
      </div>

      {adding ? (
        <div className="border-b border-border bg-muted/30">
          <AddServiceForm onAdded={() => setAdding(false)} />
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto py-1">
        {favorites.length > 0 ? (
          <Section title="★ Избранные">
            {favorites.map((svc) => (
              <ServiceTree
                key={`fav-${svc.id}`}
                svc={svc}
                filter={filter}
                open={expanded.has(`fav-${svc.id}`)}
                onToggle={() => toggle(`fav-${svc.id}`)}
                onOpenService={onOpenService}
              />
            ))}
          </Section>
        ) : null}

        <Section title="Коллекция">
          {collection.services.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              Пусто. Добавь сервис (+) или открой ⌘K.
            </div>
          ) : (
            collection.services.map((svc) => (
              <ServiceTree
                key={svc.id}
                svc={svc}
                filter={filter}
                open={expanded.has(svc.id)}
                onToggle={() => toggle(svc.id)}
                onOpenService={onOpenService}
              />
            ))
          )}
        </Section>
      </div>

      <button
        type="button"
        onClick={onOpenPalette}
        className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground hover:bg-accent"
      >
        Нет нужного? <Kbd>⌘K</Kbd>
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="pb-2">
      <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

function ServiceTree({
  svc,
  filter,
  open,
  onToggle,
  onOpenService,
}: {
  svc: CatalogService;
  filter: string;
  open: boolean;
  onToggle: () => void;
  onOpenService: (svc: CatalogService) => void;
}) {
  const tree = useMemo(
    () => filterTree(buildServiceTree(svc), { showAll: false, query: filter }),
    [svc, filter],
  );

  return (
    <div>
      <div className="group flex items-center gap-1 px-2 py-1 hover:bg-accent/50">
        <button
          type="button"
          aria-label="toggle-service"
          onClick={onToggle}
          className="flex flex-1 items-center gap-1 text-left"
        >
          {open ? <ChevronDown className="size-3 flex-none" /> : <ChevronRight className="size-3 flex-none" />}
          <span className="truncate text-xs font-medium">{svc.label}</span>
          {svc.thirdParty ? (
            <span className="text-[10px] text-muted-foreground">· сторонний</span>
          ) : null}
        </button>
        <button
          type="button"
          aria-label="toggle-favorite"
          onClick={() => catalogStore.toggleFavorite(svc.id)}
        >
          <Star
            className={cn(
              "size-3",
              svc.favorite ? "fill-current text-yellow-400" : "text-muted-foreground",
            )}
          />
        </button>
        <button
          type="button"
          aria-label="open-service-panel"
          onClick={() => onOpenService(svc)}
          className="text-muted-foreground hover:text-foreground"
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      </div>

      {open ? (
        <div className="pl-4">
          {tree.length === 0 ? (
            <div className="px-3 py-1 text-[11px] text-muted-foreground">
              Нет ● методов — открой панель
            </div>
          ) : (
            tree.map((ps) => (
              <div key={ps.fullName}>
                <div className="truncate px-3 py-0.5 text-[10px] text-muted-foreground">
                  {ps.fullName}
                </div>
                {ps.methods.map((m) => (
                  <button
                    key={m.method}
                    type="button"
                    onClick={(e) =>
                      openCallFromMethod(svc, m.service, m.method, { newWorkflow: e.altKey })
                    }
                    className="flex w-full items-center gap-2 px-3 py-0.5 pl-6 text-left font-mono text-xs hover:bg-accent"
                  >
                    <span className="text-[var(--ok)]">●</span>
                    <span className="truncate">{m.method}</span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
```

- [x] **Step 2: Write the test `src/features/catalog/Sidebar.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("./actions", () => ({
  openCallFromMethod: vi.fn(),
}));

import { Sidebar } from "./Sidebar";
import { catalogStore } from "./store";
import { openCallFromMethod } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  catalogStore.reset();
});

describe("Sidebar", () => {
  it("shows an empty hint and the ⌘K affordance", () => {
    render(<Sidebar onOpenService={() => {}} onOpenPalette={() => {}} />);
    expect(screen.getByText(/Пусто/)).toBeInTheDocument();
    expect(screen.getByText(/Нет нужного/)).toBeInTheDocument();
  });

  it("expands a service and creates a call when a ● method is clicked", async () => {
    const user = userEvent.setup();
    const svc = catalogStore.addService({ address: "ord:443", label: "Orders", tls: true });
    catalogStore.curateMethod(svc.id, "ord.v1.OrderService", "GetOrder");

    render(<Sidebar onOpenService={() => {}} onOpenPalette={() => {}} />);
    await user.click(screen.getByRole("button", { name: "toggle-service" }));
    await user.click(screen.getByRole("button", { name: /GetOrder/ }));

    expect(openCallFromMethod).toHaveBeenCalledWith(
      expect.objectContaining({ id: svc.id }),
      "ord.v1.OrderService",
      "GetOrder",
      { newWorkflow: false },
    );
  });

  it("opens the service panel via the ⋯ button", async () => {
    const user = userEvent.setup();
    const onOpenService = vi.fn();
    catalogStore.addService({ address: "h:443" });
    render(<Sidebar onOpenService={onOpenService} onOpenPalette={() => {}} />);
    await user.click(screen.getByRole("button", { name: "open-service-panel" }));
    expect(onOpenService).toHaveBeenCalled();
  });
});
```

- [x] **Step 3: Run test to verify it passes**

Run: `pnpm test src/features/catalog/Sidebar.test.tsx`
Expected: PASS (3 tests).

> If `userEvent.click` does not report `altKey: false` as `{ newWorkflow: false }`, the handler reads `e.altKey` — a plain click has `altKey === false`, so the assertion holds. Do not change the assertion; fix the handler if it diverges.

- [x] **Step 4: Commit**

```bash
git add src/features/catalog/Sidebar.tsx src/features/catalog/Sidebar.test.tsx
git commit -m "feat(catalog): sidebar collection navigation"
```

---

## Task 8: Service panel (tree: collection ↔ contract)

**Files:**
- Create: `src/features/catalog/ServicePanel.tsx`
- Test: `src/features/catalog/ServicePanel.test.tsx`

> **Wiring note:** open `src/components/ui/switch.tsx` first and confirm the toggle prop name. shadcn's `Switch` uses `checked` + `onCheckedChange`. If this repo's `Switch` differs, match its real props (do not invent).

- [x] **Step 1: Implement `src/features/catalog/ServicePanel.tsx`**

```tsx
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { catalogStore, useCatalog } from "./store";
import { buildServiceTree, filterTree } from "./tree";
import { describeService, openCallFromMethod, refreshContract } from "./actions";

function msg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    if (typeof o.message === "string") return o.message;
    if (typeof o.type === "string") return o.type;
  }
  return String(e);
}

export function ServicePanel({
  serviceId,
  onClose,
}: {
  serviceId: string;
  onClose: () => void;
}) {
  useCatalog(); // subscribe so curate/contract changes re-render
  const svc = catalogStore.getService(serviceId);
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = catalogStore.getService(serviceId);
    if (s && s.contract === null) {
      setLoading(true);
      setError(null);
      describeService(s)
        .catch((e) => setError(msg(e)))
        .finally(() => setLoading(false));
    }
  }, [serviceId]);

  const tree = useMemo(
    () => (svc ? filterTree(buildServiceTree(svc), { showAll, query: filter }) : []),
    [svc, showAll, filter],
  );

  if (!svc) return null;

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      await refreshContract(svc);
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{svc.label}</div>
          <div className="truncate font-mono text-xs text-muted-foreground">
            {svc.address}
            {svc.thirdParty ? " · сторонний" : ""}
            {svc.team ? ` · ${svc.team}` : ""}
            {svc.contractFetchedAt ? " · контракт загружен" : " · контракт не загружен"}
          </div>
        </div>
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
          ⟳ Обновить контракт
        </Button>
        <Button size="sm" variant="ghost" aria-label="close-panel" onClick={onClose}>
          ✕
        </Button>
      </div>

      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Фильтр методов…"
          className="h-8 max-w-xs text-xs"
          aria-label="method-filter"
        />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={showAll} onCheckedChange={setShowAll} aria-label="show-all-contract" />
          показать всё из контракта
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {loading ? (
          <div className="p-4 text-xs text-muted-foreground">Загрузка контракта…</div>
        ) : null}
        {error ? <div className="p-4 text-xs text-destructive">{error}</div> : null}
        {!loading && tree.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground">Нет методов.</div>
        ) : null}
        {tree.map((ps) => (
          <div key={ps.fullName} className="mb-2">
            <div className="px-2 py-1 font-mono text-xs text-muted-foreground">{ps.fullName}</div>
            {ps.methods.map((m) => (
              <div
                key={m.method}
                className="group flex items-center gap-2 px-2 py-0.5 pl-5 font-mono text-xs hover:bg-accent/50"
              >
                <span className={m.inCollection ? "text-[var(--ok)]" : "text-muted-foreground"}>
                  {m.inCollection ? "●" : "○"}
                </span>
                <span className="flex-1 truncate">{m.method}</span>
                {m.entry ? (
                  <span className="text-[10px] text-muted-foreground">
                    {m.entry.input_message} → {m.entry.output_message}
                  </span>
                ) : null}
                {m.inCollection ? (
                  <>
                    <button
                      type="button"
                      aria-label={`create-call-${m.method}`}
                      className="text-[var(--ok)] opacity-0 group-hover:opacity-100"
                      onClick={(e) =>
                        openCallFromMethod(svc, m.service, m.method, { newWorkflow: e.altKey })
                      }
                    >
                      → создать вызов
                    </button>
                    <button
                      type="button"
                      aria-label={`uncurate-${m.method}`}
                      className="text-muted-foreground opacity-0 group-hover:opacity-100"
                      onClick={() => catalogStore.uncurateMethod(svc.id, m.service, m.method)}
                    >
                      − из коллекции
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    aria-label={`curate-${m.method}`}
                    className="text-muted-foreground opacity-0 group-hover:opacity-100"
                    onClick={() => catalogStore.curateMethod(svc.id, m.service, m.method)}
                  >
                    + в коллекцию
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [x] **Step 2: Write the test `src/features/catalog/ServicePanel.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("./actions", () => ({
  describeService: vi.fn(),
  refreshContract: vi.fn(),
  openCallFromMethod: vi.fn(),
}));

import { ServicePanel } from "./ServicePanel";
import { catalogStore } from "./store";
import { refreshContract } from "./actions";
import type { ServiceCatalogIpc, MethodEntryIpc } from "@/ipc/bindings";

function method(name: string): MethodEntryIpc {
  return {
    name,
    path: `/p.v1.S/${name}`,
    input_message: `${name}Req`,
    output_message: `${name}Res`,
    client_streaming: false,
    server_streaming: false,
  };
}

const contract: ServiceCatalogIpc = {
  services: [{ full_name: "p.v1.S", methods: [method("Get"), method("List")] }],
};

beforeEach(() => {
  vi.clearAllMocks();
  catalogStore.reset();
});

describe("ServicePanel", () => {
  it("with showAll shows ○ methods and curates one into the collection (●)", async () => {
    const user = userEvent.setup();
    const svc = catalogStore.addService({ address: "h:443" });
    catalogStore.setContract(svc.id, contract, 1); // preload → no describe call

    render(<ServicePanel serviceId={svc.id} onClose={() => {}} />);
    await user.click(screen.getByRole("switch", { name: "show-all-contract" }));

    // ○ Get visible; curate it
    await user.click(screen.getByRole("button", { name: "curate-Get" }));
    expect(catalogStore.getService(svc.id)?.curated).toEqual([
      { service: "p.v1.S", method: "Get" },
    ]);
    // now it offers create-call (●)
    expect(screen.getByRole("button", { name: "create-call-Get" })).toBeInTheDocument();
  });

  it("calls refreshContract from the toolbar button", async () => {
    const user = userEvent.setup();
    vi.mocked(refreshContract).mockResolvedValue(contract);
    const svc = catalogStore.addService({ address: "h:443" });
    catalogStore.setContract(svc.id, contract, 1);
    render(<ServicePanel serviceId={svc.id} onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: /Обновить контракт/ }));
    expect(refreshContract).toHaveBeenCalled();
  });
});
```

- [x] **Step 3: Run test to verify it passes**

Run: `pnpm test src/features/catalog/ServicePanel.test.tsx`
Expected: PASS (2 tests). If the `Switch` role/name differs, adjust the query to the real `Switch` (read `switch.tsx`); keep the curate assertions unchanged.

- [x] **Step 4: Commit**

```bash
git add src/features/catalog/ServicePanel.tsx src/features/catalog/ServicePanel.test.tsx
git commit -m "feat(catalog): service panel (collection <-> contract)"
```

---

## Task 9: ⌘K command palette (service-first, two-stage)

**Files:**
- Create: `src/features/catalog/CommandPalette.tsx`
- Test: `src/features/catalog/CommandPalette.test.tsx`

- [x] **Step 1: Implement `src/features/catalog/CommandPalette.tsx`**

```tsx
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import { Kbd } from "@/components/ui/kbd";
import { catalogStore, useCatalog } from "./store";
import { rankServices } from "./fuzzy";
import { buildServiceTree, type MethodNode } from "./tree";
import { describeService, openCallFromMethod } from "./actions";
import type { CatalogService } from "./model";

type Stage = "service" | "method";

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  useCatalog(); // subscribe
  const [stage, setStage] = useState<Stage>("service");
  const [svc, setSvc] = useState<CatalogService | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setStage("service");
      setSvc(null);
      setQuery("");
      setActive(0);
      const t = setTimeout(() => inputRef.current?.focus(), 10);
      return () => clearTimeout(t);
    }
  }, [open]);

  const services = catalogStore.services();
  const ranked = useMemo(() => rankServices(query, services), [query, services]);

  const methods: MethodNode[] = useMemo(() => {
    if (stage !== "method" || !svc) return [];
    const all = buildServiceTree(svc).flatMap((ps) => ps.methods);
    const needle = query.trim().toLowerCase();
    return needle ? all.filter((m) => m.method.toLowerCase().includes(needle)) : all;
  }, [stage, svc, query]);

  const count = stage === "service" ? ranked.length : methods.length;
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, count - 1)));
  }, [count]);

  if (!open) return null;

  const pickService = async (s: CatalogService) => {
    setSvc(s);
    setStage("method");
    setQuery("");
    setActive(0);
    if (s.contract === null) {
      setLoading(true);
      try {
        await describeService(s);
      } finally {
        setLoading(false);
      }
    }
    inputRef.current?.focus();
  };

  const pickMethod = (m: MethodNode, newWorkflow: boolean) => {
    if (!svc) return;
    void openCallFromMethod(svc, m.service, m.method, { newWorkflow });
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (stage === "method") {
        setStage("service");
        setSvc(null);
        setQuery("");
        setActive(0);
      } else {
        onClose();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(count - 1, a + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (stage === "service") {
        const r = ranked[active];
        if (r) void pickService(r.service);
      } else {
        const m = methods[active];
        if (m) pickMethod(m, e.altKey);
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[15vh]"
      onClick={onClose}
    >
      <div
        className="w-[560px] overflow-hidden rounded-lg border border-border bg-popover shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          {stage === "method" && svc ? (
            <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
              {svc.label} ›
            </span>
          ) : null}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={stage === "service" ? "Поиск сервиса…" : "Поиск метода…"}
            aria-label="command-input"
            className="h-11 flex-1 bg-transparent text-sm focus:outline-none"
          />
          <Kbd>esc</Kbd>
        </div>

        <div className="max-h-[360px] overflow-auto py-1">
          {loading ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              Загрузка контракта…
            </div>
          ) : null}

          {!loading && stage === "service"
            ? ranked.length === 0
              ? <Empty q={query} />
              : ranked.map((r, i) => (
                  <button
                    key={r.service.id}
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => void pickService(r.service)}
                    className={cn(
                      "flex w-full items-center gap-2 px-4 py-2 text-left text-sm",
                      i === active && "bg-accent",
                    )}
                  >
                    <span className="flex-1 truncate">{r.service.label}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {r.service.address}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {r.service.curated.length} ●
                    </span>
                  </button>
                ))
            : null}

          {!loading && stage === "method"
            ? methods.length === 0
              ? <Empty q={query} />
              : methods.map((m, i) => (
                  <button
                    key={`${m.service}/${m.method}`}
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={(e) => pickMethod(m, e.altKey)}
                    className={cn(
                      "flex w-full items-center gap-2 px-4 py-1.5 text-left font-mono text-xs",
                      i === active && "bg-accent",
                    )}
                  >
                    <span className={m.inCollection ? "text-[var(--ok)]" : "text-muted-foreground"}>
                      {m.inCollection ? "●" : "○"}
                    </span>
                    <span className="flex-1 truncate">{m.method}</span>
                    {m.entry ? (
                      <span className="text-[10px] text-muted-foreground">
                        {m.entry.input_message} → {m.entry.output_message}
                      </span>
                    ) : null}
                  </button>
                ))
            : null}
        </div>

        <div className="flex items-center gap-3 border-t border-border px-4 py-1.5 text-[10px] text-muted-foreground">
          <span><Kbd>↵</Kbd> вызов</span>
          <span><Kbd>⌥↵</Kbd> новый workflow</span>
          <span><Kbd>esc</Kbd> назад</span>
          <span><Kbd>↑↓</Kbd> навигация</span>
        </div>
      </div>
    </div>
  );
}

function Empty({ q }: { q: string }) {
  return (
    <div className="px-4 py-8 text-center text-xs text-muted-foreground">
      Ничего не найдено{q ? ` по «${q}»` : ""}.
    </div>
  );
}
```

- [x] **Step 2: Write the test `src/features/catalog/CommandPalette.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("./actions", () => ({
  describeService: vi.fn(),
  openCallFromMethod: vi.fn(),
}));

import { CommandPalette } from "./CommandPalette";
import { catalogStore } from "./store";
import { describeService, openCallFromMethod } from "./actions";
import type { ServiceCatalogIpc, MethodEntryIpc } from "@/ipc/bindings";

function method(name: string): MethodEntryIpc {
  return {
    name,
    path: `/ord.v1.S/${name}`,
    input_message: `${name}Req`,
    output_message: `${name}Res`,
    client_streaming: false,
    server_streaming: false,
  };
}

const contract: ServiceCatalogIpc = {
  services: [{ full_name: "ord.v1.OrderService", methods: [method("GetOrder")] }],
};

beforeEach(() => {
  vi.clearAllMocks();
  catalogStore.reset();
  vi.mocked(describeService).mockResolvedValue(contract);
});

describe("CommandPalette", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<CommandPalette open={false} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("stage 1: fuzzy-filters services by query", async () => {
    const user = userEvent.setup();
    catalogStore.addService({ address: "pay:443", label: "payment-api" });
    catalogStore.addService({ address: "inv:443", label: "inventory" });
    render(<CommandPalette open onClose={() => {}} />);
    await user.type(screen.getByLabelText("command-input"), "pay");
    expect(screen.getByText("payment-api")).toBeInTheDocument();
    expect(screen.queryByText("inventory")).not.toBeInTheDocument();
  });

  it("Enter picks a service, loads its contract, then Enter creates a call", async () => {
    const user = userEvent.setup();
    const svc = catalogStore.addService({ address: "ord:443", label: "Orders" });
    // preload contract so stage 2 lists the method without async timing
    catalogStore.setContract(svc.id, contract, 1);

    render(<CommandPalette open onClose={() => {}} />);
    const input = screen.getByLabelText("command-input");
    await user.keyboard("{Enter}"); // pick first (only) service
    expect(await screen.findByText("GetOrder")).toBeInTheDocument();
    await user.keyboard("{Enter}"); // pick first method

    expect(openCallFromMethod).toHaveBeenCalledWith(
      expect.objectContaining({ id: svc.id }),
      "ord.v1.OrderService",
      "GetOrder",
      { newWorkflow: false },
    );
  });

  it("Escape from stage 2 returns to service stage", async () => {
    const user = userEvent.setup();
    const svc = catalogStore.addService({ address: "ord:443", label: "Orders" });
    catalogStore.setContract(svc.id, contract, 1);
    render(<CommandPalette open onClose={() => {}} />);
    await user.keyboard("{Enter}"); // → stage method
    expect(await screen.findByText("GetOrder")).toBeInTheDocument();
    await user.keyboard("{Escape}"); // → back to service
    expect(screen.getByPlaceholderText("Поиск сервиса…")).toBeInTheDocument();
  });
});
```

- [x] **Step 3: Run test to verify it passes**

Run: `pnpm test src/features/catalog/CommandPalette.test.tsx`
Expected: PASS (4 tests).

- [x] **Step 4: Commit**

```bash
git add src/features/catalog/CommandPalette.tsx src/features/catalog/CommandPalette.test.tsx
git commit -m "feat(catalog): service-first command palette"
```

---

## Task 10: Integrate into the shell, remove temporary New-call inputs

**Files:**
- Modify: `src/app/WorkflowApp.tsx` (full replacement)

- [x] **Step 1: Replace `src/app/WorkflowApp.tsx`**

This removes Plan #1's temporary typed New-call inputs (address/service/method/tls/Create) and wires the sidebar, ⌘K, and service panel.

```tsx
import { useEffect, useState } from "react";
import { Kbd } from "@/components/ui/kbd";
import { FocusView } from "@/features/workflow/FocusView";
import { useActiveWorkflow } from "@/features/workflow/store";
import { Sidebar } from "@/features/catalog/Sidebar";
import { CommandPalette } from "@/features/catalog/CommandPalette";
import { ServicePanel } from "@/features/catalog/ServicePanel";
import type { CatalogService } from "@/features/catalog/model";

export function WorkflowApp() {
  const wf = useActiveWorkflow();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [panelServiceId, setPanelServiceId] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openService = (svc: CatalogService) => setPanelServiceId(svc.id);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex h-9 items-center gap-3 border-b border-border px-3 text-sm">
        <span className="font-semibold">⚡ Handshaker</span>
        <span className="text-muted-foreground">{wf.name}</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent"
        >
          <Kbd>⌘K</Kbd>
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <Sidebar onOpenService={openService} onOpenPalette={() => setPaletteOpen(true)} />
        <div className="min-h-0 flex-1">
          {panelServiceId ? (
            <ServicePanel serviceId={panelServiceId} onClose={() => setPanelServiceId(null)} />
          ) : (
            <FocusView />
          )}
        </div>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
```

- [x] **Step 2: Typecheck the whole project**

Run: `pnpm lint`
Expected: PASS (no unused imports — the old `Input`/`createStepFromMethod`/`addStep` imports are gone).

- [x] **Step 3: Commit**

```bash
git add src/app/WorkflowApp.tsx
git commit -m "feat(catalog): wire sidebar + palette into shell, drop temp call entry"
```

---

## Task 11: Full verification

**Files:** none (verification only).

- [x] **Step 1: Run the whole unit suite**

Run: `pnpm test`
Expected: PASS — Plan #1 suites (model/reducers/store/actions/smoke) **plus** Plan #2 (catalog model/tree/fuzzy/store/actions + Sidebar/ServicePanel/CommandPalette). No failures.

- [x] **Step 2: Typecheck + production build**

Run: `pnpm build`
Expected: `tsc -b` clean, `vite build` produces `dist/` with no errors.

- [x] **Step 3: (Human, optional) smoke against a live reflection-enabled gRPC server**

Run: `pnpm tauri:dev`
- Add a service (sidebar **+** → `host:port`, TLS as needed) → it appears under **Коллекция**.
- Open ⌘K → type part of the service name → ↵ → its methods list (contract auto-loaded) → ↵ → a Focus call opens with a skeleton body; **Send** returns a response.
- Open the service panel (⋯) → toggle **показать всё из контракта** → **+ в коллекцию** on a ○ method → it gains ● and shows in the sidebar tree.
- **⟳ Обновить контракт** re-reads reflection.
> Requires a human at the GUI with a reachable server; defer if unavailable (same as Plan #1 Task 9).

- [x] **Step 4: Commit any lockfile/binding drift**

```bash
git add -A
git commit -m "chore(catalog): plan-02 verification" || echo "nothing to commit"
```

---

## 🧹 /clear-checkpoint — Plan #2 complete

Catalog + navigation done. New session before Plan #3:
1. `/clear`
2. Re-read `CLAUDE.md` + this plan's checkboxes + `docs/superpowers/plans/2026-06-03-plan-03-*.md`.
3. Detail Plan #3 (workflow history + view modes: Лента/Список/Фокус switch + rail) to TDD level, then execute.

---

## Self-Review (author checklist — completed)

- **Outline-task coverage:**
  - Collection/CatalogService model + session store → Task 1, Task 4.
  - Add-service-manually → Task 6 (+ Sidebar **+** in Task 7).
  - Reflection-backed service tree (describe/refresh, merge, ● / ○, "Обновить контракт") → Task 2 (merge), Task 5 (actions), Task 8 (panel).
  - Sidebar (favorites + tree + filter + click→createStep→Focus) → Task 7.
  - ⌘K (stage 1 fuzzy service, stage 2 method, ↵ / ⌥↵ / Esc / ↑↓) → Task 3 (fuzzy), Task 9 (palette).
  - Service panel "+ в коллекцию" / "→ создать вызов" / show-all toggle → Task 8.
  - Remove Plan #1 temporary New-call inputs → Task 10.
- **Spec coverage:** §3.1 (Task 7), §3.2 (Task 9), §3.3 (Task 8), §5 create-call flow (Task 5 `openCallFromMethod` → Focus skeleton), §10 manual catalog/fuzzy/full-keyboard (Tasks 6/3/9).
- **Placeholders:** none — every code step ships complete code; the only "read the real file" notes are the `Switch` prop check (Task 8) and the deliberate cross-component prop confirmations, mirroring Plan #1's reviewed style.
- **Type consistency:** `CatalogService`/`CuratedMethod`/`Collection` fields are identical across model/tree/fuzzy/store/actions/components; `MethodNode`/`ProtoServiceNode` consumed consistently in tree/Sidebar/ServicePanel/CommandPalette; `openCallFromMethod(svc, service, method, {newWorkflow})`, `describeService(svc)`, `refreshContract(svc)` signatures match every call site; IPC payloads use the confirmed `GrpcTargetIpc = {address, tls, skip_verify}` and `ServiceCatalogIpc`/`MethodEntryIpc` shapes.
- **Verified against real code (not the draft):** store is module-singleton + `useSyncExternalStore` (no Zustand); `createStepFromMethod` takes `{address, tls}` only (skipVerify deferred — scope note 2); IPC client exports named `grpcDescribe`/`grpcRefreshContract`/`grpcBuildRequestSkeleton`/`grpcInvokeOneshot` wrappers; no `cmdk`/fuzzy dep in `package.json` (⌘K + fuzzy hand-written); UI primitives `button/input/switch/kbd` confirmed present; `newId` from `@/lib/ids`.
- **Open items flagged for review:** (1) frontend-only catalog types vs spec's "schema in core" — same call as Plan #1; (2) `skipVerify` honored for reflection only this milestone.
