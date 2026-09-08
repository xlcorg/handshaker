import { toast } from "sonner";
import { savedFileToast } from "@/lib/savedFileToast";
import { fileSaveText } from "@/ipc/client";
import { messages } from "@/lib/messages";
import { responseFileName } from "./responseFileName";

/** Save the full response body `text` to a user-picked file. Suggests a
 *  `response-<localstamp>.json` default name, opens the native Save-As, and on
 *  success shows a toast with open-file and reveal-in-folder actions.
 *  Cancellation is silent; failure shows an error toast. Returns the promise so
 *  callers can await in tests; UI call sites fire-and-forget with `void`. */
export function saveResponseToFile(text: string): Promise<void> {
  const defaultName = responseFileName(new Date());
  return fileSaveText(text, defaultName)
    .then((path) => {
      if (!path) return; // cancelled
      savedFileToast(path);
    })
    .catch((e) => {
      toast.error(typeof e === "string" ? e : messages.response.save.failed);
    });
}
