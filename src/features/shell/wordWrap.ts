/** Предикат хоткея word-wrap: Alt+Z по физической клавише Z (раскладко-независимо),
 *  без Ctrl (AltGr-гард на Windows = Ctrl+Alt), Meta и Shift. */
export function isWordWrapHotkey(
  e: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
): boolean {
  if (!e.altKey) return false;
  if (e.ctrlKey || e.metaKey || e.shiftKey) return false;
  return e.code === "KeyZ";
}
