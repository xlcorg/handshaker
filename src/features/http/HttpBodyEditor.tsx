import { useState } from "react";
import type {
  HttpBodyIpc,
  MetadataRowIpc,
  ResolutionReportIpc,
} from "@/ipc/bindings";
import { BodyView } from "@/features/bodyview/BodyView";
import { MetadataEditor } from "@/features/workflow/MetadataEditor";
import type { VarCandidate } from "@/features/vars/candidates";
import { cn } from "@/lib/cn";
import type { ResolveKey } from "@/features/workflow/resolveKey";
import { messages } from "@/lib/messages";

type BodyKind = HttpBodyIpc["kind"];
const KINDS: readonly BodyKind[] = ["none", "json", "text", "form"];

export interface HttpBodyEditorProps {
  body: HttpBodyIpc;
  onChange: (body: HttpBodyIpc) => void;
  onSubmit?: () => void;
  varCandidates?: VarCandidate[];
  resolver?: (t: string) => Promise<ResolutionReportIpc>;
  resolveKey?: ResolveKey;
}

export function HttpBodyEditor({
  body,
  onChange,
  onSubmit,
  varCandidates,
  resolver,
  resolveKey,
}: HttpBodyEditorProps) {
  const [sessionBody, setSessionBody] = useState<{ text: string; fields: MetadataRowIpc[] }>(
    () => sessionBodyOf(body, { text: "", fields: [] }),
  );
  const switchTo = (kind: BodyKind) => {
    if (kind === body.kind) return;
    const next = sessionBodyOf(body, sessionBody);
    setSessionBody(next);
    onChange(
      kind === "none"
        ? { kind }
        : kind === "form"
          ? { kind, fields: next.fields }
          : { kind, text: next.text },
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div
        role="radiogroup"
        aria-label={messages.http.body.modeLabel}
        className="flex flex-none items-center gap-0.5 px-3.5 py-1.5"
      >
        {KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={body.kind === kind}
            onClick={() => switchTo(kind)}
            className={cn(
              "h-5 rounded-full px-2 font-mono text-[10.5px] transition-colors",
              body.kind === kind
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
            )}
          >
            {messages.http.body.mode[kind]}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {body.kind === "none" && (
          <p className="px-3.5 py-2 text-xs text-muted-foreground">
            {messages.http.body.none}
          </p>
        )}
        {(body.kind === "json" || body.kind === "text") && (
          <BodyView
            key={body.kind}
            mode="request"
            language={body.kind === "json" ? "json-with-vars" : "plaintext"}
            value={body.text}
            onChange={(text) => onChange({ kind: body.kind, text })}
            onSubmit={onSubmit}
            varCandidates={varCandidates}
          />
        )}
        {body.kind === "form" && (
          <div className="h-full overflow-auto">
            <MetadataEditor
              rows={body.fields}
              onChange={(fields) => onChange({ kind: "form", fields })}
              variables={varCandidates}
              resolver={resolver}
              resolveKey={resolveKey}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function sessionBodyOf(
  body: HttpBodyIpc,
  prev: { text: string; fields: MetadataRowIpc[] },
) {
  switch (body.kind) {
    case "none":
      return prev;
    case "json":
    case "text":
      return { ...prev, text: body.text };
    case "form":
      return { ...prev, fields: body.fields };
  }
}
