import { afterEach, describe, expect, it, vi } from "vitest";
import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";
import { newId } from "@/lib/ids";
import { defaultPickTarget, pickerTree } from "./savePicker";

function col(
  id: string,
  name: string,
  items: CollectionIpc["items"] = [],
  created_at = 0,
): CollectionIpc {
  return {
    id,
    name,
    items,
    variables: {},
    auth: { kind: "none" },
    default_tls: false,
    skip_tls_verify: false,
    pinned: false,
    description: null,
    created_at,
    expanded: false,
  };
}

function folder(id: string, name: string, items: ItemIpc[] = []): ItemIpc {
  return { type: "folder", id, name, items, expanded: false };
}

function folderAt(ms: number, name: string, items: ItemIpc[] = []): ItemIpc {
  vi.setSystemTime(ms);
  return folder(newId(), name, items);
}

function requestAt(ms: number, name: string): ItemIpc {
  vi.setSystemTime(ms);
  return {
    type: "request",
    id: newId(),
    name,
    template: {
      protocol: "grpc",
      address_template: "h:443",
      service: "p.v1.S",
      method: "M",
      body_template: "{}",
      metadata: [],
      auth: { kind: "none" },
      tls_override: null,
    },
    last_used_at: null,
    use_count: 0,
  };
}

function root(collection: CollectionIpc) {
  return { collectionId: collection.id, parentId: null };
}

function names(items: ItemIpc[]): string[] {
  return items.map((item) => item.name);
}

describe("pickerTree", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the tree unchanged when there is nothing pending", () => {
    const tree = [col("c1", "My APIs")];
    expect(pickerTree(tree, [], [])).toEqual(tree);
  });

  it("appends pending collections as empty collections", () => {
    const out = pickerTree(
      [col("c1", "My APIs")],
      [{ tempId: "t1", name: "Sandbox" }],
      [],
    );
    expect(out.map((c) => c.name)).toEqual(["My APIs", "Sandbox"]);
    expect(out[1]).toMatchObject({ id: "t1", name: "Sandbox", items: [] });
  });

  it("inserts a pending folder at the collection root", () => {
    const out = pickerTree(
      [col("c1", "My APIs")],
      [],
      [{ tempId: "f1", collectionId: "c1", parentId: null, name: "NotesApi" }],
    );
    expect(out[0].items).toEqual([
      {
        type: "folder",
        id: "f1",
        name: "NotesApi",
        items: [],
        expanded: false,
      },
    ]);
  });

  it("inserts a pending folder inside a pending collection", () => {
    const out = pickerTree(
      [],
      [{ tempId: "t1", name: "New" }],
      [{ tempId: "f1", collectionId: "t1", parentId: null, name: "NotesApi" }],
    );
    expect(out[0].items).toEqual([
      {
        type: "folder",
        id: "f1",
        name: "NotesApi",
        items: [],
        expanded: false,
      },
    ]);
  });

  it("nests a pending folder under an earlier pending folder", () => {
    const out = pickerTree(
      [col("c1", "My APIs")],
      [],
      [
        { tempId: "f1", collectionId: "c1", parentId: null, name: "Outer" },
        { tempId: "f2", collectionId: "c1", parentId: "f1", name: "Inner" },
      ],
    );
    const outer = out[0].items[0];
    expect(outer).toMatchObject({ id: "f1", name: "Outer" });
    if (outer.type !== "folder")
      throw new Error("expected outer to be a folder");
    expect(outer.items).toEqual([
      { type: "folder", id: "f2", name: "Inner", items: [], expanded: false },
    ]);
  });

  it("lists folders newest first at every level", () => {
    vi.useFakeTimers();
    const childT1 = folderAt(1_000, "c-t1");
    const childT3 = folderAt(3_000, "c-t3");
    const childT2 = folderAt(2_000, "c-t2");
    const rootT1 = folderAt(11_000, "t1");
    const rootT3 = folderAt(13_000, "t3", [childT1, childT3, childT2]);
    const rootT2 = folderAt(12_000, "t2");
    const out = pickerTree([col("c1", "C", [rootT1, rootT3, rootT2])], [], []);
    expect(names(out[0].items)).toEqual(["t3", "t2", "t1"]);
    const parent = out[0].items[0];
    if (parent.type !== "folder") throw new Error("expected t3 to be a folder");
    expect(names(parent.items)).toEqual(["c-t3", "c-t2", "c-t1"]);
  });

  it("lists non-v7 ids after v7 ids, in their original order", () => {
    vi.useFakeTimers();
    const v7 = folderAt(1_000, "v7");
    const out = pickerTree(
      [
        col("c1", "C", [
          folder("legacy-a", "legacy-a"),
          v7,
          folder("legacy-b", "legacy-b"),
        ]),
      ],
      [],
      [],
    );
    expect(names(out[0].items)).toEqual(["v7", "legacy-a", "legacy-b"]);
  });

  it("orders a request with the same newest-first rule", () => {
    vi.useFakeTimers();
    const older = folderAt(1_000, "Older");
    const newer = requestAt(2_000, "Newer");
    const out = pickerTree([col("c1", "C", [older, newer])], [], []);
    expect(names(out[0].items)).toEqual(["Newer", "Older"]);
  });

  it("puts a pending folder minted later first among its siblings", () => {
    vi.useFakeTimers();
    const older = folderAt(1_000, "Older");
    const newer = folderAt(2_000, "Newer");
    vi.setSystemTime(3_000);
    const pendingId = newId();
    const out = pickerTree(
      [col("c1", "C", [older, newer])],
      [],
      [
        {
          tempId: pendingId,
          collectionId: "c1",
          parentId: null,
          name: "Pending",
        },
      ],
    );
    expect(names(out[0].items)).toEqual(["Pending", "Newer", "Older"]);
  });

  it("puts the later sibling first when two v7 ids share a millisecond", () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000);
    const earlier = folder(newId(), "Earlier");
    const later = folder(newId(), "Later");
    const out = pickerTree([col("c1", "C", [earlier, later])], [], []);
    expect(names(out[0].items)).toEqual(["Later", "Earlier"]);
  });

  it("keeps collection order and leaves the input unchanged", () => {
    vi.useFakeTimers();
    const older = folderAt(1_000, "Older");
    const newer = folderAt(2_000, "Newer");
    const input = [col("c-b", "B", [older, newer]), col("c-a", "A")];
    const snapshot = structuredClone(input);
    const out = pickerTree(input, [{ tempId: "t-new", name: "New" }], []);
    expect(out.map((c) => c.id)).toEqual(["c-b", "c-a", "t-new"]);
    expect(names(out[0].items)).toEqual(["Newer", "Older"]);
    expect(input).toEqual(snapshot);
  });
});

describe("defaultPickTarget", () => {
  const billing = col("billing", "billing-api");
  const edoWeb = col("edo-web", "edo-web");
  const edoApi = col("edo-api", "edo-api");

  it("selects the collection named after the leading host tokens", () => {
    expect(
      defaultPickTarget([billing, edoWeb, edoApi], "edo.api.stg.ru:82"),
    ).toEqual(root(edoApi));
  });

  it("reads the host out of an HTTP URL template", () => {
    expect(
      defaultPickTarget(
        [billing, edoApi],
        "https://edo.api.staging.ru:8443/v1/docs?x=1#top",
      ),
    ).toEqual(root(edoApi));
  });

  it("accepts the scheme, userinfo, and dns forms of a gRPC address", () => {
    expect(
      defaultPickTarget([billing, edoApi], "http://edo-api:50051"),
    ).toEqual(root(edoApi));
    expect(
      defaultPickTarget([billing, edoApi], "dns:///edo.api.ru:443"),
    ).toEqual(root(edoApi));
    expect(
      defaultPickTarget(
        [billing, edoApi],
        "https://user:pass@edo.api.ru:443/v1",
      ),
    ).toEqual(root(edoApi));
  });

  it("treats '.', '-', '_', and spaces as one separator and ignores case", () => {
    const underscored = col("u", "EDO_Api");
    const spaced = col("s", "Edo API");
    expect(defaultPickTarget([billing, underscored], "edo-api.dev.ru")).toEqual(
      root(underscored),
    );
    expect(defaultPickTarget([billing, spaced], "edo.api.ru")).toEqual(
      root(spaced),
    );
  });

  it("drops env words on both sides", () => {
    const perEnv = col("e", "edo-api-stg");
    expect(defaultPickTarget([billing, perEnv], "edo.api.prod.ru")).toEqual(
      root(perEnv),
    );
  });

  it("prefers the longest match in any input order", () => {
    const edo = col("edo", "edo");
    expect(defaultPickTarget([edo, edoApi], "edo.api.ru")).toEqual(
      root(edoApi),
    );
    expect(defaultPickTarget([edoApi, edo], "edo.api.ru")).toEqual(
      root(edoApi),
    );
  });

  it("keeps the first collection when no name matches", () => {
    expect(defaultPickTarget([billing, edoWeb], "edo.api.stg.ru:82")).toEqual(
      root(billing),
    );
    expect(defaultPickTarget([edoWeb, billing], "edo.api.stg.ru:82")).toEqual(
      root(edoWeb),
    );
  });

  it("breaks ties by newest created_at, then by greater id", () => {
    const older = col("old", "edo-api", [], 1);
    const newer = col("new", "Edo API", [], 2);
    expect(defaultPickTarget([older, newer], "edo.api.ru")).toEqual(
      root(newer),
    );
    expect(defaultPickTarget([newer, older], "edo.api.ru")).toEqual(
      root(newer),
    );

    const low = col("a", "edo-api", [], 5);
    const high = col("b", "edo-api", [], 5);
    expect(defaultPickTarget([low, high], "edo.api.ru")).toEqual(root(high));
    expect(defaultPickTarget([high, low], "edo.api.ru")).toEqual(root(high));
  });

  it("never matches a {{var}} and treats it as a separator", () => {
    const host = col("host", "host");
    expect(defaultPickTarget([billing, host], "{{host}}:443")).toEqual(
      root(billing),
    );
    expect(
      defaultPickTarget([billing, host, edoApi], "{{env}}.edo.api.ru"),
    ).toEqual(root(edoApi));
    expect(
      defaultPickTarget([billing, edoApi], "https://{{a/b}}.edo.api.ru/v1"),
    ).toEqual(root(edoApi));
  });

  it("never matches a name made only of env words", () => {
    const local = col("local", "Local");
    expect(defaultPickTarget([billing, local], "localhost:50051")).toEqual(
      root(billing),
    );
  });

  it("returns null when there are no collections", () => {
    expect(defaultPickTarget([], "edo.api.stg.ru:82")).toBeNull();
  });
});
