import type { EnvName } from "./envDraft";
import type {
  Destination,
  FocusTarget,
  LeaveOutcome,
  PaneAction,
} from "./envEditor";
import type { DeleteOutcome } from "./envSync";
import type { SaveFailure } from "./saveQueue";
import {
  DEFAULT_SORT,
  neighborIn,
  toggleNameSort,
  type SortMode,
} from "./varView";

export interface DeleteConfirm {
  readonly phase: "asking" | "deleting";
  readonly error: SaveFailure | null;
}

export interface SessionCore {
  readonly sort: SortMode;
  readonly paneKey: number;
  readonly returnTo: Destination | null;
  readonly confirm: DeleteConfirm | null;
}

export interface SessionFacts {
  readonly attached: Destination;
  readonly names: readonly EnvName[];
  readonly idle: boolean;
}

export type SessionIntent =
  | { readonly type: "setSort"; readonly sort: SortMode }
  | { readonly type: "toggleNameSort" }
  | { readonly type: "select"; readonly name: EnvName }
  | { readonly type: "createNew" }
  | { readonly type: "cancelCreate" }
  | { readonly type: "close" }
  | { readonly type: "requestDelete" }
  | { readonly type: "confirmDelete" }
  | { readonly type: "cancelDelete" };

export type SessionEvent =
  | SessionIntent
  | { readonly type: "left"; readonly outcome: LeaveOutcome }
  | {
      readonly type: "deleteSettled";
      readonly name: EnvName;
      readonly outcome: DeleteOutcome;
    };

export type SessionCommand =
  | {
      readonly run: "pane";
      readonly action: Extract<
        PaneAction,
        { readonly type: "leave" | "prepareDelete" }
      >;
    }
  | { readonly run: "delete" }
  | { readonly run: "deleted"; readonly name: EnvName }
  | {
      readonly run: "attach";
      readonly to: Destination;
      readonly focus: FocusTarget;
    }
  | { readonly run: "focus"; readonly target: FocusTarget }
  | { readonly run: "end" };

export interface SessionStep {
  readonly core: SessionCore;
  readonly commands: readonly SessionCommand[];
}

export function initSession(): SessionCore {
  return { sort: DEFAULT_SORT, paneKey: 0, returnTo: null, confirm: null };
}

const CONFIRM_EVENTS: ReadonlySet<SessionEvent["type"]> = new Set([
  "confirmDelete",
  "cancelDelete",
  "deleteSettled",
]);

export function sessionStep(
  core: SessionCore,
  e: SessionEvent,
  facts: SessionFacts,
): SessionStep {
  const none = { core, commands: [] };
  if (core.confirm && !CONFIRM_EVENTS.has(e.type)) return none;
  if (core.confirm?.phase === "deleting" && e.type !== "deleteSettled")
    return none;
  const at = facts.attached;
  switch (e.type) {
    case "setSort":
      return { core: { ...core, sort: e.sort }, commands: [] };
    case "toggleNameSort":
      return {
        core: { ...core, sort: toggleNameSort(core.sort) },
        commands: [],
      };
    case "select":
      if (at.kind === "stored" && at.name === e.name) return none;
      return go(core, at, { kind: "stored", name: e.name });
    case "createNew":
      if (at.kind === "new")
        return { core, commands: [{ run: "focus", target: { kind: "name" } }] };
      return go({ ...core, returnTo: at }, at, { kind: "new" });
    case "cancelCreate":
      if (at.kind !== "new") return none;
      return { core, commands: [leave(core.returnTo)] };
    case "close":
      return at.kind === "empty"
        ? { core, commands: [{ run: "end" }] }
        : { core, commands: [leave(null)] };
    case "left":
      return afterLeave(core, e.outcome);
    case "requestDelete":
      if (at.kind !== "stored") return none;
      return {
        core: { ...core, confirm: { phase: "asking", error: null } },
        commands: [{ run: "pane", action: { type: "prepareDelete" } }],
      };
    case "confirmDelete":
      if (core.confirm?.phase !== "asking" || !facts.idle) return none;
      return {
        core: { ...core, confirm: { phase: "deleting", error: null } },
        commands: [{ run: "delete" }],
      };
    case "cancelDelete":
      return { core: { ...core, confirm: null }, commands: [] };
    case "deleteSettled": {
      if (!e.outcome.ok)
        return {
          core: {
            ...core,
            confirm: { phase: "asking", error: e.outcome.error },
          },
          commands: [],
        };
      const next = neighborIn(facts.names, e.name);
      const step = attach(
        { ...core, confirm: null },
        next ? { kind: "stored", name: next } : { kind: "empty" },
      );
      return {
        core: step.core,
        commands: [{ run: "deleted", name: e.name }, ...step.commands],
      };
    }
  }
}

function leave(to: Destination | null): SessionCommand {
  return {
    run: "pane",
    action: {
      type: "leave",
      target: to ? { to: "select", subject: to } : { to: "close" },
    },
  };
}

function go(core: SessionCore, at: Destination, to: Destination): SessionStep {
  return at.kind === "empty"
    ? attach(core, to)
    : { core, commands: [leave(to)] };
}

function afterLeave(core: SessionCore, outcome: LeaveOutcome): SessionStep {
  switch (outcome.kind) {
    case "closed":
      return { core, commands: [{ run: "end" }] };
    case "selected":
      return attach(core, outcome.subject);
    case "created":
      return attach(
        core,
        { kind: "stored", name: outcome.name },
        { kind: "name" },
      );
  }
}

function attach(
  core: SessionCore,
  to: Destination,
  focus: FocusTarget = focusFor(to),
): SessionStep {
  return {
    core: {
      ...core,
      paneKey: core.paneKey + 1,
      returnTo: to.kind === "new" ? core.returnTo : null,
    },
    commands: [{ run: "attach", to, focus }],
  };
}

function focusFor(to: Destination): FocusTarget {
  switch (to.kind) {
    case "stored":
      return { kind: "env", name: to.name };
    case "new":
      return { kind: "name" };
    case "empty":
      return { kind: "newEnv" };
  }
}
