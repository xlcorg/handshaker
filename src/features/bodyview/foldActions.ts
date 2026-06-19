import type { DisposableLike } from "./editorLike";

/** The slice of the Monaco editor we need to drive folding. Keeps unit tests
 *  free of the full editor (and of importing monaco-editor). `IStandaloneCodeEditor`
 *  satisfies this structurally. */
export interface FoldableEditor {
  getAction(id: string): { run(): unknown } | null | undefined;
}

/** Collapse every foldable region (Monaco built-in). */
export function foldAll(editor: FoldableEditor): void {
  editor.getAction("editor.foldAll")?.run();
}

/** Expand every folded region (Monaco built-in). */
export function unfoldAll(editor: FoldableEditor): void {
  editor.getAction("editor.unfoldAll")?.run();
}

interface FoldActionDescriptor {
  id: string;
  label: string;
  contextMenuGroupId?: string;
  contextMenuOrder?: number;
  run(): void;
}

/** Editor surface needed to register the fold context-menu actions. The real
 *  `IStandaloneCodeEditor` satisfies this (it has both `getAction` and `addAction`). */
export interface FoldMenuEditor extends FoldableEditor {
  addAction(descriptor: FoldActionDescriptor): DisposableLike;
}

// Own group, sorted before the decode/clipboard group ("9_cutcopypaste*") so
// Collapse/Expand sit at the top of the menu with a divider beneath them.
const GROUP_FOLDING = "1_folding";

/**
 * Register "Collapse all" / "Expand all" in the response editor's right-click
 * menu (driving Monaco's built-in fold-all / unfold-all). Document-wide actions,
 * so no precondition — they're available on every right-click. Carry NO
 * keybinding (only `contextMenuGroupId`), so Monaco's global last-wins keybinding
 * registry is untouched. Returns a disposable that removes both actions.
 */
export function attachFoldActions(editor: FoldMenuEditor): DisposableLike {
  const collapse = editor.addAction({
    id: "hs.collapseAll",
    label: "Collapse all",
    contextMenuGroupId: GROUP_FOLDING,
    contextMenuOrder: 1,
    run: () => foldAll(editor),
  });
  const expand = editor.addAction({
    id: "hs.expandAll",
    label: "Expand all",
    contextMenuGroupId: GROUP_FOLDING,
    contextMenuOrder: 2,
    run: () => unfoldAll(editor),
  });
  return {
    dispose() {
      collapse.dispose();
      expand.dispose();
    },
  };
}
