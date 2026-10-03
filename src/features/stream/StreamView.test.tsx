import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StreamView, filterRows } from "./StreamView";
import { streamStore, useStreamEntry, type MessageMeta, type StreamEntry } from "./streamStore";
import { messages } from "@/lib/messages";
import { saveResponseToFile } from "@/features/response/saveResponse";

vi.mock("@/features/contract/ContractView", () => ({
  ContractView: ({ method }: { method: string }) => <div data-testid="contract">{method}</div>,
}));
// Monaco never mounts in jsdom; the stub exposes what the timeline wires into it.
vi.mock("@/features/bodyview/BodyView", () => ({
  BodyView: ({ value, mode, onSaveBody }: { value: string; mode: string; onSaveBody?: () => void }) => (
    <div data-testid="body-view" data-mode={mode}>
      <pre>{value}</pre>
      <button type="button" data-testid="save-body" onClick={onSaveBody} />
    </div>
  ),
}));
vi.mock("@/features/response/saveResponse", () => ({ saveResponseToFile: vi.fn() }));
// Both facade shapes (named exports AND `ipc`).
const api = vi.hoisted(() => ({ streamMessage: vi.fn(), streamSaveMessages: vi.fn(), streamAssemble: vi.fn() }));
vi.mock("@/ipc/client", () => ({ ...api, ipc: api }));

const T0 = new Date(2026, 8, 28, 14, 5, 9, 7).getTime(); // local 14:05:09.007

function msg(index: number, over: Partial<MessageMeta> = {}): MessageMeta {
  return { dir: "in", index, atMs: T0 + index, sizeBytes: 10 * index, preview: `{"i":${index}}`, json: null, ...over };
}

function entry(over: Partial<StreamEntry> = {}): StreamEntry {
  return {
    id: "s1", kind: "server", phase: "open", halfClosed: false, sendFault: null, headers: null, messages: [], end: null,
    cancelled: false, fault: null,
    bytesFields: [], authUsed: { kind: "none" }, tlsUsed: false, openedAt: 100_000, elapsedMs: null, totalBytes: 0,
    ...over,
  };
}

function footer() {
  return screen.getByTestId("stream-footer");
}

function endWith(over: Partial<StreamEntry["end"] & object> = {}): NonNullable<StreamEntry["end"]> {
  return { statusCode: 0, statusMessage: "", statusDetails: [], trailingMetadata: {}, elapsedMs: 900, messageCount: 1, totalBytes: 10, ...over };
}

/** Renders the pane off the store, the way the call panel's response slot does. */
function Host({ id }: { id: string }) {
  return <StreamView entry={useStreamEntry(id)} contract={null} />;
}

function row(index: number) {
  return screen.getByRole("button", { name: messages.stream.row.toggleAria(index) });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(103_400); // 3.4s after openedAt
  vi.clearAllMocks();
  streamStore.reset();
});
afterEach(() => vi.useRealTimers());

describe("StreamView metadata tabs", () => {
  it("Headers fills from the Headers event and Trailers from End, hints = counts", () => {
    const e = entry({
      phase: "ended", headers: { "content-type": "application/grpc", "x-h": "v" }, elapsedMs: 900,
      end: endWith({ trailingMetadata: { "x-t": "1" } }),
    });
    render(<StreamView entry={e} contract={null} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      messages.stream.tabs.messages, `${messages.response.tabs.headers}2`, `${messages.response.tabs.trailers}1`,
    ]);
    fireEvent.click(screen.getByRole("tab", { name: /Headers/ }));
    expect(screen.getByText("x-h")).toBeInTheDocument();
    expect(screen.getByText("v")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Trailers/ }));
    expect(screen.getByText("x-t")).toBeInTheDocument();
    expect(screen.queryByText("x-h")).toBeNull();
  });

  it("no hints before Headers / End arrive", () => {
    render(<StreamView entry={entry()} contract={null} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      messages.stream.tabs.messages, messages.response.tabs.headers, messages.response.tabs.trailers,
    ]);
  });
});

describe("StreamView expand row", () => {
  it("a small row expands in place into the read-only body view with its inline JSON, no IPC; click again collapses", () => {
    const pretty = '{\n  "i": 1\n}';
    render(<StreamView entry={entry({ messages: [msg(1, { json: pretty }), msg(2, { json: "{}" })] })} contract={null} />);
    expect(screen.queryByTestId("body-view")).toBeNull();

    fireEvent.click(row(1));
    const body = screen.getByTestId("body-view");
    expect(body.getAttribute("data-mode")).toBe("response");
    expect(body.textContent).toContain(pretty);
    expect(row(1).getAttribute("aria-expanded")).toBe("true");
    expect(api.streamMessage).not.toHaveBeenCalled();

    fireEvent.click(row(1));
    expect(screen.queryByTestId("body-view")).toBeNull();
    expect(row(1).getAttribute("aria-expanded")).toBe("false");
  });

  it("only one row is expanded at a time", () => {
    render(<StreamView entry={entry({ messages: [msg(1, { json: "A" }), msg(2, { json: "B" })] })} contract={null} />);
    fireEvent.click(row(1));
    fireEvent.click(row(2));
    const bodies = screen.getAllByTestId("body-view");
    expect(bodies).toHaveLength(1);
    expect(bodies[0].textContent).toContain("B");
    expect(row(1).getAttribute("aria-expanded")).toBe("false");
    expect(row(2).getAttribute("aria-expanded")).toBe("true");
  });

  it("a large row (json null) fetches stream_message once on expand, shows a loading state, then the body; re-expand hits the cache", async () => {
    let resolve!: (s: string) => void;
    api.streamMessage.mockImplementation(() => new Promise<string>((r) => { resolve = r; }));
    streamStore.open("s1", "server");
    streamStore.push("s1", { type: "Opened", kind: "server", auth_used: { kind: "none" }, tls_used: false, bytes_fields: [] });
    streamStore.push("s1", { type: "Message", index: 1, at_ms: T0, size_bytes: 70_000, preview: "{…", json: null });
    act(() => { vi.advanceTimersByTime(20); }); // rAF batch
    render(<Host id="s1" />);

    fireEvent.click(row(1));
    expect(api.streamMessage).toHaveBeenCalledWith("s1", 1);
    expect(screen.getByText(messages.stream.body.loading)).toBeInTheDocument();
    expect(screen.queryByTestId("body-view")).toBeNull();

    await act(async () => { resolve('{\n  "big": true\n}'); });
    expect(screen.getByTestId("body-view").textContent).toContain('"big": true');
    expect(streamStore.get("s1")!.messages[0].json).toBe('{\n  "big": true\n}');

    fireEvent.click(row(1)); // collapse
    fireEvent.click(row(1)); // expand again → cached
    expect(screen.getByTestId("body-view").textContent).toContain('"big": true');
    expect(api.streamMessage).toHaveBeenCalledTimes(1);
  });

  it("a failed fetch shows the reason inline instead of the body", async () => {
    api.streamMessage.mockRejectedValue({ type: "StreamMessageNotFound", request_id: "s1", index: 1 });
    render(<StreamView entry={entry({ messages: [msg(1)] })} contract={null} />);
    await act(async () => { fireEvent.click(row(1)); });
    expect(
      screen.getByText(messages.stream.body.loadFailed(messages.workflow.fault.streamMessageNotFound)),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("body-view")).toBeNull();
  });

  it("a row collapsed mid-fetch still caches the body on the store; re-expand needs no second fetch", async () => {
    let resolve!: (s: string) => void;
    api.streamMessage.mockImplementation(() => new Promise<string>((r) => { resolve = r; }));
    streamStore.open("s1", "server");
    streamStore.push("s1", { type: "Opened", kind: "server", auth_used: { kind: "none" }, tls_used: false, bytes_fields: [] });
    streamStore.push("s1", { type: "Message", index: 1, at_ms: T0, size_bytes: 70_000, preview: "{…", json: null });
    act(() => { vi.advanceTimersByTime(20); });
    render(<Host id="s1" />);

    fireEvent.click(row(1)); // expand → fetch starts
    fireEvent.click(row(1)); // collapse before it resolves
    expect(screen.queryByText(messages.stream.body.loading)).toBeNull();
    await act(async () => { resolve('{\n  "late": 1\n}'); });
    expect(streamStore.get("s1")!.messages[0].json).toBe('{\n  "late": 1\n}');

    fireEvent.click(row(1)); // expand again → served from the cache
    expect(screen.getByTestId("body-view").textContent).toContain('"late": 1');
    expect(api.streamMessage).toHaveBeenCalledTimes(1);
  });

  it("the expanded row does not carry over to the next call on the same step", () => {
    const a = entry({ id: "s1", messages: [msg(1, { json: "A1" }), msg(2, { json: "A2" })] });
    const { rerender } = render(<StreamView entry={a} contract={null} />);
    fireEvent.click(row(2));
    expect(row(2).getAttribute("aria-expanded")).toBe("true");

    const b = entry({ id: "s2", messages: [msg(1), msg(2)] }); // json null → an expand would fetch
    rerender(<StreamView entry={b} contract={null} />);
    expect(screen.getAllByRole("button", { name: /^Message #/ }).map((r) => r.getAttribute("aria-expanded"))).toEqual(["false", "false"]);
    expect(screen.queryByTestId("body-view")).toBeNull();
    expect(api.streamMessage).not.toHaveBeenCalled();
  });

  it("the expanded row's body keeps Save response to file… for that one message", () => {
    render(<StreamView entry={entry({ messages: [msg(1, { json: "ONE" }), msg(2, { json: "TWO" })] })} contract={null} />);
    fireEvent.click(row(2));
    fireEvent.click(screen.getByTestId("save-body"));
    expect(saveResponseToFile).toHaveBeenCalledWith("TWO");
  });
});

describe("StreamView timeline", () => {
  it("renders rows newest first with arrow, #index, preview, size and local clock", () => {
    render(<StreamView entry={entry({ messages: [msg(1), msg(2), msg(3)], totalBytes: 60 })} contract={null} />);
    const rows = screen.getAllByTestId("stream-row");
    expect(rows.map((r) => within(r).getByText(/^#\d+$/).textContent)).toEqual(["#3", "#2", "#1"]);
    const top = rows[0];
    expect(within(top).getByLabelText(messages.stream.row.received).textContent).toBe("←");
    expect(within(top).getByText('{"i":3}')).toBeInTheDocument();
    expect(within(top).getByText("30B")).toBeInTheDocument();
    expect(within(top).getByText("14:05:09.010")).toBeInTheDocument();
  });

  it("Messages tab hint is the count; Headers/Trailers/Contract tabs are present", () => {
    render(<StreamView entry={entry({ messages: [msg(1), msg(2)] })} contract={{ input: null, output: null, method: "Watch", kind: "server" }} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      `${messages.stream.tabs.messages}2`, messages.response.tabs.headers, messages.response.tabs.trailers, messages.response.tabs.contract,
    ]);
  });

  it("open with no messages shows the awaiting empty state", () => {
    render(<StreamView entry={entry()} contract={null} />);
    expect(screen.getByText(messages.stream.empty.awaitingTitle)).toBeInTheDocument();
  });
});

describe("StreamView toolbar search", () => {
  it("filters rows by preview (case-insensitive substring) with a shown / total counter; clearing restores all", () => {
    const rows = [msg(1, { preview: '{"user":"Ann"}' }), msg(2, { preview: '{"user":"bob"}' }), msg(3, { preview: '{"user":"ANNA"}' })];
    render(<StreamView entry={entry({ messages: rows })} contract={null} />);
    const box = screen.getByRole("searchbox", { name: messages.stream.toolbar.searchAria });
    expect(screen.queryByText(messages.stream.toolbar.shownOfTotal(3, 3))).toBeNull();

    fireEvent.change(box, { target: { value: "ann" } });
    expect(screen.getAllByTestId("stream-row").map((r) => within(r).getByText(/^#\d+$/).textContent)).toEqual(["#3", "#1"]);
    expect(screen.getByText(messages.stream.toolbar.shownOfTotal(2, 3))).toBeInTheDocument();

    fireEvent.change(box, { target: { value: "zzz" } });
    expect(screen.queryAllByTestId("stream-row")).toHaveLength(0);
    expect(screen.getByText(messages.stream.empty.noMatch)).toBeInTheDocument();
    expect(screen.getByText(messages.stream.toolbar.shownOfTotal(0, 3))).toBeInTheDocument();

    fireEvent.change(box, { target: { value: "" } });
    expect(screen.getAllByTestId("stream-row")).toHaveLength(3);
    expect(screen.queryByText(/\d+ \/ \d+/)).toBeNull();
  });

  it("no toolbar on the idle pane (null entry)", () => {
    render(<StreamView entry={null} contract={null} />);
    expect(screen.queryByRole("searchbox")).toBeNull();
  });
});

describe("StreamView error strip", () => {
  it("non-OK End: red strip `<code> <NAME> · message` above the still-visible rows; See trailers switches tabs", () => {
    const e = entry({ phase: "ended", messages: [msg(1), msg(2)], elapsedMs: 900,
      end: endWith({ statusCode: 7, statusMessage: "injected stream error: PermissionDenied", trailingMetadata: { "x-reason": "quota" } }) });
    render(<StreamView entry={e} contract={null} />);
    const strip = screen.getByRole("alert");
    expect(strip.textContent).toContain("7");
    expect(strip.textContent).toContain("PERMISSION_DENIED");
    expect(strip.textContent).toContain("injected stream error: PermissionDenied");
    expect(screen.getAllByTestId("stream-row")).toHaveLength(2);

    fireEvent.click(within(strip).getByRole("button", { name: messages.stream.strip.seeTrailers }));
    expect(screen.getByRole("tab", { name: /Trailers/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("x-reason")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("OK End and Cancel render no strip", () => {
    const { unmount } = render(<StreamView entry={entry({ phase: "ended", messages: [msg(1)], elapsedMs: 5, end: endWith() })} contract={null} />);
    expect(screen.queryByRole("alert")).toBeNull();
    unmount();
    render(<StreamView entry={entry({ phase: "cancelled", cancelled: true, messages: [msg(1)], elapsedMs: 5 })} contract={null} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("trailers-only non-OK End (zero rows) shows the strip and no awaiting state", () => {
    const e = entry({ phase: "ended", elapsedMs: 5, end: endWith({ statusCode: 16, statusMessage: "token expired", messageCount: 0, totalBytes: 0 }) });
    render(<StreamView entry={e} contract={null} />);
    expect(screen.getByRole("alert").textContent).toContain("UNAUTHENTICATED");
    expect(screen.queryByText(messages.stream.empty.awaitingTitle)).toBeNull();
  });
});

describe("StreamView empty states", () => {
  it("open with no messages: pulsing dot + 'Stream open — awaiting messages'", () => {
    render(<StreamView entry={entry({ phase: "open" })} contract={null} />);
    expect(screen.getByText(messages.stream.empty.awaitingTitle)).toBeInTheDocument();
    expect(screen.getByTestId("stream-empty-dot").className).toContain("pulse-dot");
  });

  it("idle (null entry) keeps 'Awaiting first call' without the dot", () => {
    render(<StreamView entry={null} contract={null} />);
    expect(screen.getByText(messages.response.empty.awaitingFirstCall)).toBeInTheDocument();
    expect(screen.queryByTestId("stream-empty-dot")).toBeNull();
  });
});

describe("StreamView footer", () => {
  it("live: ● STREAMING · N msgs · bytes · ticking elapsed", () => {
    render(<StreamView entry={entry({ messages: [msg(1), msg(2)], totalBytes: 30 })} contract={null} />);
    expect(footer().textContent).toContain(messages.stream.footer.streaming);
    expect(footer().textContent).toContain(messages.stream.footer.msgs(2));
    expect(footer().textContent).toContain("30B");
    expect(footer().textContent).toContain("3.4s");
    act(() => vi.advanceTimersByTime(1000));
    expect(footer().textContent).toContain("4.4s");
  });

  it("ended OK: ● OK with the frozen elapsed", () => {
    const e = entry({ phase: "ended", messages: [msg(1)], totalBytes: 10, elapsedMs: 1250,
      end: { statusCode: 0, statusMessage: "", statusDetails: [], trailingMetadata: {}, elapsedMs: 1250, messageCount: 1, totalBytes: 10 } });
    render(<StreamView entry={e} contract={null} />);
    expect(footer().textContent).toContain(messages.stream.footer.ok);
    expect(footer().textContent).toContain("1.3s");
    act(() => vi.advanceTimersByTime(2000));
    expect(footer().textContent).toContain("1.3s");
    expect(footer().textContent).not.toContain(messages.stream.footer.streaming);
  });

  it("ended non-OK: ● <code> <NAME>, rows stay", () => {
    const e = entry({ phase: "ended", messages: [msg(1)], elapsedMs: 900,
      end: { statusCode: 5, statusMessage: "nope", statusDetails: [], trailingMetadata: {}, elapsedMs: 900, messageCount: 1, totalBytes: 10 } });
    render(<StreamView entry={e} contract={null} />);
    expect(footer().textContent).toContain("5");
    expect(footer().textContent).toContain("NOT_FOUND");
    expect(footer().getAttribute("data-tone")).toBe("error");
    expect(screen.getAllByTestId("stream-row")).toHaveLength(1);
  });

  it("cancelled: ○ Cancelled with elapsed frozen at cancel time", () => {
    render(<StreamView entry={entry({ phase: "cancelled", cancelled: true, messages: [msg(1)], elapsedMs: 2500 })} contract={null} />);
    expect(footer().textContent).toContain(messages.stream.footer.cancelled);
    expect(footer().textContent).toContain("2.5s");
    act(() => vi.advanceTimersByTime(3000));
    expect(footer().textContent).toContain("2.5s");
    expect(screen.getAllByTestId("stream-row")).toHaveLength(1);
  });

  it("null entry (released) renders the idle empty state and no footer status", () => {
    render(<StreamView entry={null} contract={null} />);
    expect(screen.getByText(messages.response.empty.awaitingFirstCall)).toBeInTheDocument();
    expect(screen.queryByTestId("stream-footer")).toBeNull();
  });
});

const out = (index: number, over: Partial<MessageMeta> = {}) => msg(index, { dir: "out", preview: `{"o":${index}}`, ...over });
const indexes = () => screen.getAllByTestId("stream-row").map((r) => within(r).getByText(/^#\d+$/).textContent);

describe("filterRows by direction", () => {
  const rows = [msg(1), out(2), msg(3), out(4)];
  it("keeps every row for 'all', only inbound for 'in', only outbound for 'out' — newest first, composed with the search", () => {
    expect(filterRows(rows, "", "all").map((m) => m.index)).toEqual([4, 3, 2, 1]);
    expect(filterRows(rows, "", "in").map((m) => m.index)).toEqual([3, 1]);
    expect(filterRows(rows, "", "out").map((m) => m.index)).toEqual([4, 2]);
    expect(filterRows(rows, '"o":4', "out").map((m) => m.index)).toEqual([4]);
    expect(filterRows(rows, '"o":4', "in")).toEqual([]);
    // The two-argument form is the old behaviour (no direction filter).
    expect(filterRows(rows, "").map((m) => m.index)).toEqual([4, 3, 2, 1]);
  });
});

describe("StreamView two-way timeline", () => {
  it("a sent (→) row is muted, labelled 'sent', and expands from its inline resolved JSON without IPC", () => {
    render(<StreamView entry={entry({ kind: "bidi", messages: [out(1, { json: '{ "o": 1 }' }), msg(2)] })} contract={null} />);
    const rows = screen.getAllByTestId("stream-row");
    const sent = rows[1];
    const arrow = within(sent).getByLabelText(messages.stream.row.sent);
    expect(arrow.textContent).toBe("→");
    expect(arrow.className).toContain("text-muted-foreground");
    expect(within(rows[0]).getByLabelText(messages.stream.row.received).textContent).toBe("←");

    fireEvent.click(row(1));
    expect(screen.getByTestId("body-view").textContent).toContain('{ "o": 1 }');
    expect(api.streamMessage).not.toHaveBeenCalled();
  });

  it.each(["client", "bidi"] as const)("%s: All / Received / Sent chips filter by direction and drive shown / total", (kind) => {
    render(<StreamView entry={entry({ kind, messages: [msg(1), out(2), msg(3), out(4)] })} contract={null} />);
    const group = screen.getByRole("group", { name: messages.stream.toolbar.directionAria });
    const chip = (name: string) => within(group).getByRole("button", { name });
    expect(chip(messages.stream.toolbar.all).getAttribute("aria-pressed")).toBe("true");
    expect(indexes()).toEqual(["#4", "#3", "#2", "#1"]);

    fireEvent.click(chip(messages.stream.toolbar.sent));
    expect(chip(messages.stream.toolbar.sent).getAttribute("aria-pressed")).toBe("true");
    expect(chip(messages.stream.toolbar.all).getAttribute("aria-pressed")).toBe("false");
    expect(indexes()).toEqual(["#4", "#2"]);
    expect(screen.getByText(messages.stream.toolbar.shownOfTotal(2, 4))).toBeInTheDocument();

    fireEvent.click(chip(messages.stream.toolbar.received));
    expect(indexes()).toEqual(["#3", "#1"]);

    // Search composes with the chip.
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: '"i":3' } });
    expect(indexes()).toEqual(["#3"]);
    expect(screen.getByText(messages.stream.toolbar.shownOfTotal(1, 4))).toBeInTheDocument();

    fireEvent.click(chip(messages.stream.toolbar.all));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    expect(indexes()).toEqual(["#4", "#3", "#2", "#1"]);
  });

  it("server-streaming shows no direction chips", () => {
    render(<StreamView entry={entry({ kind: "server", messages: [msg(1)] })} contract={null} />);
    expect(screen.queryByRole("group", { name: messages.stream.toolbar.directionAria })).toBeNull();
    expect(screen.queryByRole("button", { name: messages.stream.toolbar.sent })).toBeNull();
  });
});

describe("StreamView two-way empty states", () => {
  it.each(["client", "bidi"] as const)("%s open with no messages: pulsing dot + 'Stream open — send messages'", (kind) => {
    render(<StreamView entry={entry({ kind })} contract={null} />);
    expect(screen.getByText(messages.stream.empty.sendTitle)).toBeInTheDocument();
    expect(screen.queryByText(messages.stream.empty.awaitingTitle)).toBeNull();
    expect(screen.getByTestId("stream-empty-dot").className).toContain("pulse-dot");
  });

  it("half-closed with no messages: 'Half-closed — waiting for the server'", () => {
    render(<StreamView entry={entry({ kind: "client", halfClosed: true })} contract={null} />);
    expect(screen.getByText(messages.stream.empty.halfClosedTitle)).toBeInTheDocument();
    expect(screen.getByTestId("stream-empty-dot")).toBeInTheDocument();
  });

  it("half-closed with sent rows shows the rows, not the empty state", () => {
    render(<StreamView entry={entry({ kind: "client", halfClosed: true, messages: [out(1)] })} contract={null} />);
    expect(screen.queryByText(messages.stream.empty.halfClosedTitle)).toBeNull();
    expect(screen.getAllByTestId("stream-row")).toHaveLength(1);
  });
});

describe("StreamView two-way footer", () => {
  it("opening: ● OPENING with the live tone", () => {
    render(<StreamView entry={entry({ kind: "bidi", phase: "opening" })} contract={null} />);
    expect(footer().textContent).toContain(messages.stream.footer.opening);
    expect(footer().getAttribute("data-tone")).toBe("live");
  });

  it("half-closed: ● HALF-CLOSED, still ticking", () => {
    render(<StreamView entry={entry({ kind: "client", halfClosed: true, messages: [out(1)] })} contract={null} />);
    expect(footer().textContent).toContain(messages.stream.footer.halfClosed);
    expect(footer().textContent).not.toContain(messages.stream.footer.streaming);
    expect(footer().textContent).toContain("3.4s");
    act(() => vi.advanceTimersByTime(1000));
    expect(footer().textContent).toContain("4.4s");
  });

  it("half-closed then ended OK: ● OK (half-closed is not a terminal label)", () => {
    render(<StreamView entry={entry({ kind: "client", phase: "ended", halfClosed: true, elapsedMs: 900, end: endWith() })} contract={null} />);
    expect(footer().textContent).toContain(messages.stream.footer.ok);
    expect(footer().textContent).not.toContain(messages.stream.footer.halfClosed);
  });
});

describe("StreamView send fault strip", () => {
  it("a rejected Send message shows a dismissible strip above the rows; the stream stays live and its rows stay", () => {
    streamStore.open("s1", "bidi");
    streamStore.push("s1", { type: "Opened", kind: "bidi", auth_used: { kind: "none" }, tls_used: false, bytes_fields: [] });
    streamStore.pushOutbound("s1", { index: 1, at_ms: T0, size_bytes: 3, preview: "{}", json: "{}" });
    streamStore.setSendFault("s1", { kind: "other", message: "Unresolved variables: {{v}}" });
    render(<Host id="s1" />);

    const strip = screen.getByRole("alert");
    expect(strip.textContent).toContain(messages.stream.sendFault.title);
    expect(strip.textContent).toContain("Unresolved variables: {{v}}");
    expect(screen.getAllByTestId("stream-row")).toHaveLength(1);
    expect(footer().textContent).toContain(messages.stream.footer.streaming);

    fireEvent.click(within(strip).getByRole("button", { name: messages.stream.sendFault.dismiss }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(streamStore.get("s1")!.sendFault).toBeNull();
  });

  it("no strip without a send fault", () => {
    render(<StreamView entry={entry({ kind: "bidi", messages: [out(1)] })} contract={null} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
