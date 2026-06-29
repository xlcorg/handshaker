import { describe, it, expect, vi, beforeEach } from "vitest";
import { setPref } from "@/lib/use-prefs";

vi.mock("@/ipc/client", () => ({
  grpcBuildRequestSkeleton: vi.fn(),
  grpcInvokeOneshot: vi.fn(),
  grpcCancel: vi.fn(),
  varsResolve: vi.fn(),
  authResolve: vi.fn(),
  grpcMessageSchema: vi.fn(),
}));

import * as ipc from "@/ipc/client";
import { createStepFromMethod, sendStep, stepPatchFromSendResult, resolveAuthHeader, shouldRecordExecuted, buildExecutedStep, cancelStep } from "./actions";
import { buildRequestSkeletonSafe, applyMethodSelection, isPristineBody, resetBodyToTemplate, fetchMessageSchemaSafe } from "./actions";
import { varsCtxFor, varsResolverFor } from "./actions";
import { newStep, type Step } from "./model";
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
  it("returns ok outcome on success", async () => {
    vi.mocked(ipc.grpcInvokeOneshot).mockResolvedValue({
      status_code: 0,
      status_message: "OK",
      response_json: '{"state":"OK"}',
      trailing_metadata: {},
      status_details: [],
      elapsed_ms: 12,
    });
    const res = await sendStep({
      address: "h:443",
      tls: true,
      service: "S",
      method: "M",
      requestJson: "{}",
      metadata: [{ key: "x", value: "1", enabled: true }],
    });
    expect(res.kind).toBe("ok");
    if (res.kind === "ok") expect(res.outcome.status_code).toBe(0);
    expect(ipc.grpcInvokeOneshot).toHaveBeenCalledWith(
      { address: "h:443", tls: true, skip_verify: false },
      { service: "S", method: "M", request_json: "{}", metadata: { x: "1" } },
      expect.any(String),
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("returns error kind with the IpcError message on client failure", async () => {
    vi.mocked(ipc.grpcInvokeOneshot).mockRejectedValue({ type: "Transport", kind: "Refused", message: "connection refused" });
    const res = await sendStep({
      address: "h:443",
      tls: true,
      service: "S",
      method: "M",
      requestJson: "{}",
      metadata: [],
    });
    expect(res).toEqual({ kind: "error", fault: { kind: "refused", message: "connection refused" } });
  });

  it("falls back to the IpcError type for messageless variants", async () => {
    vi.mocked(ipc.grpcInvokeOneshot).mockRejectedValue({ type: "NotConnected" });
    const res = await sendStep({
      address: "h:443",
      tls: true,
      service: "S",
      method: "M",
      requestJson: "{}",
      metadata: [],
    });
    expect(res.kind).toBe("error");
    if (res.kind === "error") expect(res.fault).toEqual({ kind: "other", message: "NotConnected" });
  });

  it("omits disabled and empty-key metadata rows", async () => {
    vi.mocked(ipc.grpcInvokeOneshot).mockResolvedValue({
      status_code: 0,
      status_message: "OK",
      response_json: "{}",
      trailing_metadata: {},
      status_details: [],
      elapsed_ms: 1,
    });
    await sendStep({
      address: "h:443",
      tls: true,
      service: "S",
      method: "M",
      requestJson: "{}",
      metadata: [
        { key: "keep", value: "1", enabled: true },
        { key: "off", value: "2", enabled: false },
        { key: "", value: "3", enabled: true },
      ],
    });
    expect(ipc.grpcInvokeOneshot).toHaveBeenCalledWith(
      { address: "h:443", tls: true, skip_verify: false },
      { service: "S", method: "M", request_json: "{}", metadata: { keep: "1" } },
      expect.any(String),
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("sendStep returns an error result (does not throw) when varsResolve rejects", async () => {
    vi.mocked(ipc.varsResolve).mockRejectedValueOnce(new Error("backend boom"));
    const res = await sendStep({
      address: "{{host}}", tls: false, service: "S", method: "M",
      requestJson: "{}", metadata: [],
    });
    expect(res.kind).toBe("error");
    if (res.kind === "error") expect(res.fault.message).toContain("backend boom");
    expect(ipc.grpcInvokeOneshot).not.toHaveBeenCalled();
  });

  it("sendStep blocks on unresolved variables and does not invoke", async () => {
    vi.mocked(ipc.varsResolve).mockImplementation(async (tpl: string) => {
      const m = [...tpl.matchAll(/\{\{([^{}]+)\}\}/g)].map((x) => x[1]);
      return { resolved: tpl, unresolved_vars: m, cycle_chain: null, dynamic_vars: [] };
    });
    const res = await sendStep({
      address: "{{host}}", tls: false, service: "S", method: "M",
      requestJson: "{}", metadata: [],
    });
    expect(res.kind).toBe("unresolved");
    if (res.kind === "unresolved") expect(res.unresolved).toEqual(["host"]);
    expect(ipc.grpcInvokeOneshot).not.toHaveBeenCalled();
  });

  it("sendStep resolves templates in the step's collection ctx", async () => {
    await sendStep({
      address: "{{uri-root}}", tls: false, service: "p.S", method: "M",
      requestJson: "{}", metadata: [], collectionId: "c1",
    });
    expect(ipc.varsResolve).toHaveBeenCalledWith("{{uri-root}}", {
      collection_id: "c1", collection_vars: null, env_vars: null,
    });
  });

  it("sendStep without a collection resolves with a null ctx", async () => {
    await sendStep({
      address: "h:1", tls: false, service: "p.S", method: "M",
      requestJson: "{}", metadata: [],
    });
    expect(ipc.varsResolve).toHaveBeenCalledWith("h:1", null);
  });

  it("sendStep invokes with resolved address + metadata when all vars resolve", async () => {
    vi.mocked(ipc.varsResolve).mockImplementation(async (tpl: string) => ({
      resolved: tpl.replace("{{host}}", "api.internal"),
      unresolved_vars: [], cycle_chain: null, dynamic_vars: [],
    }));
    vi.mocked(ipc.grpcInvokeOneshot).mockResolvedValue({
      status_code: 0, status_message: "OK", response_json: "{}",
      trailing_metadata: {}, status_details: [], elapsed_ms: 5,
    });
    await sendStep({ address: "{{host}}", tls: true, service: "S", method: "M", requestJson: "{}", metadata: [] });
    expect(ipc.grpcInvokeOneshot).toHaveBeenCalledWith(
      { address: "api.internal", tls: true, skip_verify: false },
      expect.objectContaining({ service: "S", method: "M" }),
      expect.any(String),
      expect.any(Number),
      expect.any(Number),
    );
  });
});

describe("stepPatchFromSendResult", () => {
  it("ok with status 0 → ok", () => {
    const outcome = { status_code: 0, status_message: "OK", response_json: "{}", trailing_metadata: {}, status_details: [], elapsed_ms: 1 };
    expect(stepPatchFromSendResult({ kind: "ok", outcome })).toEqual({ status: "ok", outcome, error: null });
  });
  it("ok with non-zero status → error (grpc status), keeps outcome", () => {
    const outcome = { status_code: 5, status_message: "NOT_FOUND", response_json: null, trailing_metadata: {}, status_details: [], elapsed_ms: 1 };
    expect(stepPatchFromSendResult({ kind: "ok", outcome })).toEqual({ status: "error", outcome, error: null });
  });
  it("unresolved → error with variable list", () => {
    const p = stepPatchFromSendResult({ kind: "unresolved", unresolved: ["host", "id"], cycle: null });
    expect(p.status).toBe("error");
    expect(p.outcome).toBeNull();
    expect(p.error).toEqual({ kind: "other", message: "Unresolved variables: {{host}}, {{id}}" });
  });
  it("unresolved with cycle → cycle message", () => {
    const p = stepPatchFromSendResult({ kind: "unresolved", unresolved: [], cycle: ["a", "b", "a"] });
    expect(p.error).toEqual({ kind: "other", message: "Variable cycle: a → b → a" });
  });
  it("error → error with message", () => {
    expect(stepPatchFromSendResult({ kind: "error", fault: { kind: "other", message: "boom" } })).toEqual({ status: "error", outcome: null, error: { kind: "other", message: "boom" } });
  });
});

describe("sendStep authHeader merge", () => {
  beforeEach(() => {
    vi.mocked(ipc.grpcInvokeOneshot).mockResolvedValue({
      status_code: 0, status_message: "OK", response_json: "{}", trailing_metadata: {}, status_details: [], elapsed_ms: 1,
    });
  });

  it("merges the auth header verbatim alongside resolved metadata rows", async () => {
    await sendStep(
      { address: "h:443", tls: true, service: "S", method: "M", requestJson: "{}",
        metadata: [{ key: "x", value: "1", enabled: true }] },
      { key: "authorization", value: "Bearer {{notresolved}}" }, // verbatim: no var resolution
    );
    expect(ipc.grpcInvokeOneshot).toHaveBeenCalledWith(
      { address: "h:443", tls: true, skip_verify: false },
      { service: "S", method: "M", request_json: "{}",
        metadata: { x: "1", authorization: "Bearer {{notresolved}}" } },
      expect.any(String),
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("injects nothing when no authHeader is given", async () => {
    await sendStep({ address: "h:443", tls: true, service: "S", method: "M", requestJson: "{}", metadata: [] });
    expect(ipc.grpcInvokeOneshot).toHaveBeenCalledWith(
      { address: "h:443", tls: true, skip_verify: false },
      { service: "S", method: "M", request_json: "{}", metadata: {} },
      expect.any(String),
      expect.any(Number),
      expect.any(Number),
    );
  });
});

describe("resolveAuthHeader", () => {
  const passthroughVars = async (t: string) => ({ resolved: t, unresolved_vars: [], cycle_chain: null, dynamic_vars: [] });

  it("returns kind 'none' when auth.kind is none (no resolve call)", async () => {
    const r = await resolveAuthHeader({ kind: "none" }, null, {
      authResolve: ipc.authResolve,
      varsResolve: passthroughVars,
    });
    expect(r.kind).toBe("none");
    expect(ipc.authResolve).not.toHaveBeenCalled();
  });

  it("returns a header when EnvVar auth resolves", async () => {
    vi.mocked(ipc.authResolve).mockResolvedValue({ header_name: "authorization", header_value: "Bearer t" });
    const auth = { kind: "env_var" as const, env_var: "TOK", header_name: "authorization", prefix: "Bearer " };
    const r = await resolveAuthHeader(auth, null, { authResolve: ipc.authResolve, varsResolve: passthroughVars });
    expect(r.kind).toBe("header");
    if (r.kind === "header") expect(r.header).toEqual({ key: "authorization", value: "Bearer t" });
  });

  it("returns kind 'none' when authResolve yields null credentials", async () => {
    vi.mocked(ipc.authResolve).mockResolvedValue(null);
    const auth = { kind: "env_var" as const, env_var: "TOK", header_name: "authorization", prefix: "Bearer " };
    const r = await resolveAuthHeader(auth, null, { authResolve: ipc.authResolve, varsResolve: passthroughVars });
    expect(r.kind).toBe("none");
  });

  it("returns kind 'error' when authResolve throws", async () => {
    vi.mocked(ipc.authResolve).mockRejectedValue({ type: "NotImplemented", message: "oauth2 token fetch" });
    const auth = { kind: "oauth2_client_credentials" as const, token_url: "u", client_id: "c", client_secret: "S", scopes: [] };
    const r = await resolveAuthHeader(auth, null, { authResolve: ipc.authResolve, varsResolve: passthroughVars });
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("oauth2");
  });
});

describe("shouldRecordExecuted", () => {
  it("records only calls that reached the server (kind 'ok')", () => {
    const outcome = { status_code: 0, status_message: "OK", response_json: "{}", trailing_metadata: {}, status_details: [], elapsed_ms: 1 };
    expect(shouldRecordExecuted({ kind: "ok", outcome })).toBe(true);
    // non-zero gRPC status still reached the server → recorded
    const errOutcome = { status_code: 5, status_message: "NOT_FOUND", response_json: null, trailing_metadata: {}, status_details: [], elapsed_ms: 1 };
    expect(shouldRecordExecuted({ kind: "ok", outcome: errOutcome })).toBe(true);
    expect(shouldRecordExecuted({ kind: "error", fault: { kind: "other", message: "refused" } })).toBe(false);
    expect(shouldRecordExecuted({ kind: "unresolved", unresolved: ["x"], cycle: null })).toBe(false);
    expect(shouldRecordExecuted({ kind: "cancelled" })).toBe(false);
  });
});

describe("buildExecutedStep", () => {
  it("freezes a fresh-id snapshot of the draft with the send patch applied", () => {
    const draft = newStep({ address: "h:443", tls: true, service: "S", method: "M" });
    const outcome = { status_code: 0, status_message: "OK", response_json: "{}", trailing_metadata: {}, status_details: [], elapsed_ms: 7 };
    const snap = buildExecutedStep(draft, { status: "ok", outcome, error: null, requestId: null });
    expect(snap.id).not.toBe(draft.id);     // distinct history entry
    expect(snap.requestId).toBeNull();
    expect(snap.status).toBe("ok");
    expect(snap.outcome).toEqual(outcome);
    expect(snap.service).toBe("S");
    expect(snap.method).toBe("M");
  });
});

describe("sendStep cancel/timeout wiring", () => {
  beforeEach(() => {
    vi.mocked(ipc.grpcInvokeOneshot).mockResolvedValue({
      status_code: 0, status_message: "OK", response_json: "{}", trailing_metadata: {}, status_details: [], elapsed_ms: 1,
    });
  });

  it("passes a request_id and a timeout_ms to grpcInvokeOneshot", async () => {
    await sendStep(
      { address: "h:443", tls: true, service: "S", method: "M", requestJson: "{}", metadata: [] },
      null,
      { requestId: "req-1", timeoutMs: 12345 },
    );
    expect(ipc.grpcInvokeOneshot).toHaveBeenCalledWith(
      { address: "h:443", tls: true, skip_verify: false },
      { service: "S", method: "M", request_json: "{}", metadata: {} },
      "req-1",
      12345,
      expect.any(Number),
    );
  });

  it("passes the maxMessageBytes pref to grpcInvokeOneshot", async () => {
    setPref("maxMessageBytes", 0); // Unlimited
    await sendStep(
      { address: "h:443", tls: true, service: "S", method: "M", requestJson: "{}", metadata: [] },
      null,
      { requestId: "req-mb", timeoutMs: 1000 },
    );
    expect(ipc.grpcInvokeOneshot).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      "req-mb",
      1000,
      0,
    );
    setPref("maxMessageBytes", 16 * 1024 * 1024); // restore default for other tests
  });

  it("returns kind 'cancelled' when the backend reports a cancellation", async () => {
    vi.mocked(ipc.grpcInvokeOneshot).mockRejectedValue({ type: "Cancelled" });
    const res = await sendStep(
      { address: "h", tls: false, service: "S", method: "M", requestJson: "{}", metadata: [] },
      null,
      { requestId: "req-2", timeoutMs: 1000 },
    );
    expect(res.kind).toBe("cancelled");
    expect(ipc.grpcCancel).not.toHaveBeenCalled();
  });

  it("does NOT treat a near-miss transport error containing 'cancel' as a cancellation", async () => {
    // Only the exact backend `Cancelled` discriminator resets to draft; an unrelated I/O error
    // that merely contains "cancel" in its message must surface as an error, not silently vanish.
    vi.mocked(ipc.grpcInvokeOneshot).mockRejectedValue({
      type: "Transport",
      kind: "Other",
      message: "I/O operation has been canceled by the host",
    });
    const res = await sendStep(
      { address: "h", tls: false, service: "S", method: "M", requestJson: "{}", metadata: [] },
      null,
      { requestId: "req-3", timeoutMs: 1000 },
    );
    expect(res.kind).toBe("error");
    if (res.kind === "error") expect(res.fault.message).toContain("canceled");
  });

  it("generates distinct request ids across calls when none is provided", async () => {
    await sendStep({ address: "h", tls: false, service: "S", method: "M", requestJson: "{}", metadata: [] });
    await sendStep({ address: "h", tls: false, service: "S", method: "M", requestJson: "{}", metadata: [] });
    const ids = vi.mocked(ipc.grpcInvokeOneshot).mock.calls.map((c) => c[2]);
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

describe("stepPatchFromSendResult cancelled", () => {
  it("cancelled → draft, cleared", () => {
    expect(stepPatchFromSendResult({ kind: "cancelled" })).toEqual({
      status: "draft", outcome: null, error: null,
    });
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
});
