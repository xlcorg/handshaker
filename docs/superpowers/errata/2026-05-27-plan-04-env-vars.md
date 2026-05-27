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
| 3 | Plan #4 Task 16 (`VariablesTable.tsx` empty-row) | Empty-row rendered outside the `rows` array with hard-coded `value=""`; typing fires `materializeEmpty(key)` which appends a new row to the array | Empty-row is now part of the `rows` array (always the last element) with a stable id from a module-level counter. Typing in it calls `updateRow(idx, {key})` which mutates the row in place; when the row was empty and gains a non-empty key, a NEW empty-row is appended at the end | The original code had a hard bug, not just a UX glitch: every keystroke in the empty-row created a new one-character row, because the `value=""` controlled prop kept resetting the input on every render. The user reported: "когда нажимаю на add variable и начинаю печатать, то на каждое нажатие создается отдельная строка." Fix preserves React keys across the empty→real promotion so the input keeps focus and accumulates typed characters normally. Also resolves the dead `"__empty__"` id constant noted in the per-task review by removing the constant entirely (the trailing-empty distinction is now positional, `idx === rows.length - 1 && key === ""`). Applied in commit (TBD — recorded in PR). |

## Implementation notes

- **Manual UI smoke (Plan §9.4) requires desktop interaction** and was not executable in the implementation session. The 14-step checklist remains pending and should be executed by the user before merging. All Rust tests (76 passed, 1 ignored), `pnpm lint`, and `pnpm build` are clean.
- **Code-quality reviewer's predicted UX glitch in `VariablesTable.tsx` turned out to be a real, blocking bug** (see deviation #3). Both the focus-loss concern and the dead `"__empty__"` constant are resolved by the rewrite that promotes the empty-row into the rows array with a stable id.
- **Two code-quality reviewer suggestions on test tightness** in `vars/mod.rs` (`cycle_two_node` and `cycle_three_node` use loose `chain.contains(...)` assertions vs. asserting the exact chain `["a", "b", "a"]`) were noted as Minor / non-blocking and left at the plan's verbatim form. Tightening them is a low-risk follow-up that would harden regression detection.

## Status

Deviations 1 and 2 were applied during the implementation plan execution and merged into the development branch `claude/plan-04-env-vars`. Future plans touching the Monaco custom language should reference deviation #1 when restructuring the tokenizer (e.g., when JSON schema diagnostics land in Plan #4b). Future tauri-specta IPC types involving `HashMap<String, String>` should expect the `Partial<...>` shape and either coerce at the boundary (recommended: in `src/ipc/client.ts` wrappers) or filter inline as deviation #2 does.
