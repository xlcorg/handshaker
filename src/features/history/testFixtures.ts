import type {
  CallOutcomeIpc,
  CallRecordIpc,
  CallSummaryIpc,
  CollectionIpc,
  GrpcTemplateIpc,
  HttpOutcomeIpc,
  HttpTemplateIpc,
  ItemIpc,
  RecordedCallIpc,
  SummaryLineIpc,
} from "@/ipc/bindings";

type RecordOf<P extends RecordedCallIpc["protocol"]> = CallRecordIpc & { call: Extract<RecordedCallIpc, { protocol: P }> };

export type CallRecordOver = Partial<Omit<CallRecordIpc, "call">> & {
  request?: Partial<GrpcTemplateIpc>;
  outcome?: CallOutcomeIpc;
};

export function callRecord({ request, outcome, ...over }: CallRecordOver = {}): RecordOf<"grpc"> {
  return {
    id: "call-1",
    started_at_ms: 1_700_000_000_000,
    origin: { collection_id: "c1", request_id: "r1" },
    elapsed_ms: 12,
    ...over,
    call: {
      protocol: "grpc",
      request: {
        address_template: "{{host}}:50051",
        tls_override: null,
        service: "echo.v1.Echo",
        method: "Say",
        body_template: '{"text":"hi"}',
        metadata: [
          { key: "x-trace", value: "1", enabled: true },
          { key: "x-off", value: "2", enabled: false },
        ],
        auth: { kind: "none" },
        ...request,
      },
      outcome: outcome ?? {
        type: "unary",
        status: { code: 0, message: "", trailers: { "grpc-status": "0" } },
        response: { type: "inline", json: '{"text":"hi"}' },
      },
    },
  };
}

export const httpRequest: HttpTemplateIpc = {
  method: "POST",
  url_template: "{{base}}/users",
  query: [{ key: "page", value: "2", enabled: true }],
  headers: [{ key: "accept", value: "application/json", enabled: true }],
  body: { kind: "json", text: '{"name":"a"}' },
  auth: { kind: "none" },
};

export type HttpCallRecordOver = Partial<Omit<CallRecordIpc, "call">> & {
  request?: Partial<HttpTemplateIpc>;
  outcome?: HttpOutcomeIpc;
};

export function httpCallRecord({ request, outcome, ...over }: HttpCallRecordOver = {}): RecordOf<"http"> {
  return {
    id: "call-h",
    started_at_ms: 1_700_000_000_000,
    origin: { collection_id: "c1", request_id: "h1" },
    elapsed_ms: 12,
    ...over,
    call: {
      protocol: "http",
      request: { ...httpRequest, ...request },
      outcome: outcome ?? {
        type: "response",
        response: {
          status: 201,
          reason: "Created",
          headers: [{ name: "content-type", value: "application/json" }],
          body: { type: "json", text: '{"id":7}' },
          size_bytes: 8,
          elapsed_ms: 12,
        },
      },
    },
  };
}

type GrpcLine = Extract<SummaryLineIpc, { protocol: "grpc" }>;
type HttpLine = Extract<SummaryLineIpc, { protocol: "http" }>;

export function httpSummary({
  method = "GET",
  url_template = "{{base}}/users",
  ending = { type: "status", code: 200 },
  ...over
}: Partial<Omit<CallSummaryIpc, "line">> & Partial<Omit<HttpLine, "protocol">> = {}): CallSummaryIpc {
  return {
    id: "call-h",
    started_at_ms: 1_700_000_000_000,
    elapsed_ms: 12,
    ...over,
    line: { protocol: "http", method, url_template, ending },
  };
}

export function summary({
  kind = "unary",
  service = "echo.v1.Echo",
  method = "Say",
  address_template = "{{host}}:50051",
  ending = { type: "status", code: 0 },
  ...over
}: Partial<Omit<CallSummaryIpc, "line">> & Partial<Omit<GrpcLine, "protocol">> = {}): CallSummaryIpc {
  return {
    id: "call-1",
    started_at_ms: 1_700_000_000_000,
    elapsed_ms: 12,
    ...over,
    line: { protocol: "grpc", kind, service, method, address_template, ending },
  };
}

export function savedRequest(id: string, name = id): Extract<ItemIpc, { type: "request" }> {
  return {
    type: "request",
    id,
    name,
    last_used_at: null,
    use_count: 0,
    template: {
      protocol: "grpc",
      address_template: "saved:443",
      tls_override: true,
      service: "echo.v1.Echo",
      method: "Say",
      body_template: "{}",
      metadata: [],
      auth: { kind: "none" },
    },
  };
}

export function savedHttpRequest(id: string, name = id): Extract<ItemIpc, { type: "request" }> {
  return {
    type: "request",
    id,
    name,
    last_used_at: null,
    use_count: 0,
    template: { protocol: "http", ...httpRequest, url_template: "{{base}}/saved" },
  };
}

export function collection(id: string, items: ItemIpc[]): CollectionIpc {
  return {
    id,
    name: id,
    items,
    variables: {},
    auth: { kind: "none" },
    default_tls: false,
    skip_tls_verify: false,
    pinned: false,
    description: null,
    created_at: 0,
    expanded: false,
  };
}
