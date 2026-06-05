import type { DraftOrigin } from "@/features/workflow/store";

/** Whether opening another request should prompt before replacing the current draft.
 *  Only an unbound (not origin-bound) draft with unsaved edits needs a prompt;
 *  origin-bound drafts are already autosaved. */
export function needsDiscardConfirm(origin: DraftOrigin | null, dirty: boolean): boolean {
  return origin === null && dirty;
}
