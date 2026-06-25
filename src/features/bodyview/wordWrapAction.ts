import { messages } from "@/lib/messages";
import type { DisposableLike } from "./editorLike";

interface WordWrapActionDescriptor {
  id: string;
  label: string;
  contextMenuGroupId?: string;
  contextMenuOrder?: number;
  run(): void;
}

/** The slice of the Monaco editor we need to register the word-wrap action.
 *  The real `IStandaloneCodeEditor` satisfies this structurally. */
export interface WordWrapMenuEditor {
  addAction(descriptor: WordWrapActionDescriptor): DisposableLike;
}

// Own group, sorted after "1_folding" and before "9_cutcopypaste*": in the
// response menu the item sits below Collapse/Expand-all and above copy/save;
// in the request menu it forms its own slice.
const GROUP_VIEW = "2_view";

/**
 * Register the word-wrap toggle in the editor's right-click menu. The label
 * reflects the CURRENT wrap state (from messages.ts), reading as the action a
 * click performs. Monaco fixes an action's label at registration time, so the
 * caller re-attaches (dispose + re-add) when the pref changes — cheap, toggling
 * is rare. Carries NO keybinding (Alt+Z / ⌥⌘Z stays owned by the window-level
 * listener; Monaco's built-in is unbound in monaco.ts), so the global last-wins
 * keybinding registry is untouched — same reasoning as foldActions/decodeActions.
 * Returns a disposable that removes the action.
 */
export function attachWordWrapAction(
  editor: WordWrapMenuEditor,
  wrapped: boolean,
  onToggle: () => void,
): DisposableLike {
  return editor.addAction({
    id: "hs.toggleWordWrap",
    label: messages.bodyview.menu.wordWrap(wrapped),
    contextMenuGroupId: GROUP_VIEW,
    contextMenuOrder: 1,
    run: onToggle,
  });
}
