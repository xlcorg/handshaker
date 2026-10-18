import { useEffect } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { clampZoom, ZOOM_STEP, readPrefs, usePrefs } from "@/lib/use-prefs";
import { chordMatches, primaryChords, useChords, type Chord } from "./hotkeys";

export type ZoomAction = "in" | "out" | "reset";

const ZOOM_IN = ["=", "+", "NumpadAdd"] as const;
const ZOOM_OUT = ["-", "NumpadSubtract"] as const;
const ZOOM_RESET = ["0", "Numpad0"] as const;

/** Ctrl/Cmd, optionally Shift (Ctrl++ is Shift+= on a US keyboard). Alt is excluded:
 *  AltGr is Ctrl+Alt and types characters on European layouts. Capture, but do not
 *  stopPropagation — the previous listener only called preventDefault. */
function zoomChords(keys: readonly string[], run: Chord["run"]): Chord[] {
  return primaryChords(keys, {
    capture: true,
    optional: ["shift"],
    stop: false,
    run,
  });
}

/** Маппинг хоткея на действие зума. `key` — символ (раскладко-независимо для =/+/-/0),
 *  `code` — физические NumPad-клавиши, которые дают другой `key`. */
export function zoomActionFromKey(
  e: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey">,
): ZoomAction | null {
  if (
    zoomChords(ZOOM_IN, () => undefined).some((row) =>
      chordMatches(row, e, false),
    )
  )
    return "in";
  if (
    zoomChords(ZOOM_OUT, () => undefined).some((row) =>
      chordMatches(row, e, false),
    )
  )
    return "out";
  if (
    zoomChords(ZOOM_RESET, () => undefined).some((row) =>
      chordMatches(row, e, false),
    )
  )
    return "reset";
  return null;
}

export function nextZoom(current: number, action: ZoomAction): number {
  if (action === "reset") return 1;
  return clampZoom(current + (action === "in" ? ZOOM_STEP : -ZOOM_STEP));
}

/** Применить зум к webview. Вне Tauri (vitest/preview) — молча no-op. */
export async function applyZoom(factor: number): Promise<void> {
  try {
    await getCurrentWebview().setZoom(clampZoom(factor));
  } catch {
    /* best-effort */
  }
}

/** Зум UI: применяет prefs.zoom к webview (на маунте и при каждом изменении)
 *  и регистрирует строки Ctrl/Cmd+=, Ctrl/Cmd+-, Ctrl/Cmd+0. */
export function useUiZoom(): void {
  const [prefs, setPref] = usePrefs();

  useEffect(() => {
    void applyZoom(prefs.zoom);
  }, [prefs.zoom]);

  const apply = (action: ZoomAction) => {
    setPref("zoom", nextZoom(readPrefs().zoom, action));
  };

  useChords([
    ...zoomChords(ZOOM_IN, () => apply("in")),
    ...zoomChords(ZOOM_OUT, () => apply("out")),
    ...zoomChords(ZOOM_RESET, () => apply("reset")),
  ]);
}
