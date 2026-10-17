import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";

import type { EnvironmentIpc, ResolutionReportIpc } from "@/ipc/bindings";
import { ipc } from "@/ipc/client";
import { messages } from "@/lib/messages";

import { resolveColorKey } from "./colors";
import { colorKey, storedName, type EnvGoal, type EnvName, type EnvSummary, type OpenEnv, type Variable } from "./envDraft";
import {
  editorStep,
  fieldAttr,
  initEditor,
  selectView,
  type EditorAction,
  type EditorIntent,
  type EditorState,
  type EditorView,
  type FocusTarget,
  type LeaveOutcome,
} from "./envEditor";
import { syncEnv, type SyncOutcome } from "./envSync";
import { queueStatus, type Rev } from "./saveQueue";
import { isFindHotkey } from "./findHotkey";

export { PALETTE, fieldAttr } from "./envEditor";
export type { EditorIntent, EditorView, LeaveOutcome, LeavePrompt, VisibleRow } from "./envEditor";
export type { SaveStatus } from "./saveQueue";
export { SORT_MODES, type SortMode } from "./varView";

export const ENV_AUTOSAVE_DELAY_MS = 500;

export interface UseEnvEditorProps {
  readonly subject: string | null;
  readonly envs: readonly EnvironmentIpc[];
  readonly onStored: (event: { readonly activated: EnvName | null }) => void;
  readonly onLeave: (outcome: LeaveOutcome) => void;
  readonly onOptimistic?: (env: EnvironmentIpc, previousName: string) => void;
  readonly onReverted?: () => void;
}

export interface EnvEditorHandle {
  readonly view: EditorView;
  readonly dispatch: (intent: EditorIntent) => void;
  readonly regionProps: {
    readonly tabIndex: -1;
    readonly onFocus: () => void;
    readonly onBlur: (e: FocusEvent<HTMLElement>) => void;
  };
  readonly contentRef: RefObject<HTMLDivElement>;
  readonly onOpenAutoFocus: (e: Event) => void;
  readonly onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  readonly resolveRow: (value: string) => Promise<ResolutionReportIpc>;
  readonly resolveKey: string;
}

type SaveLane = {
  state: EditorState;
  notify: ((state: EditorState) => void) | null;
  onStored: UseEnvEditorProps["onStored"];
  onReverted?: () => void;
};

const saveLanes = new Map<string, SaveLane>();

export function resetEnvSaveLanes(): void {
  saveLanes.clear();
}

function environmentOf(goal: EnvGoal): EnvironmentIpc {
  return { name: goal.name, color: goal.color, variables: Object.fromEntries(goal.variables) };
}

function remember(state: EditorState, hooks: Pick<SaveLane, "onStored" | "onReverted">): void {
  if (state.footprint.kind !== "stored") return;
  const lane = saveLanes.get(state.footprint.name);
  if (lane) {
    lane.state = state;
    lane.onStored = hooks.onStored;
    lane.onReverted = hooks.onReverted;
    return;
  }
  saveLanes.set(state.footprint.name, { state, notify: null, ...hooks });
}

function continueDetached(name: string, rev: Rev, outcome: SyncOutcome): void {
  const lane = saveLanes.get(name);
  if (!lane) return;
  const step = editorStep(lane.state, { type: "syncSettled", rev, outcome });
  lane.state = step.state;
  lane.notify?.(step.state);
  for (const effect of step.effects) {
    if (effect.type === "sync" && effect.footprint.kind === "stored") {
      const nextName = effect.footprint.name;
      void syncEnv(effect.goal, effect.footprint).then((next) => continueDetached(nextName, effect.rev, next));
    } else if (effect.type === "stored") lane.onStored({ activated: effect.activated });
  }
  const idle = !step.state.save.inFlight && !step.state.save.sendOnSettle;
  if (!outcome.ok && idle) {
    lane.onReverted?.();
    saveLanes.delete(name);
    return;
  }
  if (outcome.ok && queueStatus(step.state.save).kind === "saved" && lane.notify === null) saveLanes.delete(name);
}

export function useEnvEditor({ subject, envs, onStored, onLeave, onOptimistic, onReverted }: UseEnvEditorProps): EnvEditorHandle {
  const callbacks = useRef({ onStored, onLeave, onOptimistic, onReverted });
  callbacks.current = { onStored, onLeave, onOptimistic, onReverted };
  const summaries = useMemo(() => summarize(envs), [envs]);
  const [initial] = useState(() => saveLanes.get(subject ?? "")?.state ?? initEditor(openEnv(subject, envs), summaries));
  const stateRef = useRef(initial);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const contentRef = useRef<HTMLDivElement>(null);
  const shell = useRef<{ alive: boolean; closing: boolean; detached: boolean; timer?: ReturnType<typeof setTimeout> }>({
    alive: true,
    closing: false,
    detached: false,
  });

  const focusField = useCallback((target: FocusTarget): HTMLElement | null => {
    const el = contentRef.current?.querySelector<HTMLElement>(`[data-field="${fieldAttr(target)}"]`) ?? null;
    el?.focus();
    return el;
  }, []);

  const apply: (action: EditorAction) => void = useCallback((action: EditorAction) => {
    const s0 = shell.current;
    if (s0.closing) return;
    const prev = stateRef.current;
    const { state, effects } = editorStep(prev, action);
    stateRef.current = state;
    remember(state, {
      onStored: (event) => callbacks.current.onStored(event),
      onReverted: () => callbacks.current.onReverted?.(),
    });
    if (state !== prev) rerender();
    const s = shell.current;
    let focus: FocusTarget | null = null;
    for (const effect of effects) {
      switch (effect.type) {
        case "armSaveTimer":
          clearTimeout(s.timer);
          s.timer = setTimeout(() => apply({ type: "timerFired" }), ENV_AUTOSAVE_DELAY_MS);
          break;
        case "cancelSaveTimer":
          clearTimeout(s.timer);
          break;
        case "sync": {
          const { rev, goal, footprint } = effect;
          const name = footprint.kind === "stored" ? footprint.name : null;
          void syncEnv(goal, footprint).then((outcome) => {
            if (s.detached || !s.alive) {
              if (name) continueDetached(name, rev, outcome);
              else if (outcome.ok) callbacks.current.onStored({ activated: outcome.activated });
              return;
            }
            apply({ type: "syncSettled", rev, outcome });
          });
          break;
        }
        case "publish":
          callbacks.current.onOptimistic?.(environmentOf(effect.goal), effect.previousName);
          break;
        case "stored":
          callbacks.current.onStored({ activated: effect.activated });
          break;
        case "leave":
          s.detached = true;
          if (effect.cleanup) {
            const { goal, footprint } = effect.cleanup;
            const outcome = effect.outcome;
            s.closing = true;
            void syncEnv(goal, footprint).then((result) => {
              if (result.ok) callbacks.current.onStored({ activated: result.activated });
              else toast.error(messages.envs.editor.cleanupFailed);
              callbacks.current.onLeave(outcome);
            });
            break;
          }
          callbacks.current.onLeave(effect.outcome);
          break;
        case "focus":
          focus = effect.target;
          break;
      }
    }
    if (focus) {
      flushSync(rerender);
      focusField(focus);
    }
  }, []);

  useEffect(() => {
    const s = shell.current;
    s.alive = true;
    return () => {
      s.alive = false;
      clearTimeout(s.timer);
      const current = stateRef.current;
      if (subject && current.footprint.kind === "stored" && !current.save.inFlight && !current.save.sendOnSettle) {
        saveLanes.delete(subject);
      }
    };
  }, [subject]);

  useEffect(() => apply({ type: "envsChanged", envs: summaries }), [apply, summaries]);

  useEffect(() => {
    if (!subject) return;
    const lane = saveLanes.get(subject);
    if (!lane) return;
    const notify = (next: EditorState) => {
      stateRef.current = next;
      rerender();
    };
    lane.notify = notify;
    lane.onStored = (event) => callbacks.current.onStored(event);
    lane.onReverted = () => callbacks.current.onReverted?.();
    if (lane.state !== stateRef.current) notify(lane.state);
    return () => {
      if (lane.notify === notify) lane.notify = null;
    };
  }, [subject]);

  const state = stateRef.current;
  const view = useMemo(() => selectView(state), [state]);
  const preview = useRef(view.previewVars);
  preview.current = view.previewVars;
  const resolveRow = useCallback(
    (template: string) =>
      ipc.varsResolve(template, { collection_id: null, collection_vars: null, env_vars: { ...preview.current } }),
    [],
  );
  const resolveKey = useMemo(() => JSON.stringify(view.previewVars), [view.previewVars]);

  const regionProps = useMemo(
    () => ({
      tabIndex: -1 as const,
      onFocus: () => apply({ type: "regionFocus", inside: true }),
      onBlur: (e: FocusEvent<HTMLElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) apply({ type: "regionFocus", inside: false });
      },
    }),
    [apply],
  );

  const onOpenAutoFocus = useCallback(
    (e: Event) => {
      e.preventDefault();
      focusField(stateRef.current.footprint.kind === "new" ? { kind: "name" } : { kind: "search" });
    },
    [focusField],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (!isFindHotkey(e)) return;
      e.preventDefault();
      const search = focusField({ kind: "search" });
      if (search instanceof HTMLInputElement) search.select();
    },
    [focusField],
  );

  return {
    view,
    dispatch: apply,
    regionProps,
    contentRef,
    onOpenAutoFocus,
    onKeyDown,
    resolveRow,
    resolveKey,
  };
}

function openEnv(subject: string | null, envs: readonly EnvironmentIpc[]): OpenEnv | null {
  if (subject === null) return null;
  const at = envs.findIndex((env) => env.name === subject);
  const env = at < 0 ? null : envs[at];
  const variables = Object.entries(env?.variables ?? {}).flatMap(([key, value]): Variable[] =>
    typeof value === "string" ? [[key, value]] : [],
  );
  return {
    name: storedName(subject),
    color: env?.color != null ? colorKey(env.color) : null,
    variables,
    index: at < 0 ? envs.length : at,
  };
}

function summarize(envs: readonly EnvironmentIpc[]): EnvSummary[] {
  return envs.map((env) => ({ name: storedName(env.name), color: colorKey(resolveColorKey(env)) }));
}
