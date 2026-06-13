/**
 * Ctrl+E env-cycle hotkey helpers. Pure + unit-tested; the keydown listener
 * lives in {@link WorkflowEnvControl}.
 */

/** Предикат хоткея «cycle env»: Ctrl/Cmd+E по ФИЗИЧЕСКОЙ клавише E
 *  (`e.code === "KeyE"`, раскладко-независимо — на ЙЦУКЕН `e.key` был бы "у"),
 *  без Alt (AltGr = Ctrl+Alt печатает символы на евро-раскладках) и без Shift. */
export function isEnvCycleHotkey(
  e: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
): boolean {
  if (e.altKey || e.shiftKey) return false;
  if (!e.ctrlKey && !e.metaKey) return false;
  return e.code === "KeyE";
}

/** Следующее окружение по кругу, исключая «No environment».
 *  Возвращает имя env для активации, либо `null` = no-op (список пуст).
 *  `current === null` или имя не из списка ⇒ первый env. */
export function nextEnvName(names: string[], current: string | null): string | null {
  if (names.length === 0) return null;
  const idx = current === null ? -1 : names.indexOf(current);
  return names[(idx + 1) % names.length];
}
