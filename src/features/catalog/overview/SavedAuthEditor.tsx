import { useEffect, useState } from "react";
import { Copy, Key } from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ResolutionReportIpc, SavedAuthConfigIpc } from "@/ipc/bindings";
import { ipc } from "@/ipc/client";
import { EnvVarField } from "./EnvVarField";
import { configToForm, formToConfig, type AuthForm } from "./authConfigMap";
import { resolveOauthConfig } from "@/features/workflow/actions";
import { useEnvRevision } from "@/features/envs/envRevision";
import { VarHighlightInput } from "@/features/vars/VarHighlightInput";
import type { VarCandidate } from "@/features/vars/candidates";
import { VAR_FIELD_FRAME, VAR_FIELD_METRICS } from "./varField";
import { messages } from "@/lib/messages";

const m = messages.catalog.overview.auth;

export interface SavedAuthEditorProps {
  value: SavedAuthConfigIpc;
  onChange: (next: SavedAuthConfigIpc) => void;
  /**
   * Re-seed the local edit buffer only when this changes (the collection identity). A
   * persist→reload echo of the *same* collection keeps the same key, so an in-progress
   * edit — a cleared Header name, a shortened Prefix — is never clobbered by the reload.
   */
  seedKey?: string;
  /**
   * Resolves a `{{var}}` template for the OAuth2 fields' inline highlighting — the same
   * env + collection-vars context the sibling Links/Variables blocks use, so the verdict
   * is honest to what Send resolves. Omit to render the OAuth2 fields as plain inputs.
   */
  resolver?: (t: string) => Promise<ResolutionReportIpc>;
  /** Extra resolve inputs (active env, unsaved collection vars, env revision); change ⇒ re-resolve. */
  resolveKey?: string;
  /** Variable candidates for `{{`-autocomplete inside the OAuth2 fields. */
  variables?: VarCandidate[];
}

/** Styling for a gating-list name whose environment no longer exists (see `deadEnvNames`). */
const DEAD_ENV_CLASS = "line-through text-muted-foreground";

const KIND_OPTIONS = [
  { value: "none", label: m.kinds.none },
  { value: "bearer", label: m.kinds.bearer },
  { value: "apikey", label: m.kinds.apikey },
  { value: "oauth2", label: m.kinds.oauth2 },
];

type TokenStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; message: string; token: string }
  | { kind: "error"; message: string };

/** Short preview for the UI — the full token only goes to the clipboard. */
function truncateToken(token: string): string {
  return token.length > 21 ? `${token.slice(0, 20)}…` : token;
}

function msg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

export function SavedAuthEditor({ value, onChange, seedKey, resolver, resolveKey, variables }: SavedAuthEditorProps) {
  // Local edit buffer, mirroring the sibling Variables/Links blocks: normalization (trim,
  // empty→default in formToConfig) happens only at persist time and never echoes back into
  // the live input. Re-seed only when the collection identity changes.
  const [form, setForm] = useState<AuthForm>(() => configToForm(value));
  useEffect(() => {
    setForm(configToForm(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);
  const patch = (next: Partial<AuthForm>) => {
    const nextForm = { ...form, ...next };
    setForm(nextForm);
    onChange(formToConfig(nextForm));
  };

  // The OAuth2 fields all share the same var-highlight wiring (resolver context, `{{`-
  // autocomplete candidates, and value-field framing). Bind it once so the four call
  // sites can't drift. A plain function (not a component) keeps the <input> reconciled
  // by position, so editing one field never remounts and drops focus.
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
  // Re-fetch when env contents change (e.g. an import adds environments) so the
  // "Apply in environments" list stays fresh while the editor is open.
  const envRevision = useEnvRevision();
  useEffect(() => {
    void ipc.envList().then((envs) => setEnvNames(envs.map((e) => e.name))).catch(() => {});
  }, [envRevision]);

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
      setToken({
        kind: "ok",
        message: m.tokenExpiry(Math.round(info.expires_in_secs / 60)),
        token: info.access_token,
      });
    } catch (e) {
      setToken({ kind: "error", message: msg(e) });
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

  // Names kept in the gating list but no longer existing (env deleted or renamed). Marked
  // in the popover and the summary button; still gate-inert (they simply never match).
  const deadEnvNames = form.environments.filter((n) => !envNames.includes(n));
  // Popover rows = every live env, plus any dead selected names so they stay uncheckable.
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
      <ToggleGroup
        value={form.kind}
        onValueChange={(v) => patch({ kind: v as AuthForm["kind"] })}
        options={KIND_OPTIONS}
      />

      {form.kind === "none" && (
        <div className="py-1 text-xs text-muted-foreground">{m.none}</div>
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
          {/* OAuth2 fields carry `{{var}}` templates; give them the same highlight +
              resolve-preview + `{{`-autocomplete treatment as the collection link URL,
              with a resolve verdict honest to what Send does (env + collection vars). */}
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

      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Key className="size-3 shrink-0" />
        <span>
          {m.hintBefore} <code>{"{{variables}}"}</code>
          {m.hintAfter}
        </span>
      </div>
    </div>
  );
}
