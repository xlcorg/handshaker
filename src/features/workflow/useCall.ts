import { useCatalog } from "@/features/catalog/CatalogProvider";
import type { MethodKind } from "@/lib/method-kind";
import type { DraftOrigin } from "./store";
import type { Step } from "./model";
import { cancelCall, halfCloseStream, runCall, sendStreamMessage, type CallArgs } from "./callLifecycle";

export interface UseCallArgs {
  step: Step;
  envName: string | null;
  /** The **controls kind** the call panel derived (`controlsKind`: live call → catalog →
   *  last executed → null); `null` = unknown — the unary path, never a guessed stream. */
  kind: MethodKind | null;
  onPatch: (patch: Partial<Step>) => void;
  /** Focus(draft) only: record a finished call as an executed snapshot. */
  record?: boolean;
  /** Origin-bound draft only: credit the saved request with one execution. */
  origin?: DraftOrigin | null;
}

export function useCall({ step, envName, kind, onPatch, record = false, origin = null }: UseCallArgs) {
  const { bumpUsage } = useCatalog();
  const args: CallArgs = { step, envName, kind, onPatch, recording: record ? { origin, bumpUsage } : null };
  return {
    send: () => runCall(args),
    cancel: () => cancelCall(args),
    sendMessage: () => sendStreamMessage(args),
    halfClose: () => halfCloseStream(args),
  };
}
