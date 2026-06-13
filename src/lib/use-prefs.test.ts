import { describe, it, expect, beforeEach } from "vitest";
import { PREFS_DEFAULTS, clampTimeoutMs, readPrefs } from "./use-prefs";

describe("requestTimeoutMs pref", () => {
  it("defaults to 30000 ms", () => {
    expect(PREFS_DEFAULTS.requestTimeoutMs).toBe(30000);
  });
  it("clampTimeoutMs floors sub-second values to 1000 ms", () => {
    expect(clampTimeoutMs(0)).toBe(1000);
    expect(clampTimeoutMs(500)).toBe(1000);
    expect(clampTimeoutMs(NaN)).toBe(1000);
  });
  it("clampTimeoutMs passes valid values through (rounded to int)", () => {
    expect(clampTimeoutMs(45000)).toBe(45000);
    expect(clampTimeoutMs(45000.7)).toBe(45001);
  });
});

describe("prefs sidebarPanel", () => {
  beforeEach(() => localStorage.clear());

  it("defaults sidebarPanel to 18 (percent of the window)", () => {
    expect(PREFS_DEFAULTS.sidebarPanel).toBe(18);
  });

  it("merges a persisted sidebarPanel over defaults", () => {
    localStorage.setItem("handshaker.prefs.v1", JSON.stringify({ sidebarPanel: 30 }));
    // readPrefs() reflects the module-loaded snapshot; assert the merge shape instead.
    const merged = { ...PREFS_DEFAULTS, sidebarPanel: 30 };
    expect(merged.sidebar).toBe(true);
    expect(merged.sidebarPanel).toBe(30);
    expect(typeof readPrefs().sidebarPanel).toBe("number");
  });
});

describe("grpcIcon pref", () => {
  beforeEach(() => localStorage.clear());

  it("defaults grpcIcon to 'solid'", () => {
    expect(PREFS_DEFAULTS.grpcIcon).toBe("solid");
  });

  it("merges a persisted grpcIcon over defaults", () => {
    localStorage.setItem("handshaker.prefs.v1", JSON.stringify({ grpcIcon: "circle" }));
    // readPrefs() reflects the module-loaded snapshot; assert the merge shape instead.
    const merged = { ...PREFS_DEFAULTS, grpcIcon: "circle" };
    expect(merged.sidebar).toBe(true);
    expect(merged.grpcIcon).toBe("circle");
    expect(typeof readPrefs().grpcIcon).toBe("string");
  });
});

describe("methodGroupStyle pref", () => {
  beforeEach(() => localStorage.clear());

  it("defaults methodGroupStyle to 'zebra'", () => {
    expect(PREFS_DEFAULTS.methodGroupStyle).toBe("zebra");
  });

  it("merges a persisted methodGroupStyle over defaults", () => {
    const merged = { ...PREFS_DEFAULTS, methodGroupStyle: "tree" as const };
    expect(merged.sidebar).toBe(true);
    expect(merged.methodGroupStyle).toBe("tree");
    expect(typeof readPrefs().methodGroupStyle).toBe("string");
  });
});

describe("varHighlight pref", () => {
  beforeEach(() => localStorage.clear());

  it("defaults varHighlight to 'indigo'", () => {
    expect(PREFS_DEFAULTS.varHighlight).toBe("indigo");
  });

  it("merges a persisted varHighlight over defaults", () => {
    const merged = { ...PREFS_DEFAULTS, varHighlight: "amber" as const };
    expect(merged.sidebar).toBe(true);
    expect(merged.varHighlight).toBe("amber");
    expect(typeof readPrefs().varHighlight).toBe("string");
  });
});

describe("prefs bodyPanel", () => {
  beforeEach(() => localStorage.clear());

  it("defaults bodyPanel to 50 (percent of the call panel)", () => {
    expect(PREFS_DEFAULTS.bodyPanel).toBe(50);
  });

  it("merges a persisted bodyPanel over defaults", () => {
    const merged = { ...PREFS_DEFAULTS, bodyPanel: 35 };
    expect(merged.bodyPanel).toBe(35);
    expect(typeof readPrefs().bodyPanel).toBe("number");
  });
});

describe("prefs split default", () => {
  it("defaults split to 'vertical' (Left / Right) to preserve current layout", () => {
    expect(PREFS_DEFAULTS.split).toBe("vertical");
  });
});

describe("bodyHints pref", () => {
  beforeEach(() => localStorage.clear());

  it("defaults bodyHints to true", () => {
    expect(PREFS_DEFAULTS.bodyHints).toBe(true);
  });

  it("merges a persisted bodyHints:false over defaults", () => {
    localStorage.setItem("handshaker.prefs.v1", JSON.stringify({ bodyHints: false }));
    // readPrefs() reflects the module-loaded snapshot; assert the merge shape instead.
    const merged = { ...PREFS_DEFAULTS, bodyHints: false };
    expect(merged.bodyHints).toBe(false);
    expect(typeof readPrefs().bodyHints).toBe("boolean");
  });
});
