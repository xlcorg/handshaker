# gRPC Icon Toggle (Off option) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user fully hide the gRPC icon next to saved requests by adding an `off` value to the existing gRPC-icon style toggle; the request label slides left to take the freed space.

**Architecture:** Pure frontend. Widen the `grpcIcon` pref from `GrpcIconStyle` to a new `GrpcIconPref = GrpcIconStyle | "off"` union (the presentational `GrpcIcon` component's 4-variant contract is untouched). `RequestRow` gates both icon render sites on `grpcIcon !== "off"` (TypeScript narrows the value back to `GrpcIconStyle` for the `variant` prop). The text shift is automatic — the icon is a flex sibling with `gap-0.5`, so removing it collapses the gap. The Settings toggle group gains an `off` option first.

**Tech Stack:** React 18 + TypeScript, Radix ToggleGroup (shadcn wrapper), Vitest + Testing Library, prefs persisted in `localStorage`.

**Status banner for the spec on completion:** mark `docs/superpowers/specs/2026-06-27-grpc-icon-toggle-design.md` as 🎉 DONE when merged.

---

### Task 1: Widen the `grpcIcon` pref to allow `"off"`

**Files:**
- Modify: `src/lib/use-prefs.ts` (type `GrpcIconStyle` at line 4; `Prefs.grpcIcon` at line 24; default at line 42)
- Test: `src/lib/use-prefs.test.ts` (the `describe("grpcIcon pref", …)` block, ~lines 36-51)

- [ ] **Step 1: Add a failing test for the persisted `"off"` value**

In `src/lib/use-prefs.test.ts`, inside the existing `describe("grpcIcon pref", () => { … })` block, add a third test after the existing two:

```ts
  it("merges a persisted grpcIcon:'off' over defaults", () => {
    localStorage.setItem("handshaker.prefs.v1", JSON.stringify({ grpcIcon: "off" }));
    // readPrefs() reflects the module-loaded snapshot; assert the merge shape instead.
    const merged = { ...PREFS_DEFAULTS, grpcIcon: "off" as const };
    expect(merged.grpcIcon).toBe("off");
    expect(typeof readPrefs().grpcIcon).toBe("string");
  });
```

- [ ] **Step 2: Run the test to verify it passes structurally but tsc will reject the type**

Run: `pnpm test -- --run src/lib/use-prefs.test.ts`
Expected: PASS at runtime (the merge is a plain object), but the goal is the type change — proceed to make `"off"` a legal `grpcIcon` value. (If `as const` on a bare `"off"` triggers a tsc error in the editor that's expected until Step 3.)

- [ ] **Step 3: Add the `GrpcIconPref` union and widen the pref field**

In `src/lib/use-prefs.ts`, just after the `GrpcIconStyle` type (line 4), add:

```ts
export type GrpcIconStyle = "solid" | "letter" | "outline" | "circle";
/** gRPC-icon preference: any of the visual styles, or `"off"` to hide the icon entirely. */
export type GrpcIconPref = GrpcIconStyle | "off";
```

Change the `Prefs` field (currently `grpcIcon: GrpcIconStyle;` at line 24) to:

```ts
  grpcIcon: GrpcIconPref;
```

Leave the default unchanged (`grpcIcon: "solid",` at line 42) — icons stay on by default.

- [ ] **Step 4: Run tsc and the test to verify both pass**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.
Run: `pnpm test -- --run src/lib/use-prefs.test.ts`
Expected: PASS (all grpcIcon tests, including the new `"off"` merge test).

- [ ] **Step 5: Commit**

```bash
git add src/lib/use-prefs.ts src/lib/use-prefs.test.ts
git commit -m "feat(prefs): allow grpcIcon='off' to hide the gRPC indicator"
```

---

### Task 2: Gate the icon render and add the `off` toggle option

**Files:**
- Modify: `src/features/catalog/RequestRow.tsx` (destructure at line 31; render sites at lines 90 and 129)
- Modify: `src/features/settings/AppearancePane.tsx` (import + the "gRPC icon" `SettingsRow`, lines 14-20 and 52-62)
- Test: `src/features/settings/AppearancePane.test.tsx` (adds an `off`-behavior test alongside the existing gRPC-icon tests)

- [ ] **Step 1: Write the failing test for hiding the icon**

In `src/features/settings/AppearancePane.test.tsx`, inside the `describe("AppearancePane", …)` block, add a new test after the existing `"switching the toggle re-renders the request row icon live"` test:

```ts
  it("selecting 'off' hides the request row icon but keeps the label", () => {
    render(
      <SidebarProvider>
        <AppearancePane />
        <RequestRow collectionId="c1" req={req("Test")} cb={makeCb()} />
      </SidebarProvider>,
    );

    // Icon present at the default "solid".
    expect(screen.getByLabelText("grpc")).toBeInTheDocument();

    // Click the "off" option in the gRPC icon ToggleGroup.
    const grpcTextEl = screen.getByText("gRPC icon");
    const rowEl = grpcTextEl.closest("div.flex") as HTMLElement;
    fireEvent.click(within(rowEl).getByLabelText("off"));

    // pref is "off", icon gone, request label still rendered (text took the space).
    expect(readPrefs().grpcIcon).toBe("off");
    expect(screen.queryByLabelText("grpc")).toBeNull();
    expect(screen.getByText("Test")).toBeInTheDocument();
  });
```

Note: the `resetPrefs()` helper (lines 13-21) re-clicks `"solid"` before each test, so this test starts from `"solid"` and the icon is present initially.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- --run src/features/settings/AppearancePane.test.tsx`
Expected: FAIL — `getByLabelText("off")` finds no element (the toggle has no `off` option yet), so the click line throws.

- [ ] **Step 3: Add the `off` option to the Settings toggle**

In `src/features/settings/AppearancePane.tsx`:

Update the import: `GrpcIconStyle` is only used by the cast you're about to change, so swap it for `GrpcIconPref` (don't keep both — `GrpcIconStyle` would be left unused). The `use-prefs` import block (lines 14-20) becomes:

```tsx
import {
  usePrefs,
  type GrpcIconPref,
  type MethodGroupStyle,
  type VarHighlightScheme,
  ZOOM_MIN,
  ZOOM_MAX,
} from "@/lib/use-prefs";
```

Change the "gRPC icon" `SettingsRow` (lines 52-62) to add `off` first and widen the cast:

```tsx
        <SettingsRow
          title="gRPC icon"
          hint="Style of the gRPC method icon in the request list. Off hides it."
          control={
            <ToggleGroup
              value={prefs.grpcIcon}
              onValueChange={(v) => setPref("grpcIcon", v as GrpcIconPref)}
              options={["off", "solid", "letter", "outline", "circle"]}
            />
          }
        />
```

- [ ] **Step 4: Gate the icon render in `RequestRow`**

In `src/features/catalog/RequestRow.tsx`, the destructure at line 31 stays as-is:

```tsx
  const [{ grpcIcon }] = usePrefs();
```

Wrap the render site in the editing branch (line 90), from:

```tsx
            <GrpcIcon variant={grpcIcon} className="flex-none" />
```

to:

```tsx
            {grpcIcon !== "off" && <GrpcIcon variant={grpcIcon} className="flex-none" />}
```

Wrap the render site in the non-editing branch (line 129), from:

```tsx
              <GrpcIcon variant={grpcIcon} className="flex-none" />
```

to:

```tsx
              {grpcIcon !== "off" && <GrpcIcon variant={grpcIcon} className="flex-none" />}
```

The `grpcIcon !== "off"` guard narrows the value to `GrpcIconStyle`, so `variant={grpcIcon}` stays type-correct.

- [ ] **Step 5: Run the new test to verify it passes**

Run: `pnpm test -- --run src/features/settings/AppearancePane.test.tsx`
Expected: PASS (the new `off` test plus all existing gRPC-icon tests).

- [ ] **Step 6: Run the full gate**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.
Run: `pnpm test -- --run`
Expected: PASS, full suite green.
Run: `pnpm build`
Expected: `✓ built` (tsc + vite).

- [ ] **Step 7: Commit**

```bash
git add src/features/catalog/RequestRow.tsx src/features/settings/AppearancePane.tsx src/features/settings/AppearancePane.test.tsx
git commit -m "feat(catalog): hide gRPC icon when grpcIcon='off'; label takes the space"
```

---

## After implementation

- Live WebView2 pass: switch the gRPC-icon setting to `off` → the indicator disappears and the request label shifts left; switch back to a style → the chosen icon returns; the choice survives an app restart (localStorage).
- Mark the spec `docs/superpowers/specs/2026-06-27-grpc-icon-toggle-design.md` banner 🎉 DONE and archive plan+spec per `.claude/rules/archiving-completed-work.md` once merged to `main`; update the **Active work** section of `CLAUDE.md`.
