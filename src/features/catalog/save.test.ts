import { describe, it, expect, vi } from "vitest";
import { newStep } from "@/features/workflow/model";
import { newHttpStep } from "@/features/http/model";
import { saveNewRequest, autosaveDraft } from "./save";

const draft = newStep({
  address: "h:443", tls: true, service: "p.v1.S", method: "GetX", requestJson: '{"id":"1"}',
  metadata: [{ key: "k", value: "v", enabled: true }],
  auth: { kind: "env_var", env_var: "T", header_name: "authorization", prefix: "Bearer " },
});

const template = {
  protocol: "grpc",
  address_template: "h:443",
  tls_override: true,
  service: "p.v1.S",
  method: "GetX",
  body_template: '{"id":"1"}',
  metadata: [{ key: "k", value: "v", enabled: true }],
  auth: { kind: "env_var", env_var: "T", header_name: "authorization", prefix: "Bearer " },
};

describe("saveNewRequest", () => {
  it("mints an id, builds a request item, adds it, and returns the id", async () => {
    const addItem = vi.fn().mockResolvedValue(undefined);
    const id = await saveNewRequest(addItem, draft, { collectionId: "c1", parentId: "f1", name: "My call" });
    expect(typeof id).toBe("string");
    expect(addItem.mock.calls).toEqual([
      ["c1", "f1", { type: "request", id, name: "My call", last_used_at: null, use_count: 0, template }],
    ]);
  });
});

describe("autosaveDraft", () => {
  it("writes only the draft's template to the origin item", async () => {
    const updateItemContent = vi.fn().mockResolvedValue(undefined);
    await autosaveDraft(updateItemContent, { collectionId: "c1", requestId: "r1" }, draft);
    expect(updateItemContent.mock.calls).toEqual([["c1", "r1", template]]);
  });
});

describe("HTTP drafts", () => {
  const httpDraft = {
    ...newHttpStep({
      template: {
        method: "POST",
        url_template: "{{base}}/users",
        query: [],
        headers: [{ key: "accept", value: "application/json", enabled: true }],
        body: { kind: "json", text: '{"name":"a"}' },
        auth: { kind: "none" },
      },
    }),
    run: { status: "error", error: { kind: "refused", message: "x" } },
  } as const;
  const httpTemplate = {
    protocol: "http",
    method: "POST",
    url_template: "{{base}}/users",
    query: [],
    headers: [{ key: "accept", value: "application/json", enabled: true }],
    body: { kind: "json", text: '{"name":"a"}' },
    auth: { kind: "none" },
  };

  it("saves an HTTP draft as a request whose template carries protocol http and no run state", async () => {
    const addItem = vi.fn().mockResolvedValue(undefined);
    const id = await saveNewRequest(addItem, httpDraft, { collectionId: "c1", parentId: null, name: "POST users" });
    expect(addItem.mock.calls).toEqual([
      ["c1", null, { type: "request", id, name: "POST users", last_used_at: null, use_count: 0, template: httpTemplate }],
    ]);
  });

  it("autosaves an HTTP draft's template to its origin item", async () => {
    const updateItemContent = vi.fn().mockResolvedValue(undefined);
    await autosaveDraft(updateItemContent, { collectionId: "c1", requestId: "h1" }, httpDraft);
    expect(updateItemContent.mock.calls).toEqual([["c1", "h1", httpTemplate]]);
  });
});
