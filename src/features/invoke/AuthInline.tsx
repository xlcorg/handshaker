import { Key } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { cn } from "@/lib/cn";
import { EnvVarField } from "@/features/collections/overview/EnvVarField";

export type AuthKind = "none" | "bearer" | "apikey" | "basic" | "mtls";

export interface AuthState {
  kind: AuthKind;
  bearerTokenVar: string; // env-var NAME, e.g. PROD_API_TOKEN (no braces)
  apiHeader: string;      // e.g. x-api-key
  apiValueVar: string;    // env-var NAME
}

export const AUTH_DEFAULTS: AuthState = {
  kind: "none",
  bearerTokenVar: "",
  apiHeader: "x-api-key",
  apiValueVar: "",
};

export interface AuthInlineProps {
  value: AuthState;
  onChange: (next: AuthState) => void;
}

export function AuthInline({ value, onChange }: AuthInlineProps) {
  function patch<K extends keyof AuthState>(k: K, v: AuthState[K]) {
    onChange({ ...value, [k]: v });
  }
  return (
    <div className="p-4 grid gap-4 overflow-auto scroll-thin">
      <ToggleGroup
        value={value.kind}
        onValueChange={(v) => patch("kind", v as AuthKind)}
        options={[
          { value: "none", label: "None" },
          { value: "bearer", label: "Bearer" },
          { value: "apikey", label: "API key" },
        ]}
      />
      {value.kind === "none" && (
        <div className="text-xs text-muted-foreground py-1">
          No authentication will be attached to this request.
        </div>
      )}
      {value.kind === "bearer" && (
        <>
          <EnvVarField
            label="Token"
            value={value.bearerTokenVar}
            onChange={(v) => patch("bearerTokenVar", v)}
            placeholder="BEARER_TOKEN_VAR"
          />
          <Field label="Metadata key">
            <FieldDisplay mono>authorization</FieldDisplay>
          </Field>
          <Field label="Prefix">
            <FieldDisplay mono>Bearer </FieldDisplay>
          </Field>
        </>
      )}
      {value.kind === "apikey" && (
        <>
          <Field label="Header name">
            <Input
              value={value.apiHeader}
              onChange={(e) => patch("apiHeader", e.target.value)}
              className="font-mono text-[12.5px]"
            />
          </Field>
          <EnvVarField
            label="Value"
            value={value.apiValueVar}
            onChange={(v) => patch("apiValueVar", v)}
            placeholder="API_KEY_VAR"
          />
        </>
      )}
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-1">
        <Key className="size-3 shrink-0" />
        <span>
          Secrets are referenced by environment-variable name — the value lives in the
          environment, never in the request.
        </span>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function FieldDisplay({ mono, children }: { mono?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("h-9 px-3 rounded-md border border-input bg-background flex items-center text-sm", mono && "font-mono text-[12.5px]")}>
      {children}
    </div>
  );
}
