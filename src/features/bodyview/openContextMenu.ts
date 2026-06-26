// Monaco refuses to open its context menu when the right-click lands on a view
// zone: ContextMenuController._onContextMenu preventDefaults the event (killing
// the native menu) and then early-returns for any target that isn't
// CONTENT_TEXT / CONTENT_EMPTY / TEXTAREA. The request body's ghost-skeleton
// hint IS a view zone, so right-clicking it yields no menu at all. We forward
// such clicks here: grab the same context-menu contribution and open the menu
// ourselves at the cursor. Guarded against Monaco internals changing — a no-op
// rather than a throw if the contribution or the method is absent.
//
// Anchor is an `{ x, y }` IAnchor in PAGE coordinates (e.pageX/e.pageY) — that's
// what Monaco's own StandardMouseEvent.posx/posy carry, so the menu lands exactly
// where a normal right-click would.

// Same contribution id contextMenuCleanup.ts uses (Monaco's stable contrib id).
const CONTEXT_MENU_CONTRIB_ID = "editor.contrib.contextmenu";

interface ContextMenuContribLike {
  showContextMenu?: (anchor: { x: number; y: number }) => void;
}

interface EditorWithContrib {
  getContribution(id: string): unknown;
}

/** Open the editor's native context menu at page point (x, y). Used to make the
 *  ghost-zone hint right-clickable — Monaco won't open the menu over a view zone. */
export function openEditorContextMenu(editor: EditorWithContrib, x: number, y: number): void {
  const contrib = editor.getContribution(CONTEXT_MENU_CONTRIB_ID) as ContextMenuContribLike | null;
  contrib?.showContextMenu?.({ x, y });
}
