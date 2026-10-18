import { describe, expect, it } from "vitest";

import {
  draftFromStored,
  mintRowId,
  parseDraft,
  storedName,
  type DraftRow,
} from "./envDraft";
import {
  DEFAULT_SORT,
  SORT_MODES,
  holdLayout,
  initialView,
  nameSortIndicator,
  neighborIn,
  releaseLayout,
  setQuery,
  showAnyway,
  toggleNameSort,
  viewRows,
  type SortMode,
  type ViewSource,
  type VarView,
} from "./varView";

function rowsOf(...keys: string[]): readonly DraftRow[] {
  const env = {
    name: storedName("t"),
    color: null,
    variables: keys.map((k) => [k, ""] as const),
    index: 0,
  };
  return draftFromStored(env, 0).draft.rows;
}

function src(
  rows: readonly DraftRow[],
  extra: Partial<ViewSource<DraftRow>> = {},
): ViewSource<DraftRow> {
  return { rows, draft: null, mustShow: new Set(), ...extra };
}

const keysOf = (v: VarView<DraftRow>) => v.entries.map((e) => e.row.key);
const idsOf = (v: VarView<DraftRow>) => v.entries.map((e) => e.row.id);

function rekey(
  rows: readonly DraftRow[],
  from: string,
  to: string,
): readonly DraftRow[] {
  return rows.map((r) => (r.key === from ? { ...r, key: to } : r));
}

describe("variable view order", () => {
  it("shows stored order by default and never reorders stored rows", () => {
    const rows = rowsOf("gamma", "alpha", "Beta");
    const stored = rows.map((r) => r.key);

    expect(DEFAULT_SORT).toBe("oldest");
    expect(keysOf(viewRows(src(rows), initialView, DEFAULT_SORT))).toEqual(
      stored,
    );
    expect(keysOf(viewRows(src(rows), initialView, "name-asc"))).toEqual([
      "alpha",
      "Beta",
      "gamma",
    ]);
    expect(rows.map((r) => r.key)).toEqual(stored);
  });

  it("shows Newest first as stored order reversed and Name Z–A as reversed names", () => {
    const rows = rowsOf("b", "c", "a");

    expect(keysOf(viewRows(src(rows), initialView, "newest"))).toEqual([
      "a",
      "c",
      "b",
    ]);
    expect(keysOf(viewRows(src(rows), initialView, "name-desc"))).toEqual([
      "c",
      "b",
      "a",
    ]);
  });

  it("keeps stored order between keys that compare equal", () => {
    const rows = rowsOf("Host", "host", "HOST");
    const ids = rows.map((r) => r.id);

    expect(idsOf(viewRows(src(rows), initialView, "name-asc"))).toEqual(ids);
    expect(idsOf(viewRows(src(rows), initialView, "name-desc"))).toEqual(ids);
  });
});

describe("name sort header", () => {
  it("turns a time sort into Name A–Z, then flips between A–Z and Z–A", () => {
    expect(toggleNameSort("oldest")).toBe("name-asc");
    expect(toggleNameSort("newest")).toBe("name-asc");
    expect(toggleNameSort("name-asc")).toBe("name-desc");
    expect(toggleNameSort("name-desc")).toBe("name-asc");
  });

  it("shows an arrow and an aria-sort only under a name sort", () => {
    expect(nameSortIndicator("name-asc")).toEqual({
      arrow: "up",
      ariaSort: "ascending",
    });
    expect(nameSortIndicator("name-desc")).toEqual({
      arrow: "down",
      ariaSort: "descending",
    });
    expect(nameSortIndicator("oldest")).toEqual({
      arrow: null,
      ariaSort: "none",
    });
    expect(nameSortIndicator("newest")).toEqual({
      arrow: null,
      ariaSort: "none",
    });
  });
});

describe("add draft", () => {
  it("is the last entry under every sort, after the stored rows", () => {
    const rows = rowsOf("b", "a");
    const { id } = mintRowId(rows.length);
    const draft = { id, key: "", value: "" };
    for (const sort of SORT_MODES) {
      const v = viewRows(src(rows, { draft }), initialView, sort);
      expect(v.entries.at(-1)).toMatchObject({ draft: true, row: { id } });
      expect(v.entries.filter((e) => e.draft)).toHaveLength(1);
      expect(v.total).toBe(2);
    }
  });
});

describe("layout hold", () => {
  it("keeps rendered rows in place while focus is in the rows, and hidden rows stay hidden", () => {
    const rows = rowsOf("db_host", "api_key", "db_user", "db_port");
    const hiddenId = rows[1].id;
    let view = setQuery(initialView, "db");
    const before = viewRows(src(rows), view, "name-asc");
    expect(keysOf(before)).toEqual(["db_host", "db_port", "db_user"]);

    view = holdLayout(view, src(rows), "name-asc");
    const sortsFirstAndMisses = rekey(rows, "db_user", "aaa");
    const held = viewRows(src(sortsFirstAndMisses), view, "name-asc");
    expect(idsOf(held)).toEqual(idsOf(before));

    const duplicatesHidden = rekey(rows, "db_user", "api_key");
    const flagged = src(duplicatesHidden, {
      mustShow: new Set([hiddenId, rows[2].id]),
    });
    expect(idsOf(viewRows(flagged, view, "name-asc"))).toEqual(idsOf(before));
  });

  it("keeps the hold through query changes until it is released", () => {
    const rows = rowsOf("b", "a", "c");
    let view = holdLayout(initialView, src(rows), "name-asc");
    const before = idsOf(viewRows(src(rows), view, "name-asc"));

    view = setQuery(view, "zzz");
    expect(idsOf(viewRows(src(rows), view, "name-asc"))).toEqual(before);

    view = releaseLayout(view);
    expect(viewRows(src(rows), view, "name-asc").noMatches).toBe(true);
  });

  it("gives way to a different sort, and a new hold is captured under that sort", () => {
    const rows = rowsOf("b", "a", "c");
    let view = holdLayout(initialView, src(rows), "name-asc");
    const edited = rekey(rows, "c", "0");

    expect(keysOf(viewRows(src(edited), view, "name-asc"))).toEqual([
      "a",
      "b",
      "0",
    ]);
    expect(keysOf(viewRows(src(edited), view, "name-desc"))).toEqual([
      "b",
      "a",
      "0",
    ]);

    view = holdLayout(view, src(edited), "name-desc");
    expect(view.hold?.sort).toBe("name-desc");
    const renamed = rekey(edited, "a", "zz");
    expect(keysOf(viewRows(src(renamed), view, "name-desc"))).toEqual([
      "b",
      "zz",
      "0",
    ]);
  });

  it("lets the edited key take its sort position once the hold releases", () => {
    const rows = rowsOf("alpha", "beta", "gamma");
    let view = holdLayout(initialView, src(rows), "name-asc");
    const edited = rekey(rows, "gamma", "aardvark");
    expect(keysOf(viewRows(src(edited), view, "name-asc"))).toEqual([
      "alpha",
      "beta",
      "aardvark",
    ]);

    view = releaseLayout(view);
    expect(keysOf(viewRows(src(edited), view, "name-asc"))).toEqual([
      "aardvark",
      "alpha",
      "beta",
    ]);
  });
});

describe("rows added under a search", () => {
  it("stay visible after their key misses the search, until the search is cleared", () => {
    const rows = rowsOf("db_host", "db_port");
    const { id } = mintRowId(rows.length);
    const sort: SortMode = "name-asc";
    let view = setQuery(initialView, "db");
    view = holdLayout(view, src(rows), sort);

    const typing = viewRows(
      src(rows, { draft: { id, key: "API_KEY", value: "" } }),
      view,
      sort,
    );
    expect(typing.entries.at(-1)).toMatchObject({ draft: true, row: { id } });

    const added = [...rows, { id, key: "API_KEY", value: "" }];
    view = showAnyway(view, id);
    expect(idsOf(viewRows(src(added), view, sort))).toContain(id);

    view = releaseLayout(view);
    expect(idsOf(viewRows(src(added), view, sort))).toContain(id);

    view = setQuery(view, "db_h");
    expect(keysOf(viewRows(src(added), view, sort))).toEqual([
      "API_KEY",
      "db_host",
    ]);

    view = setQuery(setQuery(view, ""), "db");
    expect(idsOf(viewRows(src(added), view, sort))).not.toContain(id);
  });
});

describe("neighborIn", () => {
  it("picks the next item, else the previous, else nothing", () => {
    expect(neighborIn(["a", "b", "c"], "b")).toBe("c");
    expect(neighborIn(["a", "b", "c"], "c")).toBe("b");
    expect(neighborIn(["a"], "a")).toBeNull();
    expect(neighborIn(["a"], "z")).toBeNull();
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
    const parsed = parseDraft(
      { name: "prod", color: null, rows },
      new Set(["staging"]),
    );

    expect(parsed.ok && parsed.goal.variables).toEqual([
      ["token", ""],
      ["host", ""],
    ]);
  });
});
