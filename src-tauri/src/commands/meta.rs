use specta::Type;
use tauri_specta::Event;

/// Smoke-command: returns version from Cargo.toml. Proves tauri-specta wiring works.
#[tauri::command]
#[specta::specta]
pub fn app_version() -> AppVersion {
    AppVersion {
        version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

#[derive(serde::Serialize, Type)]
pub struct AppVersion {
    pub version: String,
}

/// Placeholder event — actual events (ContractUpdated, ConnectionStateChanged) land in plan #2.
#[derive(Clone, serde::Serialize, serde::Deserialize, Type, Event)]
pub struct AppReady {
    pub version: String,
}
