import { describe, it, expect, vi } from "vitest";
import { newStep } from "@/features/workflow/model";
import { saveNewRequest, autosaveDraft } from "./save";

const draft = newStep({
  address: "h:443", tls: true, service: "p.v1.S", method: "GetX", requestJson: '{"id":"1"}',
  metadata: [{ key: "k", value: "v", enabled: true }],
  auth: { kind: "env_var", env_var: "T", header_name: "authorization", prefix: "Bearer " },
});

describe("saveNewRequest", () => {
  it("mints an id, builds a request item, adds it, and returns the id", async () => {
    const addItem = vi.fn().mockResolvedValue(undefined);
    const id = await saveNewRequest(addItem, draft, { collectionId: "c1", parentId: "f1", name: "My call" });
    expect(typeof id).toBe("string");
    expect(addItem).toHaveBeenCalledTimes(1);
    const [collectionId, parentId, item] = addItem.mock.calls[0];
    expect(collectionId).toBe("c1");
    expect(parentId).toBe("f1");
    expect(item.type).toBe("request");
    expect(item.id).toBe(id);
    expect(item.name).toBe("My call");
    expect(item.address_template).toBe("h:443");
    expect(item.service).toBe("p.v1.S");
    expect(item.method).toBe("GetX");
    expect(item.body_template).toBe('{"id":"1"}');
    expect(item.metadata).toEqual([{ key: "k", value: "v", enabled: true }]);
    expect(item.tls_override).toBe(true);
  });
});

describe("autosaveDraft", () => {
  it("rebuilds content from the draft and updates the origin item", async () => {
    const updateItemContent = vi.fn().mockResolvedValue(undefined);
    await autosaveDraft(updateItemContent, { collectionId: "c1", requestId: "r1" }, draft);
    expect(updateItemContent).toHaveBeenCalledTimes(1);
    const [collectionId, itemId, content] = updateItemContent.mock.calls[0];
    expect(collectionId).toBe("c1");
    expect(itemId).toBe("r1");
    expect(content.id).toBe("r1");
    expect(content.method).toBe("GetX");
    expect(content.body_template).toBe('{"id":"1"}');
  });
});
