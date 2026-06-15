import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/lib/monaco", () => ({
  MonacoEditor: ({ value }: { value: string }) => <pre data-testid="monaco">{value}</pre>,
  BODY_EDIT_OPTIONS: { readOnly: false },
  BODY_READONLY_OPTIONS: { readOnly: true },
  MONACO_THEME: "handshaker-dark",
}));
vi.mock("@/lib/use-prefs", () => ({ usePrefs: () => [{}], readPrefs: () => ({}) }));

const inspect = vi.fn();
const save = vi.fn();
vi.mock("@/ipc/client", () => ({
  base64Inspect: (...a: unknown[]) => inspect(...a),
  base64Save: (...a: unknown[]) => save(...a),
}));
const copy = vi.fn();
vi.mock("@/lib/clipboard", () => ({ copyToClipboard: (...a: unknown[]) => copy(...a) }));
const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a) } }));

import { DecodeDialog } from "./DecodeDialog";

beforeEach(() => {
  inspect.mockReset();
  save.mockReset();
  copy.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
});

describe("DecodeDialog", () => {
  it("shows decoded JSON text and copies it", async () => {
    inspect.mockResolvedValue({ kind: "json", size_bytes: 7, text: `{"a":1}`, mime: null, extension: null });
    render(<DecodeDialog value="eyJhIjoxfQ==" onClose={vi.fn()} />);
    expect(await screen.findByText("JSON")).toBeInTheDocument();
    expect(screen.getByTestId("monaco").textContent).toContain(`{"a":1}`);
    fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    expect(copy).toHaveBeenCalledWith(`{"a":1}`, expect.anything());
  });

  it("shows a binary summary, no editor, and copies base64", async () => {
    inspect.mockResolvedValue({ kind: "binary", size_bytes: 253952, text: null, mime: "image/png", extension: "png" });
    render(<DecodeDialog value="iVBORw0KGgo=" onClose={vi.fn()} />);
    expect(await screen.findByText("image/png")).toBeInTheDocument();
    expect(screen.queryByTestId("monaco")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /copy base64/i }));
    expect(copy).toHaveBeenCalledWith("iVBORw0KGgo=", expect.anything());
  });

  it("calls base64Save with the original value on Save", async () => {
    inspect.mockResolvedValue({ kind: "text", size_bytes: 5, text: "hello", mime: null, extension: null });
    save.mockResolvedValue("/tmp/decoded.txt");
    render(<DecodeDialog value="aGVsbG8=" onClose={vi.fn()} />);
    await screen.findByText("Text");
    fireEvent.click(screen.getByRole("button", { name: /save to file/i }));
    expect(save).toHaveBeenCalledWith("aGVsbG8=");
  });

  it("toasts and closes when decode fails", async () => {
    inspect.mockRejectedValue("Not valid base64");
    const onClose = vi.fn();
    render(<DecodeDialog value="!!!" onClose={onClose} />);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toastError).toHaveBeenCalled();
  });
});
