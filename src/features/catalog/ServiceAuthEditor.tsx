import type { SavedAuthConfigIpc } from "@/ipc/bindings";

export interface ServiceAuthEditorProps {
  value: SavedAuthConfigIpc;
  onChange: (next: SavedAuthConfigIpc) => void;
}

const ENV_VAR_DEFAULT: SavedAuthConfigIpc = {
  kind: "env_var",
  env_var: "",
  header_name: "authorization",
  prefix: "Bearer ",
};

const OAUTH_DEFAULT: SavedAuthConfigIpc = {
  kind: "oauth_2_client_credentials",
  token_url: "",
  client_id: "",
  client_secret_env_var: "",
  scopes: [],
};

export function ServiceAuthEditor({ value, onChange }: ServiceAuthEditorProps) {
  const onKind = (kind: SavedAuthConfigIpc["kind"]) => {
    if (kind === "none") onChange({ kind: "none" });
    else if (kind === "env_var") onChange(ENV_VAR_DEFAULT);
    else onChange(OAUTH_DEFAULT);
  };

  return (
    <div className="space-y-2 text-xs">
      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">Auth</span>
        <select
          aria-label="auth-kind"
          value={value.kind}
          onChange={(e) => onKind(e.target.value as SavedAuthConfigIpc["kind"])}
          className="h-7 rounded border border-border bg-background px-2"
        >
          <option value="none">None</option>
          <option value="env_var">Env var (Bearer)</option>
          <option value="oauth_2_client_credentials">OAuth2 (client credentials)</option>
        </select>
      </label>

      {value.kind === "env_var" ? (
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1 font-mono">
          <span className="text-muted-foreground">env var</span>
          <input
            aria-label="auth-env-var"
            value={value.env_var}
            onChange={(e) => onChange({ ...value, env_var: e.target.value })}
            placeholder="API_TOKEN"
            className="h-7 rounded border border-border bg-background px-2"
          />
          <span className="text-muted-foreground">header</span>
          <input
            aria-label="auth-header-name"
            value={value.header_name}
            onChange={(e) => onChange({ ...value, header_name: e.target.value })}
            className="h-7 rounded border border-border bg-background px-2"
          />
          <span className="text-muted-foreground">prefix</span>
          <input
            aria-label="auth-prefix"
            value={value.prefix}
            onChange={(e) => onChange({ ...value, prefix: e.target.value })}
            className="h-7 rounded border border-border bg-background px-2"
          />
        </div>
      ) : null}

      {value.kind === "oauth_2_client_credentials" ? (
        <div className="text-destructive">OAuth2 — не реализовано (master §5.4)</div>
      ) : null}
    </div>
  );
}
