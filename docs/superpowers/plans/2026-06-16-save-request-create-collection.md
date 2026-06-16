# Save request — создание коллекции из диалога — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать возможность создать новую коллекцию прямо из диалога Save request, даже когда коллекции уже существуют.

**Architecture:** Чистая фронт-правка одного компонента `SaveRequestDialog`. Под деревом-пикером вместо одной контекстной affordance — две: «＋ New collection» (всегда) и «＋ New folder in "X"» (только при выбранном `target`). Неявный признак «что создаём» (`!target`) заменяется явным состоянием `addingKind`. Бэкенд / IPC / bindings не трогаем — `onCreateCollection` уже проброшен.

**Tech Stack:** React 18 + TypeScript, Vitest + @testing-library/react, shadcn UI (`Button`/`Input`).

**Status banner:** 📐 PLAN (готов к исполнению) · 2026-06-16 · ветка — отдельный `claude/*` worktree (создаётся при исполнении), вливается в `main` ff. Спек: [`docs/superpowers/specs/2026-06-16-save-request-create-collection-design.md`](../specs/2026-06-16-save-request-create-collection-design.md).

---

## File Structure

- **Modify:** [`src/features/catalog/SaveRequestDialog.tsx`](../../../src/features/catalog/SaveRequestDialog.tsx) — состояние `adding` → `addingKind`; `commitNew` ветвится по `addingKind`; рендер двух кнопок; удаляется `newLabel`.
- **Modify (tests):** [`src/features/catalog/SaveRequestDialog.test.tsx`](../../../src/features/catalog/SaveRequestDialog.test.tsx) — 3 новых теста в блоке `describe("SaveRequestDialog — contextual New")`.

Никакие другие файлы (`CollectionPicker`, `treeNav`, `savePicker`, `WorkflowApp`, бэкенд) не меняются.

---

## Task 1: Две affordance — «New collection» всегда, «New folder» при выбранном target

**Files:**
- Modify: `src/features/catalog/SaveRequestDialog.tsx`
- Test: `src/features/catalog/SaveRequestDialog.test.tsx`

### Контекст для исполнителя

Сейчас в компоненте:

```ts
const [adding, setAdding] = useState(false);
```

и единственная контекстная подпись:

```ts
const newLabel = !target
  ? "＋ New collection"
  : `＋ New folder in "${selectedNodeName}"`;
```

`commitNew` решает, что создавать, по `!target`. На открытии `target` авто-ставится на первую коллекцию (`SaveRequestDialog.tsx`, эффект на открытие), поэтому при ≥1 коллекции `target` всегда непустой и «New collection» недостижима.

Все существующие тесты используют `getByRole("button", { name: /New folder in/ })` / `/New collection/` — после добавления второй кнопки эти запросы дают по одному совпадению (подписи не пересекаются), так что регрессий нет.

---

- [ ] **Step 1: Написать падающие тесты**

В `src/features/catalog/SaveRequestDialog.test.tsx`, внутри блока `describe("SaveRequestDialog — contextual New", ...)` (после теста `"creates a new collection (pending) and saves into it"`), добавить три теста:

```tsx
  it("offers 'New collection' even when collections already exist", () => {
    render(<SaveRequestDialog {...props()} />);
    expect(screen.getByRole("button", { name: /New collection/ })).toBeTruthy();
  });

  it("creates a new collection while one is already selected, and saves into the new collection", async () => {
    const p = props(); // collections present, c1 selected by default
    render(<SaveRequestDialog {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /New collection/ }));
    fireEvent.change(screen.getByLabelText("New node name"), { target: { value: "Fresh" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(p.onCreateCollection).toHaveBeenCalledWith("Fresh"));
    await waitFor(() =>
      expect(p.onSave).toHaveBeenCalledWith({ collectionId: "c-new", parentId: null, name: "Create" }),
    );
    expect(p.onCreateFolder).not.toHaveBeenCalled();
  });

  it("hides 'New folder' but keeps 'New collection' when there are no collections", () => {
    render(<SaveRequestDialog {...props({ collections: [] })} />);
    expect(screen.queryByRole("button", { name: /New folder/ })).toBeNull();
    expect(screen.getByRole("button", { name: /New collection/ })).toBeTruthy();
  });
```

(Регрессия «New folder создаёт папку под выбранным узлом» уже покрыта существующим тестом `"creates a new folder under the selected collection and saves into it"` — отдельный тест не нужен.)

- [ ] **Step 2: Запустить тесты — убедиться, что новые падают**

Run: `pnpm vitest run src/features/catalog/SaveRequestDialog.test.tsx`
Expected: тест `"offers 'New collection' even when collections already exist"` падает (при `props()` единственная кнопка — «＋ New folder in "My APIs"», `/New collection/` не находится). Тест `"creates a new collection while one is already selected…"` тоже падает. Остальные (включая существующие) — проходят.

- [ ] **Step 3: Заменить состояние `adding` на `addingKind`**

В `src/features/catalog/SaveRequestDialog.tsx` заменить объявление:

```ts
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
```

на:

```ts
  const [addingKind, setAddingKind] = useState<"collection" | "folder" | null>(null);
  const [newName, setNewName] = useState("");
```

В эффекте сброса на открытие диалога заменить строку `setAdding(false);` на:

```ts
      setAddingKind(null);
```

- [ ] **Step 4: Удалить `newLabel`**

Удалить блок (он больше не нужен — подписи теперь заданы прямо в кнопках):

```ts
  const newLabel = !target
    ? "＋ New collection"
    : `＋ New folder in "${selectedNodeName}"`;
```

- [ ] **Step 5: Ветвить `commitNew` по `addingKind`**

Заменить функцию `commitNew` целиком на:

```ts
  function commitNew() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    if (addingKind === "collection") {
      const tempId = newId();
      setPendingCollections((prev) => [...prev, { tempId, name: trimmed }]);
      setTarget({ collectionId: tempId, parentId: null });
    } else if (addingKind === "folder" && target) {
      const tempId = newId();
      setPendingFolders((prev) => [
        ...prev,
        { tempId, collectionId: target.collectionId, parentId: target.parentId, name: trimmed },
      ]);
      setTarget({ collectionId: target.collectionId, parentId: tempId });
    }
    setAddingKind(null);
    setNewName("");
  }
```

- [ ] **Step 6: Рендерить две кнопки вместо одной**

Заменить блок рендера add-affordance (контейнер `<div className="flex items-center gap-2">` с тернарником `adding ? (…) : (<button>{newLabel}</button>)`) на:

```tsx
            <div className="flex items-center gap-2">
              {addingKind !== null ? (
                <>
                  <Input
                    aria-label="New node name"
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitNew();
                      if (e.key === "Escape") { setAddingKind(null); setNewName(""); }
                    }}
                    placeholder="Name"
                    className="h-7 text-xs"
                  />
                  <Button size="sm" onClick={commitNew}>Add</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setAddingKind(null); setNewName(""); }}>Cancel</Button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="text-[11px] text-muted-foreground hover:text-foreground"
                    onClick={() => setAddingKind("collection")}
                  >
                    ＋ New collection
                  </button>
                  {target && (
                    <button
                      type="button"
                      className="text-[11px] text-muted-foreground hover:text-foreground"
                      onClick={() => setAddingKind("folder")}
                    >
                      {`＋ New folder in "${selectedNodeName}"`}
                    </button>
                  )}
                </>
              )}
            </div>
```

- [ ] **Step 7: Запустить тесты файла — убедиться, что всё зелёное**

Run: `pnpm vitest run src/features/catalog/SaveRequestDialog.test.tsx`
Expected: PASS — все тесты файла (новые 3 + существующие).

- [ ] **Step 8: Полный гейт**

Run: `pnpm vitest run` — Expected: PASS, число тестов = прежнее + 3.
Run: `pnpm tsc --noEmit` (или `pnpm exec tsc -b`, как принято в репо) — Expected: 0 ошибок.
Run: `pnpm build` (vite build) — Expected: успешная сборка.

(Бэкенд не затронут — `cargo`/bindings прогонять не нужно.)

- [ ] **Step 9: Commit**

```bash
git add src/features/catalog/SaveRequestDialog.tsx src/features/catalog/SaveRequestDialog.test.tsx
git commit -m "feat(save): create a new collection from Save request dialog

Expose '＋ New collection' alongside '＋ New folder in X' under the picker
so a fresh collection can be made even when collections already exist.
Replace the implicit !target branch with an explicit addingKind state."
```

---

## Self-Review

**1. Spec coverage:**
- Spec «две affordance, New collection всегда / New folder при target» → Steps 4, 6. ✅
- Spec «addingKind: collection | folder» → Steps 3, 5. ✅
- Spec «commitNew ветвится по addingKind, не по !target» → Step 5. ✅
- Spec граничный «нет коллекций → только New collection» → тест в Step 1 (#4) + `{target && …}` в Step 6. ✅
- Spec «applyReco / reco-чип / originBound не трогаем» → план их не касается. ✅
- Spec тесты #1/#2/#4 → Step 1; #3 (регрессия folder) → существующий тест, отмечено. ✅
- Spec гейт vitest+tsc+build → Step 8. ✅

**2. Placeholder scan:** плейсхолдеров нет — весь код приведён целиком.

**3. Type consistency:** `addingKind` типа `"collection" | "folder" | null` используется единообразно в Steps 3/5/6; `setAddingKind(null)` в сбросе, Escape и Cancel; ветка `"folder"` защищена `&& target`, что сужает `target` к non-null для доступа к `target.collectionId`/`target.parentId`. `selectedNodeName` уже вычисляется выше в компоненте и переиспользуется в подписи folder-кнопки.
