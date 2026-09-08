import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { savedFileToast } from "./savedFileToast";
import { messages } from "./messages";
import { Toaster } from "@/components/ui/sonner";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: vi.fn(),
  revealItemInDir: vi.fn(),
}));
vi.spyOn(toast, "success");
vi.spyOn(toast, "error");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(openPath).mockResolvedValue(undefined);
  vi.mocked(revealItemInDir).mockResolvedValue(undefined);
});

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
});

async function show(path: string) {
  render(<Toaster />);
  act(() => {
    savedFileToast(path);
  });
  const [title] = vi.mocked(toast.success).mock.calls[0];
  expect(title).toBe(messages.response.save.saved);
  await screen.findByRole("button", { name: "Show in folder" });
}

describe("savedFileToast", () => {
  it.each([
    ["/Users/alex/My Downloads/ответ.json", "/Users/alex/My Downloads/"],
    ["C:\\My Downloads\\ответ.json", "C:\\My Downloads\\"],
    ["/ответ.json", "/"],
  ])(
    "opens the exact saved path %s on click, and reveals it separately",
    async (path, directory) => {
      await show(path);
      expect(screen.getByText(directory)).toBeInTheDocument();
      expect(openPath).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Open ответ.json" }));
      expect(openPath).toHaveBeenCalledWith(path);
      expect(revealItemInDir).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Show in folder" }));
      expect(revealItemInDir).toHaveBeenCalledWith(path);
    },
  );

  it("opens from the keyboard", async () => {
    const user = userEvent.setup();
    await show("/tmp/response.json");
    await user.tab(); // Sonner makes the toast itself focusable.
    await user.tab();
    expect(
      screen.getByRole("button", { name: "Open response.json" }),
    ).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(openPath).toHaveBeenCalledWith("/tmp/response.json");
  });

  it.each(["open", "reveal"])("reports a failed %s action", async (action) => {
    const opening = action === "open";
    vi.mocked(opening ? openPath : revealItemInDir).mockRejectedValue(
      new Error("missing file"),
    );
    await show("/tmp/response.json");
    fireEvent.click(
      screen.getByRole("button", {
        name: opening ? "Open response.json" : "Show in folder",
      }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        opening
          ? messages.response.save.openFailed
          : messages.response.save.revealFailed,
      ),
    );
  });
});
