import { describe, it, expect, vi, beforeEach } from "vitest";
import { setPref } from "@/lib/use-prefs";

vi.mock("@/ipc/client", () => ({
  grpcBuildRequestSkeleton: vi.fn(),
  grpcSend: vi.fn(),
  grpcCancel: vi.fn(),
  varsResolve: vi.fn(),
  authResolve: vi.fn(),
  grpcMessageSchema: vi.fn(),
}));

import * as ipc from "@/ipc/client";
import { createStepFromMethod, sendStep, cancelStep } from "./actions";
import { buildRequestSkeletonSafe, applyMethodSelection, isPristineBody, resetBodyToTemplate, fetchMessageSchemaSafe } from "./actions";
import { varsCtxFor, varsResolverFor } from "./actions";
import type { Step } from "./model";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ipc.varsResolve).mockImplementation(async (tpl: string) => ({
    resolved: tpl,
    unresolved_vars: [],
    cycle_chain: null,
    dynamic_vars: [],
  }));
});

describe("createStepFromMethod", () => {
  it("starts with the empty body template — the contract shows as ghost, not autofill", async () => {
    const step = await createStepFromMethod(
      { address: "order-api:443", tls: true },
      "order.v1.OrderService",
      "GetOrderState",
    );
    expect(ipc.grpcBuildRequestSkeleton).not.toHaveBeenCalled();
    expect(step.requestJson).toBe("{\n}");
    expect(step.status).toBe("draft");
    expect(step.service).toBe("order.v1.OrderService");
  });

  it("seeds metadata (deep copy) from service defaultMetadata and records inline auth", async () => {
    const defaults = [{ key: "x-tenant", value: "{{tenant}}", enabled: true }];
    const auth = { kind: "env_var" as const, env_var: "TOK", header_name: "authorization", prefix: "Bearer " };
    const step = await createStepFromMethod(
      { address: "h:443", tls: true }, "S", "M",
      { auth, defaultMetadata: defaults },
    );
    expect(step.auth).toEqual(auth);
    expect(step.metadata).toEqual(defaults);
    expect(step.metadata).not.toBe(defaults);       // deep copy: array identity differs
    expect(step.metadata[0]).not.toBe(defaults[0]); // and row identity differs
  });
});

describe("varsCtxFor / varsResolverFor", () => {
  it("builds a collection ctx only when an id is present", () => {
    expect(varsCtxFor("c1")).toEqual({ collection_id: "c1", collection_vars: null, env_vars: null });
    expect(varsCtxFor(null)).toBeNull();
    expect(varsCtxFor(undefined)).toBeNull();
  });

  it("varsResolverFor passes the ctx to ipc.varsResolve", async () => {
    await varsResolverFor("c1")("{{x}}");
    expect(ipc.varsResolve).toHaveBeenCalledWith("{{x}}", {
      collection_id: "c1", collection_vars: null, env_vars: null,
    });
  });
});

describe("sendStep", () => {
  const baseStep = {
    address: "h:443",
    tls: true,
    service: "S",
    method: "M",
    requestJson: "{}",
    metadata: [{ key: "x", value: "1", enabled: true }],
    auth: { kind: "none" as const },
    collectionId: "c1",
  };

  it("forwards the draft templates + ctx unchanged to grpcSend", async () => {
    vi.mocked(ipc.grpcSend).mockResolvedValue({
      outcome: {
        status_code: 0,
        status_message: "OK",
        response_json: '{"state":"OK"}',
        trailing_metadata: {},
        status_details: [],
        elapsed_ms: 12,
      },
      auth_used: { kind: "none" },
      tls_used: false,
    });
    const res = await sendStep(baseStep, { envName: "prod" }, { requestId: "rid" });
    expect(res.kind).toBe("ok");
    if (res.kind === "ok") expect(res.report.outcome.status_code).toBe(0);
    expect(ipc.grpcSend).toHaveBeenCalledWith(
      {
        address_template: "h:443",
        tls_override: true,
        service: "S",
        method: "M",
        body_template: "{}",
        metadata: [{ key: "x", value: "1", enabled: true }],
        auth: { kind: "none" },
      },
      { collection_id: "c1", env_name: "prod" },
      "rid",
      { timeout_ms: expect.any(Number), max_message_bytes: expect.any(Number) },
    );
  });

  it("forwards a null tls (inherit) as tls_override: null for core to resolve", async () => {
    vi.mocked(ipc.grpcSend).mockResolvedValue({
      outcome: {
        status_code: 0, status_message: "OK", response_json: "{}",
        trailing_metadata: {}, status_details: [], elapsed_ms: 1,
      },
      auth_used: { kind: "none" },
      tls_used: false,
    });
    await sendStep({ ...baseStep, tls: null }, { envName: "prod" });
    expect(ipc.grpcSend).toHaveBeenCalledWith(
      expect.objectContaining({ tls_override: null }),
      expect.anything(),
      expect.any(String),
      expect.anything(),
    );
  });

  it("omits disabled and empty-key metadata rows from the draft", async () => {
    vi.mocked(ipc.grpcSend).mockResolvedValue({
      outcome: {
        status_code: 0, status_message: "OK", response_json: "{}",
        trailing_metadata: {}, status_details: [], elapsed_ms: 1,
      },
      auth_used: { kind: "none" },
      tls_used: false,
    });
    await sendStep(
      {
        ...baseStep,
        metadata: [
          { key: "keep", value: "1", enabled: true },
          { key: "off", value: "2", enabled: false },
          { key: "", value: "3", enabled: true },
        ],
      },
      { envName: null },
    );
    expect(ipc.grpcSend).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: [{ key: "keep", value: "1", enabled: true }] }),
      expect.anything(),
      expect.any(String),
      expect.anything(),
    );
  });

  it("maps an UnresolvedVars throw to kind 'unresolved'", async () => {
    vi.mocked(ipc.grpcSend).mockRejectedValue({
      type: "UnresolvedVars",
      unresolved: ["host", "uid"],
      cycle: null,
    });
    const res = await sendStep(baseStep, { envName: null });
    expect(res).toEqual({ kind: "unresolved", unresolved: ["host", "uid"], cycle: null });
  });

  it("maps an UnresolvedVars cycle throw through, cycle intact", async () => {
    vi.mocked(ipc.grpcSend).mockRejectedValue({
      type: "UnresolvedVars",
      unresolved: [],
      cycle: ["a", "b", "a"],
    });
    const res = await sendStep(baseStep, { envName: null });
    expect(res).toEqual({ kind: "unresolved", unresolved: [], cycle: ["a", "b", "a"] });
  });

  it("maps a Cancelled throw to kind 'cancelled'", async () => {
    vi.mocked(ipc.grpcSend).mockRejectedValue({ type: "Cancelled" });
    const res = await sendStep(baseStep, { envName: null });
    expect(res).toEqual({ kind: "cancelled" });
  });

  it("returns error kind with the IpcError message on client failure", async () => {
    vi.mocked(ipc.grpcSend).mockRejectedValue({ type: "Transport", kind: "Refused", message: "connection refused" });
    const res = await sendStep(baseStep, { envName: null });
    expect(res).toEqual({ kind: "error", fault: { kind: "refused", message: "connection refused" } });
  });

  it("falls back to the IpcError type for messageless variants", async () => {
    vi.mocked(ipc.grpcSend).mockRejectedValue({ type: "NotConnected" });
    const res = await sendStep(baseStep, { envName: null });
    expect(res.kind).toBe("error");
    if (res.kind === "error") expect(res.fault).toEqual({ kind: "other", message: "NotConnected" });
  });

  it("sends a null collection_id when the step is unbound", async () => {
    vi.mocked(ipc.grpcSend).mockResolvedValue({
      outcome: {
        status_code: 0, status_message: "OK", response_json: "{}",
        trailing_metadata: {}, status_details: [], elapsed_ms: 1,
      },
      auth_used: { kind: "none" },
      tls_used: false,
    });
    await sendStep({ ...baseStep, collectionId: undefined }, { envName: null });
    expect(ipc.grpcSend).toHaveBeenCalledWith(
      expect.anything(),
      { collection_id: null, env_name: null },
      expect.any(String),
      expect.anything(),
    );
  });
});

describe("sendStep cancel/timeout wiring", () => {
  const step = { address: "h:443", tls: true, service: "S", method: "M", requestJson: "{}", metadata: [], auth: { kind: "none" as const } };

  beforeEach(() => {
    vi.mocked(ipc.grpcSend).mockResolvedValue({
      outcome: {
        status_code: 0, status_message: "OK", response_json: "{}", trailing_metadata: {}, status_details: [], elapsed_ms: 1,
      },
      auth_used: { kind: "none" },
      tls_used: false,
    });
  });

  it("passes a request_id and a timeout_ms to grpcSend", async () => {
    await sendStep(step, { envName: null }, { requestId: "req-1", timeoutMs: 12345 });
    expect(ipc.grpcSend).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "req-1",
      { timeout_ms: 12345, max_message_bytes: expect.any(Number) },
    );
  });

  it("passes the maxMessageBytes pref to grpcSend", async () => {
    setPref("maxMessageBytes", 0); // Unlimited
    await sendStep(step, { envName: null }, { requestId: "req-mb", timeoutMs: 1000 });
    expect(ipc.grpcSend).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      "req-mb",
      { timeout_ms: 1000, max_message_bytes: 0 },
    );
    setPref("maxMessageBytes", 16 * 1024 * 1024); // restore default for other tests
  });

  it("returns kind 'cancelled' when the backend reports a cancellation", async () => {
    vi.mocked(ipc.grpcSend).mockRejectedValue({ type: "Cancelled" });
    const res = await sendStep(step, { envName: null }, { requestId: "req-2", timeoutMs: 1000 });
    expect(res.kind).toBe("cancelled");
    expect(ipc.grpcCancel).not.toHaveBeenCalled();
  });

  it("does NOT treat a near-miss transport error containing 'cancel' as a cancellation", async () => {
    // Only the exact backend `Cancelled` discriminator resets to draft; an unrelated I/O error
    // that merely contains "cancel" in its message must surface as an error, not silently vanish.
    vi.mocked(ipc.grpcSend).mockRejectedValue({
      type: "Transport",
      kind: "Other",
      message: "I/O operation has been canceled by the host",
    });
    const res = await sendStep(step, { envName: null }, { requestId: "req-3", timeoutMs: 1000 });
    expect(res.kind).toBe("error");
    if (res.kind === "error") expect(res.fault.message).toContain("canceled");
  });

  it("generates distinct request ids across calls when none is provided", async () => {
    await sendStep(step, { envName: null });
    await sendStep(step, { envName: null });
    const ids = vi.mocked(ipc.grpcSend).mock.calls.map((c) => c[2]);
    expect(ids[0]).not.toBe(ids[1]);
    expect(typeof ids[0]).toBe("string");
  });
});

describe("cancelStep", () => {
  it("calls grpcCancel with the request id", async () => {
    await cancelStep("req-9");
    expect(ipc.grpcCancel).toHaveBeenCalledWith("req-9");
  });
  it("swallows grpcCancel errors (best-effort)", async () => {
    vi.mocked(ipc.grpcCancel).mockRejectedValueOnce(new Error("gone"));
    await expect(cancelStep("req-x")).resolves.toBeUndefined();
  });
});

describe("buildRequestSkeletonSafe", () => {
  it("returns the backend skeleton on success", async () => {
    vi.mocked(ipc.grpcBuildRequestSkeleton).mockResolvedValue('{"id":""}');
    const out = await buildRequestSkeletonSafe({ address: "h:443", tls: true }, "p.S", "M");
    expect(out).toBe('{"id":""}');
    expect(ipc.grpcBuildRequestSkeleton).toHaveBeenCalledWith(
      { address: "h:443", tls: true, skip_verify: false }, "p.S", "M",
    );
  });

  it("falls back to '{}' when reflection/skeleton fails", async () => {
    vi.mocked(ipc.grpcBuildRequestSkeleton).mockRejectedValue(new Error("nope"));
    expect(await buildRequestSkeletonSafe({ address: "h", tls: false }, "p.S", "M")).toBe("{}");
  });

  it("resolves {{var}} in the address before building the skeleton (mirrors Send)", async () => {
    vi.mocked(ipc.varsResolve).mockImplementation(async (tpl: string) => ({
      resolved: tpl.replace("{{host}}", "api.internal"),
      unresolved_vars: [], cycle_chain: null, dynamic_vars: [],
    }));
    vi.mocked(ipc.grpcBuildRequestSkeleton).mockResolvedValue("{}");
    await buildRequestSkeletonSafe({ address: "{{host}}:443", tls: true }, "p.S", "M");
    expect(ipc.grpcBuildRequestSkeleton).toHaveBeenCalledWith(
      { address: "api.internal:443", tls: true, skip_verify: false }, "p.S", "M",
    );
  });

  it("threads skipVerify:true into skip_verify", async () => {
    vi.mocked(ipc.grpcBuildRequestSkeleton).mockResolvedValue("{}");
    await buildRequestSkeletonSafe({ address: "h:443", tls: true, skipVerify: true }, "p.S", "M");
    expect(ipc.grpcBuildRequestSkeleton).toHaveBeenCalledWith(
      { address: "h:443", tls: true, skip_verify: true }, "p.S", "M",
    );
  });

  it("defaults skip_verify to false when skipVerify is omitted", async () => {
    vi.mocked(ipc.grpcBuildRequestSkeleton).mockResolvedValue("{}");
    await buildRequestSkeletonSafe({ address: "h:443", tls: true }, "p.S", "M");
    expect(ipc.grpcBuildRequestSkeleton).toHaveBeenCalledWith(
      { address: "h:443", tls: true, skip_verify: false }, "p.S", "M",
    );
  });
});

describe("applyMethodSelection", () => {
  it("resets a pristine body to the empty template (the contract renders as ghost)", async () => {
    vi.mocked(ipc.grpcBuildRequestSkeleton).mockResolvedValueOnce('{"a":""}'); // old method skeleton (pristine check)
    const patch = vi.fn();
    await applyMethodSelection(
      patch,
      { address: "h:443", tls: true },
      { requestJson: "{}", service: "p.S", method: "Old" }, // pristine
      { service: "p.S", method: "New" },
    );
    expect(patch).toHaveBeenNthCalledWith(1, { service: "p.S", method: "New", status: "draft", outcome: null, error: null });
    expect(patch).toHaveBeenNthCalledWith(2, { requestJson: "{\n}" });
    // no autofill: the new method's skeleton is only built on demand (Reset-to-template)
    expect(ipc.grpcBuildRequestSkeleton).toHaveBeenCalledTimes(1);
  });

  it("resets a body that equals the old skeleton modulo whitespace", async () => {
    vi.mocked(ipc.grpcBuildRequestSkeleton).mockResolvedValueOnce('{"a":""}');
    const patch = vi.fn();
    await applyMethodSelection(
      patch,
      { address: "h:443", tls: true },
      { requestJson: '{\n  "a": ""\n}', service: "p.S", method: "Old" }, // == old skeleton
      { service: "p.S", method: "New" },
    );
    expect(patch).toHaveBeenNthCalledWith(2, { requestJson: "{\n}" });
  });

  it("preserves an edited body (patches service/method only)", async () => {
    vi.mocked(ipc.grpcBuildRequestSkeleton).mockResolvedValueOnce('{"a":""}'); // old skeleton
    const patch = vi.fn();
    await applyMethodSelection(
      patch,
      { address: "h:443", tls: true },
      { requestJson: '{"a":"edited"}', service: "p.S", method: "Old" }, // edited
      { service: "p.S", method: "New" },
    );
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith({ service: "p.S", method: "New", status: "draft", outcome: null, error: null });
  });

  it("seeds the response fields from history for the newly selected method", async () => {
    const outcome = { status_code: 0 } as unknown as InvokeOutcomeIpc;
    const history: Step[] = [{
      ...(await createStepFromMethod({ address: "h:1", tls: false }, "p.S", "Other")),
      status: "ok" as const,
      outcome,
    }];
    const patches: Partial<Step>[] = [];
    await applyMethodSelection(
      (p) => patches.push(p),
      { address: "h:1", tls: false },
      { requestJson: "{}", service: "p.S", method: "Get" },
      { service: "p.S", method: "Other" },
      history,
    );
    const main = patches[0];
    expect(main.outcome).toEqual(outcome);
    expect(main.status).toBe("ok");
  });

  it("clears a stale response when the new method has no history", async () => {
    const patches: Partial<Step>[] = [];
    await applyMethodSelection(
      (p) => patches.push(p),
      { address: "h:1", tls: false },
      { requestJson: "{}", service: "p.S", method: "Get" },
      { service: "p.S", method: "Fresh" },
      [],
    );
    expect(patches[0].outcome).toBeNull();
    expect(patches[0].status).toBe("draft");
  });
});

describe("isPristineBody", () => {
  const skel = '{"a":""}';

  it("treats empty / empty-object bodies as pristine (any formatting)", () => {
    expect(isPristineBody("", skel)).toBe(true);
    expect(isPristineBody("   ", skel)).toBe(true);
    expect(isPristineBody("{}", skel)).toBe(true);
    expect(isPristineBody("{\n}", skel)).toBe(true); // the empty body template itself
    expect(isPristineBody("{ }", skel)).toBe(true);
  });

  it("ignores whitespace/formatting when comparing to the skeleton", () => {
    expect(isPristineBody('{\n  "a": ""\n}', skel)).toBe(true);
  });

  it("treats an edited body as not pristine", () => {
    expect(isPristineBody('{"a":"edited"}', skel)).toBe(false); // changed value
    expect(isPristineBody('{"a":"","b":1}', skel)).toBe(false); // extra key
  });

  it("treats invalid JSON (mid-edit) as not pristine", () => {
    expect(isPristineBody('{"a":', skel)).toBe(false);
  });

  it("falls back to a trimmed string compare when the skeleton is unparseable", () => {
    expect(isPristineBody("not json", "not json")).toBe(true);
    expect(isPristineBody("not json", "other")).toBe(false);
  });
});

describe("resetBodyToTemplate", () => {
  it("patches requestJson with a fresh skeleton for the current method", async () => {
    vi.mocked(ipc.grpcBuildRequestSkeleton).mockResolvedValue('{"a":""}');
    const patch = vi.fn();
    await resetBodyToTemplate(patch, { address: "h:443", tls: true }, "p.S", "M");
    expect(ipc.grpcBuildRequestSkeleton).toHaveBeenCalledWith(
      { address: "h:443", tls: true, skip_verify: false },
      "p.S",
      "M",
    );
    expect(patch).toHaveBeenCalledWith({ requestJson: '{"a":""}' });
  });

  it("falls back to {} when the skeleton build fails", async () => {
    vi.mocked(ipc.grpcBuildRequestSkeleton).mockRejectedValue(new Error("boom"));
    const patch = vi.fn();
    await resetBodyToTemplate(patch, { address: "h", tls: false }, "S", "M");
    expect(patch).toHaveBeenCalledWith({ requestJson: "{}" });
  });
});

describe("fetchMessageSchemaSafe", () => {
  const mockSchema = { root: "t.M", messages: [], enums: [] };

  beforeEach(() => {
    vi.mocked(ipc.grpcMessageSchema).mockResolvedValue(mockSchema);
  });

  it("returns schema on success (defaults to input side)", async () => {
    const result = await fetchMessageSchemaSafe({ address: "h:443", tls: true }, "S", "M");
    expect(result).toEqual(mockSchema);
    expect(ipc.grpcMessageSchema).toHaveBeenCalledWith(
      { address: "h:443", tls: true, skip_verify: false },
      "S",
      "M",
      "input",
    );
  });

  it("forwards the requested side to the IPC call", async () => {
    await fetchMessageSchemaSafe({ address: "h", tls: false }, "S", "M", "output");
    expect(ipc.grpcMessageSchema).toHaveBeenCalledWith(
      expect.objectContaining({ tls: false }),
      "S",
      "M",
      "output",
    );
  });

  it("returns null on IPC failure (best-effort)", async () => {
    vi.mocked(ipc.grpcMessageSchema).mockRejectedValue(new Error("reflection unavailable"));
    const result = await fetchMessageSchemaSafe({ address: "h", tls: false }, "S", "M");
    expect(result).toBeNull();
  });

  it("threads skipVerify:true into skip_verify", async () => {
    await fetchMessageSchemaSafe({ address: "h:443", tls: true, skipVerify: true }, "S", "M");
    expect(ipc.grpcMessageSchema).toHaveBeenCalledWith(
      { address: "h:443", tls: true, skip_verify: true },
      "S",
      "M",
      "input",
    );
  });

  it("defaults skip_verify to false when skipVerify is omitted", async () => {
    await fetchMessageSchemaSafe({ address: "h:443", tls: true }, "S", "M");
    expect(ipc.grpcMessageSchema).toHaveBeenCalledWith(
      { address: "h:443", tls: true, skip_verify: false },
      "S",
      "M",
      "input",
    );
  });
});
