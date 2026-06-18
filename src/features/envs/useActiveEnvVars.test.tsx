import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const envList = vi.fn();
vi.mock("@/ipc/client", () => ({ envList: () => envList() }));
vi.mock("@/features/workflow/store", () => ({
  useActiveWorkflow: () => ({ envName: "staging" }),
}));
vi.mock("./envRevision", () => ({ useEnvRevision: () => 0 }));

import { useActiveEnvVars } from "./useActiveEnvVars";

describe("useActiveEnvVars", () => {
  beforeEach(() => envList.mockReset());

  it("returns the active env's variables (undefined values filtered)", async () => {
    envList.mockResolvedValue([
      { name: "staging", variables: { host: "api", token: undefined }, color: null },
      { name: "prod", variables: { host: "p" }, color: null },
    ]);
    const { result } = renderHook(() => useActiveEnvVars());
    await waitFor(() => expect(result.current).toEqual({ host: "api" }));
  });
});
