import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("@/ipc/client", () => ({
  grpcContractRead: vi.fn(),
  grpcCancel: vi.fn(),
  varsResolve: vi.fn(),
}));

import * as ipc from "@/ipc/client";
import { resolveKey } from "./resolveKey";
import { useContractRead } from "./useContractRead";

const key = resolveKey({ collectionId: null, envName: null, envRevision: 0 });
const prodKey = resolveKey({
  collectionId: null,
  envName: "prod",
  envRevision: 0,
});
const stagingKey = resolveKey({
  collectionId: null,
  envName: "staging",
  envRevision: 0,
});

const cat = { services: [{ full_name: "p.v1.S", methods: [] }] };
const schema = { root: "t.M", messages: [], enums: [] };

function args(over: Partial<Parameters<typeof useContractRead>[0]> = {}) {
  return {
    addressTemplate: "h:443",
    tlsOverride: true as boolean | null,
    collectionId: null,
    envName: null,
    service: "p.v1.S",
    method: "M",
    resolveKey: key,
    enabled: true,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ipc.grpcContractRead).mockImplementation(
    async (_a, _t, _c, query) => {
      if (query.op === "schema") return { kind: "schema", schema } as never;
      return { kind: "catalog", catalog: cat } as never;
    },
  );
  vi.mocked(ipc.grpcCancel).mockResolvedValue(undefined as never);
});
afterEach(() => vi.useRealTimers());

describe("useContractRead", () => {
  it("reads the template after the address settles and does not resolve it first", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useContractRead(
        args({
          addressTemplate: "{{host}}:443",
          collectionId: "c",
          envName: "prod",
        }),
      ),
    );
    expect(ipc.grpcContractRead).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(ipc.varsResolve).not.toHaveBeenCalled();
    expect(ipc.grpcContractRead).toHaveBeenCalledWith(
      "{{host}}:443",
      true,
      { collection_id: "c", env_name: "prod" },
      { op: "catalog" },
      expect.any(String),
      expect.any(Number),
    );
    expect(result.current.catalog).toEqual(cat);
    expect(result.current.inputSchema).toEqual(schema);
    expect(result.current.outputSchema).toEqual(schema);
  });

  it("re-reads when the env resolve key changes", async () => {
    vi.useFakeTimers();
    const { rerender } = renderHook(
      ({ envKey }: { envKey: typeof prodKey }) =>
        useContractRead(args({ resolveKey: envKey })),
      { initialProps: { envKey: prodKey } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(ipc.grpcContractRead).toHaveBeenCalledTimes(3);

    rerender({ envKey: stagingKey });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(ipc.grpcContractRead).toHaveBeenCalledTimes(6);
  });

  it("does not read when the address is empty", async () => {
    vi.useFakeTimers();
    renderHook(() => useContractRead(args({ addressTemplate: "   " })));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(ipc.grpcContractRead).not.toHaveBeenCalled();
  });

  it("does not read when disabled", async () => {
    vi.useFakeTimers();
    renderHook(() => useContractRead(args({ enabled: false })));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(ipc.grpcContractRead).not.toHaveBeenCalled();
  });

  it("skips schemas when no method is selected", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useContractRead(args({ service: "", method: "" })),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(ipc.grpcContractRead).toHaveBeenCalledTimes(1);
    expect(result.current.inputSchema).toBeNull();
    expect(result.current.outputSchema).toBeNull();
  });

  it("refresh() force-refreshes and reloads both schemas", async () => {
    const { result } = renderHook(() => useContractRead(args()));
    await act(async () => {
      result.current.refresh();
    });
    await waitFor(() => expect(result.current.catalog).toEqual(cat));
    const ops = vi.mocked(ipc.grpcContractRead).mock.calls.map((c) => c[3].op);
    expect(ops).toEqual(["refresh", "schema", "schema"]);
  });

  it("sets error and clears the catalog when the read rejects", async () => {
    vi.mocked(ipc.grpcContractRead).mockRejectedValue({
      message: "no reflection",
    });
    const { result } = renderHook(() => useContractRead(args()));
    await act(async () => {
      result.current.refresh();
    });
    await waitFor(() => expect(result.current.error).toBe("no reflection"));
    expect(result.current.catalog).toBeNull();
  });

  it("turns a missing method into a null schema", async () => {
    vi.mocked(ipc.grpcContractRead).mockImplementation(
      async (_a, _t, _c, query) => {
        if (query.op === "schema") throw { type: "MethodNotFound" };
        return { kind: "catalog", catalog: cat } as never;
      },
    );
    const { result } = renderHook(() => useContractRead(args()));
    await act(async () => {
      result.current.refresh();
    });
    await waitFor(() => expect(result.current.catalog).toEqual(cat));
    expect(result.current.inputSchema).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("cancel() aborts the in-flight read by its request id", async () => {
    vi.mocked(ipc.grpcContractRead).mockImplementation(
      () => new Promise(() => {}),
    );
    const { result } = renderHook(() => useContractRead(args()));
    await waitFor(() => expect(ipc.grpcContractRead).toHaveBeenCalled());
    const requestId = vi.mocked(ipc.grpcContractRead).mock.calls[0][4];
    act(() => {
      result.current.cancel();
    });
    expect(ipc.grpcCancel).toHaveBeenCalledWith(requestId);
  });

  it("treats a user cancel as quiet", async () => {
    vi.mocked(ipc.grpcContractRead).mockRejectedValue({ type: "Cancelled" });
    const { result } = renderHook(() => useContractRead(args()));
    await act(async () => {
      result.current.refresh();
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
  });
});
