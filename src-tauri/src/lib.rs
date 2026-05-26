//! Handshaker Tauri shell library.
//!
//! The library form exists so that mobile entry points (and tests) can call
//! `run()` directly. `main.rs` is a thin wrapper that delegates here on desktop.

mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
