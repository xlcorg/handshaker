use specta::Type;

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
