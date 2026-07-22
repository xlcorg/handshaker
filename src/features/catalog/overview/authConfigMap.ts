import type { SavedAuthConfigIpc } from "@/ipc/bindings";

export type AuthFormKind = "none" | "bearer" | "apikey" | "oauth2";

export interface AuthForm {
  kind: AuthFormKind;
  // env_var (bearer/apikey)
  envVar: string;
  headerName: string;
  prefix: string;
  // oauth2
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string; // space-separated; maps to scopes[]
  oauthHeaderName: string;
  oauthPrefix: string;
  // env gating (env_var + oauth2). Empty = all environments.
  environments: string[];
}

export const OAUTH_DEFAULT_HEADER = "authorization";
export const OAUTH_DEFAULT_PREFIX = "Bearer ";
export const APIKEY_DEFAULT_HEADER = "x-api-key";

export const AUTH_FORM_DEFAULTS: AuthForm = {
  kind: "none",
  envVar: "",
  // Header name fields seed empty so the kind default shows as a placeholder; empty
  // normalizes back to the default only at persist (formToConfig).
  headerName: "",
  prefix: "",
  tokenUrl: "",
  clientId: "",
  clientSecret: "",
  scope: "",
  oauthHeaderName: "",
  oauthPrefix: OAUTH_DEFAULT_PREFIX,
  environments: [],
};

const BEARER_HEADER = "authorization";
const BEARER_PREFIX = "Bearer ";

/** Map a stored single-auth config to the editor form. */
export function configToForm(config: SavedAuthConfigIpc): AuthForm {
  switch (config.kind) {
    case "none":
      return { ...AUTH_FORM_DEFAULTS };
    case "env_var": {
      const isBearer = config.header_name === BEARER_HEADER && config.prefix === BEARER_PREFIX;
      return {
        ...AUTH_FORM_DEFAULTS,
        kind: isBearer ? "bearer" : "apikey",
        envVar: config.env_var,
        // A header equal to the kind default seeds empty (placeholder shows); a custom
        // header is preserved verbatim. Prefix is never placeholder-mapped.
        headerName: config.header_name === APIKEY_DEFAULT_HEADER ? "" : config.header_name,
        prefix: config.prefix,
        environments: config.environments ?? [],
      };
    }
    case "oauth2_client_credentials":
      return {
        ...AUTH_FORM_DEFAULTS,
        kind: "oauth2",
        tokenUrl: config.token_url,
        clientId: config.client_id,
        clientSecret: config.client_secret,
        scope: config.scopes.join(" "),
        // Header equal to the OAuth2 default seeds empty (placeholder shows); custom preserved.
        oauthHeaderName: !config.header_name || config.header_name === OAUTH_DEFAULT_HEADER ? "" : config.header_name,
        oauthPrefix: config.prefix ?? OAUTH_DEFAULT_PREFIX,
        environments: config.environments ?? [],
      };
  }
}

/** Map the editor form back to a stored single-auth config. */
export function formToConfig(form: AuthForm): SavedAuthConfigIpc {
  switch (form.kind) {
    case "none":
      return { kind: "none" };
    case "bearer":
      return {
        kind: "env_var",
        env_var: form.envVar.trim(),
        header_name: BEARER_HEADER,
        prefix: BEARER_PREFIX,
        environments: form.environments,
      };
    case "apikey":
      return {
        kind: "env_var",
        env_var: form.envVar.trim(),
        header_name: form.headerName.trim() || APIKEY_DEFAULT_HEADER,
        prefix: form.prefix,
        environments: form.environments,
      };
    case "oauth2":
      return {
        kind: "oauth2_client_credentials",
        token_url: form.tokenUrl.trim(),
        client_id: form.clientId.trim(),
        client_secret: form.clientSecret,
        scopes: form.scope.split(/\s+/).filter(Boolean),
        header_name: form.oauthHeaderName.trim() || OAUTH_DEFAULT_HEADER,
        prefix: form.oauthPrefix,
        environments: form.environments,
      };
  }
}
