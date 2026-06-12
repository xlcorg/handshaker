import type { Step } from "./model";

export interface CallKey {
  service: string;
  method: string;
  /** Address template (as stored in the draft/history, before {{var}} resolution). */
  address: string;
}

/** The session's latest executed snapshot of the same call. Workflow history holds
 *  only calls that reached the server (ok + gRPC-error), append-only. */
export function lastExecutedFor(steps: Step[], key: CallKey): Step | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (s.service === key.service && s.method === key.method && s.address === key.address) {
      return s;
    }
  }
  return null;
}

/** Response fields from the found step; null → a clean Response panel. */
export function responseSeedPatch(
  last: Step | null,
): Pick<Step, "status" | "outcome" | "error"> {
  return last
    ? { status: last.status, outcome: last.outcome, error: last.error }
    : { status: "draft", outcome: null, error: null };
}
