import { events } from "./bindings";
import type { ContractUpdated } from "./bindings";

/**
 * Exported as the IPC event surface for sub-project #3 (contract-change notifications).
 * Not subscribed to in sub-project #2 — the lazy model re-describes on demand / via the
 * manual Refresh button, so no push subscription is needed yet. Do not remove.
 *
 * Subscribe to backend events. Returns an unlisten function.
 */
export function onContractUpdated(
  handler: (e: ContractUpdated) => void,
): Promise<() => void> {
  return events.contractUpdated.listen((evt) => handler(evt.payload));
}
