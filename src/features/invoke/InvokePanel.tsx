import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { BodyEditor } from "./BodyEditor";
import { ResolvesPreview } from "./ResolvesPreview";
import { ipc } from "@/ipc/client";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

export interface SelectedMethod {
  service: string;
  method: string;
}

export interface InvokePanelProps {
  selected: SelectedMethod;
  onOutcome: (outcome: InvokeOutcomeIpc) => void;
  onError: (message: string) => void;
}

export function InvokePanel({ selected, onOutcome, onError }: InvokePanelProps) {
  const [body, setBody] = useState<string>("{}");
  const [busy, setBusy] = useState(false);

  // When the method changes, load a skeleton. If the body is not empty and not
  // the default `{}`, ask for confirmation.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const skeleton = await ipc.grpcBuildRequestSkeleton(
          selected.service,
          selected.method,
        );
        if (cancelled) return;
        const isEmpty = body.trim() === "" || body.trim() === "{}";
        if (
          isEmpty ||
          window.confirm("Replace current request body with the method's skeleton?")
        ) {
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

  async function handleSend() {
    // Local JSON validation — produces a better error than a backend round-trip.
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

    setBusy(true);
    try {
      const outcome = await ipc.grpcInvokeUnary({
        service: selected.service,
        method: selected.method,
        request_json: resolved,
        metadata: {},
      });
      onOutcome(outcome);
    } catch (e) {
      const tagged = e as { type?: string; message?: string };
      onError(tagged.message ?? tagged.type ?? "invoke failed");
    } finally {
      setBusy(false);
    }
  }

  // ⌘↵ / Ctrl+Enter Send — master spec §9 mandate.
  // Listener uses CAPTURE phase (third arg `true`) so we intercept the event
  // top-down before it reaches Monaco's editor-level handler. preventDefault
  // + stopPropagation ensure Monaco never inserts a newline.
  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !busy) {
        e.preventDefault();
        e.stopPropagation();
        handleSend();
      }
    }
    window.addEventListener("keydown", onKeydown, true);
    return () => window.removeEventListener("keydown", onKeydown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleSend captures body via closure; we want fresh body on each keystroke
  }, [busy, body, selected.service, selected.method]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <div className="font-mono text-sm">
          <span className="text-muted-foreground">{selected.service}</span>
          <span className="mx-1">/</span>
          <span className="font-semibold">{selected.method}</span>
        </div>
        <Button
          onClick={handleSend}
          disabled={busy}
          size="sm"
          aria-keyshortcuts="Control+Enter Meta+Enter"
        >
          {busy ? "Sending…" : "Send"}
        </Button>
      </div>
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 min-h-0">
          <BodyEditor value={body} onChange={setBody} />
        </div>
        <ResolvesPreview body={body} />
      </div>
    </div>
  );
}
