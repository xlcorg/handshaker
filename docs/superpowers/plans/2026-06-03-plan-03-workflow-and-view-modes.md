# Workflow & View Modes (Plan #3) — OUTLINE

> ⚠️ **Outline only — NOT execution-ready.** Detail via `superpowers:writing-plans` when reached. Depends on Plans #1–#2.

**Goal:** Multiple workflows + the three view modes (Лента / Список / Фокус) with the titlebar workflow-history selector and view switcher; step list, rail, delete + drag reorder.

**Spec refs:** §3.4 (workflows in main area, titlebar selector), §4 (three modes), §10 (delete+drag, re-run in place, stable ids, mode remembered per workflow, rail click stays in Focus).

## Outline tasks
- [ ] Titlebar: workflow-history selector (switch/create) + view switcher (Лента/Список/Фокус); env pill placeholder.
- [ ] Лента view: ledger of steps; only active expanded; collapsed rows with status; "свернуть все".
- [ ] Список view: master-detail (step list + one focused step).
- [ ] Фокус view: thin rail with status dots; rail click switches focused step without leaving Focus (extend Plan #1 FocusView).
- [ ] View mode persisted per workflow (store field already on `Workflow`).
- [ ] Step delete + drag-reorder (reducers `removeStep`/`reorderStep` from Plan #1 wired to UI).
- [ ] Re-run in place (Send replaces outcome), edit mutates same step (already true from Plan #1).

## 🧹 /clear-checkpoint at completion.
