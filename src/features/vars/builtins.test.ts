import { describe, expect, it } from "vitest";
import { BUILTIN_NAMES, isBuiltinName, BUILTIN_CANDIDATES } from "./builtins";

describe("builtins", () => {
  it("recognizes known $-names only", () => {
    expect(isBuiltinName("$guid")).toBe(true);
    expect(isBuiltinName("$isoTimestamp")).toBe(true);
    expect(isBuiltinName("$foo")).toBe(false);
    expect(isBuiltinName("guid")).toBe(false);
  });

  it("exposes one candidate per builtin, origin builtin, description as value", () => {
    expect(BUILTIN_CANDIDATES).toHaveLength(BUILTIN_NAMES.length);
    const guid = BUILTIN_CANDIDATES.find((c) => c.name === "$guid")!;
    expect(guid.origin).toBe("builtin");
    expect(guid.value).toMatch(/GUID/);
  });
});
