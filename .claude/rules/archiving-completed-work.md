# Archiving completed work

Active work lives in `.scratch/<feature>/` (spec + tickets, see
`docs/agents/issue-tracker.md`). Only ACTIVE features stay there.

When a feature is fully done — every ticket `Status: resolved` (or `wontfix`), the gate
green, and the work merged to `main` — **move** the whole feature directory into the
archive with `git mv` (preserves history):

- `.scratch/<feature>/` → `docs/archive/<YYYY-MM-DD>-<feature>/`

One commit shaped like `docs(archive): <feature>`. Pre-2026-09 plans/specs from the
retired plan-based flow live flat under `docs/archive/plans/` and `docs/archive/specs/`;
leave them where they are.

After moving:
- Update the **"Active work"** section in `CLAUDE.md`: replace the "Latest merged" entry
  with the just-finished feature as a **compact** entry — name · one-sentence gist ·
  `docs/archive/...` spec path · memory link (~4 lines, NOT a full writeup). Keep only
  the single latest entry; the prior one is **dropped** — its history already lives in
  git and in its archived spec.
- Do **not** maintain an in-file changelog of shipped features in `CLAUDE.md`. The
  file is loaded in full every session; keep it lean (well under 200 lines).
- Update the memory index (`MEMORY.md`) if it referenced the feature directory.

The source of truth for any feature's status is its archived spec/tickets, not the
one-line summary in `CLAUDE.md`.
