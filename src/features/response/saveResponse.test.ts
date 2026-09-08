import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/ipc/client", () => ({ fileSaveText: vi.fn() }));
vi.mock("@/lib/savedFileToast", () => ({ savedFileToast: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { fileSaveText } from "@/ipc/client";
import { savedFileToast } from "@/lib/savedFileToast";
import { toast } from "sonner";
import { saveResponseToFile } from "./saveResponse";

const mFileSaveText = vi.mocked(fileSaveText);
const mSavedFileToast = vi.mocked(savedFileToast);
const mSuccess = vi.mocked(toast.success);
const mError = vi.mocked(toast.error);

beforeEach(() => vi.clearAllMocks());

describe("saveResponseToFile", () => {
  it("shows the saved-file actions only after saving succeeds", async () => {
    mFileSaveText.mockResolvedValue("C:/out/response.json");
    await saveResponseToFile(`{"a":1}`);

    expect(mFileSaveText).toHaveBeenCalledTimes(1);
    const [text, name] = mFileSaveText.mock.calls[0];
    expect(text).toBe(`{"a":1}`);
    expect(name).toMatch(/^response-.*\.json$/);

    expect(mSavedFileToast).toHaveBeenCalledTimes(1);
    expect(mSavedFileToast).toHaveBeenCalledWith("C:/out/response.json");
  });

  it("stays silent when the user cancels (null path)", async () => {
    mFileSaveText.mockResolvedValue(null);
    await saveResponseToFile("{}");
    expect(mSuccess).not.toHaveBeenCalled();
    expect(mSavedFileToast).not.toHaveBeenCalled();
    expect(mError).not.toHaveBeenCalled();
  });

  it("error-toasts the failure message", async () => {
    mFileSaveText.mockRejectedValue("disk full");
    await saveResponseToFile("{}");
    expect(mError).toHaveBeenCalledWith("disk full");
    expect(mSavedFileToast).not.toHaveBeenCalled();
  });
});
