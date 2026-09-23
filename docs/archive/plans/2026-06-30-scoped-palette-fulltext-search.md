# Scoped Command-Palette Full-Text Search — Implementation Plan

> **Статус:** 🎉 DONE — Task 1 реализован (после ребейза `fa84179`), гейт зелёный
> (vitest 1172 · `tsc -b` · `vite build`), spec+quality ревью = APPROVED. Rebase на
> актуальный `main` (`d968f73`) + ff в `main`; остаток — живой WebView2-проход.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the command palette's scoped mode (after `Tab` into a collection), search the full request text — `name + service + method + address` — exactly like flat mode, instead of matching the request name only.

**Architecture:** Pure-frontend change in one file. `derivePaletteResults` already calls `rankRequests` (full-haystack ranker) in the scoped branch, then discards everything except name matches with an extra `.filter(...)`. The fix is to delete that name-only post-filter so scoped mode becomes a one-collection slice of flat mode. Match relevance stays name-first because `fuzzyMatch` awards large prefix/word-start bonuses, so service-only "noise" sorts last.

**Tech Stack:** TypeScript, React, Vitest. No backend / IPC / bindings changes.

**Spec:** `docs/superpowers/specs/2026-06-30-scoped-palette-fulltext-search-design.md`

---

### Task 1: Scoped palette search matches the full haystack

**Files:**
- Modify: `src/features/catalog/paletteModel.ts:59-66` (scoped branch of `derivePaletteResults`)
- Test: `src/features/catalog/paletteModel.test.ts:54-72` (the `derivePaletteResults — scoped` describe block)

**Context for the engineer:**
- `rankRequests(query, hits)` (in `src/features/catalog/palette.ts`) ranks each request against the haystack `` `${r.name} ${r.service}.${r.method} ${r.address_template}` `` and drops non-matches; an empty query returns all hits sorted by name. It already does the full-text matching we want.
- The scoped branch currently wraps that result in an extra filter that keeps only requests whose **name** matches. Removing the filter is the entire behavior change.
- The test fixture in `paletteModel.test.ts` gives every request the shared service `edo.attorney.v1.Letters` and address `h:443`, with requests `r1` (`Search`), `r2` (`SearchByInn`), `r3` (`GetStatus`) in collection `c1`. After the change, query `sea` also matches `r3` (the subsequence `s…e…a` exists across its service/address haystack), and `r3` ranks last because its name has no match (no prefix/word-start bonus).
- `fuzzyMatch` stays imported in `paletteModel.ts` — `matchIndices` still uses it. Do **not** remove the import.

- [ ] **Step 1: Update the existing scoped test and add two new ones (write the failing tests)**

In `src/features/catalog/paletteModel.test.ts`, find the existing test inside the `describe("derivePaletteResults — scoped", …)` block:

```ts
  it("drops the overview row once the user types a method query", () => {
    const r = derivePaletteResults({ tree: TREE, scope, query: "sea", limits: LIMITS });
    expect(r.rows.some((row) => row.kind === "overview")).toBe(false);
    const ids = r.rows.map((row) => (row.kind === "request" ? row.request.id : ""));
    expect(ids).toContain("r1");
    expect(ids).toContain("r2");
    expect(ids).not.toContain("r3");
  });
```

Replace it with the overview-drop test (minus the now-wrong assertion) plus two new tests:

```ts
  it("drops the overview row once the user types a method query", () => {
    const r = derivePaletteResults({ tree: TREE, scope, query: "sea", limits: LIMITS });
    expect(r.rows.some((row) => row.kind === "overview")).toBe(false);
    const ids = r.rows.map((row) => (row.kind === "request" ? row.request.id : ""));
    expect(ids).toContain("r1");
    expect(ids).toContain("r2");
  });

  it("matches full text (service/method/address), ranking name hits above service-only hits", () => {
    const r = derivePaletteResults({ tree: TREE, scope, query: "sea", limits: LIMITS });
    const ids = r.rows
      .filter((row) => row.kind === "request")
      .map((row) => (row.kind === "request" ? row.request.id : ""));
    // "sea" hits r1/r2 by name and r3 only via its service/address haystack.
    expect(ids).toContain("r3");
    // Name matches still rank above the service-only match.
    expect(ids.indexOf("r1")).toBeLessThan(ids.indexOf("r3"));
    expect(ids.indexOf("r2")).toBeLessThan(ids.indexOf("r3"));
  });

  it("finds requests by a service-name fragment in scoped mode", () => {
    const r = derivePaletteResults({ tree: TREE, scope, query: "letters", limits: LIMITS });
    const ids = r.rows
      .filter((row) => row.kind === "request")
      .map((row) => (row.kind === "request" ? row.request.id : ""));
    // "letters" appears only in the shared service edo.attorney.v1.Letters, in no request name.
    expect(ids).toContain("r1");
    expect(ids).toContain("r2");
    expect(ids).toContain("r3");
  });
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `pnpm test src/features/catalog/paletteModel.test.ts`

Expected: FAIL. The `matches full text …` test fails (`r3` not present for query `sea` under name-only filtering), and the `finds requests by a service-name fragment …` test fails (query `letters` matches no request name, so zero request rows). The `drops the overview row …` test passes.

- [ ] **Step 3: Remove the name-only post-filter in the scoped branch**

In `src/features/catalog/paletteModel.ts`, find the scoped branch:

```ts
  if (scope) {
    const col = tree.find((c) => c.id === scope.id);
    // In scoped mode match only against request name (not full haystack) so that
    // e.g. "sea" doesn't match "GetStatus" via the service string.
    const allHits = col ? rankRequests(query, flattenRequests([col])) : [];
    const hits = query.trim()
      ? allHits.filter((h) => fuzzyMatch(query.trim(), h.request.name).matched)
      : allHits;
    const requestRows: PaletteRow[] = hits.map((h) => ({
```

Replace those lines with:

```ts
  if (scope) {
    const col = tree.find((c) => c.id === scope.id);
    // Scoped mode matches the same full haystack as flat mode (name + service +
    // method + address) — just limited to the one collection's requests.
    const hits = col ? rankRequests(query, flattenRequests([col])) : [];
    const requestRows: PaletteRow[] = hits.map((h) => ({
```

Leave the rest of the branch unchanged: `requestRows` still maps `indices: matchIndices(query, h.request.name)` (name-only highlight, consistent with flat mode), the overview row on empty query, and the methods group heading.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/features/catalog/paletteModel.test.ts`

Expected: PASS — all tests in the file green, including the three from Step 1.

- [ ] **Step 5: Run the full gate**

Run: `pnpm test`
Expected: PASS — full vitest suite green (no other test depended on scoped name-only behavior; flat-mode, `bestCollectionMatch`, `completionFor`, and `CommandPalette` tests are unaffected).

Run: `pnpm build`
Expected: PASS — `tsc -b` reports no errors (confirms `fuzzyMatch` is still a used import in `paletteModel.ts` via `matchIndices`) and `vite build` completes.

- [ ] **Step 6: Commit**

```bash
git add src/features/catalog/paletteModel.ts src/features/catalog/paletteModel.test.ts
git commit -m "feat(palette): scoped search matches full text like flat mode

Drop the name-only post-filter in derivePaletteResults' scoped branch so
that searching inside a collection also matches service/method/address,
not just the request name. Name matches still rank first.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Decision 1/2 (full text in scoped mode; remove the name-only filter) → Task 1, Step 3.
- Decision 3 (accept `sea`→`GetStatus` noise; name-first ranking; no word boundary) → Task 1, Step 1 ordering test.
- Decision 4 (highlight name line only) → unchanged `matchIndices(query, h.request.name)`, noted in Step 3.
- Decision 5 (empty-query scoped unchanged) → overview row left intact in Step 3; no test change needed.
- Decision 6 (no folders/descriptions) → out of scope, no task.
- Spec test plan (invert `sea` test + ordering + service-fragment test) → Task 1, Step 1.
- Spec gate (`pnpm test` · `tsc -b` · `vite build`) → Task 1, Step 5.
- Spec risk (unused-import check after deleting `.filter`) → Task 1, Step 5 `pnpm build` note.

**Placeholder scan:** No TBD/TODO; every code step shows full before/after; every command has expected output.

**Type consistency:** `derivePaletteResults`, `rankRequests`, `flattenRequests`, `matchIndices`, `PaletteRow`, and `fuzzyMatch` are referenced with their existing signatures; no new symbols introduced. Test row narrowing uses the existing `row.kind === "request"` pattern from the file.
