import { useEffect } from "react";
import { readPrefs, usePrefs } from "@/lib/use-prefs";
import { isMacOS } from "@/lib/platform";

/** Предикат хоткея word-wrap. Платформо-зависимый аккорд по физической клавише Z
 *  (раскладко-независимо):
 *   - **Windows/Linux** — `Alt+Z` (как в VS Code), без Ctrl (AltGr = Ctrl+Alt), Meta, Shift.
 *   - **macOS** — `⌥⌘Z` (Option+Command+Z). Голый `⌥Z` на маке зарезервирован под ввод
 *     символа (печатает `Ω`) и часто перехватывается глобальными приложениями, поэтому
 *     требуем ещё и Command (он же гасит композицию символа). Без Ctrl, без Shift.
 *  `mac` передаётся вызывающим (хук берёт `isMacOS`) — так предикат остаётся чистым и
 *  тестируется на обеих платформах. */
export function isWordWrapHotkey(
  e: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
  mac: boolean,
): boolean {
  if (e.code !== "KeyZ" || e.shiftKey) return false;
  if (mac) return e.altKey && e.metaKey && !e.ctrlKey;
  return e.altKey && !e.ctrlKey && !e.metaKey;
}

/** Глобальный хоткей word-wrap → переключает pref `wordWrap`. Аккорд берётся из
 *  `isWordWrapHotkey` (Alt+Z на Win/Linux, ⌥⌘Z на macOS). Capture-фаза +
 *  preventDefault/stopPropagation — оборонительно; встроенный `Alt+Z` Monaco
 *  (`editor.action.toggleWordWrap`) отвязан в `monaco.ts`, поэтому он больше не
 *  может дёрнуть внутренний флаг редактора в рассинхрон с pref (на маке голый ⌥Z
 *  теперь до Monaco и доходит, но ничего не переключает). Биндим однажды: setPref
 *  пишет в модульный стор, readPrefs() читает свежее значение. */
export function useWordWrapHotkey(): void {
  const [, setPref] = usePrefs();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || !isWordWrapHotkey(e, isMacOS)) return;
      e.preventDefault();
      e.stopPropagation();
      setPref("wordWrap", !readPrefs().wordWrap);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
