# Session cadence — executing a large plan across sessions

- **`/clear`** between tasks / sub-plans → re-read the active plan → continue.
- **`/compact`** only mid-task, when context fills up.
- Plan files mark phase boundaries with **🧹 /clear checkpoint** — end the session there
  and start a fresh one.

## Minimal post-`/clear` handoff

All state already lives in `CLAUDE.md` plus the active plan's status banner (status,
branch, commits, follow-ups, commands). No need to repeat it in the handoff message.
A handoff is **one step + the path to the plan**, e.g.:

> Continue. Next step — Plan #N: `docs/superpowers/plans/2026-06-03-plan-0N-*.md`.
> It's an outline — detail it to TDD, then execute.

If the plan is already TDD-detailed — "continue from the first unfinished task", e.g.:

> Continue. Plan-01: `docs/superpowers/plans/2026-06-06-plan-01-backend-persistence.md`
> — execute task by task, subagent-driven.

Default execution mode is **subagent-driven** (don't ask). The agent reads the plan
banner itself for the rest of the details.
