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

import { filterCandidates } from "./varContext";
import type { VarCandidate } from "./candidates";

const C = (name: string): VarCandidate => ({ name, value: "", origin: "env" });

describe("filterCandidates", () => {
  it("returns all when partial is empty", () => {
    expect(filterCandidates([C("a"), C("b")], "").map((c) => c.name)).toEqual(["a", "b"]);
  });
  it("case-insensitive substring match, prefix matches first", () => {
    const out = filterCandidates([C("api_root"), C("host"), C("hostname")], "host");
    expect(out.map((c) => c.name)).toEqual(["host", "hostname"]);
  });
  it("keeps prefix before mid-substring, preserving input order within a rank", () => {
    const out = filterCandidates([C("x_host"), C("host"), C("hostly")], "host");
    expect(out.map((c) => c.name)).toEqual(["host", "hostly", "x_host"]);
  });
});

import { applyVarPick } from "./varContext";

describe("applyVarPick", () => {
  it("inserts {{name}} and places caret after }} (no closing ahead)", () => {
    // value="a {{ho", caret at end (6)
    expect(applyVarPick("a {{ho", 6, "host")).toEqual({ value: "a {{host}}", caret: 10 });
  });
  it("does not duplicate }} when closing already ahead", () => {
    // value="a {{ho}}", caret after "ho" (6), "}}" follows
    expect(applyVarPick("a {{ho}}", 6, "host")).toEqual({ value: "a {{host}}", caret: 10 });
  });
  it("returns null when caret is not in an open token", () => {
    expect(applyVarPick("plain", 5, "host")).toBeNull();
  });
});
