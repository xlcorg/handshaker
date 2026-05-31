import { useState } from "react";
import { KeyRound } from "lucide-react";
import { Input } from "@/components/ui/input";
import { EnvVarField } from "./EnvVarField";
import { MiniSelect, type MiniSelectOption } from "./MiniSelect";
import { cn } from "@/lib/cn";

// ── Auth entry shape (exported for Task 4.2 to map to SavedAuthConfigIpc) ──────

export type AuthType = "none" | "bearer" | "apikey" | "basic" | "mtls";

export interface BearerAuth {
  type: "bearer";
  tokenVar: string;
}

export interface ApiKeyAuth {
  type: "apikey";
  headerName: string;
  valueVar: string;
}

export interface BasicAuth {
  type: "basic";
  userVar: string;
  passVar: string;
}

export interface MtlsAuth {
  type: "mtls";
}

export interface NoneAuth {
  type: "none";
}

export type AuthEntry = NoneAuth | BearerAuth | ApiKeyAuth | BasicAuth | MtlsAuth;

// ── AuthType option shape (extends MiniSelectOption so disabled/hint work) ──────
export type AuthTypeOption = MiniSelectOption & { value: AuthType };

// ── Environment descriptor ───────────────────────────────────────────────────────
export interface AuthEnvironment {
  name: string;
  color?: string;
}

interface AuthBlockProps {
  environments: AuthEnvironment[];
  value: Record<string, AuthEntry>;
  onChange: (next: Record<string, AuthEntry>) => void;
  authTypes: AuthTypeOption[];
}

export function AuthBlock({ environments, value, onChange, authTypes }: AuthBlockProps) {
  const [activeEnv, setActiveEnv] = useState(environments[0]?.name ?? "");

  const cur: AuthEntry = value[activeEnv] ?? { type: "none" };

  const setType = (t: AuthType) => {
    const next: AuthEntry = (() => {
      switch (t) {
        case "bearer": return { type: "bearer", tokenVar: "" };
        case "apikey": return { type: "apikey", headerName: "x-api-key", valueVar: "" };
        case "basic":  return { type: "basic", userVar: "", passVar: "" };
        case "mtls":   return { type: "mtls" };
        default:       return { type: "none" };
      }
    })();
    onChange({ ...value, [activeEnv]: next });
  };

  // Patch helpers for each auth type — each re-spreads the current entry
  const patchBearer = (partial: Partial<Omit<BearerAuth, "type">>) => {
    if (cur.type !== "bearer") return;
    onChange({ ...value, [activeEnv]: { ...cur, ...partial } });
  };
  const patchApiKey = (partial: Partial<Omit<ApiKeyAuth, "type">>) => {
    if (cur.type !== "apikey") return;
    onChange({ ...value, [activeEnv]: { ...cur, ...partial } });
  };
  const patchBasic = (partial: Partial<Omit<BasicAuth, "type">>) => {
    if (cur.type !== "basic") return;
    onChange({ ...value, [activeEnv]: { ...cur, ...partial } });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* environment selector */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <span className="text-[11.5px] text-muted-foreground/80">Environment</span>
        <div className="inline-flex items-center rounded-md border border-border bg-muted/40 p-0.5 gap-0.5">
          {environments.map((e) => (
            <button
              key={e.name}
              onClick={() => setActiveEnv(e.name)}
              className={cn(
                "inline-flex items-center gap-1.5 h-6 px-2 rounded text-[11.5px] transition-colors",
                activeEnv === e.name
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: e.color }} />
              {e.name}
            </button>
          ))}
        </div>
      </div>

      {/* method */}
      <div className="flex items-center gap-2.5">
        <span className="text-[11.5px] text-muted-foreground/80 w-[68px] flex-none">Method</span>
        <MiniSelect
          value={cur.type}
          onChange={(v) => setType(v as AuthType)}
          options={authTypes}
          className="w-[200px]"
        />
      </div>

      {/* editor */}
      <div className="rounded-md border border-border/70 bg-muted/20 p-3.5">
        {cur.type === "none" && (
          <p className="text-[12px] text-muted-foreground/55">
            No authentication for{" "}
            <span className="text-foreground/80">{activeEnv}</span>. Requests are sent without
            credentials.
          </p>
        )}
        {cur.type === "bearer" && (
          <EnvVarField
            label="Token"
            value={cur.tokenVar}
            onChange={(v) => patchBearer({ tokenVar: v })}
            placeholder="BEARER_TOKEN_VAR"
          />
        )}
        {cur.type === "basic" && (
          <div className="grid grid-cols-2 gap-3">
            <EnvVarField
              label="Username"
              value={cur.userVar}
              onChange={(v) => patchBasic({ userVar: v })}
              placeholder="BASIC_USER_VAR"
            />
            <EnvVarField
              label="Password"
              value={cur.passVar}
              onChange={(v) => patchBasic({ passVar: v })}
              placeholder="BASIC_PASS_VAR"
            />
          </div>
        )}
        {cur.type === "apikey" && (
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11.5px] text-muted-foreground/80">Header name</span>
              <Input
                value={cur.headerName}
                onChange={(e) => patchApiKey({ headerName: e.target.value })}
                className="h-8 font-mono text-[12px]"
              />
            </label>
            <EnvVarField
              label="Value"
              value={cur.valueVar}
              onChange={(v) => patchApiKey({ valueVar: v })}
              placeholder="API_KEY_VAR"
            />
          </div>
        )}
        {cur.type === "mtls" && (
          <p className="text-[12px] text-muted-foreground/55">
            mTLS is not yet configurable in this version.
          </p>
        )}
      </div>

      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground/55 leading-relaxed">
        <span className="mt-0.5 flex-none">
          <KeyRound size={11} />
        </span>
        Secrets are referenced by environment-variable name. The value itself lives in the selected
        environment — never stored in the collection.
      </p>
    </div>
  );
}
