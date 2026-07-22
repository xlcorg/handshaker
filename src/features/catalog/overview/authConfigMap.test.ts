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

  it("seeds the api-key header field empty when the stored header is the kind default", () => {
    const cfg: SavedAuthConfigIpc = {
      kind: "env_var", env_var: "KEY", header_name: "x-api-key", prefix: "", environments: [],
    };
    const form = configToForm(cfg);
    expect(form.kind).toBe("apikey");
    expect(form.headerName).toBe("");
    // Empty field persists back to the default header.
    expect(formToConfig(form)).toEqual(cfg);
  });

  it("preserves a custom api-key header across a round trip", () => {
    const cfg: SavedAuthConfigIpc = {
      kind: "env_var", env_var: "KEY", header_name: "x-custom-key", prefix: "", environments: [],
    };
    const form = configToForm(cfg);
    expect(form.headerName).toBe("x-custom-key");
    expect(formToConfig(form)).toEqual(cfg);
  });

  it("round-trips an api-key prefix and keeps an empty prefix empty", () => {
    const withPrefix: SavedAuthConfigIpc = {
      kind: "env_var", env_var: "KEY", header_name: "x-custom-key", prefix: "Token ", environments: [],
    };
    expect(configToForm(withPrefix).prefix).toBe("Token ");
    expect(formToConfig(configToForm(withPrefix))).toEqual(withPrefix);

    const noPrefix: SavedAuthConfigIpc = {
      kind: "env_var", env_var: "KEY", header_name: "x-custom-key", prefix: "", environments: [],
    };
    expect(configToForm(noPrefix).prefix).toBe("");
    expect(formToConfig(configToForm(noPrefix))).toEqual(noPrefix);
  });

  it("infers Bearer from the canonical authorization + 'Bearer ' pair", () => {
    const cfg: SavedAuthConfigIpc = {
      kind: "env_var", env_var: "T", header_name: "authorization", prefix: "Bearer ", environments: [],
    };
    expect(configToForm(cfg).kind).toBe("bearer");
    expect(formToConfig(configToForm(cfg))).toEqual(cfg);
  });

  it("seeds the oauth2 header field empty when the stored header is the default", () => {
    const cfg: SavedAuthConfigIpc = {
      kind: "oauth2_client_credentials",
      token_url: "https://idp/token", client_id: "cid", client_secret: "s",
      scopes: [], header_name: "authorization", prefix: "Bearer ", environments: [],
    };
    expect(configToForm(cfg).oauthHeaderName).toBe("");
    expect(formToConfig(configToForm(cfg))).toEqual(cfg);
  });
});
