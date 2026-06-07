import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { copyToClipboard } from "./clipboard";
import { toast } from "sonner";

beforeEach(() => vi.clearAllMocks());

describe("copyToClipboard", () => {
  it("writes text and shows a confirmation toast", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    await copyToClipboard("payload-123");
    expect(writeText).toHaveBeenCalledWith("payload-123");
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/copied/i));
  });
  it("shows a failure toast when the write rejects", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    await copyToClipboard("x");
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/couldn't copy/i));
  });
});
