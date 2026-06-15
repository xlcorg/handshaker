import { useEffect } from "react";
import { readPrefs, usePrefs } from "@/lib/use-prefs";

/** Предикат хоткея word-wrap: Alt+Z по физической клавише Z (раскладко-независимо),
 *  без Ctrl (AltGr-гард на Windows = Ctrl+Alt), Meta и Shift. */
export function isWordWrapHotkey(
  e: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
): boolean {
  if (!e.altKey) return false;
  if (e.ctrlKey || e.metaKey || e.shiftKey) return false;
  return e.code === "KeyZ";
}

/** Глобальный Alt+Z → переключает pref `wordWrap`. Capture-фаза + stopPropagation
 *  подавляют встроенный Alt+Z Monaco (`editor.action.toggleWordWrap`), иначе он
 *  дёргал бы внутренний флаг редактора в рассинхрон с pref. Биндим однажды:
 *  setPref пишет в модульный стор, readPrefs() читает свежее значение. */
export function useWordWrapHotkey(): void {
  const [, setPref] = usePrefs();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || !isWordWrapHotkey(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setPref("wordWrap", !readPrefs().wordWrap);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
