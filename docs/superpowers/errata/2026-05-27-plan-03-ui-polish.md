# Errata — Plan #3 UI Polish

> Documents deviations introduced by [Plan #3 UI Polish](../specs/2026-05-27-plan-03-ui-polish-design.md) from prior specifications.

Applies to:
- [Master MVP design (2026-05-26)](../specs/2026-05-26-handshaker-mvp-design.md)
- [Plan #3 — Dynamic Unary Invoke design (2026-05-27)](../specs/2026-05-27-plan-03-dynamic-invoke-design.md)

## Deviations

| # | Document § | Original | Revised | Reason |
|---|---|---|---|---|
| 1 | Plan #3 design D6 / §9.2 (Trailers) | `<details>` collapsible | shadcn Tabs `Body \| Trailers (n)` | Brings closer to master §8.4; direct user request after UX review. |
| 2 | Plan #3 design §9.2 (Trailers 0-key) | "Не рендерим если 0 ключей" | Always render `Trailers (0)` | Layout stability — tabs should not appear/disappear with state. |
| 3 | Plan #3 design §9.3 (Monaco loading) | `lazy(() => import('@monaco-editor/react'))` with default CDN loader | All Monaco setup moved inside `lazy()` factory: parallel dynamic imports of `monaco-editor`, editor + json workers (Vite `?worker`), `@monaco-editor/loader`, `@monaco-editor/react`; `self.MonacoEnvironment` set before `loader.config({ monaco })` inside the factory | Offline-safe for a desktop app; the original UI Polish spec §4.1 had static `import * as monaco` at module top which forced Rollup to bake ~4MB Monaco core into the main bundle (~4MB index.js), breaking §4.4's "Initial bundle ~217KB unchanged" promise. The lazy-factory rewrite (commit `2f2e04b`) restores §4.4 while keeping §9.3's local-bundle goal. |
| 4 | Master §8.4 (StatusBar) | Above the tabs as a separate row | Postman-style: compact pill right of the tab strip | Better horizontal-space utilization; familiar to gRPC users coming from Postman / Bruno / Insomnia. |
| 5 | Plan #3 design §9.2 (status message) | Inline inside StatusBar | Separate inline strip below the tab strip, shown only when `status_code != 0` | StatusBar on the right must stay compact (limited width next to tabs). |
| 6 | Master §9 (Send hotkey) | `⌘↵ / Ctrl+Enter` | Implemented in Plan #3 UI Polish | Master mandate; missed in Plan #3 §13. |

## Implementation notes

- Unused Monaco language workers (ts/css/html) still ship as static asset chunks because Rollup follows the worker-import graph inside `monaco-editor`. They are NEVER spawned at runtime: `self.MonacoEnvironment.getWorker(label)` only returns editor or json workers. Cleanup is a future bundle-hygiene task, out of scope for this sub-plan.
- shadcn `Tabs` ships defaults (`flex gap-2`, `data-[state=active]:bg-background` on TabsTrigger, `rounded-lg p-[3px] bg-muted` on TabsList). Our overrides neutralize `gap-2 → gap-0` and `p-* / bg-*` on TabsList, but the active-tab card-style background remains. This is acceptable for the MVP — pure underline ("variant=line") Postman style is a future visual-polish task.

## Status

All deviations were applied via the implementation plan
`docs/superpowers/plans/2026-05-27-plan-03-ui-polish.md` and merged in the
sub-plan's final commit. Future plans should reference this errata when
revisiting the affected sections.
