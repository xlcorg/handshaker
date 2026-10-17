import { describe, expect, it } from "vitest";

import { goalFromStored, storedName, type EnvGoal } from "./envDraft";
import { afterSync, planSync, type Footprint, type StoreObservation, type SyncStep } from "./envSync";

function goal(name: string): EnvGoal {
  return goalFromStored({ name: storedName(name), color: null, variables: [["host", "h"]], index: 0 });
}

function stored(name: string, index: number, strays: string[] = []): Footprint {
  return { kind: "stored", name: storedName(name), index, strays: strays.map(storedName) };
}

function ops(steps: readonly SyncStep[]): string[] {
  return steps.map((step) => (step.op === "upsert" ? `upsert ${step.goal.name}` : step.op === "reorder" ? `reorder ${step.names.join(",")}` : `${step.op} ${step.name}`));
}

function apply(store: StoreObservation, step: SyncStep): StoreObservation {
  switch (step.op) {
    case "upsert":
      return store.names.includes(step.goal.name) ? store : { ...store, names: [...store.names, step.goal.name] };
    case "activate":
      if (!store.names.includes(step.name)) throw new Error(`no environment ${step.name}`);
      return { ...store, active: step.name };
    case "delete":
      if (store.active === step.name) throw new Error(`cannot delete active ${step.name}`);
      return { ...store, names: store.names.filter((n) => n !== step.name) };
    case "reorder":
      if ([...step.names].sort().join() !== [...store.names].sort().join()) throw new Error("not a permutation");
      return { ...store, names: [...step.names] };
  }
}

const failed = { ok: false, error: { message: "disk full" } } as const;

describe("planSync", () => {
  it("writes an in-place edit as one upsert without reading the store", () => {
    const plan = planSync(goal("b"), stored("b", 1), { names: ["b"], active: null });
    expect(ops(plan.steps)).toEqual(["upsert b"]);
  });

  it("renames the active environment by activating the new name before deleting the old one", () => {
    const plan = planSync(goal("b2"), stored("b", 1), { names: ["a", "b", "c"], active: "b" });
    expect(ops(plan.steps)).toEqual(["upsert b2", "activate b2", "delete b", "reorder a,b2,c"]);
    expect(plan.activated).toBe("b2");
    expect(plan.index).toBe(1);
  });

  it("does not delete the old name when a retried rename finds it already gone", () => {
    const plan = planSync(goal("b2"), stored("b", 1, ["b2"]), { names: ["a", "c", "b2"], active: "b2" });
    expect(ops(plan.steps)).toEqual(["upsert b2", "reorder a,b2,c"]);
    expect(plan.activated).toBe("b2");
  });

  it("deletes the stray of a failed rename on the next write", () => {
    const fp = afterSync(stored("b", 1), goal("b2"), failed);
    const plan = planSync(goal("b3"), fp, { names: ["a", "b", "c", "b2"], active: "a" });
    expect(ops(plan.steps)).toEqual(["upsert b3", "delete b", "delete b2", "reorder a,b3,c"]);
    expect(plan.activated).toBeNull();
  });

  it("creates by upserting and activating the new environment", () => {
    const plan = planSync(goal("dev"), { kind: "new", strays: [] }, { names: ["a", "b"], active: "a" });
    expect(ops(plan.steps)).toEqual(["upsert dev", "activate dev"]);
    expect(plan.activated).toBe("dev");
    expect(plan.index).toBe(2);
  });

  it("sweeps the stray of a failed create when there is no goal", () => {
    const fp = afterSync({ kind: "new", strays: [] }, goal("dev"), failed);
    expect(ops(planSync(null, fp, { names: ["a", "dev"], active: "a" }).steps)).toEqual(["delete dev"]);
    expect(planSync(null, fp, { names: ["a"], active: "a" }).steps).toEqual([]);
  });

  it("converges on the same store after a rename fails at any step", () => {
    const start: StoreObservation = { names: ["a", "b", "c"], active: "b" };
    const target = goal("b2");
    const first = planSync(target, stored("b", 1), start);
    for (let done = 0; done < first.steps.length; done++) {
      const partial = first.steps.slice(0, done).reduce(apply, start);
      const retry = planSync(target, afterSync(stored("b", 1), target, failed), partial);
      expect(retry.steps.reduce(apply, partial)).toEqual({ names: ["a", "b2", "c"], active: "b2" });
      expect(retry.activated).toBe("b2");
      expect(retry.index).toBe(1);
    }
  });
});
