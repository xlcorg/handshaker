import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { bumpEnvRevision, useEnvRevision } from "./envRevision";

describe("envRevision", () => {
  it("useEnvRevision increments on each bump and re-renders subscribers", () => {
    const { result } = renderHook(() => useEnvRevision());
    const before = result.current;
    act(() => bumpEnvRevision());
    expect(result.current).toBe(before + 1);
    act(() => bumpEnvRevision());
    expect(result.current).toBe(before + 2);
  });
});
