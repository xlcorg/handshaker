import { useState, type CSSProperties } from "react";
import { Globe } from "lucide-react";
import type { HttpResponseIpc } from "@/ipc/bindings";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import { BodyView } from "@/features/bodyview/BodyView";
import { ClientErrorView } from "@/features/response/ClientErrorView";
import { EmptyState } from "@/features/response/EmptyState";
import { KVTable } from "@/features/response/KVTable";
import { useTabBarStart } from "@/features/response/useTabBarStart";
import { formatElapsed } from "@/features/stream/format";
import { cn } from "@/lib/cn";
import { formatByteCount } from "@/lib/grpc-status";
import { httpVerdict } from "@/lib/http-status";
import { messages } from "@/lib/messages";
import { useBusyDelay } from "@/lib/use-busy-delay";
import { bodyNoteOf, type HttpRun } from "./model";

type Tab = "body" | "headers";

export function HttpResponsePanel({ run }: { run: HttpRun }) {
  const [tab, setTab] = useState<Tab>("body");
  const sending = run.status === "sending";
  const showProgress = useBusyDelay(sending, 250);
  const { headerRef, barStart } = useTabBarStart(showProgress, tab);
  const response = run.status === "done" ? run.response : null;
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <div
        ref={headerRef}
        className="relative flex h-10 flex-none items-center gap-2.5 border-b border-border px-3.5"
      >
        <UnderlineTabs<Tab>
          value={tab}
          onChange={setTab}
          busy={showProgress}
          items={[
            { value: "body", label: messages.http.response.tabs.body },
            {
              value: "headers",
              label: messages.http.response.tabs.headers,
              hint: response?.headers.length || undefined,
            },
          ]}
        />
        <div className="ml-auto flex items-center gap-2.5">
          {response && <ResponseMeta response={response} />}
        </div>
        {showProgress && (
          <div
            aria-hidden
            data-testid="tab-progress"
            className="hs-tab-progress pointer-events-none absolute inset-x-0 -bottom-px h-[1.5px]"
            style={{ "--bar-start": `${barStart}px` } as CSSProperties}
          />
        )}
      </div>
      <RunBody run={run} tab={tab} />
    </div>
  );
}

function RunBody({ run, tab }: { run: HttpRun; tab: Tab }) {
  switch (run.status) {
    case "draft":
      return (
        <EmptyState
          icon={<Globe className="size-[18px]" />}
          title={messages.http.response.idleTitle}
          desc={messages.http.response.idleDesc}
        />
      );
    case "sending":
      return null;
    case "error":
      return (
        <div className="hs-fade-in flex min-h-0 flex-1 flex-col">
          <ClientErrorView fault={run.error} />
        </div>
      );
    case "done":
      return tab === "headers" ? (
        <KVTable
          rows={run.response.headers.map((h) => ({ k: h.name, v: h.value }))}
        />
      ) : (
        <div className="hs-fade-in flex min-h-0 flex-1 flex-col">
          <ResponseBody response={run.response} />
        </div>
      );
  }
}

function ResponseBody({ response }: { response: HttpResponseIpc }) {
  const body = response.body;
  if (body.type === "json" || body.type === "text") {
    return (
      <BodyView
        key={body.type}
        mode="response"
        language={body.type === "json" ? "json-with-vars" : "plaintext"}
        value={body.text}
      />
    );
  }
  return (
    <p className="px-3.5 py-2 text-xs italic text-muted-foreground">
      {bodyNoteOf(body)}
    </p>
  );
}

function ResponseMeta({ response }: { response: HttpResponseIpc }) {
  const ok = httpVerdict(response.status) === "ok";
  return (
    <span
      data-testid="http-response-meta"
      className="flex items-center gap-2 font-mono text-[11px]"
    >
      <span className="flex items-center gap-1.5">
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            ok ? "bg-ok" : "bg-destructive",
          )}
          aria-hidden
        />
        <span className="tabular-nums text-foreground">{response.status}</span>
        <span className="font-medium text-foreground">{response.reason}</span>
      </span>
      <span className="tabular-nums text-muted-foreground">
        {formatElapsed(response.elapsed_ms)}
      </span>
      <span className="tabular-nums text-muted-foreground">
        {formatByteCount(response.size_bytes)}
      </span>
    </span>
  );
}
