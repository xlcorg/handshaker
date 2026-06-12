import { useEffect, useState } from "react";
import { Key } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { SavedAuthConfigIpc } from "@/ipc/bindings";
import { ipc } from "@/ipc/client";
import { EnvVarField } from "./EnvVarField";
import { configToForm, formToConfig, type AuthForm } from "./authConfigMap";
import { resolveOauthConfig } from "@/features/workflow/actions";

export interface SavedAuthEditorProps {
  value: SavedAuthConfigIpc;
  onChange: (next: SavedAuthConfigIpc) => void;
}

const KIND_OPTIONS = [
  { value: "none", label: "None" },
  { value: "bearer", label: "Bearer" },
  { value: "apikey", label: "API key" },
  { value: "oauth2", label: "OAuth2" },
];

type TokenStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

function msg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

export function SavedAuthEditor({ value, onChange }: SavedAuthEditorProps) {
  const form = configToForm(value);
  const patch = (next: Partial<AuthForm>) => onChange(formToConfig({ ...form, ...next }));

  const [envNames, setEnvNames] = useState<string[]>([]);
  useEffect(() => {
    void ipc.envList().then((envs) => setEnvNames(envs.map((e) => e.name))).catch(() => {});
  }, []);

  const [token, setToken] = useState<TokenStatus>({ kind: "idle" });
  const onGetToken = async () => {
    const cfg = formToConfig(form);
    if (cfg.kind !== "oauth2_client_credentials") return;
    setToken({ kind: "loading" });
    const resolved = await resolveOauthConfig(cfg, ipc.varsResolve);
    if (!resolved.ok) {
      setToken({ kind: "error", message: resolved.message });
      return;
    }
    try {
      const info = await ipc.authOauth2FetchToken(resolved.config);
      setToken({ kind: "ok", message: `Token acquired · expires in ${Math.round(info.expires_in_secs / 60)} min` });
    } catch (e) {
      setToken({ kind: "error", message: msg(e) });
    }
  };

  const toggleEnv = (name: string) => {
    const has = form.environments.includes(name);
    patch({ environments: has ? form.environments.filter((n) => n !== name) : [...form.environments, name] });
  };

  const envScopeRow = form.kind !== "none" && (
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
      <span>Apply in environments:</span>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 text-xs">
            {form.environments.length === 0 ? "All environments" : form.environments.join(", ")}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-1">
          {envNames.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No environments</div>}
          {envNames.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => toggleEnv(name)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
            >
              <span className="w-3">{form.environments.includes(name) ? "✓" : ""}</span>
              <span>{name}</span>
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );

  return (
    <div className="grid gap-4">
      <ToggleGroup
        value={form.kind}
        onValueChange={(v) => patch({ kind: v as AuthForm["kind"] })}
        options={KIND_OPTIONS}
      />

      {form.kind === "none" && (
        <div className="py-1 text-xs text-muted-foreground">
          No authentication is attached to this collection's requests.
        </div>
      )}

      {form.kind === "bearer" && (
        <EnvVarField label="Token" value={form.envVar} onChange={(v) => patch({ envVar: v })} placeholder="BEARER_TOKEN_VAR" />
      )}

      {form.kind === "apikey" && (
        <>
          <div className="grid gap-1.5">
            <Label className="text-xs">Header name</Label>
            <Input value={form.headerName} onChange={(e) => patch({ headerName: e.target.value })} className="h-9 font-mono text-[12.5px]" />
          </div>
          <EnvVarField label="Value" value={form.envVar} onChange={(v) => patch({ envVar: v })} placeholder="API_KEY_VAR" />
        </>
      )}

      {form.kind === "oauth2" && (
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label className="text-xs">Token URL</Label>
            <Input value={form.tokenUrl} onChange={(e) => patch({ tokenUrl: e.target.value })} placeholder="https://idp/realms/x/protocol/openid-connect/token" className="h-9 font-mono text-[12.5px]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">Client ID</Label>
              <Input value={form.clientId} onChange={(e) => patch({ clientId: e.target.value })} className="h-9 font-mono text-[12.5px]" />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Client secret</Label>
              <Input value={form.clientSecret} onChange={(e) => patch({ clientSecret: e.target.value })} placeholder="{{secret}}" className="h-9 font-mono text-[12.5px]" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Scope</Label>
            <Input value={form.scope} onChange={(e) => patch({ scope: e.target.value })} placeholder="scope-a scope-b" className="h-9 font-mono text-[12.5px]" />
          </div>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">Header &amp; prefix</summary>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs">Header name</Label>
                <Input value={form.oauthHeaderName} onChange={(e) => patch({ oauthHeaderName: e.target.value })} className="h-9 font-mono text-[12.5px]" />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Prefix</Label>
                <Input value={form.oauthPrefix} onChange={(e) => patch({ oauthPrefix: e.target.value })} className="h-9 font-mono text-[12.5px]" />
              </div>
            </div>
          </details>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={onGetToken} disabled={token.kind === "loading"}>
              {token.kind === "loading" ? "Getting token…" : "Get token"}
            </Button>
            {token.kind === "ok" && <span className="text-[11px] text-emerald-500">{token.message}</span>}
            {token.kind === "error" && <span className="text-[11px] text-destructive">{token.message}</span>}
          </div>
        </div>
      )}

      {envScopeRow}

      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Key className="size-3 shrink-0" />
        <span>
          OAuth2 fields accept <code>{"{{variables}}"}</code>; put the client secret in an
          environment variable. Bearer / API key reference an OS env-var name.
        </span>
      </div>
    </div>
  );
}
