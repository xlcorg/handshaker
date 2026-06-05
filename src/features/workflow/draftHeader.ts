import { shortService } from "@/features/shell/SelectedMethod";
import type { Step } from "./model";
import type { DraftOrigin } from "./store";

/** Header breadcrumb label for the draft window. Unbound → "New request";
 *  bound → "Collection › Name" when names are known, else a label derived from the call. */
export function draftBreadcrumb(draft: Step, origin: DraftOrigin | null): string {
  if (!origin) return "New request";
  if (origin.requestName) {
    return origin.collectionName
      ? `${origin.collectionName} › ${origin.requestName}`
      : origin.requestName;
  }
  const svc = shortService(draft.service);
  return draft.method ? `${svc} / ${draft.method}` : svc || "Saved request";
}
