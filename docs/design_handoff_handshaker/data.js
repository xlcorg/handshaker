// data.js — Handshaker fixtures (multi-server + collections tree)
//
// Model:
//   servers[]      — master registry; each server has its own host + a full,
//                    reflection-discovered service/method catalog (used by the
//                    method picker and the Server browser).
//   collections[]  — the sidebar tree. A collection groups servers; each server
//                    entry pins methods/saved-requests, optionally inside folders.
//                    Items reference a server method by { svc, mth } — kind/verb/
//                    req/res are resolved from the registry via HS_DATA.findMethod.

window.HS_DATA = {
  /* ───────────────── server registry ───────────────── */
  servers: [
    {
      id: "orders", name: "Orders API", host: "orders.api.example.com:443",
      tls: true, dot: "#6cd697", status: "ok", proto: "grpc",
      reflection: { services: 7, methods: 125 },
      services: [
        { name: "checkout.v1.OrderService", short: "OrderService", methods: [
          { name: "Create",         kind: "unary",  req: "CreateOrderCommand",  res: "Order" },
          { name: "GetByOrderId",   kind: "unary",  req: "GetByOrderIdQuery",   res: "Order" },
          { name: "GetByMerchant",  kind: "unary",  req: "GetByMerchantQuery",  res: "OrderList" },
          { name: "ListByCustomer", kind: "unary",  req: "ListByCustomerQuery", res: "OrderList" },
          { name: "Cancel",         kind: "unary",  req: "CancelOrderCommand",  res: "Order" },
          { name: "Refund",         kind: "unary",  req: "RefundCommand",       res: "Refund" },
          { name: "UpdateAddress",  kind: "unary",  req: "UpdateAddressCommand",res: "Order" },
          { name: "DeleteDraft",    kind: "unary",  req: "DeleteDraftCommand",  res: "Empty" },
          { name: "StreamUpdates",  kind: "server", req: "StreamUpdatesQuery",  res: "OrderUpdate" },
          { name: "BulkImport",     kind: "client", req: "OrderRow",            res: "ImportSummary" },
          { name: "SyncSession",    kind: "bidi",   req: "SyncFrame",           res: "SyncFrame" },
        ] },
        { name: "checkout.v1.FulfillmentService", short: "FulfillmentService", methods: [
          { name: "Ship",    kind: "unary",  req: "ShipCommand",   res: "Shipment" },
          { name: "Track",   kind: "unary",  req: "TrackQuery",    res: "Tracking" },
          { name: "Returns", kind: "server", req: "ReturnsQuery",  res: "ReturnEvent" },
        ] },
      ],
    },
    {
      id: "inventory", name: "contracts-seller-info", host: "inventory.api.example.com:443",
      tls: true, dot: "#e5c07a", status: "ok", proto: "grpc",
      reflection: { services: 3, methods: 28 },
      services: [
        { name: "stock.v1.StockService", short: "StockService", methods: [
          { name: "GetSellers",  kind: "unary",  req: "GetSellersQuery", res: "SellerList" },
          { name: "Release",     kind: "unary",  req: "ReleaseCommand",  res: "Empty" },
          { name: "GetLevels",   kind: "unary",  req: "GetLevelsQuery",  res: "Levels" },
          { name: "WatchLevels", kind: "server", req: "WatchLevelsQuery",res: "LevelEvent" },
        ] },
      ],
    },
    {
      id: "users", name: "Users API", host: "users.api.example.com:443",
      tls: true, dot: "#7c9cf0", status: "ok", proto: "grpc",
      reflection: { services: 4, methods: 36 },
      services: [
        { name: "identity.v1.UsersService", short: "UsersService", methods: [
          { name: "GetByOrderId", kind: "unary",  req: "GetByOrderIdQuery", res: "User" },
          { name: "Get",          kind: "unary",  req: "GetUserQuery",      res: "User" },
          { name: "Register",     kind: "unary",  req: "RegisterCommand",   res: "User" },
          { name: "Authenticate", kind: "unary",  req: "AuthenticateQuery", res: "Session" },
          { name: "UpdateProfile",kind: "unary",  req: "UpdateProfileCmd",  res: "User" },
          { name: "ChatSession",  kind: "bidi",   req: "ChatMessage",       res: "ChatMessage" },
        ] },
      ],
    },
    {
      id: "gateway", name: "Public Gateway", host: "api.company.com",
      tls: true, dot: "#c08bd6", status: "ok", proto: "http",
      reflection: null,
      services: [
        { name: "", short: "", methods: [
          { name: "/v1/orders/{id}",          verb: "GET",    req: "—",            res: "Order" },
          { name: "/v1/orders",               verb: "GET",    req: "—",            res: "OrderList" },
          { name: "/v1/charges",              verb: "POST",   req: "ChargeBody",   res: "Charge" },
          { name: "/v1/charges/{id}/refund",  verb: "POST",   req: "RefundBody",   res: "Refund" },
          { name: "/v1/customers/{id}",       verb: "PATCH",  req: "CustomerBody", res: "Customer" },
          { name: "/v1/sessions/{id}",        verb: "DELETE", req: "—",            res: "Empty" },
        ] },
      ],
    },
    {
      id: "billing", name: "Billing API", host: "billing.api.example.com:443",
      tls: true, dot: "#d98a8a", status: "slow", proto: "grpc",
      reflection: { services: 2, methods: 19 },
      services: [
        { name: "billing.v1.BillingService", short: "BillingService", methods: [
          { name: "ListInvoices",    kind: "unary", req: "ListInvoicesQuery", res: "InvoiceList" },
          { name: "GetOrderInvoice", kind: "unary", req: "GetInvoiceQuery",   res: "Invoice" },
          { name: "Charge",          kind: "unary", req: "ChargeCommand",     res: "Charge" },
        ] },
      ],
    },
    {
      id: "search", name: "Search API", host: "search.api.example.com:443",
      tls: true, dot: "#6cd697", status: "ok", proto: "grpc",
      reflection: { services: 1, methods: 6 },
      services: [
        { name: "search.v1.SearchService", short: "SearchService", methods: [
          { name: "Query",   kind: "unary",  req: "SearchQuery",  res: "Results" },
          { name: "Suggest", kind: "server", req: "SuggestQuery", res: "Suggestion" },
        ] },
      ],
    },
  ],

  /* ───────────────── the (single) collection ─────────────────
     One collection per workspace. It groups every server; each server pins
     methods/saved-requests, optionally inside method folders. The whole
     collection is what you Export / Import (a single .json file). */
  collection: {
    id: "workspace",
    name: "Acme Platform",
    servers: [
      { id: "orders", folders: [
        { id: "smoke", name: "Smoke tests", items: [
          { type: "saved",  name: "Create test order", svc: "OrderService", mth: "Create" },
          { type: "method", svc: "OrderService", mth: "Create" },
        ] },
        { id: "reads", name: "Read paths", items: [
          { type: "method", svc: "OrderService", mth: "GetByMerchant" },
          { type: "method", svc: "OrderService", mth: "GetByOrderId" },
        ] },
      ], loose: [] },
      { id: "inventory", folders: [], loose: [
        { type: "method", svc: "StockService", mth: "GetSellers" },
        { type: "method", svc: "StockService", mth: "WatchLevels" },
      ] },
      { id: "users", folders: [], loose: [
        { type: "method", svc: "UsersService", mth: "GetByOrderId" },
        { type: "saved",  name: "Auth as QA user", svc: "UsersService", mth: "Authenticate" },
      ] },
      { id: "gateway", folders: [], loose: [
        { type: "method", svc: "", mth: "/v1/orders/{id}" },
        { type: "method", svc: "", mth: "/v1/charges" },
        { type: "saved",  name: "Refund a charge", svc: "", mth: "/v1/charges/{id}/refund" },
      ] },
      { id: "billing", folders: [], loose: [
        { type: "method", svc: "BillingService", mth: "ListInvoices" },
      ] },
      { id: "search", folders: [], loose: [] },
    ],
  },

  environments: [
    { name: "prod",    color: "#6cd697", host: "api.example.com", vars: 5 },
    { name: "staging", color: "#e5c07a", host: "api.staging.example.com", vars: 5 },
    { name: "local",   color: "#7ec8e3", host: "localhost:5002", vars: 3 },
  ],

  /* request bodies keyed by `${svc}/${mth}` (svc "" for HTTP gateway paths) */
  bodies: {
    "OrderService/Create": [
      { ln: "{" },
      { ln: '  "merchantId": "{{merchantId}}",' },
      { ln: '  "customerId": "usr_4421",' },
      { ln: '  "currency": "EUR",' },
      { ln: '  "items": [{ "sku": "SKU-118", "qty": 2 }],' },
      { ln: '  "draft": false' },
      { ln: "}" },
    ],
    "OrderService/GetByOrderId": [
      { ln: "{" },
      { ln: '  "orderId": "{{orderId}}"' },
      { ln: "}" },
    ],
    "OrderService/GetByMerchant": [
      { ln: "{" },
      { ln: '  "merchantId": "{{merchantId}}",' },
      { ln: '  "limit": 50,' },
      { ln: '  "cursor": null' },
      { ln: "}" },
    ],
    "StockService/GetSellers": [
      { ln: "{" },
      { ln: '  "sku": "SKU-118",' },
      { ln: '  "qty": 2,' },
      { ln: '  "orderId": "{{orderId}}"' },
      { ln: "}" },
    ],
    "StockService/WatchLevels": [
      { ln: "{" },
      { ln: '  "warehouse": "eu-central",' },
      { ln: '  "belowThreshold": 10' },
      { ln: "}" },
    ],
    "UsersService/GetByOrderId": [
      { ln: "{" },
      { ln: '  "orderId": "{{orderId}}"' },
      { ln: "}" },
    ],
    "UsersService/Authenticate": [
      { ln: "{" },
      { ln: '  "email": "qa@example.com",' },
      { ln: '  "password": "{{password}}"' },
      { ln: "}" },
    ],
    "BillingService/ListInvoices": [
      { ln: "{" },
      { ln: '  "customerId": "usr_4421",' },
      { ln: '  "status": "OPEN",' },
      { ln: '  "limit": 25' },
      { ln: "}" },
    ],
    "/v1/charges": [
      { ln: "{" },
      { ln: '  "amount": 4280,' },
      { ln: '  "currency": "EUR",' },
      { ln: '  "source": "{{paymentToken}}"' },
      { ln: "}" },
    ],
    "/v1/charges/{id}/refund": [
      { ln: "{" },
      { ln: '  "amount": 4280,' },
      { ln: '  "reason": "requested_by_customer"' },
      { ln: "}" },
    ],
    "/v1/orders/{id}": [
      { ln: "// GET — no request body" },
    ],
  },

  responses: {
    success: [
      { ln: "{" },
      { ln: '  "orderId": "ord_8f2a91c4",' },
      { ln: '  "userId": "usr_4421",' },
      { ln: '  "merchantId": "mrc_07",' },
      { ln: '  "status": "FULFILLED",' },
      { ln: '  "total": 4280,' },
      { ln: '  "currency": "EUR",' },
      { ln: '  "createdAt": "2026-05-29T08:12:04Z"' },
      { ln: "}" },
    ],
    error: [
      { ln: "{" },
      { ln: '  "code": "UNAUTHENTICATED",' },
      { ln: '  "message": "missing bearer token in metadata",' },
      { ln: '  "details": []' },
      { ln: "}" },
    ],
  },

  trailers: [
    { k: "content-type", v: "application/grpc" },
    { k: "grpc-status", v: "0" },
    { k: "grpc-accept-encoding", v: "identity, deflate, gzip" },
    { k: "x-trace-id", v: "9f4a2c81-d3b0-4f17-b2e8-c41a7c0bb7e2" },
  ],
};

/* ── helpers ── */
// Resolve a { svc, mth } reference (within a server) to its full method def.
window.HS_DATA.findServer = function (id) {
  return window.HS_DATA.servers.find((s) => s.id === id) || null;
};
window.HS_DATA.findMethod = function (serverId, svc, mth) {
  const srv = window.HS_DATA.findServer(serverId);
  if (!srv) return null;
  for (const s of srv.services) {
    if (svc && s.short !== svc) continue;
    const m = s.methods.find((m) => m.name === mth);
    if (m) return { ...m, svcShort: s.short, svcName: s.name, proto: srv.proto };
  }
  return null;
};
