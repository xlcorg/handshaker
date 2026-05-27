import { events } from "./bindings";
import type { ConnectionStateChanged, ContractUpdated } from "./bindings";

/** Subscribe to backend events. Returns an unlisten function. */
export function onConnectionStateChanged(
  handler: (e: ConnectionStateChanged) => void,
): Promise<() => void> {
  return events.connectionStateChanged.listen((evt) => handler(evt.payload));
}

export function onContractUpdated(
  handler: (e: ContractUpdated) => void,
): Promise<() => void> {
  return events.contractUpdated.listen((evt) => handler(evt.payload));
}
