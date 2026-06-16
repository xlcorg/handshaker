// Monaco's standalone editor injects items into the right-click context menu that
// we want gone: the "Command Palette" entry (`editor.action.quickCommand`, group
// `z_commands`) in every editor, and — in the read-only response viewer, where it
// duplicates our own "Copy value" — the built-in "Copy" (`…clipboardCopyAction`).
// Only the MENU items are removed; the F1 palette and the Ctrl+C keybinding stay.
// Monaco exposes no public API for this, so we wrap the context-menu
// contribution's internal `_getMenuActions`.

const SEPARATOR_ID = "vs.actions.separator";
const QUICK_COMMAND_ID = "editor.action.quickCommand";
const COPY_ID = "editor.action.clipboardCopyAction";
const CONTEXT_MENU_CONTRIB_ID = "editor.contrib.contextmenu";

interface MenuItemLike {
  id?: string;
}

/**
 * Drop the items in `removeIds` from a context-menu action list and tidy the
 * separators the removal leaves behind — no leading, trailing, or adjacent
 * dividers. Pure (unit-tested); the editor wiring lives in
 * `installContextMenuCleanup`.
 */
export function stripMenuItems<T extends MenuItemLike>(
  actions: readonly T[],
  removeIds: ReadonlySet<string>,
): T[] {
  const out: T[] = [];
  for (const action of actions) {
    if (action.id !== undefined && removeIds.has(action.id)) continue;
    // Skip a separator that would be leading or adjacent to another separator.
    if (
      action.id === SEPARATOR_ID &&
      (out.length === 0 || out[out.length - 1].id === SEPARATOR_ID)
    ) {
      continue;
    }
    out.push(action);
  }
  while (out.length > 0 && out[out.length - 1].id === SEPARATOR_ID) out.pop();
  return out;
}

/** Convenience: strip just the "Command Palette" item (back-compat helper). */
export function stripCommandPalette<T extends MenuItemLike>(actions: readonly T[]): T[] {
  return stripMenuItems(actions, new Set([QUICK_COMMAND_ID]));
}

interface ContextMenuContribLike {
  _getMenuActions?: (...args: unknown[]) => MenuItemLike[];
}

interface EditorWithContrib {
  getContribution(id: string): unknown;
}

export interface ContextMenuCleanupOptions {
  /** Also remove the built-in "Copy" item (response viewer: it duplicates "Copy value"). */
  stripCopy?: boolean;
}

/**
 * Remove the built-in "Command Palette" entry (and, with `stripCopy`, the built-in
 * "Copy") from this editor's right-click menu. Idempotent per editor instance.
 * Guarded against Monaco internals changing: if the contribution or its
 * `_getMenuActions` method is absent, this is a no-op (the items simply stay)
 * rather than throwing.
 */
export function installContextMenuCleanup(
  editor: EditorWithContrib,
  opts: ContextMenuCleanupOptions = {},
): void {
  const contrib = editor.getContribution(CONTEXT_MENU_CONTRIB_ID) as ContextMenuContribLike | null;
  const original = contrib?._getMenuActions;
  if (!contrib || typeof original !== "function") return;
  const removeIds = new Set([QUICK_COMMAND_ID]);
  if (opts.stripCopy) removeIds.add(COPY_ID);
  contrib._getMenuActions = function (...args: unknown[]) {
    return stripMenuItems(original.apply(contrib, args), removeIds);
  };
}
