import { describe, it, expect } from "vitest";
import { openVarToken } from "./varContext";

describe("openVarToken", () => {
  it("returns the partial after the last unclosed {{", () => {
    expect(openVarToken("host = {{ho")).toEqual({ partial: "ho", tokenStart: 7 });
    expect(openVarToken("{{")).toEqual({ partial: "", tokenStart: 0 });
    expect(openVarToken("{{api.ho")).toEqual({ partial: "api.ho", tokenStart: 0 });
  });

  it("returns null when there is no open token", () => {
    expect(openVarToken("plain")).toBeNull();
    expect(openVarToken("{single")).toBeNull();
    expect(openVarToken("{{x}}")).toBeNull();          // closed
    expect(openVarToken("{{x}} then {{y")).toEqual({ partial: "y", tokenStart: 11 });
  });

  it("rejects a partial containing braces (token already closed/broken)", () => {
    expect(openVarToken("{{a}")).toBeNull();
  });
});
