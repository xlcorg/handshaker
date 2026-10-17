import type { EnvironmentIpc } from "@/ipc/bindings";
import { ipc } from "@/ipc/client";
import { messages } from "@/lib/messages";

import type { EnvGoal, EnvName } from "./envDraft";
import type { SaveFailure } from "./saveQueue";

export type Footprint =
  | { readonly kind: "new"; readonly strays: readonly EnvName[] }
  | {
      readonly kind: "stored";
      readonly name: EnvName;
      readonly index: number;
      readonly strays: readonly EnvName[];
    };

export function footprintNames(fp: Footprint): readonly EnvName[] {
  return fp.kind === "stored" ? [fp.name, ...fp.strays] : fp.strays;
}

export interface StoreObservation {
  readonly names: readonly string[];
  readonly active: string | null;
}

export type SyncStep =
  | { readonly op: "upsert"; readonly goal: EnvGoal }
  | { readonly op: "activate"; readonly name: EnvName }
  | { readonly op: "delete"; readonly name: EnvName }
  | { readonly op: "reorder"; readonly names: readonly string[] };

export interface SyncPlan {
  readonly steps: readonly SyncStep[];
  readonly index: number;
  readonly activated: EnvName | null;
}

export type SyncOutcome =
  | { readonly ok: true; readonly activated: EnvName | null; readonly index: number }
  | { readonly ok: false; readonly error: SaveFailure };

function plainWrite(goal: EnvGoal | null, fp: Footprint): SyncPlan | null {
  if (goal === null || fp.kind !== "stored" || goal.name !== fp.name || fp.strays.length > 0) return null;
  return { steps: [{ op: "upsert", goal }], index: fp.index, activated: null };
}

export function planSync(goal: EnvGoal | null, fp: Footprint, seen: StoreObservation): SyncPlan {
  const plain = plainWrite(goal, fp);
  if (plain) return plain;
  const ours = footprintNames(fp);
  const target = goal?.name ?? null;
  const steps: SyncStep[] = goal ? [{ op: "upsert", goal }] : [];
  let names = target === null || seen.names.includes(target) ? [...seen.names] : [...seen.names, target];
  const activeIsOurs =
    seen.active !== null && (seen.active === target || ours.some((name) => name === seen.active));
  const activated = goal !== null && (fp.kind === "new" || activeIsOurs) ? goal.name : null;
  if (activated !== null && seen.active !== activated) steps.push({ op: "activate", name: activated });
  const active = activated ?? seen.active;
  for (const name of ours) {
    if (name === target || name === active || !names.includes(name)) continue;
    steps.push({ op: "delete", name });
    names = names.filter((n) => n !== name);
  }
  if (goal === null) return { steps, index: -1, activated: null };
  if (fp.kind === "new") return { steps, index: names.indexOf(goal.name), activated };
  const want = names.filter((n) => n !== goal.name);
  want.splice(Math.min(fp.index, want.length), 0, goal.name);
  if (want.some((n, i) => n !== names[i])) steps.push({ op: "reorder", names: want });
  return { steps, index: want.indexOf(goal.name), activated };
}

export function afterSync(fp: Footprint, goal: EnvGoal, outcome: SyncOutcome): Footprint {
  if (outcome.ok) return { kind: "stored", name: goal.name, index: outcome.index, strays: [] };
  if (footprintNames(fp).includes(goal.name)) return fp;
  return { ...fp, strays: [...fp.strays, goal.name] };
}

let syncTail: Promise<void> = Promise.resolve();

export function resetEnvSyncLane(): void {
  syncTail = Promise.resolve();
}

export function syncEnv(goal: EnvGoal | null, fp: Footprint): Promise<SyncOutcome> {
  const run = syncTail.then(() => writeEnv(goal, fp));
  syncTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function writeEnv(goal: EnvGoal | null, fp: Footprint): Promise<SyncOutcome> {
  try {
    const plan = plainWrite(goal, fp) ?? planSync(goal, fp, await observe());
    for (const step of plan.steps) await run(step);
    return { ok: true, activated: plan.activated, index: plan.index };
  } catch (e) {
    return { ok: false, error: toSaveFailure(e) };
  }
}

async function observe(): Promise<StoreObservation> {
  const [envs, active] = await Promise.all([ipc.envList(), ipc.envActiveGet()]);
  return { names: envs.map((env) => env.name), active };
}

function run(step: SyncStep): Promise<void> {
  switch (step.op) {
    case "upsert":
      return ipc.envUpsert(toEnvironmentIpc(step.goal));
    case "activate":
      return ipc.envActiveSet(step.name);
    case "delete":
      return ipc.envDelete(step.name);
    case "reorder":
      return ipc.envReorder([...step.names]);
  }
}

function toEnvironmentIpc(goal: EnvGoal): EnvironmentIpc {
  return { name: goal.name, color: goal.color, variables: Object.fromEntries(goal.variables) };
}

function toSaveFailure(e: unknown): SaveFailure {
  const err = typeof e === "object" && e !== null ? (e as { type?: unknown; message?: unknown }) : {};
  const detail =
    typeof err.message === "string" ? err.message : typeof err.type === "string" ? err.type : undefined;
  return { message: messages.envs.editor.saveFailed, detail };
}
