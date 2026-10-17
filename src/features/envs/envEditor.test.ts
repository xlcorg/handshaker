import { describe, expect, it } from "vitest";

import {
  colorKey,
  storedName,
  type EnvSummary,
  type OpenEnv,
} from "./envDraft";
import {
  editorStep,
  initEditor,
  selectView,
  type EditorAction,
  type EditorEffect,
  type EditorState,
} from "./envEditor";

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
  { name: storedName("prod"), color: colorKey("red") },
  { name: storedName("stage"), color: colorKey("yellow") },
];

function run(state: EditorState, ...actions: EditorAction[]) {
  const effects: EditorEffect[] = [];
  for (const action of actions) {
    const step = editorStep(state, action);
    state = step.state;
    effects.push(...step.effects);
  }
  return { state, effects };
}

function idOf(state: EditorState, key: string) {
  const row = selectView(state).rows.find((r) => r.keyText === key);
  if (!row) throw new Error(`no row ${key}`);
  return row.id;
}

function syncs(effects: readonly EditorEffect[]) {
  return effects.flatMap((e) => (e.type === "sync" ? [e] : []));
}

function leaves(effects: readonly EditorEffect[]) {
  return effects.filter((e) => e.type === "leave");
}

const done: EditorAction = { type: "leave", target: { to: "close" } };
const ok = { ok: true, activated: null, index: 0 } as const;

describe("editorStep", () => {
  it("writes a key only when it commits, not while it is typed", () => {
    const start = initEditor(prod, envs);
    const host = idOf(start, "host");
    const typed = run(start, {
      type: "typeKey",
      rowId: host,
      text: "hostname",
    });
    expect(syncs(typed.effects)).toEqual([]);
    const committed = run(typed.state, {
      type: "commitKey",
      rowId: host,
      via: "blur",
    });
    expect(syncs(committed.effects).map((e) => e.goal.variables)).toEqual([
      [
        ["hostname", "api:443"],
        ["port", "443"],
      ],
    ]);
  });

  it("writes nothing for an empty or duplicate key and reports the window invalid", () => {
    const start = initEditor(prod, envs);
    for (const text of ["", "port"]) {
      const host = idOf(start, "host");
      const { state, effects } = run(
        start,
        { type: "typeKey", rowId: host, text },
        { type: "commitKey", rowId: host, via: "blur" },
      );
      expect(syncs(effects)).toEqual([]);
      expect(selectView(state).status.kind).toBe("invalid");
    }
  });

  it("waits out the pause before writing a value", () => {
    const start = initEditor(prod, envs);
    const edited = run(start, {
      type: "editValue",
      rowId: idOf(start, "port"),
      text: "8443",
    });
    expect(edited.effects).toContainEqual({ type: "armSaveTimer" });
    expect(syncs(edited.effects)).toEqual([]);
    expect(selectView(edited.state).status.kind).toBe("saving");
    const fired = run(edited.state, { type: "timerFired" });
    expect(syncs(fired.effects).map((e) => e.goal.variables)).toEqual([
      [
        ["host", "api:443"],
        ["port", "8443"],
      ],
    ]);
  });

  const closed = {
    type: "leave",
    outcome: { kind: "closed" },
    cleanup: null,
  } as const;

  it("Done sends a pending value and closes before the write lands", () => {
    const start = initEditor(prod, envs);
    const edited = run(start, {
      type: "editValue",
      rowId: idOf(start, "port"),
      text: "8443",
    });
    const leaving = run(edited.state, done);
    const [sync] = syncs(leaving.effects);
    expect(sync.goal.variables).toContainEqual(["port", "8443"]);
    expect(leaves(leaving.effects)).toEqual([closed]);
    expect(leaving.effects).toContainEqual(
      expect.objectContaining({
        type: "publish",
        goal: expect.objectContaining({ variables: sync.goal.variables }),
      }),
    );
    const landed = run(leaving.state, {
      type: "syncSettled",
      rev: sync.rev,
      outcome: ok,
    });
    expect(leaves(landed.effects)).toEqual([]);
  });

  it("Done during a write in flight closes without sending a second copy", () => {
    const start = initEditor(prod, envs);
    const host = idOf(start, "host");
    const committed = run(
      start,
      { type: "typeKey", rowId: host, text: "hostname" },
      { type: "commitKey", rowId: host, via: "blur" },
    );
    const [sync] = syncs(committed.effects);
    const leaving = run(committed.state, done);
    expect(syncs(leaving.effects)).toEqual([]);
    expect(leaves(leaving.effects)).toEqual([closed]);
    expect(leaving.state.save.sendOnSettle).toBe(true);
    const landed = run(leaving.state, {
      type: "syncSettled",
      rev: sync.rev,
      outcome: ok,
    });
    expect(syncs(landed.effects)).toEqual([]);
    expect(leaves(landed.effects)).toEqual([]);
  });

  it("Done commits a key that is still being typed and closes", () => {
    const start = initEditor(prod, envs);
    const host = idOf(start, "host");
    const { effects } = run(
      start,
      { type: "typeKey", rowId: host, text: "hostname" },
      done,
    );
    expect(syncs(effects).map((e) => e.goal.variables[0])).toEqual([
      ["hostname", "api:443"],
    ]);
    expect(leaves(effects)).toEqual([closed]);
  });

  it("stays open after a failed write and Retry sends it again", () => {
    const start = initEditor(prod, envs);
    const edited = run(
      start,
      { type: "editValue", rowId: idOf(start, "port"), text: "8443" },
      { type: "timerFired" },
    );
    const [sync] = syncs(edited.effects);
    const failed = run(edited.state, {
      type: "syncSettled",
      rev: sync.rev,
      outcome: { ok: false, error: { message: "disk full" } },
    });
    expect(leaves(failed.effects)).toEqual([]);
    expect(selectView(failed.state).status).toEqual({
      kind: "failed",
      error: { message: "disk full" },
    });
    expect(selectView(failed.state).rows.map((r) => r.value)).toContain("8443");
    const retried = run(failed.state, { type: "retry" });
    expect(syncs(retried.effects).map((e) => e.goal)).toEqual([sync.goal]);
  });

  it("Done drops a duplicate key and closes without writing it", () => {
    const start = initEditor(prod, envs);
    const port = idOf(start, "port");
    const invalid = run(
      start,
      { type: "typeKey", rowId: port, text: "host" },
      { type: "commitKey", rowId: port, via: "blur" },
    );
    const { state, effects } = run(invalid.state, done);
    expect(syncs(effects)).toEqual([]);
    expect(leaves(effects)).toEqual([closed]);
    expect(selectView(state).rows.map((row) => row.keyText)).toEqual([
      "host",
      "port",
    ]);
    expect(selectView(state).prompt).toBeNull();
  });
});
