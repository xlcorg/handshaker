import { describe, it, expect } from "vitest";
import { configToForm, formToConfig, AUTH_FORM_DEFAULTS } from "./authConfigMap";
import type { SavedAuthConfigIpc } from "@/ipc/bindings";

describe("authConfigMap", () => {
  it("maps oauth2 config to form and back (round trip)", () => {
    const cfg: SavedAuthConfigIpc = {
      kind: "oauth2_client_credentials",
      token_url: "https://idp/token",
      client_id: "cid",
      client_secret: "{{secret}}",
      scopes: ["a", "b"],
      header_name: "authorization",
      prefix: "Bearer ",
      environments: ["prod"],
    };
    const form = configToForm(cfg);
    expect(form.kind).toBe("oauth2");
    expect(form.scope).toBe("a b");
    expect(form.environments).toEqual(["prod"]);
    expect(formToConfig(form)).toEqual(cfg);
  });

  it("splits scope on whitespace and drops empties", () => {
    const form = { ...AUTH_FORM_DEFAULTS, kind: "oauth2" as const, scope: "  a   b  " };
    const cfg = formToConfig(form);
    expect(cfg.kind === "oauth2_client_credentials" && cfg.scopes).toEqual(["a", "b"]);
  });

  it("carries environments on bearer/apikey", () => {
    const form = { ...AUTH_FORM_DEFAULTS, kind: "bearer" as const, envVar: "T", environments: ["prod"] };
    const cfg = formToConfig(form);
    expect(cfg.kind === "env_var" && cfg.environments).toEqual(["prod"]);
  });

  it("oauth2 form falls back to default header/prefix when blank", () => {
    const form = { ...AUTH_FORM_DEFAULTS, kind: "oauth2" as const, oauthHeaderName: "  " };
    const cfg = formToConfig(form);
    expect(cfg.kind === "oauth2_client_credentials" && cfg.header_name).toBe("authorization");
  });
});
