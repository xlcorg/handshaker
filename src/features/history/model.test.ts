import { describe, expect, it } from "vitest";
import type { CallEndingIpc, CallSummaryIpc, HttpEndingIpc } from "@/ipc/bindings";
import { narrow } from "@/test/narrow";
import {
  faultOf, filterRows, formatCallTime, planHistoryOpen, recordKind, rowLabelOf, statusTextOf, targetOf,
} from "./model";
import {
  callRecord, collection, httpCallRecord, httpRequest, httpSummary, savedHttpRequest, savedRequest, summary,
} from "./testFixtures";

const ok = summary({ id: "ok" });
const notFound = summary({ id: "nf", method: "Lookup", ending: { type: "status", code: 5 } });
const refused = summary({
  id: "rf", service: "pay.v1.Pay", method: "Charge", address_template: "pay:443", ending: { type: "fault", kind: "refused" },
});
const cancelled = summary({ id: "cx", kind: "server", method: "Watch", ending: { type: "cancelled" } });
const rows = [ok, notFound, refused, cancelled];
const ids = (r: CallSummaryIpc[]) => r.map((row) => row.id);

describe("chips", () => {
  it("OK keeps status 0 only, Failed keeps non-zero, fault and cancelled, All keeps every row", () => {
    expect(ids(filterRows(rows, { text: "", chip: "ok" }))).toEqual(["ok"]);
    expect(ids(filterRows(rows, { text: "", chip: "failed" }))).toEqual(["nf", "rf", "cx"]);
    expect(ids(filterRows(rows, { text: "", chip: "all" }))).toEqual(["ok", "nf", "rf", "cx"]);
  });
});

describe("filter text", () => {
  it("matches service, method, address and status text, case-insensitively", () => {
    expect(ids(filterRows(rows, { text: "PAY.v1", chip: "all" }))).toEqual(["rf"]);
    expect(ids(filterRows(rows, { text: "lookup", chip: "all" }))).toEqual(["nf"]);
    expect(ids(filterRows(rows, { text: "pay:443", chip: "all" }))).toEqual(["rf"]);
    expect(ids(filterRows(rows, { text: "not_found", chip: "all" }))).toEqual(["nf"]);
    expect(ids(filterRows(rows, { text: "service unavailable", chip: "all" }))).toEqual(["rf"]);
    expect(ids(filterRows(rows, { text: "  cancelled ", chip: "all" }))).toEqual(["cx"]);
  });

  it("narrows within the chip and keeps the input order", () => {
    expect(ids(filterRows([cancelled, notFound, ok], { text: "echo", chip: "failed" }))).toEqual(["cx", "nf"]);
  });
});

describe("HTTP rows", () => {
  const created = httpSummary({ id: "201", method: "POST", ending: { type: "status", code: 201 } });
  const moved = httpSummary({ id: "302", ending: { type: "status", code: 302 } });
  const missing = httpSummary({ id: "404", url_template: "{{base}}/users/7", ending: { type: "status", code: 404 } });
  const broken = httpSummary({ id: "500", ending: { type: "status", code: 500 } });
  const refusedHttp = httpSummary({ id: "rf", ending: { type: "fault", kind: "refused" } });
  const httpRows = [created, moved, missing, broken, refusedHttp];

  it("OK keeps 2xx and 3xx, Failed keeps 4xx, 5xx and faults", () => {
    expect(ids(filterRows(httpRows, { text: "", chip: "ok" }))).toEqual(["201", "302"]);
    expect(ids(filterRows(httpRows, { text: "", chip: "failed" }))).toEqual(["404", "500", "rf"]);
  });

  it("matches the method, the URL and the status text", () => {
    expect(ids(filterRows(httpRows, { text: "post", chip: "all" }))).toEqual(["201"]);
    expect(ids(filterRows(httpRows, { text: "users/7", chip: "all" }))).toEqual(["404"]);
    expect(ids(filterRows(httpRows, { text: "not found", chip: "all" }))).toEqual(["404"]);
  });

  it("names the HTTP status with its reason and titles a fault", () => {
    const text = (ending: HttpEndingIpc) => statusTextOf(httpSummary({ ending }).line);
    expect(text({ type: "status", code: 404 })).toBe("404 Not Found");
    expect(text({ type: "status", code: 299 })).toBe("299");
    expect(text({ type: "fault", kind: "timeout" })).toBe("Request timed out");
  });
});

describe("statusTextOf", () => {
  it("names a status, titles a fault, and says Cancelled", () => {
    const text = (ending: CallEndingIpc) => statusTextOf(summary({ ending }).line);
    expect(text({ type: "status", code: 0 })).toBe("OK");
    expect(text({ type: "status", code: 5 })).toBe("NOT_FOUND");
    expect(text({ type: "fault", kind: "timeout" })).toBe("Request timed out");
    expect(text({ type: "fault", kind: "from-a-newer-build" })).toBe("Request failed");
    expect(text({ type: "cancelled" })).toBe("Cancelled");
  });
});

describe("row labels", () => {
  it("shortens the service in a gRPC row label and shows the address as the target", () => {
    expect(rowLabelOf(summary({ service: "echo.v1.Echo", method: "Say" }).line)).toBe("Echo.Say");
    expect(rowLabelOf(summary({ service: "Echo", method: "Say" }).line)).toBe("Echo.Say");
    expect(targetOf(summary({ address_template: "{{host}}:50051" }).line)).toBe("{{host}}:50051");
  });

  it("labels an HTTP row with its method and URL, and shows the URL as the target", () => {
    const line = httpSummary({ method: "DELETE", url_template: "{{base}}/users/7" }).line;
    expect(rowLabelOf(line)).toBe("DELETE {{base}}/users/7");
    expect(targetOf(line)).toBe("{{base}}/users/7");
  });

  it("shows the time for a call from today and the date for an older one", () => {
    const started = new Date(2026, 9, 10, 9, 5, 7).getTime();
    expect(formatCallTime(started, new Date(2026, 9, 10, 23, 0).getTime())).toBe("09:05:07");
    expect(formatCallTime(started, new Date(2026, 9, 11, 0, 1).getTime())).toBe("2026-10-10 09:05");
  });
});

describe("faultOf", () => {
  it("parses the stored kind, and unknown text reads as other", () => {
    expect(faultOf({ kind: "refused", message: "connection refused" })).toEqual({
      kind: "refused",
      message: "connection refused",
    });
    expect(faultOf({ kind: "from-a-newer-build", message: "x" })).toEqual({ kind: "other", message: "x" });
  });
});

describe("recordKind", () => {
  it("is unary for unary outcomes and the stream kind otherwise", () => {
    expect(recordKind(callRecord())).toBe("unary");
    expect(recordKind(callRecord({ outcome: { type: "unary_fault", fault: { kind: "refused", message: "x" } } }))).toBe("unary");
    expect(
      recordKind(callRecord({
        outcome: { type: "stream", kind: "bidi", headers: null, messages: [], omitted_messages: 0, end: { type: "cancelled" } },
      })),
    ).toBe("bidi");
    expect(
      recordKind(callRecord({ outcome: { type: "stream_refused", kind: "client", fault: { kind: "dns", message: "x" } } })),
    ).toBe("client");
  });

  it("is null for an HTTP record, which has no method kind", () => {
    expect(recordKind(httpCallRecord())).toBeNull();
  });
});

describe("planHistoryOpen", () => {
  const authoredDraft = {
    protocol: "grpc",
    address: "{{host}}:50051", tls: null, service: "echo.v1.Echo", method: "Say", requestJson: '{"text":"hi"}',
    metadata: [{ key: "x-trace", value: "1", enabled: true }, { key: "x-off", value: "2", enabled: false }],
    auth: { kind: "none" }, status: "draft", outcome: null, error: null, requestId: null, streamId: null,
  };

  it("binds when the origin resolves, with the record's request and a fresh draft", () => {
    const plan = planHistoryOpen(callRecord(), [collection("c1", [savedRequest("r1", "Say hello")])]);
    expect(plan).toEqual({
      kind: "bound",
      draft: { ...authoredDraft, id: expect.any(String), collectionId: "c1" },
      origin: { collectionId: "c1", requestId: "r1", requestName: "Say hello" },
    });
    expect(plan.draft.id).not.toBe("call-1");
  });

  it("opens unbound with originMissing when the item or the collection is gone", () => {
    const unbound = { kind: "unbound", draft: { ...authoredDraft, id: expect.any(String), collectionId: null }, originMissing: true };
    expect(planHistoryOpen(callRecord(), [collection("c1", [savedRequest("other")])])).toEqual(unbound);
    expect(planHistoryOpen(callRecord(), [])).toEqual(unbound);
  });

  it("opens unbound with no notice when the record had no origin", () => {
    const plan = planHistoryOpen(callRecord({ origin: null }), [collection("c1", [savedRequest("r1")])]);
    expect(plan).toMatchObject({ kind: "unbound", originMissing: false, draft: { collectionId: null } });
  });

  it("copies the metadata, so editing the draft never touches the cached record", () => {
    const record = callRecord();
    const plan = planHistoryOpen(record, []);
    narrow(plan.draft, "grpc").metadata[0].value = "edited";
    expect(record.call.request.metadata[0].value).toBe("1");
  });

  it("rebuilds an HTTP record as an HTTP draft carrying the recorded request, bound to its origin", () => {
    const plan = planHistoryOpen(httpCallRecord(), [collection("c1", [savedHttpRequest("h1", "Create user")])]);
    expect(plan).toEqual({
      kind: "bound",
      draft: { protocol: "http", id: expect.any(String), collectionId: "c1", template: httpRequest, run: { status: "draft" } },
      origin: { collectionId: "c1", requestId: "h1", requestName: "Create user" },
    });
  });
});
