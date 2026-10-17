import { isMacOS } from "@/lib/platform";

export function isFindHotkey(
  e: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
  mac: boolean = isMacOS,
): boolean {
  if (e.altKey || e.shiftKey) return false;
  // Ctrl+F on macOS is the text-field "forward one character" binding, so only Cmd counts there.
  const primary = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  return primary && e.code === "KeyF";
}
