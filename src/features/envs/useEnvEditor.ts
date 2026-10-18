import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";

import type { EnvironmentIpc, ResolutionReportIpc } from "@/ipc/bindings";
import { ipc } from "@/ipc/client";
import { messages } from "@/lib/messages";

import { paintMarker } from "./colors";
import {
  colorKey,
  storedName,
  type EnvGoal,
  type EnvName,
  type EnvSummary,
  type OpenEnv,
  type Variable,
} from "./envDraft";
import {
  editorStep,
  escapeIntent,
  fieldAttr,
  initEditor,
  resumeEditor,
  selectView,
  settleStep,
  type Cleanup,
  type Destination,
  type EditorState,
  type EditorView,
  type FocusTarget,
  type LeaveOutcome,
  type PaneAction,
  type PaneContext,
  type PaneEffect,
  type PaneIntent,
  type Step,
  type Subject,
} from "./envEditor";
import {
  initSession,
  sessionStep,
  type SessionCommand,
  type SessionCore,
  type SessionEvent,
  type SessionIntent,
} from "./envSession";
import {
  deleteEnvironment,
  syncEnv,
  type Footprint,
  type SyncOutcome,
} from "./envSync";
import { isFindHotkey } from "./findHotkey";
import {
  attachClock,
  nextQuietWake,
  observeClock,
  quietStatus,
  type QuietClock,
  type QuietStatus,
  type Rev,
  type SaveFailure,
  type SaveQueue,
} from "./saveQueue";
import type { SortMode } from "./varView";

export const ENV_AUTOSAVE_DELAY_MS = 500;

export interface UseEnvEditorProps {
  /** Read once. Afterwards the session owns which environment is shown. Null opens create mode. */
  readonly opened: string | null;
  readonly envs: readonly EnvironmentIpc[];
  readonly onStored: (event: { readonly activated: EnvName | null }) => void;
  readonly onDeleted: (event: { readonly name: EnvName }) => void;
  readonly onClosed: () => void;
  readonly onOptimistic?: (env: EnvironmentIpc, previousName: string) => void;
  readonly onReverted?: (currentName: string, env: EnvironmentIpc) => void;
}

export type EditorIntent = PaneIntent | SessionIntent;

export interface EnvListRow {
  readonly name: EnvName;
  readonly paint: string;
  readonly selected: boolean;
  readonly notSaved: boolean;
}

export interface EnvListView {
  readonly rows: readonly EnvListRow[];
  readonly draft: { readonly label: string; readonly paint: string } | null;
  readonly inert: boolean;
}

export interface ConfirmView {
  readonly name: EnvName;
  readonly variables: number;
  readonly phase: "asking" | "deleting";
  readonly ready: boolean;
  readonly error: SaveFailure | null;
}

export interface EnvEditorHandle {
  readonly paneKey: number;
  readonly sort: SortMode;
  readonly list: EnvListView;
  readonly pane: EditorView | null;
  readonly confirm: ConfirmView | null;
  readonly dispatch: (intent: EditorIntent) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly contentProps: {
    readonly onOpenAutoFocus: (e: Event) => void;
    readonly onEscapeKeyDown: (e: globalThis.KeyboardEvent) => void;
    readonly onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  };
  readonly contentRef: RefObject<HTMLDivElement>;
  readonly regionProps: {
    readonly tabIndex: -1;
    readonly onFocus: () => void;
    readonly onBlur: (e: FocusEvent<HTMLElement>) => void;
  };
  readonly resolveRow: (value: string) => Promise<ResolutionReportIpc>;
  readonly resolveKey: string;
}

interface LaneSink {
  readonly ctx: () => PaneContext;
  readonly run: (effects: readonly PaneEffect[]) => void;
}

interface LaneHooks {
  readonly onStored: UseEnvEditorProps["onStored"];
  readonly onReverted: (currentName: string, env: EnvironmentIpc) => void;
}

interface EnvLane {
  state: EditorState;
  clock: QuietClock;
  sink: LaneSink | null;
  hooks: LaneHooks;
}

const lanes = new Map<EnvName, EnvLane>();
const listeners = new Set<() => void>();
let mountedSessions = 0;
let failedSnapshot: ReadonlySet<EnvName> = new Set();

export function resetEnvSaveLanes(): void {
  lanes.clear();
  mountedSessions = 0;
  failedSnapshot = new Set();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function failedOffScreen(): ReadonlySet<EnvName> {
  return failedSnapshot;
}

function emit(): void {
  const failed = new Set<EnvName>();
  for (const [name, lane] of lanes)
    if (lane.sink === null && lane.state.save.failure) failed.add(name);
  if (
    failed.size === failedSnapshot.size &&
    [...failed].every((name) => failedSnapshot.has(name))
  )
    return;
  failedSnapshot = failed;
  for (const listener of listeners) listener();
}

function storedNameOf(fp: Footprint): EnvName | null {
  return fp.kind === "stored" ? fp.name : null;
}

function isIdle(q: SaveQueue<EnvGoal>): boolean {
  return q.inFlight === null && !q.sendOnSettle && !q.timer;
}

function rekey(lane: EnvLane, before: Footprint): void {
  const was = storedNameOf(before);
  const now = storedNameOf(lane.state.footprint);
  if (was === now) return;
  if (was !== null && lanes.get(was) === lane) lanes.delete(was);
  if (now !== null) lanes.set(now, lane);
}

function advance(lane: EnvLane, step: Step): void {
  const before = lane.state.footprint;
  lane.state = step.state;
  lane.clock = observeClock(lane.clock, step.state.save, Date.now());
  rekey(lane, before);
  const pane: PaneEffect[] = [];
  for (const effect of step.effects) {
    switch (effect.type) {
      case "sync": {
        const { rev, goal, footprint } = effect;
        void syncEnv(goal, footprint).then((outcome) =>
          settle(lane, rev, outcome),
        );
        break;
      }
      case "stored":
        lane.hooks.onStored({ activated: effect.activated });
        break;
      default:
        pane.push(effect);
    }
  }
  lane.sink?.run(pane);
  retire(lane);
  emit();
}

function settle(lane: EnvLane, rev: Rev, outcome: SyncOutcome): void {
  advance(lane, settleStep(lane.state, rev, outcome));
  const q = lane.state.save;
  if (
    !outcome.ok &&
    lane.sink === null &&
    q.inFlight === null &&
    !q.sendOnSettle
  ) {
    const acked = q.acked.goal;
    const currentName =
      q.head.state === "writable" ? q.head.goal.name : acked?.name;
    if (acked && currentName)
      lane.hooks.onReverted(currentName, environmentOf(acked));
  }
}

function retire(lane: EnvLane): void {
  if (lane.sink !== null || mountedSessions > 0) return;
  const q = lane.state.save;
  if (q.inFlight !== null || q.sendOnSettle) return;
  const name = storedNameOf(lane.state.footprint);
  if (name !== null && lanes.get(name) === lane) lanes.delete(name);
}

function laneFor(
  to: Subject,
  envs: readonly EnvironmentIpc[],
  summaries: readonly EnvSummary[],
  hooks: LaneHooks,
): EnvLane {
  const now = Date.now();
  const hit = to.kind === "stored" ? lanes.get(to.name) : undefined;
  if (hit) {
    hit.state = resumeEditor(hit.state);
    hit.clock = attachClock(hit.state.save, now);
    hit.hooks = hooks;
    return hit;
  }
  const state = initEditor(
    to.kind === "stored" ? openEnv(to.name, envs) : null,
    summaries,
  );
  const lane: EnvLane = {
    state,
    clock: attachClock(state.save, now),
    sink: null,
    hooks,
  };
  if (to.kind === "stored") lanes.set(to.name, lane);
  return lane;
}

function destinationOf(lane: EnvLane | null): Destination {
  if (!lane) return { kind: "empty" };
  const fp = lane.state.footprint;
  return fp.kind === "stored"
    ? { kind: "stored", name: fp.name }
    : { kind: "new" };
}

const SESSION_INTENTS: Readonly<Record<SessionIntent["type"], true>> = {
  setSort: true,
  toggleNameSort: true,
  select: true,
  createNew: true,
  cancelCreate: true,
  close: true,
  requestDelete: true,
  confirmDelete: true,
  cancelDelete: true,
};

function isSessionIntent(intent: EditorIntent): intent is SessionIntent {
  return Object.hasOwn(SESSION_INTENTS, intent.type);
}

interface ControllerDeps {
  readonly props: () => UseEnvEditorProps;
  readonly summaries: () => readonly EnvSummary[];
  readonly render: () => void;
  readonly focus: (target: FocusTarget) => void;
}

type Controller = ReturnType<typeof createController>;

function createController(opened: string | null, deps: ControllerDeps) {
  const hooks: LaneHooks = {
    onStored: (event) => deps.props().onStored(event),
    onReverted: (currentName, env) =>
      deps.props().onReverted?.(currentName, env),
  };
  let core: SessionCore = initSession();
  let lane: EnvLane | null = laneFor(
    opened === null
      ? { kind: "new" }
      : { kind: "stored", name: storedName(opened) },
    deps.props().envs,
    deps.summaries(),
    hooks,
  );
  let ended = false;
  let mounted = false;
  let closing = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const sink: LaneSink = {
    ctx: () => ({ sort: core.sort }),
    run(effects) {
      let focus: FocusTarget | null = null;
      for (const effect of effects) {
        switch (effect.type) {
          case "armSaveTimer":
            clearTimeout(timer);
            timer = setTimeout(() => {
              if (lane) step(lane, { type: "timerFired" });
            }, ENV_AUTOSAVE_DELAY_MS);
            break;
          case "cancelSaveTimer":
            clearTimeout(timer);
            break;
          case "publish":
            deps
              .props()
              .onOptimistic?.(environmentOf(effect.goal), effect.previousName);
            break;
          case "leave":
            left(effect.outcome, effect.cleanup);
            break;
          case "focus":
            focus = effect.target;
            break;
        }
      }
      if (focus === null) deps.render();
      else {
        flushSync(deps.render);
        deps.focus(focus);
      }
    },
  };

  function step(target: EnvLane, action: PaneAction): void {
    advance(target, editorStep(target.state, action, sink.ctx()));
  }

  function left(outcome: LeaveOutcome, cleanup: Cleanup | null): void {
    if (cleanup === null) {
      session({ type: "left", outcome });
      return;
    }
    closing = true;
    void syncEnv(cleanup.goal, cleanup.footprint).then((result) => {
      closing = false;
      if (result.ok) hooks.onStored({ activated: result.activated });
      else toast.error(messages.envs.editor.cleanupFailed);
      session({ type: "left", outcome });
    });
  }

  function session(e: SessionEvent): void {
    if (ended) return;
    const facts = {
      attached: destinationOf(lane),
      names: deps.summaries().map((env) => env.name),
      idle: lane === null || isIdle(lane.state.save),
    };
    const next = sessionStep(core, e, facts);
    const changed = next.core !== core;
    core = next.core;
    for (const command of next.commands) run(command);
    if (changed) deps.render();
  }

  function run(command: SessionCommand): void {
    switch (command.run) {
      case "pane":
        if (lane) step(lane, command.action);
        break;
      case "delete":
        remove();
        break;
      case "deleted":
        deps.props().onDeleted({ name: command.name });
        break;
      case "attach":
        attach(command.to);
        flushSync(deps.render);
        deps.focus(command.focus);
        break;
      case "focus":
        deps.focus(command.target);
        break;
      case "end":
        ended = true;
        detach();
        deps.props().onClosed();
        break;
    }
  }

  function remove(): void {
    const target = lane;
    const name = target ? storedNameOf(target.state.footprint) : null;
    if (!target || name === null) return;
    void deleteEnvironment(target.state.footprint).then((outcome) => {
      if (outcome.ok && lanes.get(name) === target) lanes.delete(name);
      session({ type: "deleteSettled", name, outcome });
    });
  }

  function detach(): void {
    clearTimeout(timer);
    if (!lane) return;
    lane.sink = null;
    retire(lane);
    emit();
  }

  function attach(to: Destination): void {
    detach();
    if (to.kind === "empty") {
      lane = null;
      return;
    }
    const next = laneFor(to, deps.props().envs, deps.summaries(), hooks);
    next.sink = sink;
    lane = next;
    emit();
    envsChanged(deps.summaries());
  }

  function envsChanged(summaries: readonly EnvSummary[]): void {
    if (lane && lane.state.envs !== summaries)
      step(lane, { type: "envsChanged", envs: summaries });
  }

  return {
    core: () => core,
    lane: () => lane,
    closing: () => closing,
    dispatch(intent: EditorIntent): void {
      if (ended || closing) return;
      if (isSessionIntent(intent)) session(intent);
      else if (lane) step(lane, intent);
    },
    paneAction(action: PaneAction): void {
      if (!ended && lane) step(lane, action);
    },
    envsChanged,
    mount(): void {
      if (mounted) return;
      mounted = true;
      mountedSessions += 1;
      if (ended || !lane) return;
      lane.sink = sink;
      const name = storedNameOf(lane.state.footprint);
      if (name !== null) lanes.set(name, lane);
      emit();
    },
    unmount(): void {
      if (!mounted) return;
      mounted = false;
      mountedSessions -= 1;
      clearTimeout(timer);
      if (lane) lane.sink = null;
      for (const each of [...lanes.values()]) retire(each);
      emit();
    },
  };
}

function focusIn(
  root: HTMLElement | null,
  target: FocusTarget,
): HTMLElement | null {
  const attr = fieldAttr(target);
  const nodes = root
    ? Array.from(root.querySelectorAll<HTMLElement>("[data-field]"))
    : [];
  const el = nodes.find((node) => node.dataset.field === attr) ?? null;
  el?.focus({ preventScroll: true });
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.setSelectionRange(el.value.length, el.value.length);
  }
  revealFully(el);
  return el;
}

export function revealDelta(
  bottom: number,
  portBottom: number,
  padding: number,
): number {
  return Math.max(0, bottom + padding - portBottom);
}

function revealFully(el: HTMLElement | null): void {
  const row = el?.closest("tr");
  if (!row) return;
  row.scrollIntoView({ block: "nearest", inline: "nearest" });
  const scroller = scrollParent(row);
  if (!scroller) return;
  const padding = Number.parseFloat(getComputedStyle(scroller).paddingBottom);
  const hidden = revealDelta(
    row.getBoundingClientRect().bottom,
    scroller.getBoundingClientRect().bottom,
    Number.isFinite(padding) ? padding : 0,
  );
  if (hidden > 0) scroller.scrollTop += hidden;
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll") return node;
  }
  return null;
}

const HIDDEN: QuietStatus = { kind: "hidden" };

export function useEnvEditor(props: UseEnvEditorProps): EnvEditorHandle {
  const latest = useRef(props);
  latest.current = props;
  const summaries = useMemo(() => summarize(props.envs), [props.envs]);
  const summariesRef = useRef(summaries);
  summariesRef.current = summaries;
  const [, render] = useReducer((n: number) => n + 1, 0);
  const contentRef = useRef<HTMLDivElement>(null);
  const [ctl] = useState<Controller>(() =>
    createController(props.opened, {
      props: () => latest.current,
      summaries: () => summariesRef.current,
      render,
      focus: (target) => void focusIn(contentRef.current, target),
    }),
  );

  useEffect(() => {
    ctl.mount();
    return () => ctl.unmount();
  }, [ctl]);

  useEffect(() => ctl.envsChanged(summaries), [ctl, summaries]);

  const failed = useSyncExternalStore(subscribe, failedOffScreen);
  const core = ctl.core();
  const lane = ctl.lane();
  const now = Date.now();
  const status = lane ? quietStatus(lane.state.save, lane.clock, now) : HIDDEN;
  const wake = lane ? nextQuietWake(lane.state.save, lane.clock, now) : null;

  useEffect(() => {
    if (wake === null) return;
    const id = setTimeout(render, Math.max(0, wake - Date.now()));
    return () => clearTimeout(id);
  }, [wake]);

  const pane = lane
    ? selectView(lane.state, { sort: core.sort, status })
    : null;
  const at = destinationOf(lane);
  const list: EnvListView = {
    rows: props.envs.map((env) => {
      const name = storedName(env.name);
      const selected = at.kind === "stored" && at.name === name;
      return {
        name,
        paint:
          selected && pane
            ? pane.color.paint
            : paintMarker(env.color ?? null, env.name).paint,
        selected,
        notSaved: failed.has(name),
      };
    }),
    draft:
      at.kind === "new" && pane
        ? {
            label:
              pane.name.text.trim() || messages.envs.editor.newEnvironmentRow,
            paint: pane.color.paint,
          }
        : null,
    inert: core.confirm?.phase === "deleting" || ctl.closing(),
  };
  const confirm: ConfirmView | null =
    core.confirm && lane && at.kind === "stored"
      ? {
          name: at.name,
          variables: lane.state.draft.rows.length,
          phase: core.confirm.phase,
          ready: isIdle(lane.state.save),
          error: core.confirm.error,
        }
      : null;

  const preview = useRef<Readonly<Record<string, string>>>({});
  preview.current = pane?.previewVars ?? {};
  const resolveRow = useCallback(
    (template: string) =>
      ipc.varsResolve(template, {
        collection_id: null,
        collection_vars: null,
        env_vars: { ...preview.current },
      }),
    [],
  );
  const resolveKey = JSON.stringify(preview.current);

  const dispatch = ctl.dispatch;
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (!open) ctl.dispatch({ type: "close" });
    },
    [ctl],
  );

  const contentProps = useMemo(
    () => ({
      onOpenAutoFocus: (e: Event) => {
        e.preventDefault();
        const attached = destinationOf(ctl.lane());
        const target: FocusTarget =
          attached.kind === "stored"
            ? { kind: "search" }
            : attached.kind === "new"
              ? { kind: "name" }
              : { kind: "newEnv" };
        focusIn(contentRef.current, target);
      },
      onEscapeKeyDown: (e: globalThis.KeyboardEvent) => {
        const current = ctl.lane();
        if (!current) return;
        const el = document.activeElement;
        const focused =
          el instanceof HTMLElement && contentRef.current?.contains(el)
            ? (el.dataset.field ?? null)
            : null;
        const intent = escapeIntent(current.state, focused);
        if (intent === null) return;
        e.preventDefault();
        ctl.dispatch(intent);
      },
      onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
        if (!isFindHotkey(e)) return;
        e.preventDefault();
        const search = focusIn(contentRef.current, { kind: "search" });
        if (search instanceof HTMLInputElement) search.select();
      },
    }),
    [ctl],
  );

  const regionProps = useMemo(
    () => ({
      tabIndex: -1 as const,
      onFocus: () => ctl.paneAction({ type: "regionFocus", inside: true }),
      onBlur: (e: FocusEvent<HTMLElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          ctl.paneAction({ type: "regionFocus", inside: false });
      },
    }),
    [ctl],
  );

  return {
    paneKey: core.paneKey,
    sort: core.sort,
    list,
    pane,
    confirm,
    dispatch,
    onOpenChange,
    contentProps,
    contentRef,
    regionProps,
    resolveRow,
    resolveKey,
  };
}

function environmentOf(goal: EnvGoal): EnvironmentIpc {
  return {
    name: goal.name,
    color: goal.color,
    variables: Object.fromEntries(goal.variables),
  };
}

function openEnv(name: EnvName, envs: readonly EnvironmentIpc[]): OpenEnv {
  const at = envs.findIndex((env) => env.name === name);
  const env = at < 0 ? null : envs[at];
  const variables = Object.entries(env?.variables ?? {}).flatMap(
    ([key, value]): Variable[] =>
      typeof value === "string" ? [[key, value]] : [],
  );
  return {
    name,
    color: env?.color != null ? colorKey(env.color) : null,
    variables,
    index: at < 0 ? envs.length : at,
  };
}

function summarize(envs: readonly EnvironmentIpc[]): EnvSummary[] {
  return envs.map((env) => ({ name: storedName(env.name) }));
}
