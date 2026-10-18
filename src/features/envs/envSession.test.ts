import { describe, expect, it } from "vitest";

import { storedName, type EnvName } from "./envDraft";
import type { Destination } from "./envEditor";
import {
  initSession,
  sessionStep,
  type SessionCommand,
  type SessionCore,
  type SessionEvent,
  type SessionFacts,
} from "./envSession";

const a = storedName("a");
const b = storedName("b");
const c = storedName("c");

function facts(
  attached: Destination,
  names: readonly EnvName[] = [a, b, c],
  idle = true,
): SessionFacts {
  return { attached, names, idle };
}

const at = (name: EnvName): Destination => ({ kind: "stored", name });

function run(core: SessionCore, f: SessionFacts, ...events: SessionEvent[]) {
  const commands: SessionCommand[] = [];
  for (const e of events) {
    const step = sessionStep(core, e, f);
    core = step.core;
    commands.push(...step.commands);
  }
  return { core, commands };
}

const selectLeave = (to: Destination): SessionCommand => ({
  run: "pane",
  action: { type: "leave", target: { to: "select", subject: to } },
});

describe("sort", () => {
  it("starts in stored order, and the header turns it into Name A–Z, then Z–A", () => {
    const start = initSession();
    expect(start.sort).toBe("oldest");
    const once = run(start, facts(at(a)), { type: "toggleNameSort" });
    expect(once.core.sort).toBe("name-asc");
    expect(once.commands).toEqual([]);
    expect(
      run(once.core, facts(at(a)), { type: "toggleNameSort" }).core.sort,
    ).toBe("name-desc");
  });

  it("survives switching to another environment", () => {
    const sorted = run(initSession(), facts(at(a)), {
      type: "setSort",
      sort: "newest",
    }).core;
    const switched = run(
      sorted,
      facts(at(a)),
      { type: "select", name: b },
      { type: "left", outcome: { kind: "selected", subject: at(b) } },
    );
    expect(switched.core.sort).toBe("newest");
    expect(switched.core.paneKey).toBe(sorted.paneKey + 1);
  });
});

describe("selecting from the list", () => {
  it("leaves the current pane and attaches the picked environment, and nothing else", () => {
    const left = run(initSession(), facts(at(a)), { type: "select", name: b });
    expect(left.commands).toEqual([selectLeave(at(b))]);
    const attached = run(left.core, facts(at(a)), {
      type: "left",
      outcome: { kind: "selected", subject: at(b) },
    });
    expect(attached.commands).toEqual([
      { run: "attach", to: at(b), focus: { kind: "env", name: b } },
    ]);
  });

  it("ignores the environment that is already shown", () => {
    expect(
      run(initSession(), facts(at(a)), { type: "select", name: a }).commands,
    ).toEqual([]);
  });
});

describe("create", () => {
  it("Cancel returns to the environment it started from", () => {
    const started = run(
      initSession(),
      facts(at(b)),
      { type: "createNew" },
      { type: "left", outcome: { kind: "selected", subject: { kind: "new" } } },
    );
    expect(started.commands.at(-1)).toEqual({
      run: "attach",
      to: { kind: "new" },
      focus: { kind: "name" },
    });
    const cancelled = run(started.core, facts({ kind: "new" }), {
      type: "cancelCreate",
    });
    expect(cancelled.commands).toEqual([selectLeave(at(b))]);
  });

  it("Cancel closes an editor that opened in create mode", () => {
    expect(
      run(initSession(), facts({ kind: "new" }), { type: "cancelCreate" })
        .commands,
    ).toEqual([
      { run: "pane", action: { type: "leave", target: { to: "close" } } },
    ]);
  });

  it("attaches the created environment and focuses its name", () => {
    const { commands } = run(initSession(), facts({ kind: "new" }), {
      type: "left",
      outcome: { kind: "created", name: storedName("dev") },
    });
    expect(commands).toEqual([
      { run: "attach", to: at(storedName("dev")), focus: { kind: "name" } },
    ]);
  });
});

describe("close", () => {
  it("leaves the pane, and ends once the pane has left", () => {
    const closing = run(initSession(), facts(at(a)), { type: "close" });
    expect(closing.commands).toEqual([
      { run: "pane", action: { type: "leave", target: { to: "close" } } },
    ]);
    expect(
      run(closing.core, facts(at(a)), {
        type: "left",
        outcome: { kind: "closed" },
      }).commands,
    ).toEqual([{ run: "end" }]);
  });
});

describe("delete", () => {
  it("applies pending edits, then waits for an idle queue before deleting", () => {
    const asking = run(initSession(), facts(at(b)), { type: "requestDelete" });
    expect(asking.core.confirm).toEqual({ phase: "asking", error: null });
    expect(asking.commands).toEqual([
      { run: "pane", action: { type: "prepareDelete" } },
    ]);

    const busy = run(asking.core, facts(at(b), [a, b, c], false), {
      type: "confirmDelete",
    });
    expect(busy.commands).toEqual([]);
    expect(busy.core.confirm?.phase).toBe("asking");

    const deleting = run(asking.core, facts(at(b)), { type: "confirmDelete" });
    expect(deleting.commands).toEqual([{ run: "delete" }]);
    expect(
      run(
        deleting.core,
        facts(at(b)),
        { type: "select", name: a },
        { type: "close" },
      ).commands,
    ).toEqual([]);
  });

  it("selects the next environment after a delete, else the previous one", () => {
    const deleting = run(
      initSession(),
      facts(at(b)),
      { type: "requestDelete" },
      { type: "confirmDelete" },
    ).core;
    const middle = run(deleting, facts(at(b)), {
      type: "deleteSettled",
      name: b,
      outcome: { ok: true },
    });
    expect(middle.core.confirm).toBeNull();
    expect(middle.commands).toEqual([
      { run: "deleted", name: b },
      { run: "attach", to: at(c), focus: { kind: "env", name: c } },
    ]);

    const last = run(deleting, facts(at(c)), {
      type: "deleteSettled",
      name: c,
      outcome: { ok: true },
    });
    expect(last.commands.at(-1)).toEqual({
      run: "attach",
      to: at(b),
      focus: { kind: "env", name: b },
    });
  });

  it("keeps the editor open on an empty list after the only environment is deleted", () => {
    const deleting = run(
      initSession(),
      facts(at(a), [a]),
      { type: "requestDelete" },
      { type: "confirmDelete" },
    ).core;
    const emptied = run(deleting, facts(at(a), [a]), {
      type: "deleteSettled",
      name: a,
      outcome: { ok: true },
    });
    expect(emptied.commands).toEqual([
      { run: "deleted", name: a },
      { run: "attach", to: { kind: "empty" }, focus: { kind: "newEnv" } },
    ]);
    expect(emptied.commands).not.toContainEqual({ run: "end" });

    const creating = run(emptied.core, facts({ kind: "empty" }, []), {
      type: "createNew",
    });
    expect(creating.commands).toEqual([
      { run: "attach", to: { kind: "new" }, focus: { kind: "name" } },
    ]);
    expect(
      run(creating.core, facts({ kind: "new" }, []), { type: "cancelCreate" })
        .commands,
    ).toEqual([selectLeave({ kind: "empty" })]);
  });

  it("keeps the confirmation open with the error when the delete fails", () => {
    const deleting = run(
      initSession(),
      facts(at(b)),
      { type: "requestDelete" },
      { type: "confirmDelete" },
    ).core;
    const failed = run(deleting, facts(at(b)), {
      type: "deleteSettled",
      name: b,
      outcome: { ok: false, error: { message: "disk full" } },
    });
    expect(failed.core.confirm).toEqual({
      phase: "asking",
      error: { message: "disk full" },
    });
    expect(failed.commands).toEqual([]);
  });

  it("does not ask to delete an environment that was never created", () => {
    const { core, commands } = run(initSession(), facts({ kind: "new" }), {
      type: "requestDelete",
    });
    expect(core.confirm).toBeNull();
    expect(commands).toEqual([]);
  });
});
