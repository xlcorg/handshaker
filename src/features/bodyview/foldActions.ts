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
