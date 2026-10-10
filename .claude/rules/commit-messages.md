# Commit messages

- Conventional Commits with a scope, as elsewhere in the log
  (`feat(workflow): …`, `fix(tls): …`, `docs(archive): …`).
- **No trailers**: do not append `Co-authored-by` / `Co-Authored-By` (or any other
  attribution/`Generated with` trailer) to commit messages. If the commit tool
  injects one onto an unpushed commit, rewrite that commit to drop the trailer
  before pushing. Do not approve a commit that still contains the trailer.
