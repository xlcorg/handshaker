import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ResolutionReportIpc } from "@/ipc/bindings";
import { ipc } from "@/ipc/client";
import { EnvVarField } from "./EnvVarField";
import { formToConfig, type AuthForm } from "./authConfigMap";
import { faultFromUnknown } from "@/features/workflow/netDiagnostics";
import { useEnvRevision } from "@/features/envs/envRevision";
import { VarHighlightInput } from "@/features/vars/VarHighlightInput";
import type { VarCandidate } from "@/features/vars/candidates";
import { VAR_FIELD_FRAME, VAR_FIELD_METRICS } from "./varField";
import type { ResolveKey } from "@/features/workflow/resolveKey";
import { messages } from "@/lib/messages";

const m = messages.catalog.overview.auth;

const DEAD_ENV_CLASS = "line-through text-muted-foreground";

type TokenStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; message: string; token: string }
  | { kind: "error"; message: string };

function truncateToken(token: string): string {
  return token.length > 21 ? `${token.slice(0, 20)}…` : token;
}

function msg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

export interface AuthSchemeFieldsProps {
  form: AuthForm;
  patch: (next: Partial<AuthForm>) => void;
  noneMessage: string;
  resolver?: (t: string) => Promise<ResolutionReportIpc>;
  resolveKey?: ResolveKey;
  variables?: VarCandidate[];
}

export function AuthSchemeFields({
  form,
  patch,
  noneMessage,
  resolver,
  resolveKey,
  variables,
}: AuthSchemeFieldsProps) {
  // A plain function (not a component) keeps the <input> reconciled by position, so
  // editing one OAuth2 field never remounts and drops focus.
  const oauthField = (opts: {
    value: string;
    onChange: (v: string) => void;
    ariaLabel: string;
    placeholder?: string;
  }) => (
    <VarHighlightInput
      value={opts.value}
      onChange={opts.onChange}
      ariaLabel={opts.ariaLabel}
      placeholder={opts.placeholder}
      resolver={resolver}
      resolveKey={resolveKey}
      variables={variables}
      metrics={VAR_FIELD_METRICS}
      className={VAR_FIELD_FRAME}
    />
  );

  const [envNames, setEnvNames] = useState<string[]>([]);
  const envRevision = useEnvRevision();
  useEffect(() => {
    void ipc.envList().then((envs) => setEnvNames(envs.map((e) => e.name))).catch(() => {});
  }, [envRevision]);

  const [token, setToken] = useState<TokenStatus>({ kind: "idle" });
  const onGetToken = async () => {
    const cfg = formToConfig(form);
    if (cfg.kind !== "oauth2_client_credentials") return;
    setToken({ kind: "loading" });
    try {
      const info = await ipc.authOauth2Preview(cfg);
      setToken({
        kind: "ok",
        message: m.tokenExpiry(Math.round(info.expires_in_secs / 60)),
        token: info.access_token,
      });
    } catch (e) {
      setToken({ kind: "error", message: faultFromUnknown(e).message });
    }
  };

  const onCopyToken = async (token: string) => {
    try {
      await writeText(token);
      toast.success(m.tokenCopied);
    } catch (e) {
      toast.error(m.copyTokenFailed(msg(e)));
    }
  };

  const toggleEnv = (name: string) => {
    const has = form.environments.includes(name);
    patch({ environments: has ? form.environments.filter((n) => n !== name) : [...form.environments, name] });
  };

  const deadEnvNames = form.environments.filter((n) => !envNames.includes(n));
  const popoverNames = [...envNames, ...deadEnvNames];

  const envScopeRow = form.kind !== "none" && (
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
      <span>{m.applyInEnvironments}</span>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 text-xs">
            {form.environments.length === 0 ? (
              m.allEnvironments
            ) : (
              <span className="flex flex-wrap gap-x-1">
                {form.environments.map((name, i) => {
                  const dead = deadEnvNames.includes(name);
                  return (
                    <span key={name}>
                      <span className={dead ? DEAD_ENV_CLASS : undefined} title={dead ? m.envDeletedTitle : undefined}>
                        {name}
                      </span>
                      {i < form.environments.length - 1 ? "," : ""}
                    </span>
                  );
                })}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-1">
          {popoverNames.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">{m.noEnvironments}</div>}
          {popoverNames.map((name) => {
            const dead = deadEnvNames.includes(name);
            return (
              <button
                key={name}
                type="button"
                onClick={() => toggleEnv(name)}
                title={dead ? m.envDeletedTitle : undefined}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
              >
                <span className="w-3">{form.environments.includes(name) ? "✓" : ""}</span>
                <span className={dead ? DEAD_ENV_CLASS : undefined}>{name}</span>
                {dead && <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground/70">{m.envDeletedHint}</span>}
              </button>
            );
          })}
        </PopoverContent>
      </Popover>
    </div>
  );

  return (
    <div className="grid gap-4">
      {form.kind === "none" && (
        <div className="py-1 text-xs text-muted-foreground">{noneMessage}</div>
      )}

      {form.kind === "bearer" && (
        <EnvVarField label={m.tokenLabel} value={form.envVar} onChange={(v) => patch({ envVar: v })} placeholder={m.tokenPlaceholder} />
      )}

      {form.kind === "apikey" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">{m.headerName}</Label>
              <Input value={form.headerName} onChange={(e) => patch({ headerName: e.target.value })} placeholder={m.headerNamePlaceholderApiKey} className="h-9 font-mono text-[12.5px]" />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">{m.prefix}</Label>
              <Input value={form.prefix} onChange={(e) => patch({ prefix: e.target.value })} placeholder={m.prefixPlaceholder} className="h-9 font-mono text-[12.5px]" />
            </div>
          </div>
          <EnvVarField label={m.valueLabel} value={form.envVar} onChange={(v) => patch({ envVar: v })} placeholder={m.valuePlaceholder} />
        </>
      )}

      {form.kind === "oauth2" && (
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label className="text-xs">{m.tokenUrl}</Label>
            {oauthField({
              value: form.tokenUrl,
              onChange: (v) => patch({ tokenUrl: v }),
              ariaLabel: m.tokenUrl,
              placeholder: m.tokenUrlPlaceholder,
            })}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">{m.clientId}</Label>
              {oauthField({
                value: form.clientId,
                onChange: (v) => patch({ clientId: v }),
                ariaLabel: m.clientId,
              })}
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">{m.clientSecret}</Label>
              {oauthField({
                value: form.clientSecret,
                onChange: (v) => patch({ clientSecret: v }),
                ariaLabel: m.clientSecret,
                placeholder: m.clientSecretPlaceholder,
              })}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">{m.scope}</Label>
            {oauthField({
              value: form.scope,
              onChange: (v) => patch({ scope: v }),
              ariaLabel: m.scope,
              placeholder: m.scopePlaceholder,
            })}
          </div>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">{m.headerAndPrefix}</summary>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs">{m.headerName}</Label>
                <Input value={form.oauthHeaderName} onChange={(e) => patch({ oauthHeaderName: e.target.value })} placeholder={m.headerNamePlaceholderOauth} className="h-9 font-mono text-[12.5px]" />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">{m.prefix}</Label>
                <Input value={form.oauthPrefix} onChange={(e) => patch({ oauthPrefix: e.target.value })} className="h-9 font-mono text-[12.5px]" />
              </div>
            </div>
          </details>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={onGetToken} disabled={token.kind === "loading"}>
              {token.kind === "loading" ? m.gettingToken : m.getToken}
            </Button>
            {token.kind === "ok" && (
              <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-ok">
                <code className="truncate font-mono text-muted-foreground">{truncateToken(token.token)}</code>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={m.copyToken}
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => void onCopyToken(token.token)}
                >
                  <Copy />
                </Button>
                <span className="flex-none">{token.message}</span>
              </span>
            )}
            {token.kind === "error" && <span className="text-[11px] text-destructive">{token.message}</span>}
          </div>
        </div>
      )}

      {envScopeRow}
    </div>
  );
}
