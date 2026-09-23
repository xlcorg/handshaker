# Session cadence — executing a feature across sessions

Work flows through Matt Pocock's skills: `/to-spec` (or `/grill-with-docs`) writes
`.scratch/<feature>/spec.md` → `/to-tickets` splits it into
`.scratch/<feature>/issues/NN-<slug>.md` → `/implement` executes tickets one at a time
(TDD via `/tdd`), each ticket in an isolated `claude/*` worktree branch.

- **`/clear`** between tickets → re-read the spec + the next open ticket → continue.
- **`/compact`** only mid-ticket, when context fills up.
- Ticket boundaries are the natural checkpoints — end a session after a ticket lands.

## Minimal post-`/clear` handoff

All state lives in `CLAUDE.md` ("Active work") plus the ticket files' `Status:` lines
and `## Comments`. A handoff is **one step + the path**, e.g.:

> Continue. Next ticket: `.scratch/<feature>/issues/03-<slug>.md`.

Default execution mode is **subagent-driven** (don't ask): dispatch one subagent per
ticket, review its diff, then move on. The agent reads the spec and ticket itself for
the rest of the details.
