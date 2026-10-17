import { ENV_COLORS, defaultColorKeyForName } from "./colors";
import {
  colorKey,
  draftFromStored,
  goalFromStored,
  mintRowId,
  parseDraft,
  type ColorKey,
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
import { afterSync, footprintNames, type Footprint, type SyncOutcome } from "./envSync";
import {
  createQueue,
  queueStatus,
  stepQueue,
  type QueueEvent,
  type Rev,
  type SaveFailure,
  type SaveQueue,
  type SaveStatus,
  type Urgency,
} from "./saveQueue";
import {
  holdLayout,
  initialView,
  neighborOf,
  releaseLayout,
  setQuery,
  setSort,
  showAnyway,
  viewRows,
  type SortMode,
  type Span,
  type ViewSource,
  type ViewState,
} from "./varView";

export type LeaveTarget =
  | { readonly to: "close" }
  | { readonly to: "switch"; readonly name: EnvName }
  | { readonly to: "delete" };

export type LeaveOutcome =
  | { readonly kind: "closed" }
  | { readonly kind: "switched"; readonly to: EnvName }
  | { readonly kind: "deleteRequested"; readonly name: EnvName };

export type FieldTarget = { readonly kind: "name" } | { readonly kind: "key"; readonly rowId: RowId };

export interface FieldDraft {
  readonly target: FieldTarget;
  readonly text: string;
}

export type FocusTarget =
  | { readonly kind: "name" }
  | { readonly kind: "search" }
  | { readonly kind: "key"; readonly rowId: RowId }
  | { readonly kind: "value"; readonly rowId: RowId }
  | { readonly kind: "add" };

export function fieldAttr(target: FocusTarget): string {
  return target.kind === "key" || target.kind === "value" ? `${target.kind}:${target.rowId}` : target.kind;
}

export const PALETTE = ENV_COLORS.map((c) => ({ key: colorKey(c.key), label: c.label, hex: c.hex }));

export interface EditorState {
  readonly footprint: Footprint;
  readonly draft: EnvDraft;
  readonly field: FieldDraft | null;
  readonly pending: RowId | null;
  readonly view: ViewState;
  readonly save: SaveQueue<EnvGoal>;
  readonly envs: readonly EnvSummary[];
  readonly undo: { readonly row: DraftRow; readonly index: number } | null;
  readonly leaving: LeaveTarget | null;
  readonly seq: number;
}

export type EditorIntent =
  | { readonly type: "typeName"; readonly text: string }
  | { readonly type: "commitName" }
  | { readonly type: "pickColor"; readonly color: ColorKey }
  | { readonly type: "typeKey"; readonly rowId: RowId; readonly text: string }
  | { readonly type: "commitKey"; readonly rowId: RowId; readonly via: "enter" | "blur" }
  | { readonly type: "editValue"; readonly rowId: RowId; readonly text: string }
  | { readonly type: "addRow" }
  | { readonly type: "deleteRow"; readonly rowId: RowId }
  | { readonly type: "undoDelete" }
  | { readonly type: "setQuery"; readonly text: string }
  | { readonly type: "clearSearch" }
  | { readonly type: "setSort"; readonly sort: SortMode }
  | { readonly type: "leave"; readonly target: LeaveTarget }
  | { readonly type: "create" }
  | { readonly type: "retry" }
  | { readonly type: "discard" }
  | { readonly type: "keepEditing" };

export type SystemAction =
  | { readonly type: "regionFocus"; readonly inside: boolean }
  | { readonly type: "timerFired" }
  | { readonly type: "syncSettled"; readonly rev: Rev; readonly outcome: SyncOutcome }
  | { readonly type: "envsChanged"; readonly envs: readonly EnvSummary[] };

export type EditorAction = EditorIntent | SystemAction;

export interface Cleanup {
  readonly goal: EnvGoal | null;
  readonly footprint: Footprint;
}

export type EditorEffect =
  | { readonly type: "armSaveTimer" }
  | { readonly type: "cancelSaveTimer" }
  | { readonly type: "sync"; readonly rev: Rev; readonly goal: EnvGoal; readonly footprint: Footprint }
  | { readonly type: "stored"; readonly activated: EnvName | null }
  | { readonly type: "publish"; readonly goal: EnvGoal; readonly previousName: EnvName }
  | { readonly type: "leave"; readonly outcome: LeaveOutcome; readonly cleanup: Cleanup | null }
  | { readonly type: "focus"; readonly target: FocusTarget };

export function initEditor(env: OpenEnv | null, envs: readonly EnvSummary[]): EditorState {
  const { draft, seq } = draftFromStored(env, 0);
  return {
    footprint: env
      ? { kind: "stored", name: env.name, index: env.index, strays: [] }
      : { kind: "new", strays: [] },
    draft,
    field: env ? null : { target: { kind: "name" }, text: "" },
    pending: null,
    view: initialView,
    save: createQueue(env ? goalFromStored(env) : null),
    envs,
    undo: null,
    leaving: null,
    seq,
  };
}

export function editorStep(
  state: EditorState,
  action: EditorAction,
): { readonly state: EditorState; readonly effects: readonly EditorEffect[] } {
  const fx: EditorEffect[] = [];
  return { state: reduce(state, action, fx), effects: fx };
}

function reduce(s: EditorState, a: EditorAction, fx: EditorEffect[]): EditorState {
  switch (a.type) {
    case "typeName":
      return { ...s, field: { target: { kind: "name" }, text: a.text } };
    case "commitName":
      return commitName(s, fx);
    case "pickColor":
      return a.color === s.draft.color ? s : stageSave({ ...s, draft: { ...s.draft, color: a.color } }, "now", fx);
    case "typeKey":
      if (a.rowId !== s.pending && !s.draft.rows.some((row) => row.id === a.rowId)) return s;
      return { ...s, field: { target: { kind: "key", rowId: a.rowId }, text: a.text } };
    case "commitKey":
      return commitKey(s, a.rowId, a.via, fx);
    case "editValue":
      return editValue(s, a.rowId, a.text, fx);
    case "addRow":
      return addRow(s, fx);
    case "deleteRow":
      return deleteRow(s, a.rowId, fx);
    case "undoDelete":
      return undoDelete(s, fx);
    case "setQuery":
      return withView(s, setQuery(s.view, a.text));
    case "clearSearch":
      fx.push({ type: "focus", target: { kind: "search" } });
      return withView(s, releaseLayout(setQuery(s.view, "")));
    case "setSort":
      return withView(s, setSort(s.view, a.sort));
    case "regionFocus":
      return withView(s, a.inside ? holdLayout(s.view, viewSource(s)) : releaseLayout(s.view));
    case "leave":
      return requestLeave(commitOpenField(s, fx), a.target, fx);
    case "create":
      return create(s, fx);
    case "retry":
      return queue(s, { type: "flush" }, fx);
    case "discard":
      return s.leaving && !s.save.inFlight ? leaveNow(s, s.leaving, fx) : s;
    case "keepEditing":
      if (!s.leaving) return s;
      if (queueStatus(s.save).kind === "invalid") focusFirstIssue(s, fx);
      return { ...s, leaving: null };
    case "timerFired":
      return queue(s, { type: "timerFired" }, fx);
    case "syncSettled":
      return settle(s, a.rev, a.outcome, fx);
    case "envsChanged": {
      if (a.envs === s.envs) return s;
      const next = { ...s, envs: a.envs };
      const flipped = parseDraft(s.draft, taken(s)).ok !== parseDraft(next.draft, taken(next)).ok;
      return flipped ? stageSave(next, "debounce", fx) : next;
    }
  }
}

function withView(s: EditorState, view: ViewState): EditorState {
  return view === s.view ? s : { ...s, view };
}

function taken(s: EditorState): ReadonlySet<string> {
  const ours = new Set<string>(footprintNames(s.footprint));
  return new Set(s.envs.map((env) => env.name).filter((name) => !ours.has(name)));
}

function queue(s: EditorState, event: QueueEvent<EnvGoal>, fx: EditorEffect[]): EditorState {
  const step = stepQueue(s.save, event);
  for (const e of step.effects) {
    if (e.type === "send") fx.push({ type: "sync", rev: e.rev, goal: e.goal, footprint: s.footprint });
    else fx.push({ type: e.type === "armTimer" ? "armSaveTimer" : "cancelSaveTimer" });
  }
  return { ...s, save: step.queue };
}

function stageSave(s: EditorState, urgency: Urgency, fx: EditorEffect[]): EditorState {
  const parsed = parseDraft(s.draft, taken(s));
  const u: Urgency = s.footprint.kind === "new" ? "hold" : s.leaving ? "now" : urgency;
  return queue(s, parsed.ok ? { type: "edited", goal: parsed.goal, urgency: u } : { type: "invalid" }, fx);
}

function typedKey(s: EditorState, rowId: RowId): string | null {
  const field = s.field;
  return field?.target.kind === "key" && field.target.rowId === rowId ? field.text : null;
}

function focusKey(rowId: RowId): EditorEffect {
  return { type: "focus", target: { kind: "key", rowId } };
}

function patchRow(draft: EnvDraft, rowId: RowId, patch: Partial<Omit<DraftRow, "id">>): EnvDraft {
  return { ...draft, rows: draft.rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)) };
}

function commitName(s: EditorState, fx: EditorEffect[]): EditorState {
  if (s.field?.target.kind !== "name") return s;
  const name = s.field.text.trim();
  const next = { ...s, field: null };
  return name === s.draft.name ? next : stageSave({ ...next, draft: { ...s.draft, name } }, "now", fx);
}

function commitKey(s: EditorState, rowId: RowId, via: "enter" | "blur", fx: EditorEffect[]): EditorState {
  const typed = typedKey(s, rowId);
  const base = typed === null ? s : { ...s, field: null };
  if (rowId === s.pending) {
    const key = typed ?? "";
    if (key === "") {
      if (via === "enter") fx.push({ type: "focus", target: { kind: "add" } });
      return { ...base, pending: null };
    }
    if (via === "enter") fx.push({ type: "focus", target: { kind: "value", rowId } });
    const draft = { ...s.draft, rows: [...s.draft.rows, { id: rowId, key, value: "" }] };
    return stageSave({ ...base, pending: null, draft, view: showAnyway(s.view, rowId) }, "now", fx);
  }
  const row = s.draft.rows.find((r) => r.id === rowId);
  if (!row) return base;
  if (via === "enter") fx.push({ type: "focus", target: { kind: "value", rowId } });
  if (typed === null || typed === row.key) return base;
  return stageSave({ ...base, draft: patchRow(s.draft, rowId, { key: typed }) }, "now", fx);
}

function commitOpenField(s: EditorState, fx: EditorEffect[]): EditorState {
  const target = s.field?.target;
  const committed =
    target?.kind === "name"
      ? commitName(s, fx)
      : target?.kind === "key"
        ? commitKey(s, target.rowId, "blur", fx)
        : s;
  return committed.pending ? commitKey(committed, committed.pending, "blur", fx) : committed;
}

function editValue(s: EditorState, rowId: RowId, value: string, fx: EditorEffect[]): EditorState {
  const row = s.draft.rows.find((r) => r.id === rowId);
  if (!row || row.value === value) return s;
  return stageSave({ ...s, draft: patchRow(s.draft, rowId, { value }) }, "debounce", fx);
}

function addRow(s: EditorState, fx: EditorEffect[]): EditorState {
  if (s.pending) {
    fx.push(focusKey(s.pending));
    return s;
  }
  const { id, seq } = mintRowId(s.seq);
  fx.push(focusKey(id));
  return { ...s, seq, pending: id, view: holdLayout(s.view, viewSource(s)) };
}

function deleteRow(s: EditorState, rowId: RowId, fx: EditorEffect[]): EditorState {
  const index = s.draft.rows.findIndex((row) => row.id === rowId);
  if (index < 0) return s;
  const neighbor = neighborOf(viewRows(viewSource(s), s.view), rowId);
  fx.push(neighbor ? focusKey(neighbor) : { type: "focus", target: { kind: "add" } });
  const field = typedKey(s, rowId) === null ? s.field : null;
  const draft = { ...s.draft, rows: s.draft.rows.filter((row) => row.id !== rowId) };
  return stageSave({ ...s, field, draft, undo: { row: s.draft.rows[index], index } }, "now", fx);
}

function undoDelete(s: EditorState, fx: EditorEffect[]): EditorState {
  if (!s.undo) return s;
  const { row, index } = s.undo;
  const rows = [...s.draft.rows];
  rows.splice(Math.min(index, rows.length), 0, row);
  fx.push(focusKey(row.id));
  return stageSave({ ...s, undo: null, draft: { ...s.draft, rows }, view: showAnyway(s.view, row.id) }, "now", fx);
}

function create(s: EditorState, fx: EditorEffect[]): EditorState {
  if (s.footprint.kind !== "new" || s.save.inFlight) return s;
  const next = { ...commitOpenField(s, fx), leaving: null };
  if (!parseDraft(next.draft, taken(next)).ok) {
    focusFirstIssue(next, fx);
    return next;
  }
  return queue(next, { type: "flush" }, fx);
}

function isBlank(draft: EnvDraft): boolean {
  return draft.name === "" && draft.color === null && draft.rows.length === 0;
}

function requestLeave(s: EditorState, target: LeaveTarget, fx: EditorEffect[]): EditorState {
  if (s.footprint.kind === "new") {
    if (s.save.inFlight) return s;
    return isBlank(s.draft) ? leaveNow(s, target, fx) : { ...s, leaving: target };
  }
  const sound = soundDraft(s, fx);
  const status = queueStatus(sound.save).kind;
  const flushed =
    status === "clean" || status === "saved" || status === "invalid" ? sound : queue(sound, { type: "flush" }, fx);
  const head = flushed.save.head;
  if (head.state === "writable" && head.rev !== flushed.save.acked.rev && flushed.footprint.kind === "stored") {
    fx.push({ type: "publish", goal: head.goal, previousName: flushed.footprint.name });
  }
  return leaveNow(flushed, target, fx);
}

function soundDraft(s: EditorState, fx: EditorEffect[]): EditorState {
  const scratch: EditorEffect[] = [];
  const committed = commitOpenField(s, scratch);
  if (parseDraft(committed.draft, taken(committed)).ok) {
    fx.push(...scratch);
    return committed;
  }
  const rowId = s.field?.target.kind === "key" ? s.field.target.rowId : null;
  return salvage({ ...s, field: null, pending: rowId !== null && s.pending === rowId ? null : s.pending }, fx);
}

function salvage(s: EditorState, fx: EditorEffect[]): EditorState {
  const parsed = parseDraft(s.draft, taken(s));
  if (parsed.ok) return s;
  const acked = s.save.acked.goal;
  if (!acked) return s;
  const good = new Map(s.draft.rows.filter((row) => !parsed.issues.rows.has(row.id)).map((row) => [row.key, row]));
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
  const draft: EnvDraft = { name: parsed.issues.name ? acked.name : s.draft.name, color: s.draft.color, rows };
  const next = { ...s, draft, field: null, pending: null, seq, undo: null };
  const again = parseDraft(draft, taken(next));
  if (!again.ok) return { ...next, save: s.save };
  if (sameVariables(again.goal, acked)) return { ...next, save: s.save };
  return stageSave(next, "now", fx);
}

function sameVariables(goal: EnvGoal, acked: EnvGoal): boolean {
  if (goal.name !== acked.name || goal.color !== acked.color || goal.variables.length !== acked.variables.length) {
    return false;
  }
  return goal.variables.every(([key, value], index) => {
    const other = acked.variables[index];
    return other !== undefined && other[0] === key && other[1] === value;
  });
}

function leaveNow(s: EditorState, target: LeaveTarget, fx: EditorEffect[]): EditorState {
  const fp = s.footprint;
  const cleanup = fp.strays.length > 0 ? { goal: s.save.acked.goal, footprint: fp } : null;
  const outcome: LeaveOutcome =
    target.to === "switch"
      ? { kind: "switched", to: target.name }
      : target.to === "delete" && fp.kind === "stored"
        ? { kind: "deleteRequested", name: fp.name }
        : { kind: "closed" };
  fx.push({ type: "leave", outcome, cleanup });
  return { ...s, leaving: null };
}

function focusFirstIssue(s: EditorState, fx: EditorEffect[]): void {
  const parsed = parseDraft(s.draft, taken(s));
  if (parsed.ok) return;
  if (parsed.issues.name) {
    fx.push({ type: "focus", target: { kind: "name" } });
    return;
  }
  const first = viewRows(viewSource(s), s.view).entries.find((entry) => parsed.issues.rows.has(entry.row.id));
  if (first) fx.push(focusKey(first.row.id));
}

function settle(s: EditorState, rev: Rev, outcome: SyncOutcome, fx: EditorEffect[]): EditorState {
  const flight = s.save.inFlight;
  if (!flight || flight.rev !== rev) return s;
  const wasNew = s.footprint.kind === "new";
  const footprint = afterSync(s.footprint, flight.goal, outcome);
  const next = queue(
    { ...s, footprint },
    outcome.ok ? { type: "settled", rev, ok: true } : { type: "settled", rev, ok: false, error: outcome.error },
    fx,
  );
  if (!outcome.ok) return next;
  fx.push({ type: "stored", activated: outcome.activated });
  if (wasNew) return requestLeave(next, { to: "close" }, fx);
  return next.leaving && queueStatus(next.save).kind === "saved" ? leaveNow(next, next.leaving, fx) : next;
}

interface Projection {
  readonly name: string;
  readonly rows: readonly DraftRow[];
  readonly pending: DraftRow | null;
  readonly issues: DraftIssues;
}

const NO_ISSUES: DraftIssues = { name: null, rows: new Map() };

function project(s: EditorState): Projection {
  const rows = s.draft.rows.map((row) => {
    const typed = typedKey(s, row.id);
    return typed === null ? row : { ...row, key: typed };
  });
  const pending = s.pending ? { id: s.pending, key: typedKey(s, s.pending) ?? "", value: "" } : null;
  const target = s.field?.target;
  const name = target?.kind === "name" && s.field ? s.field.text.trim() : s.draft.name;
  const parsed = parseDraft({ name, color: s.draft.color, rows: pending ? [...rows, pending] : rows }, taken(s));
  if (parsed.ok) return { name, rows, pending, issues: NO_ISSUES };
  const typing = target?.kind === "key" ? target.rowId : null;
  const rowIssues = new Map(
    [...parsed.issues.rows].filter(([id, issue]) => issue !== "empty" || (id !== typing && id !== s.pending)),
  );
  const nameIssue = target?.kind === "name" && parsed.issues.name === "empty" ? null : parsed.issues.name;
  return { name, rows, pending, issues: { name: nameIssue, rows: rowIssues } };
}

function sourceOf(p: Projection): ViewSource<DraftRow> {
  return { rows: p.rows, pending: p.pending, mustShow: new Set(p.issues.rows.keys()) };
}

function viewSource(s: EditorState): ViewSource<DraftRow> {
  return sourceOf(project(s));
}

export interface VisibleRow {
  readonly id: RowId;
  readonly keyText: string;
  readonly value: string;
  readonly match: Span | null;
  readonly issue: RowIssue | null;
  readonly pending: boolean;
  /** 1-based position in added order. Stable when the view sorts. */
  readonly added: number;
}

export type LeavePrompt =
  | { readonly reason: "failed"; readonly error: SaveFailure }
  | { readonly reason: "invalid"; readonly busy: boolean }
  | { readonly reason: "discardNew" };

export interface EditorView {
  readonly mode: "create" | "edit";
  readonly subject: EnvSummary | null;
  readonly switchTargets: readonly EnvSummary[];
  readonly name: { readonly text: string; readonly issue: NameIssue | null };
  readonly color: ColorKey;
  readonly search: {
    readonly query: string;
    readonly sort: SortMode;
    readonly shown: number;
    readonly total: number;
    readonly noMatches: boolean;
  };
  readonly rows: readonly VisibleRow[];
  readonly status: SaveStatus;
  readonly undo: { readonly key: string } | null;
  readonly prompt: LeavePrompt | null;
  readonly previewVars: Readonly<Record<string, string>>;
}

function promptOf(s: EditorState, status: SaveStatus): LeavePrompt | null {
  if (!s.leaving) return null;
  if (s.footprint.kind === "new") return { reason: "discardNew" };
  if (status.kind === "failed") return { reason: "failed", error: status.error };
  if (status.kind === "invalid") return { reason: "invalid", busy: s.save.inFlight !== null };
  return null;
}

export function selectView(s: EditorState): EditorView {
  const p = project(s);
  const v = viewRows(sourceOf(p), s.view);
  const status = queueStatus(s.save);
  const fp = s.footprint;
  const ours = new Set<string>(footprintNames(fp));
  return {
    mode: fp.kind === "new" ? "create" : "edit",
    subject:
      fp.kind === "stored"
        ? { name: fp.name, color: s.save.acked.goal?.color ?? colorKey(defaultColorKeyForName(fp.name)) }
        : null,
    switchTargets: s.envs.filter((env) => !ours.has(env.name)),
    name: { text: s.field?.target.kind === "name" ? s.field.text : s.draft.name, issue: p.issues.name },
    color: s.draft.color ?? colorKey(defaultColorKeyForName(p.name)),
    search: { query: s.view.query, sort: s.view.sort, shown: v.shown, total: v.total, noMatches: v.noMatches },
    rows: v.entries.map(({ row, match, pending }) => ({
      id: row.id,
      keyText: row.key,
      value: row.value,
      match,
      issue: p.issues.rows.get(row.id) ?? null,
      pending,
      added: s.draft.rows.findIndex((stored) => stored.id === row.id) + 1 || s.draft.rows.length + 1,
    })),
    status,
    undo: s.undo ? { key: s.undo.row.key } : null,
    prompt: promptOf(s, status),
    previewVars: Object.fromEntries(s.draft.rows.filter((row) => row.key !== "").map((row) => [row.key, row.value])),
  };
}
