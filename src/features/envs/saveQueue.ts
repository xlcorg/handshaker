declare const brand: unique symbol;

export type Rev = number & { readonly [brand]: "Rev" };

export type Urgency = "debounce" | "now" | "hold";

export interface SaveFailure {
  readonly message: string;
  readonly detail?: string;
}

export type QueueEvent<G> =
  | { readonly type: "edited"; readonly goal: G; readonly urgency: Urgency }
  | { readonly type: "invalid" }
  | { readonly type: "timerFired" }
  | { readonly type: "flush" }
  | { readonly type: "settled"; readonly rev: Rev; readonly ok: true }
  | { readonly type: "settled"; readonly rev: Rev; readonly ok: false; readonly error: SaveFailure };

export type QueueEffect<G> =
  | { readonly type: "armTimer" }
  | { readonly type: "cancelTimer" }
  | { readonly type: "send"; readonly rev: Rev; readonly goal: G };

export type Head<G> =
  | { readonly rev: Rev; readonly state: "writable"; readonly goal: G }
  | { readonly rev: Rev; readonly state: "invalid" };

export interface SaveQueue<G> {
  readonly head: Head<G>;
  readonly acked: { readonly rev: Rev; readonly goal: G | null };
  readonly inFlight: { readonly rev: Rev; readonly goal: G } | null;
  readonly timer: boolean;
  readonly sendOnSettle: boolean;
  readonly failure: SaveFailure | null;
}

export type SaveStatus =
  | { readonly kind: "clean" }
  | { readonly kind: "saved" }
  | { readonly kind: "saving" }
  | { readonly kind: "failed"; readonly error: SaveFailure }
  | { readonly kind: "invalid" }
  | { readonly kind: "held" };

type Step<G> = { readonly queue: SaveQueue<G>; readonly effects: readonly QueueEffect<G>[] };

const FIRST = 0 as Rev;
const CANCEL: QueueEffect<never> = { type: "cancelTimer" };

export function createQueue<G>(stored: G | null): SaveQueue<G> {
  return {
    head: stored === null ? { rev: FIRST, state: "invalid" } : { rev: FIRST, state: "writable", goal: stored },
    acked: { rev: FIRST, goal: stored },
    inFlight: null,
    timer: false,
    sendOnSettle: false,
    failure: null,
  };
}

function nextRev(rev: Rev): Rev {
  return (rev + 1) as Rev;
}

function trySend<G>(q: SaveQueue<G>, effects: readonly QueueEffect<G>[]): Step<G> {
  const head = q.head;
  if (head.state === "invalid" || head.rev === q.acked.rev) {
    return { queue: { ...q, sendOnSettle: false }, effects };
  }
  if (q.inFlight) return { queue: { ...q, sendOnSettle: true }, effects };
  return {
    queue: { ...q, inFlight: { rev: head.rev, goal: head.goal }, sendOnSettle: false, timer: false },
    effects: [...effects, ...(q.timer ? [CANCEL] : []), { type: "send", rev: head.rev, goal: head.goal }],
  };
}

export function stepQueue<G>(q: SaveQueue<G>, e: QueueEvent<G>): Step<G> {
  const cancel = q.timer ? [CANCEL] : [];
  switch (e.type) {
    case "edited": {
      const head: Head<G> = { rev: nextRev(q.head.rev), state: "writable", goal: e.goal };
      if (e.urgency === "debounce") {
        return { queue: { ...q, head, timer: true }, effects: [{ type: "armTimer" }] };
      }
      if (e.urgency === "now") return trySend({ ...q, head, timer: false }, cancel);
      return { queue: { ...q, head, timer: false }, effects: cancel };
    }
    case "invalid":
      return {
        queue: { ...q, head: { rev: nextRev(q.head.rev), state: "invalid" }, timer: false, sendOnSettle: false },
        effects: cancel,
      };
    case "timerFired":
      return q.timer ? trySend({ ...q, timer: false }, []) : { queue: q, effects: [] };
    case "flush":
      return trySend({ ...q, timer: false }, cancel);
    case "settled": {
      const flight = q.inFlight;
      if (flight === null || flight.rev !== e.rev) return { queue: q, effects: [] };
      const settled: SaveQueue<G> = e.ok
        ? { ...q, inFlight: null, acked: { rev: flight.rev, goal: flight.goal }, failure: null }
        : { ...q, inFlight: null, failure: e.error };
      return settled.sendOnSettle ? trySend(settled, []) : { queue: settled, effects: [] };
    }
  }
}

export function queueStatus<G>(q: SaveQueue<G>): SaveStatus {
  if (q.head.rev === q.acked.rev) return q.acked.rev === FIRST ? { kind: "clean" } : { kind: "saved" };
  if (q.head.state === "invalid") return { kind: "invalid" };
  if (q.inFlight || q.timer || q.sendOnSettle) return { kind: "saving" };
  if (q.failure) return { kind: "failed", error: q.failure };
  return { kind: "held" };
}
