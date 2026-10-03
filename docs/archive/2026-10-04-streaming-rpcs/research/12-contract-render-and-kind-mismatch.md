# Research: Contract `stream` rendering and method-kind mismatch errors (ticket 12)

Ticket: `../issues/12-surfacing-the-kind.md` (map `../map.md`). Questions Q2 (rendering the
`stream` modifier; where the flags live) and Q3 (what happens on a kind mismatch; how to
model and present the error).

Pinned versions. Repo: **tonic 0.14.6**, **prost-reflect 0.14.7** (`Cargo.lock`; tonic
citations are to the vendored crate under `~/.cargo/registry/src/index.crates.io-*/tonic-0.14.6/`).
Upstream sources read on 2026-09-26 from the default branches: grpc-go `master`
(`version.go`: `1.86.0-dev`), grpc-java `master` (`1.85.0-SNAPSHOT`), grpc-node `master`
(`@grpc/grpc-js` 1.13.4), jhump/protoreflect `main` (v2 layout, `protoprint/print.go`),
grpcurl `master`, protoc-gen-doc `master`, protobuf `main` (`descriptor.proto`).

Repo context: `src/features/contract/proto.ts` (`renderContractDoc(method, input, output)`
prints `rpc Name(In) returns (Out);` from two per-side `MessageSchemaIpc { root, messages,
enums }` — no streaming flags, `src-tauri/src/ipc/schema.rs:10`); the catalog entry
`MethodEntryIpc` carries `client_streaming` / `server_streaming`
(`src-tauri/src/ipc/catalog.rs:22-29`) and `deriveKind` folds them into
`"unary" | "server" | "client" | "bidi"` (`src/features/shell/SelectedMethod.ts:11`);
`DraftAddressBar.tsx:83` still hardcodes `kind: "unary"`. Core `invoke_unary`
(`crates/handshaker-core/src/grpc/invoke/mod.rs:130`) returns
`CoreError::NotImplemented(String)` for any streaming method → `IpcError::NotImplemented {
message }` (`src-tauri/src/ipc/error.rs:49,75`) → frontend fault kind `other`
(`src/features/workflow/netDiagnostics.ts:86`, face "Request failed",
`ClientErrorView.tsx:24`).

## Answer

### Q2 — Rendering the `stream` modifier

**(a) Grammar.** The proto3 language spec defines the `rpc` production with an optional
`stream` keyword on each side, inside the parentheses, before the message type [E1]:

```
rpc = "rpc" rpcName "(" [ "stream" ] messageType ")" "returns" "(" [ "stream" ]
messageType ")" (( "{" {option | emptyStatement } "}" ) | ";")
```

The gRPC core-concepts page shows the canonical spellings of the four kinds [E2]:
`rpc SayHello(HelloRequest) returns (HelloResponse);`,
`rpc LotsOfReplies(HelloRequest) returns (stream HelloResponse);`,
`rpc LotsOfGreetings(stream HelloRequest) returns (HelloResponse);`,
`rpc BidiHello(stream HelloRequest) returns (stream HelloResponse);`.

**(b) How the tools print it.**

- **grpcurl `describe`** delegates to jhump/protoreflect's `protoprint.Printer` configured
  `Compact: true, OmitComments: CommentsNonDoc, SortElements: true,
  ForceFullyQualifiedNames: true` [E3]. `protoprint` writes `"rpc "`, the name, `"( "`,
  then `"stream " + inName` when `mtd.IsStreamingClient()`, then `") returns ( "`, then
  `"stream " + outName` when `mtd.IsStreamingServer()`, then `") "` [E4]. The golden files
  show the exact shape — with spaces inside the parentheses and, under
  `ForceFullyQualifiedNames`, a leading dot on every type [E5]:

  ```
  rpc DoSomethingElse ( stream TestMessage ) returns ( TestResponse );
  rpc DoSomethingAgain ( jhump.protoreflect.desc.Bar ) returns ( stream AnotherTestMessage );
  rpc DoSomethingForever ( stream TestRequest ) returns ( stream TestResponse );
  rpc StreamingRpc ( stream .foo.bar.Request ) returns ( .foo.bar.Request );
  ```

  So `grpcurl describe pkg.Svc` prints `rpc Name ( stream .pkg.In ) returns ( stream .pkg.Out );`.
- **grpcui** does not print a signature; its README only says "For RPCs that accept a
  _stream_ of requests, the web form allows the user to define multiple messages in the
  stream" [E6].
- **Postman** documents the four kinds by name (Unary / Client streaming / Server streaming /
  Bidirectional streaming) and describes each in prose; the docs do not describe a printed
  rpc signature or the visual marker in the method selector [E7] (see Unconfirmed).
- **protoc-gen-doc** renders a table; the streaming flag is a bare ` stream` suffix appended
  after the linked type: `[{{.RequestLongType}}](#…){{if .RequestStreaming}} stream{{end}}`
  and the same for the response [E8].

Summary: every tool that prints proto source puts the modifier **inside the parentheses,
before the type**, as the grammar requires; only the table renderer (protoc-gen-doc) moves
it after the type. Nobody invents a new keyword or a badge inside the signature line.

**(c) Where the flags live.** Method-level, everywhere, never on the message:

- `google.protobuf.MethodDescriptorProto` owns `client_streaming = 5` ("Identifies if
  client streams multiple client messages") and `server_streaming = 6`; `DescriptorProto`
  (the message) has no such field [E9].
- Go `protoreflect.MethodDescriptor` has `Input()`, `Output()`, `IsStreamingClient()`,
  `IsStreamingServer()`; `MessageDescriptor` has nothing streaming-related [E10].
- prost-reflect `MethodDescriptor::is_client_streaming(&self) -> bool` / `is_server_streaming`
  ("Returns `true` if the client/server streams multiple messages"), next to `input()` /
  `output()` which return plain `MessageDescriptor`s [E11] — this is exactly what
  `invoke_unary` already reads.
- protoc-gen-doc's `ServiceMethod` struct carries `RequestStreaming` / `ResponseStreaming`;
  its `Message` struct has no streaming fields [E12].
- grpc-java `MethodDescriptor.MethodType { UNARY, CLIENT_STREAMING, SERVER_STREAMING,
  BIDI_STREAMING, UNKNOWN }` with `clientSendsOneMessage()` ("true for UNARY and
  SERVER_STREAMING") and `serverSendsOneMessage()` [E13]; grpc-node's
  `ClientMethodDefinition { requestStream, responseStream }` [E14]. Both are per-method.

The same message type can be the input of a unary rpc and of a server-streaming rpc in the
same service; a message-level flag would be ill-defined. The Handshaker DTOs already
mirror this split correctly (`MessageSchemaIpc` per side, flags on `MethodEntryIpc`).

**Recommendation for Handshaker (Q2).** *Verified:* the grammar and every reference
printer put `stream` inside the parentheses before the type; the flags are a property of
the method descriptor (`MethodDescriptorProto` fields 5/6), never of the message.
*Inference:* keep `MessageSchemaIpc` flag-free and give `renderContractDoc` the kind as a
fourth argument (or the two booleans) sourced from the catalog entry — emit a `keyword`
token `"stream "` right after `"("` on each streaming side, so the line reads
`rpc Name(stream In) returns (stream Out);` (Handshaker's spacing, i.e. the grpc.io style
without the `protoprint` inner spaces). If the Contract tab must render when the catalog
is unavailable/stale, the right place for a catalog-independent source is a small
method-level DTO from the schema command (e.g. `{ input, output, client_streaming,
server_streaming }`), not extra fields on the per-side schema.

### Q3 — Kind-mismatch errors

**(a) What a server does when the cardinality is wrong.**

*The wire does not carry the kind.* A gRPC server dispatches on the `:path` only. grpc-go's
`handleStream` looks up `s.services[service]` then `srv.streams[method]` — one unified map in
which unary methods are registered as a `StreamDesc{ClientStreams: false, ServerStreams:
false}` wrapping the unary handler (`wrapUnaryHandler`) [E15]. An unknown name yields
`codes.Unimplemented` with `"unknown service %v"` / `"unknown method %v for service %v"`
[E15]. A known name with the wrong cardinality is **not** detectable at dispatch; it is
only visible as "too many / too few messages", and each implementation reacts
differently:

| Situation | grpc-go | grpc-java | grpc-node | tonic (server / client) |
|---|---|---|---|---|
| Server got 2+ requests on a non-client-streaming method | `Internal`, `"cardinality violation: received multiple request messages for non-client-streaming RPC"` (`serverStream.RecvMsg`) [E16] | `INTERNAL`, `"Too many requests"` (`UnaryServerCallListener.onMessage`; the server asks `call.request(2)` precisely to catch it) [E17] | — | **silently drops the extras**: `map_request_unary` takes `try_next()` once, then `stream.trailers()` drains `while self.message().await?.is_some() {}` [E18][E19] |
| Server got 0 requests | `Internal`, `"…received no request message from non-client-streaming RPC"` [E16] | `INTERNAL`, `"Half-closed without a request"` [E17] | — | `Status::internal("Missing request message.")` [E18] |
| Client got 2+ responses on a non-server-streaming call | `Internal`, `"cardinality violation: expected <EOF> for non server-streaming RPCs, but received another message"` (`clientStreamWrapper.RecvMsg`) [E16] | `INTERNAL`, `"More than one responses received for unary or client-streaming call"` [E20] | `UNIMPLEMENTED`, `'Too many responses received'` [E21] | **silently drops the extras**: `client_streaming` (which `unary` wraps) takes the first message then `body.trailers().await` drains the rest [E19][E22] |
| Client got 0 responses | `Internal`, `"…received no response message from non-server-streaming RPC"` [E16] | `INTERNAL`, `"No value received for unary call"` [E20] | — | `Status::internal("Missing response message.")` [E22] |

The gRPC status-code spec assigns both cardinality violations to **UNIMPLEMENTED**
("Request cardinality violation (method requires exactly one request but client sent some
other number of requests) | UNIMPLEMENTED | Server"; "Response cardinality violation … |
UNIMPLEMENTED | Client") [E23], and grpc-go's `codes.Unimplemented` doc lists "a
disagreement as to whether an RPC should be streaming" as a framework-generated cause
[E24] — yet grpc-go and grpc-java actually emit `Internal`; only grpc-node follows the
table. There is no portable status code to key a UI face on.

Consequences for Handshaker's tonic client calling with the wrong path (all derived from
the table; none is a guaranteed error):

- **unary path → server-streaming method**: the first response is returned, the rest are
  drained silently → *succeeds with a truncated result*; only a zero-message stream
  surfaces as `Internal "Missing response message."` (synthesized client-side by tonic).
- **unary path → client-streaming / bidi method**: one message + half-close is a valid
  one-element stream; every server accepts it → *succeeds*.
- **server-streaming path → unary method**: one response then trailers → *succeeds*, looks
  like a one-message stream.
- **client-streaming path (2+ messages) → unary / server-streaming method**: grpc-go →
  `Internal "cardinality violation…"`, grpc-java → `INTERNAL "Too many requests"`, tonic
  server → *silently drops the extras and succeeds*.

So a cardinality mismatch mostly **does not fail** — it silently loses messages. The only
reliable guard is the client's own descriptor check before sending.

**(b) Client-side guards in the reference stacks.** None of the runtime libraries verify
cardinality against a descriptor, because the descriptor is not present at runtime — the
*generated stub* fixes the path: grpc-go `ClientConn.Invoke` → `invoke` →
`newClientStream(ctx, unaryStreamDesc, …)` with
`var unaryStreamDesc = &StreamDesc{ServerStreams: false, ClientStreams: false}` and no
check [E25]; grpc-java `ClientCalls.blockingUnaryCall` / `asyncUnaryRequestCall` never
consult `method.getType()` — the only type assertion is on the **server**:
`Preconditions.checkArgument(call.getMethodDescriptor().getType().clientSendsOneMessage(),
"asyncUnaryRequestCall is only for clientSendsOneMessage methods")`
(`IllegalArgumentException`, a programming error, not a `Status`) [E17]; grpc-node's
`makeUnaryRequest` constructs `requestStream: false, responseStream: false` itself, and
`make-client.ts` picks `makeUnaryRequest` / `makeClientStreamRequest` /
`makeServerStreamRequest` / `makeBidiStreamRequest` from `attrs.requestStream` /
`attrs.responseStream` [E14][E21]. Mismatch detection in all three is post-hoc message
counting (table above). A dynamic client such as Handshaker (or grpcurl) is the one place
that *has* the descriptor at call time, so it is the only layer that can refuse before
bytes hit the wire — which `invoke_unary` already does via `m.is_client_streaming() ||
m.is_server_streaming()` [E11].

**(c) Error taxonomy: new variant vs generic bucket.**

- BurntSushi (canonical Rust error-handling essay, also the first-edition Book chapter):
  `String` errors "are _lossy_ … the errors we pass to the caller become completely
  opaque. The only reasonable thing the caller can do with a `String` error is show it to
  the user. Certainly, inspecting the string to determine the type of error is not
  robust"; the fix is "our own error type that represents errors with _structured data_
  … The ideal way to represent _one of many possibilities_ is to define our own sum type
  using `enum`"; and "If you're writing a library, defining your own error type should be
  strongly preferred so that you don't remove choices from the caller unnecessarily" [E26].
- `std::io::ErrorKind` shows the standard pattern for growing a taxonomy: the list "is
  intended to grow over time and it is not recommended to exhaustively match against it";
  `Other` is "A custom error that does not fall under any other I/O error kind … This
  `ErrorKind` is not used by the standard library"; errors that fit no kind "cannot be
  `match`ed on, and will only match a wildcard (`_`) pattern. New `ErrorKind`s might be
  added in the future for some of those" [E27]. I.e. a generic bucket is for the
  *unforeseen*; once a caller needs to branch on a case, it earns its own variant.
- Rust API guidelines C-GOOD-ERR: error types are "meaningful"; messages "lowercase without
  trailing punctuation … concise" [E28]. Yoshua Wuyts' survey draws the line between
  "dynamic errors and structured errors … best evidenced in the sibling libraries of
  `anyhow`, and `thiserror`" [E29] — `handshaker-core` is on the `thiserror` (structured)
  side.

Applied to the repo: `CoreError::NotImplemented(String)` is the `Other`-style bucket, and
the frontend indeed can only do `kind: "other"` with it [E30]. The repo's own precedent
for a *matchable* error is the `faultFromIpcError` switch on `e.type`: `Transport`,
`DeadlineExceeded`, `Cancelled`, `EncodeRequest`, `DecodeResponse`, `Auth` each get a
dedicated `FaultKind` + face + hint; everything else — including `NotImplemented` and the
structured-but-unbranched `ReflectionDisabled { hint }` / `MethodNotFound { service, method }`
— collapses into `other` with only its message [E30]. A kind mismatch is exactly the kind
of error the UI must branch on (it has a specific remedy), so by the criteria above it
should be its own `CoreError`/`IpcError` variant *and* its own `case` in that switch, not a
reuse of `NotImplemented` or `MethodNotFound`.

**(d) UX guidance for face + hint.**

- NN/g: "Concisely and precisely describe the issue — generic messages like 'An error
  occurred' lack necessary context"; "Offer constructive advice — provide remedies, not
  just problem statements"; "Concisely educate on how the system works — explain the issue
  and resolution path" [E31].
- Microsoft UX guide: good error messages have "A problem … A cause … A solution", are
  "Actionable" and "Specific — … giving specific names, locations, and values of the
  objects involved"; "do provide specific, actionable information if it is likely to be
  helpful most of the time"; "Don't provide a solution if it can be trivially deduced from
  the problem statement"; and for genuinely unknown errors "it is better to be up front
  about the lack of information" [E32] — i.e. the generic "Request failed" is right *only*
  for the unknown bucket.
- Apple HIG (Alerts): "Write a title that clearly and succinctly describes the situation …
  describe what happened, the context in which it happened, and why. Avoid writing a
  title that doesn't convey useful information — like 'Error'"; and prefer an in-context
  indicator over an interrupting alert ("when a server connection is unavailable, Mail
  displays an indicator") [E33] — supports Handshaker's inline body-filling face rather than
  a modal.

**Recommendation for Handshaker (Q3).** *Verified:* the server cannot tell a wrong-kind
call apart at dispatch; tonic silently truncates in both directions, grpc-go/java answer
`Internal`, grpc-node `Unimplemented`, the spec says `Unimplemented` — nothing on the wire
is a reliable signal, so the pre-send descriptor check in core is the real gate and must
stay on both paths. *Inference:* replace the string-typed `NotImplemented` gate with a
structured variant, e.g. `CoreError::MethodKindMismatch { service, method, expected: <the
path's kind>, actual: <descriptor kind> }` (names illustrative), mirrored 1:1 in `IpcError`
and mapped to a new `FaultKind` (e.g. `"kind_mismatch"`) with a face title that names the
situation ("Method kind changed" / "Contract out of date") and a hint that names the remedy
("`Svc/Method` is server-streaming in the current contract — refresh reflection and send
again"), all strings in `src/lib/messages.ts` per `ui-strings.md`. Keep `NotImplemented`
only for genuinely unwired paths during the phased rollout (then it is honest per
Microsoft's "unknown" rule). Do not try to classify a server-side `Internal "cardinality
violation…"` into this face — it is not portable and tonic never produces it.

## Evidence

- [E1] Protocol Buffers Language Guide, proto3 spec, "Service definition"
  (https://protobuf.dev/reference/protobuf/proto3-spec/): `rpc = "rpc" rpcName "(" [ "stream" ]
  messageType ")" "returns" "(" [ "stream" ] messageType ")" (( "{" {option | emptyStatement }
  "}" ) | ";")`.
- [E2] gRPC "Core concepts, architecture and lifecycle"
  (https://grpc.io/docs/what-is-grpc/core-concepts/): the four `rpc` snippets quoted in Q2(a).
- [E3] fullstorydev/grpcurl `grpcurl.go` (master): `var printer = &protoprint.Printer{Compact:
  true, OmitComments: protoprint.CommentsNonDoc, SortElements: true, ForceFullyQualifiedNames:
  true}`; `GetDescriptorText` → `printer.PrintProtoToString(dsc)`. README: "The 'describe' verb
  will print the type of any symbol … in the form of snippets of proto source."
- [E4] jhump/protoreflect `protoprint/print.go` (main, method printer ~L1515-1535):
  `fmt.Fprint(w, "rpc ")` … `fmt.Fprint(w, "( ")` … `if mtd.IsStreamingClient() { inName =
  "stream " + inName }` … `fmt.Fprint(w, ") returns ( ")` … `if mtd.IsStreamingServer() {
  outName = "stream " + outName }` … `fmt.Fprint(w, ") ")`.
- [E5] jhump/protoreflect `protoprint/testfiles/desc_test_proto3-compact.proto` L26-28 and
  `test-non-files-compact.txt` L80/L300/L309 — the four lines quoted in Q2(b).
- [E6] fullstorydev/grpcui README (https://github.com/fullstorydev/grpcui): "For RPCs that
  accept a _stream_ of requests, the web form allows the user to define multiple messages in
  the stream."
- [E7] Postman, "Your first gRPC request → About gRPC API requests"
  (https://learning.postman.com/docs/use/send-requests/protocols/grpc/first-grpc-request/):
  "Unary — the traditional request-response communication pattern…", "Client streaming — The
  client sends a series of messages to the server and the server returns a response after
  processing them.", "Server streaming — The client makes a single request and the server
  returns a response with a stream of messages.", "Bidirectional streaming — The client and
  server communicate with each other asynchronously over a persistent session."
- [E8] pseudomuto/protoc-gen-doc `resources/markdown.tmpl`: `| {{.Name}} |
  [{{.RequestLongType}}](#{{.RequestFullType | anchor}}){{if .RequestStreaming}} stream{{end}} |
  [{{.ResponseLongType}}](#{{.ResponseFullType | anchor}}){{if .ResponseStreaming}} stream{{end}}
  | {{nobr .Description}} |`.
- [E9] protocolbuffers/protobuf `src/google/protobuf/descriptor.proto` (main):
  `message MethodDescriptorProto { … // Identifies if client streams multiple client messages
  optional bool client_streaming = 5 [default = false]; // Identifies if server streams multiple
  server messages optional bool server_streaming = 6 [default = false]; }`.
- [E10] pkg.go.dev `google.golang.org/protobuf/reflect/protoreflect#MethodDescriptor`:
  `Input() MessageDescriptor`, `Output() MessageDescriptor`, `// IsStreamingClient reports
  whether the client streams multiple messages. IsStreamingClient() bool`, `IsStreamingServer()
  bool`; `MessageDescriptor` lists no streaming method.
- [E11] docs.rs prost-reflect `MethodDescriptor`: `pub fn is_client_streaming(&self) -> bool`
  "Returns `true` if the client streams multiple messages."; `is_server_streaming`; `input()` /
  `output()` "Gets the `MessageDescriptor` for the input/output type of this method." Used at
  `crates/handshaker-core/src/grpc/invoke/mod.rs:130`.
- [E12] pseudomuto/protoc-gen-doc `template.go`: `type ServiceMethod struct { … RequestStreaming
  bool … ResponseStreaming bool … }`; `type Message struct` has no streaming field.
- [E13] grpc-java `api/src/main/java/io/grpc/MethodDescriptor.java`: `enum MethodType { /** One
  request message followed by one response message. */ UNARY, /** Zero or more request messages
  with one response message. */ CLIENT_STREAMING, /** One request message followed by zero or
  more response messages. */ SERVER_STREAMING, /** Zero or more request and response messages
  arbitrarily interleaved in time. */ BIDI_STREAMING, UNKNOWN }`; `clientSendsOneMessage()`
  "Returns true for UNARY and SERVER_STREAMING, which do not permit the client to stream."
- [E14] grpc-node `packages/grpc-js/src/make-client.ts` L33-43 (`requestStream: boolean;
  responseStream: boolean;` on the method definition) and L145-152 (`if (attrs.requestStream) {
  if (attrs.responseStream) { … } … }` selecting the call constructor).
- [E15] grpc-go `server.go` (master, 1.86.0-dev): `handleStream` L1592-1608 — `srv, knownService
  := s.services[service]; if knownService { if sd, ok := srv.streams[method]; ok {
  s.processRPC(ctx, stream, srv, sd, ti); return } }` … `errDesc = fmt.Sprintf("unknown service
  %v", service)` / `fmt.Sprintf("unknown method %v for service %v", method, service)` (returned
  as `codes.Unimplemented`); `register` L809-815 registers each unary `MethodDesc` as
  `&StreamDesc{StreamName: d.MethodName, Handler: s.wrapUnaryHandler(d), ServerStreams: false,
  ClientStreams: false}`; `wrapUnaryHandler` L1279-1289 ("allowing Unary RPCs to be processed
  via the same unified pipeline as Streaming RPCs").
- [E16] grpc-go `stream.go`: `serverStream.RecvMsg` L1957-1968 — `if ss.desc.ClientStreams {
  return nil } // Special handling for non-client-stream rpcs. … return
  status.Error(codes.Internal, "cardinality violation: received multiple request messages for
  non-client-streaming RPC")`; L1927-1929 `"cardinality violation: received no request message
  from non-client-streaming RPC"`; `clientStreamWrapper.RecvMsg` L216-222 `"cardinality
  violation: expected <EOF> for non server-streaming RPCs, but received another message"`;
  `csAttempt.recvMsg` L1290-1292 `"cardinality violation: received no response message from
  non-server-streaming RPC"` — all `codes.Internal`.
- [E17] grpc-java `stub/src/main/java/io/grpc/stub/ServerCalls.java`: L37/39 `static final
  String TOO_MANY_REQUESTS = "Too many requests"; … MISSING_REQUEST = "Half-closed without a
  request";`; L126-128 `Preconditions.checkArgument(call.getMethodDescriptor().getType()
  .clientSendsOneMessage(), "asyncUnaryRequestCall is only for clientSendsOneMessage methods");`;
  L131-134 "We expect only 1 request, but we ask for 2 requests here so that if a misbehaving
  client sends more than 1 requests, ServerCall will catch it. … call.request(2);"; L155-160
  `call.close(Status.INTERNAL.withDescription(TOO_MANY_REQUESTS), new Metadata())`; L174-178
  `Status.INTERNAL.withDescription(MISSING_REQUEST)`; L469-471 `Status.UNIMPLEMENTED
  .withDescription(String.format("Method %s is unimplemented", …))`.
- [E18] tonic 0.14.6 `src/server/grpc.rs`: `unary` (L219) and `server_streaming` (L262) both
  call `self.map_request_unary(req)` (L234, L278); `map_request_unary` L364-395: `let message =
  stream.try_next().await?.ok_or_else(|| Status::internal("Missing request message."))?; …
  if let Some(trailers) = stream.trailers().await? { req.metadata_mut().merge(trailers); }`.
- [E19] tonic 0.14.6 `src/codec/decode.rs` `Streaming::trailers` L361-379: "// To fetch the
  trailers we must clear the body and drop it. `while self.message().await?.is_some() {}`".
- [E20] grpc-java `stub/src/main/java/io/grpc/stub/ClientCalls.java`: L561-565 `if
  (firstResponseReceived && !adapter.streamingResponse) { throw Status.INTERNAL
  .withDescription("More than one responses received for unary or client-streaming call")
  .asRuntimeException(); }`; L620 `Status.INTERNAL.withDescription("More than one value received
  for unary call")`; L633 `"No value received for unary call"`. No `getType()` check in
  `blockingUnaryCall` / `asyncUnaryRequestCall`.
- [E21] grpc-node `packages/grpc-js/src/client.ts` (1.13.4): `makeUnaryRequest` L285-286
  `requestStream: false, responseStream: false,`; L331-334 `onReceiveMessage(message) { if
  (responseMessage !== null) { call.cancelWithStatus(Status.UNIMPLEMENTED, 'Too many responses
  received'); } responseMessage = message; }` (same at L466 for `makeClientStreamRequest`).
- [E22] tonic 0.14.6 `src/client/grpc.rs` `client_streaming` L226-260: `.try_next()` (L247) …
  `.ok_or_else(|| Status::internal("Missing response message."))?` (L253) … `if let
  Some(trailers) = body.trailers().await? {` (L255); `unary` is `client_streaming` over
  `tokio_stream::once` (see `tonic-dynamic-streaming.md` [E1]).
- [E23] grpc/grpc `doc/statuscodes.md`: "Only a subset of the pre-defined status codes are
  generated by the gRPC libraries."; rows "Method not found at server | UNIMPLEMENTED | Server",
  "Request cardinality violation (method requires exactly one request but client sent some other
  number of requests) | UNIMPLEMENTED | Server", "Response cardinality violation (method requires
  exactly one response but server sent some other number of responses) | UNIMPLEMENTED | Client".
- [E24] grpc-go `codes/codes.go`: `Unimplemented` — "This error code will be generated by the
  gRPC framework. Most commonly, you will see this error code when a method implementation is
  missing on the server. It can also be generated for unknown compression algorithms or a
  disagreement as to whether an RPC should be streaming."; `Internal` — "Means some invariants
  expected by underlying system has been broken."; `FailedPrecondition` — "This error code will
  not be generated by the gRPC framework."
- [E25] grpc-go `call.go`: `func (cc *ClientConn) Invoke(ctx, method string, args, reply any,
  opts …) error { … return invoke(ctx, method, args, reply, cc, opts...) }`; `func invoke(…) {
  cs, err := newClientStream(ctx, unaryStreamDesc, cc, method, opts...) … cs.SendMsg(req) …
  cs.RecvMsg(reply) }`; `var unaryStreamDesc = &StreamDesc{ServerStreams: false, ClientStreams:
  false}`.
- [E26] BurntSushi, "Error Handling in Rust" as published in the Rust Book first edition
  (https://doc.rust-lang.org/1.30.0/book/first-edition/error-handling.html; original
  https://burntsushi.net/rust-error-handling/ — same text): "Defining your own error type",
  "Error handling with `Box<Error>`" ("the `Box<Error>` type is _opaque_ … the caller can't
  (easily) inspect underlying error type"), "Advice for library writers" — quotes in Q3(c).
- [E27] `std::io::ErrorKind` docs (https://doc.rust-lang.org/std/io/enum.ErrorKind.html):
  enum doc, `Other` variant doc — quotes in Q3(c); the enum is `#[non_exhaustive]`.
- [E28] Rust API Guidelines, C-GOOD-ERR
  (https://rust-lang.github.io/api-guidelines/interoperability.html#c-good-err): "Error types
  are meaningful and well-behaved"; messages "lowercase without trailing punctuation"; the rule
  is about `Error`/`Send`/`Sync` and a meaningful crate-specific type, not about enum shape.
- [E29] Yoshua Wuyts, "Error Handling Survey" (https://blog.yoshuawuyts.com/error-handling-survey/):
  "libraries can roughly be divided into two categories: dynamic errors and structured errors.
  This split is best evidenced in the sibling libraries of `anyhow`, and `thiserror`."
- [E30] Repo: `src/features/workflow/netDiagnostics.ts` L63-88 (`faultFromIpcError` switches on
  `e.type` for Transport / DeadlineExceeded / Cancelled / EncodeRequest / DecodeResponse / Auth;
  the `default` arm at L86 maps every other variant — `NotImplemented`, `ReflectionDisabled`,
  `MethodNotFound`, … — to `kind: "other"` with `ipcErrorMessage(e)`, which only surfaces
  `message`/`hint` text);
  `src/features/response/ClientErrorView.tsx:24` (`other: { title: "Request failed" }`);
  `src-tauri/src/ipc/error.rs` L31-50 (`ReflectionDisabled { hint }`, `MethodNotFound { service,
  method }`, `NotImplemented { message }`); `crates/handshaker-core/src/error.rs:40-41`.
- [E31] NN/g, "Error-Message Guidelines" (https://www.nngroup.com/articles/error-message-guidelines/):
  guidelines 5 "Use human-readable language", 6 "Concisely and precisely describe the issue", 7
  "Offer constructive advice", 12 "Concisely educate on how the system works".
- [E32] Microsoft, "Error Messages (Windows 7 UX guide)"
  (https://learn.microsoft.com/en-us/windows/win32/uxguide/mess-error): "Effective error
  messages inform users that a problem occurred, explain why it happened, and provide a solution
  so users can fix the problem."; "The characteristics of good error messages" list (A problem /
  A cause / A solution; Relevant, Actionable, User-centered, Brief, Clear, Specific, Courteous,
  Rare); "Handling unknown errors … it is better to be up front about the lack of information";
  "do provide specific, actionable information if it is likely to be helpful most of the time";
  "Don't provide a solution if it can be trivially deduced from the problem statement."
- [E33] Apple HIG, "Alerts" (https://developer.apple.com/design/human-interface-guidelines/alerts):
  "Write a title that clearly and succinctly describes the situation. … As much as possible,
  describe what happened, the context in which it happened, and why. Avoid writing a title that
  doesn't convey useful information — like 'Error' or 'Error 329347 occurred'"; "Avoid using an
  alert merely to provide information … when a server connection is unavailable, Mail displays
  an indicator that people can choose to learn more."

## Unconfirmed

- **Postman's visual marker for the method kind** (badge/icon in the method selector) — the
  docs name the four kinds but never describe the UI marker; not verified live.
- **grpcurl's own pre-send kind check**: grpcurl chooses the invocation path from the
  descriptor (`InvokeRPC` in `invoke.go`) — inferred from its being a dynamic client; the
  function was not read in this pass.
- **grpc-go `processRPC` unification** is recent (master shows one `processRPC` +
  `wrapUnaryHandler`; older releases had separate `processUnaryRPC` / `processStreamingRPC`
  as the ticket assumes). The observable behaviour (dispatch by name, `Internal` cardinality
  errors) is the same in both shapes, but line numbers above are master-only.
- **tonic's silent drain** was read from the vendored 0.14.6 source; whether a later tonic
  adds a cardinality check was not researched.
- **grpc-java/grpc-node versions** are the master snapshot at read time (`1.85.0-SNAPSHOT`,
  `1.13.4`); the quoted strings have been stable for years but were not checked per release.
- **BurntSushi's site** (`burntsushi.net`) timed out / was blocked; quotes are from the
  identical text in the Rust Book first edition, which he authored.
