import type { EditorLike, DisposableLike } from "./editorLike";
import type { JsonTree } from "./jsonTree";
import type { ValueSpan } from "./spans";
import { copyAtOffset } from "./copyAtOffset";
import { copyToClipboard } from "@/lib/clipboard";
import { toastSnippet } from "./copyValue";

export interface BodyControllerDeps {
  getTree: () => JsonTree | null;
  getSpans: () => readonly ValueSpan[];
  /** Resolve which elided node a badge click landed on; response pane only. */
  getBadgeNodeIdAt?: (offset: number) => string | null;
  /** Host re-renders with this node expanded; response pane only. */
  onBadgeExpand?: (nodeId: string) => void;
}

export const BADGE_CLASS = "bodyview-badge";

export function attachBodyController(editor: EditorLike, deps: BodyControllerDeps): DisposableLike {
  const sub = editor.onMouseDown((e) => {
    const model = editor.getModel();
    const pos = e.target.position;
    if (!model || !pos) return;
    const offset = model.getOffsetAt(pos);

    // Badge click (single click on the injected badge element).
    if (e.target.element?.classList.contains(BADGE_CLASS) && deps.getBadgeNodeIdAt && deps.onBadgeExpand) {
      const nodeId = deps.getBadgeNodeIdAt(offset);
      if (nodeId) { e.event.browserEvent.preventDefault(); deps.onBadgeExpand(nodeId); }
      return;
    }

    // Ctrl/Cmd + double-click → rich copy.
    if ((e.event.ctrlKey || e.event.metaKey) && e.event.detail === 2) {
      const tree = deps.getTree();
      if (!tree) return;
      const text = copyAtOffset(tree, deps.getSpans(), offset);
      if (text !== null) {
        e.event.browserEvent.preventDefault();
        void copyToClipboard(text, `Скопировано: ${toastSnippet(text)}`);
      }
    }
  });
  return sub;
}
