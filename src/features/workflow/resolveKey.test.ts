import { describe, expect, it } from "vitest";

import { idleResolveKey, resolveKey } from "./resolveKey";
import { useDraftReflection } from "./useDraftReflection";

describe("resolveKey", () => {
  it("builds the call and HTTP shape", () => {
    expect(
      resolveKey({ collectionId: "col", envName: "prod", envRevision: 3 }),
    ).toBe("col|prod|3");
    expect(
      resolveKey({ collectionId: null, envName: null, envRevision: 0 }),
    ).toBe(idleResolveKey);
  });

  it("changes when the env revision changes", () => {
    const first = resolveKey({
      collectionId: "col",
      envName: "prod",
      envRevision: 1,
    });
    const second = resolveKey({
      collectionId: "col",
      envName: "prod",
      envRevision: 2,
    });
    expect(first).not.toBe(second);
  });

  it("appends unsaved vars only when the overview editor passes them", () => {
    const saved = resolveKey({
      collectionId: "col",
      envName: "prod",
      envRevision: 1,
    });
    const unsaved = resolveKey({
      collectionId: "col",
      envName: "prod",
      envRevision: 1,
      unsavedVars: { host: "api" },
    });
    expect(unsaved).toBe(`col|prod|1|${JSON.stringify({ host: "api" })}`);
    expect(saved).not.toContain("host");
  });
});

/** Compile-time lock for the hole `0fbe103` left: `""` is not a `ResolveKey`. */
export function emptyStringIsNotAResolveKey(): void {
  // @ts-expect-error "" is not a ResolveKey — omission must not typecheck
  useDraftReflection("localhost:443", true, true, null, "");
}
