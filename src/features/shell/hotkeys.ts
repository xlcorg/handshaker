import { useEffect, useRef } from "react";
import { isMacOS } from "@/lib/platform";

export type ChordMod = "meta" | "ctrl" | "alt" | "shift";

/**
 * One row in the keydown table. `capture` is the phase the row runs in
 * (the move that used to be a hand-written `true` on `addEventListener`).
 * `platform` selects the macOS word-wrap chord versus Alt+Z everywhere else.
 *
 * `run` returns `false` when the row declines the event (repeat, nothing to
 * do). A declined row does not preventDefault or stopPropagation, which is
 * how Cmd+E stays available to Monaco when there is no environment to cycle.
 */
export type Chord = {
  key: string;
  mod: readonly ChordMod[];
  capture: boolean;
  platform?: "mac" | "other";
  /** Listed mods must be down; others may be too. Default is an exact set. */
  exact?: boolean;
  /** When false, a handled row does not preventDefault or stopPropagation. */
  swallow?: boolean;
  /** stopPropagation. Defaults to `capture` (bubble rows only preventDefault). */
  stop?: boolean;
  run: (event: KeyboardEvent) => boolean | void;
};

export type ChordEvent = {
  key?: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
};

const PRIMARIES: readonly (readonly ChordMod[])[] = [
  ["ctrl"],
  ["meta"],
  ["ctrl", "meta"],
];

function optionalSets(optional: readonly ChordMod[]): ChordMod[][] {
  let sets: ChordMod[][] = [[]];
  for (const mod of optional)
    sets = [...sets, ...sets.map((set) => [...set, mod])];
  return sets;
}

/** Ctrl, Cmd, or both, plus any required and optional modifiers. One `run` is shared. */
export function primaryChords(
  keys: readonly string[],
  opts: {
    capture: boolean;
    run: Chord["run"];
    with?: readonly ChordMod[];
    optional?: readonly ChordMod[];
    stop?: boolean;
    swallow?: boolean;
  },
): Chord[] {
  const extras = optionalSets(opts.optional ?? []);
  const rows: Chord[] = [];
  for (const key of keys) {
    for (const primary of PRIMARIES) {
      for (const extra of extras) {
        const row: Chord = {
          key,
          mod: [...primary, ...(opts.with ?? []), ...extra],
          capture: opts.capture,
          run: opts.run,
        };
        if (opts.stop !== undefined) row.stop = opts.stop;
        if (opts.swallow !== undefined) row.swallow = opts.swallow;
        rows.push(row);
      }
    }
  }
  return rows;
}

function isPhysicalCode(key: string): boolean {
  return (
    key.startsWith("Key") || key.startsWith("Digit") || key.startsWith("Numpad")
  );
}

function keyMatches(chordKey: string, event: ChordEvent): boolean {
  if (chordKey === "*") return true;
  const key = event.key ?? "";
  const code = event.code ?? "";
  // Physical codes stay on `code` so a Cyrillic layout still matches KeyE / KeyZ.
  if (isPhysicalCode(chordKey)) return code === chordKey;
  const want = chordKey.toLowerCase();
  return key.toLowerCase() === want || code.toLowerCase() === want;
}

function modsMatch(
  chord: Pick<Chord, "mod" | "exact">,
  event: ChordEvent,
): boolean {
  const held = new Set<ChordMod>();
  if (event.metaKey) held.add("meta");
  if (event.ctrlKey) held.add("ctrl");
  if (event.altKey) held.add("alt");
  if (event.shiftKey) held.add("shift");
  for (const mod of chord.mod) if (!held.has(mod)) return false;
  if (chord.exact === false) return true;
  return held.size === new Set(chord.mod).size;
}

/** Pure match used by the listener and by the predicates the old tests call. */
export function chordMatches(
  chord: Pick<Chord, "key" | "mod" | "platform" | "exact">,
  event: ChordEvent,
  mac: boolean,
): boolean {
  if (chord.platform === "mac" && !mac) return false;
  if (chord.platform === "other" && mac) return false;
  return keyMatches(chord.key, event) && modsMatch(chord, event);
}

type Slot = { current: readonly Chord[] };

const slots = new Set<Slot>();
let listening = false;

function dispatch(event: KeyboardEvent, capture: boolean): void {
  const phase = event.eventPhase;
  // Ancestors only see one phase. An event targeted at window (unit tests)
  // is AT_TARGET for both registrations, so each registration runs its own rows.
  if (phase === Event.CAPTURING_PHASE && !capture) return;
  if (phase === Event.BUBBLING_PHASE && capture) return;
  const seen = new Set<Chord["run"]>();
  for (const slot of slots) {
    for (const chord of slot.current) {
      if (chord.capture !== capture) continue;
      if (!chordMatches(chord, event, isMacOS)) continue;
      if (seen.has(chord.run)) continue;
      seen.add(chord.run);
      const handled = chord.run(event);
      if (handled === false || chord.swallow === false) continue;
      event.preventDefault();
      if (chord.stop ?? chord.capture) event.stopPropagation();
    }
  }
}

function listen(capture: boolean): void {
  const handler = (event: KeyboardEvent) => dispatch(event, capture);
  // prettier-ignore
  window.addEventListener("keydown", handler, capture);
}

function install(): void {
  if (listening) return;
  listening = true;
  listen(true);
  listen(false);
}

/** Register rows. The window listener lives in this module and nowhere else. */
export function useChords(chords: readonly Chord[]): void {
  const slot = useRef<Slot>({ current: chords });
  slot.current.current = chords;
  useEffect(() => {
    const current = slot.current;
    slots.add(current);
    install();
    return () => {
      slots.delete(current);
    };
  }, []);
}
