import type { SplitDir } from "@/lib/use-prefs";

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
