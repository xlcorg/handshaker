import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("sonner", () => ({ toast: { warning: vi.fn() } }));
vi.mock("@/ipc/client", () => ({ ipc: { startupRecoveryTake: vi.fn() } }));

import { toast } from "sonner";
import { ipc } from "@/ipc/client";
import { recoveryMessage, notifyStartupRecovery } from "./startupRecovery";

beforeEach(() => vi.clearAllMocks());

describe("recoveryMessage", () => {
  it("returns null when nothing was recovered", () => {
    expect(recoveryMessage([])).toBeNull();
  });

  it("is singular for one file", () => {
    const m = recoveryMessage(["/data/environments.json.corrupt"]);
    expect(m).toMatch(/1 corrupt file\b/);
    expect(m).not.toMatch(/files/);
  });

  it("is plural for several", () => {
    expect(recoveryMessage(["a", "b"])).toMatch(/2 corrupt files/);
  });
});

describe("notifyStartupRecovery", () => {
  it("toasts a warning when the backend reports recovered files", async () => {
    vi.mocked(ipc.startupRecoveryTake).mockResolvedValue(["x.corrupt"]);
    await notifyStartupRecovery();
    expect(toast.warning).toHaveBeenCalledOnce();
  });

  it("stays silent when nothing was recovered", async () => {
    vi.mocked(ipc.startupRecoveryTake).mockResolvedValue([]);
    await notifyStartupRecovery();
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("swallows backend errors (recovery must never block startup)", async () => {
    vi.mocked(ipc.startupRecoveryTake).mockRejectedValue(new Error("nope"));
    await expect(notifyStartupRecovery()).resolves.toBeUndefined();
    expect(toast.warning).not.toHaveBeenCalled();
  });
});
