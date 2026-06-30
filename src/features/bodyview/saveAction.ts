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

// Same group as Collapse/Expand all ("1_folding"), ordered after them (order 3),
// so "Save response to file…" sits with the document-wide actions at the top.
const GROUP_FOLDING = "1_folding";

/** Register "Save response to file…" as a document-wide right-click action in the
 *  response editor. No precondition (always available) and NO keybinding — the
 *  Ctrl/Cmd+S hotkey is handled at the panel level (Monaco `addCommand` is global
 *  last-wins, so binding a key here would clobber the request editor). `onSave`
 *  saves the FULL response body. Returns a disposable that removes the action. */
export function attachSaveResponseAction(editor: SaveMenuEditor, onSave: () => void): DisposableLike {
  return editor.addAction({
    id: "hs.saveResponse",
    label: messages.response.save.toFileMenu,
    contextMenuGroupId: GROUP_FOLDING,
    contextMenuOrder: 3,
    run: () => onSave(),
  });
}
