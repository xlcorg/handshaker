import type { VarCandidate } from "./candidates";
import { messages } from "@/lib/messages";

/** Built-in dynamic variables. MIRROR of the core `is_builtin` set
 *  (crates/handshaker-core/src/vars/builtins.rs) — keep in sync. */
export const BUILTIN_NAMES = [
  "$guid",
  "$guid7",
  "$timestamp",
  "$unixMs",
  "$isoTimestamp",
  "$randomInt",
] as const;

export type BuiltinName = (typeof BUILTIN_NAMES)[number];

export function isBuiltinName(name: string): boolean {
  return (BUILTIN_NAMES as readonly string[]).includes(name);
}

/** Autocomplete candidates appended to every var surface; the description rides the
 *  `value` slot (shown as the candidate preview / detail). */
export const BUILTIN_CANDIDATES: VarCandidate[] = BUILTIN_NAMES.map((name) => ({
  name,
  // Typed indexing: `desc` is `as const` with exactly the BUILTIN_NAMES keys, so a name
  // added here without a matching description fails to compile (no silent empty preview).
  value: messages.vars.builtin.desc[name],
  origin: "builtin",
}));
