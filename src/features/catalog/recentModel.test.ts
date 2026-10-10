import { describe, expect, it } from "vitest";
import type { CollectionIpc, ItemIpc, SavedRequestIpc } from "@/ipc/bindings";
import {
  INITIAL_SWITCHER,
  loadedDraft,
  locationKey,
  paneLocation,
  readKey,
  reduceSwitcher,
  type PaneLocation,
  type SwitcherState,
  type World,
} from "./recentModel";

function req(
  id: string,
  name: string,
  over: Partial<SavedRequestIpc> = {},
): ItemIpc {
  return {
    type: "request",
    id,
    name,
    address_template: "h:443",
    service: "edo.attorney.v1.Letters",
    method: name,
    body_template: "{}",
    metadata: [],
    auth: { kind: "none" },
    tls_override: null,
    last_used_at: null,
    use_count: 0,
    ...over,
  };
}

function col(id: string, name: string, items: ItemIpc[]): CollectionIpc {
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
    created_at: 0,
    expanded: false,
  };
}

const A = req("a", "A");
const B = req("b", "B");
const C = req("c", "C");
const C1 = col("c1", "C1", [A, B, C]);

function world(over: Partial<World> = {}): World {
  return {
    collections: [C1],
    overviewId: null,
    loaded: { kind: "none" },
    dialogOrMenuFocused: false,
    ...over,
  };
}

function visit(
  s: SwitcherState,
  location: PaneLocation,
  w: World = world(),
): SwitcherState {
  return reduceSwitcher(s, { type: "visit", location }, w).state;
}

const tabDown = {
  type: "keydown",
  key: "Tab",
  ctrlKey: true,
  metaKey: false,
  altKey: false,
  shiftKey: false,
} as const;

describe("reduceSwitcher", () => {
  it("commits the previous request on a quick Ctrl+Tab", () => {
    const w = world({ loaded: { kind: "bound", requestId: "b" } });
    let s = INITIAL_SWITCHER;
    s = visit(s, { kind: "request", itemId: "a" }, w);
    s = visit(s, { kind: "request", itemId: "b" }, w);

    const held = reduceSwitcher(s, { type: "tab", back: false }, w);
    expect(held.commit).toBeNull();
    expect(held.state.gesture).toEqual({
      phase: "holding",
      cursor: 1,
      rows: [
        {
          key: "r:b",
          target: { kind: "reveal" },
          title: "B",
          detail: "Letters/B",
          aside: "C1",
        },
        {
          key: "r:a",
          target: { kind: "open", collectionId: "c1", request: A },
          title: "A",
          detail: "Letters/A",
          aside: "C1",
        },
      ],
    });
    expect(reduceSwitcher(held.state, { type: "release" }, w).commit).toEqual({
      kind: "open",
      collectionId: "c1",
      request: A,
    });
  });

  it("commits reveal when Tab wraps back onto the loaded request", () => {
    const w = world({ loaded: { kind: "bound", requestId: "b" } });
    let s = INITIAL_SWITCHER;
    s = visit(s, { kind: "request", itemId: "a" }, w);
    s = visit(s, { kind: "request", itemId: "b" }, w);
    const held = reduceSwitcher(s, { type: "tab", back: false }, w).state;
    const wrapped = reduceSwitcher(held, { type: "tab", back: false }, w);

    expect(wrapped.commit).toBeNull();
    expect(wrapped.state.gesture).toMatchObject({
      phase: "holding",
      cursor: 0,
    });
    expect(
      reduceSwitcher(wrapped.state, { type: "release" }, w).commit,
    ).toEqual({ kind: "reveal" });
  });

  it("lands Shift+Tab from idle on the last row", () => {
    const w = world({ loaded: { kind: "bound", requestId: "c" } });
    let s = INITIAL_SWITCHER;
    s = visit(s, { kind: "request", itemId: "a" }, w);
    s = visit(s, { kind: "request", itemId: "b" }, w);
    s = visit(s, { kind: "request", itemId: "c" }, w);

    const held = reduceSwitcher(s, { type: "tab", back: true }, w);
    expect(held.commit).toBeNull();
    expect(held.state.gesture.phase).toBe("holding");
    if (held.state.gesture.phase !== "holding")
      throw new Error("expected holding");
    expect(held.state.gesture.cursor).toBe(2);
    expect(held.state.gesture.rows[2].target).toEqual({
      kind: "open",
      collectionId: "c1",
      request: A,
    });
  });

  it("does not commit on Escape or on a second Control keyup", () => {
    const w = world({ loaded: { kind: "bound", requestId: "b" } });
    let s = INITIAL_SWITCHER;
    s = visit(s, { kind: "request", itemId: "a" }, w);
    s = visit(s, { kind: "request", itemId: "b" }, w);
    const held = reduceSwitcher(s, { type: "tab", back: false }, w).state;

    const escaped = reduceSwitcher(held, { type: "cancel" }, w);
    expect(escaped.commit).toBeNull();
    expect(escaped.state.gesture).toEqual({ phase: "idle" });
    const afterEscape = reduceSwitcher(escaped.state, { type: "release" }, w);
    expect(afterEscape.commit).toBeNull();
    expect(afterEscape.state).toBe(escaped.state);

    const released = reduceSwitcher(held, { type: "release" }, w);
    expect(released.commit).toEqual({
      kind: "open",
      collectionId: "c1",
      request: A,
    });
    const second = reduceSwitcher(released.state, { type: "release" }, w);
    expect(second.commit).toBeNull();
    expect(second.state).toBe(released.state);
  });

  it("swallows an opening Tab while blocked and stays idle", () => {
    const blocked = world({
      loaded: { kind: "bound", requestId: "b" },
      dialogOrMenuFocused: true,
    });
    let s = INITIAL_SWITCHER;
    s = visit(s, { kind: "request", itemId: "a" }, blocked);
    s = visit(s, { kind: "request", itemId: "b" }, blocked);

    const read = readKey(tabDown, false);
    expect(read).toEqual({
      event: { type: "tab", back: false },
      swallow: true,
    });
    const next = reduceSwitcher(s, { type: "tab", back: false }, blocked);
    expect(next.commit).toBeNull();
    expect(next.state).toBe(s);
    expect(next.state.gesture).toEqual({ phase: "idle" });

    const open = world({ loaded: { kind: "bound", requestId: "b" } });
    const held = reduceSwitcher(s, { type: "tab", back: false }, open);
    expect(held.state.gesture).toMatchObject({ phase: "holding", cursor: 1 });
    const moved = reduceSwitcher(
      held.state,
      { type: "tab", back: false },
      { ...open, dialogOrMenuFocused: true },
    );
    expect(moved.commit).toBeNull();
    expect(moved.state.gesture).toMatchObject({ phase: "holding", cursor: 0 });
  });

  it("resolves a request by item id after its collection changes", () => {
    const saved = req("a", "Alpha");
    const before = world({ collections: [col("c1", "Old", [saved])] });
    const s = visit(INITIAL_SWITCHER, { kind: "request", itemId: "a" }, before);
    const after = world({
      collections: [col("c1", "Old", []), col("c2", "New", [saved])],
      loaded: { kind: "bound", requestId: "someone-else" },
    });

    const held = reduceSwitcher(s, { type: "tab", back: false }, after);
    expect(
      reduceSwitcher(held.state, { type: "release" }, after).commit,
    ).toEqual({
      kind: "open",
      collectionId: "c2",
      request: saved,
    });
  });

  it("resolves an unbound draft under an overview to reveal", () => {
    const w = world({ overviewId: "c1", loaded: { kind: "unbound" } });
    const s = visit(INITIAL_SWITCHER, { kind: "draft" }, w);
    const held = reduceSwitcher(s, { type: "tab", back: false }, w);

    expect(held.state.gesture).toEqual({
      phase: "holding",
      cursor: 0,
      rows: [
        {
          key: "draft",
          target: { kind: "reveal" },
          title: "New request",
          detail: null,
          aside: null,
        },
      ],
    });
    expect(reduceSwitcher(held.state, { type: "release" }, w).commit).toEqual({
      kind: "reveal",
    });
  });

  it("keeps ten locations and leaves state unchanged when the head is visited again", () => {
    let s = INITIAL_SWITCHER;
    const w = world();
    for (let i = 0; i < 12; i++) {
      s = visit(s, { kind: "request", itemId: `id-${i}` }, w);
    }
    expect(s.recent.map(locationKey)).toEqual([
      "r:id-11",
      "r:id-10",
      "r:id-9",
      "r:id-8",
      "r:id-7",
      "r:id-6",
      "r:id-5",
      "r:id-4",
      "r:id-3",
      "r:id-2",
    ]);
    const again = reduceSwitcher(
      s,
      { type: "visit", location: { kind: "request", itemId: "id-11" } },
      w,
    );
    expect(again.commit).toBeNull();
    expect(again.state).toBe(s);
  });

  it("cancels a held chord on a later keydown without committing", () => {
    const w = world({ loaded: { kind: "bound", requestId: "b" } });
    let s = INITIAL_SWITCHER;
    s = visit(s, { kind: "request", itemId: "a" }, w);
    s = visit(s, { kind: "request", itemId: "b" }, w);
    const held = reduceSwitcher(s, { type: "tab", back: false }, w).state;
    const read = readKey(
      {
        type: "keydown",
        key: "k",
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
      },
      true,
    );
    expect(read).toEqual({ event: { type: "cancel" }, swallow: false });
    const cancelled = reduceSwitcher(held, { type: "cancel" }, w);
    expect(cancelled.commit).toBeNull();
    expect(cancelled.state.gesture).toEqual({ phase: "idle" });
  });
});

describe("readKey", () => {
  const plain = {
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
  };

  it("reads Ctrl+Tab as a swallowed forward tab and Shift as back", () => {
    expect(readKey(tabDown, false)).toEqual({
      event: { type: "tab", back: false },
      swallow: true,
    });
    expect(readKey({ ...tabDown, shiftKey: true }, true)).toEqual({
      event: { type: "tab", back: true },
      swallow: true,
    });
  });

  it("ignores Cmd+Tab and Ctrl+Alt+Tab", () => {
    expect(
      readKey({ ...tabDown, ctrlKey: false, metaKey: true }, false),
    ).toBeNull();
    expect(readKey({ ...tabDown, altKey: true }, false)).toBeNull();
    expect(readKey({ ...tabDown, altKey: true }, true)).toEqual({
      event: { type: "cancel" },
      swallow: false,
    });
  });

  it("releases only on Control keyup while holding, and passes that keyup through", () => {
    const up = { type: "keyup", key: "Control", ...plain, ctrlKey: false };
    expect(readKey(up, true)).toEqual({
      event: { type: "release" },
      swallow: false,
    });
    expect(readKey(up, false)).toBeNull();
  });

  it("swallows Escape only while holding", () => {
    const escape = { type: "keydown", key: "Escape", ...plain };
    expect(readKey(escape, true)).toEqual({
      event: { type: "cancel" },
      swallow: true,
    });
    expect(readKey(escape, false)).toBeNull();
  });

  it("ignores Control and Shift keydowns while holding", () => {
    expect(
      readKey(
        { type: "keydown", key: "Control", ...plain, ctrlKey: true },
        true,
      ),
    ).toBeNull();
    expect(
      readKey(
        { type: "keydown", key: "Shift", ...plain, shiftKey: true },
        true,
      ),
    ).toBeNull();
    expect(readKey({ type: "keyup", key: "Shift", ...plain }, true)).toBeNull();
  });
});

describe("paneLocation", () => {
  it("prefers the overview, then the unbound draft, then the bound request", () => {
    expect(
      paneLocation({
        overviewId: "c1",
        loaded: { kind: "bound", requestId: "a" },
      }),
    ).toEqual({
      kind: "overview",
      collectionId: "c1",
    });
    expect(
      paneLocation({ overviewId: null, loaded: { kind: "none" } }),
    ).toBeNull();
    expect(
      paneLocation({ overviewId: null, loaded: { kind: "unbound" } }),
    ).toEqual({ kind: "draft" });
    expect(
      paneLocation({
        overviewId: null,
        loaded: { kind: "bound", requestId: "a" },
      }),
    ).toEqual({
      kind: "request",
      itemId: "a",
    });
  });

  it("reads the loaded draft from the workflow draft and its origin", () => {
    expect(loadedDraft({ draft: null, draftOrigin: null })).toEqual({
      kind: "none",
    });
    expect(
      loadedDraft({ draft: { id: "step" } as never, draftOrigin: null }),
    ).toEqual({ kind: "unbound" });
    expect(
      loadedDraft({
        draft: { id: "step" } as never,
        draftOrigin: { collectionId: "c1", requestId: "a" },
      }),
    ).toEqual({ kind: "bound", requestId: "a" });
  });
});
