import {
  chordMatches,
  primaryChords,
  type Chord,
} from "@/features/shell/hotkeys";

/**
 * Ctrl/Cmd+Shift+E rows. Physical KeyE, Shift required, Alt excluded (AltGr).
 * Shift keeps this off the Ctrl+E cycle rows. Registered by {@link WorkflowEnvControl}.
 */
export function envEditChords(run: Chord["run"]): Chord[] {
  return primaryChords(["KeyE"], { capture: true, with: ["shift"], run });
}

export function isEnvEditHotkey(
  e: Pick<
    KeyboardEvent,
    "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
  >,
): boolean {
  if (!e.shiftKey) return false;
  return envEditChords(() => undefined).some((row) =>
    chordMatches(row, e, false),
  );
}
