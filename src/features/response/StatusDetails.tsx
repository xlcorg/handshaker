import type { StatusDetailIpc } from "@/ipc/bindings";

/** Human label per detail type, shown as the card header. */
const TITLE: Record<StatusDetailIpc["type"], string> = {
  ErrorInfo: "Error info",
  BadRequest: "Bad request",
  RetryInfo: "Retry info",
  QuotaFailure: "Quota failure",
  PreconditionFailure: "Precondition failure",
  DebugInfo: "Debug info",
  RequestInfo: "Request info",
  ResourceInfo: "Resource info",
  Help: "Help",
  LocalizedMessage: "Localized message",
};

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="min-w-[7rem] flex-none font-medium text-foreground/60">{k}</span>
      <span className="break-all font-mono text-foreground/85">{v}</span>
    </div>
  );
}

function Body({ d }: { d: StatusDetailIpc }) {
  switch (d.type) {
    case "ErrorInfo":
      return (
        <div className="space-y-1">
          <Row k="reason" v={d.reason} />
          <Row k="domain" v={d.domain} />
          {Object.entries(d.metadata).map(([k, v]) => (
            <Row key={k} k={k} v={v ?? ""} />
          ))}
        </div>
      );
    case "BadRequest":
      return (
        <div className="space-y-1.5">
          {d.violations.map((v, i) => (
            <div key={i}>
              <p className="font-mono text-xs text-foreground/85">{v.field}</p>
              <p className="text-xs text-muted-foreground">{v.description}</p>
            </div>
          ))}
        </div>
      );
    case "RetryInfo":
      return (
        <p className="text-xs text-muted-foreground">
          Server suggests trying again
          {d.retry_delay_ms != null ? ` — after ${(d.retry_delay_ms / 1000).toFixed(1)}s` : ""}
        </p>
      );
    case "QuotaFailure":
      return (
        <div className="space-y-1.5">
          {d.violations.map((v, i) => (
            <div key={i}>
              <p className="font-mono text-xs text-foreground/85">{v.subject}</p>
              <p className="text-xs text-muted-foreground">{v.description}</p>
            </div>
          ))}
        </div>
      );
    case "PreconditionFailure":
      return (
        <div className="space-y-1.5">
          {d.violations.map((v, i) => (
            <div key={i}>
              <p className="font-mono text-xs text-foreground/85">
                {v.kind} · {v.subject}
              </p>
              <p className="text-xs text-muted-foreground">{v.description}</p>
            </div>
          ))}
        </div>
      );
    case "DebugInfo":
      return (
        <div className="space-y-1">
          {d.detail ? <Row k="detail" v={d.detail} /> : null}
          {d.stack_entries.map((s, i) => (
            <p key={i} className="break-all font-mono text-[11px] text-muted-foreground">
              {s}
            </p>
          ))}
        </div>
      );
    case "RequestInfo":
      return (
        <div className="space-y-1">
          <Row k="request id" v={d.request_id} />
          {d.serving_data ? <Row k="serving data" v={d.serving_data} /> : null}
        </div>
      );
    case "ResourceInfo":
      return (
        <div className="space-y-1">
          <Row k="type" v={d.resource_type} />
          <Row k="name" v={d.resource_name} />
          {d.owner ? <Row k="owner" v={d.owner} /> : null}
          {d.description ? <Row k="description" v={d.description} /> : null}
        </div>
      );
    case "Help":
      return (
        <ul className="space-y-1">
          {d.links.map((l, i) => (
            <li key={i} className="text-xs">
              <span className="text-foreground/85">{l.description}</span>{" "}
              <span className="break-all font-mono text-muted-foreground">{l.url}</span>
            </li>
          ))}
        </ul>
      );
    case "LocalizedMessage":
      return (
        <p className="text-xs text-foreground/85">
          <span className="mr-1.5 rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
            {d.locale}
          </span>
          {d.message}
        </p>
      );
  }
}

/** Typed render of the google.rpc structured error details attached to a non-OK status. */
export function StatusDetails({ details }: { details: StatusDetailIpc[] }) {
  return (
    <div className="space-y-2">
      {details.map((d, i) => (
        <div key={i} className="rounded-md border border-border bg-card/40 p-2.5">
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {TITLE[d.type]}
          </p>
          <Body d={d} />
        </div>
      ))}
    </div>
  );
}
