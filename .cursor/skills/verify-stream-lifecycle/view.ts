/** Labels for the statechart skill. Pass this file as `--view`. */

type Vars = {
  phase: string;
  reg: string;
  releaseAsked: boolean;
  cancelAsked: boolean;
  dead: boolean;
};

export const title = "One stream call, from Open to leaving it";

export const colors = {
  opening: "blue",
  running: "teal",
  finding: "orange",
  settled: "tan",
};

export function state(v: Vars): string {
  if (v.phase === "returned" && v.reg === "live" && v.releaseAsked) return "Left running after you left";
  if (v.phase === "returned" && v.reg === "live" && v.cancelAsked) return "Still running after Cancel";
  if (v.phase === "returned" && v.reg === "live") return "Call running";
  if (v.phase === "returned" && v.reg === "cancelled") return "Call cancelled";
  if (v.phase === "returned") return "Call gone";
  if (v.phase === "idle") return "Idle";
  if (v.reg === "live") return "Call stored, Open not finished";
  return "Opening";
}

export function group(v: Vars): string {
  if (v.phase === "returned" && v.reg === "live" && (v.releaseAsked || v.cancelAsked)) return "finding";
  if (v.phase === "returned" && v.reg === "live") return "running";
  if (v.phase === "returned") return "settled";
  return "opening";
}

export function step(action: string): string | null {
  switch (action) {
    case "Register":
      return "Open registers the call for Cancel";
    case "Release":
      return "you leave the request";
    case "WorkSucceeds":
      return "connect finishes";
    case "SelectCancel":
      return "Cancel wins";
    case "GrpcCancel":
      return "you press Cancel";
    case "HandoffInsert":
      return "Open stores the call";
    case "HandoffClear":
      return "Open drops the cancel registration";
    case "ReadPermit":
      return "Open checks for a late Cancel";
    case "Finish":
      return "Open returns";
    case "ChannelDies":
      return "the window is gone during Open";
    case "ChannelDiesAfterReturn":
      return "the window closes";
    case "Done":
      return null;
    default:
      return action;
  }
}
