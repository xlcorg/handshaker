import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/features/invoke/BodyEditor", () => ({
  BodyEditor: ({ value }: { value: string }) => <div data-testid="body-editor">{value}</div>,
}));
// Both facade shapes (named exports AND `ipc`) — `actions.ts` / `callLifecycle` /
// `releaseRule` read the namespace, other modules the object.
const api = vi.hoisted(() => ({
  authResolve: vi.fn().mockResolvedValue(null),
  authEffective: vi.fn().mockResolvedValue({ kind: "none" }),
  authInvalidate: vi.fn().mockResolvedValue(undefined),
  grpcDescribe: vi.fn().mockResolvedValue({ services: [] }),
  grpcRefreshContract: vi.fn().mockResolvedValue({ services: [] }),
  grpcBuildRequestSkeleton: vi.fn().mockResolvedValue("{}"),
  grpcMessageSchema: vi.fn().mockResolvedValue(null),
  varsResolve: vi.fn(),
  grpcSend: vi.fn().mockResolvedValue({
    outcome: { status_code: 0, status_message: "", response_json: "{}", trailing_metadata: {}, status_details: [], elapsed_ms: 1 },
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
import { updateStep } from "./reducers";
import { streamStore } from "@/features/stream/streamStore";
import { installStreamReleaseRule } from "@/features/stream/releaseRule";
import { messages } from "@/lib/messages";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { MethodKindIpc, ServiceCatalogIpc, StreamEventIpc } from "@/ipc/bindings";

const m = messages.workflow.addressBar;

function catalogWith(method: string, client_streaming: boolean, server_streaming: boolean): ServiceCatalogIpc {
  return { services: [{ full_name: "p.v1.S", methods: [{
    name: method, path: `/p.v1.S/${method}`, input_message: "Req", output_message: "Resp",
    client_streaming, server_streaming,
  }] }] };
}

const endOk: StreamEventIpc = {
  type: "End", status_code: 0, status_message: "", status_details: [], trailing_metadata: {}, elapsed_ms: 5, message_count: 1, total_bytes: 2,
};
const opened = (kind: MethodKindIpc): StreamEventIpc =>
  ({ type: "Opened", kind, auth_used: { kind: "none" }, tls_used: true, bytes_fields: [] });

/** A history snapshot of an ended Stream call opened with `kind` (no catalog anywhere). */
function streamSnapshot(kind: MethodKindIpc, id = "old"): Step {
  streamStore.open(id, kind, Date.now());
  streamStore.push(id, opened(kind));
  streamStore.push(id, endOk);
  return { ...newStep({ address: "h:443", tls: true, service: "p.v1.S", method: "M" }), status: "ok", streamId: id };
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
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 1; });
  workflowStore.reset();
  streamStore.reset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("history re-send routes by the executed kind (panels never reflect)", () => {
  it("client-streaming snapshot: Open → streamOpen(kind client); once Opened, the segmented controls", async () => {
    const step = streamSnapshot("client");
    api.streamOpen.mockImplementation(async (...a: unknown[]) => {
      (a[5] as (e: StreamEventIpc) => void)(opened("client"));
    });
    let cur = step;
    const onPatch = vi.fn((p: Partial<Step>) => { cur = { ...cur, ...p }; });
    vi.useFakeTimers();
    const { rerender } = await renderPanel(<CallPanel step={step} onPatch={onPatch} />);

    expect(screen.getByRole("button", { name: m.open })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: m.send })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: m.open }));
    await act(async () => {});

    expect(api.streamOpen).toHaveBeenCalledTimes(1);
    expect(api.streamOpen.mock.calls[0][3]).toBe("client");
    expect(api.grpcSend).not.toHaveBeenCalled();
    rerender(<TooltipProvider><CallPanel step={cur} onPatch={onPatch} /></TooltipProvider>);
    act(() => { vi.advanceTimersByTime(250); });
    expect(screen.getByRole("button", { name: /send message/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^end stream$/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeEnabled();
  });

  it("server-streaming snapshot: Send → streamOpen(kind server) → lone Cancel", async () => {
    const step = streamSnapshot("server");
    let cur = step;
    const onPatch = vi.fn((p: Partial<Step>) => { cur = { ...cur, ...p }; });
    vi.useFakeTimers();
    const { rerender } = await renderPanel(<CallPanel step={step} onPatch={onPatch} />);

    fireEvent.click(screen.getByRole("button", { name: m.send }));
    await act(async () => {});

    expect(api.streamOpen).toHaveBeenCalledTimes(1);
    expect(api.streamOpen.mock.calls[0][3]).toBe("server");
    expect(api.grpcSend).not.toHaveBeenCalled();
    rerender(<TooltipProvider><CallPanel step={cur} onPatch={onPatch} /></TooltipProvider>);
    act(() => { vi.advanceTimersByTime(250); });
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send message/i })).toBeNull();
  });

  it("unary snapshot: Send → grpcSend, never a stream", async () => {
    const step: Step = { ...newStep({ address: "h:443", tls: true, service: "p.v1.S", method: "M" }), status: "ok",
      outcome: { status_code: 0, status_message: "", response_json: "{}", trailing_metadata: {}, status_details: [], elapsed_ms: 3 } };
    await renderPanel(<CallPanel step={step} onPatch={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: m.send }));
    await act(async () => {});
    expect(api.grpcSend).toHaveBeenCalledTimes(1);
    expect(api.streamOpen).not.toHaveBeenCalled();
  });

  it("the read-only history header shows no kind badge", async () => {
    const step = streamSnapshot("client");
    await renderPanel(<CallPanel step={step} onPatch={vi.fn()} />);
    expect(screen.queryByText(messages.methodKind.badge.client)).toBeNull();
  });

  it("re-opening a history stream step replaces its streamId and the release rule frees the old entry", async () => {
    const step = streamSnapshot("server", "old");
    workflowStore.update((w) => ({ ...w, steps: [step] }));
    const release = vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined);
    const uninstall = installStreamReleaseRule(release);
    try {
      await renderPanel(
        <CallPanel step={step} onPatch={(p) => workflowStore.update((w) => updateStep(w, step.id, p))} />,
      );
      fireEvent.click(screen.getByRole("button", { name: m.send }));
      await act(async () => {});
      await new Promise<void>((r) => setTimeout(r, 0));

      const rid = api.streamOpen.mock.calls[0][2] as string;
      expect(rid).not.toBe("old");
      expect(workflowStore.activeWorkflow().steps[0].streamId).toBe(rid);
      expect(release).toHaveBeenCalledWith("old");
      expect(streamStore.get("old")).toBeNull();
      expect(streamStore.get(rid)).not.toBeNull();
    } finally {
      uninstall();
    }
  });
});

describe("controls-kind precedence in the editable panel", () => {
  it("with no catalog and a previously executed client call, the draft shows Open and opens as client", async () => {
    const step = streamSnapshot("client");
    await renderPanel(<CallPanel step={step} onPatch={vi.fn()} editable />);
    expect(screen.getByRole("button", { name: m.open })).toBeInTheDocument();
    expect(screen.getByText(messages.methodKind.badge.client)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: m.open }));
    await act(async () => {});
    expect(api.streamOpen.mock.calls[0][3]).toBe("client");
  });

  it("while a client call is live, a catalog that now says server-streaming does not flip the controls", async () => {
    api.grpcDescribe.mockResolvedValue(catalogWith("M", false, true));
    streamStore.open("rid", "client", Date.now());
    streamStore.push("rid", opened("client"));
    const live: Step = { ...newStep({ address: "h:443", tls: true, service: "p.v1.S", method: "M" }),
      status: "sending", requestId: "rid", streamId: "rid" };
    vi.useFakeTimers();
    await renderPanel(<CallPanel step={live} onPatch={vi.fn()} editable />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(api.grpcDescribe).toHaveBeenCalled();
    // Live wins: the badge and the segmented controls stay client's.
    expect(screen.getByText(messages.methodKind.badge.client)).toBeInTheDocument();
    expect(screen.queryByText(messages.methodKind.badge.server)).toBeNull();
    expect(screen.getByRole("button", { name: /send message/i })).toBeInTheDocument();
  });

  it("after the call ends the catalog kind wins again over the executed kind", async () => {
    api.grpcDescribe.mockResolvedValue(catalogWith("M", false, true));
    const step = streamSnapshot("client");
    await renderPanel(<CallPanel step={step} onPatch={vi.fn()} editable />);
    await screen.findByText(messages.methodKind.badge.server, {}, { timeout: 3000 });
    expect(screen.getByRole("button", { name: m.send })).toBeInTheDocument();
    expect(screen.queryByText(messages.methodKind.badge.client)).toBeNull();
  });
});
