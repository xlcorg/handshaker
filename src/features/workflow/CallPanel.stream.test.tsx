import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/features/invoke/BodyEditor", () => ({
  BodyEditor: ({ value }: { value: string }) => <div data-testid="body-editor">{value}</div>,
}));
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
import { runCall } from "./callLifecycle";
import { newStep } from "./model";
import { workflowStore } from "./store";
import { streamStore } from "@/features/stream/streamStore";
import { messages } from "@/lib/messages";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ServiceCatalogIpc, StreamEventIpc } from "@/ipc/bindings";

function catalogWith(method: string, client_streaming: boolean, server_streaming: boolean): ServiceCatalogIpc {
  return { services: [{ full_name: "p.v1.S", methods: [{
    name: method, path: `/p.v1.S/${method}`, input_message: "Req", output_message: "Resp",
    client_streaming, server_streaming,
  }] }] };
}

async function renderPanel(ui: React.ReactElement) {
  const result = render(<TooltipProvider>{ui}</TooltipProvider>);
  await act(async () => {});
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Store events apply on the next animation frame — make that synchronous so an
  // `Opened` pushed in a test is visible to the panel at once (no timing luck).
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 1; });
  workflowStore.reset();
  streamStore.reset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("CallPanel picks the call hook by the derived kind", () => {
  it("server-streaming: Send opens a Stream call (streamOpen with kind 'server'), never grpcSend", async () => {
    api.grpcDescribe.mockResolvedValue(catalogWith("Watch", false, true));
    const step = newStep({ address: "h:443", tls: true, service: "p.v1.S", method: "Watch" });
    const onPatch = vi.fn();
    await renderPanel(<CallPanel step={step} onPatch={onPatch} editable />);
    // Wait for the (debounced) catalog — the kind is derived from it.
    await screen.findByText(messages.methodKind.badge.server, {}, { timeout: 3000 });

    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await act(async () => {});

    expect(api.streamOpen).toHaveBeenCalledTimes(1);
    expect(api.grpcSend).not.toHaveBeenCalled();
    const [, , rid, kind] = api.streamOpen.mock.calls[0];
    expect(kind).toBe("server");
    expect(onPatch).toHaveBeenCalledWith(expect.objectContaining({ status: "sending", requestId: rid, streamId: rid }));
  });

  it("unknown kind (no catalog): Send takes the unary path", async () => {
    const step = newStep({ address: "h:443", tls: true, service: "p.v1.S", method: "GetX" });
    const onPatch = vi.fn();
    await renderPanel(<CallPanel step={step} onPatch={onPatch} editable />);
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await act(async () => {});
    expect(api.grpcSend).toHaveBeenCalledTimes(1);
    expect(api.streamOpen).not.toHaveBeenCalled();
    // A unary Send never leaves a stale stream reference behind.
    expect(onPatch).toHaveBeenCalledWith(expect.objectContaining({ status: "sending", streamId: null }));
  });

  it("unknown kind, server-streaming method: the refused unary Send re-routes once to a Stream call — no error face", async () => {
    api.grpcSend.mockRejectedValue({ type: "MethodKindMismatch", service: "p.v1.S", method: "Watch", expected: "unary", actual: "server" });
    api.streamOpen.mockImplementation(async (...a: unknown[]) => {
      (a[5] as (e: StreamEventIpc) => void)({ type: "Opened", kind: "server", auth_used: { kind: "none" }, tls_used: true, bytes_fields: [] });
    });
    const step = newStep({ address: "h:443", tls: true, service: "p.v1.S", method: "Watch" });
    const onPatch = vi.fn();
    await renderPanel(<CallPanel step={step} onPatch={onPatch} editable />);

    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await act(async () => {});

    expect(api.grpcSend).toHaveBeenCalledTimes(1);
    expect(api.streamOpen).toHaveBeenCalledTimes(1);
    expect(api.streamOpen.mock.calls[0][3]).toBe("server");
    const rid = api.streamOpen.mock.calls[0][2];
    expect(onPatch).toHaveBeenLastCalledWith(expect.objectContaining({ status: "sending", requestId: rid, streamId: rid }));
    expect(onPatch).not.toHaveBeenCalledWith(expect.objectContaining({ status: "error" }));
  });

  it("live stream: Send morphs into Cancel after the busy delay; Cancel → grpcCancel + status cancelled", async () => {
    const idle = newStep({ address: "h:443", tls: true, service: "p.v1.S", method: "Watch" });
    const onPatch = vi.fn();
    await runCall({ step: idle, envName: null, kind: "server", onPatch, recording: null });
    const rid = api.streamOpen.mock.calls[0][2] as string;
    const live = { ...idle, ...onPatch.mock.calls[0][0] };
    vi.useFakeTimers();
    await renderPanel(<CallPanel step={live} onPatch={onPatch} editable />);
    expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(250); });
    expect(screen.queryByRole("button", { name: /send/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    await act(async () => {});

    expect(api.grpcCancel).toHaveBeenCalledWith(rid);
    expect(streamStore.get(rid)?.phase).toBe("cancelled");
    expect(onPatch).toHaveBeenCalledWith(expect.objectContaining({ status: "cancelled", requestId: null }));
  });
});

describe("CallPanel send hotkeys around a server stream", () => {
  const streamStep = () => newStep({ address: "h:443", tls: true, service: "p.v1.S", method: "Watch" });

  it("Ctrl/Cmd+Enter and Ctrl+R are a no-op while a server stream is open — never Cancel, never re-open", async () => {
    streamStore.open("rid", "server", Date.now());
    const live = { ...streamStep(), status: "sending" as const, requestId: "rid", streamId: "rid" };
    const onPatch = vi.fn();
    await renderPanel(<CallPanel step={live} onPatch={onPatch} editable />);

    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    fireEvent.keyDown(window, { code: "KeyR", key: "r", ctrlKey: true });
    await act(async () => {});

    expect(api.grpcCancel).not.toHaveBeenCalled();
    expect(api.streamOpen).not.toHaveBeenCalled();
    expect(api.grpcSend).not.toHaveBeenCalled();
    expect(onPatch).not.toHaveBeenCalled();
    expect(streamStore.get("rid")?.phase).toBe("opening");
  });

  it("once the stream ended, Ctrl+Enter Sends again (a fresh Stream call)", async () => {
    api.grpcDescribe.mockResolvedValue(catalogWith("Watch", false, true));
    streamStore.open("old", "server", Date.now());
    streamStore.push("old", { type: "End", status_code: 0, status_message: "", status_details: [], trailing_metadata: {}, elapsed_ms: 5, message_count: 0, total_bytes: 0 });
    const ended = { ...streamStep(), status: "ok" as const, requestId: null, streamId: "old" };
    const onPatch = vi.fn();
    await renderPanel(<CallPanel step={ended} onPatch={onPatch} editable />);
    await screen.findByText(messages.methodKind.badge.server, {}, { timeout: 3000 });

    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    await act(async () => {});

    expect(api.streamOpen).toHaveBeenCalledTimes(1);
    expect(api.grpcCancel).not.toHaveBeenCalled();
    const [, , rid] = api.streamOpen.mock.calls[0];
    expect(rid).not.toBe("old");
    expect(onPatch).toHaveBeenCalledWith(expect.objectContaining({ status: "sending", streamId: rid }));
  });

  it("after Cancel, Ctrl+R Sends again", async () => {
    api.grpcDescribe.mockResolvedValue(catalogWith("Watch", false, true));
    const cancelled = { ...streamStep(), status: "cancelled" as const, requestId: null, streamId: null };
    const onPatch = vi.fn();
    await renderPanel(<CallPanel step={cancelled} onPatch={onPatch} editable />);
    await screen.findByText(messages.methodKind.badge.server, {}, { timeout: 3000 });

    fireEvent.keyDown(window, { code: "KeyR", key: "r", ctrlKey: true });
    await act(async () => {});

    expect(api.streamOpen).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenCalledWith(expect.objectContaining({ status: "sending" }));
  });
});

describe("CallPanel response slot", () => {
  it("a step with a streamId shows the stream pane (Messages tab + footer) instead of the unary pane", async () => {
    streamStore.open("rid", "server", Date.now());
    const step = { ...newStep({ address: "h:443", tls: true, service: "p.v1.S", method: "Watch" }),
      status: "sending" as const, requestId: "rid", streamId: "rid" };
    await renderPanel(<CallPanel step={step} onPatch={() => {}} />);
    expect(screen.getByRole("tab", { name: messages.stream.tabs.messages })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: messages.response.tabs.body })).toBeNull();
    expect(screen.getByTestId("stream-footer").textContent).toContain(messages.stream.footer.opening);
  });

  it("a stream step whose call faulted after Open wears the unary client-error face, not the stream pane", async () => {
    streamStore.open("rid", "server", Date.now());
    streamStore.push("rid", { type: "Fault", error: { type: "DeadlineExceeded", timeout_ms: 30_000 } });
    const step = { ...newStep({ address: "h:443", tls: true, service: "p.v1.S", method: "Watch" }),
      status: "error" as const, requestId: null, streamId: "rid",
      error: { kind: "timeout" as const, message: "Request timed out after 30000ms" } };
    await renderPanel(<CallPanel step={step} onPatch={() => {}} />);
    // The existing face: title + hint from the fault kind, Body tab; no stream footer.
    expect(screen.getByText("Request timed out")).toBeInTheDocument();
    expect(screen.getByTestId("diag-hint")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: messages.response.tabs.body })).toBeInTheDocument();
    expect(screen.queryByTestId("stream-footer")).toBeNull();
    expect(screen.queryByRole("tab", { name: messages.stream.tabs.messages })).toBeNull();
  });

  it("a unary step keeps the Body pane", async () => {
    const step = newStep({ address: "h:443", tls: true, service: "p.v1.S", method: "GetX" });
    await renderPanel(<CallPanel step={step} onPatch={() => {}} />);
    expect(screen.getByRole("tab", { name: messages.response.tabs.body })).toBeInTheDocument();
    expect(screen.queryByTestId("stream-footer")).toBeNull();
  });
});

describe("CallPanel two-way (client / bidi) calls", () => {
  const bidiStep = () => newStep({ address: "h:443", tls: true, service: "p.v1.S", method: "Chat", requestJson: '{"a":"{{v}}"}' });
  const ack = { index: 1, at_ms: 1_700_000_000_001, size_bytes: 3, preview: "{}", json: "{}" };
  const openedBidi = { type: "Opened" as const, kind: "bidi" as const, auth_used: { kind: "none" as const }, tls_used: true, bytes_fields: [] };

  it.each(["client", "bidi"] as const)("%s method: the primary button reads ▶ Open and opens a Stream call with that kind, sending nothing", async (kind) => {
    api.grpcDescribe.mockResolvedValue(catalogWith("Chat", true, kind === "bidi"));
    const onPatch = vi.fn();
    await renderPanel(<CallPanel step={bidiStep()} onPatch={onPatch} editable />);
    await screen.findByText(messages.methodKind.badge[kind], {}, { timeout: 3000 });

    fireEvent.click(screen.getByRole("button", { name: messages.workflow.addressBar.open }));
    await act(async () => {});

    expect(api.streamOpen).toHaveBeenCalledTimes(1);
    expect(api.streamOpen.mock.calls[0][3]).toBe(kind);
    expect(api.streamSend).not.toHaveBeenCalled();
    expect(api.grpcSend).not.toHaveBeenCalled();
    expect(onPatch).toHaveBeenCalledWith(expect.objectContaining({ status: "sending" }));
  });

  it("live two-way call: segmented controls after the busy delay; Send message → streamSend(rid, body template, ctx) and a → row; Half-close → streamHalfClose(rid) and the controls disable", async () => {
    streamStore.open("rid", "bidi", Date.now());
    streamStore.push("rid", openedBidi);
    api.streamSend.mockResolvedValue(ack);
    const live = { ...bidiStep(), status: "sending" as const, requestId: "rid", streamId: "rid", collectionId: "c1" };
    vi.useFakeTimers();
    await renderPanel(<CallPanel step={live} onPatch={vi.fn()} editable />);
    act(() => { vi.advanceTimersByTime(250); });

    fireEvent.click(screen.getByRole("button", { name: /send message/i }));
    await act(async () => {});
    expect(api.streamSend).toHaveBeenCalledWith("rid", '{"a":"{{v}}"}', { collection_id: "c1", env_name: null });
    expect(streamStore.get("rid")!.messages).toEqual([expect.objectContaining({ dir: "out", index: 1 })]);

    fireEvent.click(screen.getByRole("button", { name: /^end stream$/i }));
    await act(async () => {});
    expect(api.streamHalfClose).toHaveBeenCalledWith("rid");
    expect(streamStore.get("rid")!.halfClosed).toBe(true);
    expect(screen.getByRole("button", { name: /send message/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^end stream$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeEnabled();
    expect(api.grpcCancel).not.toHaveBeenCalled();
  });

  it("while opening (Opened not yet in): the segmented controls show but Send message / Half-close are disabled", async () => {
    streamStore.open("rid", "client", Date.now());
    const live = { ...bidiStep(), status: "sending" as const, requestId: "rid", streamId: "rid" };
    vi.useFakeTimers();
    await renderPanel(<CallPanel step={live} onPatch={vi.fn()} editable />);
    act(() => { vi.advanceTimersByTime(250); });
    expect(screen.getByRole("button", { name: /send message/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^end stream$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeEnabled();
  });

  it("Ctrl/Cmd+Enter and Ctrl+R while a two-way stream is open = Send message (never Cancel, never re-open)", async () => {
    streamStore.open("rid", "bidi", Date.now());
    streamStore.push("rid", openedBidi);
    let n = 0;
    api.streamSend.mockImplementation(async () => ({ ...ack, index: ++n }));
    const live = { ...bidiStep(), status: "sending" as const, requestId: "rid", streamId: "rid" };
    const onPatch = vi.fn();
    await renderPanel(<CallPanel step={live} onPatch={onPatch} editable />);

    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    await act(async () => {});
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    await act(async () => {});
    fireEvent.keyDown(window, { code: "KeyR", key: "r", ctrlKey: true });
    await act(async () => {});

    expect(api.streamSend).toHaveBeenCalledTimes(3);
    expect(api.streamSend).toHaveBeenCalledWith("rid", '{"a":"{{v}}"}', expect.anything());
    expect(api.grpcCancel).not.toHaveBeenCalled();
    expect(api.streamOpen).not.toHaveBeenCalled();
    expect(onPatch).not.toHaveBeenCalled();
  });

  it("Ctrl+Enter after half-close is a no-op (nothing sent, nothing cancelled)", async () => {
    streamStore.open("rid", "client", Date.now());
    streamStore.push("rid", { ...openedBidi, kind: "client" });
    streamStore.halfClose("rid");
    const live = { ...bidiStep(), status: "sending" as const, requestId: "rid", streamId: "rid" };
    await renderPanel(<CallPanel step={live} onPatch={vi.fn()} editable />);

    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    await act(async () => {});

    expect(api.streamSend).not.toHaveBeenCalled();
    expect(api.grpcCancel).not.toHaveBeenCalled();
    expect(api.streamOpen).not.toHaveBeenCalled();
  });

  it("Ctrl+Enter on an idle bidi method = Open", async () => {
    api.grpcDescribe.mockResolvedValue(catalogWith("Chat", true, true));
    await renderPanel(<CallPanel step={bidiStep()} onPatch={vi.fn()} editable />);
    await screen.findByText(messages.methodKind.badge.bidi, {}, { timeout: 3000 });

    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    await act(async () => {});

    expect(api.streamOpen).toHaveBeenCalledTimes(1);
    expect(api.streamOpen.mock.calls[0][3]).toBe("bidi");
    expect(api.streamSend).not.toHaveBeenCalled();
  });

  it("a rejected Send message (UnresolvedVars) shows the strip in the stream pane; the stream stays open, the step is not patched", async () => {
    streamStore.open("rid", "bidi", Date.now());
    streamStore.push("rid", openedBidi);
    api.streamSend.mockRejectedValue({ type: "UnresolvedVars", unresolved: ["v"], cycle: null });
    const live = { ...bidiStep(), status: "sending" as const, requestId: "rid", streamId: "rid" };
    const onPatch = vi.fn();
    await renderPanel(<CallPanel step={live} onPatch={onPatch} editable />);

    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    await act(async () => {});

    const strip = screen.getByRole("alert");
    expect(strip.textContent).toContain(messages.stream.sendFault.title);
    expect(strip.textContent).toContain("Unresolved variables: {{v}}");
    expect(streamStore.get("rid")!.phase).toBe("open");
    expect(onPatch).not.toHaveBeenCalled();
    // The stream pane (not the unary error face) is still what the response slot shows.
    expect(screen.getByTestId("stream-footer").textContent).toContain(messages.stream.footer.streaming);
    expect(screen.queryByTestId("diag-hint")).toBeNull();
  });
});
