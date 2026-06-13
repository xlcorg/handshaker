import { describe, it, expect } from "vitest";

import { isEnvCycleHotkey, nextEnvName } from "./cycle";

describe("nextEnvName", () => {
  it("returns null for an empty list (no-op)", () => {
    expect(nextEnvName([], null)).toBeNull();
    expect(nextEnvName([], "prod")).toBeNull();
  });

  it("selects the first env when none is active", () => {
    expect(nextEnvName(["staging", "prod"], null)).toBe("staging");
  });

  it("advances to the next env in order", () => {
    expect(nextEnvName(["staging", "prod", "dev"], "staging")).toBe("prod");
    expect(nextEnvName(["staging", "prod", "dev"], "prod")).toBe("dev");
  });

  it("wraps from the last env back to the first", () => {
    expect(nextEnvName(["staging", "prod"], "prod")).toBe("staging");
  });

  it("treats an unknown current env as none → first", () => {
    expect(nextEnvName(["staging", "prod"], "gone")).toBe("staging");
  });

  it("re-selects the only env", () => {
    expect(nextEnvName(["staging"], "staging")).toBe("staging");
  });
});

describe("isEnvCycleHotkey", () => {
  const base = {
    code: "KeyE",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
  };

  it("matches Ctrl+E (physical key — layout-independent, also fires on ЙЦУКЕН where key would be 'у')", () => {
    expect(isEnvCycleHotkey({ ...base, ctrlKey: true })).toBe(true);
  });

  it("matches Cmd+E on macOS", () => {
    expect(isEnvCycleHotkey({ ...base, metaKey: true })).toBe(true);
  });

  it("rejects AltGr (Ctrl+Alt) — prints € etc. on EU layouts", () => {
    expect(isEnvCycleHotkey({ ...base, ctrlKey: true, altKey: true })).toBe(false);
  });

  it("rejects Ctrl+Shift+E", () => {
    expect(isEnvCycleHotkey({ ...base, ctrlKey: true, shiftKey: true })).toBe(false);
  });

  it("rejects a bare E (no Ctrl/Cmd)", () => {
    expect(isEnvCycleHotkey(base)).toBe(false);
  });

  it("rejects Ctrl + a different key", () => {
    expect(isEnvCycleHotkey({ ...base, ctrlKey: true, code: "KeyR" })).toBe(false);
  });
});
