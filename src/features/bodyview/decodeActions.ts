import type { DisposableLike, ModelLike, PositionLike } from "./editorLike";
import type { JsonTree } from "./jsonTree";
import type { ValueSpan } from "./spans";
import { stringValueAtOffset } from "./valueAtOffset";
import { looksLikeBase64 } from "./decode";

export interface ContextKeyLike {
  set(value: boolean): void;
}

export interface DecodeActionDescriptor {
  id: string;
  label: string;
  contextMenuGroupId?: string;
  contextMenuOrder?: number;
  precondition?: string;
  run(editor: DecodeEditorLike): void;
}

/** Structural slice of Monaco's IStandaloneCodeEditor used by the decode actions. */
export interface DecodeEditorLike {
  getModel(): ModelLike | null;
  getPosition(): PositionLike | null;
  createContextKey<T>(key: string, defaultValue: T): ContextKeyLike;
  addAction(descriptor: DecodeActionDescriptor): DisposableLike;
  onContextMenu(listener: (e: { target: { position: PositionLike | null } }) => void): DisposableLike;
}

export interface DecodeActionDeps {
  getTree(): JsonTree | null;
  getSpans(): readonly ValueSpan[];
  /** Open the decode dialog for this whole value. */
  onDecode(value: string): void;
  /** Copy the raw string value. */
  onCopy(value: string): void;
  /** Decode + native Save-As of this whole value. */
  onSave(value: string): void;
}

const GROUP = "9_cutcopypaste";
const KEY = "hsValueIsB64";

function valueAtCursor(editor: DecodeEditorLike, deps: DecodeActionDeps): string | null {
  const model = editor.getModel();
  const pos = editor.getPosition();
  const tree = deps.getTree();
  if (!model || !pos || !tree) return null;
  return stringValueAtOffset(tree, deps.getSpans(), model.getOffsetAt(pos));
}

/**
 * Register the response-body context-menu actions (Decode / Copy value / Save
 * decoded to file…). Actions carry NO keybinding — only `contextMenuGroupId` —
 * so Monaco's global (last-wins) keybinding registry is never touched. Decode and
 * Save are gated by the `hsValueIsB64` context key, recomputed on each right-click.
 */
export function attachDecodeActions(editor: DecodeEditorLike, deps: DecodeActionDeps): DisposableLike {
  const gate = editor.createContextKey<boolean>(KEY, false);

  const ctxSub = editor.onContextMenu((e) => {
    const model = editor.getModel();
    const pos = e.target.position;
    const tree = deps.getTree();
    if (!model || !pos || !tree) {
      gate.set(false);
      return;
    }
    const v = stringValueAtOffset(tree, deps.getSpans(), model.getOffsetAt(pos));
    gate.set(!!v && looksLikeBase64(v));
  });

  const decode = editor.addAction({
    id: "hs.decodeBase64",
    label: "Decode base64",
    contextMenuGroupId: GROUP,
    contextMenuOrder: 3,
    precondition: KEY,
    run: (ed) => {
      const v = valueAtCursor(ed, deps);
      if (v) deps.onDecode(v);
    },
  });

  const copy = editor.addAction({
    id: "hs.copyValue",
    label: "Copy value",
    contextMenuGroupId: GROUP,
    contextMenuOrder: 3.1,
    run: (ed) => {
      const v = valueAtCursor(ed, deps);
      if (v) deps.onCopy(v);
    },
  });

  const save = editor.addAction({
    id: "hs.saveDecoded",
    label: "Save decoded to file…",
    contextMenuGroupId: GROUP,
    contextMenuOrder: 3.2,
    precondition: KEY,
    run: (ed) => {
      const v = valueAtCursor(ed, deps);
      if (v) deps.onSave(v);
    },
  });

  return {
    dispose() {
      decode.dispose();
      copy.dispose();
      save.dispose();
      ctxSub.dispose();
    },
  };
}
