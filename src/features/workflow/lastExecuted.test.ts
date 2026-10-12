import { describe, it, expect } from "vitest";
import { newStep, type Step } from "./model";
import { callKeyOf, lastExecutedFor, responseSeedPatch, seedFrom } from "./lastExecuted";
import { newHttpStep, type HttpRun } from "@/features/http/model";
import { narrow } from "@/test/narrow";
import type { HttpTemplateIpc, InvokeOutcomeIpc } from "@/ipc/bindings";

const outcome = (code: number) =>
  ({ status_code: code } as unknown as InvokeOutcomeIpc);

function executed(service: string, method: string, address: string, code: number): Step {
  return {
    ...newStep({ address, tls: false, service, method }),
    status: code === 0 ? "ok" : "error",
    outcome: outcome(code),
  };
}

describe("lastExecutedFor", () => {
  const steps = [
    executed("p.S", "Get", "h:1", 0),
    executed("p.S", "List", "h:1", 0),
    executed("p.S", "Get", "h:1", 5), // более поздний вызов того же метода
    executed("p.S", "Get", "h:2", 0), // другой адрес
  ];

  it("returns the LATEST matching executed step", () => {
    const hit = lastExecutedFor(steps, { protocol: "grpc", service: "p.S", method: "Get", address: "h:1" });
    expect(narrow(hit, "grpc").outcome).toEqual(outcome(5));
  });

  it("matches address too", () => {
    const hit = lastExecutedFor(steps, { protocol: "grpc", service: "p.S", method: "Get", address: "h:2" });
    expect(narrow(hit, "grpc").outcome).toEqual(outcome(0));
  });

  it("returns null when nothing matches", () => {
    expect(lastExecutedFor(steps, { protocol: "grpc", service: "p.S", method: "Nope", address: "h:1" })).toBeNull();
  });
});

describe("responseSeedPatch", () => {
  it("copies status/outcome/error from the hit", () => {
    const hit = executed("p.S", "Get", "h:1", 5);
    expect(responseSeedPatch(hit)).toEqual({ status: "error", outcome: outcome(5), error: null, streamId: null });
  });

  it("copies the stream reference of a stream hit", () => {
    const hit = { ...executed("p.S", "Watch", "h:1", 0), outcome: null, streamId: "s1" };
    expect(responseSeedPatch(hit)).toMatchObject({ status: "ok", streamId: "s1" });
  });

  it("null hit clears the response fields", () => {
    expect(responseSeedPatch(null)).toEqual({ status: "draft", outcome: null, error: null, streamId: null });
  });
});

const template: HttpTemplateIpc = {
  method: "GET",
  url_template: "{{base}}/users",
  query: [
    { key: "page", value: "2", enabled: true },
    { key: "debug", value: "1", enabled: false },
  ],
  headers: [],
  body: { kind: "none" },
  auth: { kind: "none" },
};

function done(status: number): HttpRun {
  return {
    status: "done",
    response: { status, reason: "", headers: [], body: { type: "empty" }, size_bytes: 0, elapsed_ms: 1 },
    authUsed: { kind: "none" },
  };
}

function executedHttp(t: HttpTemplateIpc, status: number) {
  return { ...newHttpStep({ template: t }), run: done(status) };
}

describe("HTTP call keys", () => {
  it("keys an HTTP draft by method, URL and enabled query rows", () => {
    expect(callKeyOf(newHttpStep({ template }))).toEqual({
      protocol: "http", method: "GET", url: "{{base}}/users", query: ["page=2"],
    });
  });

  it("finds the latest HTTP call with the same method, URL and enabled params", () => {
    const steps = [
      executedHttp(template, 200),
      executedHttp({ ...template, query: [{ key: "page", value: "3", enabled: true }] }, 201),
      executedHttp({ ...template, method: "POST" }, 202),
      executed("p.S", "Get", "{{base}}/users", 0),
    ];
    const hit = lastExecutedFor(steps, callKeyOf(newHttpStep({ template })));
    expect(narrow(hit, "http").run).toEqual(done(200));
  });

  it("ignores a disabled query row, so toggling one keeps the last response", () => {
    const steps = [executedHttp({ ...template, query: [template.query[0]] }, 200)];
    expect(lastExecutedFor(steps, callKeyOf(newHttpStep({ template })))).toBe(steps[0]);
  });
});

describe("seedFrom", () => {
  it("shows the last HTTP call's run on an HTTP draft and keeps the draft's template", () => {
    const draft = newHttpStep({ template, collectionId: "c1" });
    expect(seedFrom(draft, executedHttp(template, 404))).toEqual({ ...draft, run: done(404) });
  });

  it("leaves an HTTP draft untouched when there is no HTTP hit", () => {
    const draft = newHttpStep({ template });
    expect(seedFrom(draft, null)).toBe(draft);
    expect(seedFrom(draft, executed("p.S", "Get", "h:1", 0))).toBe(draft);
  });

  it("gives a gRPC draft a clean response when the hit is an HTTP call", () => {
    const draft = newStep({ address: "h:1", service: "p.S", method: "Get" });
    expect(seedFrom(draft, executedHttp(template, 200))).toEqual({
      ...draft, status: "draft", outcome: null, error: null, streamId: null,
    });
  });
});
