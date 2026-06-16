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
  /** Decode this value on the backend and copy the decoded text to the clipboard. */
  onCopyDecoded(value: string): void;
  /** Copy the raw string value to the clipboard. */
  onCopyValue(value: string): void;
  /** Decode + native Save-As of the DECODED bytes. */
  onSaveDecoded(value: string): void;
  /** Native Save-As of the RAW base64 text (verbatim, no decode). */
  onSaveBase64(value: string): void;
}

// Two menu groups, lexically ordered so the clipboard group renders above the
// file group with a divider between them (Monaco sorts groups by `localeCompare`,
// and "9_cutcopypaste" is a prefix of "9_cutcopypaste_file" ⇒ sorts first).
const GROUP_CLIPBOARD = "9_cutcopypaste";
const GROUP_FILE = "9_cutcopypaste_file";
// Gate keys: a string value is present / that string looks like base64.
const KEY_STRING = "hsValueIsString";
const KEY_B64 = "hsValueIsB64";

/**
 * Register the response-body context-menu actions:
 *
 *   Copy decoded base64        (base64 only)   ┐ clipboard group
 *   Copy value                 (any string)    ┘
 *   ─────────
 *   Save decoded base64 to file…  (base64 only) ┐ file group
 *   Save base64 to file…          (base64 only) ┘
 *
 * Actions carry NO keybinding — only `contextMenuGroupId` — so Monaco's global
 * (last-wins) keybinding registry is never touched.
 *
 * The gate keys are computed on `onMouseDown` for the RIGHT button: mousedown
 * fires before the `contextmenu` event Monaco's context-menu controller uses to
 * build the menu, so the preconditions are already correct when the menu is
 * assembled. (A listener added via onContextMenu would run AFTER the menu is
 * built — first-click-misses / off-by-one.) The value at the clicked position is
 * stashed and reused by the action `run`s, so the menu and the actions always
 * operate on the same value.
 */
export function attachDecodeActions(editor: DecodeEditorLike, deps: DecodeActionDeps): DisposableLike {
  const isString = editor.createContextKey<boolean>(KEY_STRING, false);
  const isB64 = editor.createContextKey<boolean>(KEY_B64, false);
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
    isString.set(!!clicked);
    isB64.set(!!clicked && looksLikeBase64(clicked));
  });

  const copyDecoded = editor.addAction({
    id: "hs.copyDecodedBase64",
    label: "Copy decoded base64",
    contextMenuGroupId: GROUP_CLIPBOARD,
    contextMenuOrder: 1,
    precondition: KEY_B64,
    run: () => {
      if (clicked) deps.onCopyDecoded(clicked);
    },
  });

  const copyValue = editor.addAction({
    id: "hs.copyValue",
    label: "Copy value",
    contextMenuGroupId: GROUP_CLIPBOARD,
    contextMenuOrder: 2,
    precondition: KEY_STRING,
    run: () => {
      if (clicked) deps.onCopyValue(clicked);
    },
  });

  const saveDecoded = editor.addAction({
    id: "hs.saveDecodedBase64",
    label: "Save decoded base64 to file…",
    contextMenuGroupId: GROUP_FILE,
    contextMenuOrder: 1,
    precondition: KEY_B64,
    run: () => {
      if (clicked) deps.onSaveDecoded(clicked);
    },
  });

  const saveBase64 = editor.addAction({
    id: "hs.saveBase64",
    label: "Save base64 to file…",
    contextMenuGroupId: GROUP_FILE,
    contextMenuOrder: 2,
    precondition: KEY_B64,
    run: () => {
      if (clicked) deps.onSaveBase64(clicked);
    },
  });

  return {
    dispose() {
      copyDecoded.dispose();
      copyValue.dispose();
      saveDecoded.dispose();
      saveBase64.dispose();
      mouseSub.dispose();
    },
  };
}
