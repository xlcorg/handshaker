import { useEffect } from "react";
import { readPrefs, setPref } from "@/lib/use-prefs";
import type { SplitDir } from "@/lib/use-prefs";
import { isMacOS } from "@/lib/platform";

/** Следующая ориентация по кругу (двух-состояний тоггл). */
export function nextSplit(cur: SplitDir): SplitDir {
  return cur === "horizontal" ? "vertical" : "horizontal";
}

/** Предикат хоткея split-direction по ФИЗИЧЕСКОЙ клавише V (раскладко-независимо):
 *   - Windows/Linux — Alt+V, без Ctrl (AltGr = Ctrl+Alt), Meta, Shift;
 *   - macOS — ⌥⌘V (голый ⌥V печатает символ / перехватывается; Command гасит
 *     композицию). Без Ctrl, без Shift. `mac` передаётся вызывающим (хук берёт
 *     isMacOS) — предикат чистый и тестируется на обеих платформах. */
export function isSplitToggleHotkey(
  e: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
  mac: boolean,
): boolean {
  if (e.code !== "KeyV" || e.shiftKey) return false;
  if (mac) return e.altKey && e.metaKey && !e.ctrlKey;
  return e.altKey && !e.ctrlKey && !e.metaKey;
}

/** Глобальный хоткей split-direction → переключает pref `split`. Аккорд из
 *  isSplitToggleHotkey (Alt+V на Win/Linux, ⌥⌘V на macOS). Capture-фаза +
 *  preventDefault/stopPropagation: capture-фаза НЕ равна подавлению — нужен
 *  stopPropagation, иначе Monaco/прочие увидят событие (урок env-cycle). Ни Alt+V,
 *  ни ⌥⌘V не являются дефолтом Monaco, поэтому отвязывать ничего не нужно. Биндим
 *  однажды: setPref пишет в модульный стор, readPrefs() читает свежее. */
export function useSplitDirectionHotkey(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || !isSplitToggleHotkey(e, isMacOS)) return;
      e.preventDefault();
      e.stopPropagation();
      setPref("split", nextSplit(readPrefs().split));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
