/**
 * Ctrl+Shift+E "open Edit environment" hotkey helper. Pure + unit-tested; the
 * keydown listener lives in {@link WorkflowEnvControl}. Mirror of {@link isEnvCycleHotkey}
 * (cycle.ts) — physical key, layout-independent — but requires Shift, so it never
 * collides with the Shift-less Ctrl+E cycle.
 */

/** Предикат «open Edit environment»: Ctrl/Cmd+Shift+E по ФИЗИЧЕСКОЙ клавише E
 *  (`e.code === "KeyE"`, раскладко-независимо), с Shift, без Alt (AltGr = Ctrl+Alt). */
export function isEnvEditHotkey(
  e: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
): boolean {
  if (e.altKey) return false; // AltGr prints symbols on euro layouts
  if (!e.shiftKey) return false; // Shift distinguishes edit from the Ctrl+E cycle
  if (!e.ctrlKey && !e.metaKey) return false;
  return e.code === "KeyE";
}
