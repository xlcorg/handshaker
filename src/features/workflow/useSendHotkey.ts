import { useCallback, useEffect, useRef } from "react";
import { isSendHotkey } from "./sendHotkey";

/** Ctrl/Cmd+Enter and Ctrl/Cmd+R run the freshest `handler` while `enabled`. The window
 *  listener binds once. Monaco swallows these chords while an editor has focus, so the
 *  returned trigger is what an editor re-binds as its submit command. */
export function useSendHotkey(handler: () => void, enabled = true): () => void {
  const ref = useRef(() => {});
  ref.current = () => {
    if (enabled) handler();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isSendHotkey(e)) return;
      // preventDefault also suppresses the WebView's built-in Ctrl+R reload.
      e.preventDefault();
      ref.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return useCallback(() => ref.current(), []);
}
