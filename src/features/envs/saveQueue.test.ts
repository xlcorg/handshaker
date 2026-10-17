import { describe, expect, it } from "vitest";

import {
  createQueue,
  queueStatus,
  stepQueue,
  type QueueEffect,
  type QueueEvent,
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
  effects.flatMap((e) => (e.type === "send" ? [{ rev: e.rev, goal: e.goal }] : []));

const edit = (goal: string, urgency: Urgency = "now"): QueueEvent<string> => ({
  type: "edited",
  goal,
  urgency,
});
const ok = (rev: number): QueueEvent<string> => ({ type: "settled", rev: rev as Rev, ok: true });
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
    expect(sent([...flying.effects, ...settled.effects]).map((s) => s.goal)).toEqual(["v1", "v3"]);
  });

  it("ignores a settle for any rev that is not in flight", () => {
    const flying = run(createQueue("v0"), edit("v1"), edit("v2"));
    for (const stale of [ok(0), ok(2), fail(2), ok(9)]) {
      const r = stepQueue(flying.queue, stale);
      expect(r.effects).toEqual([]);
      expect(r.queue.acked).toEqual(flying.queue.acked);
      expect(queueStatus(r.queue).kind).toBe("saving");
    }
    expect(sent(stepQueue(flying.queue, ok(1)).effects)).toEqual([{ rev: 2, goal: "v2" }]);
  });

  it("after a failure with a newer head waiting, sends that head and drops the old error", () => {
    const flying = run(createQueue("v0"), edit("v1"), edit("v2"));
    const failed = stepQueue(flying.queue, fail(1));

    expect(sent(failed.effects)).toEqual([{ rev: 2, goal: "v2" }]);
    expect(queueStatus(failed.queue).kind).toBe("saving");
    expect(queueStatus(stepQueue(failed.queue, ok(2)).queue)).toEqual({ kind: "saved" });
  });

  it("after a failure with nothing newer, reports failed and Retry sends the same head", () => {
    const flying = run(createQueue("v0"), edit("v1"));
    const failed = stepQueue(flying.queue, fail(1, "disk full"));

    expect(failed.effects).toEqual([]);
    expect(queueStatus(failed.queue)).toEqual({ kind: "failed", error: { message: "disk full" } });
    expect(sent(stepQueue(failed.queue, { type: "flush" }).effects)).toEqual([{ rev: 1, goal: "v1" }]);
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

    expect(sent(run(blocked.queue, edit("v3")).effects)).toEqual([{ rev: 3, goal: "v3" }]);
  });
});
