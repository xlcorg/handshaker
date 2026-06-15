import { describe, it, expect, vi, beforeEach } from "vitest";

const inspect = vi.fn();
vi.mock("@/ipc/client", () => ({ base64Inspect: (...a: unknown[]) => inspect(...a) }));
const copy = vi.fn();
vi.mock("@/lib/clipboard", () => ({ copyToClipboard: (...a: unknown[]) => copy(...a) }));
const toastError = vi.fn();
const toastMessage = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    message: (...a: unknown[]) => toastMessage(...a),
    success: vi.fn(),
  },
}));

import { copyDecodedBase64 } from "./copyDecoded";

beforeEach(() => {
  inspect.mockReset();
  copy.mockReset();
  toastError.mockReset();
  toastMessage.mockReset();
});

describe("copyDecodedBase64", () => {
  it("copies the decoded text for json/text", async () => {
    inspect.mockResolvedValue({ kind: "json", size_bytes: 7, text: `{"a":1}`, mime: null, extension: null });
    await copyDecodedBase64("eyJhIjoxfQ==");
    expect(inspect).toHaveBeenCalledWith("eyJhIjoxfQ==");
    expect(copy).toHaveBeenCalledWith(`{"a":1}`, expect.stringContaining("copied"));
    expect(toastError).not.toHaveBeenCalled();
  });

  it("does not copy binary; points the user to Save", async () => {
    inspect.mockResolvedValue({ kind: "binary", size_bytes: 100, text: null, mime: "image/png", extension: "png" });
    await copyDecodedBase64("iVBORw0KGgo=");
    expect(copy).not.toHaveBeenCalled();
    expect(toastMessage).toHaveBeenCalledTimes(1);
  });

  it("toasts an error when the value isn't valid base64", async () => {
    inspect.mockRejectedValue("Not valid base64");
    await copyDecodedBase64("!!!");
    expect(copy).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("Not valid base64");
  });
});
