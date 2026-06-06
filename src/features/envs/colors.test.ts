import { describe, it, expect } from "vitest";
import { defaultColorKeyForName, resolveColorKey, colorHex, ENV_COLORS } from "./colors";

describe("env colors", () => {
  it("keyword defaults", () => {
    expect(defaultColorKeyForName("prod")).toBe("red");
    expect(defaultColorKeyForName("production")).toBe("red");
    expect(defaultColorKeyForName("local")).toBe("green");
    expect(defaultColorKeyForName("test")).toBe("green");
    expect(defaultColorKeyForName("stg")).toBe("yellow");
    expect(defaultColorKeyForName("staging")).toBe("yellow");
  });
  it("non-keyword names get a stable palette color", () => {
    const a = defaultColorKeyForName("alpha");
    expect(a).toBe(defaultColorKeyForName("alpha")); // deterministic
    expect(ENV_COLORS.some((c) => c.key === a)).toBe(true);
  });
  it("resolveColorKey prefers explicit color", () => {
    expect(resolveColorKey({ name: "prod", color: "blue" })).toBe("blue");
    expect(resolveColorKey({ name: "prod", color: null })).toBe("red");
  });
  it("colorHex falls back to gray for unknown key", () => {
    expect(colorHex("red")).toBe("#ef4444");
    expect(colorHex("nope")).toBe("#9ca3af");
  });
});
