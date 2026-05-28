import { Key, Upload } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { cn } from "@/lib/cn";

export type AuthKind = "none" | "bearer" | "basic" | "mtls" | "api";

export interface AuthState {
  kind: AuthKind;
  bearerToken: string;
  basicUser: string;
  basicPass: string;
  apiHeader: string;
  apiValue: string;
}

export const AUTH_DEFAULTS: AuthState = {
  kind: "none",
  bearerToken: "",
  basicUser: "",
  basicPass: "",
  apiHeader: "x-api-key",
  apiValue: "",
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
          { value: "basic", label: "Basic" },
          { value: "mtls", label: "mTLS" },
          { value: "api", label: "API key" },
        ]}
      />
      {value.kind === "bearer" && (
        <>
          <Field label="Token">
            <Input
              value={value.bearerToken}
              onChange={(e) => patch("bearerToken", e.target.value)}
              placeholder="{{accessToken}}"
              className="font-mono text-[12.5px]"
            />
          </Field>
          <Field label="Metadata key">
            <FieldDisplay mono>authorization</FieldDisplay>
          </Field>
          <Field label="Prefix">
            <FieldDisplay mono>Bearer </FieldDisplay>
          </Field>
        </>
      )}
      {value.kind === "basic" && (
        <>
          <Field label="Username">
            <Input value={value.basicUser} onChange={(e) => patch("basicUser", e.target.value)} className="font-mono text-[12.5px]" />
          </Field>
          <Field label="Password">
            <Input type="password" value={value.basicPass} onChange={(e) => patch("basicPass", e.target.value)} className="font-mono text-[12.5px]" />
          </Field>
          <p className="text-[11px] text-muted-foreground">
            Basic auth is UI-only for now and won't be attached to the outgoing request.
          </p>
        </>
      )}
      {value.kind === "api" && (
        <>
          <Field label="Header name">
            <Input value={value.apiHeader} onChange={(e) => patch("apiHeader", e.target.value)} className="font-mono text-[12.5px]" />
          </Field>
          <Field label="Value">
            <Input value={value.apiValue} onChange={(e) => patch("apiValue", e.target.value)} placeholder="{{apiKey}}" className="font-mono text-[12.5px]" />
          </Field>
          <p className="text-[11px] text-muted-foreground">
            API-key auth is UI-only for now and won't be attached to the outgoing request.
          </p>
        </>
      )}
      {value.kind === "mtls" && (
        <>
          <Field label="Client certificate"><CertZone empty desc="Drop client.crt or click to choose" /></Field>
          <Field label="Client key"><CertZone empty desc="Drop client.key or click to choose" /></Field>
          <Field label="Root CA (optional)"><CertZone empty desc="Drop ca.pem or click to choose" /></Field>
          <p className="text-[11px] text-muted-foreground">
            mTLS is UI-only for now and won't be applied to the channel.
          </p>
        </>
      )}
      {value.kind === "none" && (
        <div className="text-xs text-muted-foreground py-1">
          No authentication will be attached to this request.
        </div>
      )}
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

function CertZone({ name, desc, empty }: { name?: string; desc: string; empty?: boolean }) {
  return (
    <div className={cn(
      "flex items-center gap-3 p-3.5 rounded-md border bg-card",
      empty ? "border-dashed border-border" : "border-border",
    )}>
      <div className="h-7 w-7 rounded-md border border-border flex items-center justify-center text-muted-foreground">
        {empty ? <Upload className="size-3.5" /> : <Key className="size-3.5" />}
      </div>
      <div className="flex-1 min-w-0">
        {name && <div className="font-mono text-xs text-foreground">{name}</div>}
        <div className={cn("text-[11px] text-muted-foreground", name && "mt-0.5")}>{desc}</div>
      </div>
    </div>
  );
}
