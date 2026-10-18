import { paintMarker, type Marker, type PresetKey } from "./colors";
import {
  colorKey,
  draftFromStored,
  goalFromStored,
  mintRowId,
  parseDraft,
  type DraftIssues,
  type DraftRow,
  type EnvDraft,
  type EnvGoal,
  type EnvName,
  type EnvSummary,
  type NameIssue,
  type OpenEnv,
  type RowId,
  type RowIssue,
} from "./envDraft";
import {
  afterSync,
  footprintNames,
  type Footprint,
  type SyncOutcome,
} from "./envSync";
import {
  createQueue,
  stepQueue,
  type QueueEvent,
  type QuietStatus,
  type Rev,
  type SaveQueue,
  type Urgency,
} from "./saveQueue";
import {
  holdLayout,
  initialView,
  nameSortIndicator,
  neighborIn,
  releaseLayout,
  setQuery,
  showAnyway,
  viewRows,
  type NameSortIndicator,
  type SortMode,
  type Span,
  type ViewSource,
  type ViewState,
} from "./varView";

export type Subject =
  | { readonly kind: "stored"; readonly name: EnvName }
  | { readonly kind: "new" };

export type Destination = Subject | { readonly kind: "empty" };

export type LeaveTarget =
  | { readonly to: "close" }
  | { readonly to: "select"; readonly subject: Destination };

export type LeaveOutcome =
  | { readonly kind: "closed" }
  | { readonly kind: "selected"; readonly subject: Destination }
  | { readonly kind: "created"; readonly name: EnvName };

export type CellRef = { readonly kind: "key" | "value"; readonly rowId: RowId };

export type FieldTarget = { readonly kind: "name" } | CellRef;

export interface FieldDraft {
  readonly target: FieldTarget;
  readonly text: string;
}

export interface AddDraft {
  readonly id: RowId;
  readonly key: string;
  readonly value: string;
}

export type FocusTarget =
  | { readonly kind: "name" }
  | { readonly kind: "search" }
  | { readonly kind: "add" }
  | { readonly kind: "newEnv" }
  | CellRef
  | { readonly kind: "env"; readonly name: EnvName };

export function fieldAttr(target: FocusTarget): string {
  switch (target.kind) {
    case "key":
    case "value":
      return `${target.kind}:${target.rowId}`;
    case "env":
      return `env:${target.name}`;
    default:
      return target.kind;
  }
}

export interface EditorState {
  readonly footprint: Footprint;
  readonly draft: EnvDraft;
  readonly save: SaveQueue<EnvGoal>;
  readonly envs: readonly EnvSummary[];
  readonly seq: number;
  readonly field: FieldDraft | null;
  readonly adding: AddDraft | null;
  readonly view: ViewState;
  readonly undo: { readonly row: DraftRow; readonly index: number } | null;
  readonly leaving: LeaveTarget | null;
}

export interface PaneContext {
  readonly sort: SortMode;
}

export type PaneIntent =
  | { readonly type: "openName" }
  | { readonly type: "typeName"; readonly text: string }
  | { readonly type: "commitName"; readonly via: "enter" | "blur" }
  | { readonly type: "pickColor"; readonly color: PresetKey }
  | { readonly type: "openCell"; readonly cell: CellRef }
  | { readonly type: "typeCell"; readonly cell: CellRef; readonly text: string }
  | {
      readonly type: "commitCell";
      readonly cell: CellRef;
      readonly via: "enter" | "blur";
    }
  | { readonly type: "cancelField" }
  | { readonly type: "addRow" }
  | {
      readonly type: "typeDraft";
      readonly part: "key" | "value";
      readonly text: string;
    }
  | { readonly type: "commitDraft" }
  | { readonly type: "cancelDraft" }
  | { readonly type: "deleteRow"; readonly rowId: RowId }
  | { readonly type: "undoDelete" }
  | { readonly type: "dismissUndo" }
  | { readonly type: "setQuery"; readonly text: string }
  | { readonly type: "clearSearch" }
  | { readonly type: "create" }
  | { readonly type: "retry" }
  | { readonly type: "discard" }
  | { readonly type: "keepEditing" };

export type PaneAction =
  | PaneIntent
  | { readonly type: "leave"; readonly target: LeaveTarget }
  | { readonly type: "prepareDelete" }
  | { readonly type: "regionFocus"; readonly inside: boolean }
  | { readonly type: "timerFired" }
  | { readonly type: "envsChanged"; readonly envs: readonly EnvSummary[] };

export interface Cleanup {
  readonly goal: EnvGoal | null;
  readonly footprint: Footprint;
}

export type LaneEffect =
  | {
      readonly type: "sync";
      readonly rev: Rev;
      readonly goal: EnvGoal;
      readonly footprint: Footprint;
    }
  | { readonly type: "stored"; readonly activated: EnvName | null };

export type PaneEffect =
  | { readonly type: "armSaveTimer" }
  | { readonly type: "cancelSaveTimer" }
  | {
      readonly type: "publish";
      readonly goal: EnvGoal;
      readonly previousName: EnvName;
    }
  | {
      readonly type: "leave";
      readonly outcome: LeaveOutcome;
      readonly cleanup: Cleanup | null;
    }
  | { readonly type: "focus"; readonly target: FocusTarget };

export type EditorEffect = LaneEffect | PaneEffect;

export interface Step {
  readonly state: EditorState;
  readonly effects: readonly EditorEffect[];
}

export function initEditor(
  env: OpenEnv | null,
  envs: readonly EnvSummary[],
): EditorState {
  const { draft, seq } = draftFromStored(env, 0);
  return {
    footprint: env
      ? { kind: "stored", name: env.name, index: env.index, strays: [] }
      : { kind: "new", strays: [] },
    draft,
    save: createQueue(env ? goalFromStored(env) : null),
    envs,
    seq,
    field: env ? null : { target: { kind: "name" }, text: "" },
    adding: null,
    view: initialView,
    undo: null,
    leaving: null,
  };
}

export function resumeEditor(s: EditorState): EditorState {
  return {
    ...s,
    field: null,
    adding: null,
    view: initialView,
    undo: null,
    leaving: null,
  };
}

export function editorStep(
  state: EditorState,
  action: PaneAction,
  ctx: PaneContext,
): Step {
  const fx: EditorEffect[] = [];
  return { state: reduce(state, action, ctx, fx), effects: fx };
}

export function settleStep(
  state: EditorState,
  rev: Rev,
  outcome: SyncOutcome,
): Step {
  const fx: EditorEffect[] = [];
  return { state: settle(state, rev, outcome, fx), effects: fx };
}

/** Esc routing for DialogContent.onEscapeKeyDown, which runs before any field's own keydown. Null lets the dialog close. */
export function escapeIntent(
  s: EditorState,
  focused: string | null,
): PaneIntent | null {
  if (focused === null) return null;
  const target = s.field?.target;
  if (target && target.kind !== "name" && focused === fieldAttr(target))
    return { type: "cancelField" };
  if (
    target?.kind === "name" &&
    s.footprint.kind === "stored" &&
    focused === fieldAttr(target)
  ) {
    return { type: "cancelField" };
  }
  const adding = s.adding;
  if (
    adding &&
    (focused === fieldAttr({ kind: "key", rowId: adding.id }) ||
      focused === fieldAttr({ kind: "value", rowId: adding.id }))
  ) {
    return { type: "cancelDraft" };
  }
  return null;
}

function reduce(
  s: EditorState,
  a: PaneAction,
  ctx: PaneContext,
  fx: EditorEffect[],
): EditorState {
  switch (a.type) {
    case "openName": {
      const next = commitOpenField(s, fx);
      fx.push({ type: "focus", target: { kind: "name" } });
      return {
        ...next,
        field: { target: { kind: "name" }, text: next.draft.name },
      };
    }
    case "typeName":
      return { ...s, field: { target: { kind: "name" }, text: a.text } };
    case "commitName": {
      const next = commitName(s, fx);
      if (
        a.via === "enter" &&
        s.footprint.kind === "stored" &&
        next.field === null
      ) {
        fx.push({ type: "focus", target: { kind: "name" } });
      }
      return next;
    }
    case "pickColor":
      return a.color === s.draft.color
        ? s
        : stageSave(
            { ...s, draft: { ...s.draft, color: colorKey(a.color) } },
            "now",
            fx,
          );
    case "openCell":
      return openCell(s, a.cell, ctx, fx);
    case "typeCell":
      return sameTarget(s.field?.target, a.cell)
        ? { ...s, field: { target: a.cell, text: a.text } }
        : s;
    case "commitCell": {
      if (!sameTarget(s.field?.target, a.cell)) return s;
      if (a.via === "enter") fx.push({ type: "focus", target: a.cell });
      return commitCell(s, a.cell, fx);
    }
    case "cancelField": {
      const target = s.field?.target;
      if (!target) return s;
      fx.push({ type: "focus", target });
      return { ...s, field: null };
    }
    case "addRow":
      return addRow(s, ctx, fx);
    case "typeDraft":
      return s.adding ? { ...s, adding: { ...s.adding, [a.part]: a.text } } : s;
    case "commitDraft": {
      const adding = s.adding;
      if (!adding) return s;
      if (s.draft.rows.some((row) => row.key === adding.key)) {
        fx.push({ type: "focus", target: { kind: "key", rowId: adding.id } });
        return s;
      }
      fx.push({ type: "focus", target: { kind: "add" } });
      return commitAdding(s, fx);
    }
    case "cancelDraft":
      if (!s.adding) return s;
      fx.push({ type: "focus", target: { kind: "add" } });
      return { ...s, adding: null };
    case "deleteRow":
      return deleteRow(s, a.rowId, ctx, fx);
    case "undoDelete":
      return undoDelete(s, fx);
    case "dismissUndo":
      return s.undo ? { ...s, undo: null } : s;
    case "setQuery":
      return withView(s, releaseLayout(setQuery(s.view, a.text)));
    case "clearSearch":
      fx.push({ type: "focus", target: { kind: "search" } });
      return withView(s, releaseLayout(setQuery(s.view, "")));
    case "regionFocus":
      return withView(
        s,
        a.inside
          ? holdLayout(s.view, viewSource(s), ctx.sort)
          : releaseLayout(s.view),
      );
    case "leave":
      return requestLeave(s, a.target, fx);
    case "prepareDelete":
      return flush(commitPending(s, fx), fx);
    case "create":
      return create(s, ctx, fx);
    case "retry":
      return queue(s, { type: "flush" }, fx);
    case "discard":
      return s.leaving && !s.save.inFlight ? leaveNow(s, s.leaving, fx) : s;
    case "keepEditing":
      return s.leaving ? { ...s, leaving: null } : s;
    case "timerFired":
      return queue(s, { type: "timerFired" }, fx);
    case "envsChanged": {
      if (a.envs === s.envs) return s;
      const next = { ...s, envs: a.envs };
      const flipped =
        parseDraft(s.draft, taken(s)).ok !==
        parseDraft(next.draft, taken(next)).ok;
      return flipped ? stageSave(next, "debounce", fx) : next;
    }
  }
}

function sameTarget(a: FieldTarget | undefined, b: CellRef): boolean {
  return a !== undefined && a.kind === b.kind && a.rowId === b.rowId;
}

function withView(s: EditorState, view: ViewState): EditorState {
  return view === s.view ? s : { ...s, view };
}

function taken(s: EditorState): ReadonlySet<string> {
  const ours = new Set<string>(footprintNames(s.footprint));
  return new Set(
    s.envs.map((env) => env.name).filter((name) => !ours.has(name)),
  );
}

function isValid(s: EditorState): boolean {
  return parseDraft(s.draft, taken(s)).ok;
}

function queue(
  s: EditorState,
  event: QueueEvent<EnvGoal>,
  fx: EditorEffect[],
): EditorState {
  const step = stepQueue(s.save, event);
  for (const e of step.effects) {
    if (e.type === "send")
      fx.push({
        type: "sync",
        rev: e.rev,
        goal: e.goal,
        footprint: s.footprint,
      });
    else
      fx.push({
        type: e.type === "armTimer" ? "armSaveTimer" : "cancelSaveTimer",
      });
  }
  return { ...s, save: step.queue };
}

function stageSave(
  s: EditorState,
  urgency: Urgency,
  fx: EditorEffect[],
): EditorState {
  const parsed = parseDraft(s.draft, taken(s));
  const u: Urgency = s.footprint.kind === "new" ? "hold" : urgency;
  return queue(
    s,
    parsed.ok
      ? { type: "edited", goal: parsed.goal, urgency: u }
      : { type: "invalid" },
    fx,
  );
}

function flush(s: EditorState, fx: EditorEffect[]): EditorState {
  return queue(s, { type: "flush" }, fx);
}

function patchRow(
  draft: EnvDraft,
  rowId: RowId,
  patch: Partial<Omit<DraftRow, "id">>,
): EnvDraft {
  return {
    ...draft,
    rows: draft.rows.map((row) =>
      row.id === rowId ? { ...row, ...patch } : row,
    ),
  };
}

function commitName(s: EditorState, fx: EditorEffect[]): EditorState {
  if (s.field?.target.kind !== "name") return s;
  const name = s.field.text.trim();
  if (name === s.draft.name) return { ...s, field: null };
  const draft = { ...s.draft, name };
  if (s.footprint.kind === "stored" && nameIssueOf(draft, s) !== null) return s;
  return stageSave({ ...s, field: null, draft }, "now", fx);
}

function nameIssueOf(draft: EnvDraft, s: EditorState): NameIssue | null {
  const parsed = parseDraft(draft, taken(s));
  return parsed.ok ? null : parsed.issues.name;
}

function commitCell(
  s: EditorState,
  cell: CellRef,
  fx: EditorEffect[],
): EditorState {
  const text = s.field?.text ?? "";
  const next = { ...s, field: null };
  const row = s.draft.rows.find((r) => r.id === cell.rowId);
  if (!row || row[cell.kind] === text) return next;
  return stageSave(
    { ...next, draft: patchRow(s.draft, cell.rowId, { [cell.kind]: text }) },
    "now",
    fx,
  );
}

function commitOpenField(s: EditorState, fx: EditorEffect[]): EditorState {
  const target = s.field?.target;
  if (!target) return s;
  if (target.kind === "name") {
    const committed = commitName(s, fx);
    return committed.field ? { ...committed, field: null } : committed;
  }
  return commitCell(s, target, fx);
}

function commitAdding(s: EditorState, fx: EditorEffect[]): EditorState {
  const adding = s.adding;
  if (!adding) return s;
  if (adding.key === "") return { ...s, adding: null };
  const draft = {
    ...s.draft,
    rows: [
      ...s.draft.rows,
      { id: adding.id, key: adding.key, value: adding.value },
    ],
  };
  return stageSave(
    { ...s, adding: null, draft, view: showAnyway(s.view, adding.id) },
    "now",
    fx,
  );
}

function commitPending(s: EditorState, fx: EditorEffect[]): EditorState {
  return commitAdding(commitOpenField(s, fx), fx);
}

function openCell(
  s: EditorState,
  cell: CellRef,
  ctx: PaneContext,
  fx: EditorEffect[],
): EditorState {
  if (sameTarget(s.field?.target, cell)) return s;
  const next = commitOpenField(s, fx);
  const row = next.draft.rows.find((r) => r.id === cell.rowId);
  if (!row) return next;
  fx.push({ type: "focus", target: cell });
  return {
    ...next,
    field: { target: cell, text: row[cell.kind] },
    view: holdLayout(next.view, viewSource(next), ctx.sort),
  };
}

function addRow(
  s: EditorState,
  ctx: PaneContext,
  fx: EditorEffect[],
): EditorState {
  const next = commitOpenField(s, fx);
  if (next.adding) {
    fx.push({ type: "focus", target: { kind: "key", rowId: next.adding.id } });
    return next;
  }
  const { id, seq } = mintRowId(next.seq);
  fx.push({ type: "focus", target: { kind: "key", rowId: id } });
  return {
    ...next,
    seq,
    adding: { id, key: "", value: "" },
    view: holdLayout(next.view, viewSource(next), ctx.sort),
  };
}

function deleteRow(
  s: EditorState,
  rowId: RowId,
  ctx: PaneContext,
  fx: EditorEffect[],
): EditorState {
  const index = s.draft.rows.findIndex((row) => row.id === rowId);
  if (index < 0) return s;
  const ids = viewRows(viewSource(s), s.view, ctx.sort)
    .entries.filter((entry) => !entry.draft)
    .map((entry) => entry.row.id);
  const neighbor = neighborIn(ids, rowId);
  fx.push({
    type: "focus",
    target: neighbor ? { kind: "key", rowId: neighbor } : { kind: "add" },
  });
  const field =
    s.field?.target.kind !== "name" && s.field?.target.rowId === rowId
      ? null
      : s.field;
  const draft = {
    ...s.draft,
    rows: s.draft.rows.filter((row) => row.id !== rowId),
  };
  return stageSave(
    { ...s, field, draft, undo: { row: s.draft.rows[index], index } },
    "now",
    fx,
  );
}

function undoDelete(s: EditorState, fx: EditorEffect[]): EditorState {
  if (!s.undo) return s;
  const { row, index } = s.undo;
  const rows = [...s.draft.rows];
  rows.splice(Math.min(index, rows.length), 0, row);
  fx.push({ type: "focus", target: { kind: "key", rowId: row.id } });
  return stageSave(
    {
      ...s,
      undo: null,
      draft: { ...s.draft, rows },
      view: showAnyway(s.view, row.id),
    },
    "now",
    fx,
  );
}

function create(
  s: EditorState,
  ctx: PaneContext,
  fx: EditorEffect[],
): EditorState {
  if (s.footprint.kind !== "new" || s.save.inFlight) return s;
  const next = { ...commitPending(s, fx), leaving: null };
  if (!isValid(next)) {
    focusFirstIssue(next, ctx, fx);
    return next;
  }
  return queue(next, { type: "flush" }, fx);
}

function isBlank(draft: EnvDraft): boolean {
  return draft.name === "" && draft.color === null && draft.rows.length === 0;
}

function requestLeave(
  s: EditorState,
  target: LeaveTarget,
  fx: EditorEffect[],
): EditorState {
  if (s.footprint.kind === "new") {
    if (s.save.inFlight) return s;
    const committed = commitPending(s, fx);
    return isBlank(committed.draft)
      ? leaveNow(committed, target, fx)
      : { ...committed, leaving: target };
  }
  const flushed = flush(soundDraft(s, fx), fx);
  const head = flushed.save.head;
  if (
    head.state === "writable" &&
    head.rev !== flushed.save.acked.rev &&
    flushed.footprint.kind === "stored"
  ) {
    fx.push({
      type: "publish",
      goal: head.goal,
      previousName: flushed.footprint.name,
    });
  }
  return leaveNow(flushed, target, fx);
}

function soundDraft(s: EditorState, fx: EditorEffect[]): EditorState {
  const scratch: EditorEffect[] = [];
  const committed = commitPending(s, scratch);
  if (isValid(committed)) {
    fx.push(...scratch);
    return committed;
  }
  const kept =
    s.field?.target.kind === "value"
      ? commitOpenField(s, fx)
      : { ...s, field: null };
  return salvage({ ...kept, adding: null }, fx);
}

function salvage(s: EditorState, fx: EditorEffect[]): EditorState {
  const parsed = parseDraft(s.draft, taken(s));
  if (parsed.ok) return s;
  const acked = s.save.acked.goal;
  if (!acked) return s;
  const good = new Map(
    s.draft.rows
      .filter((row) => !parsed.issues.rows.has(row.id))
      .map((row) => [row.key, row]),
  );
  const ackedKeys = new Set(acked.variables.map(([key]) => key));
  let seq = s.seq;
  const rows: DraftRow[] = [];
  for (const [key, value] of acked.variables) {
    const kept = good.get(key);
    if (kept) rows.push(kept);
    else {
      const minted = mintRowId(seq);
      seq = minted.seq;
      rows.push({ id: minted.id, key, value });
    }
  }
  for (const row of good.values()) {
    if (!ackedKeys.has(row.key)) rows.push(row);
  }
  const draft: EnvDraft = {
    name: parsed.issues.name ? acked.name : s.draft.name,
    color: s.draft.color,
    rows,
  };
  const next = { ...s, draft, field: null, adding: null, seq, undo: null };
  const again = parseDraft(draft, taken(next));
  if (!again.ok) return { ...next, save: s.save };
  if (sameVariables(again.goal, acked)) return { ...next, save: s.save };
  return stageSave(next, "now", fx);
}

function sameVariables(goal: EnvGoal, acked: EnvGoal): boolean {
  if (
    goal.name !== acked.name ||
    goal.color !== acked.color ||
    goal.variables.length !== acked.variables.length
  ) {
    return false;
  }
  return goal.variables.every(([key, value], index) => {
    const other = acked.variables[index];
    return other !== undefined && other[0] === key && other[1] === value;
  });
}

function leaveNow(
  s: EditorState,
  target: LeaveTarget,
  fx: EditorEffect[],
): EditorState {
  const fp = s.footprint;
  const cleanup =
    fp.strays.length > 0 ? { goal: s.save.acked.goal, footprint: fp } : null;
  const outcome: LeaveOutcome =
    target.to === "select"
      ? { kind: "selected", subject: target.subject }
      : { kind: "closed" };
  fx.push({ type: "leave", outcome, cleanup });
  return { ...s, leaving: null };
}

function focusFirstIssue(
  s: EditorState,
  ctx: PaneContext,
  fx: EditorEffect[],
): void {
  const parsed = parseDraft(s.draft, taken(s));
  if (parsed.ok) return;
  if (parsed.issues.name) {
    fx.push({ type: "focus", target: { kind: "name" } });
    return;
  }
  const first = viewRows(viewSource(s), s.view, ctx.sort).entries.find(
    (entry) => parsed.issues.rows.has(entry.row.id),
  );
  if (first)
    fx.push({ type: "focus", target: { kind: "key", rowId: first.row.id } });
}

function settle(
  s: EditorState,
  rev: Rev,
  outcome: SyncOutcome,
  fx: EditorEffect[],
): EditorState {
  const flight = s.save.inFlight;
  if (!flight || flight.rev !== rev) return s;
  const wasNew = s.footprint.kind === "new";
  const footprint = afterSync(s.footprint, flight.goal, outcome);
  const next = queue(
    { ...s, footprint },
    outcome.ok
      ? { type: "settled", rev, ok: true }
      : { type: "settled", rev, ok: false, error: outcome.error },
    fx,
  );
  if (!outcome.ok) return next;
  fx.push({ type: "stored", activated: outcome.activated });
  if (!wasNew) return next;
  const created = flush(next, fx);
  fx.push({
    type: "leave",
    outcome: { kind: "created", name: flight.goal.name },
    cleanup: null,
  });
  return { ...created, leaving: null };
}

interface Projection {
  readonly name: string;
  readonly rows: readonly DraftRow[];
  readonly adding: DraftRow | null;
  readonly issues: DraftIssues;
}

const NO_ISSUES: DraftIssues = { name: null, rows: new Map() };

function typedKey(s: EditorState, rowId: RowId): string | null {
  const target = s.field?.target;
  return target?.kind === "key" && target.rowId === rowId
    ? (s.field?.text ?? null)
    : null;
}

function project(s: EditorState): Projection {
  const rows = s.draft.rows.map((row) => {
    const typed = typedKey(s, row.id);
    return typed === null ? row : { ...row, key: typed };
  });
  const adding = s.adding
    ? { id: s.adding.id, key: s.adding.key, value: s.adding.value }
    : null;
  const target = s.field?.target;
  const name =
    target?.kind === "name" && s.field ? s.field.text.trim() : s.draft.name;
  const parsed = parseDraft(
    { name, color: s.draft.color, rows: adding ? [...rows, adding] : rows },
    taken(s),
  );
  if (parsed.ok) return { name, rows, adding, issues: NO_ISSUES };
  const typing = target?.kind === "key" ? target.rowId : null;
  const rowIssues = new Map(
    [...parsed.issues.rows].filter(
      ([id, issue]) =>
        issue !== "empty" || (id !== typing && id !== adding?.id),
    ),
  );
  const typingNewName = target?.kind === "name" && s.footprint.kind === "new";
  const nameIssue =
    typingNewName && parsed.issues.name === "empty" ? null : parsed.issues.name;
  return { name, rows, adding, issues: { name: nameIssue, rows: rowIssues } };
}

function sourceOf(p: Projection): ViewSource<DraftRow> {
  return {
    rows: p.rows,
    draft: p.adding,
    mustShow: new Set(p.issues.rows.keys()),
  };
}

function viewSource(s: EditorState): ViewSource<DraftRow> {
  return sourceOf(project(s));
}

export type CellView =
  | {
      readonly mode: "display";
      readonly text: string;
      readonly match: Span | null;
    }
  | { readonly mode: "edit"; readonly text: string };

export interface VisibleRow {
  readonly id: RowId;
  readonly key: CellView;
  readonly value: CellView;
  readonly issue: RowIssue | null;
}

export interface DraftRowView {
  readonly id: RowId;
  readonly key: string;
  readonly value: string;
  readonly issue: RowIssue | null;
}

export interface TableView {
  readonly nameSort: NameSortIndicator;
  readonly rows: readonly VisibleRow[];
  readonly draft: DraftRowView | null;
}

export type LeavePrompt = { readonly reason: "discardNew" };

export interface EditorView {
  readonly mode: "create" | "edit";
  readonly name: {
    readonly text: string;
    readonly editing: boolean;
    readonly issue: NameIssue | null;
  };
  readonly color: Marker;
  readonly variableCount: number;
  readonly search: {
    readonly query: string;
    readonly filter: { readonly shown: number; readonly total: number } | null;
  };
  readonly table: TableView;
  readonly body: "rows" | "emptyEnv" | "noMatches";
  readonly status: QuietStatus;
  readonly creating: boolean;
  readonly undo: { readonly id: RowId; readonly key: string } | null;
  readonly prompt: LeavePrompt | null;
  readonly previewVars: Readonly<Record<string, string>>;
}

export interface ViewContext extends PaneContext {
  readonly status: QuietStatus;
}

function cellView(
  s: EditorState,
  cell: CellRef,
  text: string,
  match: Span | null,
): CellView {
  return sameTarget(s.field?.target, cell)
    ? { mode: "edit", text: s.field?.text ?? "" }
    : { mode: "display", text, match };
}

export function selectView(s: EditorState, ctx: ViewContext): EditorView {
  const p = project(s);
  const v = viewRows(sourceOf(p), s.view, ctx.sort);
  const create = s.footprint.kind === "new";
  const editingName = s.field?.target.kind === "name";
  const draftEntry = v.entries.find((entry) => entry.draft);
  return {
    mode: create ? "create" : "edit",
    name: {
      text: editingName && s.field ? s.field.text : s.draft.name,
      editing: create || editingName,
      issue: p.issues.name,
    },
    color: paintMarker(s.draft.color, p.name),
    variableCount: s.draft.rows.length,
    search: {
      query: s.view.query,
      filter: v.filtering ? { shown: v.shown, total: v.total } : null,
    },
    table: {
      nameSort: nameSortIndicator(ctx.sort),
      rows: v.entries
        .filter((entry) => !entry.draft)
        .map(({ row, match }) => ({
          id: row.id,
          key: cellView(s, { kind: "key", rowId: row.id }, row.key, match),
          value: cellView(s, { kind: "value", rowId: row.id }, row.value, null),
          issue: p.issues.rows.get(row.id) ?? null,
        })),
      draft: draftEntry
        ? {
            id: draftEntry.row.id,
            key: draftEntry.row.key,
            value: draftEntry.row.value,
            issue: p.issues.rows.get(draftEntry.row.id) ?? null,
          }
        : null,
    },
    body: v.noMatches
      ? "noMatches"
      : v.total === 0 && !draftEntry
        ? "emptyEnv"
        : "rows",
    status:
      create &&
      ctx.status.kind === "notSaved" &&
      ctx.status.reason === "invalid"
        ? { kind: "hidden" }
        : ctx.status,
    creating: create && s.save.inFlight !== null,
    undo: s.undo ? { id: s.undo.row.id, key: s.undo.row.key } : null,
    prompt: s.leaving ? { reason: "discardNew" } : null,
    previewVars: Object.fromEntries(
      s.draft.rows
        .filter((row) => row.key !== "")
        .map((row) => [row.key, row.value]),
    ),
  };
}
