import { useState } from "react";
import { RotateCcw, Type } from "lucide-react";
import { BodyEditor } from "@/features/invoke/BodyEditor";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import type { SavedAuthConfigIpc, MessageSchemaIpc } from "@/ipc/bindings";
import { usePrefs } from "@/lib/use-prefs";
import { MetadataEditor } from "./MetadataEditor";
import type { MetadataRow, Step } from "./model";

type Tab = "request" | "metadata" | "auth";

export interface RequestTabsProps {
  step: Step;
  serviceAuth: SavedAuthConfigIpc;
  onBody: (value: string) => void;
  onMetadata: (rows: MetadataRow[]) => void;
  /** Ctrl/Cmd+Enter inside the body editor → send. */
  onSubmit?: () => void;
  /** Reset the body to the current method's skeleton (draft only). Omit to hide the button. */
  onResetTemplate?: () => void;
  /** Flat field-schema for the current method; drives body autocomplete. */
  schema?: MessageSchemaIpc | null;
}

export function RequestTabs({ step, serviceAuth, onBody, onMetadata, onSubmit, onResetTemplate, schema }: RequestTabsProps) {
  const [tab, setTab] = useState<Tab>("request");
  const [prefs, setPref] = usePrefs();
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
        {tab === "request" ? (
          <div className="ml-auto flex items-center gap-1">
            <Tooltip content="Field hints">
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setPref("bodyHints", !prefs.bodyHints)}
                aria-label="Toggle field hints"
                aria-pressed={prefs.bodyHints}
                className={prefs.bodyHints ? "text-foreground" : "text-muted-foreground hover:text-foreground"}
              >
                <Type />
              </Button>
            </Tooltip>
            {onResetTemplate ? (
              <Tooltip content="Reset body to template">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={onResetTemplate}
                  disabled={step.method.trim().length === 0}
                  aria-label="Reset body to template"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <RotateCcw />
                </Button>
              </Tooltip>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "request" ? (
          <BodyEditor value={step.requestJson} onChange={onBody} onSubmit={onSubmit} schema={schema} />
        ) : null}
        {tab === "metadata" ? (
          <div className="h-full overflow-auto">
            <MetadataEditor rows={step.metadata} onChange={onMetadata} />
          </div>
        ) : null}
        {tab === "auth" ? (
          <div className="h-full overflow-auto">
            <AuthReadOnly auth={serviceAuth} />
          </div>
        ) : null}
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
        {auth.kind === "oauth2_client_credentials" ? (
          <>
            <div>token_url: {auth.token_url}</div>
            <div>client_id: {auth.client_id}</div>
            <div>header: {auth.header_name}</div>
            {auth.scopes.length > 0 ? <div>scopes: {auth.scopes.join(" ")}</div> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
