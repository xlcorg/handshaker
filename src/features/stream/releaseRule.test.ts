import { beforeEach, describe, expect, it, vi } from "vitest";

// Both shapes of the facade (named exports AND the `ipc` object) — the store's env echo
// and the rule's default release both go through it.
vi.mock("@/ipc/client", () => {
  const api = { envActiveSet: vi.fn().mockResolvedValue(undefined), streamRelease: vi.fn().mockResolvedValue(undefined) };
  return { ...api, ipc: api };
});
import { workflowStore } from "@/features/workflow/store";
import { newStep } from "@/features/workflow/model";
import { removeStep } from "@/features/workflow/reducers";
import { streamStore } from "./streamStore";
import { installStreamReleaseRule } from "./releaseRule";

let release: ReturnType<typeof vi.fn<(id: string) => Promise<void>>>;
let uninstall: () => void;

beforeEach(() => {
  workflowStore.reset();
  streamStore.reset();
  release = vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined);
  uninstall = installStreamReleaseRule(release);
  return () => uninstall();
});

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("stream release rule", () => {
  it("re-Open of the same step (fresh streamId) releases the old id and drops its entry", async () => {
    streamStore.open("s1", "server", Date.now());
    workflowStore.setDraft({ ...newStep({ address: "h", service: "S", method: "M" }), streamId: "s1" });
    expect(release).not.toHaveBeenCalled();

    streamStore.open("s2", "server", Date.now());
    workflowStore.updateDraft(workflowStore.getState().draft!.id, { streamId: "s2" });
    await flush();

    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith("s1");
    expect(streamStore.get("s1")).toBeNull();
    expect(streamStore.get("s2")).not.toBeNull();
  });

  it("an id still referenced by a history snapshot survives the draft moving on", async () => {
    streamStore.open("s1", "server", Date.now());
    const step = { ...newStep({ address: "h", service: "S", method: "M" }), streamId: "s1" };
    workflowStore.setDraft(step);
    workflowStore.commitExecutedStep({ ...step, id: "snap" });
    workflowStore.updateDraft(workflowStore.getState().draft!.id, { streamId: "s2" });
    await flush();
    expect(release).not.toHaveBeenCalled();

    workflowStore.update((w) => removeStep(w, "snap"));
    await flush();
    expect(release).toHaveBeenCalledWith("s1");
  });

  it("clearing the draft releases its stream; a release failure is swallowed", async () => {
    release.mockRejectedValueOnce(new Error("gone"));
    workflowStore.setDraft({ ...newStep({ address: "h", service: "S", method: "M" }), streamId: "s1" });
    workflowStore.clearDraft();
    await flush();
    expect(release).toHaveBeenCalledWith("s1");
  });

  it("unrelated transitions release nothing", async () => {
    workflowStore.setDraft({ ...newStep({ address: "h", service: "S", method: "M" }), streamId: "s1" });
    workflowStore.updateDraft(workflowStore.getState().draft!.id, { requestJson: "{}" });
    workflowStore.setWorkflowEnv("dev");
    await flush();
    expect(release).not.toHaveBeenCalled();
  });
});
