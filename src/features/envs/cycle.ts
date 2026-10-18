import {
  chordMatches,
  primaryChords,
  type Chord,
} from "@/features/shell/hotkeys";

/**
 * Ctrl/Cmd+E env-cycle rows. Physical KeyE, so ЙЦУКЕН still matches.
 * No Alt (AltGr) and no Shift (Shift is the edit chord). Registered by
 * {@link WorkflowEnvControl}. A repeat, or an empty env list, declines the
 * row so the key is not swallowed.
 */
export function envCycleChords(run: Chord["run"]): Chord[] {
  return primaryChords(["KeyE"], { capture: true, run });
}

export function isEnvCycleHotkey(
  e: Pick<
    KeyboardEvent,
    "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
  >,
): boolean {
  return envCycleChords(() => undefined).some((row) =>
    chordMatches(row, e, false),
  );
}

/** Следующее окружение по кругу, исключая «No environment».
 *  Возвращает имя env для активации, либо `null` = no-op (список пуст).
 *  `current === null` или имя не из списка ⇒ первый env. */
export function nextEnvName(
  names: string[],
  current: string | null,
): string | null {
  if (names.length === 0) return null;
  const idx = current === null ? -1 : names.indexOf(current);
  return names[(idx + 1) % names.length];
}
