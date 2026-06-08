import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/monaco", () => ({
  MonacoEditor: ({ value, options }: { value: string; options?: { readOnly?: boolean } }) => (
    <pre data-testid="monaco" data-readonly={String(!!options?.readOnly)}>{value}</pre>
  ),
  monacoThemeFor: () => "handshaker-dark",
  BODY_EDIT_OPTIONS: { readOnly: false },
  BODY_READONLY_OPTIONS: { readOnly: true },
}));
vi.mock("@/lib/use-prefs", () => ({ usePrefs: () => [{ theme: "dark" }] }));

import { ResponsePanel } from "./ResponsePanel";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

const ok: InvokeOutcomeIpc = {
  status_code: 0, status_message: "OK",
  response_json: `{"id":"echo"}`, trailing_metadata: {}, elapsed_ms: 5,
};
const err: InvokeOutcomeIpc = {
  status_code: 5, status_message: "NOT_FOUND: nope",
  response_json: null, trailing_metadata: { "x-id": "1" }, elapsed_ms: 9,
};

describe("ResponsePanel", () => {
  it("renders the Monaco body view for a successful response", () => {
    render(<ResponsePanel state="success" outcome={ok} />);
    const el = screen.getByTestId("monaco");
    expect(el.getAttribute("data-readonly")).toBe("true");
    expect(el.textContent).toContain("echo");
  });
  it("shows the in-flight tab progress bar only while sending", () => {
    const { rerender } = render(<ResponsePanel state="sending" outcome={null} />);
    expect(screen.getByTestId("tab-progress")).toBeInTheDocument();
    rerender(<ResponsePanel state="success" outcome={ok} />);
    expect(screen.queryByTestId("tab-progress")).not.toBeInTheDocument();
  });
  it("renders the Postman-style error face for a non-OK status", () => {
    render(<ResponsePanel state="error" outcome={err} />);
    // "NOT_FOUND" appears in both the RespMeta status pill (header) and the ErrorView face.
    expect(screen.getAllByText("NOT_FOUND").length).toBeGreaterThan(0);
    expect(screen.getByText("NOT_FOUND: nope")).toBeInTheDocument();
    expect(screen.queryByTestId("monaco")).not.toBeInTheDocument();
  });
});
