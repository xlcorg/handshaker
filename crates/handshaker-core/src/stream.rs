//! **Stream call** — the long-lived half of the Send spine (ADR-0002).
//!
//! [`Sender::open_stream`](crate::send::Sender::open_stream) runs the shared prefix
//! (resolve → builtins → auth → activate) and hands the connection to
//! [`spawn_stream_call`], which owns the wire call in a spawned task and returns a
//! [`StreamCall`] handle. The handle carries the **Stream store** (every inbound and
//! outbound message as raw encoded bytes, one 1-based numbering, no cap), the outbound
//! side of a client-streaming / bidi call (**Send message**, **Half-close**) and the
//! cancel switch; a [`StreamRegistry`] keyed by `request_id` owns the handles for the
//! calling layer.
//!
//! Events reach the caller through one callback ([`StreamEvents`]) in this order:
//! `Opened` → `Headers` → `Message`* → `End` | `Fault`. Outbound messages are not events —
//! they enter the timeline from the [`StreamCall::send_message`] ack. **Cancel is not an
//! event**: after [`StreamCall::cancel`] nothing more is emitted and the inbound stream is
//! dropped, which resets the h2 stream on the wire.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use bytes::Bytes;
use futures_util::StreamExt as _;
use prost_reflect::{DynamicMessage, MessageDescriptor};
use tokio::sync::{mpsc, Notify};

use crate::auth::{OAuth2ClientCredentialsConfig, SavedAuthConfig, TokenSource};
use crate::collections::Collection;
use crate::env::Environment;
use crate::error::CoreError;
use crate::grpc::invoke::{message_to_json, message_to_json_value, CallOptions, StatusDetail};
use crate::grpc::transport::{OutboundStream, TonicChannel};
use crate::grpc::GrpcTransport;
use crate::vars::builtins::BuiltinGenerator;

pub mod assemble;

pub use assemble::AssembleResult;

/// gRPC status 2 — used when the inbound stream ends without any status at all.
const GRPC_UNKNOWN: i32 = 2;

/// `Message.preview` keeps at most this many chars of the compact JSON.
pub const PREVIEW_CHARS: usize = 200;
/// `Message.json` is inlined only for messages up to this raw size; larger bodies are
/// fetched from the Stream store on demand.
pub const INLINE_JSON_MAX_BYTES: u64 = 64 * 1024;
/// Bound of the outbound channel of a client-streaming / bidi call. One slot: a Send
/// message is acked once the transport has taken the previous one — "accepted by the
/// transport", not "buffered somewhere".
pub const OUTBOUND_CAPACITY: usize = 1;

/// **Method kind** — how many messages flow each way. Derived from the method
/// descriptor ([`MethodKind::of`]); the UI passes the kind it chose into `open_stream`
/// and core refuses any difference (`CoreError::MethodKindMismatch`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MethodKind {
    Unary,
    Server,
    Client,
    Bidi,
}

impl MethodKind {
    /// The kind the contract declares: `client_streaming` / `server_streaming` of the
    /// method descriptor.
    pub fn of(m: &prost_reflect::MethodDescriptor) -> Self {
        match (m.is_client_streaming(), m.is_server_streaming()) {
            (false, false) => MethodKind::Unary,
            (false, true) => MethodKind::Server,
            (true, false) => MethodKind::Client,
            (true, true) => MethodKind::Bidi,
        }
    }

    /// Wire / log spelling — the same four tokens the IPC layer serializes.
    pub fn as_str(self) -> &'static str {
        match self {
            MethodKind::Unary => "unary",
            MethodKind::Server => "server",
            MethodKind::Client => "client",
            MethodKind::Bidi => "bidi",
        }
    }
}

impl std::fmt::Display for MethodKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Which way a stored message went.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    /// Received from the server (`←`).
    Inbound,
    /// Sent by a **Send message** (`→`).
    Outbound,
}

/// Events of one stream call, in emission order. Terminal = `End` or `Fault`.
#[derive(Debug)]
pub enum StreamEvent {
    /// Activate done, call in flight. `auth_used` is the winning config in template
    /// form (secrets never materialized here); `bytes_fields` = **Assemble** candidates of
    /// the response type ([`assemble::bytes_fields`]), so the UI can build its menu before
    /// the stream ends.
    Opened {
        kind: MethodKind,
        auth_used: Option<SavedAuthConfig>,
        tls_used: bool,
        bytes_fields: Vec<String>,
    },
    /// **Stream start** — the server's initial metadata.
    Headers { metadata: HashMap<String, String> },
    /// One **inbound message**. `index` is its 1-based ordinal in the numbering shared
    /// with outbound messages; `json` is inline only when
    /// `size_bytes <= INLINE_JSON_MAX_BYTES`.
    Message {
        index: u32,
        /// Epoch milliseconds when the message was received.
        at_ms: u64,
        size_bytes: u64,
        preview: String,
        json: Option<String>,
    },
    /// **Stream end** — the unary outcome minus the body, plus inbound totals. A non-OK
    /// status mid-stream is the same `End`; received messages stay in the store.
    End {
        status_code: i32,
        status_message: String,
        status_details: Vec<StatusDetail>,
        trailing_metadata: HashMap<String, String>,
        elapsed_ms: u64,
        message_count: u32,
        total_bytes: u64,
    },
    /// Client-side termination after `Opened` (phase-2 deadline, decode failure,
    /// transport refusal). The store keeps whatever arrived.
    Fault { error: CoreError },
}

/// Event sink of one call — same shape as `tauri::ipc::Channel::new`'s callback.
pub type StreamEvents = Arc<dyn Fn(StreamEvent) + Send + Sync>;

/// The **Send message** ack: the same meta an inbound `Message` carries plus the
/// resolved pretty JSON that went on the wire. `index` is the row's 1-based ordinal in
/// the numbering shared with inbound messages.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutboundMessage {
    pub index: u32,
    /// Epoch milliseconds when the transport accepted the message.
    pub at_ms: u64,
    pub size_bytes: u64,
    pub preview: String,
    pub json: String,
}

/// Everything the spawned task needs. Built by `Sender::open_stream` after the shared
/// prefix succeeded.
pub(crate) struct StreamCallSpec {
    pub transport: Arc<dyn GrpcTransport>,
    pub channel: TonicChannel,
    pub method_path: String,
    pub input_desc: MessageDescriptor,
    pub output_desc: MessageDescriptor,
    /// What feeds the wire: `once(body)` for server-streaming (half-closed at once), a
    /// channel for client/bidi whose sender is `outbound_tx`.
    pub outbound: OutboundStream,
    /// The **Send message** side of a client/bidi call; `None` = the call is half-closed
    /// from the start (server-streaming).
    pub outbound_tx: Option<mpsc::Sender<Bytes>>,
    pub metadata: HashMap<String, String>,
    pub opts: CallOptions,
    pub kind: MethodKind,
    pub tokens: Arc<dyn TokenSource>,
    pub invalidate_oauth: Option<OAuth2ClientCredentialsConfig>,
    pub builtins: Arc<dyn BuiltinGenerator + Send + Sync>,
    pub events: StreamEvents,
}

/// One row of the **Stream store**: raw encoded bytes plus the direction that decides
/// which descriptor decodes them.
struct StoredMessage {
    direction: Direction,
    bytes: Bytes,
}

type Store = Arc<Mutex<Vec<StoredMessage>>>;

/// Append a row and return its 1-based index — the single place the shared numbering
/// is assigned, for both directions.
fn store_push(store: &Store, direction: Direction, bytes: Bytes) -> u32 {
    let mut rows = store.lock().expect("stream store poisoned");
    rows.push(StoredMessage { direction, bytes });
    rows.len() as u32
}

/// The outbound side of a call plus its terminal switch, shared by the handle and the call
/// body so **Send message** fails deterministically the moment the call is over.
struct Outbound {
    /// The sender while Send message can be accepted; `take()`n by **Half-close**
    /// (dropping the last sender ends the request stream = half-close on the wire) and by
    /// the call body on every exit. `None` from the start for server-streaming.
    tx: Mutex<Option<mpsc::Sender<Bytes>>>,
    /// Set once the call body has exited (End, Fault, cancel, abort).
    terminated: AtomicBool,
    /// `notify_waiters` at termination — wakes every `send_message` parked on `reserve`.
    terminal: Notify,
}

impl Outbound {
    fn new(tx: Option<mpsc::Sender<Bytes>>) -> Self {
        Self { tx: Mutex::new(tx), terminated: AtomicBool::new(false), terminal: Notify::new() }
    }

    fn take(&self) -> Option<mpsc::Sender<Bytes>> {
        self.tx.lock().expect("outbound side poisoned").take()
    }

    fn is_terminated(&self) -> bool {
        self.terminated.load(Ordering::SeqCst)
    }

    /// Terminal: drop the sender (a parked `reserve` would otherwise keep the channel
    /// alive) and wake whoever is parked, in that order — the flag is visible before the
    /// wake, so a waiter that re-checks it never sees "still open".
    fn terminate(&self) {
        drop(self.take());
        self.terminated.store(true, Ordering::SeqCst);
        self.terminal.notify_waiters();
    }
}

/// Runs [`Outbound::terminate`] when the call body exits — on return and on abort alike.
struct TerminateOnExit(Arc<Outbound>);

impl Drop for TerminateOnExit {
    fn drop(&mut self) {
        self.0.terminate();
    }
}

/// Actor-style handle of one open (or finished) stream call. Dropping it aborts a
/// still-running call (safety net); the store lives as long as the handle.
pub struct StreamCall {
    /// The registry id this call is known by — stamped by [`StreamRegistry::insert`]
    /// (empty for a handle that was never registered); named in `StreamClosed`.
    request_id: String,
    kind: MethodKind,
    cancelled: Arc<AtomicBool>,
    cancel: Arc<Notify>,
    store: Store,
    /// Request type of the method — encodes outbound messages, decodes stored `→` rows.
    input_desc: MessageDescriptor,
    /// Response type of the method — decodes stored `←` rows on demand (`message_json`).
    output_desc: MessageDescriptor,
    /// Fresh `{{$builtin}}` values per **Send message**.
    builtins: Arc<dyn BuiltinGenerator + Send + Sync>,
    /// The outbound side + terminal switch, shared with the call body.
    outbound: Arc<Outbound>,
    /// Fired by half-close — arms the phase-2 deadline in the call body.
    half_closed: Arc<Notify>,
    task: tokio::task::JoinHandle<()>,
}

impl StreamCall {
    pub fn kind(&self) -> MethodKind {
        self.kind
    }

    /// The id the registry knows this call by (empty when never registered).
    pub fn request_id(&self) -> &str {
        &self.request_id
    }

    /// **Cancel**: client-side terminal state. Received messages are kept, no status is
    /// synthesized, no further event is emitted; the inbound stream is dropped (RST on
    /// the wire). Never invalidates the OAuth token. Idempotent.
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        self.cancel.notify_one();
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    /// **Send message**: resolve the body template against the vars of this moment
    /// (`{{var}}` through the same accumulator as Open, then fresh built-ins), parse and
    /// encode it with the method's input type, hand it to the transport and record it in
    /// the Stream store under the next shared index. Auth and metadata are *not*
    /// re-materialized — they went out at Open.
    ///
    /// The `await` is the bounded outbound channel: the ack means the transport has
    /// accepted the message (it may go out before any headers arrive). The row is stored
    /// only once accepted, so the store never holds a message the wire never saw. A send
    /// parked on a full channel when the call ends (End / Fault / cancel) fails at once.
    /// `Err(StreamClosed)` when the outbound side is gone — half-closed, ended, cancelled
    /// — never a silent drop; `ResolveFailed` / `EncodeRequest` leave the stream open.
    pub async fn send_message(
        &self,
        body_template: &str,
        collection: Option<&Collection>,
        active_env: Option<&Environment>,
    ) -> Result<OutboundMessage, CoreError> {
        let tx = self.open_outbound()?;

        let body_json = crate::send::expand_body(body_template, collection, active_env, self.builtins.as_ref())?;
        let (msg, bytes) = crate::send::encode_body(&self.input_desc, &body_json)?;
        let json = message_to_json(&msg, true)?;
        let preview = truncate_chars(&message_to_json(&msg, false)?, PREVIEW_CHARS);

        // Race the slot against the call's end. The `Notified` is armed before the flag
        // check so a termination between the two still wakes it (tokio's documented
        // `enable` pattern); a closed receiver is the closed side too.
        let terminal = self.outbound.terminal.notified();
        tokio::pin!(terminal);
        terminal.as_mut().enable();
        if self.outbound.is_terminated() {
            return Err(self.closed());
        }
        let permit = tokio::select! {
            biased;
            _ = &mut terminal => return Err(self.closed()),
            r = tx.reserve() => r.map_err(|_| self.closed())?,
        };
        if self.is_cancelled() || self.outbound.is_terminated() {
            return Err(self.closed());
        }
        let size_bytes = bytes.len() as u64;
        let index = store_push(&self.store, Direction::Outbound, bytes.clone());
        permit.send(bytes);
        Ok(OutboundMessage { index, at_ms: epoch_ms(), size_bytes, preview, json })
    }

    /// **Half-close**: end the outbound side — the request stream ends on the wire, Send
    /// message is refused from here, and the phase-2 deadline (half-close → stream start)
    /// starts if the server has not answered yet. Idempotent; a no-op on a
    /// server-streaming call (half-closed at Open).
    pub fn half_close(&self) -> Result<(), CoreError> {
        drop(self.outbound.take());
        self.half_closed.notify_one();
        Ok(())
    }

    /// `true` while a **Send message** can still be accepted (client/bidi, not yet
    /// half-closed, call still running).
    pub fn is_writable(&self) -> bool {
        self.open_outbound().is_ok()
    }

    fn open_outbound(&self) -> Result<mpsc::Sender<Bytes>, CoreError> {
        if self.is_cancelled() || self.outbound.is_terminated() {
            return Err(self.closed());
        }
        self.outbound
            .tx
            .lock()
            .expect("outbound side poisoned")
            .clone()
            .ok_or_else(|| self.closed())
    }

    fn closed(&self) -> CoreError {
        CoreError::StreamClosed { request_id: self.request_id.clone() }
    }

    /// The **inbound** half of the Stream store: every received message so far, raw
    /// encoded, in arrival order.
    pub fn inbound(&self) -> Vec<Bytes> {
        self.store
            .lock()
            .expect("stream store poisoned")
            .iter()
            .filter(|m| m.direction == Direction::Inbound)
            .map(|m| m.bytes.clone())
            .collect()
    }

    /// Rows in the Stream store, both directions (= the last assigned index).
    pub fn message_count(&self) -> usize {
        self.store.lock().expect("stream store poisoned").len()
    }

    /// Full pretty proto3-JSON of message `index` (1-based, the timeline ordinal shared
    /// by both directions), decoded lazily from the Stream store with the descriptor of
    /// its direction. `Ok(None)` when there is no such row; `Err` only when the stored
    /// bytes do not decode.
    pub fn message_json(&self, index: u32) -> Result<Option<String>, CoreError> {
        let (direction, bytes) = {
            let store = self.store.lock().expect("stream store poisoned");
            match index.checked_sub(1).and_then(|i| store.get(i as usize)) {
                Some(m) => (m.direction, m.bytes.clone()),
                None => return Ok(None),
            }
        };
        let desc = match direction {
            Direction::Inbound => self.output_desc.clone(),
            Direction::Outbound => self.input_desc.clone(),
        };
        let msg = decode_row(&desc, bytes)?;
        message_to_json(&msg, true).map(Some)
    }

    /// **Save messages**: every inbound message of the Stream store as one pretty JSON
    /// array, oldest first (proto3 JSON, proto field names, defaults emitted — the same
    /// mapping as a row's body). Outbound rows are not included. `[]` when nothing
    /// arrived.
    pub fn save_messages(&self) -> Result<String, CoreError> {
        let mut items = Vec::new();
        for raw in self.inbound() {
            let msg = decode_row(&self.output_desc, raw)?;
            items.push(message_to_json_value(&msg)?);
        }
        serde_json::to_string_pretty(&serde_json::Value::Array(items))
            .map_err(|e| CoreError::DecodeResponse(e.to_string()))
    }

    /// **Assemble**: write the `field_path` `bytes` of every inbound message, in receive
    /// order, to `sink` one message at a time (see [`assemble::assemble`]). Available in
    /// any state — the caller offers it only once the call is terminal. `field_path` must
    /// be one of the `Opened.bytes_fields`, else [`CoreError::StreamFieldNotFound`].
    pub fn assemble(&self, field_path: &str, sink: &mut dyn std::io::Write) -> Result<AssembleResult, CoreError> {
        let chain = self.chain(field_path)?;
        assemble::assemble(&self.output_desc, self.inbound(), &chain, sink)
    }

    /// Default Save-As name of an assembly of `field_path` (see [`assemble::default_name`]);
    /// `stamp` is the caller's local timestamp for the `stream-<stamp>.<ext>` fallback.
    pub fn default_name(&self, field_path: &str, stamp: &str) -> Result<String, CoreError> {
        let chain = self.chain(field_path)?;
        assemble::default_name(&self.output_desc, self.inbound(), &chain, stamp)
    }

    fn chain(&self, field_path: &str) -> Result<Vec<prost_reflect::FieldDescriptor>, CoreError> {
        assemble::resolve_path(&self.output_desc, field_path).ok_or_else(|| CoreError::StreamFieldNotFound {
            request_id: self.request_id.clone(),
            field_path: field_path.to_string(),
        })
    }

    /// `true` once the call's task has finished (End, Fault or Cancel took effect).
    pub fn is_finished(&self) -> bool {
        self.task.is_finished()
    }
}

impl std::fmt::Debug for StreamCall {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StreamCall")
            .field("kind", &self.kind)
            .field("cancelled", &self.is_cancelled())
            .field("writable", &self.is_writable())
            .field("messages", &self.message_count())
            .finish()
    }
}

impl Drop for StreamCall {
    fn drop(&mut self) {
        self.cancelled.store(true, Ordering::SeqCst);
        self.task.abort();
    }
}

/// `request_id` → live/finished call. The calling layer holds an `Arc` to one registry
/// for the session; a new call under an existing id replaces (and thereby cancels and
/// frees) the old one.
#[derive(Default)]
pub struct StreamRegistry {
    calls: Mutex<HashMap<String, Arc<StreamCall>>>,
}

impl StreamRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a call under `request_id` — the handle takes the id (named in its
    /// `StreamClosed`); an existing call under the same id is dropped (its store freed,
    /// its task aborted if still running).
    pub fn insert(&self, request_id: impl Into<String>, mut call: StreamCall) -> Arc<StreamCall> {
        let request_id = request_id.into();
        call.request_id = request_id.clone();
        let call = Arc::new(call);
        self.calls.lock().expect("stream registry poisoned").insert(request_id, call.clone());
        call
    }

    pub fn get(&self, request_id: &str) -> Option<Arc<StreamCall>> {
        self.calls.lock().expect("stream registry poisoned").get(request_id).cloned()
    }

    /// Full pretty JSON of message `index` of the call under `request_id` (see
    /// [`StreamCall::message_json`]); an unknown id or index is
    /// [`CoreError::StreamMessageNotFound`].
    pub fn message_json(&self, request_id: &str, index: u32) -> Result<String, CoreError> {
        let missing = || CoreError::StreamMessageNotFound { request_id: request_id.to_string(), index };
        let call = self.get(request_id).ok_or_else(missing)?;
        call.message_json(index)?.ok_or_else(missing)
    }

    /// [`StreamCall::send_message`] on the call under `request_id`. An unknown id (not
    /// yet `Opened`, or released) is [`CoreError::StreamClosed`], as is a half-closed,
    /// ended or cancelled call.
    pub async fn send_message(
        &self,
        request_id: &str,
        body_template: &str,
        collection: Option<&Collection>,
        active_env: Option<&Environment>,
    ) -> Result<OutboundMessage, CoreError> {
        let call = self.get(request_id).ok_or_else(|| closed(request_id))?;
        call.send_message(body_template, collection, active_env).await
    }

    /// [`StreamCall::half_close`] on the call under `request_id`; an unknown id is
    /// [`CoreError::StreamClosed`].
    pub fn half_close(&self, request_id: &str) -> Result<(), CoreError> {
        let call = self.get(request_id).ok_or_else(|| closed(request_id))?;
        call.half_close()
    }

    /// [`StreamCall::save_messages`] of the call under `request_id`; an unknown id is
    /// [`CoreError::StreamNotFound`].
    pub fn save_messages(&self, request_id: &str) -> Result<String, CoreError> {
        self.found(request_id)?.save_messages()
    }

    /// [`StreamCall::assemble`] on the call under `request_id`; an unknown id is
    /// [`CoreError::StreamNotFound`], an unknown path [`CoreError::StreamFieldNotFound`].
    pub fn assemble(
        &self,
        request_id: &str,
        field_path: &str,
        sink: &mut dyn std::io::Write,
    ) -> Result<AssembleResult, CoreError> {
        self.found(request_id)?.assemble(field_path, sink)
    }

    /// [`StreamCall::default_name`] of the call under `request_id`.
    pub fn default_name(&self, request_id: &str, field_path: &str, stamp: &str) -> Result<String, CoreError> {
        self.found(request_id)?.default_name(field_path, stamp)
    }

    fn found(&self, request_id: &str) -> Result<Arc<StreamCall>, CoreError> {
        self.get(request_id).ok_or_else(|| CoreError::StreamNotFound { request_id: request_id.to_string() })
    }

    /// Cancel the call under `request_id`; `false` if unknown. The handle stays
    /// registered so its store survives until `release`.
    pub fn cancel(&self, request_id: &str) -> bool {
        match self.get(request_id) {
            Some(call) => {
                call.cancel();
                true
            }
            None => false,
        }
    }

    /// Free the store (and abort a still-running call); `false` if unknown.
    pub fn release(&self, request_id: &str) -> bool {
        self.calls.lock().expect("stream registry poisoned").remove(request_id).is_some()
    }

    /// `release`, but only when the registered handle is exactly `call` — a later call
    /// that reused the id stays. `false` when the slot holds nothing or something else.
    pub fn release_call(&self, request_id: &str, call: &Arc<StreamCall>) -> bool {
        let mut calls = self.calls.lock().expect("stream registry poisoned");
        if calls.get(request_id).is_some_and(|c| Arc::ptr_eq(c, call)) {
            calls.remove(request_id);
            true
        } else {
            false
        }
    }

    pub fn len(&self) -> usize {
        self.calls.lock().expect("stream registry poisoned").len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

fn closed(request_id: &str) -> CoreError {
    CoreError::StreamClosed { request_id: request_id.to_string() }
}

/// Emit `Opened`, spawn the call body, return the handle. The caller (`open_stream`)
/// resolves here — "return-at-Opened".
pub(crate) fn spawn_stream_call(
    mut spec: StreamCallSpec,
    auth_used: Option<SavedAuthConfig>,
    tls_used: bool,
) -> StreamCall {
    let cancelled = Arc::new(AtomicBool::new(false));
    let cancel = Arc::new(Notify::new());
    let half_closed = Arc::new(Notify::new());
    let store: Store = Arc::new(Mutex::new(Vec::new()));
    let emitter = Emitter { events: spec.events.clone(), cancelled: cancelled.clone() };

    emitter.emit(StreamEvent::Opened {
        kind: spec.kind,
        auth_used,
        tls_used,
        bytes_fields: assemble::bytes_fields(&spec.output_desc),
    });

    let kind = spec.kind;
    let input_desc = spec.input_desc.clone();
    let output_desc = spec.output_desc.clone();
    let builtins = spec.builtins.clone();
    let outbound_tx = spec.outbound_tx.take();
    // No outbound side = half-closed from the start: phase 2 is armed right away.
    if outbound_tx.is_none() {
        half_closed.notify_one();
    }
    let outbound = Arc::new(Outbound::new(outbound_tx));
    let task = tokio::spawn(run(
        spec,
        emitter,
        cancel.clone(),
        half_closed.clone(),
        store.clone(),
        TerminateOnExit(outbound.clone()),
    ));
    StreamCall {
        request_id: String::new(),
        kind,
        cancelled,
        cancel,
        store,
        input_desc,
        output_desc,
        builtins,
        outbound,
        half_closed,
        task,
    }
}

/// Event sink that goes silent once the call is cancelled.
#[derive(Clone)]
struct Emitter {
    events: StreamEvents,
    cancelled: Arc<AtomicBool>,
}

impl Emitter {
    fn emit(&self, ev: StreamEvent) {
        if !self.cancelled.load(Ordering::SeqCst) {
            (self.events)(ev);
        }
    }
}

/// The call body: wait for stream start under the phase-2 deadline (armed by half-close;
/// immediate for server-streaming), then pump inbound messages into the store and the
/// event sink until the stream ends, faults or is cancelled. `_terminate` closes the
/// outbound side on every exit path, abort included.
async fn run(
    spec: StreamCallSpec,
    emitter: Emitter,
    cancel: Arc<Notify>,
    half_closed: Arc<Notify>,
    store: Store,
    _terminate: TerminateOnExit,
) {
    let started = Instant::now();
    let StreamCallSpec {
        transport, channel, method_path, output_desc, outbound, metadata, opts, tokens,
        invalidate_oauth, ..
    } = spec;

    // Phase 2 = half-close → stream start. Between Open and half-close no timer runs:
    // the deadline future only starts counting once `half_closed` fires. Headers that
    // arrive before half-close satisfy phase 2 trivially.
    let deadline = async {
        half_closed.notified().await;
        match opts.phase_timeout {
            Some(d) => {
                tokio::time::sleep(d).await;
                CoreError::DeadlineExceeded { timeout_ms: d.as_millis() as u64 }
            }
            None => std::future::pending().await,
        }
    };
    let start_fut = transport.stream_dynamic(channel, method_path, outbound, metadata, opts);
    let start = tokio::select! {
        biased;
        _ = cancel.notified() => return,
        r = start_fut => r,
        error = deadline => Err(error),
    };
    let start = match start {
        Ok(s) => s,
        Err(error) => {
            emitter.emit(StreamEvent::Fault { error });
            return;
        }
    };
    emitter.emit(StreamEvent::Headers { metadata: start.headers });

    let mut inbound = start.inbound;
    let mut message_count: u32 = 0;
    let mut total_bytes: u64 = 0;
    loop {
        let item = tokio::select! {
            biased;
            // Dropping `inbound` on return is the RST_STREAM.
            _ = cancel.notified() => return,
            item = inbound.next() => item,
        };
        match item {
            Some(Ok(bytes)) => {
                message_count += 1;
                let size_bytes = bytes.len() as u64;
                total_bytes += size_bytes;
                let index = store_push(&store, Direction::Inbound, bytes.clone());
                match describe_message(&output_desc, &bytes) {
                    Ok((preview, json)) => emitter.emit(StreamEvent::Message {
                        index,
                        at_ms: epoch_ms(),
                        size_bytes,
                        preview,
                        json,
                    }),
                    Err(error) => {
                        emitter.emit(StreamEvent::Fault { error });
                        return;
                    }
                }
            }
            Some(Err(end)) => {
                // Rule 16 — the same helper as unary `send`; Cancel never reaches here.
                crate::send::invalidate_on_unauthenticated(
                    tokens.as_ref(),
                    end.status_code,
                    invalidate_oauth.as_ref(),
                );
                emitter.emit(StreamEvent::End {
                    status_code: end.status_code,
                    status_message: end.status_message,
                    status_details: end.status_details,
                    trailing_metadata: end.trailing_metadata,
                    elapsed_ms: started.elapsed().as_millis() as u64,
                    message_count,
                    total_bytes,
                });
                return;
            }
            None => {
                emitter.emit(StreamEvent::End {
                    status_code: GRPC_UNKNOWN,
                    status_message: "stream ended without a gRPC status".into(),
                    status_details: Vec::new(),
                    trailing_metadata: HashMap::new(),
                    elapsed_ms: started.elapsed().as_millis() as u64,
                    message_count,
                    total_bytes,
                });
                return;
            }
        }
    }
}

/// Bound `fut` by the phase timer when one is configured; expiry → `DeadlineExceeded`.
/// Phase 1 (Open → connected) uses it around activate.
pub(crate) async fn with_phase_timeout<T>(
    timeout: Option<Duration>,
    fut: impl std::future::Future<Output = Result<T, CoreError>>,
) -> Result<T, CoreError> {
    match timeout {
        Some(d) => tokio::time::timeout(d, fut).await.unwrap_or_else(|_| {
            Err(CoreError::DeadlineExceeded { timeout_ms: d.as_millis() as u64 })
        }),
        None => fut.await,
    }
}

/// The one decode of a Stream-store row: `bytes` as a message of `desc`
/// (`DecodeResponse` when the stored bytes do not decode). Every reader of the store —
/// the event describer, `message_json`, `save_messages`, Assemble — goes through here.
pub(crate) fn decode_row(desc: &MessageDescriptor, bytes: Bytes) -> Result<DynamicMessage, CoreError> {
    DynamicMessage::decode(desc.clone(), bytes)
        .map_err(|e| CoreError::DecodeResponse(format!("dynamic decode: {e}")))
}

/// Decode one inbound message once and derive its `preview` (compact JSON, cut at
/// `PREVIEW_CHARS`) and inline `json` (pretty, only up to `INLINE_JSON_MAX_BYTES`).
fn describe_message(
    desc: &MessageDescriptor,
    bytes: &Bytes,
) -> Result<(String, Option<String>), CoreError> {
    let msg = decode_row(desc, bytes.clone())?;
    let compact = message_to_json(&msg, false)?;
    let preview = truncate_chars(&compact, PREVIEW_CHARS);
    let json = if bytes.len() as u64 <= INLINE_JSON_MAX_BYTES {
        Some(message_to_json(&msg, true)?)
    } else {
        None
    };
    Ok((preview, json))
}

fn truncate_chars(s: &str, max: usize) -> String {
    match s.char_indices().nth(max) {
        Some((cut, _)) => format!("{}…", &s[..cut]),
        None => s.to_string(),
    }
}

fn epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Arc;
    use std::time::Duration;

    use bytes::Bytes;
    use prost::Message as _;
    use prost_reflect::{DynamicMessage, Value};

    use super::*;
    use crate::collections::SavedRequest;
    use crate::grpc::testing::{chunk_bytes, fixture_pool, FakeTransport, StreamScript};
    use crate::grpc::transport::StreamEnd;
    use crate::send::tests::{
        env_with_sec, oauth_template, seeded_cache, static_tokens, NoBuiltins, RecordingTokens,
        SeqGuids,
    };
    use crate::send::Sender;

    fn stream_request() -> SavedRequest {
        let mut r = crate::send::tests::fixture_request(false);
        r.method = "ServerStream".into();
        r
    }

    fn opts(phase_timeout: Option<Duration>) -> CallOptions {
        CallOptions { max_message_bytes: usize::MAX, phase_timeout }
    }

    fn pong_bytes(id: &str) -> Bytes {
        let desc = fixture_pool().get_message_by_name("test.Pong").unwrap();
        let mut m = DynamicMessage::new(desc);
        m.set_field_by_name("id", Value::String(id.into()));
        Bytes::from(m.encode_to_vec())
    }

    fn decode_ping_id(b: &Bytes) -> String {
        let desc = fixture_pool().get_message_by_name("test.Ping").unwrap();
        let m = DynamicMessage::decode(desc, b.clone()).unwrap();
        m.get_field_by_name("id").unwrap().as_str().unwrap().to_string()
    }

    fn end(code: i32) -> StreamEnd {
        StreamEnd {
            status_code: code,
            status_message: format!("status {code}"),
            status_details: Vec::new(),
            trailing_metadata: HashMap::from([("x-t".to_string(), "1".to_string())]),
        }
    }

    /// Event sink → unbounded channel, so tests await the sequence.
    fn collector() -> (StreamEvents, tokio::sync::mpsc::UnboundedReceiver<StreamEvent>) {
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        let events: StreamEvents = Arc::new(move |ev| {
            let _ = tx.send(ev);
        });
        (events, rx)
    }

    async fn next(rx: &mut tokio::sync::mpsc::UnboundedReceiver<StreamEvent>) -> StreamEvent {
        tokio::time::timeout(Duration::from_secs(5), rx.recv())
            .await
            .expect("event within 5s")
            .expect("sink alive")
    }

    fn scripted(script: StreamScript) -> Arc<FakeTransport> {
        let t = Arc::new(FakeTransport::default());
        *t.stream_script.try_lock().unwrap() = Some(script);
        t
    }

    fn sender(transport: Arc<FakeTransport>, tokens: Arc<dyn TokenSource>) -> Sender {
        Sender::new(transport, tokens, seeded_cache(false), Arc::new(NoBuiltins))
    }

    /// The outbound bytes the fake transport has drained so far, once at least `n` are
    /// there. An ack means the channel accepted the message; the fake's drain task
    /// records it a poll later, hence the wait.
    async fn outbound_at_least(transport: &FakeTransport, n: usize) -> Vec<Bytes> {
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if let Some(v) = transport.last_outbound.lock().await.clone() {
                    if v.len() >= n {
                        return v;
                    }
                }
                tokio::time::sleep(Duration::from_millis(2)).await;
            }
        })
        .await
        .unwrap_or_else(|_| panic!("{n} outbound messages within 5s"))
    }

    #[tokio::test]
    async fn open_stream_composes_the_spine_and_emits_events_in_order_indexed_from_1() {
        let mut request = stream_request();
        request.body_template = r#"{"id":"{{uid}}-{{$guid}}"}"#.into();
        request.auth = oauth_template();
        let mut env = env_with_sec();
        env.variables.insert("uid".into(), "u1".into());

        let transport = scripted(StreamScript {
            headers: HashMap::from([("x-h".to_string(), "hdr".to_string())]),
            items: vec![Ok(pong_bytes("a")), Ok(pong_bytes("b")), Err(end(0))],
            ..Default::default()
        });
        let sender = Sender::new(
            transport.clone(),
            static_tokens("Bearer tok"),
            seeded_cache(false),
            SeqGuids::new(),
        );
        let (events, mut rx) = collector();

        let call = sender
            .open_stream(&request, None, Some(&env), MethodKind::Server, opts(None), events)
            .await
            .expect("open");

        // Opened: kind + auth in template form + tls fact.
        match next(&mut rx).await {
            StreamEvent::Opened { kind, auth_used, tls_used, bytes_fields } => {
                assert_eq!(kind, MethodKind::Server);
                assert_eq!(auth_used, Some(oauth_template()));
                assert!(!tls_used);
                assert!(bytes_fields.is_empty());
            }
            other => panic!("expected Opened, got {other:?}"),
        }
        match next(&mut rx).await {
            StreamEvent::Headers { metadata } => assert_eq!(metadata.get("x-h").unwrap(), "hdr"),
            other => panic!("expected Headers, got {other:?}"),
        }
        for (i, id) in [(1u32, "a"), (2, "b")] {
            match next(&mut rx).await {
                StreamEvent::Message { index, size_bytes, preview, json, at_ms } => {
                    assert_eq!(index, i);
                    assert_eq!(size_bytes, pong_bytes(id).len() as u64);
                    assert_eq!(preview, format!(r#"{{"id":"{id}"}}"#), "compact JSON preview");
                    let pretty = json.expect("small message inlines json");
                    assert!(pretty.contains('\n'), "pretty JSON: {pretty}");
                    assert!(pretty.contains(&format!(r#""id": "{id}""#)), "{pretty}");
                    assert!(at_ms > 1_600_000_000_000, "epoch ms: {at_ms}");
                }
                other => panic!("expected Message #{i}, got {other:?}"),
            }
        }
        match next(&mut rx).await {
            StreamEvent::End { status_code, trailing_metadata, message_count, total_bytes, .. } => {
                assert_eq!(status_code, 0);
                assert_eq!(trailing_metadata.get("x-t").unwrap(), "1");
                assert_eq!(message_count, 2);
                assert_eq!(total_bytes, (pong_bytes("a").len() + pong_bytes("b").len()) as u64);
            }
            other => panic!("expected End, got {other:?}"),
        }

        // Spine composition on the wire: resolved + expanded body, auth header injected.
        assert_eq!(transport.last_path.lock().await.as_deref(), Some("/test.Echo/ServerStream"));
        let outbound = transport.last_outbound.lock().await.clone().unwrap();
        assert_eq!(outbound.len(), 1, "server-streaming sends exactly one message");
        assert_eq!(decode_ping_id(&outbound[0]), "u1-G0");
        let md = transport.last_metadata.lock().await.clone().unwrap();
        assert_eq!(md.get("authorization").map(String::as_str), Some("Bearer tok"));

        // Stream store keeps the raw bytes, in order.
        assert_eq!(call.inbound(), vec![pong_bytes("a"), pong_bytes("b")]);
        assert_eq!(call.kind(), MethodKind::Server);
    }

    #[tokio::test]
    async fn json_is_inline_only_up_to_64kib_and_preview_is_capped() {
        let big = "x".repeat(70 * 1024);
        let transport = scripted(StreamScript {
            items: vec![Ok(pong_bytes(&big)), Err(end(0))],
            ..Default::default()
        });
        let sender = sender(transport, static_tokens("t"));
        let (events, mut rx) = collector();
        let _call = sender
            .open_stream(&stream_request(), None, None, MethodKind::Server, opts(None), events)
            .await
            .expect("open");

        let _opened = next(&mut rx).await;
        let _headers = next(&mut rx).await;
        match next(&mut rx).await {
            StreamEvent::Message { size_bytes, preview, json, .. } => {
                assert!(size_bytes > INLINE_JSON_MAX_BYTES);
                assert!(json.is_none(), "over 64 KiB → json fetched on demand");
                assert_eq!(preview.chars().count(), PREVIEW_CHARS + 1, "200 chars + ellipsis");
                assert!(preview.ends_with('…'));
            }
            other => panic!("expected Message, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn message_json_decodes_a_stored_row_on_demand_and_is_none_past_the_end() {
        let transport = scripted(StreamScript {
            items: vec![Ok(pong_bytes("a")), Ok(pong_bytes("b")), Err(end(0))],
            ..Default::default()
        });
        let sender = sender(transport, static_tokens("t"));
        let (events, mut rx) = collector();
        let call = sender
            .open_stream(&stream_request(), None, None, MethodKind::Server, opts(None), events)
            .await
            .expect("open");
        loop {
            if matches!(next(&mut rx).await, StreamEvent::End { .. }) {
                break;
            }
        }

        // Lazy decode from the store: index is the 1-based timeline ordinal.
        let json = call.message_json(2).expect("decode").expect("row 2 exists");
        assert!(json.contains('\n'), "pretty JSON: {json}");
        assert!(json.contains(r#""id": "b""#), "{json}");
        assert_eq!(call.message_json(1).unwrap().unwrap(), message_to_json(
            &DynamicMessage::decode(fixture_pool().get_message_by_name("test.Pong").unwrap(), pong_bytes("a")).unwrap(),
            true,
        ).unwrap());
        assert!(call.message_json(0).unwrap().is_none(), "indices start at 1");
        assert!(call.message_json(3).unwrap().is_none(), "past the end");

        // Registry lookup names the call and the row in the error.
        let registry = StreamRegistry::new();
        let call = registry.insert("rid", call);
        assert_eq!(registry.message_json("rid", 1).unwrap(), call.message_json(1).unwrap().unwrap());
        assert!(matches!(
            registry.message_json("rid", 9),
            Err(CoreError::StreamMessageNotFound { ref request_id, index: 9 }) if request_id == "rid"
        ));
        assert!(matches!(
            registry.message_json("nope", 1),
            Err(CoreError::StreamMessageNotFound { ref request_id, index: 1 }) if request_id == "nope"
        ));
    }

    #[tokio::test]
    async fn trailers_only_non_ok_is_an_end_with_zero_messages() {
        let transport = scripted(StreamScript { items: vec![Err(end(7))], ..Default::default() });
        let sender = sender(transport, static_tokens("t"));
        let (events, mut rx) = collector();
        let _call = sender
            .open_stream(&stream_request(), None, None, MethodKind::Server, opts(None), events)
            .await
            .expect("open");

        assert!(matches!(next(&mut rx).await, StreamEvent::Opened { .. }));
        assert!(matches!(next(&mut rx).await, StreamEvent::Headers { .. }));
        match next(&mut rx).await {
            StreamEvent::End { status_code, message_count, .. } => {
                assert_eq!(status_code, 7);
                assert_eq!(message_count, 0);
            }
            other => panic!("expected End, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn phase1_deadline_during_activate_is_a_pre_open_err_and_emits_nothing() {
        let transport = scripted(StreamScript::default());
        *transport.channel_delay.lock().await = Some(Duration::from_millis(300));
        let sender = sender(transport.clone(), static_tokens("t"));
        let (events, mut rx) = collector();

        let err = sender
            .open_stream(
                &stream_request(),
                None,
                None,
                MethodKind::Server,
                opts(Some(Duration::from_millis(20))),
                events,
            )
            .await
            .expect_err("activate must time out");

        assert!(matches!(err, CoreError::DeadlineExceeded { timeout_ms: 20 }), "got {err:?}");
        assert!(rx.try_recv().is_err(), "no event before Opened");
        assert_eq!(transport.stream_calls.load(Ordering::Relaxed), 0);
    }

    #[tokio::test]
    async fn phase2_deadline_before_stream_start_is_a_fault_after_opened() {
        let transport = scripted(StreamScript {
            start_delay: Some(Duration::from_millis(300)),
            ..Default::default()
        });
        let sender = sender(transport, static_tokens("t"));
        let (events, mut rx) = collector();
        let _call = sender
            .open_stream(
                &stream_request(),
                None,
                None,
                MethodKind::Server,
                opts(Some(Duration::from_millis(20))),
                events,
            )
            .await
            .expect("open resolves at Opened");

        assert!(matches!(next(&mut rx).await, StreamEvent::Opened { .. }));
        match next(&mut rx).await {
            StreamEvent::Fault { error } => {
                assert!(matches!(error, CoreError::DeadlineExceeded { timeout_ms: 20 }), "{error:?}")
            }
            other => panic!("expected Fault, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn end_status_16_invalidates_exactly_the_resolved_oauth_config() {
        let mut request = stream_request();
        request.auth = oauth_template();
        let env = env_with_sec();
        let transport = scripted(StreamScript {
            items: vec![Ok(pong_bytes("a")), Err(end(16))],
            ..Default::default()
        });
        let tokens = RecordingTokens::new();
        let sender = sender(transport, tokens.clone());
        let (events, mut rx) = collector();
        let _call = sender
            .open_stream(&request, None, Some(&env), MethodKind::Server, opts(None), events)
            .await
            .expect("open");

        loop {
            if let StreamEvent::End { status_code, .. } = next(&mut rx).await {
                assert_eq!(status_code, 16);
                break;
            }
        }
        let invalidated = tokens.invalidated.lock().unwrap().clone();
        assert_eq!(invalidated.len(), 1);
        assert_eq!(invalidated[0].client_secret, "s3cr3t", "resolved config, not the template");
    }

    #[tokio::test]
    async fn cancel_keeps_received_rows_emits_nothing_more_and_never_invalidates() {
        let mut request = stream_request();
        request.auth = oauth_template();
        let env = env_with_sec();
        let transport = scripted(StreamScript {
            items: vec![Ok(pong_bytes("a"))],
            hang: true,
            ..Default::default()
        });
        let tokens = RecordingTokens::new();
        let sender = sender(transport, tokens.clone());
        let (events, mut rx) = collector();
        let call = sender
            .open_stream(&request, None, Some(&env), MethodKind::Server, opts(None), events)
            .await
            .expect("open");

        assert!(matches!(next(&mut rx).await, StreamEvent::Opened { .. }));
        assert!(matches!(next(&mut rx).await, StreamEvent::Headers { .. }));
        assert!(matches!(next(&mut rx).await, StreamEvent::Message { index: 1, .. }));

        call.cancel();
        assert!(call.is_cancelled());
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(call.is_finished(), "task ends on cancel (inbound dropped)");
        assert!(rx.try_recv().is_err(), "cancel is not an event and nothing follows it");
        assert_eq!(call.inbound(), vec![pong_bytes("a")], "received rows stay");
        assert!(tokens.invalidated.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn resolve_failure_is_a_pre_open_err_that_never_touches_the_transport() {
        let mut request = stream_request();
        request.address_template = "{{host}}".into();
        let transport = scripted(StreamScript::default());
        let sender = sender(transport.clone(), static_tokens("t"));
        let (events, mut rx) = collector();

        let err = sender
            .open_stream(&request, None, None, MethodKind::Server, opts(None), events)
            .await
            .expect_err("unresolved var");

        assert!(matches!(err, CoreError::ResolveFailed { .. }), "{err:?}");
        assert!(rx.try_recv().is_err());
        assert_eq!(transport.channel_calls.load(Ordering::Relaxed), 0);
        assert_eq!(transport.stream_calls.load(Ordering::Relaxed), 0);
    }

    #[tokio::test]
    async fn invalid_body_is_a_pre_open_encode_request_err() {
        let mut request = stream_request();
        request.body_template = "not json {".into();
        let transport = scripted(StreamScript::default());
        let sender = sender(transport.clone(), static_tokens("t"));
        let (events, mut rx) = collector();

        let err = sender
            .open_stream(&request, None, None, MethodKind::Server, opts(None), events)
            .await
            .expect_err("bad body");

        assert!(matches!(err, CoreError::EncodeRequest(_)), "{err:?}");
        assert!(rx.try_recv().is_err());
        assert_eq!(transport.stream_calls.load(Ordering::Relaxed), 0);
    }

    #[tokio::test]
    async fn unknown_method_is_a_pre_open_method_not_found() {
        let mut request = stream_request();
        request.method = "Nope".into();
        let transport = scripted(StreamScript::default());
        let sender = sender(transport, static_tokens("t"));
        let (events, _rx) = collector();

        let err = sender
            .open_stream(&request, None, None, MethodKind::Server, opts(None), events)
            .await
            .expect_err("unknown method");
        assert!(matches!(err, CoreError::MethodNotFound { .. }), "{err:?}");
    }

    /// The kind gate on the stream path: `kind` (what the UI chose) vs the descriptor's
    /// kind — any difference is a pre-Open `Err` with the transport untouched, in both
    /// directions incl. server ↔ bidi, `unary` on a streaming method and a streaming kind
    /// on a unary method. `expected` = the caller's kind, `actual` = the descriptor's.
    #[tokio::test]
    async fn open_stream_with_a_kind_other_than_the_descriptors_is_refused_before_the_transport() {
        let cases = [
            ("ServerStream", MethodKind::Bidi, MethodKind::Server),
            ("ServerStream", MethodKind::Client, MethodKind::Server),
            ("ServerStream", MethodKind::Unary, MethodKind::Server),
            ("Bidi", MethodKind::Server, MethodKind::Bidi),
            ("Bidi", MethodKind::Client, MethodKind::Bidi),
            ("ClientStream", MethodKind::Bidi, MethodKind::Client),
            ("ClientStream", MethodKind::Server, MethodKind::Client),
            ("Send", MethodKind::Server, MethodKind::Unary),
            ("Send", MethodKind::Bidi, MethodKind::Unary),
        ];
        for (method, chosen, descriptor) in cases {
            let transport = scripted(StreamScript::default());
            let sender = sender(transport.clone(), static_tokens("t"));
            let (events, mut rx) = collector();
            let mut request = stream_request();
            request.method = method.into();
            let err = sender
                .open_stream(&request, None, None, chosen, opts(None), events)
                .await
                .expect_err("kind mismatch is a pre-Open Err");
            match err {
                CoreError::MethodKindMismatch { service, method: m, expected, actual } => {
                    assert_eq!((service.as_str(), m.as_str()), ("test.Echo", method));
                    assert_eq!((expected, actual), (chosen, descriptor), "{method} as {chosen:?}");
                }
                other => panic!("{method} as {chosen:?}: got {other:?}"),
            }
            assert_eq!(transport.stream_calls.load(Ordering::Relaxed), 0, "{method} as {chosen:?}");
            assert!(rx.try_recv().is_err(), "no event before Opened");
        }
    }

    /// The stream path has no unary shape: `open_stream(Unary)` on a unary method is
    /// refused too — as a mismatch whose `actual` (unary) names the path to take.
    #[tokio::test]
    async fn unary_kind_on_a_unary_method_is_refused_by_open_stream_as_a_mismatch_pointing_at_unary() {
        let transport = scripted(StreamScript::default());
        let sender = sender(transport.clone(), static_tokens("t"));
        let (events, _rx) = collector();
        let mut request = stream_request();
        request.method = "Send".into();
        let err = sender
            .open_stream(&request, None, None, MethodKind::Unary, opts(None), events)
            .await
            .expect_err("unary goes through `send`");
        assert!(
            matches!(err, CoreError::MethodKindMismatch { expected: MethodKind::Unary, actual: MethodKind::Unary, .. }),
            "{err:?}"
        );
        assert_eq!(transport.stream_calls.load(Ordering::Relaxed), 0);
    }

    fn bidi_request() -> SavedRequest {
        let mut r = stream_request();
        r.method = "Bidi".into();
        r.body_template = r#"{"id":"{{who}}"}"#.into();
        r
    }

    fn env_with(name: &str, value: &str) -> crate::env::Environment {
        let mut env = env_with_sec();
        env.variables.insert(name.into(), value.into());
        env
    }

    /// Bidi over the fake: Open sends nothing; every Send message is acked with the next
    /// shared index and echoed back as the following inbound row; Half-close ends the call.
    #[tokio::test]
    async fn bidi_send_message_acks_with_the_shared_index_and_half_close_ends_the_call() {
        let transport = scripted(StreamScript {
            echo: true,
            end_on_half_close: Some(end(0)),
            ..Default::default()
        });
        let sender = sender(transport.clone(), static_tokens("t"));
        let (events, mut rx) = collector();
        let request = bidi_request();
        let mut env = env_with("who", "a");

        let call = sender
            .open_stream(&request, None, Some(&env), MethodKind::Bidi, opts(None), events)
            .await
            .expect("open");
        assert!(matches!(next(&mut rx).await, StreamEvent::Opened { kind: MethodKind::Bidi, .. }));
        assert!(matches!(next(&mut rx).await, StreamEvent::Headers { .. }));
        assert!(transport.last_outbound.lock().await.as_ref().unwrap().is_empty(), "Open sends nothing");

        // → #1, ← #2 (echo)
        let ack = call.send_message(&request.body_template, None, Some(&env)).await.expect("send 1");
        assert_eq!(ack.index, 1);
        assert_eq!(ack.size_bytes, pong_bytes("a").len() as u64);
        assert_eq!(ack.preview, r#"{"id":"a"}"#, "compact resolved preview");
        assert!(ack.json.contains('\n') && ack.json.contains(r#""id": "a""#), "pretty resolved JSON: {}", ack.json);
        assert!(ack.at_ms > 1_600_000_000_000);
        match next(&mut rx).await {
            StreamEvent::Message { index, preview, .. } => {
                assert_eq!(index, 2, "inbound continues the shared numbering");
                assert_eq!(preview, r#"{"id":"a"}"#);
            }
            other => panic!("expected Message #2, got {other:?}"),
        }

        // → #3 with the var changed in between, ← #4
        env.variables.insert("who".into(), "b".into());
        let ack = call.send_message(&request.body_template, None, Some(&env)).await.expect("send 2");
        assert_eq!(ack.index, 3);
        assert_eq!(ack.preview, r#"{"id":"b"}"#, "resolved per message");
        assert!(matches!(next(&mut rx).await, StreamEvent::Message { index: 4, .. }));

        call.half_close().expect("half-close");
        match next(&mut rx).await {
            StreamEvent::End { status_code, message_count, .. } => {
                assert_eq!(status_code, 0);
                assert_eq!(message_count, 2, "End counts inbound rows");
            }
            other => panic!("expected End, got {other:?}"),
        }

        // The wire saw exactly the two encoded messages, in order.
        let outbound = transport.last_outbound.lock().await.clone().unwrap();
        assert_eq!(outbound.iter().map(decode_ping_id).collect::<Vec<_>>(), vec!["a", "b"]);
        // The Stream store holds both directions under one numbering, each decodable.
        assert_eq!(call.message_count(), 4);
        assert_eq!(call.inbound().len(), 2);
        assert!(call.message_json(1).unwrap().unwrap().contains(r#""id": "a""#), "outbound #1");
        assert!(call.message_json(2).unwrap().unwrap().contains(r#""id": "a""#), "inbound #2");
        assert!(call.message_json(3).unwrap().unwrap().contains(r#""id": "b""#), "outbound #3");
        assert!(call.message_json(5).unwrap().is_none());
    }

    fn client_request() -> SavedRequest {
        let mut r = stream_request();
        r.method = "ClientStream".into();
        r.body_template = r#"{"id":"{{who}}"}"#.into();
        r
    }

    /// Client-streaming over the fake, shaped like a server that answers only after the
    /// client's half-close: three sends go out before any headers exist, half-close brings
    /// Headers → the one reply → End.
    #[tokio::test]
    async fn client_stream_sends_before_headers_then_half_close_brings_the_single_reply() {
        let transport = scripted(StreamScript {
            start_after_half_close: true,
            items: vec![Ok(pong_bytes("count: 3"))],
            end_on_half_close: Some(end(0)),
            ..Default::default()
        });
        let sender = sender(transport.clone(), static_tokens("t"));
        let (events, mut rx) = collector();
        let request = client_request();
        let env = env_with("who", "x");

        let call = sender
            .open_stream(&request, None, Some(&env), MethodKind::Client, opts(None), events)
            .await
            .expect("open");
        assert!(matches!(next(&mut rx).await, StreamEvent::Opened { kind: MethodKind::Client, .. }));
        assert!(call.is_writable());

        for i in 1..=3u32 {
            let ack = call.send_message(&request.body_template, None, Some(&env)).await.expect("send");
            assert_eq!(ack.index, i, "→ rows number 1..3 before any inbound");
        }
        assert!(rx.try_recv().is_err(), "no Headers yet — sends never waited for stream start");
        assert_eq!(outbound_at_least(&transport, 3).await.len(), 3, "all three accepted by the transport");

        call.half_close().expect("half-close");
        assert!(!call.is_writable());
        assert!(matches!(next(&mut rx).await, StreamEvent::Headers { .. }));
        match next(&mut rx).await {
            StreamEvent::Message { index, preview, .. } => {
                assert_eq!(index, 4, "the reply continues the shared numbering");
                assert_eq!(preview, r#"{"id":"count: 3"}"#);
            }
            other => panic!("expected Message #4, got {other:?}"),
        }
        match next(&mut rx).await {
            StreamEvent::End { status_code: 0, message_count: 1, .. } => {}
            other => panic!("expected OK End with one inbound row, got {other:?}"),
        }
        assert_eq!(call.message_count(), 4);
    }

    #[tokio::test]
    async fn half_close_with_zero_messages_is_allowed_and_idempotent() {
        let transport = scripted(StreamScript { end_on_half_close: Some(end(0)), ..Default::default() });
        let sender = sender(transport.clone(), static_tokens("t"));
        let (events, mut rx) = collector();
        let env = env_with("who", "a");
        let call = sender
            .open_stream(&client_request(), None, Some(&env), MethodKind::Client, opts(None), events)
            .await
            .expect("open");
        assert!(matches!(next(&mut rx).await, StreamEvent::Opened { .. }));
        assert!(matches!(next(&mut rx).await, StreamEvent::Headers { .. }));

        call.half_close().expect("first half-close");
        call.half_close().expect("second half-close is a no-op");
        assert!(matches!(next(&mut rx).await, StreamEvent::End { status_code: 0, message_count: 0, .. }));
        assert!(transport.last_outbound.lock().await.clone().unwrap_or_default().is_empty());
    }

    /// Never a silent drop: after half-close, after cancel, on a server-streaming call
    /// (half-closed at Open) and for an unknown registry id, Send message is `StreamClosed`.
    #[tokio::test]
    async fn send_message_is_stream_closed_after_half_close_after_cancel_and_for_unknown_ids() {
        let transport = scripted(StreamScript { hang: true, ..Default::default() });
        let sender1 = sender(transport.clone(), static_tokens("t"));
        let (events, mut rx) = collector();
        let request = bidi_request();
        let env = env_with("who", "a");
        let call = sender1
            .open_stream(&request, None, Some(&env), MethodKind::Bidi, opts(None), events)
            .await
            .expect("open");
        assert!(matches!(next(&mut rx).await, StreamEvent::Opened { .. }));
        call.half_close().unwrap();
        let err = call.send_message(&request.body_template, None, Some(&env)).await.unwrap_err();
        assert!(matches!(err, CoreError::StreamClosed { .. }), "after half-close: {err:?}");
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(transport.last_outbound.lock().await.clone().unwrap_or_default().is_empty(), "nothing reached the wire");

        // After cancel.
        let transport2 = scripted(StreamScript { hang: true, ..Default::default() });
        let sender2 = sender(transport2, static_tokens("t"));
        let (events, _rx) = collector();
        let call2 = sender2
            .open_stream(&request, None, Some(&env), MethodKind::Bidi, opts(None), events)
            .await
            .expect("open");
        call2.cancel();
        let err = call2.send_message(&request.body_template, None, Some(&env)).await.unwrap_err();
        assert!(matches!(err, CoreError::StreamClosed { .. }), "after cancel: {err:?}");

        // Server-streaming: half-closed at Open.
        let transport3 = scripted(StreamScript { hang: true, ..Default::default() });
        let sender3 = sender(transport3, static_tokens("t"));
        let (events, _rx) = collector();
        let call3 = sender3
            .open_stream(&stream_request(), None, None, MethodKind::Server, opts(None), events)
            .await
            .expect("open");
        assert!(!call3.is_writable());
        let err = call3.send_message("{}", None, None).await.unwrap_err();
        assert!(matches!(err, CoreError::StreamClosed { .. }), "server kind: {err:?}");
        call3.half_close().expect("no-op on a server-streaming call");

        // Registry: unknown id (never Opened / released) names the id in the error.
        let registry = StreamRegistry::new();
        match registry.send_message("ghost", "{}", None, None).await.unwrap_err() {
            CoreError::StreamClosed { request_id } => assert_eq!(request_id, "ghost"),
            other => panic!("{other:?}"),
        }
        match registry.half_close("ghost").unwrap_err() {
            CoreError::StreamClosed { request_id } => assert_eq!(request_id, "ghost"),
            other => panic!("{other:?}"),
        }
        // A registered but half-closed call reports the registry id, not an empty one.
        let call = registry.insert("rid", call);
        match registry.send_message("rid", &request.body_template, None, Some(&env)).await.unwrap_err() {
            CoreError::StreamClosed { request_id } => assert_eq!(request_id, "rid"),
            other => panic!("{other:?}"),
        }
        drop(call);
    }

    /// Resolve runs per message (vars of the moment, fresh built-ins) while auth is
    /// materialized exactly once — at Open.
    #[tokio::test]
    async fn send_message_resolves_vars_and_builtins_per_message_but_auth_only_at_open() {
        let transport = scripted(StreamScript { hang: true, ..Default::default() });
        let tokens = RecordingTokens::new();
        let sender = Sender::new(transport.clone(), tokens.clone(), seeded_cache(false), SeqGuids::new());
        let (events, mut rx) = collector();
        let mut request = bidi_request();
        request.body_template = r#"{"id":"{{who}}-{{$guid}}"}"#.into();
        request.auth = oauth_template();
        let mut env = env_with("who", "a");

        let call = sender
            .open_stream(&request, None, Some(&env), MethodKind::Bidi, opts(None), events)
            .await
            .expect("open");
        assert!(matches!(next(&mut rx).await, StreamEvent::Opened { .. }));
        assert_eq!(tokens.header_calls.load(Ordering::SeqCst), 1, "materialized at Open");

        let a = call.send_message(&request.body_template, None, Some(&env)).await.expect("send a");
        env.variables.insert("who".into(), "b".into());
        let b = call.send_message(&request.body_template, None, Some(&env)).await.expect("send b");
        // Switching env mid-stream changes the body, never the auth.
        let mut other_env = env_with("who", "c");
        other_env.variables.insert("sec".into(), "other-secret".into());
        let c = call.send_message(&request.body_template, None, Some(&other_env)).await.expect("send c");

        // Open of a two-way call never touches the body (nothing is sent, no built-in is
        // consumed); every Send message resolves and expands afresh.
        assert_eq!(a.preview, r#"{"id":"a-G0"}"#);
        assert_eq!(b.preview, r#"{"id":"b-G1"}"#, "var re-resolved, guid fresh");
        assert_eq!(c.preview, r#"{"id":"c-G2"}"#);
        assert_eq!(tokens.header_calls.load(Ordering::SeqCst), 1, "auth is never re-materialized");
        let outbound = outbound_at_least(&transport, 3).await;
        assert_eq!(outbound.iter().map(decode_ping_id).collect::<Vec<_>>(), vec!["a-G0", "b-G1", "c-G2"]);
        let md = transport.last_metadata.lock().await.clone().unwrap();
        assert_eq!(md.get("authorization").map(String::as_str), Some("Bearer tok"), "initial metadata carries the Open-time header");
    }

    /// "Open sends nothing" — so Open of a client / bidi call does not resolve the body
    /// either: an unresolved body var is a per-message fault (the stream stays open), not
    /// a pre-Open rejection. Server-streaming, which sends the body at Open, keeps it.
    #[tokio::test]
    async fn unresolved_body_var_does_not_block_open_of_a_two_way_call_but_fails_the_send() {
        for kind in [MethodKind::Client, MethodKind::Bidi] {
            let transport = scripted(StreamScript { hang: true, ..Default::default() });
            let sender = sender(transport.clone(), static_tokens("t"));
            let (events, mut rx) = collector();
            // The fixture method must agree with `kind` — the gate refuses any other.
            let mut request = if kind == MethodKind::Client { client_request() } else { bidi_request() };
            request.body_template = r#"{"id":"{{nope}}"}"#.into();
            let env = env_with("who", "a"); // `nope` is nowhere

            let call = sender
                .open_stream(&request, None, Some(&env), kind, opts(None), events)
                .await
                .unwrap_or_else(|e| panic!("{kind:?}: Open must not resolve the body: {e:?}"));
            assert!(matches!(next(&mut rx).await, StreamEvent::Opened { .. }));
            // Stream start = the transport was reached with the call intact.
            assert!(matches!(next(&mut rx).await, StreamEvent::Headers { .. }));
            assert_eq!(transport.stream_calls.load(Ordering::Relaxed), 1);

            let err = call.send_message(&request.body_template, None, Some(&env)).await.unwrap_err();
            match err {
                CoreError::ResolveFailed { unresolved, .. } => assert_eq!(unresolved, vec!["nope"]),
                other => panic!("{kind:?}: expected ResolveFailed, got {other:?}"),
            }
            assert!(call.is_writable(), "{kind:?}: the stream stays open");
            assert!(!call.is_finished());
            assert_eq!(call.message_count(), 0, "a failed send takes no index");
        }

        // Control: server-streaming sends the body at Open, so the same template is a
        // pre-Open `ResolveFailed` reported before any transport use.
        let transport = scripted(StreamScript::default());
        let sender = sender(transport.clone(), static_tokens("t"));
        let (events, _rx) = collector();
        let mut request = stream_request();
        request.body_template = r#"{"id":"{{nope}}"}"#.into();
        let err = sender
            .open_stream(&request, None, None, MethodKind::Server, opts(None), events)
            .await
            .expect_err("server-streaming resolves the body at Open");
        assert!(matches!(err, CoreError::ResolveFailed { .. }), "{err:?}");
        assert_eq!(transport.stream_calls.load(Ordering::Relaxed), 0);
    }

    /// Built-ins in the body are consumed per Send message only; the ones in metadata
    /// values still expand at Open (metadata goes out with the call).
    #[tokio::test]
    async fn body_builtins_are_not_consumed_at_open_of_a_two_way_call() {
        let transport = scripted(StreamScript { hang: true, ..Default::default() });
        let sender = Sender::new(transport.clone(), static_tokens("t"), seeded_cache(false), SeqGuids::new());
        let (events, mut rx) = collector();
        let mut request = client_request();
        request.body_template = r#"{"id":"{{$guid}}"}"#.into();
        request.metadata = vec![crate::collections::MetadataRow {
            key: "x-trace".into(),
            value: "{{$guid}}".into(),
            enabled: true,
        }];

        let call = sender
            .open_stream(&request, None, None, MethodKind::Client, opts(None), events)
            .await
            .expect("open");
        assert!(matches!(next(&mut rx).await, StreamEvent::Opened { .. }));
        assert!(matches!(next(&mut rx).await, StreamEvent::Headers { .. }));
        let md = transport.last_metadata.lock().await.clone().unwrap();
        assert_eq!(md.get("x-trace").map(String::as_str), Some("G0"), "metadata expands at Open");

        let ack = call.send_message(&request.body_template, None, None).await.expect("send");
        assert_eq!(ack.preview, r#"{"id":"G1"}"#, "the first body built-in is the next fresh value");
    }

    /// A Send message parked on the full outbound channel when the server ends the call
    /// fails deterministically with `StreamClosed` — never a phantom `→` row after End.
    #[tokio::test]
    async fn send_message_parked_on_a_full_channel_is_stream_closed_once_the_call_ends() {
        let transport = scripted(StreamScript {
            hold_outbound: true,
            items: vec![Err(end(0))],
            items_delay: Some(Duration::from_millis(100)),
            ..Default::default()
        });
        let sender = sender(transport, static_tokens("t"));
        let (events, mut rx) = collector();
        let request = bidi_request();
        let env = env_with("who", "a");
        let call = Arc::new(
            sender
                .open_stream(&request, None, Some(&env), MethodKind::Bidi, opts(None), events)
                .await
                .expect("open"),
        );
        assert!(matches!(next(&mut rx).await, StreamEvent::Opened { .. }));
        assert!(matches!(next(&mut rx).await, StreamEvent::Headers { .. }));

        // Capacity 1, nothing draining: the first message fills the slot, the second parks.
        let first = call.send_message(&request.body_template, None, Some(&env)).await.expect("slot free");
        assert_eq!(first.index, 1);
        let parked = tokio::spawn({
            let (call, body, env) = (call.clone(), request.body_template.clone(), env.clone());
            async move { call.send_message(&body, None, Some(&env)).await }
        });
        tokio::time::sleep(Duration::from_millis(30)).await;
        assert!(!parked.is_finished(), "parked on the full channel");

        // The server ends the call while the send is still parked.
        assert!(matches!(next(&mut rx).await, StreamEvent::End { status_code: 0, .. }));
        let err = tokio::time::timeout(Duration::from_secs(2), parked)
            .await
            .expect("the parked send resolves once the call ended")
            .expect("task")
            .expect_err("no phantom ack");
        assert!(matches!(err, CoreError::StreamClosed { .. }), "{err:?}");
        assert_eq!(call.message_count(), 1, "the store gained no row after End");
        assert!(!call.is_writable(), "the outbound side is gone with the call");
        assert!(matches!(
            call.send_message(&request.body_template, None, Some(&env)).await.unwrap_err(),
            CoreError::StreamClosed { .. }
        ));
    }

    /// An unresolved var or an invalid body blocks that one Send message; the stream stays
    /// open and the next valid message goes out under the next index.
    #[tokio::test]
    async fn resolve_failure_or_bad_body_on_send_message_leaves_the_stream_open() {
        let transport = scripted(StreamScript { hang: true, ..Default::default() });
        let sender = sender(transport.clone(), static_tokens("t"));
        let (events, mut rx) = collector();
        let request = bidi_request();
        let env = env_with("who", "a");
        let call = sender
            .open_stream(&request, None, Some(&env), MethodKind::Bidi, opts(None), events)
            .await
            .expect("open");
        assert!(matches!(next(&mut rx).await, StreamEvent::Opened { .. }));

        let err = call.send_message(r#"{"id":"{{nope}}-{{also}}"}"#, None, Some(&env)).await.unwrap_err();
        match err {
            CoreError::ResolveFailed { unresolved, cycle } => {
                assert_eq!(unresolved, vec!["nope", "also"], "the whole diagnosis, as at Open");
                assert!(cycle.is_none());
            }
            other => panic!("expected ResolveFailed, got {other:?}"),
        }
        let err = call.send_message("not json {", None, Some(&env)).await.unwrap_err();
        assert!(matches!(err, CoreError::EncodeRequest(_)), "{err:?}");

        assert!(call.is_writable(), "the stream stays open");
        assert!(!call.is_finished());
        let ack = call.send_message(&request.body_template, None, Some(&env)).await.expect("send");
        assert_eq!(ack.index, 1, "failed sends take no index");
        assert_eq!(outbound_at_least(&transport, 1).await.len(), 1);
        assert_eq!(call.message_count(), 1);
    }

    /// Phase 2 is armed by half-close: an open client/bidi call outlives the deadline
    /// pref without any timer running, and only the half-close → stream start wait is bound.
    #[tokio::test]
    async fn no_deadline_runs_between_open_and_half_close() {
        let transport = scripted(StreamScript {
            start_after_half_close: true,
            end_on_half_close: Some(end(0)),
            ..Default::default()
        });
        let sender = sender(transport, static_tokens("t"));
        let (events, mut rx) = collector();
        let request = client_request();
        let env = env_with("who", "a");
        let call = sender
            .open_stream(&request, None, Some(&env), MethodKind::Client, opts(Some(Duration::from_millis(30))), events)
            .await
            .expect("open");
        assert!(matches!(next(&mut rx).await, StreamEvent::Opened { .. }));

        // Far longer than the 30 ms deadline, with the server silent: nothing happens.
        tokio::time::sleep(Duration::from_millis(150)).await;
        assert!(rx.try_recv().is_err(), "no Fault while the outbound side is open");
        call.send_message(&request.body_template, None, Some(&env)).await.expect("still sendable");

        call.half_close().unwrap();
        assert!(matches!(next(&mut rx).await, StreamEvent::Headers { .. }), "the server answers right after half-close");
        assert!(matches!(next(&mut rx).await, StreamEvent::End { status_code: 0, .. }));
    }

    #[tokio::test]
    async fn phase2_deadline_counts_from_half_close_and_faults_after_opened() {
        let transport = scripted(StreamScript {
            start_after_half_close: true,
            start_delay: Some(Duration::from_millis(300)),
            ..Default::default()
        });
        let sender = sender(transport, static_tokens("t"));
        let (events, mut rx) = collector();
        let env = env_with("who", "a");
        let call = sender
            .open_stream(&client_request(), None, Some(&env), MethodKind::Client, opts(Some(Duration::from_millis(20))), events)
            .await
            .expect("open");
        assert!(matches!(next(&mut rx).await, StreamEvent::Opened { .. }));
        tokio::time::sleep(Duration::from_millis(60)).await;
        assert!(rx.try_recv().is_err(), "the 20 ms timer is not running yet");

        let half_closed_at = Instant::now();
        call.half_close().unwrap();
        match next(&mut rx).await {
            StreamEvent::Fault { error } => {
                assert!(matches!(error, CoreError::DeadlineExceeded { timeout_ms: 20 }), "{error:?}");
            }
            other => panic!("expected Fault, got {other:?}"),
        }
        assert!(half_closed_at.elapsed() < Duration::from_millis(250), "expired on the timer, not on the server");
        assert!(call.is_finished());
    }

    #[tokio::test]
    async fn registry_replace_cancels_old_call_release_frees_and_cancel_reports_presence() {
        let registry = StreamRegistry::new();
        assert!(!registry.cancel("rid"), "unknown id");

        let open = |transport: Arc<FakeTransport>| async move {
            let sender = sender(transport, static_tokens("t"));
            let (events, _rx) = collector();
            sender
                .open_stream(&stream_request(), None, None, MethodKind::Server, opts(None), events)
                .await
                .expect("open")
        };
        let first = registry.insert(
            "rid",
            open(scripted(StreamScript { hang: true, ..Default::default() })).await,
        );
        assert_eq!(registry.len(), 1);

        // Same id again → the old handle is dropped from the registry; its task aborts.
        let _second = registry.insert(
            "rid",
            open(scripted(StreamScript { hang: true, ..Default::default() })).await,
        );
        assert_eq!(registry.len(), 1);
        drop(first); // the test's own Arc was the last one
        tokio::time::sleep(Duration::from_millis(50)).await;

        assert!(registry.cancel("rid"));
        assert!(registry.get("rid").unwrap().is_cancelled());
        assert!(registry.release("rid"));
        assert!(!registry.release("rid"));
        assert!(registry.is_empty());
    }

    #[tokio::test]
    async fn release_call_frees_only_the_exact_handle_it_was_given() {
        let registry = StreamRegistry::new();
        let open = |transport: Arc<FakeTransport>| async move {
            let sender = sender(transport, static_tokens("t"));
            let (events, _rx) = collector();
            sender
                .open_stream(&stream_request(), None, None, MethodKind::Server, opts(None), events)
                .await
                .expect("open")
        };
        let first = registry.insert(
            "rid",
            open(scripted(StreamScript { hang: true, ..Default::default() })).await,
        );
        let second = registry.insert(
            "rid",
            open(scripted(StreamScript { hang: true, ..Default::default() })).await,
        );

        // A stale handle (replaced under the same id) must not free the current one.
        assert!(!registry.release_call("rid", &first));
        assert_eq!(registry.len(), 1);
        assert!(registry.release_call("rid", &second));
        assert!(registry.is_empty());
        assert!(!registry.release_call("rid", &second), "already gone");
    }

    // ---- Save messages + Assemble over the Stream store (ticket 18) ----------------

    fn download_request() -> SavedRequest {
        let mut r = stream_request();
        r.method = "Download".into();
        r
    }

    async fn until_end(rx: &mut tokio::sync::mpsc::UnboundedReceiver<StreamEvent>) {
        while !matches!(next(rx).await, StreamEvent::End { .. }) {}
    }

    #[tokio::test]
    async fn download_opened_lists_the_bytes_field_and_the_store_saves_messages_and_assembles() {
        let png = [0x89u8, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
        let transport = scripted(StreamScript {
            items: vec![
                Ok(chunk_bytes(Some("logo.png"), None)), // header: name only
                Ok(chunk_bytes(None, Some(&png))),
                Ok(chunk_bytes(None, Some(b"tail"))),
                Err(end(0)),
            ],
            ..Default::default()
        });
        let sender = sender(transport, static_tokens("t"));
        let (events, mut rx) = collector();
        let call = sender
            .open_stream(&download_request(), None, None, MethodKind::Server, opts(None), events)
            .await
            .expect("open");
        match next(&mut rx).await {
            StreamEvent::Opened { bytes_fields, .. } => assert_eq!(bytes_fields, vec!["data"]),
            other => panic!("expected Opened, got {other:?}"),
        }
        until_end(&mut rx).await;

        // Save messages: one pretty array, oldest first, proto field names, defaults emitted.
        let json = call.save_messages().expect("json");
        let arr: Vec<serde_json::Value> = serde_json::from_str(&json).expect("valid JSON array");
        assert_eq!(arr.len(), 3);
        assert_eq!(arr[0]["name"], "logo.png");
        assert_eq!(arr[0]["data"], "", "default emitted");
        assert_eq!(arr[2]["data"], "dGFpbA==", "bytes as base64");
        assert!(json.starts_with("[\n  {"), "pretty: {json}");

        // Assemble streams the field of every row that has it; the header contributes 0.
        let mut sink = Vec::new();
        let r = call.assemble("data", &mut sink).expect("assemble");
        assert_eq!(sink, [&png[..], b"tail"].concat());
        assert_eq!(r, AssembleResult { written: 2, total: 3, size_bytes: 16 });
        // The first message names the file.
        assert_eq!(call.default_name("data", "S").unwrap(), "logo.png");

        // Unknown paths are refused with the call's id (stamped by the registry).
        let registry = StreamRegistry::new();
        let call = registry.insert("rid", call);
        assert!(matches!(
            call.assemble("name", &mut Vec::new()),
            Err(CoreError::StreamFieldNotFound { ref request_id, ref field_path }) if request_id == "rid" && field_path == "name"
        ));
        assert!(matches!(registry.default_name("rid", "nope", "S"), Err(CoreError::StreamFieldNotFound { .. })));
        assert_eq!(registry.save_messages("rid").unwrap(), call.save_messages().unwrap());
        let mut sink = Vec::new();
        assert_eq!(registry.assemble("rid", "data", &mut sink).unwrap().written, 2);
        assert!(matches!(registry.save_messages("ghost"), Err(CoreError::StreamNotFound { ref request_id }) if request_id == "ghost"));
        assert!(matches!(registry.assemble("ghost", "data", &mut Vec::new()), Err(CoreError::StreamNotFound { .. })));
        assert!(matches!(registry.default_name("ghost", "data", "S"), Err(CoreError::StreamNotFound { .. })));
    }

    #[tokio::test]
    async fn default_name_sniffs_the_first_chunk_when_no_message_names_the_file() {
        let transport = scripted(StreamScript {
            items: vec![Ok(chunk_bytes(None, Some(br#"{"k":1}"#))), Err(end(0))],
            ..Default::default()
        });
        let sender = sender(transport, static_tokens("t"));
        let (events, mut rx) = collector();
        let call = sender
            .open_stream(&download_request(), None, None, MethodKind::Server, opts(None), events)
            .await
            .expect("open");
        until_end(&mut rx).await;
        assert_eq!(call.default_name("data", "2026-09-28T10-00-00").unwrap(), "stream-2026-09-28T10-00-00.json");
    }

    #[tokio::test]
    async fn cancelled_download_assembles_what_arrived_and_a_pong_stream_has_no_bytes_fields() {
        let transport = scripted(StreamScript {
            items: vec![Ok(chunk_bytes(None, Some(b"ab"))), Ok(chunk_bytes(None, Some(b"cd")))],
            hang: true,
            ..Default::default()
        });
        let sender = sender(transport, static_tokens("t"));
        let (events, mut rx) = collector();
        let call = sender
            .open_stream(&download_request(), None, None, MethodKind::Server, opts(None), events)
            .await
            .expect("open");
        let mut seen = 0;
        while seen < 2 {
            if matches!(next(&mut rx).await, StreamEvent::Message { .. }) {
                seen += 1;
            }
        }
        call.cancel();
        let mut sink = Vec::new();
        let r = call.assemble("data", &mut sink).expect("assemble after cancel");
        assert_eq!(sink, b"abcd");
        assert_eq!(r, AssembleResult { written: 2, total: 2, size_bytes: 4 });
        assert_eq!(call.default_name("data", "S").unwrap(), "stream-S.txt");

        // A response type without bytes fields advertises none.
        let transport = scripted(StreamScript { items: vec![Ok(pong_bytes("a")), Err(end(0))], ..Default::default() });
        let pong_sender = Sender::new(transport, static_tokens("t"), seeded_cache(false), Arc::new(NoBuiltins));
        let (events, mut rx) = collector();
        let _call = pong_sender
            .open_stream(&stream_request(), None, None, MethodKind::Server, opts(None), events)
            .await
            .expect("open");
        match next(&mut rx).await {
            StreamEvent::Opened { bytes_fields, .. } => assert!(bytes_fields.is_empty()),
            other => panic!("expected Opened, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn save_messages_excludes_outbound_rows_of_a_two_way_call() {
        let transport = scripted(StreamScript { echo: true, end_on_half_close: Some(end(0)), ..Default::default() });
        let sender = sender(transport, static_tokens("t"));
        let (events, mut rx) = collector();
        let request = bidi_request();
        let env = env_with("who", "a");
        let call = sender
            .open_stream(&request, None, Some(&env), MethodKind::Bidi, opts(None), events)
            .await
            .expect("open");
        call.send_message(&request.body_template, None, Some(&env)).await.expect("send");
        call.half_close().expect("half-close");
        until_end(&mut rx).await;
        assert_eq!(call.message_count(), 2, "one → and one ← row");
        let arr: Vec<serde_json::Value> = serde_json::from_str(&call.save_messages().unwrap()).unwrap();
        assert_eq!(arr.len(), 1, "only the inbound echo is saved");
        assert_eq!(arr[0]["id"], "a");
    }
}
