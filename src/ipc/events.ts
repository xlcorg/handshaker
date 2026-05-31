import { events } from "./bindings";
import type { ContractUpdated } from "./bindings";

/** Subscribe to backend events. Returns an unlisten function. */
export function onContractUpdated(
  handler: (e: ContractUpdated) => void,
): Promise<() => void> {
  return events.contractUpdated.listen((evt) => handler(evt.payload));
}
