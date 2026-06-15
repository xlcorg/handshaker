import { describe, it, expect } from "vitest";
import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";
import { planQuickAdd } from "./quickAdd";

const req = (id: string, service: string, method: string, address: string): ItemIpc => ({
  type: "request",
  id,
  name: method,
  address_template: address,
  service,
  method,
  body_template: "{}",
  metadata: [],
  auth: { kind: "none" },
  tls_override: false,
  last_used_at: null,
  use_count: 0,
});

const col = (id: string, name: string, items: ItemIpc[] = []): CollectionIpc => ({
  id,
  name,
  items,
  variables: {},
  auth: { kind: "none" },
  default_tls: false,
  skip_tls_verify: false,
  pinned: false,
  description: null,
  created_at: 0,
  expanded: false,
});

const folder = (id: string, name: string, items: ItemIpc[] = []): ItemIpc => ({
  type: "folder",
  id,
  name,
  items,
  expanded: false,
});

describe("planQuickAdd", () => {
  it("dedupes: same service+method+address already saved → exists", () => {
    const tree = [col("c1", "Main", [folder("f1", "Notes", [req("r1", "n.NotesService", "Get", "h:1")])])];
    const plan = planQuickAdd(tree, "n.NotesService", "Get", "h:1");
    expect(plan).toEqual({
      kind: "exists",
      location: expect.objectContaining({ collectionId: "c1", requestId: "r1" }),
    });
  });

  it("different address is NOT a dupe", () => {
    const tree = [col("c1", "Main", [req("r1", "n.NotesService", "Get", "h:1")])];
    expect(planQuickAdd(tree, "n.NotesService", "Get", "h:2").kind).toBe("create");
  });

  it("no collections → create with null ids and default names", () => {
    expect(planQuickAdd([], "n.NotesService", "Get", "h:1")).toEqual({
      kind: "create",
      collectionId: null,
      collectionName: "My Collection",
      folderId: null,
      folderName: "Notes",
      requestName: "Get",
    });
  });

  it("reuses an existing root folder named after the service", () => {
    const tree = [col("c1", "Main", [folder("f1", "Notes")])];
    const plan = planQuickAdd(tree, "n.NotesService", "Get", "h:1");
    expect(plan).toEqual({
      kind: "create",
      collectionId: "c1",
      collectionName: "Main",
      folderId: "f1",
      folderName: "Notes",
      requestName: "Get",
    });
  });

  it("targets the first collection; missing folder → folderId null", () => {
    const tree = [col("c1", "Main"), col("c2", "Other")];
    const plan = planQuickAdd(tree, "n.NotesService", "Get", "h:1");
    expect(plan).toMatchObject({ kind: "create", collectionId: "c1", folderId: null });
  });

  it("targets the preferred (origin) collection, not the first one", () => {
    const tree = [col("c1", "Main"), col("c2", "Other")];
    const plan = planQuickAdd(tree, "n.NotesService", "Get", "h:1", "c2");
    expect(plan).toMatchObject({ kind: "create", collectionId: "c2", collectionName: "Other" });
  });

  it("reuses a root folder inside the preferred collection", () => {
    const tree = [
      col("c1", "Main", [folder("f1", "Notes")]),
      col("c2", "Other", [folder("f2", "Notes")]),
    ];
    const plan = planQuickAdd(tree, "n.NotesService", "Get", "h:1", "c2");
    expect(plan).toMatchObject({ kind: "create", collectionId: "c2", folderId: "f2" });
  });

  it("unknown preferred collection id → falls back to the first collection", () => {
    const tree = [col("c1", "Main"), col("c2", "Other")];
    const plan = planQuickAdd(tree, "n.NotesService", "Get", "h:1", "missing");
    expect(plan).toMatchObject({ kind: "create", collectionId: "c1" });
  });

  it("null preferred id (new unbound draft) → first collection", () => {
    const tree = [col("c1", "Main"), col("c2", "Other")];
    const plan = planQuickAdd(tree, "n.NotesService", "Get", "h:1", null);
    expect(plan).toMatchObject({ kind: "create", collectionId: "c1" });
  });
});
