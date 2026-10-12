//! Protocol-neutral call plumbing shared by the gRPC and HTTP commands: the per-request
//! cancel/timeout race over the `in_flight` registry, the ctx store reads, and the
//! body-size pref mapping.

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Notify;

use crate::ipc::{IpcError, SendCtxIpc};
use crate::state::{AppState, InFlight};

/// Map the IPC byte limit (gRPC message size, HTTP response body size) to a `usize`. The
/// sentinel `0` means "no limit" (the slider's Unlimited stop) → `usize::MAX`; any finite
/// value passes through.
pub(crate) fn resolve_max_message_size(raw: u32) -> usize {
    if raw == 0 {
        usize::MAX
    } else {
        raw as usize
    }
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
            if g.get(&self.id)
                .is_some_and(|n| Arc::ptr_eq(n, &self.notify))
            {
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
    race_cancel_handoff(in_flight, request_id, work, |v| v)
        .await
        .map(|(v, _)| v)
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
    let _guard = DeregisterGuard {
        map: in_flight,
        id: request_id.clone(),
        notify: notify.clone(),
    };

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
/// references, not data. Shared by Send, Open, Send message and HTTP Send.
pub(crate) fn ctx_refs(
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
