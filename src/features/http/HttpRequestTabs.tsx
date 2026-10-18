import { useState } from "react";
import type {
  HttpTemplateIpc,
  ResolutionReportIpc,
  SavedAuthConfigIpc,
} from "@/ipc/bindings";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import { MetadataEditor } from "@/features/workflow/MetadataEditor";
import { AuthReadOnly } from "@/features/workflow/RequestTabs";
import type { VarCandidate } from "@/features/vars/candidates";
import type { ResolveKey } from "@/features/workflow/resolveKey";
import { messages } from "@/lib/messages";
import { HttpBodyEditor } from "./HttpBodyEditor";

type Tab = "params" | "headers" | "body" | "auth";

export interface HttpRequestTabsProps {
  template: HttpTemplateIpc;
  /** The pick core made from the request's and the collection's auth. */
  effectiveAuth: SavedAuthConfigIpc;
  onChange: (patch: Partial<HttpTemplateIpc>) => void;
  onSubmit?: () => void;
  varCandidates?: VarCandidate[];
  resolver?: (t: string) => Promise<ResolutionReportIpc>;
  resolveKey?: ResolveKey;
}

export function HttpRequestTabs({
  template,
  effectiveAuth,
  onChange,
  onSubmit,
  varCandidates,
  resolver,
  resolveKey,
}: HttpRequestTabsProps) {
  const [tab, setTab] = useState<Tab>("params");
  const t = messages.http.tabs;
  const rowsEditor = (key: "query" | "headers") => (
    <div className="h-full overflow-auto">
      <MetadataEditor
        rows={template[key]}
        onChange={(rows) => onChange({ [key]: rows })}
        variables={varCandidates}
        resolver={resolver}
        resolveKey={resolveKey}
      />
    </div>
  );
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 flex-none items-center border-b border-border px-3.5">
        <UnderlineTabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { value: "params", label: t.params },
            { value: "headers", label: t.headers },
            { value: "body", label: t.body },
            { value: "auth", label: t.auth },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "params" && rowsEditor("query")}
        {tab === "headers" && rowsEditor("headers")}
        {tab === "body" && (
          <HttpBodyEditor
            body={template.body}
            onChange={(body) => onChange({ body })}
            onSubmit={onSubmit}
            varCandidates={varCandidates}
            resolver={resolver}
            resolveKey={resolveKey}
          />
        )}
        {tab === "auth" && (
          <div className="h-full overflow-auto">
            <AuthReadOnly auth={effectiveAuth} />
          </div>
        )}
      </div>
    </div>
  );
}
