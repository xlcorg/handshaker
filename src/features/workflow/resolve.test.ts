import { describe, it, expect } from "vitest";
import type { ResolutionReportIpc } from "@/ipc/bindings";
import { resolveStepTemplates } from "./resolve";

// Fake resolver: substitutes {{x}} from a fixed table; reports the rest unresolved.
function fakeResolver(table: Record<string, string>) {
  return async (tpl: string): Promise<ResolutionReportIpc> => {
    const unresolved: string[] = [];
    const resolved = tpl.replace(/\{\{([^{}]+)\}\}/g, (_, name) => {
      if (name in table) return table[name];
      unresolved.push(name);
      return `{{${name}}}`;
    });
    return { resolved, unresolved_vars: unresolved, cycle_chain: null };
  };
}

const step = {
  address: "{{host}}:443",
  requestJson: '{"id":"{{id}}"}',
  metadata: [
    { key: "x-tenant", value: "{{tenant}}", enabled: true },
    { key: "x-skip", value: "{{nope}}", enabled: false },
    { key: "", value: "{{noKey}}", enabled: true },
  ],
};

describe("resolveStepTemplates", () => {
  it("resolves address, body and enabled metadata", async () => {
    const r = await resolveStepTemplates(step, fakeResolver({ host: "api.internal", id: "42", tenant: "acme" }));
    expect(r.ok).toBe(true);
    expect(r.request.address).toBe("api.internal:443");
    expect(r.request.requestJson).toBe('{"id":"42"}');
    expect(r.request.metadata).toEqual([{ key: "x-tenant", value: "acme" }]);
  });

  it("aggregates unresolved vars (deduped) and blocks", async () => {
    const r = await resolveStepTemplates(step, fakeResolver({ host: "api.internal" }));
    expect(r.ok).toBe(false);
    expect(r.unresolved).toEqual(["id", "tenant"]); // disabled + keyless rows skipped
  });

  it("reports the first cycle chain and is not ok", async () => {
    const resolver = async (tpl: string): Promise<ResolutionReportIpc> =>
      tpl.includes("{{a}}")
        ? { resolved: tpl, unresolved_vars: [], cycle_chain: ["a", "b", "a"] }
        : { resolved: tpl, unresolved_vars: [], cycle_chain: null };
    const r = await resolveStepTemplates(
      { address: "{{a}}", requestJson: "{}", metadata: [] },
      resolver,
    );
    expect(r.ok).toBe(false);
    expect(r.cycle).toEqual(["a", "b", "a"]);
  });
});
