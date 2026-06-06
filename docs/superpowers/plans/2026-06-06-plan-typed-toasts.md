# Typed Toasts for Optimistic Collection Ops — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** not started · **Branch:** redesign/workflow-ui-spec-plans ·
**Spec:** [docs/superpowers/specs/2026-06-06-typed-toasts-design.md](../specs/2026-06-06-typed-toasts-design.md)

**Goal:** Show the result of every optimistic collection operation as a transient
toast — success (check icon) and error (red, with rollback) — replacing the
persistent sidebar error banner.

**Architecture:** Extend the existing custom toast store with a `type` field
(`success | error | info`, default `info`); render colour + lucide icon by type;
thread a `{ ok?, err }` label pair through the single `optimistic()` helper in
`useCatalogTree`; remove the sidebar error banner and the hook's `error` state.

**Tech Stack:** React 18, TypeScript, Vitest + Testing Library, Tailwind,
lucide-react (already in deps).

**Build/test commands:** `pnpm test <path>` (vitest), `pnpm exec tsc --noEmit`
(typecheck). Run from repo root.

---

## File Structure

- `src/lib/toast.ts` — add `ToastType`, `type` on `ToastItem`, `type` param on `toast()`.
- `src/components/ui/toaster.tsx` — colour + icon per `type`; `role="alert"` for errors.
- `src/lib/clipboard.ts` — pass `"error"` for the clipboard-failure toast.
- `src/features/catalog/useCatalogTree.ts` — `labels` arg on `optimistic()`, toasts,
  direct toasts in `reload`/`duplicateItem`, then removal of `error`/`setError`.
- `src/features/catalog/SidebarShell.tsx` — delete error banner.
- Tests: `toast.test.ts`, `toaster.test.tsx`, `useCatalogTree.test.ts`,
  `SidebarShell.test.tsx`.

Sequencing keeps every commit compiling: types first (1–3), then additive toasts in
the hook keeping `error` (4), then banner removal (5), then `error`-state removal (6).

---

## Task 1: Toast model + API gains a `type`

**Files:**
- Modify: `src/lib/toast.ts`
- Test: `src/lib/toast.test.ts`

- [ ] **Step 1: Add the failing test**

Append inside the `describe("toast store", ...)` block in `src/lib/toast.test.ts`:

```ts
  it("defaults type to info and records an explicit type", () => {
    toast("plain");
    toast("boom", "error");
    const state = toastStore.getState();
    expect(state[0]).toMatchObject({ message: "plain", type: "info" });
    expect(state[1]).toMatchObject({ message: "boom", type: "error" });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/toast.test.ts`
Expected: FAIL — `type` is `undefined` (property missing on `ToastItem`).

- [ ] **Step 3: Implement the type + param**

In `src/lib/toast.ts`, replace the `ToastItem` interface and the `toast` function:

```ts
export type ToastType = "success" | "error" | "info";

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}
```

```ts
/** Show a transient toast; returns its id. */
export function toast(message: string, type: ToastType = "info"): string {
  const item: ToastItem = { id: newId(), message, type };
  items = [...items, item];
  emit();
  return item.id;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/toast.test.ts`
Expected: PASS (all cases, including the existing two).

- [ ] **Step 5: Commit**

```bash
git add src/lib/toast.ts src/lib/toast.test.ts
git commit -m "feat(toast): add toast type (success/error/info), default info"
```

---

## Task 2: Toaster renders colour + icon by type

**Files:**
- Modify: `src/components/ui/toaster.tsx`
- Test: `src/components/ui/toaster.test.tsx`

- [ ] **Step 1: Add the failing tests**

Append inside the `describe("Toaster", ...)` block in
`src/components/ui/toaster.test.tsx`:

```tsx
  it("styles an error toast with the destructive class and an alert role", () => {
    render(<Toaster />);
    act(() => { toast("boom", "error"); });
    const row = screen.getByText("boom").closest("[role='alert']");
    expect(row).not.toBeNull();
    expect(row!.className).toContain("bg-destructive");
  });

  it("renders a success toast with the neutral pill (no destructive class)", () => {
    render(<Toaster />);
    act(() => { toast("Сохранено", "success"); });
    const row = screen.getByText("Сохранено").closest("div");
    expect(row!.className).toContain("bg-foreground");
    expect(row!.className).not.toContain("bg-destructive");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/components/ui/toaster.test.tsx`
Expected: FAIL — no `role="alert"` row; both rows share the same neutral class.

- [ ] **Step 3: Implement per-type rendering**

Replace the entire contents of `src/components/ui/toaster.tsx` with:

```tsx
import { useEffect, useSyncExternalStore } from "react";
import { Check, CircleAlert } from "lucide-react";
import { toastStore } from "@/lib/toast";
import type { ToastType } from "@/lib/toast";

const TOAST_MS = 1800;

export function Toaster() {
  const toasts = useSyncExternalStore(
    toastStore.subscribe,
    toastStore.getState,
    toastStore.getState,
  );
  return (
    <div
      className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <ToastRow key={t.id} id={t.id} message={t.message} type={t.type} />
      ))}
    </div>
  );
}

function ToastRow({ id, message, type }: { id: string; message: string; type: ToastType }) {
  useEffect(() => {
    const h = setTimeout(() => toastStore.dismiss(id), TOAST_MS);
    return () => clearTimeout(h);
  }, [id]);
  const isError = type === "error";
  const palette = isError
    ? "bg-destructive text-destructive-foreground"
    : "bg-foreground text-background";
  return (
    <div
      role={isError ? "alert" : undefined}
      className={`pointer-events-auto flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs shadow-lg ${palette}`}
    >
      {type === "success" ? <Check className="size-3.5" aria-hidden /> : null}
      {isError ? <CircleAlert className="size-3.5" aria-hidden /> : null}
      <span>{message}</span>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/components/ui/toaster.test.tsx`
Expected: PASS (including the existing auto-dismiss test — the message text is now
inside a `<span>`, still found by `getByText`).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/toaster.tsx src/components/ui/toaster.test.tsx
git commit -m "feat(toaster): colour + icon per toast type, alert role for errors"
```

---

## Task 3: Clipboard failure toast is typed `error`

**Files:**
- Modify: `src/lib/clipboard.ts`

- [ ] **Step 1: Update the failure call**

In `src/lib/clipboard.ts`, change the catch-branch toast:

```ts
  } catch {
    toast("Не удалось скопировать", "error");
  }
```

(The success call `toast(okMessage)` stays as-is — it defaults to `info`.)

- [ ] **Step 2: Typecheck + run any clipboard tests**

Run: `pnpm exec tsc --noEmit`
Expected: PASS (no type errors).
Run: `pnpm test src/lib/clipboard` (if a test file exists; otherwise skip).
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/clipboard.ts
git commit -m "feat(clipboard): mark copy-failure toast as error type"
```

---

## Task 4: Thread `labels` through `optimistic()` and emit toasts

This task is additive — `error`/`setError` stay in place (removed in Task 6) so the
existing `result.current.error` assertions keep passing.

**Files:**
- Modify: `src/features/catalog/useCatalogTree.ts`
- Test: `src/features/catalog/useCatalogTree.test.ts`

- [ ] **Step 1: Add failing tests for toast emission**

In `src/features/catalog/useCatalogTree.test.ts`, add a toast mock at the top
(after the existing `vi.mock("@/ipc/client", ...)` block, before the `import { ipc }`):

```ts
vi.mock("@/lib/toast", () => ({ toast: vi.fn() }));
```

Add the import alongside the others:

```ts
import { toast } from "@/lib/toast";
```

Add these tests inside the `describe("optimistic mutations + rollback", ...)` block:

```ts
  it("emits a success toast when an operation with an ok label resolves", async () => {
    const { result } = await loaded();
    vi.mocked(ipc.collectionRenameItem).mockResolvedValue(undefined);
    await act(async () => { await result.current.renameItem("c1", "r1", "Renamed"); });
    expect(toast).toHaveBeenCalledWith("Реквест переименован", "success");
  });

  it("emits an error toast and rolls back when the operation rejects", async () => {
    const { result } = await loaded();
    vi.mocked(ipc.collectionRenameItem).mockRejectedValue({ message: "boom" });
    await act(async () => {
      await expect(result.current.renameItem("c1", "r1", "Renamed")).rejects.toBeTruthy();
    });
    expect(result.current.tree[0].items[0].name).toBe("r1"); // reverted
    expect(toast).toHaveBeenCalledWith("Не удалось переименовать реквест", "error");
  });

  it("emits no success toast for setPinned (ok label omitted)", async () => {
    const { result } = await loaded();
    vi.mocked(ipc.collectionUpsert).mockResolvedValue(undefined);
    await act(async () => { await result.current.setPinned("c1", true); });
    expect(toast).not.toHaveBeenCalledWith(expect.anything(), "success");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/features/catalog/useCatalogTree.test.ts`
Expected: FAIL — `toast` not called (helper does not emit toasts yet).

- [ ] **Step 3: Add the toast import and update `optimistic`**

In `src/features/catalog/useCatalogTree.ts`, add to the imports:

```ts
import { toast } from "@/lib/toast";
```

Replace the `optimistic` callback (currently lines ~97-110) with:

```ts
  /** Apply a local transform, run the IPC call, toast the result, roll back on rejection. */
  const optimistic = useCallback(
    async (
      next: (prev: CollectionIpc[]) => CollectionIpc[],
      call: () => Promise<unknown>,
      labels: { ok?: string; err: string },
    ) => {
      const snapshot = treeRef.current;
      apply(next(snapshot));
      try {
        await call();
        if (labels.ok) toast(labels.ok, "success");
      } catch (e) {
        apply(snapshot);
        setError(errMsg(e));
        toast(labels.err, "error");
        throw e;
      }
    },
    [apply],
  );
```

- [ ] **Step 4: Pass labels at every `optimistic` call-site**

Replace each call-site body in `src/features/catalog/useCatalogTree.ts` with the
versions below (third argument added to every `optimistic(...)` call):

```ts
  const createCollection = useCallback(
    async (name: string) => {
      const c = emptyCollection(name);
      await optimistic((prev) => [...prev, c], () => ipc.collectionUpsert(c), {
        ok: "Коллекция создана",
        err: "Не удалось создать коллекцию",
      });
      return c.id;
    },
    [optimistic],
  );

  const deleteCollection = useCallback(
    (collectionId: string) =>
      optimistic(
        (prev) => removeCollectionFromTree(prev, collectionId),
        () => ipc.collectionDelete(collectionId),
        { ok: "Коллекция удалена", err: "Не удалось удалить коллекцию" },
      ),
    [optimistic],
  );

  const renameCollection = useCallback(
    (collectionId: string, name: string) =>
      optimistic(
        (prev) => renameCollectionInTree(prev, collectionId, name),
        () => ipc.collectionUpsert(treeRef.current.find((c) => c.id === collectionId)!),
        { ok: "Коллекция переименована", err: "Не удалось переименовать коллекцию" },
      ),
    [optimistic],
  );

  const setPinned = useCallback(
    (collectionId: string, pinned: boolean) =>
      optimistic(
        (prev) => setCollectionPinned(prev, collectionId, pinned),
        () => ipc.collectionUpsert(treeRef.current.find((c) => c.id === collectionId)!),
        { err: "Не удалось обновить закрепление" },
      ),
    [optimistic],
  );

  const addItem = useCallback(
    (collectionId: string, parentId: string | null, item: ItemIpc) =>
      optimistic(
        (prev) => insertItemInTree(prev, collectionId, parentId, item),
        () => ipc.collectionAddItem(collectionId, parentId, item),
        { ok: "Реквест добавлен", err: "Не удалось добавить реквест" },
      ),
    [optimistic],
  );

  const renameItem = useCallback(
    (collectionId: string, itemId: string, name: string) =>
      optimistic(
        (prev) => renameItemInTree(prev, collectionId, itemId, name),
        () => ipc.collectionRenameItem(collectionId, itemId, name),
        { ok: "Реквест переименован", err: "Не удалось переименовать реквест" },
      ),
    [optimistic],
  );

  const updateItemContent = useCallback(
    (collectionId: string, itemId: string, content: SavedRequestIpc) =>
      optimistic(
        (prev) => replaceItemInTree(prev, collectionId, itemId, content),
        () => ipc.collectionUpsert(treeRef.current.find((c) => c.id === collectionId)!),
        { ok: "Сохранено", err: "Не удалось сохранить" },
      ),
    [optimistic],
  );

  const deleteItem = useCallback(
    (collectionId: string, itemId: string) =>
      optimistic(
        (prev) => removeItemFromTree(prev, collectionId, itemId),
        () => ipc.collectionDeleteItem(collectionId, itemId),
        { ok: "Реквест удалён", err: "Не удалось удалить реквест" },
      ),
    [optimistic],
  );

  const moveItem = useCallback(
    (collectionId: string, itemId: string, parentId: string | null, position: number) =>
      optimistic(
        (prev) => moveItemWithinTree(prev, collectionId, itemId, parentId, position),
        () => ipc.collectionMoveItem(collectionId, itemId, parentId, position),
        { err: "Не удалось переместить" },
      ),
    [optimistic],
  );

  const moveItemAcross = useCallback(
    (
      sourceCollectionId: string,
      itemId: string,
      targetCollectionId: string,
      parentId: string | null,
      position: number,
    ) =>
      optimistic(
        (prev) => moveItemAcrossTree(prev, sourceCollectionId, itemId, targetCollectionId, parentId, position),
        () => ipc.collectionMoveItemAcross(sourceCollectionId, itemId, targetCollectionId, parentId, position),
        { err: "Не удалось переместить" },
      ),
    [optimistic],
  );
```

- [ ] **Step 5: Add direct toasts to `reload` and `duplicateItem`**

In `reload`, update the catch block (currently `setError(errMsg(e));`):

```ts
    } catch (e) {
      setError(errMsg(e));
      toast(errMsg(e), "error");
    } finally {
```

Replace the `duplicateItem` callback with the toast-emitting version:

```ts
  // Backend assigns the new id and deep-copies; reload the affected collection.
  const duplicateItem = useCallback(
    async (collectionId: string, itemId: string) => {
      try {
        await ipc.collectionDuplicateItem(collectionId, itemId);
        const fresh = await ipc.collectionGet(collectionId);
        apply(treeRef.current.map((c) => (c.id === collectionId ? fresh : c)));
        toast("Реквест продублирован", "success");
      } catch (e) {
        setError(errMsg(e));
        toast("Не удалось продублировать реквест", "error");
        throw e;
      }
    },
    [apply],
  );
```

- [ ] **Step 6: Run tests + typecheck to verify they pass**

Run: `pnpm test src/features/catalog/useCatalogTree.test.ts`
Expected: PASS — new toast tests + all existing tests (incl. `error` assertions).
Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/catalog/useCatalogTree.ts src/features/catalog/useCatalogTree.test.ts
git commit -m "feat(catalog): toast success/error for optimistic operations"
```

---

## Task 5: Remove the sidebar error banner

**Files:**
- Modify: `src/features/catalog/SidebarShell.tsx`

- [ ] **Step 1: Delete the banner block**

In `src/features/catalog/SidebarShell.tsx`, delete this block (lines ~128-132):

```tsx
      {cat.error ? (
        <div className="border-t border-destructive bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
          {cat.error}
        </div>
      ) : null}
```

- [ ] **Step 2: Run the sidebar tests + typecheck**

Run: `pnpm test src/features/catalog/SidebarShell.test.tsx`
Expected: PASS (no test asserts the banner).
Run: `pnpm exec tsc --noEmit`
Expected: PASS (`cat.error` is still defined on the hook at this point).

- [ ] **Step 3: Commit**

```bash
git add src/features/catalog/SidebarShell.tsx
git commit -m "refactor(catalog): drop persistent error banner in favour of toasts"
```

---

## Task 6: Remove `error` state from the hook

**Files:**
- Modify: `src/features/catalog/useCatalogTree.ts`
- Test: `src/features/catalog/useCatalogTree.test.ts`, `src/features/catalog/SidebarShell.test.tsx`

- [ ] **Step 1: Drop the `error` assertions from the hook tests**

In `src/features/catalog/useCatalogTree.test.ts`, remove these three lines:
- `expect(result.current.error).toBe("boom");` (in "rolls back when the IPC call rejects")
- `expect(result.current.error).toBe("disk full");` (in "updateItemContent rolls back…")
- `expect(result.current.error).toBe("boom");` (in "rolls back moveItem when the IPC rejects")

The rollback behaviour in those tests is still asserted by the surrounding
`tree`/`JSON.stringify` checks and the `rejects.toBeTruthy()` expectations.

- [ ] **Step 2: Run the hook tests to verify they still fail/compile-error appropriately**

Run: `pnpm exec tsc --noEmit`
Expected: PASS for the test file (assertions removed). The implementation still has
`error`, so nothing breaks yet.

- [ ] **Step 3: Remove `error`/`setError` from the implementation**

In `src/features/catalog/useCatalogTree.ts`:

Remove from the `UseCatalogTree` interface:

```ts
  error: string | null;
```

Remove the state declaration:

```ts
  const [error, setError] = useState<string | null>(null);
```

Remove every `setError(...)` line (in `reload` — both the `setError(null)` reset and
the catch; in `optimistic` catch; in `duplicateItem` catch). The `reload` catch
becomes:

```ts
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
```

The `optimistic` catch becomes:

```ts
      } catch (e) {
        apply(snapshot);
        toast(labels.err, "error");
        throw e;
      }
```

The `duplicateItem` catch becomes:

```ts
      } catch (e) {
        toast("Не удалось продублировать реквест", "error");
        throw e;
      }
```

Remove `error` from the returned object (the `return { ... }` block at the end).

- [ ] **Step 4: Drop `error` from the SidebarShell test mock**

In `src/features/catalog/SidebarShell.test.tsx`, remove this line from `makeTreeHook`:

```ts
    error: null as string | null,
```

- [ ] **Step 5: Run full test suite + typecheck**

Run: `pnpm test src/features/catalog/ src/lib/toast.test.ts src/components/ui/toaster.test.tsx`
Expected: PASS.
Run: `pnpm exec tsc --noEmit`
Expected: PASS — no remaining references to `.error` on the catalog hook.

- [ ] **Step 6: Commit**

```bash
git add src/features/catalog/useCatalogTree.ts src/features/catalog/useCatalogTree.test.ts src/features/catalog/SidebarShell.test.tsx
git commit -m "refactor(catalog): remove error state, errors now flow through toasts"
```

---

## Final verification

- [ ] Run the full front-end test suite: `pnpm test`
- [ ] Typecheck: `pnpm exec tsc --noEmit`
- [ ] Manual smoke (optional): trigger a save and a failing op; confirm a green-check
      toast and a red alert toast appear bottom-centre and auto-dismiss.

---

## Spec coverage check

- §2.1 model/API (`type`, default `info`, back-compat) → Task 1.
- §2.2 render (colour, icons, `role="alert"`) → Task 2.
- §2.1 clipboard error type → Task 3.
- §2.3 `labels` on `optimistic`, success/error toasts, reload/duplicate direct toasts → Task 4.
- §2.4 + §1 banner removal → Task 5.
- §2.3 `error`/`setError` removal → Task 6.
- §3 message catalogue (12 pairs) → Task 4 call-sites + duplicate/reload.
- §5 tests → Tasks 1, 2, 4, 6.
- §4 reload-error-now-transient trade-off → Task 4 Step 5 / Task 6 Step 3 (reload toasts).
