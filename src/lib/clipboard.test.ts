import { describe, it, expect, beforeEach, vi } from "vitest";
import { copyToClipboard } from "./clipboard";
import { toastStore } from "./toast";

beforeEach(() => toastStore.reset());

describe("copyToClipboard", () => {
  it("writes text and shows a confirmation toast", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    await copyToClipboard("payload-123");
    expect(writeText).toHaveBeenCalledWith("payload-123");
    expect(toastStore.getState()[0].message).toMatch(/копировано/i);
  });
  it("shows a failure toast when the write rejects", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    await copyToClipboard("x");
    expect(toastStore.getState()[0].message).toMatch(/не удалось/i);
  });
});
