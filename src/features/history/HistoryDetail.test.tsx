import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CallOutcomeIpc, CallRecordIpc } from "@/ipc/bindings";

const api = vi.hoisted(() => ({
  historyGet: vi.fn<(id: string) => Promise<CallRecordIpc | null>>(),
}));
vi.mock("@/ipc/client", () => ({ ...api, ipc: api }));

import { messages } from "@/lib/messages";
import { streamStore } from "@/features/stream/streamStore";
import { HistoryDetail } from "./HistoryDetail";
import { historyStore } from "./store";
import { callRecord, summary } from "./testFixtures";

const d = messages.history.detail;
const onRerun = vi.fn();

function show(outcome?: CallOutcomeIpc, over: Partial<CallRecordIpc> = {}) {
  api.historyGet.mockResolvedValue(callRecord({ ...(outcome ? { outcome } : {}), ...over }));
  render(<HistoryDetail row={summary()} onRerun={onRerun} />);
}

const section = (name: string) => within(screen.getByRole("region", { name }));

beforeEach(() => {
  vi.clearAllMocks();
  historyStore.reset();
});

describe("HistoryDetail", () => {
  it("shows a unary call's request, enabled metadata, body and trailers, and no headers", async () => {
    show();
    expect(await screen.findByText('{"text":"hi"}', { selector: "section[aria-label='Request'] pre" })).toBeInTheDocument();
    expect(section(d.metadata).getByText("x-trace")).toBeInTheDocument();
    expect(section(d.metadata).queryByText("x-off")).toBeNull();
    expect(section(d.response).getByText('{"text":"hi"}')).toBeInTheDocument();
    expect(section(d.headers).getByText(d.notRecorded)).toBeInTheDocument();
    expect(section(d.trailers).getByText("grpc-status")).toBeInTheDocument();
  });

  it("says No metadata when every row is disabled, and names an omitted body's size", async () => {
    show(
      {
        type: "unary",
        status: { code: 5, message: "no such user", trailers: {} },
        response: { type: "omitted", size_bytes: 300 * 1024 },
      },
      { request: { ...callRecord().request, metadata: [{ key: "x-off", value: "2", enabled: false }] } },
    );
    expect(await screen.findByText(d.noMetadata)).toBeInTheDocument();
    expect(section(d.response).getByText("no such user")).toBeInTheDocument();
    expect(section(d.response).getByText(d.bodyOmitted("300.0KB"))).toBeInTheDocument();
  });

  it("renders a stream's messages from the record alone, with no stream store entry", async () => {
    expect(streamStore.get("call-1")).toBeNull();
    const user = userEvent.setup();
    show({
      type: "stream",
      kind: "server",
      headers: { "content-type": "application/grpc" },
      messages: [
        { direction: "in", index: 3, at_ms: 0, size_bytes: 9, preview: '{"n":3}', json: '{\n  "n": 3\n}' },
        { direction: "in", index: 4, at_ms: 0, size_bytes: 9, preview: '{"n":4}', json: null },
      ],
      omitted_messages: 2,
      end: { type: "status", status: { code: 0, message: "", trailers: { "grpc-status": "0" } } },
    });
    const list = await screen.findAllByTestId("history-message");
    expect(list.map((li) => within(li).getByText(/^\{"n":\d\}$/).textContent)).toEqual(['{"n":3}', '{"n":4}']);
    expect(section(d.messages).getByText(d.messagesOmitted(2))).toBeInTheDocument();
    await user.click(within(list[1]).getByText('{"n":4}'));
    expect(within(list[1]).getByText(d.messageBodyOmitted)).toBeVisible();
    expect(section(d.headers).getByText("content-type")).toBeInTheDocument();
    expect(section(d.trailers).getByText("grpc-status")).toBeInTheDocument();
  });

  it("says None received for a stream that ended before headers", async () => {
    show({ type: "stream", kind: "bidi", headers: null, messages: [], omitted_messages: 0, end: { type: "cancelled" } });
    await screen.findByRole("region", { name: d.headers });
    expect(section(d.headers).getByText(d.noneReceived)).toBeInTheDocument();
    expect(section(d.messages).getByText(d.noneReceived)).toBeInTheDocument();
    expect(section(d.trailers).getByText(d.notRecorded)).toBeInTheDocument();
  });

  it("shows a refused call's fault face", async () => {
    show({ type: "stream_refused", kind: "server", fault: { kind: "refused", message: "connection refused" } });
    expect(await screen.findByText(messages.response.clientError.title.refused)).toBeInTheDocument();
    expect(screen.getByText("connection refused")).toBeInTheDocument();
    expect(section(d.headers).getByText(d.notRecorded)).toBeInTheDocument();
  });

  it("says the details are gone when the record is missing, and Re-run still asks", async () => {
    api.historyGet.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<HistoryDetail row={summary()} onRerun={onRerun} />);
    expect(await screen.findByText(d.unavailable)).toBeInTheDocument();
    await user.click(screen.getByTestId("history-detail-rerun"));
    expect(onRerun).toHaveBeenCalledTimes(1);
  });
});
