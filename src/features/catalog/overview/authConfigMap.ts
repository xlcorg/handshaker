import type { SavedAuthConfigIpc } from "@/ipc/bindings";

export type AuthFormKind = "none" | "bearer" | "apikey" | "oauth2";

export interface AuthForm {
  kind: AuthFormKind;
  envVar: string; // env-var NAME (for env_var configs)
  headerName: string; // header for apikey
  prefix: string; // value prefix (apikey)
}

export const AUTH_FORM_DEFAULTS: AuthForm = {
  kind: "none",
  envVar: "",
  headerName: "x-api-key",
  prefix: "",
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
        kind: isBearer ? "bearer" : "apikey",
        envVar: config.env_var,
        headerName: config.header_name,
        prefix: config.prefix,
      };
    }
    case "oauth_2_client_credentials":
      return { ...AUTH_FORM_DEFAULTS, kind: "oauth2" };
  }
}

/** Map the editor form back to a stored single-auth config. */
export function formToConfig(form: AuthForm): SavedAuthConfigIpc {
  switch (form.kind) {
    case "none":
    case "oauth2": // OAuth2 client-credentials is not editable here; persist as "none".
      return { kind: "none" };
    case "bearer":
      return {
        kind: "env_var",
        env_var: form.envVar.trim(),
        header_name: BEARER_HEADER,
        prefix: BEARER_PREFIX,
      };
    case "apikey":
      return {
        kind: "env_var",
        env_var: form.envVar.trim(),
        header_name: form.headerName.trim() || "x-api-key",
        prefix: form.prefix,
      };
  }
}
