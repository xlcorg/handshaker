import { describe, it, expect } from "vitest";
import { computeReorder } from "./reorder";

describe("computeReorder", () => {
  const names = ["a", "b", "c"];

  it("moves a row after another", () => {
    expect(computeReorder(names, "a", "c", "after")).toEqual(["b", "c", "a"]);
  });

  it("moves a row before another", () => {
    expect(computeReorder(names, "c", "a", "before")).toEqual(["c", "a", "b"]);
  });

  it("returns null for self-drops", () => {
    expect(computeReorder(names, "b", "b", "before")).toBeNull();
  });

  it("returns null for no-op moves (drop where the row already is)", () => {
    expect(computeReorder(names, "a", "b", "before")).toBeNull();
    expect(computeReorder(names, "b", "a", "after")).toBeNull();
  });

  it("returns null for unknown names", () => {
    expect(computeReorder(names, "ghost", "a", "before")).toBeNull();
    expect(computeReorder(names, "a", "ghost", "before")).toBeNull();
  });

  it("does not mutate the input", () => {
    computeReorder(names, "a", "c", "after");
    expect(names).toEqual(["a", "b", "c"]);
  });
});
