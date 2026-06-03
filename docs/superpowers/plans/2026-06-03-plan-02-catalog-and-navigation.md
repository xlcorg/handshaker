# Catalog & Navigation (Plan #2) — OUTLINE

> ⚠️ **Outline only — NOT execution-ready.** Detail each task (TDD, full code, exact paths) via `superpowers:writing-plans` when reached, after Plan #1 lands. Depends on Plan #1's workflow store and actions.

**Goal:** Sidebar-as-collection navigation + service-first ⌘K finder + service tree panel (curated ↔ contract), so a call can be created without typing service/method by hand (replaces Plan #1's temporary New-call entry).

**Spec refs:** §3.1 (sidebar=collection), §3.2 (⌘K service-first), §3.3 (service tree panel), §5 (create-call flow), §10 (manual catalog, fuzzy, full keyboard).

## Outline tasks
- [ ] Collection model: `Collection` (curated k8s services) + `CatalogService` (address, third-party flag, favorite, proto-services → curated methods). Frontend session store.
- [ ] Add-service-manually flow (type host:port → add to collection).
- [ ] Reflection-backed service tree: call `grpcDescribe` / `grpcRefreshContract`; merge contract methods with curated set; markers ● in-collection / ○ in-contract; "Обновить контракт".
- [ ] Sidebar component: favorites + collection tree (service → proto-service → ● method); filter input; click method → `createStepFromMethod` (Plan #1) → opens Focus.
- [ ] ⌘K command palette: stage 1 fuzzy service search; stage 2 method list within service; keys ↵ / ⌥↵ (new workflow) / Esc / ↑↓.
- [ ] Service panel "+ в коллекцию" (curate ○ → ●) and "→ создать вызов" (●).
- [ ] Remove Plan #1 temporary New-call inputs.

## 🧹 /clear-checkpoint at completion.
