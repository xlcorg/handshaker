# Squashing a finished feature branch

Before a feature branch (`claude/*`) is fast-forwarded into `main`, **squash** its
work-in-progress commits into exactly **one commit per feature** (1 feature =
1 commit). The many small TDD/red-green/review-fix commits from the session must
**not** land on `main`.

Do this once the feature is fully done and reviewed (all plan tasks implemented,
gate green, `🎉 DONE` banner set), as the last step before the ff-merge.

- Squash via `git rebase -i main` (or `git reset --soft $(git merge-base main HEAD)`
  then a fresh commit) so the branch becomes 1–N cohesive commits, then rebase onto
  the current `main` tip and fast-forward-merge — this keeps `main` linear.
- Message = Conventional Commits with a scope, as elsewhere in the log
  (`feat(workflow): …`, `fix(tls): …`, `docs(archive): …`). The subject describes the
  **feature**, not the last fix; the body may summarize what shipped.
- A second commit is allowed only when the branch genuinely carries an **unrelated**
  independent change (e.g. a feature + an unrelated refactor) — that's a different
  feature, so it gets its own single commit. Don't manufacture splits, and don't
  preserve intermediate "WIP"/"fix review"/"green" commits.
- The `chore(release): vX.Y.Z` version-bump commit stays its own commit, after the
  squashed feature commit.
