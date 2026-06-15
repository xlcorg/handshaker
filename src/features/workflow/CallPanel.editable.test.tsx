import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/features/invoke/BodyEditor", () => ({
  BodyEditor: ({ value }: { value: string }) => <div data-testid="body-editor">{value}</div>,
}));
vi.mock("@/ipc/client", () => ({
  authResolve: vi.fn().mockResolvedValue(null),
  authInvalidate: vi.fn().mockResolvedValue(undefined),
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
import { grpcMessageSchema, grpcRefreshContract, authInvalidate, authResolve, varsResolve, grpcInvokeOneshot } from "@/ipc/client";
import type { MessageSchemaIpc, InvokeOutcomeIpc, ResolutionReportIpc } from "@/ipc/bindings";

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
    // The panel defaults to Body; open the Contract tab explicitly. Schemas
    // resolve async — the tab then lists both sides at once.
    fireEvent.click(screen.getByRole("tab", { name: "Contract" }));
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

describe("CallPanel reflection refresh", () => {
  it("refetches the contract schema when 'Refresh server reflection' is clicked", async () => {
    // A fresh target so the process-wide useMessageSchema cache (and its null entries
    // from other tests) doesn't shadow this fetch.
    const wireSchema: MessageSchemaIpc = { root: "t.Wire", messages: [], enums: [] };
    vi.mocked(grpcMessageSchema).mockResolvedValue(wireSchema);
    const wireDraft = newStep({ address: "wire-host:443", tls: true, service: "p.v1.S", method: "WireRefresh" });
    render(
      <TooltipProvider>
        <CallPanel step={wireDraft} onPatch={() => {}} editable />
      </TooltipProvider>,
    );
    // Initial input+output schema fetch for this fresh target lands.
    await waitFor(() => expect(grpcMessageSchema).toHaveBeenCalled());
    const before = vi.mocked(grpcMessageSchema).mock.calls.length;

    // Open the MethodPicker dropdown (Radix opens on Enter, not plain click), then fire
    // the reflection refresh that lives in its footer.
    fireEvent.keyDown(screen.getByRole("button", { name: /WireRefresh/ }), { key: "Enter" });
    fireEvent.click(await screen.findByLabelText("Refresh server reflection"));

    // Refresh must re-reflect the backend AND refetch the schema. The bug: it only did the
    // former, so the contract tab + body hints froze on the first result ("one-time action").
    await waitFor(() => expect(grpcRefreshContract).toHaveBeenCalled());
    await waitFor(() =>
      expect(vi.mocked(grpcMessageSchema).mock.calls.length).toBeGreaterThan(before),
    );
  });
});

describe("CallPanel collection-auth inheritance (originAuth)", () => {
  const collectionOauth = {
    kind: "oauth2_client_credentials" as const,
    token_url: "https://idp/token",
    client_id: "cid",
    client_secret: "{{s}}",
    scopes: [],
    header_name: "authorization",
    prefix: "Bearer ",
    environments: [] as string[],
  };
  const okOutcome: InvokeOutcomeIpc = {
    status_code: 0,
    status_message: "OK",
    response_json: "{}",
    trailing_metadata: {},
    elapsed_ms: 1,
  };
  const passthrough = (t: string): Promise<ResolutionReportIpc> =>
    Promise.resolve({ resolved: t, unresolved_vars: [], cycle_chain: null });

  it("sends with the collection's oauth2 header when the step auth is none", async () => {
    vi.mocked(varsResolve).mockImplementation(passthrough);
    vi.mocked(authResolve).mockResolvedValue({
      header_name: "authorization",
      header_value: "Bearer T",
    });
    vi.mocked(grpcInvokeOneshot).mockResolvedValueOnce(okOutcome);
    const onExecuted = vi.fn();

    // step auth defaults to none — inheritance must kick in
    const inheritDraft = newStep({ address: "h:443", tls: true, service: "p.v1.S", method: "GetInherit" });
    render(
      <TooltipProvider>
        <CallPanel step={inheritDraft} onPatch={() => {}} onExecuted={onExecuted} editable originAuth={collectionOauth} />
      </TooltipProvider>,
    );
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });

    await waitFor(() => expect(grpcInvokeOneshot).toHaveBeenCalledTimes(1));
    expect(authResolve).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "oauth2_client_credentials" }),
    );
    const requestArg = vi.mocked(grpcInvokeOneshot).mock.calls[0][1];
    expect(requestArg.metadata).toMatchObject({ authorization: "Bearer T" });
    // The executed history snapshot records the auth actually used, so re-send works.
    expect(onExecuted).toHaveBeenCalledWith(
      expect.objectContaining({ auth: expect.objectContaining({ kind: "oauth2_client_credentials" }) }),
    );
  });

  it("shows the inherited collection config in the Auth tab", () => {
    const inheritDraft = newStep({ address: "h:443", tls: true, service: "p.v1.S", method: "GetAuthTab" });
    render(
      <TooltipProvider>
        <CallPanel step={inheritDraft} onPatch={() => {}} editable originAuth={collectionOauth} />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Auth" }));
    expect(screen.getByText(/oauth2_client_credentials/)).toBeInTheDocument();
    expect(screen.getByText(/https:\/\/idp\/token/)).toBeInTheDocument();
  });
});

describe("CallPanel oauth2 token invalidation", () => {
  it("invalidates the oauth2 token cache when a send returns UNAUTHENTICATED (16)", async () => {
    const passthrough = (t: string): Promise<ResolutionReportIpc> =>
      Promise.resolve({ resolved: t, unresolved_vars: [], cycle_chain: null });
    vi.mocked(varsResolve).mockImplementation(passthrough);
    vi.mocked(authResolve).mockResolvedValue({
      header_name: "authorization",
      header_value: "Bearer T",
    });
    const unauthOutcome: InvokeOutcomeIpc = {
      status_code: 16,
      status_message: "UNAUTHENTICATED",
      response_json: null,
      trailing_metadata: {},
      elapsed_ms: 0,
    };
    vi.mocked(grpcInvokeOneshot).mockResolvedValueOnce(unauthOutcome);

    const oauth2Auth = {
      kind: "oauth2_client_credentials" as const,
      token_url: "https://auth.example.com/token",
      client_id: "client-id",
      client_secret: "secret",
      scopes: ["api"],
      header_name: "authorization" as string | undefined,
      prefix: "Bearer" as string | undefined,
      environments: [] as string[],
    };
    const draftWithOauth = newStep({
      address: "h:443",
      tls: true,
      service: "p.v1.S",
      method: "GetAuth",
      auth: oauth2Auth,
    });

    render(
      <TooltipProvider>
        <CallPanel step={draftWithOauth} onPatch={() => {}} editable />
      </TooltipProvider>,
    );

    // Trigger send via Ctrl+Enter
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });

    await waitFor(() => expect(authInvalidate).toHaveBeenCalledTimes(1));
  });
});

