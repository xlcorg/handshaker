import { useEffect } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { clampZoom, ZOOM_STEP, readPrefs, usePrefs } from "@/lib/use-prefs";

export type ZoomAction = "in" | "out" | "reset";

/** Маппинг хоткея на действие зума. `key` — символ (раскладко-независимо для =/+/-/0),
 *  `code` — физические NumPad-клавиши, которые дают другой `key`. */
export function zoomActionFromKey(
  e: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey">,
): ZoomAction | null {
  if (e.altKey) return null; // AltGr = ctrl+alt на Windows: печатает символы на евро-раскладках
  if (!e.ctrlKey && !e.metaKey) return null;
  if (e.key === "=" || e.key === "+" || e.code === "NumpadAdd") return "in";
  if (e.key === "-" || e.code === "NumpadSubtract") return "out";
  if (e.key === "0" || e.code === "Numpad0") return "reset";
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
 *  и вешает глобальные хоткеи Ctrl+=/Ctrl+-/Ctrl+0. Capture-фаза, чтобы фокус
 *  в Monaco не перехватывал сочетания. */
export function useUiZoom(): void {
  const [prefs, setPref] = usePrefs();

  useEffect(() => {
    void applyZoom(prefs.zoom);
  }, [prefs.zoom]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = zoomActionFromKey(e);
      if (!action) return;
      e.preventDefault();
      setPref("zoom", nextZoom(readPrefs().zoom, action));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // setPref пишет в модульный prefs-стор, readPrefs читает свежее — биндим однажды.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
