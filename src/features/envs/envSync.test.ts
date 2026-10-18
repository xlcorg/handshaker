import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/ipc/client", () => ({
  ipc: {
    envList: vi.fn(),
    envActiveGet: vi.fn(),
    envUpsert: vi.fn(),
    envActiveSet: vi.fn(),
    envDelete: vi.fn(),
    envReorder: vi.fn(),
  },
}));

import { ipc } from "@/ipc/client";
import { messages } from "@/lib/messages";

import { goalFromStored, storedName, type EnvGoal } from "./envDraft";
import {
  afterSync,
  deleteEnvironment,
  planDelete,
  planSync,
  resetEnvSyncLane,
  syncEnv,
  type Footprint,
  type StoreObservation,
  type SyncStep,
} from "./envSync";

function goal(name: string): EnvGoal {
  return goalFromStored({
    name: storedName(name),
    color: null,
    variables: [["host", "h"]],
    index: 0,
  });
}

function stored(name: string, index: number, strays: string[] = []): Footprint {
  return {
    kind: "stored",
    name: storedName(name),
    index,
    strays: strays.map(storedName),
  };
}

function ops(steps: readonly SyncStep[]): string[] {
  return steps.map((step) => {
    switch (step.op) {
      case "upsert":
        return `upsert ${step.goal.name}`;
      case "reorder":
        return `reorder ${step.names.join(",")}`;
      case "deactivate":
        return "deactivate";
      default:
        return `${step.op} ${step.name}`;
    }
  });
}

function apply(store: StoreObservation, step: SyncStep): StoreObservation {
  switch (step.op) {
    case "upsert":
      return store.names.includes(step.goal.name)
        ? store
        : { ...store, names: [...store.names, step.goal.name] };
    case "activate":
      if (!store.names.includes(step.name))
        throw new Error(`no environment ${step.name}`);
      return { ...store, active: step.name };
    case "deactivate":
      return { ...store, active: null };
    case "delete":
      if (store.active === step.name)
        throw new Error(`cannot delete active ${step.name}`);
      return { ...store, names: store.names.filter((n) => n !== step.name) };
    case "reorder":
      if ([...step.names].sort().join() !== [...store.names].sort().join())
        throw new Error("not a permutation");
      return { ...store, names: [...step.names] };
  }
}

const failed = { ok: false, error: { message: "disk full" } } as const;

describe("planSync", () => {
  it("writes an in-place edit as one upsert without reading the store", () => {
    const plan = planSync(goal("b"), stored("b", 1), {
      names: ["b"],
      active: null,
    });
    expect(ops(plan.steps)).toEqual(["upsert b"]);
  });

  it("renames the active environment by activating the new name before deleting the old one", () => {
    const plan = planSync(goal("b2"), stored("b", 1), {
      names: ["a", "b", "c"],
      active: "b",
    });
    expect(ops(plan.steps)).toEqual([
      "upsert b2",
      "activate b2",
      "delete b",
      "reorder a,b2,c",
    ]);
    expect(plan.activated).toBe("b2");
    expect(plan.index).toBe(1);
  });

  it("does not delete the old name when a retried rename finds it already gone", () => {
    const plan = planSync(goal("b2"), stored("b", 1, ["b2"]), {
      names: ["a", "c", "b2"],
      active: "b2",
    });
    expect(ops(plan.steps)).toEqual(["upsert b2", "reorder a,b2,c"]);
    expect(plan.activated).toBe("b2");
  });

  it("deletes the stray of a failed rename on the next write", () => {
    const fp = afterSync(stored("b", 1), goal("b2"), failed);
    const plan = planSync(goal("b3"), fp, {
      names: ["a", "b", "c", "b2"],
      active: "a",
    });
    expect(ops(plan.steps)).toEqual([
      "upsert b3",
      "delete b",
      "delete b2",
      "reorder a,b3,c",
    ]);
    expect(plan.activated).toBeNull();
  });

  it("creates by upserting and activating the new environment", () => {
    const plan = planSync(
      goal("dev"),
      { kind: "new", strays: [] },
      { names: ["a", "b"], active: "a" },
    );
    expect(ops(plan.steps)).toEqual(["upsert dev", "activate dev"]);
    expect(plan.activated).toBe("dev");
    expect(plan.index).toBe(2);
  });

  it("sweeps the stray of a failed create when there is no goal", () => {
    const fp = afterSync({ kind: "new", strays: [] }, goal("dev"), failed);
    expect(
      ops(planSync(null, fp, { names: ["a", "dev"], active: "a" }).steps),
    ).toEqual(["delete dev"]);
    expect(planSync(null, fp, { names: ["a"], active: "a" }).steps).toEqual([]);
  });

  it("converges on the same store after a rename fails at any step", () => {
    const start: StoreObservation = { names: ["a", "b", "c"], active: "b" };
    const target = goal("b2");
    const first = planSync(target, stored("b", 1), start);
    for (let done = 0; done < first.steps.length; done++) {
      const partial = first.steps.slice(0, done).reduce(apply, start);
      const retry = planSync(
        target,
        afterSync(stored("b", 1), target, failed),
        partial,
      );
      expect(retry.steps.reduce(apply, partial)).toEqual({
        names: ["a", "b2", "c"],
        active: "b2",
      });
      expect(retry.activated).toBe("b2");
      expect(retry.index).toBe(1);
    }
  });
});

describe("planDelete", () => {
  it("clears the active environment before deleting it", () => {
    const seen: StoreObservation = { names: ["a", "b", "c"], active: "b" };
    const steps = planDelete(stored("b", 1), seen);
    expect(ops(steps)).toEqual(["deactivate", "delete b"]);
    expect(steps.reduce(apply, seen)).toEqual({
      names: ["a", "c"],
      active: null,
    });
  });

  it("keeps another active environment and sweeps the strays of a failed rename", () => {
    expect(
      ops(
        planDelete(stored("b", 1, ["b2"]), {
          names: ["a", "b", "b2"],
          active: "a",
        }),
      ),
    ).toEqual(["delete b", "delete b2"]);
    expect(
      ops(
        planDelete(stored("b", 1, ["b2"]), {
          names: ["a", "b", "b2"],
          active: "b2",
        }),
      ),
    ).toEqual(["deactivate", "delete b", "delete b2"]);
  });

  it("has nothing left to do when a retry finds the environment gone", () => {
    expect(planDelete(stored("b", 1), { names: ["a"], active: null })).toEqual(
      [],
    );
  });
});

describe("deleteEnvironment", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetEnvSyncLane();
    vi.mocked(ipc.envList).mockResolvedValue([
      { name: "a", color: null, variables: {} },
      { name: "b", color: null, variables: {} },
    ]);
    vi.mocked(ipc.envActiveGet).mockResolvedValue("b");
    vi.mocked(ipc.envActiveSet).mockResolvedValue(undefined);
    vi.mocked(ipc.envDelete).mockResolvedValue(undefined);
  });

  it("waits behind a queued write on the sync tail", async () => {
    const calls: string[] = [];
    let finishUpsert = () => {};
    vi.mocked(ipc.envUpsert).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          calls.push("upsert");
          finishUpsert = () => {
            calls.push("upsert done");
            resolve();
          };
        }),
    );
    vi.mocked(ipc.envActiveSet).mockImplementation(
      async (name) => void calls.push(`active ${name}`),
    );
    vi.mocked(ipc.envDelete).mockImplementation(
      async (name) => void calls.push(`delete ${name}`),
    );

    const write = syncEnv(goal("b"), stored("b", 1));
    const removal = deleteEnvironment(stored("b", 1));
    await vi.waitFor(() => expect(calls).toEqual(["upsert"]));
    expect(ipc.envList).not.toHaveBeenCalled();

    finishUpsert();
    await expect(write).resolves.toMatchObject({ ok: true });
    await expect(removal).resolves.toEqual({ ok: true });
    expect(calls).toEqual(["upsert", "upsert done", "active null", "delete b"]);
  });

  it("reports a refused delete as a failure", async () => {
    vi.mocked(ipc.envActiveGet).mockResolvedValue(null);
    vi.mocked(ipc.envDelete).mockRejectedValue({
      type: "Io",
      message: "disk full",
    });
    await expect(deleteEnvironment(stored("b", 1))).resolves.toEqual({
      ok: false,
      error: {
        message: messages.envs.editor.deleteFailed,
        detail: "disk full",
      },
    });
  });
});
