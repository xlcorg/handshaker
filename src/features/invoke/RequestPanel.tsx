import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { AlignLeft, Copy, FilePlus, Save, WrapText } from "lucide-react";
import { BodyEditor } from "@/features/invoke/BodyEditor";
import { MetadataView, type MetadataRow } from "@/features/invoke/MetadataView";
import { AuthInline, type AuthState } from "@/features/invoke/AuthInline";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import { ipc } from "@/ipc/client";
import type { GrpcTargetIpc, InvokeOutcomeIpc } from "@/ipc/bindings";
import type { SelectedMethod } from "@/features/shell/SelectedMethod";

export interface RequestPanelHandle {
  send: () => Promise<void>;
}

export interface RequestPanelProps {
  selected: SelectedMethod;
  target: GrpcTargetIpc;
  metadata: MetadataRow[];
  onMetadataChange: (next: MetadataRow[]) => void;
  auth: AuthState;
  onAuthChange: (next: AuthState) => void;
  onDirty: () => void;
  onRequestSave: () => void;
  onNewRequest: () => void;
  onSending: (sending: boolean) => void;
  onOutcome: (o: InvokeOutcomeIpc) => void;
  onError: (msg: string) => void;
}

type RequestTab = "body" | "metadata" | "auth";

export const RequestPanel = forwardRef<RequestPanelHandle, RequestPanelProps>(function RequestPanel(props, ref) {
  const { selected, target, metadata, onMetadataChange, auth, onAuthChange, onDirty, onRequestSave, onNewRequest, onSending, onOutcome, onError } = props;
  const [tab, setTab] = useState<RequestTab>("body");
  const [body, setBody] = useState<string>("{}");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ar = await ipc.varsResolve(target.address);
        if (ar.unresolved_vars.length > 0 || ar.cycle_chain) return; // address not resolvable yet — keep current body
        const skeleton = await ipc.grpcBuildRequestSkeleton(
          { address: ar.resolved, tls: target.tls, skip_verify: false },
          selected.service,
          selected.method,
        );
        if (cancelled) return;
        setBody(skeleton);
      } catch (e) {
        if (cancelled) return;
        const tagged = e as { type?: string; message?: string };
        onError(tagged.message ?? tagged.type ?? "failed to load skeleton");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onError is a fresh closure each parent render; we only want method/address changes to retrigger.
  }, [selected.service, selected.method, target.address, target.tls]);

  useImperativeHandle(ref, () => ({ send }), [body, metadata, auth, selected, target]);

  async function send() {
    // Flip to the sending state up front so the previous response is cleared
    // immediately on click (respState becomes "sending"), rather than lingering
    // through the validation/resolve round-trips below. The outer finally
    // guarantees we always leave the sending state, even on an early return.
    onSending(true);
    try {
      await runSend();
    } finally {
      onSending(false);
    }
  }

  async function runSend() {
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
    if (auth.kind === "bearer" && auth.bearerTokenVar.trim()) {
      try {
        const r = await ipc.varsResolve(`{{${auth.bearerTokenVar.trim()}}}`);
        if (r.unresolved_vars.length > 0) {
          onError(`Bearer token var "${auth.bearerTokenVar}" is not defined in the active environment`);
          return;
        }
        if (r.cycle_chain) {
          onError(`Bearer token var cycle: ${r.cycle_chain.join(" → ")}`);
          return;
        }
        if (!r.resolved.trim()) {
          onError(`Bearer token variable "${auth.bearerTokenVar.trim()}" resolved to an empty value`);
          return;
        }
        meta["authorization"] = `Bearer ${r.resolved}`;
      } catch (e) {
        const tagged = e as { type?: string; message?: string };
        onError(tagged.message ?? tagged.type ?? "bearer token resolve failed");
        return;
      }
    }
    if (auth.kind === "apikey" && auth.apiValueVar.trim()) {
      try {
        const r = await ipc.varsResolve(`{{${auth.apiValueVar.trim()}}}`);
        if (r.unresolved_vars.length > 0) {
          onError(`API key var "${auth.apiValueVar}" is not defined in the active environment`);
          return;
        }
        if (r.cycle_chain) {
          onError(`API key var cycle: ${r.cycle_chain.join(" → ")}`);
          return;
        }
        if (!r.resolved.trim()) {
          onError(`API key variable "${auth.apiValueVar.trim()}" resolved to an empty value`);
          return;
        }
        const headerKey = auth.apiHeader.trim() || "x-api-key";
        meta[headerKey] = r.resolved;
      } catch (e) {
        const tagged = e as { type?: string; message?: string };
        onError(tagged.message ?? tagged.type ?? "api key resolve failed");
        return;
      }
    }

    let resolvedAddr: string;
    try {
      const ar = await ipc.varsResolve(target.address);
      if (ar.unresolved_vars.length > 0) {
        onError(`Address has unresolved vars: ${ar.unresolved_vars.join(", ")}`);
        return;
      }
      if (ar.cycle_chain) {
        onError(`Address cycle: ${ar.cycle_chain.join(" → ")}`);
        return;
      }
      resolvedAddr = ar.resolved;
    } catch (e) {
      const t = e as { type?: string; message?: string };
      onError(t.message ?? t.type ?? "resolve failed");
      return;
    }

    try {
      const outcome = await ipc.grpcInvokeOneshot(
        { address: resolvedAddr, tls: target.tls, skip_verify: false },
        {
          service: selected.service,
          method: selected.method,
          request_json: resolved,
          metadata: meta,
        },
      );
      onOutcome(outcome);
    } catch (e) {
      const tagged = e as { type?: string; message?: string };
      onError(tagged.message ?? tagged.type ?? "invoke failed");
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
          <Tooltip content="Save request">
            <Button type="button" variant="ghost" size="icon-sm" onClick={onRequestSave}>
              <Save className="size-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content="New request">
            <Button type="button" variant="ghost" size="icon-sm" onClick={onNewRequest}>
              <FilePlus className="size-3.5" />
            </Button>
          </Tooltip>
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
          <BodyEditor value={body} onChange={(v) => { onDirty(); setBody(v); }} />
        </div>
      )}
      {tab === "metadata" && <MetadataView rows={metadata} onChange={(next) => { onDirty(); onMetadataChange(next); }} />}
      {tab === "auth" && <AuthInline value={auth} onChange={(next) => { onDirty(); onAuthChange(next); }} />}
    </div>
  );
});
