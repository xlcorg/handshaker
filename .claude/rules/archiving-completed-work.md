# Archiving completed plans & specs

When a feature is fully done — all plan tasks implemented and committed, the plan's
status banner marked complete (e.g. «🎉 DONE» / «🎉 feature-complete») and the work
merged to `main` — **move** its plan file(s) and the matching spec into the archive:

- plans → `docs/superpowers/plans/archive/`
- specs → `docs/superpowers/specs/archive/`

Move them with `git mv` (preserves history), in a single commit shaped like
`docs(archive): <feature> plan+spec`. Only ACTIVE documents stay in `plans/` / `specs/`.

After moving:
- Update the **"Active work"** section in `CLAUDE.md`: replace the "Latest merged" entry
  with the just-finished feature as a **compact** entry — name · one-sentence gist ·
  `archive/` plan-banner path · memory link (~4 lines, NOT a full writeup). Keep only the
  single latest entry; the prior one is **dropped** — its history already lives in git and
  in its `archive/` plan banner.
- Do **not** maintain an in-file changelog of shipped features in `CLAUDE.md`. The
  file is loaded in full every session; keep it lean (best practice: well under 200
  lines). Completed-feature detail belongs in the `archive/` plan banner, not here.
- Update the memory index (`MEMORY.md`) if it referenced the plan.

The source of truth for any feature's status is its plan/spec status banner in
`archive/`, not the one-line summary in `CLAUDE.md`.
