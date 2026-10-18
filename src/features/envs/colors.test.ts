import { describe, expect, it } from "vitest";

import { ENV_PRESETS, paintMarker } from "./colors";

const SPEC_PALETTE = [
  ["gray", "#9099A1"],
  ["coral", "#FF6B63"],
  ["orange", "#FF9F43"],
  ["yellow", "#F4D84B"],
  ["green", "#43B957"],
  ["teal", "#15B8AD"],
  ["cyan", "#41C8EC"],
  ["blue", "#3D87F5"],
  ["indigo", "#7954F6"],
  ["purple", "#B654EF"],
  ["pink", "#E75B9F"],
  ["brown", "#9B6B51"],
] as const;

const LEGACY = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899",
  "#9ca3af",
];

describe("env color presets", () => {
  it("offers the twelve spec colors in spec order", () => {
    expect(ENV_PRESETS.map((p) => [p.key, p.hex])).toEqual(SPEC_PALETTE);
  });

  it("paints a stored preset with its spec color and rings it", () => {
    for (const [key, hex] of SPEC_PALETTE) {
      expect(paintMarker(key, "anything")).toEqual({ paint: hex, ring: key });
    }
  });
});

describe("env colors that are not presets", () => {
  it("keeps the old color for a stored legacy key and rings nothing", () => {
    expect(paintMarker("red", "prod")).toEqual({
      paint: "#ef4444",
      ring: null,
    });
  });

  it("paints a stored hex literal as itself and rings nothing", () => {
    expect(paintMarker("#123abc", "dev")).toEqual({
      paint: "#123abc",
      ring: null,
    });
    expect(paintMarker("#ABC", "dev")).toEqual({ paint: "#ABC", ring: null });
  });

  it("paints any other stored string gray and rings nothing", () => {
    for (const raw of ["chartreuse", "#12345", "toString", ""]) {
      expect(paintMarker(raw, "dev")).toEqual({ paint: "#9ca3af", ring: null });
    }
  });
});

describe("derived env colors", () => {
  it("keeps the keyword defaults, with prod staying red and unringed", () => {
    expect(paintMarker(null, "prod")).toEqual({ paint: "#ef4444", ring: null });
    expect(paintMarker(null, "production")).toEqual({
      paint: "#ef4444",
      ring: null,
    });
    expect(paintMarker(null, "local")).toEqual({
      paint: "#22c55e",
      ring: "green",
    });
    expect(paintMarker(null, "test")).toEqual({
      paint: "#22c55e",
      ring: "green",
    });
    expect(paintMarker(null, "stg")).toEqual({
      paint: "#eab308",
      ring: "yellow",
    });
    expect(paintMarker(null, "staging")).toEqual({
      paint: "#eab308",
      ring: "yellow",
    });
  });

  it("hashes other names through the old ten colors, so no env changes color", () => {
    expect(paintMarker(null, "alpha")).toEqual({
      paint: "#ec4899",
      ring: "pink",
    });
    expect(paintMarker(null, "dev")).toEqual({
      paint: "#9ca3af",
      ring: "gray",
    });
    expect(paintMarker(null, "sandbox")).toEqual({
      paint: "#a855f7",
      ring: "purple",
    });
    expect(paintMarker(null, "demo")).toEqual({
      paint: "#f97316",
      ring: "orange",
    });
    expect(paintMarker(null, "ci")).toEqual({ paint: "#14b8a6", ring: "teal" });
    expect(paintMarker(null, "qa")).toEqual({ paint: "#ef4444", ring: null });
    for (const name of ["a", "b", "eu-west-1", "Zeta 9", "ünïcode"]) {
      expect(LEGACY).toContain(paintMarker(null, name).paint);
    }
  });
});
