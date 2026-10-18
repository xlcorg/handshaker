import { describe, expect, it } from "vitest";

import {
  QUIET_START,
  attachClock,
  createQueue,
  nextQuietWake,
  observeClock,
  queueStatus,
  quietStatus,
  stepQueue,
  type QueueEffect,
  type QueueEvent,
  type QuietClock,
  type Rev,
  type SaveQueue,
  type Urgency,
} from "./saveQueue";

function run(q: SaveQueue<string>, ...events: QueueEvent<string>[]) {
  let queue = q;
  const effects: QueueEffect<string>[] = [];
  for (const e of events) {
    const r = stepQueue(queue, e);
    queue = r.queue;
    effects.push(...r.effects);
  }
  return { queue, effects };
}

const sent = (effects: readonly QueueEffect<string>[]) =>
  effects.flatMap((e) =>
    e.type === "send" ? [{ rev: e.rev, goal: e.goal }] : [],
  );

const edit = (goal: string, urgency: Urgency = "now"): QueueEvent<string> => ({
  type: "edited",
  goal,
  urgency,
});
const ok = (rev: number): QueueEvent<string> => ({
  type: "settled",
  rev: rev as Rev,
  ok: true,
});
const fail = (rev: number, message = "disk full"): QueueEvent<string> => ({
  type: "settled",
  rev: rev as Rev,
  ok: false,
  error: { message },
});

describe("save queue", () => {
  it("sends the first writable goal as rev 1", () => {
    const r = run(createQueue("v0"), edit("v1"));
    expect(sent(r.effects)).toEqual([{ rev: 1, goal: "v1" }]);
  });

  it("sends nothing more while that rev is in flight", () => {
    const r = run(
      createQueue("v0"),
      edit("v1"),
      edit("v2"),
      edit("v3", "debounce"),
      { type: "timerFired" },
      { type: "flush" },
    );
    expect(sent(r.effects)).toEqual([{ rev: 1, goal: "v1" }]);
    expect(queueStatus(r.queue).kind).toBe("saving");
  });

  it("sends the newest goal once rev 1 settles and never the skipped middle goal", () => {
    const flying = run(createQueue("v0"), edit("v1"), edit("v2"), edit("v3"));
    const settled = stepQueue(flying.queue, ok(1));

    expect(sent(settled.effects)).toEqual([{ rev: 3, goal: "v3" }]);
    expect(
      sent([...flying.effects, ...settled.effects]).map((s) => s.goal),
    ).toEqual(["v1", "v3"]);
  });

  it("ignores a settle for any rev that is not in flight", () => {
    const flying = run(createQueue("v0"), edit("v1"), edit("v2"));
    for (const stale of [ok(0), ok(2), fail(2), ok(9)]) {
      const r = stepQueue(flying.queue, stale);
      expect(r.effects).toEqual([]);
      expect(r.queue.acked).toEqual(flying.queue.acked);
      expect(queueStatus(r.queue).kind).toBe("saving");
    }
    expect(sent(stepQueue(flying.queue, ok(1)).effects)).toEqual([
      { rev: 2, goal: "v2" },
    ]);
  });

  it("after a failure with a newer head waiting, sends that head and drops the old error", () => {
    const flying = run(createQueue("v0"), edit("v1"), edit("v2"));
    const failed = stepQueue(flying.queue, fail(1));

    expect(sent(failed.effects)).toEqual([{ rev: 2, goal: "v2" }]);
    expect(queueStatus(failed.queue).kind).toBe("saving");
    expect(queueStatus(stepQueue(failed.queue, ok(2)).queue)).toEqual({
      kind: "saved",
    });
  });

  it("after a failure with nothing newer, reports failed and Retry sends the same head", () => {
    const flying = run(createQueue("v0"), edit("v1"));
    const failed = stepQueue(flying.queue, fail(1, "disk full"));

    expect(failed.effects).toEqual([]);
    expect(queueStatus(failed.queue)).toEqual({
      kind: "failed",
      error: { message: "disk full" },
    });
    expect(sent(stepQueue(failed.queue, { type: "flush" }).effects)).toEqual([
      { rev: 1, goal: "v1" },
    ]);
  });

  it("a flush while the head itself is in flight owes nothing, so its failure is not resent", () => {
    const flying = run(createQueue("v0"), edit("v1"), { type: "flush" });
    const failed = stepQueue(flying.queue, fail(1));

    expect(sent(failed.effects)).toEqual([]);
    expect(queueStatus(failed.queue)).toEqual({
      kind: "failed",
      error: { message: "disk full" },
    });
  });

  it("never sends an invalid head, and a later valid edit sends", () => {
    const blocked = run(
      createQueue("v0"),
      edit("v1", "debounce"),
      { type: "invalid" },
      { type: "timerFired" },
      { type: "flush" },
    );
    expect(sent(blocked.effects)).toEqual([]);
    expect(queueStatus(blocked.queue).kind).toBe("invalid");

    expect(sent(run(blocked.queue, edit("v3")).effects)).toEqual([
      { rev: 3, goal: "v3" },
    ]);
  });
});

function timeline(
  start: SaveQueue<string> = createQueue("v0"),
  clock: QuietClock = QUIET_START,
) {
  let queue = start;
  let c = clock;
  return {
    at(now: number, ...events: QueueEvent<string>[]) {
      queue = run(queue, ...events).queue;
      c = observeClock(c, queue, now);
      return this;
    },
    status: (now: number) => quietStatus(queue, c, now),
    wake: (now: number) => nextQuietWake(queue, c, now),
    get queue() {
      return queue;
    },
    get clock() {
      return c;
    },
  };
}

describe("quiet save status", () => {
  it("shows nothing for an untouched environment", () => {
    const t = timeline().at(0);
    expect(t.status(0)).toEqual({ kind: "hidden" });
    expect(t.status(60_000)).toEqual({ kind: "hidden" });
    expect(t.wake(0)).toBeNull();
  });

  it("shows Saving only once a write has been owed for 400ms", () => {
    const t = timeline().at(1000, edit("v1"));
    expect(t.status(1399)).toEqual({ kind: "hidden" });
    expect(t.wake(1000)).toBe(1400);
    expect(t.status(1400)).toEqual({ kind: "saving" });
  });

  it("shows Saved, never Saving, for a fast ack, then hides it after 2s", () => {
    const t = timeline().at(1000, edit("v1")).at(1012, ok(1));
    expect(t.status(1012)).toEqual({ kind: "saved" });
    expect(t.status(3011)).toEqual({ kind: "saved" });
    expect(t.wake(1012)).toBe(3012);
    expect(t.status(3012)).toEqual({ kind: "hidden" });
    expect(t.wake(3012)).toBeNull();
  });

  it("keeps one Saving stretch across back-to-back writes", () => {
    const t = timeline().at(0, edit("v1")).at(300, edit("v2")).at(350, ok(1));
    expect(t.status(399)).toEqual({ kind: "hidden" });
    expect(t.status(400)).toEqual({ kind: "saving" });
    t.at(900, ok(2));
    expect(t.status(900)).toEqual({ kind: "saved" });
  });

  it("keeps Not saved after a failure, through a retry, until a later ack", () => {
    const t = timeline().at(0, edit("v1")).at(10, fail(1));
    const failed = {
      kind: "notSaved",
      reason: "failed",
      error: { message: "disk full" },
    };
    expect(t.status(10)).toEqual(failed);
    expect(t.status(600_000)).toEqual(failed);
    expect(t.wake(10)).toBeNull();

    t.at(20, { type: "flush" });
    expect(t.status(1000)).toEqual(failed);
    t.at(1100, ok(1));
    expect(t.status(1100)).toEqual({ kind: "saved" });
  });

  it("shows Not saved for an invalid draft, without a timer", () => {
    const t = timeline().at(0, { type: "invalid" });
    expect(t.status(5000)).toEqual({ kind: "notSaved", reason: "invalid" });
    expect(t.wake(0)).toBeNull();
  });

  it("reads acknowledgement from the queue, not from the clock", () => {
    const t = timeline().at(0, edit("v1")).at(5, ok(1)).at(6, edit("v2"));
    expect(t.status(6)).toEqual({ kind: "hidden" });

    const settledUnseen = run(t.queue, ok(2)).queue;
    expect(quietStatus(settledUnseen, t.clock, 7)).toEqual({ kind: "hidden" });
  });

  it("does not replay Saved when a pane attaches to an acked lane", () => {
    const t = timeline().at(0, edit("v1")).at(5, ok(1));
    const attached = attachClock(t.queue, 500);
    expect(quietStatus(t.queue, attached, 500)).toEqual({ kind: "hidden" });
    expect(nextQuietWake(t.queue, attached, 500)).toBeNull();
    expect(observeClock(attached, t.queue, 600)).toBe(attached);
  });

  it("starts the 400ms wait from the attach time for a lane that still owes a write", () => {
    const t = timeline().at(0, edit("v1"));
    const attached = attachClock(t.queue, 5000);
    expect(quietStatus(t.queue, attached, 5399)).toEqual({ kind: "hidden" });
    expect(quietStatus(t.queue, attached, 5400)).toEqual({ kind: "saving" });
  });

  it("observing the same queue twice changes nothing", () => {
    const t = timeline().at(0, edit("v1"));
    expect(observeClock(t.clock, t.queue, 50)).toBe(t.clock);
  });
});
