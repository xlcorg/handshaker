import { Key } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup } from "@/components/ui/toggle-group";
import type { SavedAuthConfigIpc } from "@/ipc/bindings";
import { EnvVarField } from "./EnvVarField";
import { configToForm, formToConfig, type AuthForm } from "./authConfigMap";

export interface SavedAuthEditorProps {
  value: SavedAuthConfigIpc;
  onChange: (next: SavedAuthConfigIpc) => void;
}

const KIND_OPTIONS = [
  { value: "none", label: "None" },
  { value: "bearer", label: "Bearer" },
  { value: "apikey", label: "API key" },
];

/** Edit a single `SavedAuthConfigIpc` (collection node auth). None / Bearer / API key map to
 *  `none`/`env_var`; an existing OAuth2 config is shown as a read-only notice. */
export function SavedAuthEditor({ value, onChange }: SavedAuthEditorProps) {
  const form = configToForm(value);
  const patch = (next: Partial<AuthForm>) => onChange(formToConfig({ ...form, ...next }));

  if (form.kind === "oauth2") {
    return (
      <div className="grid gap-3 text-xs">
        <ToggleGroup
          value="oauth2"
          onValueChange={(v) => patch({ kind: v as AuthForm["kind"] })}
          options={KIND_OPTIONS}
        />
        <div className="rounded-md border border-border bg-card p-3 text-muted-foreground">
          OAuth2 client-credentials is configured but not editable here yet. Switch to another
          type to replace it.
        </div>
      </div>
    );
  }

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
        <EnvVarField
          label="Token"
          value={form.envVar}
          onChange={(v) => patch({ envVar: v })}
          placeholder="BEARER_TOKEN_VAR"
        />
      )}
      {form.kind === "apikey" && (
        <>
          <div className="grid gap-1.5">
            <Label className="text-xs">Header name</Label>
            <Input
              value={form.headerName}
              onChange={(e) => patch({ headerName: e.target.value })}
              className="h-9 font-mono text-[12.5px]"
            />
          </div>
          <EnvVarField
            label="Value"
            value={form.envVar}
            onChange={(v) => patch({ envVar: v })}
            placeholder="API_KEY_VAR"
          />
        </>
      )}
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Key className="size-3 shrink-0" />
        <span>
          Secrets are referenced by environment-variable name — the value lives in the
          environment, never in the request.
        </span>
      </div>
    </div>
  );
}
