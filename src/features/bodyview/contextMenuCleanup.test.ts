import { describe, it, expect } from "vitest";
import {
  stripCommandPalette,
  stripMenuItems,
  installContextMenuCleanup,
} from "./contextMenuCleanup";

const SEP = { id: "vs.actions.separator" };
const QC = { id: "editor.action.quickCommand", label: "Command Palette" };
const COPY = { id: "editor.action.clipboardCopyAction", label: "Copy" };

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

describe("stripMenuItems", () => {
  it("removes every id in the set and tidies separators", () => {
    const r = stripMenuItems(
      [COPY, SEP, { id: "hs.copyValue" }, SEP, QC],
      new Set(["editor.action.clipboardCopyAction", "editor.action.quickCommand"]),
    );
    expect(r.map((x) => x.id)).toEqual(["hs.copyValue"]);
  });

  it("keeps items whose id is not in the set", () => {
    const r = stripMenuItems([COPY, SEP, { id: "hs.copyValue" }], new Set(["editor.action.quickCommand"]));
    expect(r.map((x) => x.id)).toEqual(["editor.action.clipboardCopyAction", "vs.actions.separator", "hs.copyValue"]);
  });
});

describe("installContextMenuCleanup", () => {
  // Fake editor whose context-menu contribution exposes a `_getMenuActions` we can drive.
  function fakeEditor(menu: { id?: string }[]) {
    const contrib = { _getMenuActions: (..._args: unknown[]) => menu };
    return {
      getContribution: (id: string) => (id === "editor.contrib.contextmenu" ? contrib : null),
      menuActions: () => contrib._getMenuActions(),
    };
  }

  it("strips only the Command Palette by default (keeps Copy)", () => {
    const f = fakeEditor([COPY, SEP, QC]);
    installContextMenuCleanup(f);
    expect(f.menuActions().map((x) => x.id)).toEqual(["editor.action.clipboardCopyAction"]);
  });

  it("also strips the built-in Copy when stripCopy is set", () => {
    const f = fakeEditor([COPY, SEP, { id: "hs.copyValue" }, QC]);
    installContextMenuCleanup(f, { stripCopy: true });
    expect(f.menuActions().map((x) => x.id)).toEqual(["hs.copyValue"]);
  });

  it("is a no-op when the contribution is absent", () => {
    const editor = { getContribution: () => null };
    expect(() => installContextMenuCleanup(editor, { stripCopy: true })).not.toThrow();
  });
});
