import { describe, it, expect } from "vitest";
import { buildVarCandidates } from "./candidates";

describe("buildVarCandidates", () => {
  it("lists collection first, then env, env wins on name clash (marked overrides)", () => {
    const out = buildVarCandidates(
      { host: "api.staging", token: "jwt" },
      { host: "api.local", order_id: "42" },
    );
    expect(out).toEqual([
      { name: "order_id", value: "42", origin: "collection" },
      { name: "host", value: "api.staging", origin: "env", overrides: true },
      { name: "token", value: "jwt", origin: "env" },
    ]);
  });

  it("handles missing sides and skips undefined values", () => {
    expect(buildVarCandidates(undefined, undefined)).toEqual([]);
    expect(buildVarCandidates({ a: "1", b: undefined }, undefined)).toEqual([
      { name: "a", value: "1", origin: "env" },
    ]);
    expect(buildVarCandidates(undefined, { c: "3" })).toEqual([
      { name: "c", value: "3", origin: "collection" },
    ]);
  });
});
