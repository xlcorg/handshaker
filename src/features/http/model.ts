import type {
  HttpMethodIpc,
  HttpResponseIpc,
  HttpTemplateIpc,
  ResponseBodyIpc,
  SavedAuthConfigIpc,
} from "@/ipc/bindings";
import type { ClientFault } from "@/features/workflow/netDiagnostics";
import { formatByteCount } from "@/lib/grpc-status";
import { newId } from "@/lib/ids";
import { messages } from "@/lib/messages";

/** There is no response while sending, and no request id once settled. */
export type HttpRun =
  | { status: "draft" }
  | { status: "sending"; requestId: string }
  | { status: "done"; response: HttpResponseIpc; authUsed: SavedAuthConfigIpc }
  | { status: "error"; error: ClientFault };

/** An HTTP draft. Save, autosave, Send and the call record read `template` as is. */
export interface HttpStep {
  protocol: "http";
  id: string;
  /** The `{{var}}` resolve context. null = unbound draft. */
  collectionId: string | null;
  template: HttpTemplateIpc;
  run: HttpRun;
}

export const EMPTY_HTTP_TEMPLATE: HttpTemplateIpc = {
  method: "GET",
  url_template: "",
  query: [],
  headers: [],
  body: { kind: "none" },
  auth: { kind: "none" },
};

export function newHttpStep(
  init: { template?: HttpTemplateIpc; collectionId?: string | null } = {},
): HttpStep {
  return {
    protocol: "http",
    id: newId(),
    collectionId: init.collectionId ?? null,
    template: init.template ?? EMPTY_HTTP_TEMPLATE,
    run: { status: "draft" },
  };
}

export const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const satisfies readonly HttpMethodIpc[];

type _HttpMethodOrderExhaustive =
  Exclude<HttpMethodIpc, (typeof HTTP_METHODS)[number]> extends never
    ? true
    : never;
const _httpMethodOrderExhaustive: _HttpMethodOrderExhaustive = true;
void _httpMethodOrderExhaustive;

export const HTTP_METHOD_MARK = {
  GET: "GET",
  POST: "POST",
  PUT: "PUT",
  PATCH: "PAT",
  DELETE: "DEL",
  HEAD: "HEAD",
  OPTIONS: "OPT",
} as const satisfies Record<HttpMethodIpc, string>;

export const GRPC_METHOD_MARK = "gRPC";

export const HTTP_METHOD_COLUMN_CH = Math.max(
  ...Object.values(HTTP_METHOD_MARK).map((label) => label.length),
  GRPC_METHOD_MARK.length,
);

export const HTTP_METHOD_META: Record<HttpMethodIpc, { tone: string }> = {
  GET: { tone: "text-ok" },
  POST: { tone: "text-warn" },
  PUT: { tone: "text-info" },
  PATCH: { tone: "text-kind-bidi" },
  DELETE: { tone: "text-[hsl(0_72%_68%)]" },
  HEAD: { tone: "text-muted-foreground" },
  OPTIONS: { tone: "text-muted-foreground" },
};

export function canSendHttp(draft: HttpStep): boolean {
  return (
    draft.template.url_template.trim() !== "" && draft.run.status !== "sending"
  );
}

/** What stands in for a body with no text to show. null when the body is JSON or text. */
export function bodyNoteOf(body: ResponseBodyIpc): string | null {
  const m = messages.http.response.body;
  switch (body.type) {
    case "json":
    case "text":
      return null;
    case "empty":
      return m.empty;
    case "binary":
      return m.binary;
    case "too_large":
      return m.tooLarge(formatByteCount(body.limit_bytes));
    case "omitted":
      return m.omitted;
  }
}

export function httpNameFromPathTail(t: HttpTemplateIpc): string {
  const path = t.url_template.split(/[?#]/)[0].replace(/^[a-z]+:\/\//i, "");
  const rest = path
    .split("/")
    .slice(1)
    .filter((s) => s !== "")
    .join("/");
  return rest ? `${t.method} ${rest}` : t.method;
}
