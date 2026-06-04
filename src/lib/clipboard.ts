import { toast } from "@/lib/toast";

/** Copy `text` to the clipboard and confirm (or report failure) via a toast. */
export async function copyToClipboard(text: string, okMessage = "Скопировано"): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMessage);
  } catch {
    toast("Не удалось скопировать");
  }
}
