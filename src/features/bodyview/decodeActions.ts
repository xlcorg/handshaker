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

/** Mouse event slice — we only need the right-button flag and the click position. */
export interface DecodeMouseEventLike {
  event: { rightButton: boolean };
  target: { position: PositionLike | null };
}

/** Structural slice of Monaco's IStandaloneCodeEditor used by the decode actions. */
export interface DecodeEditorLike {
  getModel(): ModelLike | null;
  createContextKey<T>(key: string, defaultValue: T): ContextKeyLike;
  addAction(descriptor: DecodeActionDescriptor): DisposableLike;
  onMouseDown(listener: (e: DecodeMouseEventLike) => void): DisposableLike;
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

/**
 * Register the response-body context-menu actions (Decode / Copy value / Save
 * decoded to file…). Actions carry NO keybinding — only `contextMenuGroupId` —
 * so Monaco's global (last-wins) keybinding registry is never touched.
 *
 * The `hsValueIsB64` gate (controls Decode/Save visibility) is computed on
 * `onMouseDown` for the RIGHT button: mousedown fires before the `contextmenu`
 * event Monaco's context-menu controller uses to build the menu, so the
 * precondition is already correct when the menu is assembled. (A listener added
 * via onContextMenu would run AFTER the menu is built — first-click-misses /
 * off-by-one.) The value at the clicked position is stashed and reused by the
 * action `run`s, so the menu and the action always operate on the same value.
 */
export function attachDecodeActions(editor: DecodeEditorLike, deps: DecodeActionDeps): DisposableLike {
  const gate = editor.createContextKey<boolean>(KEY, false);
  // Value under the most recent right-click — what the menu was built for.
  let clicked: string | null = null;

  const mouseSub = editor.onMouseDown((e) => {
    if (!e.event.rightButton) return;
    const model = editor.getModel();
    const pos = e.target.position;
    const tree = deps.getTree();
    clicked =
      model && pos && tree
        ? stringValueAtOffset(tree, deps.getSpans(), model.getOffsetAt(pos))
        : null;
    gate.set(!!clicked && looksLikeBase64(clicked));
  });

  const decode = editor.addAction({
    id: "hs.decodeBase64",
    label: "Decode base64",
    contextMenuGroupId: GROUP,
    contextMenuOrder: 3,
    precondition: KEY,
    run: () => {
      if (clicked) deps.onDecode(clicked);
    },
  });

  const copy = editor.addAction({
    id: "hs.copyValue",
    label: "Copy value",
    contextMenuGroupId: GROUP,
    contextMenuOrder: 3.1,
    run: () => {
      if (clicked) deps.onCopy(clicked);
    },
  });

  const save = editor.addAction({
    id: "hs.saveDecoded",
    label: "Save decoded to file…",
    contextMenuGroupId: GROUP,
    contextMenuOrder: 3.2,
    precondition: KEY,
    run: () => {
      if (clicked) deps.onSave(clicked);
    },
  });

  return {
    dispose() {
      decode.dispose();
      copy.dispose();
      save.dispose();
      mouseSub.dispose();
    },
  };
}
