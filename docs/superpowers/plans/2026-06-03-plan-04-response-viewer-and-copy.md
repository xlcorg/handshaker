# Response Viewer & Copy (Plan #4) — OUTLINE

> ⚠️ **Outline only — NOT execution-ready.** Detail via `superpowers:writing-plans` when reached. Depends on Plan #1 (replaces the reused `ResponsePanel` in Focus).

**Goal:** Custom collapsible JSON response viewer with double-click-to-copy, in-response search, Postman-style large-payload handling, and Postman-style gRPC error rendering.

**Spec refs:** §6 (copy: dbl-click value→clipboard, string w/o quotes, scalar as-is, object compact JSON), §10 (custom JSON viewer w/ collapse; Ctrl+F; virtualization + size threshold + "download"; errors Postman-style).

## Outline tasks
- [ ] Pure JSON-tree model: parse response_json → nodes (key, value, type, path, collapsed).
- [ ] Double-click-copy logic (TDD): string→unquoted, number/bool→as-is, object/array→compact JSON; respond to long values (truncate display, copy full).
- [ ] Virtualized tree renderer (visible nodes only); lazy expand; size threshold → degrade (skip pretty/highlight) + "download response".
- [ ] In-response search (Ctrl+F) with match highlight + next/prev.
- [ ] gRPC error rendering Postman-style: status code + message prominent; decoded `google.rpc` details + trailing metadata in tabs.
- [ ] Swap custom viewer into FocusView (and Лента/Список cells) replacing reused `ResponsePanel`.

## 🧹 /clear-checkpoint at completion.
