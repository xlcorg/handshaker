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

export interface DisposableLike {
  dispose(): void;
}

/** The editor's contextmenu event, structurally typed so tests need no real Monaco. */
interface EditorContextMenuEvent {
  /** MouseTargetType of what was clicked (CONTENT_VIEW_ZONE, CONTENT_TEXT, …). */
  target: { type: number };
  /** Page-coordinate mouse event (posx/posy = pageX/pageY) + native-menu suppressor. */
  event: { posx: number; posy: number; preventDefault(): void };
}

interface ContextMenuEditorLike extends EditorWithContrib {
  onContextMenu(listener: (e: EditorContextMenuEvent) => void): DisposableLike;
}

/** Open the editor's native context menu at page point (x, y). Used to make the
 *  ghost-zone hint right-clickable — Monaco won't open the menu over a view zone. */
export function openEditorContextMenu(editor: EditorWithContrib, x: number, y: number): void {
  const contrib = editor.getContribution(CONTEXT_MENU_CONTRIB_ID) as ContextMenuContribLike | null;
  contrib?.showContextMenu?.({ x, y });
}

/**
 * Make right-clicks on a view zone open the editor's context menu. Monaco emits
 * `onContextMenu` for every right-click (that's how its own ContextMenuController
 * is reached), but the controller then refuses to show the menu when the target
 * is a view zone — so a right-click on the request body's ghost-skeleton hint
 * yields no menu at all. We subscribe to the same event and, for view-zone
 * targets only, open the menu ourselves at the cursor. Text/empty/etc. targets
 * are left to Monaco's own handler (no double menu). Returns the subscription.
 *
 * `viewZoneTargetType` is `monaco.editor.MouseTargetType.CONTENT_VIEW_ZONE` —
 * passed in so this stays free of a monaco-editor import (and unit-testable).
 */
export function forwardViewZoneContextMenu(
  editor: ContextMenuEditorLike,
  viewZoneTargetType: number,
): DisposableLike {
  return editor.onContextMenu((e) => {
    if (e.target.type !== viewZoneTargetType) return;
    e.event.preventDefault(); // suppress the native menu (Monaco bails for zones)
    openEditorContextMenu(editor, e.event.posx, e.event.posy);
  });
}
