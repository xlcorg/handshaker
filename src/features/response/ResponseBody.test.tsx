import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 22,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ key: index, index, start: index * 22, size: 22 })),
    scrollToIndex: vi.fn(),
  }),
}));
vi.mock("@/lib/download", () => ({ downloadText: vi.fn() }));

import { ResponseBody } from "./ResponseBody";
import { downloadText } from "@/lib/download";
import { toastStore } from "@/lib/toast";

beforeEach(() => {
  toastStore.reset();
  vi.clearAllMocks();
});

describe("ResponseBody", () => {
  it("double-clicking a string value copies it unquoted and toasts", async () => {
    const user = userEvent.setup();
    // user-event attaches a ClipboardStub lazily; spy after setup() so stub exists
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    render(<ResponseBody json={`{"name":"Alice"}`} />);
    await user.dblClick(screen.getByText(`"Alice"`));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Alice");
    await waitFor(() => expect(toastStore.getState()[0]?.message).toMatch(/Скопировано: Alice/));
  });

  it("Ctrl+F opens the search bar and matches highlight + count", async () => {
    const user = userEvent.setup();
    render(<ResponseBody json={`{"city":"Berlin","other":"Berlin"}`} />);
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    const input = await screen.findByRole("textbox");
    await user.type(input, "berlin");
    expect(screen.getByText("1/2")).toBeInTheDocument(); // two value matches
  });

  it("resets search state when the response json changes", async () => {
    const { rerender } = render(<ResponseBody json={`{"a":1}`} />);
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(await screen.findByRole("textbox")).toBeInTheDocument();
    rerender(<ResponseBody json={`{"b":2}`} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("degrades for payloads over the threshold and offers download", async () => {
    const user = userEvent.setup();
    const big = JSON.stringify({ blob: "x".repeat(3 * 1024 * 1024) }); // > 2 MB
    render(<ResponseBody json={big} />);
    const btn = screen.getByRole("button", { name: /Скачать/ });
    expect(btn).toBeInTheDocument();
    expect(screen.queryByRole("tree")).not.toBeInTheDocument(); // tree skipped
    await user.click(btn);
    expect(downloadText).toHaveBeenCalledWith("response.json", big);
  });
});
