import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useEditBuffer } from "./useEditBuffer";

/**
 * Kind-default header seeds empty, the mapping `4b09613` put in `configToForm`.
 * A stable function so a reseed that depends on `server` — not on `toEdit` — is
 * what fails the echo test.
 */
function headerField(server: { header: string }): string {
  return server.header === "x-api-key" ? "" : server.header;
}

function showHeader(server: { header: string }): string {
  return server.header;
}

describe("useEditBuffer", () => {
  // Moved from SavedAuthEditor (4b09613). Same collection id, the user has
  // replaced the header, and a reload delivers a new object with the stale
  // server value. The buffer wins. A reseed that lists `server` in its
  // dependencies restores the empty default and fails this test.
  it("same collection id, stale server value, buffer wins", () => {
    const initial = { header: "x-api-key" };
    const { result, rerender } = renderHook(
      ({ seedKey, server }) => useEditBuffer(seedKey, server, headerField),
      { initialProps: { seedKey: "col-1", server: initial } },
    );
    expect(result.current[0]).toBe("");
    act(() => {
      result.current[1]("my-header");
    });
    rerender({ seedKey: "col-1", server: { header: "x-api-key" } });
    expect(result.current[0]).toBe("my-header");
  });

  it("does not restore a persisted default over a cleared edit", () => {
    const { result, rerender } = renderHook(
      ({ seedKey, server }) => useEditBuffer(seedKey, server, showHeader),
      { initialProps: { seedKey: "col-1", server: { header: "custom-key" } } },
    );
    act(() => {
      result.current[1]("");
    });
    rerender({ seedKey: "col-1", server: { header: "x-api-key" } });
    expect(result.current[0]).toBe("");
  });

  it("reseeds when seedKey changes", () => {
    const { result, rerender } = renderHook(
      ({ seedKey, server }) => useEditBuffer(seedKey, server, showHeader),
      { initialProps: { seedKey: "col-a", server: { header: "header-a" } } },
    );
    act(() => {
      result.current[1]("typed");
    });
    rerender({ seedKey: "col-b", server: { header: "header-b" } });
    expect(result.current[0]).toBe("header-b");
  });
});
