import { describe, expect, it } from "vitest";

import { draftFromStored, mintRowId, parseDraft, storedName, type DraftRow } from "./envDraft";
import {
  holdLayout,
  initialView,
  releaseLayout,
  setQuery,
  setSort,
  showAnyway,
  viewRows,
  type ViewSource,
  type VarView,
} from "./varView";

function rowsOf(...keys: string[]): readonly DraftRow[] {
  const env = { name: storedName("t"), color: null, variables: keys.map((k) => [k, ""] as const), index: 0 };
  return draftFromStored(env, 0).draft.rows;
}

function src(
  rows: readonly DraftRow[],
  extra: Partial<ViewSource<DraftRow>> = {},
): ViewSource<DraftRow> {
  return { rows, pending: null, mustShow: new Set(), ...extra };
}

const keysOf = (v: VarView<DraftRow>) => v.entries.map((e) => e.row.key);
const idsOf = (v: VarView<DraftRow>) => v.entries.map((e) => e.row.id);

function rekey(rows: readonly DraftRow[], from: string, to: string): readonly DraftRow[] {
  return rows.map((r) => (r.key === from ? { ...r, key: to } : r));
}

describe("variable view order", () => {
  it("renders keys A to Z by default and never reorders stored rows", () => {
    const rows = rowsOf("gamma", "alpha", "Beta");
    const stored = rows.map((r) => r.key);

    expect(keysOf(viewRows(src(rows), initialView))).toEqual(["alpha", "Beta", "gamma"]);
    expect(rows.map((r) => r.key)).toEqual(stored);
    expect(keysOf(viewRows(src(rows), setSort(initialView, "added-oldest")))).toEqual(stored);
  });

  it("shows Added newest as stored order reversed and Added oldest as stored order", () => {
    const rows = rowsOf("b", "c", "a");

    expect(keysOf(viewRows(src(rows), setSort(initialView, "added-newest")))).toEqual([
      "a",
      "c",
      "b",
    ]);
    expect(keysOf(viewRows(src(rows), setSort(initialView, "added-oldest")))).toEqual([
      "b",
      "c",
      "a",
    ]);
  });
});

describe("layout hold", () => {
  it("keeps rendered rows in place while focus is in the rows, and hidden rows stay hidden", () => {
    const rows = rowsOf("db_host", "api_key", "db_user", "db_port");
    const hiddenId = rows[1].id;
    let view = setQuery(initialView, "db");
    const before = viewRows(src(rows), view);
    expect(keysOf(before)).toEqual(["db_host", "db_port", "db_user"]);

    view = holdLayout(view, src(rows));
    const sortsFirstAndMisses = rekey(rows, "db_user", "aaa");
    const held = viewRows(src(sortsFirstAndMisses), view);
    expect(idsOf(held)).toEqual(idsOf(before));

    const duplicatesHidden = rekey(rows, "db_user", "api_key");
    const flagged = src(duplicatesHidden, { mustShow: new Set([hiddenId, rows[2].id]) });
    expect(idsOf(viewRows(flagged, view))).toEqual(idsOf(before));
  });

  it("keeps the hold through query and sort changes", () => {
    const rows = rowsOf("b", "a", "c");
    let view = holdLayout(initialView, src(rows));
    const before = idsOf(viewRows(src(rows), view));

    view = setSort(setQuery(view, "zzz"), "key-desc");
    expect(idsOf(viewRows(src(rows), view))).toEqual(before);

    view = releaseLayout(view);
    expect(viewRows(src(rows), view).noMatches).toBe(true);
  });

  it("lets the edited key take its sort position once the hold releases", () => {
    const rows = rowsOf("alpha", "beta", "gamma");
    let view = holdLayout(initialView, src(rows));
    const edited = rekey(rows, "gamma", "aardvark");
    expect(keysOf(viewRows(src(edited), view))).toEqual(["alpha", "beta", "aardvark"]);

    view = releaseLayout(view);
    expect(keysOf(viewRows(src(edited), view))).toEqual(["aardvark", "alpha", "beta"]);
  });
});

describe("rows added under a search", () => {
  it("stay visible after their key misses the search, until the search is cleared", () => {
    const rows = rowsOf("db_host", "db_port");
    const { id } = mintRowId(rows.length);
    let view = setQuery(initialView, "db");
    view = holdLayout(view, src(rows));

    const typing = viewRows(src(rows, { pending: { id, key: "API_KEY", value: "" } }), view);
    expect(typing.entries.at(-1)).toMatchObject({ pending: true, row: { id } });

    const added = [...rows, { id, key: "API_KEY", value: "" }];
    view = showAnyway(view, id);
    expect(idsOf(viewRows(src(added), view))).toContain(id);

    view = releaseLayout(view);
    expect(idsOf(viewRows(src(added), view))).toContain(id);

    view = setQuery(view, "db_h");
    expect(keysOf(viewRows(src(added), view))).toEqual(["API_KEY", "db_host"]);

    view = setQuery(setQuery(view, ""), "db");
    expect(idsOf(viewRows(src(added), view))).not.toContain(id);
  });
});

describe("key issues", () => {
  it("marks both rows of a duplicate and an empty committed key, and builds no goal", () => {
    const rows = rowsOf("token", "host", "token", "");
    const parsed = parseDraft({ name: "prod", color: null, rows }, new Set());

    expect(parsed.ok).toBe(false);
    expect("goal" in parsed).toBe(false);
    const issues = parsed.ok ? null : parsed.issues.rows;
    expect(issues?.get(rows[0].id)).toBe("duplicate");
    expect(issues?.get(rows[2].id)).toBe("duplicate");
    expect(issues?.get(rows[3].id)).toBe("empty");
    expect(issues?.has(rows[1].id)).toBe(false);
  });

  it("builds a goal in stored order when every key is unique and non-empty", () => {
    const rows = rowsOf("token", "host");
    const parsed = parseDraft({ name: "prod", color: null, rows }, new Set(["staging"]));

    expect(parsed.ok && parsed.goal.variables).toEqual([
      ["token", ""],
      ["host", ""],
    ]);
  });
});
