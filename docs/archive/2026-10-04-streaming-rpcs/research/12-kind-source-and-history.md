# Research — Method kind: source of truth, history views, terminology

Ticket 12 (streaming RPCs, `issues/12-surfacing-the-kind.md`). Three questions behind the
"derive or persist the kind" decision: (Q1) where gRPC GUI clients take the kind
(unary / server-streaming / client-streaming / bidi) from and what they do without a
descriptor source; (Q5) whether history / executed-call views show the kind; and what the
concept is called in gRPC's own docs and implementations, to pick a glossary term for
`src/CONTEXT.md`.

Handshaker facts this note builds on (surveyed 2026-09-26 in this worktree): the kind is
`client_streaming` / `server_streaming` on `MethodEntryIpc` (`src-tauri/src/ipc/catalog.rs`
l.22–29), folded into `MethodKind = "unary" | "server" | "client" | "bidi"` by `deriveKind`
(`src/features/shell/SelectedMethod.ts`); `DraftAddressBar.tsx` l.83 hardcodes
`kind: "unary"`; `SavedRequestIpc` (`src-tauri/src/ipc/collection.rs` l.145–157) and `Step`
(`src/features/workflow/model.ts` l.14–33) carry `service` + `method` and **no** kind; the
executed-step header `AddressBar.tsx` renders `step.method` / `step.address` / `step.service`
plus the `✓ OK · Nms` / `✕ error` chip from `Step` alone (no catalog prop);
`MethodPicker.tsx` l.206–215 already has `KindBadge` (`stream` / `client` / `bidi`, hidden for
unary).

Sources are quoted from official docs or from the products' GitHub sources fetched with
`gh api` on 2026-09-26 (default branches). Postman's app is closed-source, so Postman claims
rest on its Learning Center pages only.

---

## Answer

### Q1 — Where the kind comes from, and what happens without a descriptor

**(a) Derived live vs stored on the saved item.** Every open-source client derives the kind
from the method descriptor at load time; two of them *additionally* persist a copy on the
saved item, but only as a cache for the UI — the invoke path re-reads the descriptor.

| Client | Kind at invoke time | Persisted on the saved item? | Evidence |
|---|---|---|---|
| grpcurl | derived: `mtd.IsClientStreaming()` / `IsServerStreaming()` on the `desc.MethodDescriptor` selects `invokeBidi` / `invokeClientStream` / `invokeServerStream` / `invokeUnary` | n/a (no saved items) | [S1] |
| grpcui | derived: the web form is built from the per-method `schema` (`schema.requestStream` turns the root input into an array and prepends `<em>stream</em>` to the request-type header) | history items store `service` + `method` + request data only; no kind field | [S2][S3] |
| Insomnia | derived: `getSelectedMethod` re-loads methods from the proto file or reflection on every send, finds the method by `protoMethodName`, then `getMethodType({requestStream, responseStream})` | **no** — `BaseGrpcRequest` has `protoFileId`, `protoMethodName`, `reflectionApi`, body, metadata; nothing about the type | [S4][S5][S6] |
| Bruno | derived at connect: `startConnection` resolves `request.method` against the in-memory method cache, falls back to a reflection/proto refresh, then `#getMethodType(method)` from `requestStream` / `responseStream` | **yes** — `.bru` `grpc { methodType: unary \| client-streaming \| server-streaming \| bidi-streaming }` (schema enum incl. `''`); written by `jsonToBru`; used by the UI for icons, Send/Cancel/End gating and the timeline badge, and by the grpcurl-command generator | [S7][S8][S9][S10][S11] |
| Kreya | derived from imported protobuf definitions ("a Kreya gRPC operation must always correspond to a service method of the gRPC service and the protobuf definitions have to be imported") | **yes** — `.krop` JSON has `"operationType": "unary"` / `"serverStreaming"` next to `details.methodFqn` (58 unary + 2 serverStreaming in the DCS-gRPC project) | [S12][S13] |
| Postman | derived from the service definition ("The service's definition populates the list of methods"; reflection auto-loads it, else import a `.proto`) | unknown — gRPC collections cannot be exported and the public Collection Format v2.1 schema has no gRPC fields (see (c)) | [P1][P2][P3] |
| BloomRPC | archived 2023-01-04; not researched further | — | [S14] |

**(b) When reflection / proto is unavailable.** None of the surveyed clients assumes
"unary" and none relies on a server error to learn the kind; they refuse to invoke:

- grpcurl / grpcui need a descriptor source: "if the server you interact with does not
  support reflection, you will either need the proto source files that define the service or
  need protoset files" (grpcurl README); grpcui fails fast when
  `!reflection.val && len(protoset) == 0 && len(protoFiles) == 0`
  ("No protoset files or proto files specified and -use-reflection set to false.") [S15][S16].
- grpcui gates the Invoke button on the form having been built (`$(".grpc-invoke").prop("disabled", !enabled)`),
  and a history item whose service/method is no longer in the loaded catalog gets its
  **Load** button disabled with the tooltip "Service or method no longer available" [S3].
- Insomnia: `getSelectedMethod` throws `invariant(methods, 'No reflection methods found')`
  and, if the method is not in the (re)loaded list, replies
  `grpc.error … The gRPC method ${protoMethodName} could not be found`; the request pane's
  method-type tab is rendered only `{methodType && …}`, i.e. only once the descriptor is loaded
  (`methodType = methods.find(…)?.type`) [S5][S6].
- Bruno: on connect it re-derives the type from the live descriptor; a failed refresh throws
  "Failed to refresh methods and method ${methodPath} not found". Before connect the UI
  trusts the stored `methodType` (initial `selectedGrpcMethod = { path: method, type }` from
  the saved request) and, when reflection later succeeds, **overwrites** it with
  `currentMethod.type` from the fresh list; if the saved method is gone it clears the
  selection (`onMethodSelect({ path: '', type: '' })`) [S7][S17].
- Postman: "If server reflection isn't supported on the server, you have to load the service
  definition manually"; Invoke is described only for the "entered the server URL, selected a
  method, and defined the payload" state [P1][P2]. Whether the button is literally disabled
  before a method is selected is not documented (Unconfirmed).

**(c) Postman collection JSON.** The public Collection Format v2.1.0 schema
(`schema.postman.com/json/collection/v2.1.0/collection.json`) defines `request.method` as
"The Standard HTTP method associated with this request" and contains no `grpc`, `proto` or
method-type fields [P3]. Postman staff (2024-08-21): "Currently, there isn't an export option
for the non-http Collections. This will be introduced into the platform soon though - no
timelines for this yet" [P4]; the 2022 feature request for exporting WebSocket/gRPC
collections is still open [P5]. So there is **no public Postman schema or exported example**
to check for a method-type field; the internal representation is unknown.

**Frontend principle.** React, "Choosing the State Structure": "**Avoid redundant state.** If
you can calculate some information from the component's props or its existing state variables
during rendering, you should not put that information into that component's state." and
"**Avoid duplication in state.** When the same data is duplicated between multiple state
variables, or within nested objects, it is difficult to keep them in sync." — with the
`fullName` example: removing the derived variable means "the change handlers no longer need
special logic" and the derived value is recomputed on every render [R1].

### Q5 — History / executed-call views

- **grpcui** (`History` tab, localStorage, max 100 items): a history row shows load button,
  local time, `durationMS`, result (`OK` / `Failure: …` / error name), `service.method` and a
  message count that is printed **only when it is not 1** — "on success, only show number of
  response messages if not one (e.g. a stream)". No kind label; streaminess surfaces
  indirectly through the message count and through the stored request `data` being an array
  for client-streaming calls [S3].
- **Bruno** (response-pane Timeline, the closest thing to per-call history): the `request`
  event header renders `<span className="method-type-badge">{effectiveRequest.methodType}</span>`
  next to the event name, i.e. Bruno **does** label a past call with its kind, and reads it from
  the saved request, not from the catalog [S11].
- **Insomnia**: no request history feature was found in the gRPC pane sources; the kind
  appears only as the live pane's first tab ("Unary" / "Server Streaming" / "Client Streaming"
  / "Bi-directional Streaming") [S6].
- **Postman**: History is documented generically ("To access the requests you've made, click
  the History tab in the sidebar … Click a request to open it again in a new tab") and the
  gRPC pages never mention History; the streaming *response* view is "a series of sent and
  received messages in a timeline instead of a single response" [P2][P6]. Whether the History
  row or the reopened tab's header shows a kind marker is undocumented (Unconfirmed).
- **Kreya**: responses are stored separately from `.krop` files; no history-row rendering
  documentation found (Unconfirmed).

**UX guidance.** NN/g, "10 Usability Heuristics Applied to Complex Applications" (Aesthetic
and minimalist design): "Every extra unit of information in an interface competes with the
relevant units of information and diminishes their relative visibility." and, on icons that
denote item type where the type is already evident from context, "Redundant icons create
clutter and waste precious space in the interface." [N1]. NN/g, "Indicators, Validations, and
Notifications": an indicator is "a way of making a page element … stand out to inform the user
that there is something special about it that warrants the user's attention"; "Indicators can
introduce noise and clutter to your overall interface, and may distract users" — use them when
the information is important, frequently needed, and missing it would create problems [N2].
NN/g, "Visual Indicators to Differentiate Items in a List": a visual indicator is "a 'marker'
that helps users quickly locate an item that has an important distinctive attribute within a
list of otherwise similar objects"; icon + colour beat text-only by ~37 % [N3]. Read together:
a kind badge is justified where the kind is a *distinctive attribute among similar rows* (the
method list, a mixed history list) and is redundant where the surface already makes the kind
evident (a pane whose body is a message timeline with a `STREAMING`/`IDLE` status).

### Terminology

| Source | Term for the concept | Values | Ref |
|---|---|---|---|
| grpc.io core concepts | "four kinds of service method"; headings **Unary RPC**, **Server streaming RPC**, **Client streaming RPC**, **Bidirectional streaming RPC** (section "RPC life cycle") | as headings | [G1] |
| `google/protobuf/descriptor.proto` | no noun; two flags on `MethodDescriptorProto`: `client_streaming = 5` "Identifies if client streams multiple client messages", `server_streaming = 6` "Identifies if server streams multiple server messages" | bool × bool | [G2] |
| grpc-java | `MethodDescriptor.MethodType` — "The call type of a method." | `UNARY`, `CLIENT_STREAMING`, `SERVER_STREAMING`, `BIDI_STREAMING`, `UNKNOWN` (+ `clientSendsOneMessage()` / `serverSendsOneMessage()`) | [G3] |
| grpc-go | no enum; `MethodDesc` (unary) vs `StreamDesc { ServerStreams bool // indicates the server can perform streaming sends; ClientStreams bool // … client … }` — "At least one must be true" | struct choice + 2 bools | [G4] |
| grpc-node (`@grpc/grpc-js`) | `MethodDefinition { requestStream: boolean; responseStream: boolean }`; legacy docs expose `methodTypes` enum `UNARY / CLIENT_STREAMING / SERVER_STREAMING / BIDI_STREAMING`; client API `makeUnaryRequest` / `makeClientStreamRequest` / `makeServerStreamRequest` / `makeBidiStreamRequest` | 2 bools / enum | [G5][G6] |
| Postman docs | "method type(s)" — "four types of gRPC methods": **Unary**, **Client streaming**, **Server streaming**, **Bidirectional streaming**; "While invoking a streaming method type (client streaming, server streaming, or bidirectional streaming)…" | labels | [P2][P7] |
| Bruno | `methodType` | `unary`, `client-streaming`, `server-streaming`, `bidi-streaming` | [S8] |
| Insomnia | `GrpcMethodType`; UI names `Unary`, `Server Streaming`, `Client Streaming`, `Bi-directional Streaming` | `unary`, `server`, `client`, `bidi` | [S5][S6] |
| Kreya | `operationType` | `unary`, `serverStreaming`, … | [S13] |
| Handshaker today | `MethodKind` / `deriveKind` / `KindBadge`; badge labels `stream`, `client`, `bidi` | `unary`, `server`, `client`, `bidi` | code |

Observations: the industry noun is **"method type"** (grpc-java `MethodType`, Postman "method
type", Bruno `methodType`, Insomnia `GrpcMethodType`); grpc.io uses "kind" only as a plain
English count noun ("four kinds of service method") and names the values as "… RPC"; grpc-go
and grpc-node have no noun at all, just the two protobuf flags. Handshaker's values
(`unary/server/client/bidi`) coincide exactly with Insomnia's.

---

## Recommendation for Handshaker

**Q1 — source of truth.** *Verified:* every surveyed client treats the descriptor
(reflection/proto) as the source of truth for the kind at invoke time; Bruno and Kreya also
persist a copy on the saved item, and Bruno demonstrably has to reconcile it (overwrite on
refresh, clear on missing method). None assumes "unary" without a descriptor; they refuse to
invoke. *Inference:* keep the kind **derived** — `deriveKind(catalogEntry)` in
`DraftAddressBar` replaces the `"unary"` hardcode; the Send spine keeps deciding the branch
from the `MethodDescriptor` it already resolves (so the unary gate in `invoke_unary` stays as
the defence). Do not add a kind field to `SavedRequestIpc` (React "avoid redundant state" +
Bruno's reconciliation cost). A draft with no catalog yet (address typed, reflection pending
or failed) has **no kind**, not "unary": the badge is absent and Send is gated the way it is
already gated on "method selected" — the same rule Insomnia and grpcui apply.

**Q5 — history header.** *Verified:* grpcui's history row shows no kind label (only a
message count when ≠ 1); Bruno's timeline does show a `methodType` badge on the request
event, sourced from the saved request; Postman/Kreya history rendering is undocumented.
NN/g: extra units of information compete with the relevant ones; indicators earn their place
when the attribute is distinctive among similar items. *Inference:* the executed-step header
does **not** need a persisted kind. If the streaming pane (ticket 09) already carries the
message timeline + `STREAMING`/`IDLE` statusline, a header badge is the "redundant icon"
case; and a history `Step` can show the kind from its **outcome** if it is wanted (a
stream outcome vs a `UnaryOutcome` is already a discriminated union) — no catalog and no new
field required. Reserve persisting the kind for a *list* surface (sidebar of saved requests /
past steps) if one ever mixes kinds and users need to locate streams in it.

**Terminology.** *Verified:* the closest thing to a standard noun is **"method type"**
(grpc-java `MethodDescriptor.MethodType`, Postman "method type", Bruno `methodType`, Insomnia
`GrpcMethodType`); grpc.io names only the values (Unary / Server streaming / Client streaming
/ Bidirectional streaming RPC); protobuf has no noun, only `client_streaming` /
`server_streaming`. *Inference:* adopt **"Method kind"** as the `src/CONTEXT.md` term — it is
what the code already says (`MethodKind`, `deriveKind`, `KindBadge`), "kind" is the word
grpc.io itself uses for the four-way split, and it avoids "type", which in this codebase
already means proto message types (`input_message`, `MessageSchema`) and TS types. Define it
as: the four-way classification of a method derived from `client_streaming` /
`server_streaming` — `unary` / `server` (server-streaming) / `client` (client-streaming) /
`bidi`; values map 1:1 to grpc.io's RPC names; it is **derived from the catalog entry, never
stored** (`_Avoid_`: a kind field on `SavedRequest` / `Step`; assuming `unary` when the
catalog is absent). Terms to avoid: "RPC type" / "call type" (grpc-java's doc phrase, but
"call" is already taken by *Stream call* in the core glossary and would read as a runtime
object, not a static property of the method); "streaming mode" / "stream kind" (excludes
unary); "method type" (collides with message types); "duplex" (Kreya-only, for bidi).
Badge labels stay `stream` / `client` / `bidi` (Postman-like wording, Bruno/Insomnia both spell
out "… streaming" but as full-width labels, not badges).

---

## Evidence

Product sources (GitHub default branches, fetched 2026-09-26 with `gh api`):

- **[S1]** grpcurl `invoke.go` l.142–150 —
  <https://github.com/fullstorydev/grpcurl/blob/master/invoke.go>:
  `if mtd.IsClientStreaming() && mtd.IsServerStreaming() { return invokeBidi(…) } else if mtd.IsClientStreaming() { return invokeClientStream(…) } else if mtd.IsServerStreaming() { return invokeServerStream(…) } else { return invokeUnary(…) }`.
- **[S2]** grpcui `internal/resources/webform/webform.js` l.136–142 (`buildRequestForm(schema)`:
  `if (schema.requestStream) { requestObj = [requestObj]; }`), l.234 (`isArray: schema.requestStream`),
  l.257–259 (`if (schema.requestStream) { cell.prepend('<em>stream</em> '); }`) —
  <https://github.com/fullstorydev/grpcui/blob/master/internal/resources/webform/webform.js>.
- **[S3]** same file: Invoke gating l.69 `$(".grpc-invoke").prop("disabled", !enabled);`,
  l.2238/2281 disabled during a call; history item shape l.2245–2254 (`request{timeout_seconds,
  metadata, data}, service, method, startTime`); history row l.2886–2923 (comment "on success,
  only show number of response messages if not one (e.g. a stream)"; `<button class="load"
  ${valid ? '' : 'disabled'}`; `title="Service or method no longer available"`); storage
  l.2575–2582 (`maxHistory = 100`, `localStorage`), template
  `webform-template.html` l.51/107–110 ("History" tab, "Clear History", "Save History").
- **[S4]** Insomnia `packages/insomnia-data/src/models/grpc-request.ts` — `interface BaseGrpcRequest
  { name; url; description; protoFileId?; protoMethodName?; body; metadata; metaSortKey; isPrivate;
  reflectionApi{enabled,url,apiKey,module}; disableUserAgentHeader?; konnectRouteKey?; … }`
  (no type field) — <https://github.com/Kong/insomnia/blob/develop/packages/insomnia-data/src/models/grpc-request.ts>;
  `schemas/insomnia.schema.5.1.json` likewise only `protoMethodName` + `reflectionApi`.
- **[S5]** Insomnia `packages/insomnia/src/main/ipc/grpc.ts` — l.309–320
  `getMethodType = ({ requestStream, responseStream }) => bidi | client | server | unary`;
  l.321–347 `getSelectedMethod` (proto file → `loadMethodsFromFilePath`, else
  `getMethodsFromReflection(…)`; `invariant(methods, 'No reflection methods found')`;
  `methods.find(c => c.path === request.protoMethodName)`); l.405–415 on send: `if (!method)
  event.reply('grpc.error', …, new Error(\`The gRPC method ${request.protoMethodName} could not
  be found\`))` then `const methodType = getMethodType(method)`; l.580
  `export type GrpcMethodType = 'unary' | 'server' | 'client' | 'bidi'` —
  <https://github.com/Kong/insomnia/blob/develop/packages/insomnia/src/main/ipc/grpc.ts>.
- **[S6]** Insomnia `packages/insomnia/src/ui/components/panes/grpc-request-pane.tsx` — l.54–60
  `canClientStream`, `GrpcMethodTypeName = { unary: 'Unary', server: 'Server Streaming', client:
  'Client Streaming', bidi: 'Bi-directional Streaming' }`; l.143–144 `const method =
  methods.find(c => c.fullPath === activeRequest.protoMethodName); const methodType = method?.type;`;
  l.383–389 `{methodType && (<Tab id="method-type">{GrpcMethodTypeName[methodType]}</Tab>)}` —
  <https://github.com/Kong/insomnia/blob/develop/packages/insomnia/src/ui/components/panes/grpc-request-pane.tsx>.
- **[S7]** Bruno `packages/bruno-requests/src/grpc/grpc-client.js` — l.269–276
  `#getMethodType({ requestStream, responseStream })` → `bidi-streaming | client-streaming |
  server-streaming | unary`; l.611–648 `startConnection`: `method = this.#getMethodFromPath(methodPath)`
  with fallback `#refreshMethods(…)` (comment: "the stored metadata from local storage … loses its
  requestSerialize function while saving to local storage so we are using reflection as a
  fallback"), `throw new Error(\`Failed to refresh methods and method ${methodPath} not found\`)`;
  l.695 `const methodType = this.#getMethodType(method);`; l.813–822 reflection results get
  `modifiedMethod.type = this.#getMethodType(modifiedMethod)`; l.1007/1058 grpcurl-command
  generator reads the saved `methodType = 'unary'` default —
  <https://github.com/usebruno/bruno/blob/main/packages/bruno-requests/src/grpc/grpc-client.js>.
- **[S8]** Bruno `packages/bruno-schema/src/collections/index.js` l.546–552 —
  `grpcRequestSchema`: `methodType: Yup.string().oneOf(['unary', 'client-streaming',
  'server-streaming', 'bidi-streaming', '']).nullable()`, next to `method`, `protoPath` —
  <https://github.com/usebruno/bruno/blob/main/packages/bruno-schema/src/collections/index.js>.
- **[S9]** Bruno `packages/bruno-lang/v2/src/jsonToBru.js` l.85–88 — `if (grpc.methodType && …)
  bru += \`\n  methodType: ${grpc.methodType}\``; `packages/bruno-electron/src/ipc/network/prepare-grpc-request.js`
  l.170 `methodType: request.methodType` forwarded to the runner. Docs: `bru.grpc.request.methodType`
  "`unary`, `server-streaming`, `client-streaming`, or `bidi`" —
  <https://github.com/usebruno/bruno-docs/blob/main/send-requests/grpc/scripting.mdx>.
- **[S10]** Bruno `packages/bruno-app/src/components/RequestPane/GrpcQueryUrl/MethodDropdown/index.js`
  l.61–72 — `getIconForMethodType`: `IconGrpcUnary` / `IconGrpcClientStreaming` /
  `IconGrpcServerStreaming` / `IconGrpcBidiStreaming` per `method.type`;
  `GrpcQueryUrl/index.js` l.30–31 `STREAMING_METHOD_TYPES`, `CLIENT_STREAMING_METHOD_TYPES`;
  l.408–441 Cancel / End (`IconCheck`) shown only for `isConnectionActive && isStreamingMethod`,
  Send arrow otherwise.
- **[S11]** Bruno `packages/bruno-app/src/components/ResponsePane/Timeline/GrpcTimelineItem/index.js`
  l.282–286 — `{eventType === 'request' && effectiveRequest.methodType && (<span className=
  "method-type-badge px-2 py-0.5">{effectiveRequest.methodType}</span>)}`.
- **[S12]** Kreya docs "gRPC operations" — "a Kreya gRPC operation must always correspond to a
  service method of the gRPC service and the protobuf definitions have to be imported"; "you can
  select the gRPC method in the operation header"; "gRPC supports multiple requests and responses
  in an operation … bidirectional or client-streaming methods" — <https://kreya.app/docs/operations/grpc/>
  (read via fetch summary; exact wording of the first quote confirmed, the rest paraphrased).
- **[S13]** Kreya `.krop` files in the public DCS-gRPC project —
  <https://github.com/DCS-gRPC/Kreya/blob/main/project/dcs/mission/v0/MissionService/StreamEvents.krop>:
  `{ "details": { "methodFqn": "dcs.mission.v0.MissionService.StreamEvents" }, "requests": [{ "location":
  "StreamEvents-request.json" }], "operationType": "serverStreaming", "invokerName": "grpc" }`;
  tally over the first 60 `.krop` files: 58 × `"unary"`, 2 × `"serverStreaming"`.
- **[S14]** `gh api repos/bloomrpc/bloomrpc` → `archived: true`, `pushed_at: 2023-01-04`.
- **[S15]** grpcurl README — "Without any additional command-line flags, `grpcurl` will try to use
  server reflection"; "if the server you interact with does not support reflection, you will
  either need the proto source files that define the service or need protoset files that `grpcurl`
  can use"; "`grpcurl` supports all kinds of RPC methods, including streaming methods" —
  <https://github.com/fullstorydev/grpcurl/blob/master/README.md>.
- **[S16]** grpcui `cmd/grpcui/grpcui.go` l.425–426 —
  `if !reflection.val && len(protoset) == 0 && len(protoFiles) == 0 { fail(nil, "No protoset files or
  proto files specified and -use-reflection set to false.") }`; README: "`grpcui` supports all kinds
  of RPC methods, including streaming methods. However, it requires you to construct the entire
  stream of request messages all at once".
- **[S17]** Bruno `GrpcQueryUrl/index.js` l.36–48 (`type = getPropertyFromDraftOrRequest(item,
  'request.type')`, `useState({ path: method, type })`), l.91–131 `handleReflection`: on error
  `toast.error(\`Failed to load gRPC methods: …\`)` and return; on success, if the selected path
  is missing → `setSelectedGrpcMethod(null); onMethodSelect({ path: '', type: '' })`, else
  `setSelectedGrpcMethod({ path, type: currentMethod.type })`.

Postman (Learning Center / community; app is closed-source):

- **[P1]** "Invoke a gRPC request in Postman" — "Click **Select a method** and browse through the
  supported services and methods. When you enter the URL, Postman automatically loads the service
  definition using server reflection (if supported by the server). If server reflection isn't
  supported on the server, you have to load the service definition manually." —
  <https://learning.postman.com/docs/use/send-requests/protocols/grpc/first-grpc-request/>.
- **[P2]** "The gRPC client interface" — "Select the method you wish to invoke using the Switch
  request type dropdown list. The service's definition populates the list of methods. For more
  details about the method types, see About gRPC API requests."; "Invoke — Once you have entered
  the server URL, selected a method, and defined the payload, click Invoke"; "A service definition
  is loaded automatically after you enter the URL if the server supports server reflection.
  Otherwise, you must load a service definition manually by selecting or importing a .proto file.";
  "Multiple responses — While invoking a streaming method type (client streaming, server
  streaming, or bidirectional streaming), the client-server communication within a single session
  is recorded in the response area as a series of sent and received messages in a timeline instead
  of a single response" — <https://learning.postman.com/docs/sending-requests/grpc/grpc-request-interface/>.
- **[P3]** Postman Collection Format v2.1.0 schema —
  <https://schema.postman.com/json/collection/v2.1.0/collection.json>: `request.method` = "The
  Standard HTTP method associated with this request."; no occurrence of `grpc`, `proto`,
  `methodType`.
- **[P4]** Postman Community, "How can I export the collection with gRPC requests" (Danny Dainton,
  Postman, 2024-08-21): "Currently, there isn't an export option for the non-http Collections. This
  will be introduced into the platform soon though - no timelines for this yet." —
  <https://community.postman.com/t/how-can-i-export-the-collection-with-grpc-requests/66848>.
- **[P5]** postman-app-support #11252 "Export collections with WebSocket and gRPC requests"
  (opened 2022-09-09, open, feature) — <https://github.com/postmanlabs/postman-app-support/issues/11252>.
- **[P6]** "Navigating Postman" — "History — To access the requests you've made, click the History
  tab in the sidebar. … Click a request to open it again in a new tab."; no gRPC-specific text —
  <https://learning.postman.com/docs/getting-started/basics/navigating-postman/>.
- **[P7]** [P1] §"About gRPC API requests" — "The Postman API client supports four types of gRPC
  methods …: Unary — This is the traditional request-response communication pattern also seen in
  HTTP … Client streaming — The client sends a series of messages to the server and the server
  returns a response after processing them. Server streaming — The client makes a single request
  and the server returns a response with a stream of messages. Bidirectional streaming — The
  client and server communicate with each other asynchronously over a persistent session."

gRPC / protobuf / React / NN/g:

- **[G1]** grpc.io "Core concepts, architecture and lifecycle" — "gRPC lets you define four kinds of
  service method"; headings under "RPC life cycle": "Unary RPC", "Server streaming RPC", "Client
  streaming RPC", "Bidirectional streaming RPC" — <https://grpc.io/docs/what-is-grpc/core-concepts/>.
- **[G2]** `google/protobuf/descriptor.proto`, `message MethodDescriptorProto` — `// Identifies if
  client streams multiple client messages\n optional bool client_streaming = 5 [default = false];
  // Identifies if server streams multiple server messages\n optional bool server_streaming = 6
  [default = false];` — <https://github.com/protocolbuffers/protobuf/blob/main/src/google/protobuf/descriptor.proto>.
- **[G3]** grpc-java `api/src/main/java/io/grpc/MethodDescriptor.java` l.81–106 — `public enum
  MethodType { /** One request message followed by one response message. */ UNARY, /** Zero or
  more request messages with one response message. */ CLIENT_STREAMING, /** One request message
  followed by zero or more response messages. */ SERVER_STREAMING, /** Zero or more request and
  response messages arbitrarily interleaved in time. */ BIDI_STREAMING, /** Cardinality and
  temporal relationships are not known. … */ UNKNOWN; …` ; javadoc: "The call type of a method." —
  <https://grpc.github.io/grpc-java/javadoc/io/grpc/MethodDescriptor.MethodType.html>.
- **[G4]** grpc-go `stream.go` — `type StreamDesc struct { StreamName string; Handler StreamHandler;
  // ServerStreams and ClientStreams are used for registering handlers on a server as well as
  defining RPC behavior … At least one must be true.\n ServerStreams bool // indicates the server
  can perform streaming sends\n ClientStreams bool // indicates the client can perform streaming
  sends }`; `server.go` — `type MethodDesc struct { MethodName string; Handler MethodHandler }`,
  `ServiceDesc { …; Methods []MethodDesc; Streams []StreamDesc; … }` —
  <https://github.com/grpc/grpc-go/blob/master/stream.go>, <https://github.com/grpc/grpc-go/blob/master/server.go>.
- **[G5]** grpc-node `packages/grpc-js/src/make-client.ts` l.31–47 — `ClientMethodDefinition { path;
  requestStream: boolean; responseStream: boolean; … }`, `ServerMethodDefinition` likewise;
  `client.ts` `makeUnaryRequest` / `makeClientStreamRequest` / `makeServerStreamRequest` /
  `makeBidiStreamRequest` — <https://github.com/grpc/grpc-node/blob/master/packages/grpc-js/src/make-client.ts>.
- **[G6]** legacy `grpc` Node docs — `MethodDefinition`: `requestStream` "Indicates whether the
  method accepts a stream of requests", `responseStream` "Indicates whether the method returns a
  stream of responses"; `methodTypes` enum `UNARY(0) CLIENT_STREAMING(1) SERVER_STREAMING(2)
  BIDI_STREAMING(3)` — <https://grpc.github.io/grpc/node/grpc.html>.
- **[R1]** React docs, "Choosing the State Structure" — principles "Avoid redundant state" and
  "Avoid duplication in state" quoted above; `fullName` example —
  <https://react.dev/learn/choosing-the-state-structure>.
- **[N1]** NN/g, "10 Usability Heuristics Applied to Complex Applications" — "Redundant icons create
  clutter and waste precious space in the interface."; "Every extra unit of information in an
  interface competes with the relevant units of information and diminishes their relative
  visibility." — <https://www.nngroup.com/articles/usability-heuristics-complex-applications/>.
- **[N2]** NN/g, "Indicators, Validations, and Notifications: Pick the Correct Communication
  Option" — indicator definition; "Indicators can introduce noise and clutter to your overall
  interface, and may distract users" — <https://www.nngroup.com/articles/indicators-validations-notifications/>.
- **[N3]** NN/g, "Visual Indicators to Differentiate Items in a List" — definition quoted above;
  icon+colour indicators ~37 % faster than text-only —
  <https://www.nngroup.com/articles/visual-indicators-differentiators/>.

Handshaker (this worktree): `src/features/shell/SelectedMethod.ts` (`MethodKind`, `deriveKind`);
`src/features/shell/MethodPicker.tsx` l.51 (`kind: deriveKind(m)`), l.73, l.206–215 (`KindBadge`);
`src/features/workflow/DraftAddressBar.tsx` l.83; `src/features/workflow/AddressBar.tsx`;
`src/features/workflow/model.ts` l.14–33; `src-tauri/src/ipc/collection.rs` l.145–157;
`src-tauri/src/ipc/catalog.rs` l.22–29; `crates/handshaker-core/CONTEXT.md` l.90–137
(**Stream call**, half-close, stream end glossary).

## Unconfirmed

- Postman: whether the method dropdown / History rows carry per-kind icons or labels, and
  whether **Invoke** is disabled (vs. erroring) before a method is selected — the Learning
  Center describes the four types in prose only [P7] and the app is closed-source. The
  "Switch request type dropdown" wording in [P2] is Postman's own (it reads like a doc slip for
  the method selector).
- Postman's internal collection representation of a gRPC request (any method-type field)
  — no export exists [P4][P5] and the public schema has no gRPC section [P3].
- Kreya: behaviour when the importer/definition is missing or the `methodFqn` no longer
  resolves, and how its response history rows look — the docs page fetch summarised only the
  quoted sentence; `kreya.app` stalled on a second (raw) fetch. `operationType` values other
  than `unary` / `serverStreaming` were not observed in the sampled project.
- Bruno: the exact `.bru` example in `bruno-docs/send-requests/grpc/grpc-request.mdx` was not
  present in the fetched page; the format is evidenced from `jsonToBru.js` and the schema
  instead [S8][S9].
- BloomRPC's storage model was not inspected (archived project).
- grpc-go / grpc-node quotes are from the current default branches, not a pinned release.
