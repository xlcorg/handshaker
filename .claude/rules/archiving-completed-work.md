# Archiving completed plans & specs

When a feature is fully done — all plan tasks implemented and committed, the plan's
status banner marked complete (e.g. «🎉 DONE» / «🎉 feature-complete») and the work
merged to `main` — **move** its plan file(s) and the matching spec into the archive:

- plans → `docs/superpowers/plans/archive/`
- specs → `docs/superpowers/specs/archive/`

Move them with `git mv` (preserves history), in a single commit shaped like
`docs(archive): <feature> plan+spec`. Only ACTIVE documents stay in `plans/` / `specs/`.

After moving:
- Update the **«Active work»** section in `CLAUDE.md`: make the just-finished feature
  the new «Последняя влитая», demote the prior one to «Предыдущая», and push the
  older «Предыдущая» down into the «Завершённые фичи» bullet list as a one-liner.
- Update the memory index (`MEMORY.md`) if it referenced the plan.

The source of truth for any feature's status is its plan/spec status banner in
`archive/`, not the one-line summary in `CLAUDE.md`.
