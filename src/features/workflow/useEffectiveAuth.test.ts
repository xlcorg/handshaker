import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { SavedAuthConfigIpc } from "@/ipc/bindings";

vi.mock("@/ipc/client", () => ({
  authEffective: vi.fn(),
}));

import * as ipc from "@/ipc/client";
import { useEffectiveAuth } from "./useEffectiveAuth";

const NONE: SavedAuthConfigIpc = { kind: "none" };
const ENV_VAR: SavedAuthConfigIpc = {
  kind: "env_var",
  env_var: "TOK",
  header_name: "authorization",
  prefix: "Bearer ",
  environments: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useEffectiveAuth", () => {
  it("defaults to none until the backend resolves", async () => {
    let resolveFetch!: (v: SavedAuthConfigIpc) => void;
    vi.mocked(ipc.authEffective).mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const { result } = renderHook(() =>
      useEffectiveAuth(NONE, { collection_id: null, env_name: "prod" }, "rev-1"),
    );
    expect(result.current).toEqual(NONE);

    resolveFetch(ENV_VAR);
    await waitFor(() => expect(result.current).toEqual(ENV_VAR));
  });

  it("calls authEffective with the step auth and ctx", async () => {
    vi.mocked(ipc.authEffective).mockResolvedValue(ENV_VAR);
    renderHook(() => useEffectiveAuth(NONE, { collection_id: "c1", env_name: "prod" }, "rev-1"));
    await waitFor(() =>
      expect(ipc.authEffective).toHaveBeenCalledWith(NONE, { collection_id: "c1", env_name: "prod" }),
    );
  });

  it("re-fetches when revisionKey changes", async () => {
    const FIRST: SavedAuthConfigIpc = ENV_VAR;
    const SECOND: SavedAuthConfigIpc = { ...ENV_VAR, env_var: "TOK2" };
    vi.mocked(ipc.authEffective).mockResolvedValueOnce(FIRST).mockResolvedValueOnce(SECOND);

    const { result, rerender } = renderHook(
      ({ rev }: { rev: string }) => useEffectiveAuth(NONE, { collection_id: null, env_name: "prod" }, rev),
      { initialProps: { rev: "rev-1" } },
    );
    await waitFor(() => expect(result.current).toEqual(FIRST));
    expect(ipc.authEffective).toHaveBeenCalledTimes(1);

    rerender({ rev: "rev-2" });
    await waitFor(() => expect(result.current).toEqual(SECOND));
    expect(ipc.authEffective).toHaveBeenCalledTimes(2);
  });

  it("ignores a stale response that settles after a newer request started", async () => {
    let resolveFirst!: (v: SavedAuthConfigIpc) => void;
    let resolveSecond!: (v: SavedAuthConfigIpc) => void;
    vi.mocked(ipc.authEffective)
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveSecond = resolve; }));

    const SECOND: SavedAuthConfigIpc = { ...ENV_VAR, env_var: "TOK2" };
    const { result, rerender } = renderHook(
      ({ rev }: { rev: string }) => useEffectiveAuth(NONE, { collection_id: null, env_name: "prod" }, rev),
      { initialProps: { rev: "rev-1" } },
    );

    rerender({ rev: "rev-2" }); // fires the second fetch before the first settles
    resolveSecond(SECOND);
    await waitFor(() => expect(result.current).toEqual(SECOND));

    resolveFirst(ENV_VAR); // stale — must not clobber the newer result
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toEqual(SECOND);
  });
});
