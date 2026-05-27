//! Environment IPC commands. See spec §5.1.
//!
//! Each command is a thin `#[tauri::command]` wrapper over an `impl AppState`
//! method. The impl methods are directly unit-testable from `#[tokio::test]`
//! without Tauri's full `State<'_, T>` plumbing — see the `#[cfg(test)]` block
//! at the bottom of this file.

use handshaker_core::env::Environment;
use handshaker_core::error::CoreError;
use tauri::State;

use crate::ipc::env::EnvironmentIpc;
use crate::ipc::error::IpcError;
use crate::state::AppState;

impl AppState {
    /// Inner logic for `env_list`. Synchronous because the store's `list()` is sync.
    pub fn env_list_impl(&self) -> Vec<EnvironmentIpc> {
        self.env_store.list().into_iter().map(EnvironmentIpc::from).collect()
    }

    /// Inner logic for `env_active_get`. `None` ≡ "No environment".
    pub async fn env_active_get_impl(&self) -> Option<String> {
        self.active_env.read().await.clone()
    }

    /// Inner logic for `env_active_set`. Passing `None` always succeeds.
    /// Passing `Some(name)` errors with `InvalidTarget` if the env does not exist.
    pub async fn env_active_set_impl(&self, name: Option<String>) -> Result<(), CoreError> {
        if let Some(ref n) = name {
            if self.env_store.get(n).is_none() {
                return Err(CoreError::InvalidTarget(format!("no such env: `{n}`")));
            }
        }
        *self.active_env.write().await = name;
        Ok(())
    }

    /// Inner logic for `env_upsert`. Validation lives in `EnvironmentStore::upsert`.
    pub fn env_upsert_impl(&self, env: Environment) -> Result<(), CoreError> {
        self.env_store.upsert(env)
    }
}

#[tauri::command]
#[specta::specta]
pub async fn env_list(state: State<'_, AppState>) -> Result<Vec<EnvironmentIpc>, IpcError> {
    Ok(state.env_list_impl())
}

#[tauri::command]
#[specta::specta]
pub async fn env_active_get(state: State<'_, AppState>) -> Result<Option<String>, IpcError> {
    Ok(state.env_active_get_impl().await)
}

#[tauri::command]
#[specta::specta]
pub async fn env_active_set(
    state: State<'_, AppState>,
    name: Option<String>,
) -> Result<(), IpcError> {
    state.env_active_set_impl(name).await.map_err(IpcError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn env_upsert(state: State<'_, AppState>, env: EnvironmentIpc) -> Result<(), IpcError> {
    state.env_upsert_impl(Environment::from(env)).map_err(IpcError::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Arc;

    use handshaker_core::env::in_memory::InMemoryEnvironmentStore;
    use handshaker_core::env::EnvironmentStore;
    use tokio::sync::{Mutex, RwLock};

    /// Build an `AppState` for tests. `active` is the initial active-env value
    /// (`None` ≡ "No environment"); `envs` are pre-inserted into the store.
    fn build_state(envs: &[(&str, &[(&str, &str)])], active: Option<&str>) -> AppState {
        let store = InMemoryEnvironmentStore::new();
        for (name, vars) in envs {
            let mut map = HashMap::new();
            for (k, v) in *vars {
                map.insert(k.to_string(), v.to_string());
            }
            store
                .upsert(Environment {
                    name: name.to_string(),
                    variables: map,
                })
                .unwrap();
        }
        AppState {
            connection: Mutex::new(None),
            env_store: Arc::new(store),
            active_env: RwLock::new(active.map(|s| s.to_string())),
        }
    }

    #[tokio::test]
    async fn env_active_get_returns_none_on_fresh_state() {
        let state = AppState::default();
        assert_eq!(state.env_active_get_impl().await, None);
        assert!(state.env_list_impl().is_empty());
    }

    #[tokio::test]
    async fn env_active_set_accepts_none() {
        let state = build_state(&[("prod", &[])], Some("prod"));
        state.env_active_set_impl(None).await.unwrap();
        assert_eq!(state.env_active_get_impl().await, None);
    }

    #[tokio::test]
    async fn env_active_set_rejects_missing_some() {
        let state = AppState::default();
        let err = state
            .env_active_set_impl(Some("ghost".to_string()))
            .await
            .unwrap_err();
        match err {
            CoreError::InvalidTarget(msg) => assert!(msg.contains("ghost")),
            other => panic!("expected InvalidTarget, got {other:?}"),
        }
        assert_eq!(state.env_active_get_impl().await, None);
    }
}
