import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { VAR_PATTERN_SOURCE } from "@/features/vars/varGrammar.gen";

const SAMPLES = [
  "{{host}}",
  "{{uri-root}}",
  "{{user.name}}",
  "{{a/b}}",
  "{{$guid}}",
  "{{$unixMs}}",
  "{{123}}",
  "{{ключ}}",
  "{{a b}}",
  "{{notes-api-root}}",
];

function dollarPrefixed(source: string): string {
  const open = "\\{\\{(";
  if (!source.startsWith(open))
    throw new Error("VAR_PATTERN_SOURCE must start with {{(");
  return "\\{\\{\\$(" + source.slice(open.length);
}

describe("monaco var rules", () => {
  it("uses the generated pattern with a $ prefix, not the ident class", () => {
    const src = readFileSync(path.join(process.cwd(), "src/lib/monaco.ts"), "utf8");
    expect(src).toContain("VAR_PATTERN_SOURCE");
    expect(src).toContain("variable.dynamic");
    expect(src).not.toContain("[a-zA-Z_][a-zA-Z0-9_\\-]*");
  });

  it("matches the core corpus, including dots and slashes", () => {
    const core = new RegExp(VAR_PATTERN_SOURCE);
    const dynamic = new RegExp(dollarPrefixed(VAR_PATTERN_SOURCE));
    for (const sample of SAMPLES) {
      expect(core.test(sample), sample).toBe(true);
    }
    expect(dynamic.test("{{$guid}}")).toBe(true);
    expect(dynamic.test("{{user.name}}")).toBe(false);
    expect(dynamic.test("{{a/b}}")).toBe(false);
  });
});
