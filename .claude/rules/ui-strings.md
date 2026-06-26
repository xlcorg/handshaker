---
paths:
  - "src/**/*.{ts,tsx}"
---

# User-facing strings — single source of truth

Every string shown to the user **must** live in `src/lib/messages.ts`, never as an
inline literal in a component. Reason: changing language (i18n) must be one edit in one
file, not a project-wide grep. `messages.ts` is the English-first slice meant to grow
into full runtime i18n.

- Add new copy under the relevant namespace in `src/lib/messages.ts` (create a new
  namespace like `shell.titlebar` if none fits), then import `messages` and reference it.
- State-dependent copy is a function, e.g. `wordWrap(wrapped: boolean)` →
  `"Enable word wrap"` / `"Disable word wrap"`.
- When editing a component that still has inline user-facing strings, centralize the
  strings in *that file* as a focused cleanup — don't leave a freshly-centralized string
  sitting next to inline siblings.
- Keep non-user-facing strings OUT of `messages.ts`: test ids, `data-testid`, ARIA role
  values, internal keys, CSS classes. Key glyphs in shortcut hints (`Alt`, `⌘`, `V`)
  stay as `<Kbd>` elements in the component; only the prose around them is centralized.
