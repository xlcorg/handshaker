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
  | {
      readonly type: "settled";
      readonly rev: Rev;
      readonly ok: false;
      readonly error: SaveFailure;
    };

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

type Step<G> = {
  readonly queue: SaveQueue<G>;
  readonly effects: readonly QueueEffect<G>[];
};

const FIRST = 0 as Rev;
const CANCEL: QueueEffect<never> = { type: "cancelTimer" };

export function createQueue<G>(stored: G | null): SaveQueue<G> {
  return {
    head:
      stored === null
        ? { rev: FIRST, state: "invalid" }
        : { rev: FIRST, state: "writable", goal: stored },
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

function trySend<G>(
  q: SaveQueue<G>,
  effects: readonly QueueEffect<G>[],
): Step<G> {
  const head = q.head;
  if (head.state === "invalid" || head.rev === q.acked.rev) {
    return { queue: { ...q, sendOnSettle: false }, effects };
  }
  if (q.inFlight)
    return {
      queue: { ...q, sendOnSettle: q.inFlight.rev !== head.rev },
      effects,
    };
  return {
    queue: {
      ...q,
      inFlight: { rev: head.rev, goal: head.goal },
      sendOnSettle: false,
      timer: false,
    },
    effects: [
      ...effects,
      ...(q.timer ? [CANCEL] : []),
      { type: "send", rev: head.rev, goal: head.goal },
    ],
  };
}

export function stepQueue<G>(q: SaveQueue<G>, e: QueueEvent<G>): Step<G> {
  const cancel = q.timer ? [CANCEL] : [];
  switch (e.type) {
    case "edited": {
      const head: Head<G> = {
        rev: nextRev(q.head.rev),
        state: "writable",
        goal: e.goal,
      };
      if (e.urgency === "debounce") {
        return {
          queue: { ...q, head, timer: true },
          effects: [{ type: "armTimer" }],
        };
      }
      if (e.urgency === "now")
        return trySend({ ...q, head, timer: false }, cancel);
      return { queue: { ...q, head, timer: false }, effects: cancel };
    }
    case "invalid":
      return {
        queue: {
          ...q,
          head: { rev: nextRev(q.head.rev), state: "invalid" },
          timer: false,
          sendOnSettle: false,
        },
        effects: cancel,
      };
    case "timerFired":
      return q.timer
        ? trySend({ ...q, timer: false }, [])
        : { queue: q, effects: [] };
    case "flush":
      return trySend({ ...q, timer: false }, cancel);
    case "settled": {
      const flight = q.inFlight;
      if (flight === null || flight.rev !== e.rev)
        return { queue: q, effects: [] };
      const settled: SaveQueue<G> = e.ok
        ? {
            ...q,
            inFlight: null,
            acked: { rev: flight.rev, goal: flight.goal },
            failure: null,
          }
        : { ...q, inFlight: null, failure: e.error };
      return settled.sendOnSettle
        ? trySend(settled, [])
        : { queue: settled, effects: [] };
    }
  }
}

export function queueStatus<G>(q: SaveQueue<G>): SaveStatus {
  if (q.head.rev === q.acked.rev)
    return q.acked.rev === FIRST ? { kind: "clean" } : { kind: "saved" };
  if (q.head.state === "invalid") return { kind: "invalid" };
  if (q.inFlight || q.timer || q.sendOnSettle) return { kind: "saving" };
  if (q.failure) return { kind: "failed", error: q.failure };
  return { kind: "held" };
}

export const SAVING_DELAY_MS = 400;
export const SAVED_LINGER_MS = 2000;

export interface QuietClock {
  readonly busySince: number | null;
  readonly acked: { readonly rev: Rev; readonly at: number } | null;
}

export const QUIET_START: QuietClock = { busySince: null, acked: null };

function owesWrite<G>(q: SaveQueue<G>): boolean {
  return (
    q.head.rev !== q.acked.rev &&
    (q.timer || q.inFlight !== null || q.sendOnSettle)
  );
}

export function attachClock<G>(q: SaveQueue<G>, now: number): QuietClock {
  return {
    busySince: owesWrite(q) ? now : null,
    acked: q.acked.rev === FIRST ? null : { rev: q.acked.rev, at: -Infinity },
  };
}

export function observeClock<G>(
  clock: QuietClock,
  q: SaveQueue<G>,
  now: number,
): QuietClock {
  const busySince = owesWrite(q) ? (clock.busySince ?? now) : null;
  const acked =
    q.acked.rev !== FIRST && q.acked.rev !== clock.acked?.rev
      ? { rev: q.acked.rev, at: now }
      : clock.acked;
  return busySince === clock.busySince && acked === clock.acked
    ? clock
    : { busySince, acked };
}

export type QuietStatus =
  | { readonly kind: "hidden" }
  | { readonly kind: "saving" }
  | { readonly kind: "saved" }
  | { readonly kind: "notSaved"; readonly reason: "invalid" }
  | {
      readonly kind: "notSaved";
      readonly reason: "failed";
      readonly error: SaveFailure;
    };

const HIDDEN: QuietStatus = { kind: "hidden" };

export function quietStatus<G>(
  q: SaveQueue<G>,
  clock: QuietClock,
  now: number,
): QuietStatus {
  if (q.head.rev === q.acked.rev) {
    const ack = clock.acked;
    return ack?.rev === q.acked.rev && now - ack.at < SAVED_LINGER_MS
      ? { kind: "saved" }
      : HIDDEN;
  }
  if (q.head.state === "invalid")
    return { kind: "notSaved", reason: "invalid" };
  if (q.failure)
    return { kind: "notSaved", reason: "failed", error: q.failure };
  if (
    owesWrite(q) &&
    clock.busySince !== null &&
    now - clock.busySince >= SAVING_DELAY_MS
  )
    return { kind: "saving" };
  return HIDDEN;
}

export function nextQuietWake<G>(
  q: SaveQueue<G>,
  clock: QuietClock,
  now: number,
): number | null {
  if (q.head.rev === q.acked.rev) {
    const ack = clock.acked;
    const until = ack?.rev === q.acked.rev ? ack.at + SAVED_LINGER_MS : null;
    return until !== null && until > now ? until : null;
  }
  if (
    q.head.state === "invalid" ||
    q.failure ||
    !owesWrite(q) ||
    clock.busySince === null
  )
    return null;
  const at = clock.busySince + SAVING_DELAY_MS;
  return at > now ? at : null;
}
