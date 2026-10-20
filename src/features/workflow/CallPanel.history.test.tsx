import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/features/invoke/BodyEditor", () => ({
  BodyEditor: ({ value }: { value: string }) => (
    <div data-testid="body-editor">{value}</div>
  ),
}));
const api = vi.hoisted(() => ({
  authResolve: vi.fn().mockResolvedValue(null),
  authEffective: vi.fn().mockResolvedValue({ kind: "none" }),
  authInvalidate: vi.fn().mockResolvedValue(undefined),
  grpcContractRead: vi.fn(),
  varsResolve: vi.fn(),
  grpcSend: vi.fn().mockResolvedValue({
    outcome: {
      status_code: 0,
      status_message: "",
      response_json: "{}",
      trailing_metadata: {},
      status_details: [],
      elapsed_ms: 1,
    },
    auth_used: { kind: "none" },
    tls_used: false,
  }),
  grpcCancel: vi.fn().mockResolvedValue(undefined),
  streamOpen: vi.fn().mockResolvedValue(undefined),
  streamSend: vi.fn(),
  streamHalfClose: vi.fn().mockResolvedValue(undefined),
  streamRelease: vi.fn().mockResolvedValue(undefined),
  envActiveSet: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/ipc/client", () => ({ ...api, ipc: api }));
vi.mock("@/features/catalog/CatalogProvider", () => ({
  useCatalog: () => ({ bumpUsage: vi.fn(() => Promise.resolve()) }),
}));

import { CallPanel } from "./CallPanel";
import { newStep, type Step } from "./model";
import { workflowStore } from "./store";
import { streamStore } from "@/features/stream/streamStore";
import { messages } from "@/lib/messages";
import { TooltipProvider } from "@/components/ui/tooltip";
import type {
  MethodKindIpc,
  ServiceCatalogIpc,
  StreamEventIpc,
} from "@/ipc/bindings";

const m = messages.workflow.addressBar;

function catalogWith(
  method: string,
  client_streaming: boolean,
  server_streaming: boolean,
): ServiceCatalogIpc {
  return {
    services: [
      {
        full_name: "p.v1.S",
        methods: [
          {
            name: method,
            path: `/p.v1.S/${method}`,
            input_message: "Req",
            output_message: "Resp",
            client_streaming,
            server_streaming,
          },
        ],
      },
    ],
  };
}

function serveCatalog(catalog: ServiceCatalogIpc) {
  api.grpcContractRead.mockImplementation(
    async (_a: unknown, _t: unknown, _c: unknown, query: { op?: string }) => {
      if (query?.op === "skeleton") return { kind: "skeleton", json: "{}" };
      if (query?.op === "schema")
        return {
          kind: "schema",
          schema: { root: "t.M", messages: [], enums: [] },
        };
      return { kind: "catalog", catalog };
    },
  );
}

const endOk: StreamEventIpc = {
  type: "End",
  status_code: 0,
  status_message: "",
  status_details: [],
  trailing_metadata: {},
  elapsed_ms: 5,
  message_count: 1,
  total_bytes: 2,
};
const opened = (kind: MethodKindIpc): StreamEventIpc => ({
  type: "Opened",
  kind,
  auth_used: { kind: "none" },
  tls_used: true,
  bytes_fields: [],
});

/** A history snapshot of an ended Stream call opened with `kind` (no catalog anywhere). */
function streamSnapshot(kind: MethodKindIpc, id = "old"): Step {
  streamStore.open(id, kind, Date.now());
  streamStore.push(id, opened(kind));
  streamStore.push(id, endOk);
  return {
    ...newStep({ address: "h:443", tls: true, service: "p.v1.S", method: "M" }),
    status: "ok",
    streamId: id,
  };
}

async function renderPanel(ui: React.ReactElement) {
  const result = render(<TooltipProvider>{ui}</TooltipProvider>);
  await act(async () => {});
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  // `clearAllMocks` keeps implementations — a per-test `streamOpen` script must not leak.
  api.streamOpen.mockReset().mockResolvedValue(undefined);
  serveCatalog({ services: [] });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  workflowStore.reset();
  streamStore.reset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("controls-kind precedence", () => {
  it("with no catalog and a previously executed client call, the draft shows Open and opens as client", async () => {
    const step = streamSnapshot("client");
    await renderPanel(<CallPanel step={step} onPatch={vi.fn()} />);
    expect(screen.getByRole("button", { name: m.open })).toBeInTheDocument();
    expect(
      screen.getByText(messages.methodKind.badge.client),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: m.open }));
    await act(async () => {});
    expect(api.streamOpen.mock.calls[0][3]).toBe("client");
  });

  it("while a client call is live, a catalog that now says server-streaming does not flip the controls", async () => {
    serveCatalog(catalogWith("M", false, true));
    streamStore.open("rid", "client", Date.now());
    streamStore.push("rid", opened("client"));
    const live: Step = {
      ...newStep({
        address: "h:443",
        tls: true,
        service: "p.v1.S",
        method: "M",
      }),
      status: "sending",
      requestId: "rid",
      streamId: "rid",
    };
    vi.useFakeTimers();
    await renderPanel(<CallPanel step={live} onPatch={vi.fn()} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(api.grpcContractRead).toHaveBeenCalled();
    // Live wins: the badge and the segmented controls stay client's.
    expect(
      screen.getByText(messages.methodKind.badge.client),
    ).toBeInTheDocument();
    expect(screen.queryByText(messages.methodKind.badge.server)).toBeNull();
    expect(
      screen.getByRole("button", { name: /send message/i }),
    ).toBeInTheDocument();
  });

  it("after the call ends the catalog kind wins again over the executed kind", async () => {
    serveCatalog(catalogWith("M", false, true));
    const step = streamSnapshot("client");
    await renderPanel(<CallPanel step={step} onPatch={vi.fn()} />);
    await screen.findByText(
      messages.methodKind.badge.server,
      {},
      { timeout: 3000 },
    );
    expect(screen.getByRole("button", { name: m.send })).toBeInTheDocument();
    expect(screen.queryByText(messages.methodKind.badge.client)).toBeNull();
  });
});
