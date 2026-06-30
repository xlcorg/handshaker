/** Predicate for the Save-response hotkey: Ctrl+S (Windows/Linux) or Cmd+S
 *  (macOS), matched by PHYSICAL key (`e.code === "KeyS"`) so it is
 *  layout-independent. Guards: no Shift, no Alt (also excludes AltGr =
 *  Ctrl+Alt), and only the platform's primary modifier. `mac` is passed by the
 *  caller (which reads `isMacOS`) so the predicate stays pure and testable on
 *  both platforms. */
export function isSaveResponseHotkey(
  e: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
  mac: boolean,
): boolean {
  if (e.code !== "KeyS" || e.shiftKey || e.altKey) return false;
  return mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}
