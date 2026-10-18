import { readPrefs, usePrefs } from "@/lib/use-prefs";
import { chordMatches, useChords, type Chord } from "./hotkeys";

/** Word-wrap rows. Physical Z, so the chord is layout-independent.
 *  - Windows/Linux — Alt+Z (VS Code), no Ctrl (AltGr is Ctrl+Alt), Meta, or Shift.
 *  - macOS — Option+Command+Z. Plain Option+Z types Omega and is often grabbed
 *    globally; Command also cancels that character compose.
 *  Capture so the row runs before Monaco. Monaco's own Alt+Z binding is unbound
 *  in monaco.ts; a repeat is declined so holding the keys does not flicker the pref. */
export const wordWrapChords: readonly Omit<Chord, "run">[] = [
  { key: "KeyZ", mod: ["alt"], capture: true, platform: "other" },
  { key: "KeyZ", mod: ["alt", "meta"], capture: true, platform: "mac" },
];

export function isWordWrapHotkey(
  e: Pick<
    KeyboardEvent,
    "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
  >,
  mac: boolean,
): boolean {
  return wordWrapChords.some((row) => chordMatches(row, e, mac));
}

export function useWordWrapHotkey(): void {
  const [, setPref] = usePrefs();
  useChords(
    wordWrapChords.map((row) => ({
      ...row,
      run: (event: KeyboardEvent) => {
        if (event.repeat) return false;
        setPref("wordWrap", !readPrefs().wordWrap);
      },
    })),
  );
}
