import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { chordMatches, useChords, type Chord } from "./hotkeys";
import { wordWrapChords } from "./wordWrap";

const needle = [
  "addEventListener(",
  String.fromCharCode(34),
  "keydown",
  String.fromCharCode(34),
].join("");

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
      out.push(full);
  }
  return out;
}

function hits(source: string): number {
  let count = 0;
  let from = 0;
  while (from < source.length) {
    const at = source.indexOf(needle, from);
    if (at < 0) return count;
    count += 1;
    from = at + needle.length;
  }
  return count;
}

describe("keydown table", () => {
  it("keeps the only keydown listener in hotkeys.ts", () => {
    const root = path.resolve("src");
    const owner = path.resolve("src/features/shell/hotkeys.ts");
    const elsewhere: string[] = [];
    let ownerHits = 0;
    for (const file of filesUnder(root)) {
      const count = hits(readFileSync(file, "utf8"));
      if (count === 0) continue;
      if (path.resolve(file) === owner) ownerHits = count;
      else elsewhere.push(`${path.relative(root, file)} (${count})`);
    }
    expect(ownerHits, "hotkeys.ts registers the listener once").toBe(1);
    expect(
      elsewhere,
      `keydown listener outside hotkeys.ts:\n${elsewhere.join("\n")}`,
    ).toEqual([]);
  });

  // 5e74fc7: plain Alt+Z types Omega on macOS, so that platform's row is Option+Cmd+Z.
  it("matches the macOS word-wrap chord and leaves Alt+Z to other platforms", () => {
    const mac = wordWrapChords.find((row) => row.platform === "mac");
    const other = wordWrapChords.find((row) => row.platform === "other");
    expect(mac).toMatchObject({
      key: "KeyZ",
      mod: ["alt", "meta"],
      capture: true,
      platform: "mac",
    });
    expect(other).toMatchObject({
      key: "KeyZ",
      mod: ["alt"],
      capture: true,
      platform: "other",
    });
    const altZ = {
      code: "KeyZ",
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    };
    const optionCmdZ = { ...altZ, metaKey: true };
    expect(chordMatches(mac!, optionCmdZ, true)).toBe(true);
    expect(chordMatches(mac!, altZ, true)).toBe(false);
    expect(chordMatches(other!, altZ, false)).toBe(true);
    expect(chordMatches(other!, optionCmdZ, false)).toBe(false);
    expect(chordMatches(other!, { ...altZ, ctrlKey: true }, false)).toBe(false);
  });

  // ea7e564: a handled Cmd+E must stopPropagation. No row, and the key is not swallowed.
  it("swallows Cmd+E only when that row handles the event", () => {
    const run = vi.fn();
    const row: Chord = { key: "KeyE", mod: ["meta"], capture: true, run };
    function Probe({ chords }: { chords: readonly Chord[] }) {
      useChords(chords);
      return null;
    }
    const view = render(<Probe chords={[row]} />);
    const handled = new KeyboardEvent("keydown", {
      code: "KeyE",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    const stop = vi.spyOn(handled, "stopPropagation");
    act(() => window.dispatchEvent(handled));
    expect(run).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalled();
    expect(handled.defaultPrevented).toBe(true);

    run.mockClear();
    view.rerender(<Probe chords={[]} />);
    const open = new KeyboardEvent("keydown", {
      code: "KeyE",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    const openStop = vi.spyOn(open, "stopPropagation");
    act(() => window.dispatchEvent(open));
    expect(run).not.toHaveBeenCalled();
    expect(openStop).not.toHaveBeenCalled();
    expect(open.defaultPrevented).toBe(false);
  });
});
