import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** Tracks the window's fullscreen state. On macOS the native traffic lights hide
 *  in fullscreen, so the titlebar drops its left inset. Tauri emits no dedicated
 *  fullscreen event, but `onResized` fires on enter/exit — we re-query there. */
export function useIsFullscreen(): boolean {
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let active = true;
    let unlisten: (() => void) | undefined;

    const sync = () => {
      void win.isFullscreen().then((v) => {
        if (active) setFullscreen(v);
      });
    };

    sync();
    void win.onResized(sync).then((fn) => {
      if (active) unlisten = fn;
      else fn();
    });

    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  return fullscreen;
}
