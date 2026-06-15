import { describe, it, expect } from "vitest";
import { stripCommandPalette } from "./contextMenuCleanup";

const SEP = { id: "vs.actions.separator" };
const QC = { id: "editor.action.quickCommand", label: "Command Palette" };

describe("stripCommandPalette", () => {
  it("removes the Command Palette item", () => {
    const r = stripCommandPalette([{ id: "copy" }, SEP, QC]);
    expect(r.some((x) => x.id === "editor.action.quickCommand")).toBe(false);
  });

  it("drops the trailing separator the removal leaves behind (Monaco's [..., Sep, quickCommand] shape)", () => {
    const r = stripCommandPalette([{ id: "copy" }, SEP, QC]);
    expect(r.map((x) => x.id)).toEqual(["copy"]);
  });

  it("strips leading and collapses adjacent separators", () => {
    const r = stripCommandPalette([SEP, { id: "a" }, SEP, SEP, { id: "b" }, SEP]);
    expect(r.map((x) => x.id)).toEqual(["a", "vs.actions.separator", "b"]);
  });

  it("leaves a menu without Command Palette otherwise intact (just tidied)", () => {
    const r = stripCommandPalette([{ id: "a" }, SEP, { id: "b" }]);
    expect(r.map((x) => x.id)).toEqual(["a", "vs.actions.separator", "b"]);
  });

  it("returns empty when only the Command Palette (and separators) remain", () => {
    expect(stripCommandPalette([QC])).toEqual([]);
    expect(stripCommandPalette([SEP, QC, SEP])).toEqual([]);
  });
});
