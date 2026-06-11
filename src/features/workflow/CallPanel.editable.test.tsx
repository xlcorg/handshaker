import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/features/invoke/BodyEditor", () => ({
  BodyEditor: ({ value }: { value: string }) => <div data-testid="body-editor">{value}</div>,
}));
vi.mock("@/ipc/client", () => ({
  authResolve: vi.fn().mockResolvedValue(null),
  grpcDescribe: vi.fn().mockResolvedValue({ services: [] }),
  grpcRefreshContract: vi.fn().mockResolvedValue({ services: [] }),
  grpcBuildRequestSkeleton: vi.fn().mockResolvedValue("{}"),
  varsResolve: vi.fn(),
  grpcInvokeOneshot: vi.fn(),
  grpcCancel: vi.fn(),
  // No reflection in tests: both schema sides resolve null. NB: useMessageSchema
  // caches results (nulls too) process-wide per address|tls|service|method|side,
  // so a test that wants real schemas must use a target none of the null-returning
  // tests has touched.
  grpcMessageSchema: vi.fn().mockResolvedValue(null),
}));

import { CallPanel } from "./CallPanel";
import { newStep } from "./model";
import { TooltipProvider } from "@/components/ui/tooltip";
import { grpcMessageSchema } from "@/ipc/client";
import type { MessageSchemaIpc } from "@/ipc/bindings";

const draft = newStep({ address: "h:443", tls: true, service: "p.v1.S", method: "GetX" });

beforeEach(() => vi.clearAllMocks());

describe("CallPanel editable", () => {
  it("renders the editable draft header when editable", () => {
    render(
      <TooltipProvider>
        <CallPanel step={draft} onPatch={() => {}} editable />
      </TooltipProvider>
    );
    expect(screen.getByLabelText("draft-address")).toBeTruthy();
  });

  it("renders the read-only AddressBar when not editable", () => {
    render(
      <TooltipProvider>
        <CallPanel step={draft} onPatch={() => {}} />
      </TooltipProvider>
    );
    expect(screen.queryByLabelText("draft-address")).toBeNull();
    expect(screen.getByText("GetX")).toBeTruthy(); // AddressBar shows the method name
  });

  it("toggles TLS through onPatch from the draft header", () => {
    const onPatch = vi.fn();
    render(
      <TooltipProvider>
        <CallPanel step={draft} onPatch={onPatch} editable />
      </TooltipProvider>
    );
    // draft.tls === true → lock shows "TLS enabled"; clicking switches to plaintext
    fireEvent.click(screen.getByLabelText("TLS enabled"));
    expect(onPatch).toHaveBeenCalledWith({ tls: false });
  });

  it("Ctrl+Enter sends the editable draft (sets status: sending)", () => {
    const onPatch = vi.fn();
    render(
      <TooltipProvider>
        <CallPanel step={draft} onPatch={onPatch} editable />
      </TooltipProvider>
    );
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    // onSend's first effect is to mark the step as sending.
    expect(onPatch).toHaveBeenCalledWith(expect.objectContaining({ status: "sending" }));
  });

  it("does not bind the send shortcut when not editable", () => {
    const onPatch = vi.fn();
    render(
      <TooltipProvider>
        <CallPanel step={draft} onPatch={onPatch} />
      </TooltipProvider>
    );
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    expect(onPatch).not.toHaveBeenCalled();
  });
});

describe("CallPanel contract tab", () => {
  it("shows the Contract tab on the editable draft", () => {
    render(
      <TooltipProvider>
        <CallPanel step={draft} onPatch={() => {}} editable />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Contract" }));
    // schema fetch is mocked away → both sides null → placeholder text
    expect(screen.getByText(/Контракт недоступен/)).toBeInTheDocument();
  });

  it("offers no Contract tab on non-editable (history) panels", () => {
    render(
      <TooltipProvider>
        <CallPanel step={draft} onPatch={() => {}} />
      </TooltipProvider>,
    );
    expect(screen.queryByRole("tab", { name: "Contract" })).toBeNull();
  });

  it("threads the request and response schemas to the correct contract sides", async () => {
    const schemaWithField = (root: string, name: string): MessageSchemaIpc => ({
      root,
      messages: [{
        full_name: root,
        fields: [{
          json_name: name, proto_name: name, type_label: "string", value_kind: "scalar",
          repeated: false, message_type: null, enum_type: null, oneof_group: null,
          number: 1, optional: false,
        }],
      }],
      enums: [],
    });
    vi.mocked(grpcMessageSchema).mockImplementation((_t, _s, _m, side) =>
      Promise.resolve(schemaWithField(side === "input" ? "t.Req" : "t.Resp", side === "input" ? "req_field" : "resp_field")),
    );
    // Distinct method → fresh useMessageSchema cache keys (the tests above already
    // cached null for `draft`'s keys, which would shadow this side-aware mock).
    const sideDraft = newStep({ address: "h:443", tls: true, service: "p.v1.S", method: "GetSides" });
    render(
      <TooltipProvider>
        <CallPanel step={sideDraft} onPatch={() => {}} editable />
      </TooltipProvider>,
    );
    // Schemas resolve async; the idle panel then auto-defaults to the Contract
    // tab, which lists both sides at once.
    expect(await screen.findByText("req_field")).toBeInTheDocument();
    expect(screen.getByText("resp_field")).toBeInTheDocument();
    // The rpc signature pins which root landed on which side — a swapped
    // input/output wiring would print `rpc GetSides(Resp) returns (Req);`.
    const rpcLine = screen
      .getAllByText("GetSides")
      .map((el) => el.closest("div.whitespace-pre"))
      .find((d) => d !== null);
    expect(rpcLine?.textContent).toBe("rpc GetSides(Req) returns (Resp);");
  });
});

