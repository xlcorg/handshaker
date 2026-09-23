# Icons off by default · methods in `.proto` order — Implementation Plan

> **Status: 🎉 DONE — both tasks implemented, gate green, squashed & ff-merged to `main`.**
> `feat(prefs): default gRPC request-list icon to off` + `feat(catalog): keep methods in proto definition order`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two independent behavior changes — the gRPC request-list icon defaults to hidden, and service methods render in `.proto` definition order instead of alphabetically.

**Architecture:** Change 1 flips one field in the frontend prefs defaults (`src/lib/use-prefs.ts`); the `RequestRow` component already gates the glyph on `grpcIcon !== "off"`, so only the default and two test files move. Change 2 deletes a single `sort_by` in the Rust core catalog projection (`crates/handshaker-core/src/grpc/catalog/build.rs`); the ordered `ServiceCatalog` is the one source the whole frontend consumes, so definition order flows everywhere. Services stay alphabetically sorted.

**Tech Stack:** React 18 + TypeScript + Vitest (frontend); Rust + `prost_reflect` + `cargo test` (core). Package manager `pnpm@9`.

**Spec:** `docs/superpowers/specs/2026-07-14-icons-off-method-proto-order-design.md`

---

## Task 1: gRPC icon off by default

Flip `PREFS_DEFAULTS.grpcIcon` from `"solid"` to `"off"`. Existing users who ever changed any setting keep their persisted value; only fresh profiles get the new default. `RequestRow` needs no code change (it already renders the glyph only when `grpcIcon !== "off"`). Two test files carry default-dependent assertions and must move with the flip.

**Files:**
- Modify: `src/lib/use-prefs.ts:46` (the `grpcIcon` default)
- Test: `src/lib/use-prefs.test.ts:48-50` (default assertion)
- Test: `src/features/catalog/RequestRow.test.tsx:1-67` (add an import; rewrite the first test)
- Unchanged: `src/features/settings/AppearancePane.test.tsx` — its `resetPrefs()` clicks `"solid"` in `beforeEach`, so every test starts at `"solid"` regardless of the default. Do **not** edit it.

- [ ] **Step 1: Update the prefs-default test to expect `"off"`**

In `src/lib/use-prefs.test.ts`, replace the existing default test:

```ts
  it("defaults grpcIcon to 'solid'", () => {
    expect(PREFS_DEFAULTS.grpcIcon).toBe("solid");
  });
```

with:

```ts
  it("defaults grpcIcon to 'off'", () => {
    expect(PREFS_DEFAULTS.grpcIcon).toBe("off");
  });
```

- [ ] **Step 2: Rewrite the RequestRow icon test to match the new default**

In `src/features/catalog/RequestRow.test.tsx`, add this import after the existing import block (after line 7, `import { SidebarProvider } ...`):

```ts
import { setPref } from "@/lib/use-prefs";
```

Then replace the first `it(...)` block (currently `renders the gRPC icon (default solid)`, lines 61-67):

```tsx
  it("renders the gRPC icon (default solid)", () => {
    renderWithSidebar(
      <RequestRow collectionId="c1" req={req("My Req")} cb={makeCb()} />,
    );
    const icon = screen.getByLabelText("grpc");
    expect(icon.getAttribute("data-variant")).toBe("solid");
  });
```

with two tests — the default (no glyph) and a positive case that sets a style:

```tsx
  it("renders no gRPC icon by default (grpcIcon 'off')", () => {
    renderWithSidebar(
      <RequestRow collectionId="c1" req={req("My Req")} cb={makeCb()} />,
    );
    expect(screen.queryByLabelText("grpc")).toBeNull();
    expect(screen.getByText("My Req")).toBeTruthy();
  });

  it("renders the gRPC icon when a style pref is set", () => {
    setPref("grpcIcon", "solid");
    try {
      renderWithSidebar(
        <RequestRow collectionId="c1" req={req("My Req")} cb={makeCb()} />,
      );
      const icon = screen.getByLabelText("grpc");
      expect(icon.getAttribute("data-variant")).toBe("solid");
    } finally {
      setPref("grpcIcon", "off"); // reset the module-level singleton for sibling tests
    }
  });
```

- [ ] **Step 3: Run the two updated test files to verify they FAIL**

Run: `pnpm test src/lib/use-prefs.test.ts src/features/catalog/RequestRow.test.tsx`
Expected: FAIL. `use-prefs.test.ts` fails because the default is still `"solid"`; `RequestRow.test.tsx` "renders no gRPC icon by default" fails because the glyph still renders at the `"solid"` default.

- [ ] **Step 4: Flip the default**

In `src/lib/use-prefs.ts`, in `PREFS_DEFAULTS` (line 46), change:

```ts
  grpcIcon: "solid",
```

to:

```ts
  grpcIcon: "off",
```

- [ ] **Step 5: Run the two test files to verify they PASS**

Run: `pnpm test src/lib/use-prefs.test.ts src/features/catalog/RequestRow.test.tsx`
Expected: PASS (all tests in both files green).

- [ ] **Step 6: Run the full frontend suite + typecheck**

Run: `pnpm test`
Expected: PASS — in particular `src/features/settings/AppearancePane.test.tsx` stays green untouched (its `resetPrefs()` forces `"solid"`).

Run: `pnpm lint`
Expected: PASS (`tsc -b` clean).

- [ ] **Step 7: Commit**

```bash
git add src/lib/use-prefs.ts src/lib/use-prefs.test.ts src/features/catalog/RequestRow.test.tsx
git commit -m "feat(prefs): default gRPC request-list icon to off"
```

---

## Task 2: Methods in `.proto` definition order

Delete the method-level `sort_by` in the core catalog projection so `prost_reflect`'s descriptor order (definition order) survives. Keep the service-level sort. Update the doc comment and the unit test — the current fixture defines `Alpha`'s methods as `Bar, Foo` (coincidentally alphabetical, so it proves nothing); reorder it to `Foo, Bar` (non-alphabetical) and assert the order is preserved.

**Files:**
- Modify: `crates/handshaker-core/src/grpc/catalog/build.rs:6-7` (doc comment), `:23` (delete the sort), `:43-92` (fixture reorder), `:94-112` (test assertions + rename)

- [ ] **Step 1: Reorder the test fixture and rewrite the assertions (the failing test)**

In `crates/handshaker-core/src/grpc/catalog/build.rs`, in `simple_file_with_two_services`, the `Alpha` service currently defines its methods `Bar` then `Foo`. Swap them to `Foo` then `Bar` (keeping `client_streaming`/`server_streaming` on `Bar`). Replace the `Alpha` service's `method: vec![ ... ]`:

```rust
                    method: vec![
                        MethodDescriptorProto {
                            name: Some("Bar".into()),
                            input_type: Some(".test.Empty".into()),
                            output_type: Some(".test.Empty".into()),
                            client_streaming: Some(true),
                            server_streaming: Some(false),
                            ..Default::default()
                        },
                        MethodDescriptorProto {
                            name: Some("Foo".into()),
                            input_type: Some(".test.Empty".into()),
                            output_type: Some(".test.Empty".into()),
                            ..Default::default()
                        },
                    ],
```

with:

```rust
                    method: vec![
                        MethodDescriptorProto {
                            name: Some("Foo".into()),
                            input_type: Some(".test.Empty".into()),
                            output_type: Some(".test.Empty".into()),
                            ..Default::default()
                        },
                        MethodDescriptorProto {
                            name: Some("Bar".into()),
                            input_type: Some(".test.Empty".into()),
                            output_type: Some(".test.Empty".into()),
                            client_streaming: Some(true),
                            server_streaming: Some(false),
                            ..Default::default()
                        },
                    ],
```

Then replace the whole test `catalog_is_sorted_and_method_paths_correct` (lines 94-112):

```rust
    #[test]
    fn catalog_is_sorted_and_method_paths_correct() {
        let pool = build_pool(vec![simple_file_with_two_services()]).unwrap();
        let cat = build_catalog(&pool);
        assert_eq!(cat.services.len(), 2);
        assert_eq!(cat.services[0].full_name, "test.Alpha");
        assert_eq!(cat.services[1].full_name, "test.Beta");

        let alpha = &cat.services[0];
        assert_eq!(alpha.methods.len(), 2);
        assert_eq!(alpha.methods[0].name, "Bar");
        assert_eq!(alpha.methods[0].path, "/test.Alpha/Bar");
        assert!(alpha.methods[0].client_streaming);
        assert!(!alpha.methods[0].server_streaming);
        assert_eq!(alpha.methods[1].name, "Foo");
        assert_eq!(alpha.methods[1].path, "/test.Alpha/Foo");
        assert_eq!(alpha.methods[1].input_message, "test.Empty");
        assert_eq!(alpha.methods[1].output_message, "test.Empty");
    }
```

with:

```rust
    #[test]
    fn services_sorted_methods_in_definition_order() {
        let pool = build_pool(vec![simple_file_with_two_services()]).unwrap();
        let cat = build_catalog(&pool);
        // Services stay alphabetically sorted (fixture defines Beta before Alpha).
        assert_eq!(cat.services.len(), 2);
        assert_eq!(cat.services[0].full_name, "test.Alpha");
        assert_eq!(cat.services[1].full_name, "test.Beta");

        // Methods keep `.proto` definition order (fixture defines Foo before Bar —
        // non-alphabetical, so this fails if the catalog re-sorts them).
        let alpha = &cat.services[0];
        assert_eq!(alpha.methods.len(), 2);
        assert_eq!(alpha.methods[0].name, "Foo");
        assert_eq!(alpha.methods[0].path, "/test.Alpha/Foo");
        assert_eq!(alpha.methods[0].input_message, "test.Empty");
        assert_eq!(alpha.methods[0].output_message, "test.Empty");
        assert_eq!(alpha.methods[1].name, "Bar");
        assert_eq!(alpha.methods[1].path, "/test.Alpha/Bar");
        assert!(alpha.methods[1].client_streaming);
        assert!(!alpha.methods[1].server_streaming);
    }
```

- [ ] **Step 2: Run the test to verify it FAILS**

Run: `cargo test -p handshaker-core services_sorted_methods_in_definition_order`
Expected: FAIL — the method `sort_by` still reorders `Foo, Bar` → `Bar, Foo`, so `alpha.methods[0].name` is `"Bar"`, not the asserted `"Foo"`.

- [ ] **Step 3: Delete the method sort and update the doc comment**

In `crates/handshaker-core/src/grpc/catalog/build.rs`, delete line 23 entirely:

```rust
            methods.sort_by(|a, b| a.name.cmp(&b.name));
```

(The `let mut methods` binding stays `mut` only if still needed — after deleting the sort, `methods` is no longer mutated, so also drop the `mut`: change `let mut methods: Vec<MethodEntry> = s` to `let methods: Vec<MethodEntry> = s`. Leaving `mut` would trip the `unused_mut` lint and fail the build under `-D warnings`.)

Then update the doc comment (lines 6-7):

```rust
/// Snapshot all services in `pool` into a `ServiceCatalog`. Services are sorted by
/// full_name for stable UI rendering.
```

to:

```rust
/// Snapshot all services in `pool` into a `ServiceCatalog`. Services are sorted by
/// full_name for a stable list; methods keep their `.proto` definition order.
```

- [ ] **Step 4: Run the test to verify it PASSES**

Run: `cargo test -p handshaker-core services_sorted_methods_in_definition_order`
Expected: PASS.

- [ ] **Step 5: Run the full workspace test suite**

Run: `cargo test --workspace`
Expected: PASS — including the `crates/handshaker-core/tests/` integration tests, which look services up by name (order-independent) and use single-method services, so method reordering does not affect them.

- [ ] **Step 6: Commit**

```bash
git add crates/handshaker-core/src/grpc/catalog/build.rs
git commit -m "feat(catalog): keep methods in proto definition order"
```

---

## Final gate & merge prep

- [ ] **Full gate green**

Run: `pnpm lint` — Expected: PASS
Run: `pnpm test` — Expected: PASS
Run: `cargo test --workspace` — Expected: PASS

- [ ] **Live smoke (optional but recommended)**

Run: `pnpm tauri:dev`. Verify: a fresh profile (or after `localStorage.removeItem("handshaker.prefs.v1")` in devtools) shows saved requests with **no** gRPC glyph; Settings → Appearance → "gRPC icon" → `solid` brings it back live. Open the MethodPicker on a reflected server and confirm methods are grouped by service with methods in definition (not alphabetical) order.

- [ ] **Squash & archive (at feature completion)**

Per `.claude/rules/squashing-feature-branches.md`, squash the branch into cohesive commits before the fast-forward merge (the two `feat(...)` commits above are already logically independent — keep them, or squash to one). Per `.claude/rules/archiving-completed-work.md`, `git mv` the spec into `docs/superpowers/specs/archive/` and this plan into `docs/superpowers/plans/archive/`, mark this plan's status banner complete, refresh the "Active work" pointer in `CLAUDE.md`, and add a memory + `MEMORY.md` line.

---

## Self-review notes

- **Spec coverage:** Change 1 (default flip + test updates) → Task 1. Change 2 (remove method sort, keep service sort, doc + test) → Task 2. Non-goals (no IPC change, no new pref) respected — no `bindings.ts` regen, no new UI. ✓
- **Type/name consistency:** `grpcIcon`/`"off"`/`setPref` match `src/lib/use-prefs.ts`; the renamed test `services_sorted_methods_in_definition_order` is referenced identically in Steps 2/4. ✓
- **`mut` lint:** Step 3 explicitly drops the now-unused `mut` on `methods` — required under `-D warnings`. ✓
