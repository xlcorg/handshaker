import { describe, it, expect } from "vitest";
import { configToForm, formToConfig, AUTH_FORM_DEFAULTS } from "./authConfigMap";

describe("configToForm", () => {
  it("maps none → none", () => {
    expect(configToForm({ kind: "none" })).toEqual(AUTH_FORM_DEFAULTS);
  });

  it("maps env_var with authorization/'Bearer ' → bearer", () => {
    const form = configToForm({ kind: "env_var", env_var: "TOK", header_name: "authorization", prefix: "Bearer " });
    expect(form.kind).toBe("bearer");
    expect(form.envVar).toBe("TOK");
  });

  it("maps any other env_var → apikey, preserving header/prefix", () => {
    const form = configToForm({ kind: "env_var", env_var: "KEY", header_name: "x-api-key", prefix: "" });
    expect(form.kind).toBe("apikey");
    expect(form.envVar).toBe("KEY");
    expect(form.headerName).toBe("x-api-key");
  });

  it("maps oauth2 → oauth2", () => {
    const form = configToForm({
      kind: "oauth_2_client_credentials",
      token_url: "https://t",
      client_id: "id",
      client_secret_env_var: "SECRET",
      scopes: [],
    });
    expect(form.kind).toBe("oauth2");
  });
});

describe("formToConfig", () => {
  it("none → none", () => {
    expect(formToConfig({ ...AUTH_FORM_DEFAULTS, kind: "none" })).toEqual({ kind: "none" });
  });

  it("bearer → env_var with authorization/'Bearer ' and trimmed env var", () => {
    expect(formToConfig({ ...AUTH_FORM_DEFAULTS, kind: "bearer", envVar: " TOK " })).toEqual({
      kind: "env_var", env_var: "TOK", header_name: "authorization", prefix: "Bearer ",
    });
  });

  it("apikey → env_var with the custom header (defaulting blank to x-api-key)", () => {
    expect(formToConfig({ ...AUTH_FORM_DEFAULTS, kind: "apikey", envVar: "KEY", headerName: "x-key", prefix: "" })).toEqual({
      kind: "env_var", env_var: "KEY", header_name: "x-key", prefix: "",
    });
    const blankHeader = formToConfig({ ...AUTH_FORM_DEFAULTS, kind: "apikey", envVar: "KEY", headerName: "  " });
    expect(blankHeader.kind === "env_var" ? blankHeader.header_name : null).toBe("x-api-key");
  });

  it("oauth2 → none (not editable here)", () => {
    expect(formToConfig({ ...AUTH_FORM_DEFAULTS, kind: "oauth2" })).toEqual({ kind: "none" });
  });

  it("round-trips bearer through both maps", () => {
    const config = { kind: "env_var", env_var: "TOK", header_name: "authorization", prefix: "Bearer " } as const;
    expect(formToConfig(configToForm(config))).toEqual(config);
  });
});
