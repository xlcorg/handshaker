import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { UpdaterProvider, useUpdater } from "./updaterContext";
import type { UseUpdateCheck } from "./useUpdateCheck";

const fake: UseUpdateCheck = {
  phase: "idle",
  version: "",
  progress: 0,
  manual: false,
  hasUpdate: false,
  install: async () => {},
  dismiss: () => {},
  recheck: () => {},
};

describe("useUpdater", () => {
  it("returns the provided updater instance", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <UpdaterProvider value={fake}>{children}</UpdaterProvider>
    );
    const { result } = renderHook(() => useUpdater(), { wrapper });
    expect(result.current).toBe(fake);
  });

  it("throws when used outside a provider", () => {
    // React logs the render failure through console.error; the throw is the
    // assertion here, so keep the expected stack trace out of the test output.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => renderHook(() => useUpdater())).toThrow(/UpdaterProvider/);
    } finally {
      logged.mockRestore();
    }
  });
});
