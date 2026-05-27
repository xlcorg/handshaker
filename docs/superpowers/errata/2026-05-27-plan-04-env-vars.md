# Errata — Plan #4 Env + Vars

> Documents deviations introduced during implementation of [Plan #4](../plans/2026-05-27-plan-04-env-vars.md) from the verbatim code blocks in the plan and design spec.

Applies to:
- [Plan #4 design spec (2026-05-27)](../specs/2026-05-27-plan-04-env-vars-design.md)
- [Plan #4 implementation plan (2026-05-27)](../plans/2026-05-27-plan-04-env-vars.md)

## Deviations

| # | Document § | Original | Revised | Reason |
|---|---|---|---|---|
| 1 | Plan #4 Task 14 / Design §7.1 (Monaco grammar) | Single-state Monarch tokenizer with `[/"(?:[^"\\]|\\.)*"/, "string"]` as a sibling rule to the `{{var}}` rule | Two-state tokenizer with a `@string` sub-state that re-applies the variable rule inside string contents; root state transitions via `[/"/, { token: "string.quote", next: "@string" }]` | Monarch's string rule matches atomically — it consumes the entire `"{{uid}}"` in one match and emits a single `string` token, **before** the variable rule ever gets a chance to scan inside. The plan's grammar would have highlighted `{{var}}` only at the top level of a JSON document, not inside string values — defeating the primary use case (`"{{token}}"` inside a request body JSON). Fix: nested state pattern. Applied in commit `1c63340`. |
| 2 | Plan #4 Task 17 (`EditEnvDialog.tsx` load) | `setVars(cur?.variables ?? {})` | Defensive coercion loop that strips `undefined` values: `for (const [k, v] of Object.entries(cur.variables)) { if (typeof v === "string") loaded[k] = v; }` | tauri-specta emits `EnvironmentIpc.variables: Partial<{ [key in string]: string }>` for Rust `HashMap<String, String>` (the index-signature value type is widened to `string \| undefined`). The plan's verbatim line did not typecheck against `Record<string, string>` expected by `VariablesTable`. Coercion is purely defensive — backend never emits `undefined`. Applied in commit `4301595`. |

## Implementation notes

- **Manual UI smoke (Plan §9.4) requires desktop interaction** and was not executable in the implementation session. The 14-step checklist remains pending and should be executed by the user before merging. All Rust tests (76 passed, 1 ignored), `pnpm lint`, and `pnpm build` are clean.
- **Code-quality reviewer flagged minor UX issues** in `VariablesTable.tsx` that match the plan verbatim and were intentionally not fixed inline (preserving plan fidelity): (a) the empty-row input loses focus when materializing a new row (jarring typing UX); (b) a dead `"__empty__"` id constant in `fromRows` — the empty-row is rendered as JSX outside the `rows` array and never carries this id. Both are candidates for a follow-up polish task; neither breaks the feature.
- **Two code-quality reviewer suggestions on test tightness** in `vars/mod.rs` (`cycle_two_node` and `cycle_three_node` use loose `chain.contains(...)` assertions vs. asserting the exact chain `["a", "b", "a"]`) were noted as Minor / non-blocking and left at the plan's verbatim form. Tightening them is a low-risk follow-up that would harden regression detection.

## Status

Deviations 1 and 2 were applied during the implementation plan execution and merged into the development branch `claude/plan-04-env-vars`. Future plans touching the Monaco custom language should reference deviation #1 when restructuring the tokenizer (e.g., when JSON schema diagnostics land in Plan #4b). Future tauri-specta IPC types involving `HashMap<String, String>` should expect the `Partial<...>` shape and either coerce at the boundary (recommended: in `src/ipc/client.ts` wrappers) or filter inline as deviation #2 does.
