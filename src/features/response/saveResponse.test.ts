import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/ipc/client", () => ({ fileSaveText: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { fileSaveText } from "@/ipc/client";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { saveResponseToFile } from "./saveResponse";

const mFileSaveText = vi.mocked(fileSaveText);
const mReveal = vi.mocked(revealItemInDir);
const mSuccess = vi.mocked(toast.success);
const mError = vi.mocked(toast.error);

beforeEach(() => vi.clearAllMocks());

describe("saveResponseToFile", () => {
  it("on success toasts with a 'Show in folder' action that reveals the file", async () => {
    mFileSaveText.mockResolvedValue("C:/out/response.json");
    await saveResponseToFile(`{"a":1}`);

    expect(mFileSaveText).toHaveBeenCalledTimes(1);
    const [text, name] = mFileSaveText.mock.calls[0];
    expect(text).toBe(`{"a":1}`);
    expect(name).toMatch(/^response-.*\.json$/);

    expect(mSuccess).toHaveBeenCalledTimes(1);
    const [msg, opts] = mSuccess.mock.calls[0] as [string, { action: { label: string; onClick: () => void } }];
    expect(msg).toContain("C:/out/response.json");
    expect(opts.action.label).toBe("Show in folder");
    opts.action.onClick();
    expect(mReveal).toHaveBeenCalledWith("C:/out/response.json");
  });

  it("stays silent when the user cancels (null path)", async () => {
    mFileSaveText.mockResolvedValue(null);
    await saveResponseToFile("{}");
    expect(mSuccess).not.toHaveBeenCalled();
    expect(mError).not.toHaveBeenCalled();
  });

  it("error-toasts the failure message", async () => {
    mFileSaveText.mockRejectedValue("disk full");
    await saveResponseToFile("{}");
    expect(mError).toHaveBeenCalledWith("disk full");
  });
});
