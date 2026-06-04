import { useState } from "react";
import { BodyEditor } from "@/features/invoke/BodyEditor";
import { cn } from "@/lib/cn";
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
  const tabs: { id: Tab; label: string }[] = [
    { id: "request", label: "Request" },
    { id: "metadata", label: "Metadata" },
    { id: "auth", label: "Auth" },
  ];
  return (
    <div className="flex h-full flex-col">
      <div role="tablist" className="flex flex-none gap-1 border-b border-border px-2 py-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded px-2 py-0.5 text-xs",
              tab === t.id ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
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
