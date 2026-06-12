import { describe, it, expect, vi } from "vitest";
import { resolveAuthHeader } from "./actions";
import type { SavedAuthConfigIpc, AuthCredentialsIpc, ResolutionReportIpc } from "@/ipc/bindings";

const report = (resolved: string, unresolved: string[] = []): ResolutionReportIpc => ({
  resolved,
  unresolved_vars: unresolved,
  cycle_chain: null,
});

const okCreds: AuthCredentialsIpc = { header_name: "authorization", header_value: "Bearer T" };

describe("resolveAuthHeader", () => {
  const passthroughVars = (t: string) => Promise.resolve(report(t));

  it("returns none for kind none", async () => {
    const r = await resolveAuthHeader({ kind: "none" }, "prod", {
      authResolve: vi.fn(),
      varsResolve: passthroughVars,
    });
    expect(r.kind).toBe("none");
  });

  it("gates out a prod-scoped config in a different env", async () => {
    const auth: SavedAuthConfigIpc = {
      kind: "env_var", env_var: "T", header_name: "authorization", prefix: "Bearer ", environments: ["prod"],
    };
    const authResolve = vi.fn();
    const r = await resolveAuthHeader(auth, "dev", { authResolve, varsResolve: passthroughVars });
    expect(r.kind).toBe("none");
    expect(authResolve).not.toHaveBeenCalled();
  });

  it("gates out a prod-scoped config under No environment (null)", async () => {
    const auth: SavedAuthConfigIpc = {
      kind: "env_var", env_var: "T", header_name: "authorization", prefix: "Bearer ", environments: ["prod"],
    };
    const r = await resolveAuthHeader(auth, null, { authResolve: vi.fn(), varsResolve: passthroughVars });
    expect(r.kind).toBe("none");
  });

  it("resolves oauth2 vars and returns the header + invalidate handle", async () => {
    const auth: SavedAuthConfigIpc = {
      kind: "oauth2_client_credentials",
      token_url: "https://idp/token",
      client_id: "cid",
      client_secret: "{{secret}}",
      scopes: [],
      header_name: "authorization",
      prefix: "Bearer ",
      environments: [],
    };
    const varsResolve = vi.fn(async (t: string) => report(t === "{{secret}}" ? "S3CRET" : t));
    const authResolve = vi.fn(async (_c: SavedAuthConfigIpc) => okCreds as AuthCredentialsIpc);
    const r = await resolveAuthHeader(auth, "prod", { authResolve, varsResolve });
    expect(r.kind).toBe("header");
    if (r.kind === "header") {
      expect(r.header).toEqual({ key: "authorization", value: "Bearer T" });
      expect(r.invalidate?.kind).toBe("oauth2_client_credentials");
      if (r.invalidate?.kind === "oauth2_client_credentials") {
        expect(r.invalidate.client_secret).toBe("S3CRET");
      }
    }
    expect(authResolve.mock.calls[0][0]).toMatchObject({ client_secret: "S3CRET" });
  });

  it("errors when an oauth2 var is unresolved", async () => {
    const auth: SavedAuthConfigIpc = {
      kind: "oauth2_client_credentials",
      token_url: "{{url}}", client_id: "c", client_secret: "s", scopes: [],
      header_name: "authorization", prefix: "Bearer ", environments: [],
    };
    const varsResolve = vi.fn(async (t: string) =>
      t === "{{url}}" ? report("{{url}}", ["url"]) : report(t),
    );
    const r = await resolveAuthHeader(auth, "prod", { authResolve: vi.fn(), varsResolve });
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("url");
  });
});
