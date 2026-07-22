import { describe, it, expect } from "vitest";
import type { ResolutionReportIpc } from "@/ipc/bindings";
import { linkTarget, linkLabel, renderableLinks, type LinkRow } from "./linkTarget";

function report(resolved: string, unresolved: string[] = [], cycle: string[] | null = null): ResolutionReportIpc {
  return { resolved, unresolved_vars: unresolved, cycle_chain: cycle, dynamic_vars: [] };
}

describe("linkTarget — effective URL (https:// default)", () => {
  it("prepends https:// to a template-free scheme-less URL", () => {
    const t = linkTarget("grafana.corp/d/abc", null);
    expect(t).toEqual({ kind: "ready", url: "https://grafana.corp/d/abc", title: "Open https://grafana.corp/d/abc" });
  });

  it("treats a bare host:port as scheme-less and defaults https://", () => {
    const t = linkTarget("localhost:8080", null);
    expect(t).toMatchObject({ kind: "ready", url: "https://localhost:8080" });
  });

  it("leaves a schemed URL untouched", () => {
    const t = linkTarget("http://logs.example", null);
    expect(t).toMatchObject({ kind: "ready", url: "http://logs.example" });
  });

  it("leaves a non-http(s) scheme untouched (fails later at the seam)", () => {
    const t = linkTarget("grafana://board", null);
    expect(t).toMatchObject({ kind: "ready", url: "grafana://board" });
  });

  it("defaults https:// after resolving a scheme-less template", () => {
    const t = linkTarget("{{host}}/dash", report("grafana.corp/dash"));
    expect(t).toMatchObject({ kind: "ready", url: "https://grafana.corp/dash" });
  });

  it("leaves a template that resolves to a schemed URL untouched", () => {
    const t = linkTarget("{{base}}/dash", report("https://grafana.corp/dash"));
    expect(t).toMatchObject({ kind: "ready", url: "https://grafana.corp/dash" });
  });
});

describe("linkTarget — empty / broken", () => {
  it("classifies a blank template-free URL as broken", () => {
    expect(linkTarget("   ", null).kind).toBe("broken");
  });

  it("classifies a template that resolves to blank as broken", () => {
    expect(linkTarget("{{host}}", report("   ")).kind).toBe("broken");
  });

  it("stays pending until the template resolves", () => {
    const t = linkTarget("{{host}}/dash", null);
    expect(t.kind).toBe("pending");
  });

  it("marks unresolved vars broken", () => {
    expect(linkTarget("{{host}}/dash", report("{{host}}/dash", ["host"])).kind).toBe("broken");
  });
});

describe("linkLabel — host of the effective URL", () => {
  it("uses the name when present", () => {
    expect(linkLabel("Grafana", "grafana.corp")).toBe("Grafana");
  });

  it("labels a nameless scheme-less URL by the effective host", () => {
    expect(linkLabel("  ", "grafana.corp/d/abc")).toBe("grafana.corp");
  });

  it("labels a nameless schemed URL by its host", () => {
    expect(linkLabel("", "https://logs.example/app")).toBe("logs.example");
  });
});

describe("renderableLinks — empty-URL filtering", () => {
  const rows: LinkRow[] = [
    { id: "a", name: "A", url: "grafana.corp" },
    { id: "b", name: "B", url: "  " },
    { id: "c", name: "C", url: "" },
  ];

  it("drops rows whose stored URL is blank", () => {
    expect(renderableLinks(rows).map((r) => r.id)).toEqual(["a"]);
  });
});
