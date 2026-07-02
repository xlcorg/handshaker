import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { MessageSchemaIpc } from "@/ipc/bindings";

const fetchMock = vi.fn();
vi.mock("./actions", () => ({
  fetchMessageSchemaSafe: (...args: unknown[]) => fetchMock(...args),
}));

import { useMessageSchema } from "./useMessageSchema";

const SCHEMA: MessageSchemaIpc = { root: "t.M", messages: [], enums: [] };

describe("useMessageSchema", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("does not fetch and returns null when method is empty", () => {
    const { result } = renderHook(() =>
      useMessageSchema({ address: "h:1", tls: false, service: "t.S", method: "" }),
    );
    expect(result.current).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches and returns the schema for a method", async () => {
    fetchMock.mockResolvedValue(SCHEMA);
    const { result } = renderHook(() =>
      useMessageSchema({ address: "h:1", tls: false, service: "t.S", method: "Call" }),
    );
    await waitFor(() => expect(result.current).toEqual(SCHEMA));
    expect(fetchMock).toHaveBeenCalledWith({ address: "h:1", tls: false, collectionId: null, skipVerify: false }, "t.S", "Call", "input");
  });

  it("caches input and output sides separately", async () => {
    const OUT: MessageSchemaIpc = { root: "t.Out", messages: [], enums: [] };
    fetchMock.mockResolvedValueOnce(SCHEMA).mockResolvedValueOnce(OUT);
    const target = { address: "sides-host", tls: false, service: "S", method: "M" };

    const a = renderHook(() => useMessageSchema(target, "input"));
    await waitFor(() => expect(a.result.current).toEqual(SCHEMA));

    const b = renderHook(() => useMessageSchema(target, "output"));
    await waitFor(() => expect(b.result.current).toEqual(OUT));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      { address: "sides-host", tls: false, collectionId: null, skipVerify: false }, "S", "M", "output",
    );
  });

  it("refetches when the env resolve key changes (env switch / edit — same target)", async () => {
    const FIRST: MessageSchemaIpc = { root: "t.First", messages: [], enums: [] };
    const SECOND: MessageSchemaIpc = { root: "t.Second", messages: [], enums: [] };
    fetchMock.mockResolvedValueOnce(FIRST).mockResolvedValueOnce(SECOND);
    const target = { address: "env-key-host", tls: false, service: "S", method: "M" };

    const { result, rerender } = renderHook(
      ({ envKey }: { envKey: string }) => useMessageSchema(target, "input", 0, envKey),
      { initialProps: { envKey: "|prod|0" } },
    );
    await waitFor(() => expect(result.current).toEqual(FIRST));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A different active env resolves the address differently; the raw target is unchanged,
    // so without folding the env key into the cache key the contract would freeze.
    rerender({ envKey: "|staging|0" });
    await waitFor(() => expect(result.current).toEqual(SECOND));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refetches the same target when the revision bumps (manual reflection refresh)", async () => {
    const FIRST: MessageSchemaIpc = { root: "t.First", messages: [], enums: [] };
    const SECOND: MessageSchemaIpc = { root: "t.Second", messages: [], enums: [] };
    fetchMock.mockResolvedValueOnce(FIRST).mockResolvedValueOnce(SECOND);
    const target = { address: "revision-host", tls: false, service: "S", method: "M" };

    const { result, rerender } = renderHook(
      ({ rev }: { rev: number }) => useMessageSchema(target, "input", rev),
      { initialProps: { rev: 0 } },
    );
    await waitFor(() => expect(result.current).toEqual(FIRST));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Refresh: a bumped revision must bypass the process-wide cache and refetch —
    // otherwise the contract/hints freeze on the first result ("one-time action").
    rerender({ rev: 1 });
    await waitFor(() => expect(result.current).toEqual(SECOND));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
