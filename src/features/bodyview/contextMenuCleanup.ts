// Monaco's standalone editor injects a "Command Palette" entry
// (`editor.action.quickCommand`, group `z_commands`) into the right-click context
// menu by default. We don't want it there — F1 still opens the palette; only the
// menu item is removed. Monaco exposes no public API for this, so we wrap the
// context-menu contribution's internal `_getMenuActions`.

const SEPARATOR_ID = "vs.actions.separator";
const QUICK_COMMAND_ID = "editor.action.quickCommand";
const CONTEXT_MENU_CONTRIB_ID = "editor.contrib.contextmenu";

interface MenuItemLike {
  id?: string;
}

/**
 * Drop the "Command Palette" item from a context-menu action list and tidy the
 * separators the removal leaves behind — no leading, trailing, or adjacent
 * dividers. Pure (unit-tested); the editor wiring lives in
 * `installContextMenuCleanup`.
 */
export function stripCommandPalette<T extends MenuItemLike>(actions: readonly T[]): T[] {
  const out: T[] = [];
  for (const action of actions) {
    if (action.id === QUICK_COMMAND_ID) continue;
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

interface ContextMenuContribLike {
  _getMenuActions?: (...args: unknown[]) => MenuItemLike[];
}

interface EditorWithContrib {
  getContribution(id: string): unknown;
}

/**
 * Remove the built-in "Command Palette" entry from this editor's right-click menu.
 * Idempotent per editor instance. Guarded against Monaco internals changing: if
 * the contribution or its `_getMenuActions` method is absent, this is a no-op
 * (the item simply stays) rather than throwing.
 */
export function installContextMenuCleanup(editor: EditorWithContrib): void {
  const contrib = editor.getContribution(CONTEXT_MENU_CONTRIB_ID) as ContextMenuContribLike | null;
  const original = contrib?._getMenuActions;
  if (!contrib || typeof original !== "function") return;
  contrib._getMenuActions = function (...args: unknown[]) {
    return stripCommandPalette(original.apply(contrib, args));
  };
}
