import type { HttpMethodIpc } from "@/ipc/bindings";
import type { Draft, Step } from "./model";

export type CallKey =
  | {
      protocol: "grpc";
      service: string;
      method: string;
      /** Address template (as stored in the draft/history, before {{var}} resolution). */
      address: string;
    }
  | {
      protocol: "http";
      method: HttpMethodIpc;
      url: string;
      /** Enabled query rows as `name=value`, in order: drafts that differ only in
       *  params do not share a last response. */
      query: string[];
    };

export function callKeyOf(draft: Draft): CallKey {
  if (draft.protocol === "grpc") {
    return { protocol: "grpc", service: draft.service, method: draft.method, address: draft.address };
  }
  const t = draft.template;
  return {
    protocol: "http",
    method: t.method,
    url: t.url_template,
    query: t.query.filter((r) => r.enabled).map((r) => `${r.key}=${r.value}`),
  };
}

function sameKey(a: CallKey, b: CallKey): boolean {
  if (a.protocol === "grpc") {
    return b.protocol === "grpc" && a.service === b.service && a.method === b.method && a.address === b.address;
  }
  return (
    b.protocol === "http" &&
    a.method === b.method &&
    a.url === b.url &&
    a.query.length === b.query.length &&
    a.query.every((q, i) => q === b.query[i])
  );
}

/** The session's latest executed snapshot of the same call. Workflow history holds
 *  only calls that reached the server (ok + gRPC-error), append-only. */
export function lastExecutedFor(steps: readonly Draft[], key: CallKey): Draft | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    if (sameKey(callKeyOf(steps[i]), key)) return steps[i];
  }
  return null;
}

/** Response fields from the found step (incl. its Stream call reference, so the pane
 *  re-shows the stream); no gRPC hit → a clean Response panel. */
export function responseSeedPatch(
  last: Draft | null,
): Pick<Step, "status" | "outcome" | "error" | "streamId"> {
  return last?.protocol === "grpc"
    ? { status: last.status, outcome: last.outcome, error: last.error, streamId: last.streamId }
    : { status: "draft", outcome: null, error: null, streamId: null };
}

/** `draft` showing the response of a same-protocol `last`. */
export function seedFrom(draft: Draft, last: Draft | null): Draft {
  if (draft.protocol === "grpc") return { ...draft, ...responseSeedPatch(last) };
  return last?.protocol === "http" ? { ...draft, run: last.run } : draft;
}
