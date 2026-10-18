import {
  chordMatches,
  primaryChords,
  type Chord,
} from "@/features/shell/hotkeys";

/**
 * Command palette rows: Ctrl/Cmd+K and Ctrl/Cmd+P, physical keys so a non-Latin
 * layout still matches. Alt is excluded (AltGr). Shift is allowed. Capture so
 * Monaco does not take Ctrl+K as a chord prefix. Repeat is declined.
 */
export function paletteChords(run: Chord["run"]): Chord[] {
  return primaryChords(["KeyK", "KeyP"], {
    capture: true,
    optional: ["shift"],
    run,
  });
}

export function isPaletteHotkey(e: KeyboardEvent): boolean {
  if (e.repeat) return false;
  return paletteChords(() => undefined).some((row) =>
    chordMatches(row, e, false),
  );
}
