import { describe, it, expect, vi } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";

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
import type { InvokeOutcomeIpc, MessageSchemaIpc } from "@/ipc/bindings";

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
  it("shows the in-flight tab progress bar after a short delay, only while sending", () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<ResponsePanel state="sending" outcome={null} />);
      // Delayed: not shown immediately, so fast responses don't flash it.
      expect(screen.queryByTestId("tab-progress")).not.toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(screen.getByTestId("tab-progress")).toBeInTheDocument();
      rerender(<ResponsePanel state="success" outcome={ok} />);
      expect(screen.queryByTestId("tab-progress")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
  it("shows a client/transport error in the Body tab when there is no gRPC outcome", () => {
    render(<ResponsePanel state="error" outcome={null} error="connect `h:50023`: transport error" />);
    expect(screen.getByText(/transport error/i)).toBeInTheDocument();
    expect(screen.queryByTestId("monaco")).not.toBeInTheDocument();
  });
  it("renders the Postman-style error face for a non-OK status", () => {
    render(<ResponsePanel state="error" outcome={err} />);
    // "NOT_FOUND" appears in both the RespMeta status pill (header) and the ErrorView face.
    expect(screen.getAllByText("NOT_FOUND").length).toBeGreaterThan(0);
    expect(screen.getByText("NOT_FOUND: nope")).toBeInTheDocument();
    expect(screen.queryByTestId("monaco")).not.toBeInTheDocument();
  });
});

const inSchema: MessageSchemaIpc = {
  root: "t.In",
  messages: [{
    full_name: "t.In",
    fields: [{
      json_name: "query", proto_name: "query", type_label: "string", value_kind: "scalar",
      repeated: false, message_type: null, enum_type: null, oneof_group: null,
      number: 1, optional: false,
    }],
  }],
  enums: [],
};
const outSchema: MessageSchemaIpc = {
  root: "t.Out",
  messages: [{ full_name: "t.Out", fields: [] }],
  enums: [],
};
const contract = { input: inSchema, output: outSchema, method: "Search" };

describe("ResponsePanel contract tab", () => {
  it("shows no Contract tab without the contract prop (history panels)", () => {
    render(<ResponsePanel state="idle" outcome={null} />);
    expect(screen.queryByRole("tab", { name: "Contract" })).toBeNull();
    expect(screen.getByText(/awaiting first call/i)).toBeInTheDocument();
  });

  it("defaults to the Contract tab pre-send when schemas are available", () => {
    render(<ResponsePanel state="idle" outcome={null} contract={contract} />);
    expect(screen.getByRole("tab", { name: "Contract" })).toBeInTheDocument();
    expect(screen.getByText("query")).toBeInTheDocument();
    expect(screen.queryByText(/awaiting first call/i)).toBeNull();
  });

  it("auto-switches to Body when a response arrives on the auto-chosen Contract tab", () => {
    const { rerender } = render(<ResponsePanel state="idle" outcome={null} contract={contract} />);
    expect(screen.getByText("query")).toBeInTheDocument();
    rerender(<ResponsePanel state="success" outcome={ok} contract={contract} />);
    expect(screen.getByTestId("monaco")).toBeInTheDocument();
    expect(screen.queryByText("query")).toBeNull();
  });

  it("a manual Contract pick survives a response arrival", () => {
    const { rerender } = render(<ResponsePanel state="idle" outcome={null} contract={contract} />);
    // Two explicit clicks: leaving and re-entering Contract marks the choice as
    // manual without relying on whether clicking the active tab fires onChange.
    fireEvent.click(screen.getByRole("tab", { name: "Body" }));
    fireEvent.click(screen.getByRole("tab", { name: "Contract" }));
    rerender(<ResponsePanel state="success" outcome={ok} contract={contract} />);
    expect(screen.getByText("query")).toBeInTheDocument();
    expect(screen.queryByTestId("monaco")).toBeNull();
  });

  it("the side switch survives leaving and re-entering the Contract tab", () => {
    render(<ResponsePanel state="success" outcome={ok} contract={contract} />);
    fireEvent.click(screen.getByRole("tab", { name: "Contract" }));
    fireEvent.click(screen.getByRole("button", { name: "Response" }));
    expect(screen.getByText(/Out/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Body" }));
    fireEvent.click(screen.getByRole("tab", { name: "Contract" }));
    expect(screen.getByRole("button", { name: "Response" })).toHaveAttribute("aria-pressed", "true");
  });
});
