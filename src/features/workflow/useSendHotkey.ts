import { useCallback, useRef } from "react";
import { useChords } from "@/features/shell/hotkeys";
import { sendChords } from "./sendHotkey";

/** Ctrl/Cmd+Enter and Ctrl/Cmd+R run the freshest `handler` while `enabled`.
 *  Monaco swallows these chords while an editor has focus, so the returned
 *  trigger is what an editor re-binds as its submit command. */
export function useSendHotkey(handler: () => void, enabled = true): () => void {
  const ref = useRef(() => {});
  ref.current = () => {
    if (enabled) handler();
  };
  useChords(
    sendChords(() => {
      ref.current();
    }),
  );
  return useCallback(() => ref.current(), []);
}
