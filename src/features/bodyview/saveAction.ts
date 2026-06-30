import type { DisposableLike } from "./editorLike";
import { messages } from "@/lib/messages";

interface SaveActionDescriptor {
  id: string;
  label: string;
  contextMenuGroupId?: string;
  contextMenuOrder?: number;
  run(): void;
}

/** Editor surface needed to register the save action. The real
 *  `IStandaloneCodeEditor` satisfies this (it has `addAction`). */
export interface SaveMenuEditor {
  addAction(descriptor: SaveActionDescriptor): DisposableLike;
}

// Own divider-separated group, sorted AFTER the fold group ("1_folding") and
// BEFORE word-wrap ("2_view") and the value copy/save groups ("9_*"). Result:
// "Save response to file…" renders directly below Collapse/Expand all (adjacent,
// near the top — it's a primary action), but in its OWN group so the export
// action is visually separated from the fold (view) actions. This follows
// context-menu best practice: group commands by task category and divide groups
// with separators (NN/g; mirrors VS Code, which never mixes fold and file
// actions in one section).
const GROUP_SAVE = "1_save";

/** Register "Save response to file…" as a document-wide right-click action in the
 *  response editor. No precondition (always available) and NO keybinding — the
 *  Ctrl/Cmd+S hotkey is handled at the panel level (Monaco `addCommand` is global
 *  last-wins, so binding a key here would clobber the request editor). `onSave`
 *  saves the FULL response body. Returns a disposable that removes the action. */
export function attachSaveResponseAction(editor: SaveMenuEditor, onSave: () => void): DisposableLike {
  return editor.addAction({
    id: "hs.saveResponse",
    label: messages.response.save.toFileMenu,
    contextMenuGroupId: GROUP_SAVE,
    contextMenuOrder: 1,
    run: () => onSave(),
  });
}
