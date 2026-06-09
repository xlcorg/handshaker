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
    expect(fetchMock).toHaveBeenCalledWith({ address: "h:1", tls: false }, "t.S", "Call");
  });
});
