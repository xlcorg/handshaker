import { readPrefs, setPref } from "@/lib/use-prefs";
import type { SplitDir } from "@/lib/use-prefs";
import { chordMatches, useChords, type Chord } from "./hotkeys";

/** Следующая ориентация по кругу (двух-состояний тоггл). */
export function nextSplit(cur: SplitDir): SplitDir {
  return cur === "horizontal" ? "vertical" : "horizontal";
}

/** Split-direction rows, physical V.
 *  Windows/Linux: Alt+V, no Ctrl (AltGr), Meta, or Shift.
 *  macOS: Option+Command+V. Plain Option+V types a character; Command cancels that.
 *  Capture plus stopPropagation — capture alone does not keep Monaco from seeing the key. */
export const splitChords: readonly Omit<Chord, "run">[] = [
  { key: "KeyV", mod: ["alt"], capture: true, platform: "other" },
  { key: "KeyV", mod: ["alt", "meta"], capture: true, platform: "mac" },
];

export function isSplitToggleHotkey(
  e: Pick<
    KeyboardEvent,
    "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
  >,
  mac: boolean,
): boolean {
  return splitChords.some((row) => chordMatches(row, e, mac));
}

export function useSplitDirectionHotkey(): void {
  useChords(
    splitChords.map((row) => ({
      ...row,
      run: (event: KeyboardEvent) => {
        if (event.repeat) return false;
        setPref("split", nextSplit(readPrefs().split));
      },
    })),
  );
}
