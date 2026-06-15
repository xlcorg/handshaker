import { base64Inspect } from "@/ipc/client";
import { copyToClipboard } from "@/lib/clipboard";
import { toast } from "sonner";

/**
 * Decode a base64 value and copy the decoded TEXT to the clipboard.
 *
 * Decoding happens on the BACKEND (`base64Inspect`): the string can be elided in
 * the editor's display, so the caller passes the FULL value from the JSON tree and
 * the backend returns the decoded text. Binary payloads have no text form — the
 * user is pointed at "Save decoded to file…" instead. Invalid base64 → error toast.
 */
export async function copyDecodedBase64(value: string): Promise<void> {
  try {
    const info = await base64Inspect(value);
    if (info.text !== null) {
      await copyToClipboard(info.text, "Decoded base64 copied to clipboard");
    } else {
      toast.message(
        `Decoded data is binary (${info.mime ?? "unknown type"}) — use "Save decoded to file…"`,
      );
    }
  } catch (e) {
    toast.error(typeof e === "string" ? e : "Not valid base64");
  }
}
