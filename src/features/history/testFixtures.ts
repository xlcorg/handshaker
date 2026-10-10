import type { CallRecordIpc, CallSummaryIpc, CollectionIpc, ItemIpc } from "@/ipc/bindings";

export function callRecord(over: Partial<CallRecordIpc> = {}): CallRecordIpc {
  return {
    id: "call-1",
    started_at_ms: 1_700_000_000_000,
    origin: { collection_id: "c1", request_id: "r1" },
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
    },
    elapsed_ms: 12,
    outcome: {
      type: "unary",
      status: { code: 0, message: "", trailers: { "grpc-status": "0" } },
      response: { type: "inline", json: '{"text":"hi"}' },
    },
    ...over,
  };
}

export function summary(over: Partial<CallSummaryIpc> = {}): CallSummaryIpc {
  return {
    id: "call-1",
    started_at_ms: 1_700_000_000_000,
    kind: "unary",
    service: "echo.v1.Echo",
    method: "Say",
    address_template: "{{host}}:50051",
    elapsed_ms: 12,
    ending: { type: "status", code: 0 },
    ...over,
  };
}

export function savedRequest(id: string, name = id): Extract<ItemIpc, { type: "request" }> {
  return {
    type: "request",
    id,
    name,
    address_template: "saved:443",
    service: "echo.v1.Echo",
    method: "Say",
    body_template: "{}",
    metadata: [],
    auth: { kind: "none" },
    tls_override: true,
    last_used_at: null,
    use_count: 0,
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
