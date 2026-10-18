import {
  chordMatches,
  primaryChords,
  type Chord,
} from "@/features/shell/hotkeys";

/**
 * Send rows. Two chords both fire Send: Ctrl/Cmd+Enter and Ctrl/Cmd+R.
 *
 * `R` is the physical key, so ЙЦУКЕН still matches (`e.key` is "к", `e.code` is
 * KeyR). Enter stays on `e.key`. AltGr is Ctrl+Alt, so the R rows exclude Alt —
 * a composed character must never send. Enter keeps the previous looseness
 * (Shift or Alt still match). Bubble phase: Monaco swallows these chords while
 * an editor is focused, and the editor re-binds the returned trigger.
 * preventDefault on R also suppresses the WebView reload.
 */
export function sendChords(run: Chord["run"]): Chord[] {
  return [
    ...primaryChords(["Enter"], {
      capture: false,
      optional: ["shift", "alt"],
      run,
    }),
    ...primaryChords(["KeyR"], { capture: false, optional: ["shift"], run }),
  ];
}

export function isSendHotkey(e: KeyboardEvent): boolean {
  return sendChords(() => undefined).some((row) => chordMatches(row, e, false));
}
