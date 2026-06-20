/**
 * Shared focus-visible ring for custom (non-<Button>) interactive elements.
 * A COMPACT variant of the shadcn Button focus ring: ring-2 (not ring-[3px]) with
 * ring-offset-0 and no border shift, so it fits tight icon buttons and titlebar
 * controls without changing their size or layout. Visible only on keyboard focus.
 */
export const compactFocusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-0";
