//! gRPC commands — thin wrappers around `handshaker_core::grpc::*`. NO business logic.
//!
//! Lazy connect-on-Send model (plan-06b): no held connection. The `ContractCache`
//! holds pools/catalogs between calls; a `GrpcConnection` lives only for the duration
//! of one `grpc_send` (or a `grpc_describe` cache miss) and is dropped after.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock, Weak};
use std::time::Duration;

use tokio::sync::Notify;

use handshaker_core::collections::{ItemId, SavedRequest};
use handshaker_core::grpc::{
    activate, build_message_schema_from_pools, build_request_skeleton_from_pools, CallOptions,
    ContractKey, GrpcTarget, TonicTransport,
};
use handshaker_core::stream::{AssembleResult, StreamCall, StreamEvents, StreamRegistry};
use tauri::{AppHandle, State};
use tauri_specta::Event;
use uuid::Uuid;

use crate::commands::dialog::{local_stamp, save_bytes_via_dialog, save_via_dialog_with, SaveError};
use crate::commands::events::ContractUpdated;
use crate::ipc::{
    AssembleResultIpc, CallOptionsIpc, GrpcTargetIpc, InvokeOutcomeIpc, IpcError, MessageSchemaIpc, MessageSideIpc,
    MethodKindIpc, OutboundMessageIpc, SendCtxIpc, SendDraftIpc, SendReportIpc, ServiceCatalogIpc,
    StreamEventIpc,
};
use crate::state::{AppState, InFlight};

/// Map the IPC byte limit to tonic's `usize`. The sentinel `0` means "no limit"
/// (the slider's Unlimited stop) → `usize::MAX`; any finite value passes through.
pub(crate) fn resolve_max_message_size(raw: u32) -> usize {
    if raw == 0 {
        usize::MAX
    } else {
        raw as usize
    }
}

/// Stable string key for the `ContractUpdated` event. Mirrors `ContractKey`'s
/// key-space (address + tls only; `skip_verify` is intentionally excluded —
/// it does not change the contract).
fn target_key(t: &GrpcTarget) -> String {
    format!("{}|tls={}", t.address, t.tls)
}

/// Cache-first contract describe. On a cache hit, returns the cached catalog
/// WITHOUT opening a channel (auto-reflect-on-blur fires often). On a miss,
/// `activate()` reflects + populates the cache, then the connection is dropped.
///
/// The reflecting path (miss only — a hit returns instantly with nothing to abort)
/// runs under `race_cancel_timeout`, so it honors the caller's deadline and can be
/// cancelled by `grpc_cancel(request_id)`, exactly like `grpc_send`.
#[tauri::command]
#[specta::specta]
pub async fn grpc_describe(
    app: AppHandle,
    state: State<'_, AppState>,
    target: GrpcTargetIpc,
    request_id: String,
    timeout_ms: u32,
) -> Result<ServiceCatalogIpc, IpcError> {
    let target = target.into_core()?;
    let key = ContractKey::from_target(&target);

    if let Some(cached) = state.contract_cache.get(&key) {
        return Ok(cached.catalog.into());
    }

    let cache = state.contract_cache.clone();
    let work = async move {
        let transport = Arc::new(TonicTransport::new());
        let conn = activate(target, transport, cache.as_ref()).await?;
        let catalog: ServiceCatalogIpc = conn.catalog.clone().into();
        ContractUpdated { target_key: target_key(&conn.target) }
            .emit(&app)
            .ok();
        Ok::<ServiceCatalogIpc, IpcError>(catalog)
        // conn dropped here.
    };
    race_cancel_timeout(&state.in_flight, request_id, timeout_ms, work).await
}

/// Manual refresh: invalidate the cache entry then re-reflect. Like `grpc_describe`,
/// the re-reflection runs under `race_cancel_timeout` (deadline + `grpc_cancel`).
#[tauri::command]
#[specta::specta]
pub async fn grpc_refresh_contract(
    app: AppHandle,
    state: State<'_, AppState>,
    target: GrpcTargetIpc,
    request_id: String,
    timeout_ms: u32,
) -> Result<ServiceCatalogIpc, IpcError> {
    let target = target.into_core()?;
    state
        .contract_cache
        .invalidate(&ContractKey::from_target(&target));
    let cache = state.contract_cache.clone();
    let work = async move {
        let transport = Arc::new(TonicTransport::new());
        let conn = activate(target, transport, cache.as_ref()).await?;
        let catalog: ServiceCatalogIpc = conn.catalog.clone().into();
        ContractUpdated { target_key: target_key(&conn.target) }
            .emit(&app)
            .ok();
        Ok::<ServiceCatalogIpc, IpcError>(catalog)
    };
    race_cancel_timeout(&state.in_flight, request_id, timeout_ms, work).await
}

/// Build a JSON skeleton from the cached pools. On a cache miss, activate first.
///
/// The reflecting path (miss only) runs under `race_cancel_timeout`, so it honors the
/// caller's deadline and can be cancelled by `grpc_cancel(request_id)` — otherwise a
/// slow/unreachable endpoint would hang this command with no bound and no cancel path.
#[tauri::command]
#[specta::specta]
pub async fn grpc_build_request_skeleton(
    state: State<'_, AppState>,
    target: GrpcTargetIpc,
    service: String,
    method: String,
    request_id: String,
    timeout_ms: u32,
) -> Result<String, IpcError> {
    let target = target.into_core()?;
    let key = ContractKey::from_target(&target);

    if let Some(cached) = state.contract_cache.get(&key) {
        return Ok(build_request_skeleton_from_pools(&cached.pools, &service, &method)?);
    }
    let cache = state.contract_cache.clone();
    let work = async move {
        let transport = Arc::new(TonicTransport::new());
        let conn = activate(target, transport, cache.as_ref()).await?;
        Ok::<String, IpcError>(build_request_skeleton_from_pools(&conn.pools, &service, &method)?)
    };
    race_cancel_timeout(&state.in_flight, request_id, timeout_ms, work).await
}

/// Build the flat field-schema for a method's input or output message — drives autocomplete
/// and the contract view. Same cache discipline as `grpc_build_request_skeleton`: cache
/// hit → build from the pool set; miss → `activate` first.
#[tauri::command]
#[specta::specta]
pub async fn grpc_message_schema(
    state: State<'_, AppState>,
    target: GrpcTargetIpc,
    service: String,
    method: String,
    side: MessageSideIpc,
    request_id: String,
    timeout_ms: u32,
) -> Result<MessageSchemaIpc, IpcError> {
    let target = target.into_core()?;
    let key = ContractKey::from_target(&target);

    if let Some(cached) = state.contract_cache.get(&key) {
        return Ok(
            build_message_schema_from_pools(&cached.pools, &service, &method, side.into())?.into(),
        );
    }
    let cache = state.contract_cache.clone();
    let work = async move {
        let transport = Arc::new(TonicTransport::new());
        let conn = activate(target, transport, cache.as_ref()).await?;
        Ok::<MessageSchemaIpc, IpcError>(
            build_message_schema_from_pools(&conn.pools, &service, &method, side.into())?.into(),
        )
    };
    race_cancel_timeout(&state.in_flight, request_id, timeout_ms, work).await
}

/// Removes the in-flight registry entry on scope exit (success / timeout / cancel / panic).
struct DeregisterGuard<'a> {
    map: &'a InFlight,
    id: String,
    notify: Arc<Notify>,
}
impl Drop for DeregisterGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut g) = self.map.lock() {
            // Remove only OUR entry: if a later request reused this id and overwrote the
            // slot, its `Notify` differs by identity — leave it so it stays cancelable.
            if g.get(&self.id).is_some_and(|n| Arc::ptr_eq(n, &self.notify)) {
                g.remove(&self.id);
            }
        }
    }
}

/// Race a unit of `work` against (a) a per-request cancel `Notify` and (b) a timeout.
/// Testable seam: the command builds `work` from the real activate+invoke; tests pass a
/// synthetic future. Generic over `T` so tests need no `InvokeOutcomeIpc` and no network.
pub(crate) async fn race_cancel_timeout<T, F>(
    in_flight: &InFlight,
    request_id: String,
    timeout_ms: u32,
    work: F,
) -> Result<T, IpcError>
where
    F: std::future::Future<Output = Result<T, IpcError>>,
{
    let bounded = async move {
        match tokio::time::timeout(Duration::from_millis(timeout_ms as u64), work).await {
            Ok(inner) => inner,
            Err(_) => Err(IpcError::DeadlineExceeded { timeout_ms }),
        }
    };
    race_cancel(in_flight, request_id, bounded).await
}

/// Race `work` against the per-request cancel `Notify` only — no timeout.
pub(crate) async fn race_cancel<T, F>(
    in_flight: &InFlight,
    request_id: String,
    work: F,
) -> Result<T, IpcError>
where
    F: std::future::Future<Output = Result<T, IpcError>>,
{
    race_cancel_handoff(in_flight, request_id, work, |v| v).await.map(|(v, _)| v)
}

/// `race_cancel` with a **hand-off**: a successful result is passed to `register` while
/// the in-flight entry still exists — under the registry lock, so a concurrent
/// `grpc_cancel` (which holds the same lock for lookup + notify) sees the id in exactly
/// one registry at any instant. The stream Open path uses it: its deadlines are core's
/// phase timers (the race must not cut an Open short on its own), and its call moves
/// from `in_flight` to the stream registry here.
///
/// The returned flag is `true` when a cancel landed after `work` completed but before
/// the hand-off (tokio keeps such a `notify_one` as a permit): the caller applies it to
/// the registered value, so no cancel is lost in the window.
pub(crate) async fn race_cancel_handoff<T, F, R>(
    in_flight: &InFlight,
    request_id: String,
    work: F,
    register: impl FnOnce(T) -> R,
) -> Result<(R, bool), IpcError>
where
    F: std::future::Future<Output = Result<T, IpcError>>,
{
    let notify = Arc::new(Notify::new());
    in_flight
        .lock()
        .expect("in_flight registry poisoned")
        .insert(request_id.clone(), notify.clone());
    let _guard = DeregisterGuard { map: in_flight, id: request_id.clone(), notify: notify.clone() };

    let value = tokio::select! {
        biased;
        _ = notify.notified() => Err(IpcError::Cancelled),
        r = work => r,
    }?;

    let registered = {
        let mut g = in_flight.lock().expect("in_flight registry poisoned");
        let registered = register(value);
        if g.get(&request_id).is_some_and(|n| Arc::ptr_eq(n, &notify)) {
            g.remove(&request_id);
        }
        registered
    };
    Ok((registered, has_permit(&notify)))
}

/// `true` when a `notify_one` is stored on `notify` (consumes it). A `Notified` future
/// polled once with a no-op waker completes only on a stored permit; otherwise it is
/// dropped again without waiting.
fn has_permit(notify: &Notify) -> bool {
    let mut fut = std::pin::pin!(notify.notified());
    let mut cx = std::task::Context::from_waker(std::task::Waker::noop());
    std::future::Future::poll(fut.as_mut(), &mut cx).is_ready()
}

/// Read the ctx-referenced collection / env from the stores — the ctx carries
/// references, not data. Shared by Send, Open and Send message.
fn ctx_refs(
    state: &AppState,
    ctx: &SendCtxIpc,
) -> (
    Option<handshaker_core::collections::Collection>,
    Option<handshaker_core::env::Environment>,
) {
    let collection = ctx
        .collection_id
        .as_deref()
        .and_then(|id| crate::ipc::collection::parse_collection_id(id).ok())
        .and_then(|cid| state.collection_store.get(cid));
    let active_env = ctx.env_name.as_deref().and_then(|n| state.env_store.get(n));
    (collection, active_env)
}

/// Build the core `SavedRequest` view over an IPC draft (the UI toggle is the tls
/// override) and read the ctx-referenced collection / env from the stores.
fn draft_to_request(
    state: &AppState,
    draft: SendDraftIpc,
    ctx: &SendCtxIpc,
) -> (
    SavedRequest,
    Option<handshaker_core::collections::Collection>,
    Option<handshaker_core::env::Environment>,
) {
    let (collection, active_env) = ctx_refs(state, ctx);

    let saved = SavedRequest {
        id: ItemId(Uuid::nil()),
        name: String::new(),
        address_template: draft.address_template,
        service: draft.service.clone(),
        method: draft.method.clone(),
        body_template: draft.body_template,
        metadata: draft.metadata.into_iter().map(|r| r.into_core()).collect(),
        auth: draft.auth.into_core(),
        tls_override: draft.tls_override,
        last_used_at: None,
        use_count: 0,
    };
    (saved, collection, active_env)
}

/// Live Send — an ADAPTER over the core `Sender` (the whole spine lives in core):
/// parse ctx references → read collection/env from the stores → run the shared
/// `Sender` under the cancel/timeout race → map the core report and errors to
/// wire form.
///
/// Non-OK gRPC status arrives in `SendReportIpc.outcome.status_code`, NOT as
/// `Err`. `Err` covers resolve failure (`UnresolvedVars`) and client-side
/// failures (transport / encode / decode).
pub(crate) async fn grpc_send_impl(
    state: &AppState,
    draft: SendDraftIpc,
    ctx: SendCtxIpc,
    request_id: String,
    opts: CallOptionsIpc,
) -> Result<SendReportIpc, IpcError> {
    let (saved, collection, active_env) = draft_to_request(state, draft, &ctx);

    let timeout_ms = opts.timeout_ms;
    // Unary keeps its deadline in this race — no core phase timer.
    let call_opts = CallOptions {
        max_message_bytes: resolve_max_message_size(opts.max_message_bytes),
        phase_timeout: None,
    };
    let sender = state.sender.clone();
    let work = async move {
        let report = sender
            .send(&saved, collection.as_ref(), active_env.as_ref(), call_opts)
            .await?;
        let outcome: InvokeOutcomeIpc = report.outcome.into();
        Ok(SendReportIpc::from_parts(outcome, report.auth_used, report.tls_used))
    };
    race_cancel_timeout(&state.in_flight, request_id, timeout_ms, work).await
}

#[tauri::command]
#[specta::specta]
pub async fn grpc_send(
    state: State<'_, AppState>,
    draft: SendDraftIpc,
    ctx: SendCtxIpc,
    request_id: String,
    opts: CallOptionsIpc,
) -> Result<SendReportIpc, IpcError> {
    grpc_send_impl(&state, draft, ctx, request_id, opts).await
}

/// **Open** a stream call — an ADAPTER over core `Sender::open_stream` (ADR-0002):
/// store reads → the shared spine under the cancel-only race → the returned handle goes
/// into the core `StreamRegistry` under `request_id`, replacing (and freeing) any
/// earlier call with the same id. Every event is forwarded on `on_event` as
/// `StreamEventIpc`; the command resolves at `Opened` ("return-at-Opened"): `Ok(())` =
/// call in flight, `Err` = pre-Open fault (resolve, lookup, body, activate, phase-1
/// deadline, cancel). No timeout here — the deadline pref becomes core's
/// `phase_timeout`, and an open stream has no deadline.
pub(crate) async fn stream_open_impl(
    state: &AppState,
    draft: SendDraftIpc,
    ctx: SendCtxIpc,
    request_id: String,
    kind: MethodKindIpc,
    opts: CallOptionsIpc,
    on_event: tauri::ipc::Channel<StreamEventIpc>,
) -> Result<(), IpcError> {
    let (saved, collection, active_env) = draft_to_request(state, draft, &ctx);

    let call_opts = CallOptions {
        max_message_bytes: resolve_max_message_size(opts.max_message_bytes),
        phase_timeout: Some(Duration::from_millis(u64::from(opts.timeout_ms))),
    };
    // The channel rides into the core task through the callback seam. A failed `send`
    // (webview gone / page reloaded) means no one is left to show this call — the
    // safety net cancels it and frees its store instead of leaking until exit. `Opened`
    // fires before the handle exists, so the callback only flags `dead` and the
    // registration below re-checks it; later events reach the handle through `slot`.
    let dead = Arc::new(AtomicBool::new(false));
    let slot: Arc<OnceLock<Weak<StreamCall>>> = Arc::new(OnceLock::new());
    let events: StreamEvents = {
        let (dead, slot, streams, id) =
            (dead.clone(), slot.clone(), state.streams.clone(), request_id.clone());
        Arc::new(move |ev| {
            if on_event.send(StreamEventIpc::from_core(ev)).is_err() {
                dead.store(true, Ordering::SeqCst);
                if let Some(call) = slot.get().and_then(Weak::upgrade) {
                    call.cancel();
                    streams.release_call(&id, &call);
                }
            }
        })
    };

    let sender = state.sender.clone();
    let work = async move {
        sender
            .open_stream(
                &saved,
                collection.as_ref(),
                active_env.as_ref(),
                kind.into_core(),
                call_opts,
                events,
            )
            .await
            .map_err(IpcError::from)
    };
    // The handle enters the stream registry while `in_flight` still holds the id (same
    // lock), so a `grpc_cancel` at any instant finds it in exactly one of the two.
    let (call, cancel_raced) =
        race_cancel_handoff(&state.in_flight, request_id.clone(), work, |call| {
            state.streams.insert(request_id.clone(), call)
        })
        .await?;
    let _ = slot.set(Arc::downgrade(&call));
    if cancel_raced {
        call.cancel();
    }
    if dead.load(Ordering::SeqCst) {
        call.cancel();
        state.streams.release_call(&request_id, &call);
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn stream_open(
    state: State<'_, AppState>,
    draft: SendDraftIpc,
    ctx: SendCtxIpc,
    request_id: String,
    kind: MethodKindIpc,
    opts: CallOptionsIpc,
    on_event: tauri::ipc::Channel<StreamEventIpc>,
) -> Result<(), IpcError> {
    stream_open_impl(&state, draft, ctx, request_id, kind, opts, on_event).await
}

/// **Send message** on the open call under `request_id` — an ADAPTER over
/// `StreamRegistry::send_message`: read the ctx-referenced collection / env of *this*
/// moment from the stores, then let core resolve the body template (vars + fresh
/// built-ins; auth is never re-materialized), encode, store and hand the message to the
/// transport. The ack is the timeline row. `Err(StreamClosed)` before `Opened` (unknown
/// id) and after half-close / end / cancel; `UnresolvedVars` / `EncodeRequest` leave the
/// call open. No race here: the `await` is the bounded outbound channel, released by the
/// transport taking the message or by Cancel ending the call.
pub(crate) async fn stream_send_impl(
    state: &AppState,
    request_id: &str,
    body_template: &str,
    ctx: &SendCtxIpc,
) -> Result<OutboundMessageIpc, IpcError> {
    let (collection, active_env) = ctx_refs(state, ctx);
    let ack = state
        .streams
        .send_message(request_id, body_template, collection.as_ref(), active_env.as_ref())
        .await?;
    Ok(OutboundMessageIpc::from_core(ack))
}

/// **Send message** on the open stream call under `request_id`: `body_template` is the
/// current body (templates intact — core resolves `{{var}}` / `{{$builtin}}` against the
/// `ctx` collection / env of this moment); the ack carries the row for the timeline
/// (`index` shared with inbound rows, `at_ms`, `size_bytes`, `preview`) plus the
/// **resolved** JSON that went on the wire. `Err(StreamClosed)` when the call is not
/// `Opened` yet, half-closed, ended or cancelled — never a silent drop;
/// `Err(UnresolvedVars | EncodeRequest)` blocks this message only, the call stays open.
#[tauri::command]
#[specta::specta]
pub async fn stream_send(
    state: State<'_, AppState>,
    request_id: String,
    body_template: String,
    ctx: SendCtxIpc,
) -> Result<OutboundMessageIpc, IpcError> {
    stream_send_impl(&state, &request_id, &body_template, &ctx).await
}

/// **Half-close** the call under `request_id` — an ADAPTER over
/// `StreamRegistry::half_close`: the outbound side ends on the wire, Send message is
/// refused from here, and the phase-2 deadline (half-close → stream start) starts.
pub(crate) fn stream_half_close_impl(state: &AppState, request_id: &str) -> Result<(), IpcError> {
    state.streams.half_close(request_id).map_err(IpcError::from)
}

/// **Half-close** the outbound side of the stream call under `request_id`: the request
/// stream ends on the wire, later `stream_send`s are refused, and the deadline pref
/// starts bounding the server's answer (half-close → stream start). Idempotent while the
/// call is registered; `Err(StreamClosed)` for an unknown id.
#[tauri::command]
#[specta::specta]
pub async fn stream_half_close(
    state: State<'_, AppState>,
    request_id: String,
) -> Result<(), IpcError> {
    stream_half_close_impl(&state, &request_id)
}

/// Full pretty proto3-JSON of inbound message `index` (1-based timeline ordinal) of the
/// call under `request_id`, decoded lazily from the core Stream store. The timeline
/// calls this on expand for rows whose `Message.json` came as `null` (> 64 KiB).
pub(crate) fn stream_message_impl(
    state: &AppState,
    request_id: &str,
    index: u32,
) -> Result<String, IpcError> {
    state.streams.message_json(request_id, index).map_err(IpcError::from)
}

/// Full pretty proto3-JSON of one inbound message of a Stream call: `index` is the
/// 1-based timeline ordinal of the row under `request_id`, decoded lazily from the core
/// Stream store. The timeline calls this when a row whose `Message.json` arrived as
/// `null` (> 64 KiB) is expanded. `Err(StreamMessageNotFound)` when the call id is
/// unknown (store already released) or the index is out of range (stale snapshot).
#[tauri::command]
#[specta::specta]
pub async fn stream_message(
    state: State<'_, AppState>,
    request_id: String,
    index: u32,
) -> Result<String, IpcError> {
    stream_message_impl(&state, &request_id, index)
}

/// Free the **Stream store** of `request_id` (and abort the call if still running).
/// No-op if unknown. The frontend's release rule is the only caller.
#[tauri::command]
#[specta::specta]
pub async fn stream_release(
    state: State<'_, AppState>,
    request_id: String,
) -> Result<(), IpcError> {
    state.streams.release(&request_id);
    Ok(())
}

/// **Save messages** — the JSON array core builds from the Stream store of `request_id`
/// (every inbound message, oldest first; outbound excluded). An ADAPTER over
/// `StreamRegistry::save_messages`; the command around it owns the Save-As dialog.
pub(crate) fn stream_save_messages_impl(streams: &StreamRegistry, request_id: &str) -> Result<String, IpcError> {
    streams.save_messages(request_id).map_err(IpcError::from)
}

/// A blocking export task that did not finish (panicked / runtime shutting down).
fn export_task_failed(e: tokio::task::JoinError) -> IpcError {
    IpcError::Persistence { message: format!("export task: {e}") }
}

/// **Save messages** of the Stream call under `request_id`: all inbound messages as one
/// JSON array (oldest first, outbound excluded), written to a user-picked file via the
/// native Save-As dialog under the unary default name `response-<localstamp>.json`.
/// `Ok(Some(path))` = saved, `Ok(None)` = the user cancelled the dialog;
/// `Err(StreamNotFound)` for an unknown / released call (before any dialog opens).
///
/// The JSON build decodes every stored row, so it runs on a blocking thread like the
/// write itself — never on a tokio worker.
#[tauri::command]
#[specta::specta]
pub async fn stream_save_messages(
    app: AppHandle,
    state: State<'_, AppState>,
    request_id: String,
) -> Result<Option<String>, IpcError> {
    let json = {
        let streams = state.streams.clone();
        tokio::task::spawn_blocking(move || stream_save_messages_impl(&streams, &request_id))
            .await
            .map_err(export_task_failed)??
    };
    let default_name = format!("response-{}.json", local_stamp());
    save_bytes_via_dialog(&app, &default_name, json.into_bytes())
        .await
        .map_err(|message| IpcError::Persistence { message })
}

/// **Assemble** — stream the `field_path` `bytes` of every inbound message of
/// `request_id` into `sink`, one message at a time. An ADAPTER over
/// `StreamRegistry::assemble`; the command around it owns the Save-As dialog and the file.
pub(crate) fn stream_assemble_impl(
    streams: &StreamRegistry,
    request_id: &str,
    field_path: &str,
    sink: &mut dyn std::io::Write,
) -> Result<AssembleResult, IpcError> {
    streams.assemble(request_id, field_path, sink).map_err(IpcError::from)
}

/// The Save-As default name of an assembly — `name` / `file_name` / `filename` of the
/// first inbound message, else `stream-<stamp>.<ext>` sniffed from the first chunk.
pub(crate) fn stream_assemble_name_impl(
    streams: &StreamRegistry,
    request_id: &str,
    field_path: &str,
    stamp: &str,
) -> Result<String, IpcError> {
    streams.default_name(request_id, field_path, stamp).map_err(IpcError::from)
}

/// **Assemble** one file from the `field_path` `bytes` field (one of `Opened.bytes_fields`)
/// of every inbound message of the Stream call under `request_id`: the native Save-As
/// dialog opens with core's default name, then core streams the chunks through a buffered
/// file sink — messages without the field are skipped (0 bytes), the whole file is never
/// buffered. `Ok(Some(result))` = saved (`path`, `written` of `total` messages,
/// `size_bytes`); `Ok(None)` = the user cancelled; `Err(StreamNotFound)` /
/// `Err(StreamFieldNotFound)` before any dialog opens. Decode + write run on a blocking
/// thread (`save_via_dialog_with`), so a multi-GB assembly never pins a tokio worker.
#[tauri::command]
#[specta::specta]
pub async fn stream_assemble(
    app: AppHandle,
    state: State<'_, AppState>,
    request_id: String,
    field_path: String,
) -> Result<Option<AssembleResultIpc>, IpcError> {
    let default_name = stream_assemble_name_impl(&state.streams, &request_id, &field_path, &local_stamp())?;
    let streams = state.streams.clone();
    let saved = save_via_dialog_with(&app, &default_name, move |sink| {
        stream_assemble_impl(&streams, &request_id, &field_path, sink)
    })
    .await
    .map_err(|e| match e {
        SaveError::Dialog(message) | SaveError::Io(message) => IpcError::Persistence { message },
        SaveError::Write(e) => e,
    })?;
    Ok(saved.map(|(path, result)| AssembleResultIpc::from_core(result, path)))
}

/// The one cancel entry point: fire the unary `in_flight` `Notify` when the id is
/// registered there (also covers a stream Open still in its pre-Open phase); otherwise
/// cancel the stream call under that id. No-op if unknown (already finished or never
/// started). `notify_one()` stores a permit so a cancel racing the `select!` first poll
/// still lands.
///
/// Lookup and notify happen under the `in_flight` lock: a stream Open's hand-off moves
/// the id from `in_flight` to the stream registry under the same lock
/// (`race_cancel_handoff`), so the cancel can never fall between the two registries.
pub(crate) fn grpc_cancel_impl(state: &AppState, request_id: &str) {
    let in_flight = state.in_flight.lock().expect("in_flight registry poisoned");
    match in_flight.get(request_id) {
        Some(n) => n.notify_one(),
        None => {
            state.streams.cancel(request_id);
        }
    }
}

/// Cancel the call under `request_id` — unary in-flight registry first, then the stream
/// registry. No-op if unknown. See `grpc_cancel_impl`.
#[tauri::command]
#[specta::specta]
pub async fn grpc_cancel(
    state: State<'_, AppState>,
    request_id: String,
) -> Result<(), IpcError> {
    grpc_cancel_impl(&state, &request_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn target_key_is_stable_for_equivalent_target() {
        let a = GrpcTarget::new("api.prod:8443", true, false).unwrap();
        let b = GrpcTarget::new("api.prod:8443", true, false).unwrap();
        assert_eq!(target_key(&a), target_key(&b));
    }

    #[test]
    fn target_key_differs_on_tls_flag() {
        let a = GrpcTarget::new("api.prod:8443", true, false).unwrap();
        let b = GrpcTarget::new("api.prod:8443", false, false).unwrap();
        assert_ne!(target_key(&a), target_key(&b));
    }

    use crate::ipc::collection::SavedAuthConfigIpc;
    use crate::ipc::invoke::SendDraftIpc;
    use crate::ipc::{IpcError, SendCtxIpc};
    use crate::state::InFlight;
    use std::collections::HashMap;
    use std::time::Duration;

    /// Draft whose address is the `{{host}}` template — resolvable only when the
    /// ctx-referenced store provides `host`.
    fn host_template_draft() -> SendDraftIpc {
        SendDraftIpc {
            address_template: "{{host}}".into(), tls_override: None,
            service: "pkg.Svc".into(), method: "Do".into(),
            body_template: "{}".into(), metadata: vec![],
            auth: SavedAuthConfigIpc::None,
        }
    }

    fn quick_opts() -> CallOptionsIpc {
        CallOptionsIpc { timeout_ms: 1000, max_message_bytes: 0 }
    }

    #[tokio::test]
    async fn grpc_send_unresolved_var_returns_unresolved_vars_error() {
        let state = AppState::default(); // empty stores ⇒ {{host}} unresolvable
        let ctx = SendCtxIpc { collection_id: None, env_name: None };
        let opts = quick_opts();
        let draft = host_template_draft();
        let err = grpc_send_impl(&state, draft, ctx, "rid".into(), opts).await.unwrap_err();
        match err {
            IpcError::UnresolvedVars { unresolved, .. } => assert_eq!(unresolved, vec!["host"]),
            other => panic!("got {other:?}"),
        }
    }

    /// `host` → a portless address: it resolves fine, then fails target validation
    /// with `InvalidTarget` — the no-network signal that the store was consulted
    /// (an unread store would leave `{{host}}` unresolved instead).
    fn portless_host_vars() -> indexmap::IndexMap<String, String> {
        let mut variables = indexmap::IndexMap::new();
        variables.insert("host".to_string(), "portless-address".to_string());
        variables
    }

    fn assert_store_var_resolved(err: IpcError) {
        match err {
            IpcError::InvalidTarget { message } => {
                assert!(message.contains("portless-address"), "{message}")
            }
            other => panic!("expected InvalidTarget (var resolved from store), got {other:?}"),
        }
    }

    /// The ctx carries a collection REFERENCE; the command must read the collection
    /// from the store.
    #[tokio::test]
    async fn grpc_send_reads_collection_from_store_by_ctx_reference() {
        let state = AppState::default();
        let id = handshaker_core::collections::ids::CollectionId(uuid::Uuid::from_u128(7));
        let collection = handshaker_core::collections::Collection {
            id,
            name: "c".into(),
            items: vec![],
            variables: portless_host_vars(),
            auth: handshaker_core::auth::SavedAuthConfig::None,
            default_tls: false,
            skip_tls_verify: false,
            pinned: false,
            description: None,
            created_at: 0.0,
            expanded: false,
            links: vec![],
        };
        state.collection_store.upsert(collection).unwrap();

        let ctx = SendCtxIpc { collection_id: Some(id.0.to_string()), env_name: None };
        let opts = quick_opts();
        let draft = host_template_draft();
        let err = grpc_send_impl(&state, draft, ctx, "rid".into(), opts).await.unwrap_err();
        assert_store_var_resolved(err);
    }

    /// Same for the environment REFERENCE: `env_name` in the ctx must be read from
    /// the env store and its variables fed into resolve.
    #[tokio::test]
    async fn grpc_send_reads_environment_from_store_by_ctx_reference() {
        let state = AppState::default();
        let env = handshaker_core::env::Environment {
            name: "dev".into(),
            variables: portless_host_vars(),
            color: None,
        };
        state.env_store.upsert(env).unwrap();

        let ctx = SendCtxIpc { collection_id: None, env_name: Some("dev".into()) };
        let opts = quick_opts();
        let draft = host_template_draft();
        let err = grpc_send_impl(&state, draft, ctx, "rid".into(), opts).await.unwrap_err();
        assert_store_var_resolved(err);
    }

    fn empty_in_flight() -> InFlight {
        std::sync::Mutex::new(HashMap::new())
    }

    #[tokio::test]
    async fn race_passes_through_success_and_cleans_up() {
        let m = empty_in_flight();
        let r = race_cancel_timeout(&m, "id1".to_string(), 1000, async {
            Ok::<i32, IpcError>(7)
        })
        .await;
        assert_eq!(r.unwrap(), 7);
        assert!(m.lock().unwrap().is_empty(), "registry entry removed on success");
    }

    #[tokio::test]
    async fn race_times_out_when_work_exceeds_budget() {
        let m = empty_in_flight();
        let work = async {
            tokio::time::sleep(Duration::from_secs(10)).await;
            Ok::<i32, IpcError>(1)
        };
        match race_cancel_timeout(&m, "id2".to_string(), 50, work).await {
            Err(IpcError::DeadlineExceeded { timeout_ms }) => assert_eq!(timeout_ms, 50),
            other => panic!("expected DeadlineExceeded, got {other:?}"),
        }
        assert!(m.lock().unwrap().is_empty(), "registry entry removed on timeout");
    }

    #[tokio::test]
    async fn duplicate_id_cleanup_keeps_the_later_registration_cancelable() {
        // Two in-flight calls reuse the same request_id: B registers after A and
        // overwrites the slot. When A finishes, its guard must remove ONLY its own
        // entry (ptr-eq), leaving B cancelable. The old by-id removal clobbered B,
        // so cancelling it did nothing and it timed out instead of cancelling.
        let m = empty_in_flight();
        let id = "dup";

        let a_registered = Arc::new(Notify::new());
        let release_a = Arc::new(Notify::new());
        let b_registered = Arc::new(Notify::new());
        let a_done = Arc::new(Notify::new());

        // A: signals once registered, then blocks until released, then completes. The
        // work future owns its clones; the driver futures below borrow the originals.
        let work_a = {
            let (a_registered, release_a) = (a_registered.clone(), release_a.clone());
            async move {
                a_registered.notify_one();
                release_a.notified().await;
                Ok::<i32, IpcError>(1)
            }
        };
        // B: registers only after A (so it overwrites A's slot), then waits to be cancelled.
        let work_b = {
            let b_registered = b_registered.clone();
            async move {
                b_registered.notify_one();
                std::future::pending::<()>().await;
                Ok::<i32, IpcError>(2)
            }
        };

        let a_future = async {
            let r = race_cancel_timeout(&m, id.to_string(), 60_000, work_a).await;
            a_done.notify_one();
            r
        };
        let b_future = async {
            a_registered.notified().await;
            race_cancel_timeout(&m, id.to_string(), 2_000, work_b).await
        };

        let orchestrator = async {
            b_registered.notified().await; // both registered; map[id] now holds B's notify
            release_a.notify_one(); // let A finish → A's DeregisterGuard drops
            a_done.notified().await; // A's guard has dropped
            // Cancel by id, mirroring grpc_cancel.
            if let Some(n) = m.lock().unwrap().get(id).cloned() {
                n.notify_one();
            }
        };

        let (_a, b, _o) = tokio::join!(a_future, b_future, orchestrator);
        match b {
            Err(IpcError::Cancelled) => {}
            other => panic!("expected B cancelled, got {other:?}"),
        }
    }

    // ---- stream_open_impl over a scripted FakeTransport + a real Channel ------------

    use crate::ipc::{MethodKindIpc, StreamEventIpc};
    use handshaker_core::grpc::testing::{chunk_bytes, fixture_cached_contract, FakeTransport, StreamScript};
    use handshaker_core::grpc::transport::StreamEnd;
    use handshaker_core::grpc::{ContractCache as _, ContractKey, InMemoryContractCache};
    use handshaker_core::send::Sender;
    use std::sync::Arc;
    use tauri::ipc::{Channel, InvokeResponseBody};

    /// `AppState` whose `Sender` runs over `transport` with the fixture contract already
    /// cached for `127.0.0.1:1` (plaintext), so Open needs no network and no reflection.
    fn state_over(transport: Arc<FakeTransport>) -> AppState {
        let cache = Arc::new(InMemoryContractCache::new());
        cache.put(
            ContractKey { address: "127.0.0.1:1".into(), tls: false },
            fixture_cached_contract(),
        );
        let tokens: Arc<dyn handshaker_core::auth::TokenSource> =
            Arc::new(handshaker_core::auth::StaticTokenSource {
                header: handshaker_core::auth::AuthCredentials {
                    header_name: "authorization".into(),
                    header_value: "Bearer t".into(),
                },
            });
        let sender = Arc::new(Sender::new(
            transport,
            tokens,
            cache.clone(),
            Arc::new(handshaker_core::vars::builtins::SystemBuiltins),
        ));
        AppState { sender, contract_cache: cache, ..AppState::default() }
    }

    fn scripted(script: StreamScript) -> Arc<FakeTransport> {
        let t = Arc::new(FakeTransport::default());
        *t.stream_script.try_lock().unwrap() = Some(script);
        t
    }

    fn stream_draft() -> SendDraftIpc {
        SendDraftIpc {
            address_template: "127.0.0.1:1".into(),
            tls_override: Some(false),
            service: "test.Echo".into(),
            method: "ServerStream".into(),
            body_template: r#"{"id":"hi"}"#.into(),
            metadata: vec![],
            auth: SavedAuthConfigIpc::None,
        }
    }

    fn no_ctx() -> SendCtxIpc {
        SendCtxIpc { collection_id: None, env_name: None }
    }

    /// A real `Channel` (no webview) whose serialized bodies land on an mpsc receiver.
    fn json_channel() -> (Channel<StreamEventIpc>, tokio::sync::mpsc::UnboundedReceiver<String>) {
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<String>();
        let ch = Channel::new(move |body| {
            if let InvokeResponseBody::Json(s) = body {
                let _ = tx.send(s);
            }
            Ok(())
        });
        (ch, rx)
    }

    async fn next_json(rx: &mut tokio::sync::mpsc::UnboundedReceiver<String>) -> serde_json::Value {
        let s = tokio::time::timeout(Duration::from_secs(5), rx.recv())
            .await
            .expect("event within 5s")
            .expect("channel alive");
        serde_json::from_str(&s).expect("valid JSON body")
    }

    fn pong_bytes(id: &str) -> bytes::Bytes {
        use prost::Message as _;
        let desc = handshaker_core::grpc::testing::fixture_pool()
            .get_message_by_name("test.Pong")
            .unwrap();
        let mut m = prost_reflect::DynamicMessage::new(desc);
        m.set_field_by_name("id", prost_reflect::Value::String(id.into()));
        bytes::Bytes::from(m.encode_to_vec())
    }

    #[tokio::test]
    async fn stream_open_resolves_at_opened_and_streams_the_event_sequence_on_the_channel() {
        let transport = scripted(StreamScript {
            headers: HashMap::from([("x-h".to_string(), "v".to_string())]),
            items: vec![
                Ok(pong_bytes("a")),
                Ok(pong_bytes("b")),
                Err(StreamEnd::ok(HashMap::from([("x-t".to_string(), "1".to_string())]))),
            ],
            ..Default::default()
        });
        let state = state_over(transport.clone());
        let (ch, mut rx) = json_channel();

        stream_open_impl(&state, stream_draft(), no_ctx(), "rid".into(), MethodKindIpc::Server, quick_opts(), ch)
            .await
            .expect("Ok at Opened");

        let opened = next_json(&mut rx).await;
        assert_eq!(opened["type"], "Opened");
        assert_eq!(opened["kind"], "server");
        assert_eq!(opened["auth_used"]["kind"], "none");
        assert_eq!(opened["tls_used"], false);
        let headers = next_json(&mut rx).await;
        assert_eq!(headers["type"], "Headers");
        assert_eq!(headers["metadata"]["x-h"], "v");
        for (i, id) in [(1, "a"), (2, "b")] {
            let m = next_json(&mut rx).await;
            assert_eq!(m["type"], "Message");
            assert_eq!(m["index"], i);
            assert_eq!(m["preview"], format!(r#"{{"id":"{id}"}}"#));
            assert!(m["json"].is_string());
            assert!(m["at_ms"].as_f64().unwrap() > 1.6e12);
            assert_eq!(m["size_bytes"], pong_bytes(id).len());
        }
        let end = next_json(&mut rx).await;
        assert_eq!(end["type"], "End");
        assert_eq!(end["status_code"], 0);
        assert_eq!(end["message_count"], 2);
        assert_eq!(end["trailing_metadata"]["x-t"], "1");

        // The handle is registered under the request id; the store holds both rows.
        let call = state.streams.get("rid").expect("registered");
        assert_eq!(call.message_count(), 2);
        // The Open ran under the cancel race and deregistered from the unary map.
        assert!(state.in_flight.lock().unwrap().is_empty());
        // Deadline pref → core phase timer, and the wire saw the server-streaming shape.
        assert_eq!(transport.last_outbound.lock().await.as_ref().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn stream_open_pre_open_fault_is_err_and_nothing_is_on_the_channel() {
        let mut draft = stream_draft();
        draft.address_template = "{{host}}".into(); // unresolvable: no env
        let state = state_over(scripted(StreamScript::default()));
        let (ch, mut rx) = json_channel();

        let err = stream_open_impl(&state, draft, no_ctx(), "rid".into(), MethodKindIpc::Server, quick_opts(), ch)
            .await
            .unwrap_err();

        assert!(matches!(err, IpcError::UnresolvedVars { .. }), "{err:?}");
        assert!(rx.try_recv().is_err(), "no event before Opened");
        assert!(state.streams.get("rid").is_none(), "nothing registered");
    }

    /// The kind gate reaches the frontend as the structured `MethodKindMismatch` — a
    /// pre-Open `Err` like any other: no event, nothing registered, transport untouched.
    #[tokio::test]
    async fn stream_open_with_a_stale_kind_is_a_pre_open_method_kind_mismatch() {
        let transport = scripted(StreamScript::default());
        let state = state_over(transport.clone());
        let (ch, mut rx) = json_channel();

        // A `server` kind resolves the body at Open (the gate follows the shared prefix),
        // so keep it var-free: the mismatch must be the only fault.
        let draft = SendDraftIpc { body_template: r#"{"id":"hi"}"#.into(), ..bidi_draft() };
        let err = stream_open_impl(&state, draft, no_ctx(), "rid".into(), MethodKindIpc::Server, quick_opts(), ch)
            .await
            .unwrap_err();

        match err {
            IpcError::MethodKindMismatch { service, method, expected, actual } => {
                assert_eq!((service.as_str(), method.as_str()), ("test.Echo", "Bidi"));
                assert_eq!((expected, actual), (MethodKindIpc::Server, MethodKindIpc::Bidi));
            }
            other => panic!("got {other:?}"),
        }
        assert!(rx.try_recv().is_err(), "no event before Opened");
        assert!(state.streams.get("rid").is_none(), "nothing registered");
        assert_eq!(transport.stream_calls.load(std::sync::atomic::Ordering::Relaxed), 0);
    }

    #[tokio::test]
    async fn stream_open_replaces_an_earlier_call_under_the_same_id() {
        let state = state_over(scripted(StreamScript { hang: true, ..Default::default() }));
        let (ch, _rx) = json_channel();
        stream_open_impl(&state, stream_draft(), no_ctx(), "rid".into(), MethodKindIpc::Server, quick_opts(), ch)
            .await
            .expect("first open");
        let first = state.streams.get("rid").unwrap();

        // A second Open of the same step: a fresh scripted transport, the same registry.
        let second_transport = scripted(StreamScript { hang: true, ..Default::default() });
        let state2 = AppState { streams: state.streams.clone(), ..state_over(second_transport) };
        let (ch2, _rx2) = json_channel();
        stream_open_impl(&state2, stream_draft(), no_ctx(), "rid".into(), MethodKindIpc::Server, quick_opts(), ch2)
            .await
            .expect("second open");

        assert_eq!(state.streams.len(), 1);
        assert!(!Arc::ptr_eq(&first, &state.streams.get("rid").unwrap()), "replaced");
        drop(first);
    }

    #[tokio::test]
    async fn grpc_cancel_reaches_the_stream_registry_when_no_unary_call_holds_the_id() {
        let state = state_over(scripted(StreamScript {
            items: vec![Ok(pong_bytes("a"))],
            hang: true,
            ..Default::default()
        }));
        let (ch, mut rx) = json_channel();
        stream_open_impl(&state, stream_draft(), no_ctx(), "rid".into(), MethodKindIpc::Server, quick_opts(), ch)
            .await
            .expect("open");
        // Drain up to the first message so the call is provably live.
        loop {
            if next_json(&mut rx).await["type"] == "Message" {
                break;
            }
        }

        grpc_cancel_impl(&state, "rid");

        let call = state.streams.get("rid").expect("cancel keeps the handle (store) registered");
        assert!(call.is_cancelled());
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(call.is_finished());
        assert!(rx.try_recv().is_err(), "cancel is not an event; nothing follows it");
        assert_eq!(call.message_count(), 1, "received rows stay");

        // stream_release frees the store.
        assert!(state.streams.release("rid"));
        assert!(state.streams.get("rid").is_none());
    }

    #[tokio::test]
    async fn stream_message_returns_the_full_pretty_json_of_one_stored_row() {
        let state = state_over(scripted(StreamScript {
            items: vec![Ok(pong_bytes("a")), Ok(pong_bytes("b")), Err(StreamEnd::ok(HashMap::new()))],
            ..Default::default()
        }));
        let (ch, mut rx) = json_channel();
        stream_open_impl(&state, stream_draft(), no_ctx(), "rid".into(), MethodKindIpc::Server, quick_opts(), ch)
            .await
            .expect("open");
        loop {
            if next_json(&mut rx).await["type"] == "End" {
                break;
            }
        }

        let json = stream_message_impl(&state, "rid", 2).expect("row 2");
        assert!(json.contains('\n'), "pretty: {json}");
        assert!(json.contains(r#""id": "b""#), "{json}");
        // The store survives the End; an unknown index / id is a typed error.
        match stream_message_impl(&state, "rid", 3) {
            Err(IpcError::StreamMessageNotFound { request_id, index }) => {
                assert_eq!((request_id.as_str(), index), ("rid", 3));
            }
            other => panic!("expected StreamMessageNotFound, got {other:?}"),
        }
        assert!(matches!(
            stream_message_impl(&state, "ghost", 1),
            Err(IpcError::StreamMessageNotFound { .. })
        ));
        // Released → gone.
        state.streams.release("rid");
        assert!(matches!(
            stream_message_impl(&state, "rid", 1),
            Err(IpcError::StreamMessageNotFound { .. })
        ));
    }

    #[tokio::test]
    async fn grpc_cancel_prefers_the_unary_registry_when_both_hold_the_id() {
        let state = state_over(scripted(StreamScript { hang: true, ..Default::default() }));
        let (ch, _rx) = json_channel();
        stream_open_impl(&state, stream_draft(), no_ctx(), "rid".into(), MethodKindIpc::Server, quick_opts(), ch)
            .await
            .expect("open");
        let unary = Arc::new(Notify::new());
        state.in_flight.lock().unwrap().insert("rid".into(), unary.clone());

        grpc_cancel_impl(&state, "rid");

        // The unary Notify got the permit; the stream call was left alone.
        tokio::time::timeout(Duration::from_millis(200), unary.notified())
            .await
            .expect("unary notify fired");
        assert!(!state.streams.get("rid").unwrap().is_cancelled());
    }

    /// The lost-cancel window: a `grpc_cancel` that lands while the Open is completing —
    /// here fired from inside the channel callback at `Opened`, i.e. after the call exists
    /// but before the command has registered it — must still cancel the stream call.
    #[tokio::test]
    async fn grpc_cancel_during_the_open_hand_off_still_cancels_the_stream_call() {
        let state = Arc::new(state_over(scripted(StreamScript { hang: true, ..Default::default() })));
        let ch: Channel<StreamEventIpc> = {
            let state = state.clone();
            Channel::new(move |body| {
                if let InvokeResponseBody::Json(json) = &body {
                    if json.contains(r#""type":"Opened""#) {
                        grpc_cancel_impl(&state, "rid");
                    }
                }
                Ok(())
            })
        };

        stream_open_impl(&state, stream_draft(), no_ctx(), "rid".into(), MethodKindIpc::Server, quick_opts(), ch)
            .await
            .expect("Open resolves at Opened");

        let call = state.streams.get("rid").expect("registered under the id");
        assert!(call.is_cancelled(), "the cancel that raced the hand-off landed on the call");
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(call.is_finished());
        assert!(state.in_flight.lock().unwrap().is_empty());
    }

    /// Channel-drop safety net, at `Opened`: `send` already fails on the first event (the
    /// webview is gone) — the call must not stay registered with nobody to release it.
    #[tokio::test]
    async fn stream_open_frees_the_call_when_the_channel_is_dead_at_opened() {
        let state = state_over(scripted(StreamScript { hang: true, ..Default::default() }));
        let ch: Channel<StreamEventIpc> = Channel::new(|_| Err(tauri::Error::WebviewNotFound));

        stream_open_impl(&state, stream_draft(), no_ctx(), "rid".into(), MethodKindIpc::Server, quick_opts(), ch)
            .await
            .expect("Open still resolves; the dead listener is not the caller's error");

        assert!(state.streams.is_empty(), "dead channel at Opened → call cancelled and released");
    }

    /// Channel-drop safety net, mid-stream: the channel dies after the call is registered —
    /// the callback itself cancels the call and frees its store.
    #[tokio::test]
    async fn stream_open_frees_the_call_when_the_channel_dies_mid_stream() {
        let state = state_over(scripted(StreamScript {
            items: vec![Ok(pong_bytes("a")), Ok(pong_bytes("b"))],
            hang: true,
            ..Default::default()
        }));
        let sent = Arc::new(std::sync::atomic::AtomicU32::new(0));
        let ch: Channel<StreamEventIpc> = {
            let sent = sent.clone();
            // Opened and Headers go through; the first Message finds the webview gone.
            Channel::new(move |_| {
                if sent.fetch_add(1, std::sync::atomic::Ordering::SeqCst) < 2 {
                    Ok(())
                } else {
                    Err(tauri::Error::WebviewNotFound)
                }
            })
        };

        stream_open_impl(&state, stream_draft(), no_ctx(), "rid".into(), MethodKindIpc::Server, quick_opts(), ch)
            .await
            .expect("open");

        tokio::time::timeout(Duration::from_secs(2), async {
            while !state.streams.is_empty() {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("the failed send released the call within 2s");
        assert!(sent.load(std::sync::atomic::Ordering::SeqCst) >= 3, "Opened, Headers, then the failing Message");
    }

    // ---- stream_send_impl / stream_half_close_impl ------------------------------------

    fn bidi_draft() -> SendDraftIpc {
        SendDraftIpc { method: "Bidi".into(), body_template: r#"{"id":"{{who}}"}"#.into(), ..stream_draft() }
    }

    /// `dev` env with `who = <value>` in the state's env store.
    fn put_env(state: &AppState, who: &str) {
        let mut variables = indexmap::IndexMap::new();
        variables.insert("who".to_string(), who.to_string());
        state
            .env_store
            .upsert(handshaker_core::env::Environment { name: "dev".into(), variables, color: None })
            .unwrap();
    }

    fn dev_ctx() -> SendCtxIpc {
        SendCtxIpc { collection_id: None, env_name: Some("dev".into()) }
    }

    #[tokio::test]
    async fn stream_send_acks_the_resolved_row_under_the_shared_index_and_half_close_ends_the_call() {
        let transport = scripted(StreamScript {
            echo: true,
            end_on_half_close: Some(StreamEnd::ok(HashMap::new())),
            ..Default::default()
        });
        let state = state_over(transport.clone());
        put_env(&state, "a");
        let (ch, mut rx) = json_channel();
        stream_open_impl(&state, bidi_draft(), dev_ctx(), "rid".into(), MethodKindIpc::Bidi, quick_opts(), ch)
            .await
            .expect("open");
        assert_eq!(next_json(&mut rx).await["type"], "Opened");
        assert_eq!(next_json(&mut rx).await["type"], "Headers");

        // The ack is the → row: resolved against the env of this moment.
        let ack = stream_send_impl(&state, "rid", r#"{"id":"{{who}}"}"#, &dev_ctx()).await.expect("send");
        let ack_json = serde_json::to_value(&ack).unwrap();
        assert_eq!(ack_json["index"], 1);
        assert_eq!(ack_json["preview"], r#"{"id":"a"}"#);
        assert_eq!(ack_json["json"], "{\n  \"id\": \"a\"\n}");
        assert_eq!(ack_json["size_bytes"], pong_bytes("a").len());
        assert!(ack_json["at_ms"].as_f64().unwrap() > 1.6e12);
        // The echo continues the shared numbering on the channel.
        let echoed = next_json(&mut rx).await;
        assert_eq!(echoed["type"], "Message");
        assert_eq!(echoed["index"], 2);

        // The env changes mid-stream: the next message follows it (auth would not).
        put_env(&state, "b");
        let ack = stream_send_impl(&state, "rid", r#"{"id":"{{who}}"}"#, &dev_ctx()).await.expect("send 2");
        assert_eq!((ack.index, ack.preview.as_str()), (3, r#"{"id":"b"}"#));
        assert_eq!(next_json(&mut rx).await["index"], 4);

        stream_half_close_impl(&state, "rid").expect("half-close");
        let end = next_json(&mut rx).await;
        assert_eq!(end["type"], "End");
        assert_eq!(end["status_code"], 0);
        assert_eq!(end["message_count"], 2);
        // Both directions are in the store, decodable through `stream_message`.
        let sent = stream_message_impl(&state, "rid", 3).expect("→ row 3");
        assert!(sent.contains(r#""id": "b""#), "{sent}");
    }

    #[tokio::test]
    async fn stream_send_and_half_close_are_stream_closed_before_opened_and_after_half_close() {
        let state = state_over(scripted(StreamScript { hang: true, ..Default::default() }));
        put_env(&state, "a");

        // Before Opened: nothing is registered under the id.
        match stream_send_impl(&state, "rid", "{}", &dev_ctx()).await.unwrap_err() {
            IpcError::StreamClosed { request_id } => assert_eq!(request_id, "rid"),
            other => panic!("expected StreamClosed, got {other:?}"),
        }
        assert!(matches!(stream_half_close_impl(&state, "rid"), Err(IpcError::StreamClosed { .. })));

        let (ch, mut rx) = json_channel();
        stream_open_impl(&state, bidi_draft(), dev_ctx(), "rid".into(), MethodKindIpc::Bidi, quick_opts(), ch)
            .await
            .expect("open");
        assert_eq!(next_json(&mut rx).await["type"], "Opened");
        stream_half_close_impl(&state, "rid").expect("half-close");
        stream_half_close_impl(&state, "rid").expect("idempotent");

        // After half-close: refused, never silently dropped.
        match stream_send_impl(&state, "rid", "{}", &dev_ctx()).await.unwrap_err() {
            IpcError::StreamClosed { request_id } => assert_eq!(request_id, "rid"),
            other => panic!("expected StreamClosed, got {other:?}"),
        }
        assert!(state.streams.get("rid").is_some(), "the call and its store stay registered");
    }

    #[tokio::test]
    async fn stream_send_unresolved_var_is_unresolved_vars_and_leaves_the_call_open() {
        let state = state_over(scripted(StreamScript { hang: true, ..Default::default() }));
        put_env(&state, "a");
        let (ch, mut rx) = json_channel();
        stream_open_impl(&state, bidi_draft(), dev_ctx(), "rid".into(), MethodKindIpc::Bidi, quick_opts(), ch)
            .await
            .expect("open");
        assert_eq!(next_json(&mut rx).await["type"], "Opened");

        match stream_send_impl(&state, "rid", r#"{"id":"{{nope}}"}"#, &dev_ctx()).await.unwrap_err() {
            IpcError::UnresolvedVars { unresolved, .. } => assert_eq!(unresolved, vec!["nope"]),
            other => panic!("expected UnresolvedVars, got {other:?}"),
        }
        assert!(matches!(
            stream_send_impl(&state, "rid", "not json {", &dev_ctx()).await.unwrap_err(),
            IpcError::EncodeRequest { .. }
        ));
        // Still open: the next valid message is #1.
        let ack = stream_send_impl(&state, "rid", r#"{"id":"{{who}}"}"#, &dev_ctx()).await.expect("send");
        assert_eq!(ack.index, 1);
        assert!(!state.streams.get("rid").unwrap().is_finished());
    }

    #[tokio::test]
    async fn race_cancel_handoff_registers_under_the_in_flight_lock_and_reports_a_raced_cancel() {
        let m = empty_in_flight();
        // `work` cancels itself by id right before completing — the notify lands on a
        // select! that then returns the work branch, so it must survive as a raced flag.
        let work = async {
            if let Some(n) = m.lock().unwrap().get("id").cloned() {
                n.notify_one();
            }
            Ok::<i32, IpcError>(7)
        };
        let (registered, raced) = race_cancel_handoff(&m, "id".to_string(), work, |v| {
            assert!(m.try_lock().is_err(), "register runs under the in_flight lock");
            v * 2
        })
        .await
        .unwrap();
        assert_eq!(registered, 14);
        assert!(raced, "the cancel that hit in_flight after work completed is reported");
        assert!(m.lock().unwrap().is_empty());
    }

    #[test]
    fn resolve_max_message_size_maps_zero_to_unlimited() {
        assert_eq!(resolve_max_message_size(0), usize::MAX);
    }

    #[test]
    fn resolve_max_message_size_passes_finite_value_through() {
        assert_eq!(resolve_max_message_size(16 * 1024 * 1024), 16 * 1024 * 1024usize);
    }

    #[test]
    fn call_options_ipc_maps_zero_bytes_to_unlimited() {
        let core = CallOptions { max_message_bytes: resolve_max_message_size(0), phase_timeout: None };
        assert_eq!(core.max_message_bytes, usize::MAX);
    }

    #[tokio::test]
    async fn race_cancels_when_notified_and_cleans_up() {
        let m = empty_in_flight();
        let id = "cancel-me".to_string();
        let work = std::future::pending::<Result<i32, IpcError>>();

        // Concurrent canceller on the same task (no spawn -> no 'static bound): wait until
        // the race registers its Notify, then fire notify_one().
        let canceller = async {
            loop {
                if let Some(n) = m.lock().unwrap().get(&id).cloned() {
                    n.notify_one();
                    break;
                }
                tokio::task::yield_now().await;
            }
        };

        let (raced, _) = tokio::join!(
            race_cancel_timeout(&m, id.clone(), 60_000, work),
            canceller,
        );
        match raced {
            Err(IpcError::Cancelled) => {}
            other => panic!("expected cancelled, got {other:?}"),
        }
        assert!(m.lock().unwrap().is_empty(), "registry entry removed on cancel");
    }

    // ---- Save messages + Assemble over the Stream store (ticket 18) ----------------

    fn download_draft() -> SendDraftIpc {
        SendDraftIpc { method: "Download".into(), ..stream_draft() }
    }

    #[tokio::test]
    async fn stream_save_messages_and_assemble_impls_read_the_store_and_write_through_a_file_sink() {
        let png = [0x89u8, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
        let state = state_over(scripted(StreamScript {
            items: vec![
                Ok(chunk_bytes(Some("logo.png"), None)),
                Ok(chunk_bytes(None, Some(&png))),
                Ok(chunk_bytes(None, Some(b"tail"))),
                Err(StreamEnd::ok(HashMap::new())),
            ],
            ..Default::default()
        }));
        let (ch, mut rx) = json_channel();
        stream_open_impl(&state, download_draft(), no_ctx(), "rid".into(), MethodKindIpc::Server, quick_opts(), ch)
            .await
            .expect("open");
        let opened = next_json(&mut rx).await;
        assert_eq!(opened["type"], "Opened");
        assert_eq!(opened["bytes_fields"], serde_json::json!(["data"]), "candidates ride Opened");
        loop {
            if next_json(&mut rx).await["type"] == "End" {
                break;
            }
        }

        // Save messages: one JSON array, oldest first, proto field names.
        let json = stream_save_messages_impl(&state.streams, "rid").expect("json");
        let arr: Vec<serde_json::Value> = serde_json::from_str(&json).unwrap();
        assert_eq!(arr.len(), 3);
        assert_eq!(arr[0]["name"], "logo.png");
        assert_eq!(arr[2]["data"], "dGFpbA==");

        // Assemble through a real file sink (what the command's dialog sibling hands core).
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("out.bin");
        let r = {
            let mut sink = std::io::BufWriter::new(std::fs::File::create(&path).unwrap());
            let r = stream_assemble_impl(&state.streams, "rid", "data", &mut sink).expect("assemble");
            std::io::Write::flush(&mut sink).unwrap();
            r
        };
        assert_eq!(std::fs::read(&path).unwrap(), [&png[..], b"tail"].concat());
        assert_eq!((r.written, r.total, r.size_bytes), (2, 3, 16));
        let ipc = AssembleResultIpc::from_core(r, path.to_string_lossy().into_owned());
        assert_eq!((ipc.written, ipc.total, ipc.size_bytes), (2, 3, 16.0));
        assert_eq!(stream_assemble_name_impl(&state.streams, "rid", "data", "S").unwrap(), "logo.png");

        // Typed refusals — before any dialog would open.
        match stream_assemble_name_impl(&state.streams, "rid", "name", "S") {
            Err(IpcError::StreamFieldNotFound { request_id, field_path }) => {
                assert_eq!((request_id.as_str(), field_path.as_str()), ("rid", "name"));
            }
            other => panic!("expected StreamFieldNotFound, got {other:?}"),
        }
        assert!(matches!(
            stream_assemble_impl(&state.streams, "rid", "nope", &mut Vec::new()),
            Err(IpcError::StreamFieldNotFound { .. })
        ));
        assert!(matches!(
            stream_save_messages_impl(&state.streams, "ghost"),
            Err(IpcError::StreamNotFound { ref request_id }) if request_id == "ghost"
        ));
        state.streams.release("rid");
        assert!(matches!(stream_save_messages_impl(&state.streams, "rid"), Err(IpcError::StreamNotFound { .. })));
        assert!(matches!(
            stream_assemble_impl(&state.streams, "rid", "data", &mut Vec::new()),
            Err(IpcError::StreamNotFound { .. })
        ));
    }

    #[tokio::test]
    async fn stream_assemble_default_name_falls_back_to_a_sniffed_stamp_name() {
        let state = state_over(scripted(StreamScript {
            items: vec![Ok(chunk_bytes(None, Some(&[0xff, 0xfe, 0x00]))), Err(StreamEnd::ok(HashMap::new()))],
            ..Default::default()
        }));
        let (ch, mut rx) = json_channel();
        stream_open_impl(&state, download_draft(), no_ctx(), "rid".into(), MethodKindIpc::Server, quick_opts(), ch)
            .await
            .expect("open");
        loop {
            if next_json(&mut rx).await["type"] == "End" {
                break;
            }
        }
        assert_eq!(
            stream_assemble_name_impl(&state.streams, "rid", "data", "2026-09-28T10-00-00").unwrap(),
            "stream-2026-09-28T10-00-00.bin"
        );
    }
}
