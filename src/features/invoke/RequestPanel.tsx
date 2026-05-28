import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { AlignLeft, Copy, WrapText } from "lucide-react";
import { BodyEditor } from "@/features/invoke/BodyEditor";
import { MetadataView, type MetadataRow } from "@/features/invoke/MetadataView";
import { AuthInline, type AuthState } from "@/features/invoke/AuthInline";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import { ipc } from "@/ipc/client";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";
import type { SelectedMethod } from "@/features/shell/SelectedMethod";

export interface RequestPanelHandle {
  send: () => Promise<void>;
}

export interface RequestPanelProps {
  selected: SelectedMethod;
  metadata: MetadataRow[];
  onMetadataChange: (next: MetadataRow[]) => void;
  auth: AuthState;
  onAuthChange: (next: AuthState) => void;
  onSending: (sending: boolean) => void;
  onOutcome: (o: InvokeOutcomeIpc) => void;
  onError: (msg: string) => void;
}

type RequestTab = "body" | "metadata" | "auth";

export const RequestPanel = forwardRef<RequestPanelHandle, RequestPanelProps>(function RequestPanel(props, ref) {
  const { selected, metadata, onMetadataChange, auth, onAuthChange, onSending, onOutcome, onError } = props;
  const [tab, setTab] = useState<RequestTab>("body");
  const [body, setBody] = useState<string>("{}");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const skeleton = await ipc.grpcBuildRequestSkeleton(selected.service, selected.method);
        if (cancelled) return;
        const isEmpty = body.trim() === "" || body.trim() === "{}";
        if (isEmpty || window.confirm("Replace current request body with the method's skeleton?")) {
          setBody(skeleton);
        }
      } catch (e) {
        const tagged = e as { type?: string; message?: string };
        onError(tagged.message ?? tagged.type ?? "failed to load skeleton");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- body intentionally not a dep
  }, [selected.service, selected.method]);

  useImperativeHandle(ref, () => ({ send }), [body, metadata, auth, selected]);

  async function send() {
    try {
      JSON.parse(body);
    } catch (e) {
      onError(`Invalid JSON: ${(e as Error).message}`);
      return;
    }
    let resolved: string;
    try {
      const report = await ipc.varsResolve(body);
      if (report.unresolved_vars.length > 0) {
        onError(`Unresolved variables: ${report.unresolved_vars.join(", ")}`);
        return;
      }
      if (report.cycle_chain) {
        onError(`Variable cycle: ${report.cycle_chain.join(" → ")}`);
        return;
      }
      resolved = report.resolved;
    } catch (e) {
      const tagged = e as { type?: string; message?: string };
      onError(tagged.message ?? tagged.type ?? "resolve failed");
      return;
    }

    const meta: Record<string, string> = {};
    for (const r of metadata) if (r.k.trim()) meta[r.k.trim()] = r.v;
    if (auth.kind === "bearer" && auth.bearerToken.trim()) {
      try {
        const r = await ipc.varsResolve(auth.bearerToken);
        if (r.unresolved_vars.length > 0) {
          onError(`Bearer token has unresolved vars: ${r.unresolved_vars.join(", ")}`);
          return;
        }
        meta["authorization"] = `Bearer ${r.resolved}`;
      } catch {
        meta["authorization"] = `Bearer ${auth.bearerToken}`;
      }
    }

    onSending(true);
    try {
      const outcome = await ipc.grpcInvokeUnary({
        service: selected.service,
        method: selected.method,
        request_json: resolved,
        metadata: meta,
      });
      onOutcome(outcome);
    } catch (e) {
      const tagged = e as { type?: string; message?: string };
      onError(tagged.message ?? tagged.type ?? "invoke failed");
    } finally {
      onSending(false);
    }
  }

  const metadataCount = metadata.filter((r) => r.k.trim()).length;

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-background relative">
      <div className="h-10 flex-none flex items-center gap-2.5 px-3.5 border-b border-border relative z-10 bg-background/85 backdrop-blur-sm">
        <UnderlineTabs
          value={tab}
          onChange={(v) => setTab(v as RequestTab)}
          items={[
            { value: "body", label: "Body" },
            { value: "metadata", label: "Metadata", hint: metadataCount || undefined },
            { value: "auth", label: "Auth", hint: auth.kind === "none" ? "none" : auth.kind },
          ]}
        />
        <div className="ml-auto flex items-center gap-0.5">
          <Tooltip content="Beautify">
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => {
              try {
                setBody(JSON.stringify(JSON.parse(body), null, 2));
              } catch {
                /* leave as-is if not parseable */
              }
            }}>
              <AlignLeft className="size-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content="Word wrap (no-op)">
            <Button type="button" variant="ghost" size="icon-sm">
              <WrapText className="size-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content="Copy">
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => navigator.clipboard.writeText(body).catch(() => undefined)}>
              <Copy className="size-3.5" />
            </Button>
          </Tooltip>
        </div>
      </div>
      {tab === "body" && (
        <div className="flex-1 min-h-0">
          <BodyEditor value={body} onChange={setBody} />
        </div>
      )}
      {tab === "metadata" && <MetadataView rows={metadata} onChange={onMetadataChange} />}
      {tab === "auth" && <AuthInline value={auth} onChange={onAuthChange} />}
    </div>
  );
});
