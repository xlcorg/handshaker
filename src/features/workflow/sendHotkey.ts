/**
 * Predicate for the global "Send request" keyboard shortcuts.
 *
 * Two chords both fire Send (mirroring the Send button): the canonical
 * **Ctrl/Cmd+Enter** and the alternate **Ctrl/Cmd+R**.
 *
 * Layout independence: `R` is matched by its PHYSICAL key (`e.code === "KeyR"`),
 * not `e.key`, so it works on non-QWERTY layouts (on ЙЦУКЕН the physical R key
 * yields `e.key === "к"`). Enter is layout-stable, so it stays on `e.key`. AltGr
 * is `Ctrl+Alt` on Windows (it sets `ctrlKey`), so the letter chord excludes
 * `altKey` — AltGr+R composing a character must never send.
 *
 * The caller is expected to `preventDefault()` on a match: for Ctrl+R that also
 * suppresses the WebView's built-in reload, which is a cancelable keydown default
 * action in the Chromium-based WebView2 (verified — see the feature notes).
 */
export function isSendHotkey(e: KeyboardEvent): boolean {
  if (!(e.metaKey || e.ctrlKey)) return false;
  if (e.key === "Enter") return true;
  if (e.code === "KeyR" && !e.altKey) return true;
  return false;
}
