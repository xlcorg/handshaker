import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";

vi.mock("@/lib/monaco", () => ({
  MonacoEditor: ({ value, options }: { value: string; options?: { readOnly?: boolean } }) => (
    <pre data-testid="monaco" data-readonly={String(!!options?.readOnly)}>{value}</pre>
  ),
  BODY_EDIT_OPTIONS: { readOnly: false },
  BODY_READONLY_OPTIONS: { readOnly: true },
  MONACO_THEME: "handshaker-dark",
}));
vi.mock("@/lib/use-prefs", () => ({ usePrefs: () => [{}] }));
vi.mock("./saveResponse", () => ({ saveResponseToFile: vi.fn() }));

import { ResponsePanel } from "./ResponsePanel";
import type { InvokeOutcomeIpc, MessageSchemaIpc } from "@/ipc/bindings";
import { saveResponseToFile } from "./saveResponse";

const ok: InvokeOutcomeIpc = {
  status_code: 0, status_message: "OK",
  response_json: `{"id":"echo"}`, trailing_metadata: {}, status_details: [], elapsed_ms: 5,
};
const err: InvokeOutcomeIpc = {
  status_code: 5, status_message: "nope",
  response_json: null, trailing_metadata: { "x-id": "1" }, status_details: [], elapsed_ms: 9,
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
    render(
      <ResponsePanel
        state="error"
        outcome={null}
        error={{ kind: "other", message: "connect `h:50023`: transport error" }}
      />,
    );
    expect(screen.getByText(/transport error/i)).toBeInTheDocument();
    expect(screen.queryByTestId("monaco")).not.toBeInTheDocument();
  });
  it("renders the Postman-style error face for a non-OK status", () => {
    render(<ResponsePanel state="error" outcome={err} />);
    // "NOT_FOUND" shows exactly once — only in the RespMeta summary, no longer
    // duplicated by an ErrorView header band.
    expect(screen.getAllByText("NOT_FOUND")).toHaveLength(1);
    // The message line shows the server's raw message (no code prefix).
    expect(screen.getByText("nope")).toBeInTheDocument();
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

  it("defaults to the Body tab pre-send; Contract is an explicit click away", () => {
    render(<ResponsePanel state="idle" outcome={null} contract={contract} />);
    expect(screen.getByRole("tab", { name: "Body" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Contract" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Contract" }));
    expect(screen.getByText("query")).toBeInTheDocument();
    expect(screen.queryByText(/awaiting first call/i)).toBeNull();
  });

  it("Send pulls the view to Body even from a manually picked Contract tab", () => {
    const { rerender } = render(<ResponsePanel state="idle" outcome={null} contract={contract} />);
    fireEvent.click(screen.getByRole("tab", { name: "Contract" }));
    expect(screen.getByText("query")).toBeInTheDocument();
    rerender(<ResponsePanel state="sending" outcome={null} contract={contract} />);
    expect(screen.getByRole("tab", { name: "Body" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByText("query")).toBeNull();
  });

  it("a mid-flight Contract pick survives the response arrival (only Send switches tabs)", () => {
    const { rerender } = render(<ResponsePanel state="sending" outcome={null} contract={contract} />);
    fireEvent.click(screen.getByRole("tab", { name: "Contract" }));
    rerender(<ResponsePanel state="success" outcome={ok} contract={contract} />);
    expect(screen.getByRole("tab", { name: "Contract" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("query")).toBeInTheDocument();
    expect(screen.queryByTestId("monaco")).toBeNull();
  });

  it("shows both contract sides at once on the Contract tab", () => {
    const { container } = render(<ResponsePanel state="success" outcome={ok} contract={contract} />);
    fireEvent.click(screen.getByRole("tab", { name: "Contract" }));
    expect(screen.getByText("query")).toBeInTheDocument();
    const lines = Array.from(container.querySelectorAll("div.whitespace-pre")).map((d) => d.textContent);
    expect(lines[0]).toBe("rpc Search(In) returns (Out);");
    expect(lines).toContain("message Out {}");
  });
});

describe("ResponsePanel save-to-file", () => {
  const mSave = vi.mocked(saveResponseToFile);
  beforeEach(() => mSave.mockClear());

  it("has no Save icon in the header (save is via context menu + Ctrl/Cmd+S)", () => {
    render(<ResponsePanel state="success" outcome={ok} method="Search" />);
    expect(screen.queryByLabelText("Save response to file")).toBeNull();
  });

  it("Ctrl+S saves the body when one is present", () => {
    render(<ResponsePanel state="success" outcome={ok} method="Search" />);
    fireEvent.keyDown(screen.getByTestId("monaco"), { key: "s", code: "KeyS", ctrlKey: true });
    expect(mSave).toHaveBeenCalledWith(ok.response_json, "Search");
  });

  it("Ctrl+S does nothing when there is no body (error response)", () => {
    const { container } = render(<ResponsePanel state="error" outcome={err} />);
    fireEvent.keyDown(container.firstChild as Element, { key: "s", code: "KeyS", ctrlKey: true });
    expect(mSave).not.toHaveBeenCalled();
  });
});
