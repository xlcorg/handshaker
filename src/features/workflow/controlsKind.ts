import type { StreamEntry } from "@/features/stream/streamStore";
import type { MethodKind } from "@/lib/method-kind";
import type { Step } from "./model";

export interface ControlsKindInput {
  /** The kind the step's live call was opened with (`Opened.kind` on its Stream store
   *  entry); null when no call is live or the live call is unary. */
  liveKind: MethodKind | null;
  /** The kind the reflected catalog says; null while pending / failed / method absent. */
  catalogKind: MethodKind | null;
  /** The kind of the step's last executed call (`executedKind`); null when never run. */
  executedKind: MethodKind | null;
}

/** **Controls kind precedence** (spec, "Method kind"): while a call is live, the kind it
 *  was opened with — a reflection refresh cannot flip the controls mid-call; otherwise the
 *  catalog kind; otherwise the kind of the step's last executed call — history panels never
 *  reflect, so a client-streaming snapshot still re-opens with `▶ Open`; otherwise `null`
 *  (no badge, unary controls, unary Send path). The one place this rule lives. */
export function controlsKind({ liveKind, catalogKind, executedKind }: ControlsKindInput): MethodKind | null {
  return liveKind ?? catalogKind ?? executedKind;
}

/** The kind of the step's last executed call — a fact of the call, not a guess: a stream
 *  step reads it from its Stream store entry (`Opened.kind`, kept by the store); a step
 *  with no `streamId` but a unary outcome ran as unary; a step that never executed, or
 *  whose entry was released (`streamStore.get` → null), has no executed kind. */
export function executedKind(step: Pick<Step, "streamId" | "outcome">, entry: StreamEntry | null): MethodKind | null {
  if (step.streamId !== null) return entry?.kind ?? null;
  return step.outcome ? "unary" : null;
}
