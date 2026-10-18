import { describe, expect, it } from "vitest";

import {
  colorKey,
  storedName,
  type EnvSummary,
  type OpenEnv,
} from "./envDraft";
import {
  editorStep,
  escapeIntent,
  fieldAttr,
  initEditor,
  resumeEditor,
  selectView,
  settleStep,
  type CellRef,
  type EditorEffect,
  type EditorState,
  type PaneAction,
} from "./envEditor";
import { queueStatus, type Rev } from "./saveQueue";
import type { SortMode } from "./varView";

const prod: OpenEnv = {
  name: storedName("prod"),
  color: null,
  variables: [
    ["host", "api:443"],
    ["port", "443"],
  ],
  index: 0,
};
const envs: EnvSummary[] = [
  { name: storedName("prod") },
  { name: storedName("stage") },
];
const sort: SortMode = "oldest";
const ctx = { sort };
const hidden = { kind: "hidden" } as const;

function run(state: EditorState, ...actions: PaneAction[]) {
  const effects: EditorEffect[] = [];
  for (const action of actions) {
    const step = editorStep(state, action, ctx);
    state = step.state;
    effects.push(...step.effects);
  }
  return { state, effects };
}

function view(state: EditorState) {
  return selectView(state, { sort, status: hidden });
}

function idOf(state: EditorState, key: string) {
  const row = view(state).table.rows.find((r) => r.key.text === key);
  if (!row) throw new Error(`no row ${key}`);
  return row.id;
}

function cell(state: EditorState, kind: CellRef["kind"], key: string): CellRef {
  return { kind, rowId: idOf(state, key) };
}

function syncs(effects: readonly EditorEffect[]) {
  return effects.flatMap((e) => (e.type === "sync" ? [e] : []));
}

function leaves(effects: readonly EditorEffect[]) {
  return effects.filter((e) => e.type === "leave");
}

function focuses(effects: readonly EditorEffect[]) {
  return effects.flatMap((e) => (e.type === "focus" ? [e.target] : []));
}

function edit(target: CellRef, text: string): PaneAction[] {
  return [
    { type: "openCell", cell: target },
    { type: "typeCell", cell: target, text },
  ];
}

const done: PaneAction = { type: "leave", target: { to: "close" } };
const ok = { ok: true, activated: null, index: 0 } as const;
const closed = {
  type: "leave",
  outcome: { kind: "closed" },
  cleanup: null,
} as const;

describe("compact cells", () => {
  it("opens one cell at a time, and opening another applies the first", () => {
    const start = initEditor(prod, envs);
    const host = cell(start, "value", "host");
    const port = cell(start, "value", "port");
    const opened = run(start, ...edit(host, "api:8443"));
    const rows = view(opened.state).table.rows;
    expect(rows[0].value).toEqual({ mode: "edit", text: "api:8443" });
    expect(rows[1].value.mode).toBe("display");
    expect(rows[0].key.mode).toBe("display");

    const moved = run(opened.state, { type: "openCell", cell: port });
    expect(syncs(moved.effects).map((e) => e.goal.variables)).toEqual([
      [
        ["host", "api:8443"],
        ["port", "443"],
      ],
    ]);
    expect(view(moved.state).table.rows.map((r) => r.value.mode)).toEqual([
      "display",
      "edit",
    ]);
    expect(focuses(moved.effects)).toEqual([port]);
  });

  it("does not stage a save while a value is typed, and Enter sends it once", () => {
    const start = initEditor(prod, envs);
    const port = cell(start, "value", "port");
    const typed = run(
      start,
      { type: "openCell", cell: port },
      { type: "typeCell", cell: port, text: "8" },
      { type: "typeCell", cell: port, text: "84" },
      { type: "typeCell", cell: port, text: "8443" },
    );
    expect(syncs(typed.effects)).toEqual([]);
    expect(typed.state.save).toBe(start.save);

    const entered = run(typed.state, {
      type: "commitCell",
      cell: port,
      via: "enter",
    });
    expect(syncs(entered.effects).map((e) => e.goal.variables)).toEqual([
      [
        ["host", "api:443"],
        ["port", "8443"],
      ],
    ]);
    expect(focuses(entered.effects)).toEqual([port]);
    expect(view(entered.state).table.rows[1].value).toEqual({
      mode: "display",
      text: "8443",
      match: null,
    });
  });

  it("applies a valid edit on blur without moving focus", () => {
    const start = initEditor(prod, envs);
    const host = cell(start, "key", "host");
    const { effects } = run(start, ...edit(host, "hostname"), {
      type: "commitCell",
      cell: host,
      via: "blur",
    });
    expect(syncs(effects).map((e) => e.goal.variables[0])).toEqual([
      ["hostname", "api:443"],
    ]);
    expect(focuses(effects)).toEqual([host]);
  });

  it("saves an empty value", () => {
    const start = initEditor(prod, envs);
    const port = cell(start, "value", "port");
    const { effects } = run(start, ...edit(port, ""), {
      type: "commitCell",
      cell: port,
      via: "enter",
    });
    expect(syncs(effects).map((e) => e.goal.variables[1])).toEqual([
      ["port", ""],
    ]);
  });

  it("cancels a cell back to its stored text and writes nothing", () => {
    const start = initEditor(prod, envs);
    const port = cell(start, "value", "port");
    const { state, effects } = run(start, ...edit(port, "9999"), {
      type: "cancelField",
    });
    expect(syncs(effects)).toEqual([]);
    expect(view(state).table.rows[1].value).toEqual({
      mode: "display",
      text: "443",
      match: null,
    });
    expect(focuses(effects).at(-1)).toEqual(port);
  });

  it("commits an empty or duplicate key flagged, and writes nothing", () => {
    const start = initEditor(prod, envs);
    for (const text of ["", "port"]) {
      const host = cell(start, "key", "host");
      const { state, effects } = run(start, ...edit(host, text), {
        type: "commitCell",
        cell: host,
        via: "blur",
      });
      expect(syncs(effects)).toEqual([]);
      expect(queueStatus(state.save).kind).toBe("invalid");
      expect(view(state).table.rows[0].issue).toBe(
        text === "" ? "empty" : "duplicate",
      );
    }
  });
});

describe("Escape routing", () => {
  it("cancels the focused open cell", () => {
    const start = initEditor(prod, envs);
    const port = cell(start, "value", "port");
    const { state } = run(start, ...edit(port, "1"));
    expect(escapeIntent(state, fieldAttr(port))).toEqual({
      type: "cancelField",
    });
  });

  it("lets the dialog close when no field is open", () => {
    const start = initEditor(prod, envs);
    expect(escapeIntent(start, fieldAttr({ kind: "search" }))).toBeNull();
    expect(
      escapeIntent(start, fieldAttr(cell(start, "value", "port"))),
    ).toBeNull();
    expect(escapeIntent(start, null)).toBeNull();
  });

  it("cancels the add row while focus is in it", () => {
    const { state, effects } = run(initEditor(prod, envs), { type: "addRow" });
    const [key] = focuses(effects);
    expect(escapeIntent(state, fieldAttr(key))).toEqual({
      type: "cancelDraft",
    });
  });

  it("cancels an open rename, but not the name of a new environment", () => {
    const renaming = run(initEditor(prod, envs), { type: "openName" }).state;
    expect(escapeIntent(renaming, fieldAttr({ kind: "name" }))).toEqual({
      type: "cancelField",
    });
    expect(
      escapeIntent(initEditor(null, envs), fieldAttr({ kind: "name" })),
    ).toBeNull();
  });
});

describe("add variable row", () => {
  it("keeps the empty row id stable across keystrokes", () => {
    const opened = run(initEditor(prod, envs), { type: "addRow" });
    const id = opened.state.adding?.id;
    expect(id).toBeTruthy();
    const typed = run(
      opened.state,
      { type: "typeDraft", part: "key", text: "T" },
      { type: "typeDraft", part: "key", text: "TO" },
      { type: "typeDraft", part: "value", text: "1" },
    );
    expect(typed.state.adding?.id).toBe(id);
    expect(typed.state.adding).toMatchObject({ key: "TO", value: "1" });
  });

  it("stays out of the variables until a non-empty key commits", () => {
    const start = initEditor(prod, envs);
    const added = run(
      start,
      { type: "addRow" },
      { type: "typeDraft", part: "value", text: "v" },
    );
    const v = view(added.state);
    expect(v.table.draft).toMatchObject({ key: "", value: "v" });
    expect(v.table.rows).toHaveLength(2);
    expect(v.variableCount).toBe(2);
    expect(focuses(added.effects)).toEqual([
      { kind: "key", rowId: v.table.draft?.id },
    ]);

    const empty = run(added.state, { type: "commitDraft" });
    expect(syncs(empty.effects)).toEqual([]);
    expect(view(empty.state).table.draft).toBeNull();
    expect(empty.state.draft).toBe(start.draft);
  });

  it("commits a keyed row once, at the end of stored order", () => {
    const start = initEditor(prod, envs);
    const { state, effects } = run(
      start,
      { type: "addRow" },
      { type: "typeDraft", part: "key", text: "TOKEN" },
      { type: "typeDraft", part: "value", text: "abc" },
    );
    expect(syncs(effects)).toEqual([]);
    const committed = run(state, { type: "commitDraft" });
    expect(syncs(committed.effects).map((e) => e.goal.variables)).toEqual([
      [
        ["host", "api:443"],
        ["port", "443"],
        ["TOKEN", "abc"],
      ],
    ]);
    expect(focuses(committed.effects)).toEqual([{ kind: "add" }]);
    expect(view(committed.state).table.draft).toBeNull();
  });

  it("cancels without writing", () => {
    const { state, effects } = run(
      initEditor(prod, envs),
      { type: "addRow" },
      { type: "typeDraft", part: "key", text: "TOKEN" },
      { type: "cancelDraft" },
    );
    expect(syncs(effects)).toEqual([]);
    expect(view(state).table.draft).toBeNull();
  });

  it("flags a draft key that duplicates a stored one and keeps it open on commit", () => {
    const { state } = run(
      initEditor(prod, envs),
      { type: "addRow" },
      { type: "typeDraft", part: "key", text: "host" },
    );
    const v = view(state);
    expect(v.table.draft?.issue).toBe("duplicate");
    expect(v.table.rows[0].issue).toBe("duplicate");

    const refused = run(state, { type: "commitDraft" });
    expect(syncs(refused.effects)).toEqual([]);
    expect(view(refused.state).table.draft).toMatchObject({
      key: "host",
      issue: "duplicate",
    });
    expect(focuses(refused.effects)).toEqual([
      { kind: "key", rowId: v.table.draft?.id },
    ]);
  });
});

describe("rename", () => {
  it("keeps a taken name open with its issue and writes nothing", () => {
    const start = initEditor(prod, envs);
    const { state, effects } = run(
      start,
      { type: "openName" },
      { type: "typeName", text: "stage" },
      { type: "commitName", via: "enter" },
    );
    expect(syncs(effects)).toEqual([]);
    expect(view(state).name).toEqual({
      text: "stage",
      editing: true,
      issue: "taken",
    });

    const cancelled = run(state, { type: "cancelField" });
    expect(view(cancelled.state).name).toEqual({
      text: "prod",
      editing: false,
      issue: null,
    });
  });

  it("writes a valid name on commit, and Enter hands focus back to the name", () => {
    const typed = run(
      initEditor(prod, envs),
      { type: "openName" },
      { type: "typeName", text: "prod-eu" },
    ).state;
    const entered = run(typed, { type: "commitName", via: "enter" });
    expect(syncs(entered.effects).map((e) => e.goal.name)).toEqual(["prod-eu"]);
    expect(focuses(entered.effects)).toEqual([{ kind: "name" }]);
    expect(
      focuses(run(typed, { type: "commitName", via: "blur" }).effects),
    ).toEqual([]);
  });
});

describe("colors", () => {
  it("keeps a stored color that is not a preset through other edits, and rings no preset", () => {
    const start = initEditor({ ...prod, color: colorKey("#123456") }, envs);
    const port = cell(start, "value", "port");
    const { state, effects } = run(start, ...edit(port, "1"), {
      type: "commitCell",
      cell: port,
      via: "enter",
    });
    expect(syncs(effects).map((e) => e.goal.color)).toEqual(["#123456"]);
    expect(view(state).color).toEqual({ paint: "#123456", ring: null });
  });

  it("writes a picked preset key", () => {
    const { state, effects } = run(initEditor(prod, envs), {
      type: "pickColor",
      color: "coral",
    });
    expect(syncs(effects).map((e) => e.goal.color)).toEqual(["coral"]);
    expect(view(state).color).toEqual({ paint: "#FF6B63", ring: "coral" });
  });
});

describe("leaving", () => {
  it("Done sends an open value and closes before the write lands", () => {
    const start = initEditor(prod, envs);
    const port = cell(start, "value", "port");
    const leaving = run(start, ...edit(port, "8443"), done);
    const [sync] = syncs(leaving.effects);
    expect(sync.goal.variables).toContainEqual(["port", "8443"]);
    expect(leaves(leaving.effects)).toEqual([closed]);
    expect(leaving.effects).toContainEqual(
      expect.objectContaining({
        type: "publish",
        goal: expect.objectContaining({ variables: sync.goal.variables }),
      }),
    );
    expect(leaves(settleStep(leaving.state, sync.rev, ok).effects)).toEqual([]);
  });

  it("Done during a write in flight closes without sending a second copy", () => {
    const start = initEditor(prod, envs);
    const host = cell(start, "key", "host");
    const committed = run(start, ...edit(host, "hostname"), {
      type: "commitCell",
      cell: host,
      via: "enter",
    });
    const [sync] = syncs(committed.effects);
    const leaving = run(committed.state, done);
    expect(syncs(leaving.effects)).toEqual([]);
    expect(leaves(leaving.effects)).toEqual([closed]);
    const landed = settleStep(leaving.state, sync.rev, ok);
    expect(syncs(landed.effects)).toEqual([]);
    expect(leaves(landed.effects)).toEqual([]);
  });

  it("Done commits a non-empty add row and closes", () => {
    const { effects } = run(
      initEditor(prod, envs),
      { type: "addRow" },
      { type: "typeDraft", part: "key", text: "TOKEN" },
      done,
    );
    expect(syncs(effects).map((e) => e.goal.variables.at(-1))).toEqual([
      ["TOKEN", ""],
    ]);
    expect(leaves(effects)).toEqual([closed]);
  });

  it("Done drops a duplicate key and closes without writing it", () => {
    const start = initEditor(prod, envs);
    const port = cell(start, "key", "port");
    const invalid = run(start, ...edit(port, "host"), {
      type: "commitCell",
      cell: port,
      via: "blur",
    });
    const { state, effects } = run(invalid.state, done);
    expect(syncs(effects)).toEqual([]);
    expect(leaves(effects)).toEqual([closed]);
    expect(view(state).table.rows.map((row) => row.key.text)).toEqual([
      "host",
      "port",
    ]);
  });

  it("selecting another environment reports the subject it was asked for", () => {
    const subject = { kind: "stored", name: storedName("stage") } as const;
    const { effects } = run(initEditor(prod, envs), {
      type: "leave",
      target: { to: "select", subject },
    });
    expect(leaves(effects)).toEqual([
      { type: "leave", outcome: { kind: "selected", subject }, cleanup: null },
    ]);
  });

  it("stays open after a failed write and Retry sends it again", () => {
    const start = initEditor(prod, envs);
    const port = cell(start, "value", "port");
    const edited = run(start, ...edit(port, "8443"), {
      type: "commitCell",
      cell: port,
      via: "enter",
    });
    const [sync] = syncs(edited.effects);
    const failed = settleStep(edited.state, sync.rev, {
      ok: false,
      error: { message: "disk full" },
    });
    expect(leaves(failed.effects)).toEqual([]);
    expect(queueStatus(failed.state.save)).toEqual({
      kind: "failed",
      error: { message: "disk full" },
    });
    expect(view(failed.state).table.rows.map((r) => r.value.text)).toContain(
      "8443",
    );
    const retried = run(failed.state, { type: "retry" });
    expect(syncs(retried.effects).map((e) => e.goal)).toEqual([sync.goal]);
  });

  it("asks before discarding a new environment that has a name", () => {
    const { state, effects } = run(
      initEditor(null, envs),
      { type: "typeName", text: "dev" },
      done,
    );
    expect(leaves(effects)).toEqual([]);
    expect(view(state).prompt).toEqual({ reason: "discardNew" });
    expect(leaves(run(state, { type: "discard" }).effects)).toEqual([closed]);
  });
});

describe("create", () => {
  it("writes once on Create and reports the created name when it lands", () => {
    const start = initEditor(null, envs);
    const typed = run(
      start,
      { type: "typeName", text: "dev" },
      { type: "commitName", via: "enter" },
    );
    expect(syncs(typed.effects)).toEqual([]);
    const created = run(typed.state, { type: "create" });
    const [sync] = syncs(created.effects);
    expect(sync.goal.name).toBe("dev");
    expect(view(created.state).creating).toBe(true);

    const landed = settleStep(created.state, sync.rev, {
      ok: true,
      activated: storedName("dev"),
      index: 2,
    });
    expect(landed.effects).toContainEqual({ type: "stored", activated: "dev" });
    expect(leaves(landed.effects)).toEqual([
      {
        type: "leave",
        outcome: { kind: "created", name: "dev" },
        cleanup: null,
      },
    ]);
    expect(landed.state.footprint).toEqual({
      kind: "stored",
      name: "dev",
      index: 2,
      strays: [],
    });
  });

  it("does nothing for an empty name but point at it", () => {
    const { effects } = run(initEditor(null, envs), { type: "create" });
    expect(syncs(effects)).toEqual([]);
    expect(focuses(effects)).toEqual([{ kind: "name" }]);
  });
});

describe("delete preparation and reattach", () => {
  it("prepareDelete applies the open cell and the add row and sends them", () => {
    const start = initEditor(prod, envs);
    const port = cell(start, "value", "port");
    const { state, effects } = run(
      start,
      ...edit(port, "1"),
      { type: "addRow" },
      { type: "typeDraft", part: "key", text: "NEW" },
      { type: "prepareDelete" },
    );
    const [first] = syncs(effects);
    const next = syncs(settleStep(state, first.rev, ok).effects);
    expect(next.map((e) => e.goal.variables)).toEqual([
      [
        ["host", "api:443"],
        ["port", "1"],
        ["NEW", ""],
      ],
    ]);
    expect(view(state).variableCount).toBe(3);
  });

  it("resumeEditor keeps the draft and queue and drops the open field, add row, search and undo", () => {
    const start = initEditor(prod, envs);
    const port = cell(start, "value", "port");
    const host = cell(start, "key", "host");
    const { state } = run(
      start,
      { type: "deleteRow", rowId: host.rowId },
      { type: "setQuery", text: "po" },
      ...edit(port, "1"),
      { type: "addRow" },
    );
    const resumed = resumeEditor(state);
    expect(resumed.draft).toBe(state.draft);
    expect(resumed.save).toBe(state.save);
    const v = view(resumed);
    expect(v.table.rows.map((r) => r.value.mode)).toEqual(["display"]);
    expect(v.table.draft).toBeNull();
    expect(v.search.query).toBe("");
    expect(v.undo).toBeNull();
  });

  it("settling a detached stored lane asks for nothing a pane would do", () => {
    const start = initEditor(prod, envs);
    const port = cell(start, "value", "port");
    const { state, effects } = run(start, ...edit(port, "1"), {
      type: "commitCell",
      cell: port,
      via: "enter",
    });
    const [sync] = syncs(effects);
    const more = run(state, ...edit(port, "2"), {
      type: "commitCell",
      cell: port,
      via: "blur",
    });
    const landed = settleStep(more.state, sync.rev as Rev, ok);
    expect(landed.effects.map((e) => e.type).sort()).toEqual([
      "stored",
      "sync",
    ]);
  });
});

describe("search and empty bodies", () => {
  it("tells an empty environment from a search with no matches", () => {
    const empty = initEditor({ ...prod, variables: [] }, envs);
    expect(view(empty).body).toBe("emptyEnv");
    expect(view(empty).search.filter).toBeNull();

    const missed = run(initEditor(prod, envs), {
      type: "setQuery",
      text: "zzz",
    }).state;
    expect(view(missed).body).toBe("noMatches");
    expect(view(missed).search.filter).toEqual({ shown: 0, total: 2 });
  });

  it("filters immediately when a row-layout hold is still up", () => {
    const held = run(
      initEditor(prod, envs),
      { type: "addRow" },
      { type: "cancelDraft" },
      { type: "setQuery", text: "port" },
    ).state;
    const v = view(held);
    expect(v.search.filter).toEqual({ shown: 1, total: 2 });
    expect(v.table.rows.map((row) => row.key.text)).toEqual(["port"]);
    expect(v.table.draft).toBeNull();
  });
});
