//! Call history commands: thin adapters over [`AppState::history_store`].
//! `history_record` is the only write. There is no edit, delete or clear.

use tauri::State;

use crate::ipc::error::IpcError;
use crate::ipc::history::{parse_call_id, CallRecordIpc, HistoryPageIpc};
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn history_list(state: State<'_, AppState>) -> Result<HistoryPageIpc, IpcError> {
    Ok(HistoryPageIpc::from_core(state.history_store.list()))
}

/// `None` when the call was evicted, never recorded, or its body is gone.
#[tauri::command]
#[specta::specta]
pub async fn history_get(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<CallRecordIpc>, IpcError> {
    let record = state.history_store.get(parse_call_id(&id)?)?;
    Ok(record.map(CallRecordIpc::from_core))
}

/// Persist one finished call and return the page after it. Appending an id twice is a
/// no-op that returns the current page.
#[tauri::command]
#[specta::specta]
pub async fn history_record(
    state: State<'_, AppState>,
    record: CallRecordIpc,
) -> Result<HistoryPageIpc, IpcError> {
    let page = state.history_store.append(record.into_core()?)?;
    Ok(HistoryPageIpc::from_core(page))
}
