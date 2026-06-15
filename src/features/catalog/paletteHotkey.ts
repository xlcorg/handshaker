/**
 * True for the command-palette hotkey: Ctrl/Cmd + K or Ctrl/Cmd + P.
 * Matched by PHYSICAL key (`e.code`) so non-Latin layouts still trigger it, with
 * AltGr (ctrl+alt) and key-repeat guards — mirrors the Ctrl+E env-cycle hotkey.
 */
export function isPaletteHotkey(e: KeyboardEvent): boolean {
  if (!(e.metaKey || e.ctrlKey)) return false;
  if (e.altKey) return false;
  if (e.repeat) return false;
  return e.code === "KeyK" || e.code === "KeyP";
}
