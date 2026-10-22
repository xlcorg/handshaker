import { afterEach, describe, expect, it, vi } from "vitest";
import { newId, uuidV7Millis } from "./ids";

describe("uuidV7Millis", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads back the creation time newId encoded", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_760_000_000_123);
    const id = newId();
    expect(uuidV7Millis(id)).toBe(1_760_000_000_123);
    expect(uuidV7Millis(id.toUpperCase())).toBe(1_760_000_000_123);
  });

  it("is null for ids that are not v7", () => {
    expect(uuidV7Millis("0b8e5f7a-3c2d-4e1f-9a6b-7c8d9e0f1a2b")).toBeNull();
    expect(uuidV7Millis("c1")).toBeNull();
    expect(uuidV7Millis("")).toBeNull();
  });
});
