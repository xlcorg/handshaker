import { useEditBuffer } from "@/features/edit/useEditBuffer";
import { Key } from "lucide-react";
import { ToggleGroup } from "@/components/ui/toggle-group";
import type { ResolutionReportIpc, SavedAuthConfigIpc } from "@/ipc/bindings";
import { configToForm, formToConfig, type AuthForm } from "./authConfigMap";
import type { VarCandidate } from "@/features/vars/candidates";
import type { ResolveKey } from "@/features/workflow/resolveKey";
import { messages } from "@/lib/messages";
import { AuthSchemeFields } from "./AuthSchemeFields";

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
  resolveKey?: ResolveKey;
  /** Variable candidates for `{{`-autocomplete inside the OAuth2 fields. */
  variables?: VarCandidate[];
}

const KIND_OPTIONS = [
  { value: "none", label: m.kinds.none },
  { value: "bearer", label: m.kinds.bearer },
  { value: "apikey", label: m.kinds.apikey },
  { value: "oauth2", label: m.kinds.oauth2 },
];

export function SavedAuthEditor({
  value,
  onChange,
  seedKey,
  resolver,
  resolveKey,
  variables,
}: SavedAuthEditorProps) {
  // Normalization (trim, empty→default in formToConfig) happens only at persist time.
  // useEditBuffer reseeds when the collection identity changes, not when a reload
  // echoes a new server value for the same collection.
  const [form, setForm] = useEditBuffer(seedKey ?? "", value, configToForm);
  const patch = (next: Partial<AuthForm>) => {
    const nextForm = { ...form, ...next };
    setForm(nextForm);
    onChange(formToConfig(nextForm));
  };

  return (
    <div className="grid gap-4">
      <ToggleGroup
        value={form.kind}
        onValueChange={(v) => patch({ kind: v as AuthForm["kind"] })}
        options={KIND_OPTIONS}
      />
      <AuthSchemeFields
        form={form}
        patch={patch}
        noneMessage={m.none}
        resolver={resolver}
        resolveKey={resolveKey}
        variables={variables}
      />
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
