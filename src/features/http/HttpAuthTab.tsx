import { useEditBuffer } from "@/features/edit/useEditBuffer";
import { ToggleGroup } from "@/components/ui/toggle-group";
import type { RequestAuthIpc, ResolutionReportIpc, SavedAuthConfigIpc } from "@/ipc/bindings";
import { AuthSchemeFields } from "@/features/catalog/overview/AuthSchemeFields";
import { configToForm, formToConfig, type AuthForm } from "@/features/catalog/overview/authConfigMap";
import type { VarCandidate } from "@/features/vars/candidates";
import type { ResolveKey } from "@/features/workflow/resolveKey";
import { messages } from "@/lib/messages";

const kinds = messages.catalog.overview.auth.kinds;
const copy = messages.http.auth;

const MODES = [
  { value: "inherit", label: copy.inherit },
  { value: "none", label: kinds.none },
  { value: "bearer", label: kinds.bearer },
  { value: "apikey", label: kinds.apikey },
  { value: "oauth2", label: kinds.oauth2 },
] as const;

type Mode = (typeof MODES)[number]["value"];

export interface HttpAuthCollection {
  name: string;
  auth: SavedAuthConfigIpc;
}

export interface HttpAuthTabProps {
  draftId: string;
  auth: RequestAuthIpc;
  collection: HttpAuthCollection | null;
  onChange: (auth: RequestAuthIpc) => void;
  resolver?: (t: string) => Promise<ResolutionReportIpc>;
  resolveKey?: ResolveKey;
  variables?: VarCandidate[];
}

function inheritSummary(collection: HttpAuthCollection | null): string {
  if (!collection) return copy.notInCollection;
  if (collection.auth.kind === "none") return copy.hasNoAuth(collection.name);
  const scheme = kinds[configToForm(collection.auth).kind];
  return copy.applies(scheme, collection.name);
}

export function HttpAuthTab({
  draftId,
  auth,
  collection,
  onChange,
  resolver,
  resolveKey,
  variables,
}: HttpAuthTabProps) {
  const stored: SavedAuthConfigIpc = auth.kind === "override" ? auth.config : { kind: "none" };
  const [form, setForm] = useEditBuffer(draftId, stored, configToForm);
  const mode: Mode = auth.kind === "inherit" ? "inherit" : form.kind;

  const select = (next: Mode) => {
    if (next === "inherit") {
      onChange({ kind: "inherit" });
      return;
    }
    const nextForm = { ...form, kind: next };
    setForm(nextForm);
    onChange({ kind: "override", config: formToConfig(nextForm) });
  };

  const patch = (next: Partial<AuthForm>) => {
    const nextForm = { ...form, ...next };
    setForm(nextForm);
    onChange({ kind: "override", config: formToConfig(nextForm) });
  };

  return (
    <div className="grid gap-4 p-3.5">
      <ToggleGroup value={mode} onValueChange={(v) => select(v as Mode)} options={[...MODES]} />
      {auth.kind === "inherit" ? (
        <div className="py-1 text-xs text-muted-foreground">{inheritSummary(collection)}</div>
      ) : (
        <AuthSchemeFields
          form={form}
          patch={patch}
          noneMessage={copy.none}
          resolver={resolver}
          resolveKey={resolveKey}
          variables={variables}
        />
      )}
    </div>
  );
}
