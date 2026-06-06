import { useState } from "react";
import { BodyEditor } from "@/features/invoke/BodyEditor";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import type { SavedAuthConfigIpc } from "@/ipc/bindings";
import { MetadataEditor } from "./MetadataEditor";
import type { MetadataRow, Step } from "./model";

type Tab = "request" | "metadata" | "auth";

export interface RequestTabsProps {
  step: Step;
  serviceAuth: SavedAuthConfigIpc;
  onBody: (value: string) => void;
  onMetadata: (rows: MetadataRow[]) => void;
}

export function RequestTabs({ step, serviceAuth, onBody, onMetadata }: RequestTabsProps) {
  const [tab, setTab] = useState<Tab>("request");
  return (
    <div className="flex h-full flex-col">
      <div className="h-10 flex-none flex items-center border-b border-border px-3.5">
        <UnderlineTabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { value: "request", label: "Request" },
            { value: "metadata", label: "Metadata" },
            { value: "auth", label: "Auth" },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "request" ? <BodyEditor value={step.requestJson} onChange={onBody} /> : null}
        {tab === "metadata" ? <MetadataEditor rows={step.metadata} onChange={onMetadata} /> : null}
        {tab === "auth" ? <AuthReadOnly auth={serviceAuth} /> : null}
      </div>
    </div>
  );
}

function AuthReadOnly({ auth }: { auth: SavedAuthConfigIpc }) {
  return (
    <div className="space-y-2 p-3.5 text-xs">
      <div className="text-muted-foreground">
        Auth наследуется от сервиса (настраивается в панели сервиса).
      </div>
      <div className="rounded-md border border-border bg-card p-3 font-mono">
        <div>kind: {auth.kind}</div>
        {auth.kind === "env_var" ? (
          <>
            <div>variable: {auth.env_var}</div>
            <div>header: {auth.header_name}</div>
            <div>prefix: {auth.prefix}</div>
          </>
        ) : null}
        {auth.kind === "oauth_2_client_credentials" ? (
          <div className="text-destructive">OAuth2 — не реализовано (master §5.4)</div>
        ) : null}
      </div>
    </div>
  );
}
