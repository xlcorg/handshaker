import { describe, it, expect } from "vitest";
import { buildVarCandidates } from "./candidates";
import { BUILTIN_NAMES } from "./builtins";

describe("buildVarCandidates", () => {
  it("lists collection first, then env, env wins on name clash (marked overrides)", () => {
    const out = buildVarCandidates(
      { host: "api.staging", token: "jwt" },
      { host: "api.local", order_id: "42" },
    );
    // user-var prefix: collection-only first, then env entries (including override)
    expect(out.slice(0, 3)).toEqual([
      { name: "order_id", value: "42", origin: "collection" },
      { name: "host", value: "api.staging", origin: "env", overrides: true },
      { name: "token", value: "jwt", origin: "env" },
    ]);
    // builtins appended after user vars
    expect(out.slice(-BUILTIN_NAMES.length).map((c) => c.name)).toEqual([...BUILTIN_NAMES]);
  });

  it("handles missing sides and skips undefined values", () => {
    const emptyOut = buildVarCandidates(undefined, undefined);
    // only builtins remain when no user vars
    expect(emptyOut).toHaveLength(BUILTIN_NAMES.length);
    expect(emptyOut.every((c) => c.origin === "builtin")).toBe(true);

    const aOnly = buildVarCandidates({ a: "1", b: undefined }, undefined);
    expect(aOnly.slice(0, 1)).toEqual([{ name: "a", value: "1", origin: "env" }]);
    expect(aOnly).toHaveLength(1 + BUILTIN_NAMES.length);

    const cOnly = buildVarCandidates(undefined, { c: "3" });
    expect(cOnly.slice(0, 1)).toEqual([{ name: "c", value: "3", origin: "collection" }]);
    expect(cOnly).toHaveLength(1 + BUILTIN_NAMES.length);
  });

  it("appends builtin candidates after user vars", () => {
    const out = buildVarCandidates({ host: "api.dev" }, {});
    const names = out.map((c) => c.name);
    expect(names[0]).toBe("host");
    expect(names.slice(-BUILTIN_NAMES.length)).toEqual([...BUILTIN_NAMES]);
    expect(out.at(-BUILTIN_NAMES.length)!.origin).toBe("builtin");
  });
});
