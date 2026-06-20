//! Turn a `SavedRequest` + collection + active env into a fully-resolved
//! `EffectiveRequest`. Auth resolves request → collection (folders carry none).
//!
//! Pure except for the `std::env` read inside auth resolution → fully testable.

use std::collections::HashMap;

use crate::auth::{auth_active_for_env, resolve_auth, SavedAuthConfig};
use crate::env::Environment;
use crate::error::CoreError;
use crate::grpc::GrpcTarget;
use crate::vars::{resolve_string, VariableSet};

use super::{Collection, EffectiveRequest, SavedRequest};

/// Resolve one request. The `Collection` is passed separately; folders carry no
/// auth, so no folder chain is needed. `active_env` is `None` for "No environment".
pub fn resolve_request(
    request: &SavedRequest,
    collection: &Collection,
    active_env: Option<&Environment>,
) -> Result<EffectiveRequest, CoreError> {
    // --- 1. Variables (priority env > collection) ---
    // VariableSet borrows `&HashMap` (resolution is order-agnostic). The stored
    // maps are now IndexMap, so convert here — the maps are tiny.
    let env_vars: HashMap<String, String> = active_env
        .map(|e| e.variables.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
        .unwrap_or_default();
    let collection_vars: HashMap<String, String> =
        collection.variables.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    let vars = VariableSet { env: &env_vars, collection: &collection_vars };

    let address = resolve_string(&request.address_template, &vars)?;
    let body_json = resolve_string(&request.body_template, &vars)?;
    let mut metadata = HashMap::with_capacity(request.metadata.len());
    for row in &request.metadata {
        if !row.enabled {
            continue; // disabled rows are not sent
        }
        // Keys are literal; only values are templated. Last enabled row wins on dup key.
        metadata.insert(row.key.clone(), resolve_string(&row.value, &vars)?);
    }

    // --- 2. TLS ---
    let tls = request.tls_override.unwrap_or(collection.default_tls);
    let target = GrpcTarget::new(address, tls, collection.skip_tls_verify)?;

    // --- 3. Auth (nearest active config: request → collection; folders carry none) ---
    let auth = resolve_auth_chain(request, collection, active_env.map(|e| e.name.as_str()))?;

    Ok(EffectiveRequest {
        target,
        service: request.service.clone(),
        method: request.method.clone(),
        body_json,
        metadata,
        auth,
    })
}

/// Nearest active non-`None` config wins: request first, then collection. A config
/// scoped to environments that excludes `active_env` is skipped (treated as absent).
fn resolve_auth_chain(
    request: &SavedRequest,
    collection: &Collection,
    active_env: Option<&str>,
) -> Result<Option<crate::auth::AuthCredentials>, CoreError> {
    for cfg in [&request.auth, &collection.auth] {
        let envs: &[String] = match cfg {
            SavedAuthConfig::None => continue,
            SavedAuthConfig::EnvVar(c) => &c.environments,
            SavedAuthConfig::OAuth2ClientCredentials(c) => &c.environments,
        };
        if !auth_active_for_env(envs, active_env) {
            continue;
        }
        return resolve_auth(cfg);
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::EnvVarAuthConfig;
    use crate::collections::ids::{CollectionId, ItemId};
    use crate::collections::MetadataRow;
    use uuid::Uuid;

    fn env(name: &str, kv: &[(&str, &str)]) -> Environment {
        Environment {
            name: name.to_string(),
            variables: kv.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
            color: None,
        }
    }

    fn base_collection(vars: &[(&str, &str)]) -> Collection {
        Collection {
            id: CollectionId(Uuid::from_u128(1)),
            name: "c".into(),
            items: vec![],
            variables: vars.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
            auth: SavedAuthConfig::None,
            default_tls: false,
            skip_tls_verify: false,
            pinned: false,
            description: None,
            created_at: 0.0,
            expanded: false,
        }
    }

    fn base_request() -> SavedRequest {
        SavedRequest {
            id: ItemId(Uuid::from_u128(2)),
            name: "r".into(),
            address_template: "{{host}}".into(),
            service: "pkg.Svc".into(),
            method: "Do".into(),
            body_template: r#"{"id":"{{uid}}"}"#.into(),
            metadata: vec![],
            auth: SavedAuthConfig::None,
            tls_override: None,
            last_used_at: None,
            use_count: 0,
        }
    }

    fn env_var_auth(env_var: &str) -> SavedAuthConfig {
        SavedAuthConfig::EnvVar(EnvVarAuthConfig {
            env_var: env_var.into(),
            header_name: "authorization".into(),
            prefix: "Bearer ".into(),
            environments: vec![],
        })
    }

    #[test]
    fn resolves_address_and_body_env_over_collection() {
        let coll = base_collection(&[("host", "coll:1"), ("uid", "cuid")]);
        let active = env("prod", &[("host", "api:443")]);
        let mut req = base_request();
        req.metadata = vec![MetadataRow {
            key: "x-trace".into(),
            value: "{{uid}}".into(),
            enabled: true,
        }];
        let eff = resolve_request(&req, &coll, Some(&active)).unwrap();
        assert_eq!(eff.target.address, "api:443"); // env wins
        assert_eq!(eff.body_json, r#"{"id":"cuid"}"#); // collection fills uid
        assert_eq!(eff.metadata.get("x-trace"), Some(&"cuid".to_string()));
    }

    #[test]
    fn disabled_metadata_row_is_skipped() {
        let coll = base_collection(&[("host", "h:1"), ("uid", "u")]);
        let active = env("prod", &[]);
        let mut req = base_request();
        req.metadata = vec![
            MetadataRow { key: "on".into(), value: "1".into(), enabled: true },
            MetadataRow { key: "off".into(), value: "2".into(), enabled: false },
        ];
        let eff = resolve_request(&req, &coll, Some(&active)).unwrap();
        assert_eq!(eff.metadata.get("on"), Some(&"1".to_string()));
        assert!(eff.metadata.get("off").is_none());
    }

    #[test]
    fn unresolved_variable_errors() {
        let coll = base_collection(&[]);
        let active = env("prod", &[]);
        let req = base_request(); // {{host}} unresolved
        match resolve_request(&req, &coll, Some(&active)).unwrap_err() {
            CoreError::UnresolvedVariable { name } => assert!(name == "host" || name == "uid"),
            other => panic!("expected UnresolvedVariable, got {other:?}"),
        }
    }

    #[test]
    fn variable_cycle_errors() {
        let mut coll = base_collection(&[]);
        coll.variables.insert("a".into(), "{{b}}".into());
        coll.variables.insert("b".into(), "{{a}}".into());
        let active = env("prod", &[]);
        let mut req = base_request();
        req.address_template = "{{a}}".into();
        req.body_template = "{}".into();
        assert!(matches!(
            resolve_request(&req, &coll, Some(&active)).unwrap_err(),
            CoreError::VariableCycle { .. }
        ));
    }

    #[test]
    fn tls_override_beats_collection_default() {
        let mut coll = base_collection(&[("host", "h:1"), ("uid", "u")]);
        coll.default_tls = false;
        let active = env("prod", &[]);
        let mut req = base_request();
        req.tls_override = Some(true);
        let eff = resolve_request(&req, &coll, Some(&active)).unwrap();
        assert!(eff.target.tls);
    }

    #[test]
    fn auth_nearest_some_wins_request_over_collection() {
        let var = "HANDSHAKER_TEST_AUTH_TASK5_REQ";
        std::env::set_var(var, "rtoken");
        let mut coll = base_collection(&[("host", "h:1"), ("uid", "u")]);
        coll.auth = env_var_auth("SHOULD_NOT_BE_USED");
        let mut req = base_request();
        req.auth = env_var_auth(var);
        let active = env("prod", &[]);
        let eff = resolve_request(&req, &coll, Some(&active)).unwrap();
        assert_eq!(eff.auth.unwrap().header_value, "Bearer rtoken");
        std::env::remove_var(var);
    }

    #[test]
    fn auth_falls_back_to_collection() {
        let var = "HANDSHAKER_TEST_AUTH_TASK5_COLL";
        std::env::set_var(var, "ctoken");
        let mut coll = base_collection(&[("host", "h:1"), ("uid", "u")]);
        coll.auth = env_var_auth(var);
        let req = base_request(); // no auth on request → collection's used
        let active = env("prod", &[]);
        let eff = resolve_request(&req, &coll, Some(&active)).unwrap();
        assert_eq!(eff.auth.unwrap().header_value, "Bearer ctoken");
        std::env::remove_var(var);
    }

    #[test]
    fn no_auth_config_anywhere_is_unauthenticated() {
        let coll = base_collection(&[("host", "h:1"), ("uid", "u")]);
        let active = env("prod", &[]);
        let req = base_request();
        let eff = resolve_request(&req, &coll, Some(&active)).unwrap();
        assert!(eff.auth.is_none());
    }

    #[test]
    fn no_active_env_means_empty_env_vars() {
        // host comes from collection; no env → env map empty.
        let coll = base_collection(&[("host", "h:1"), ("uid", "u")]);
        let req = base_request();
        let eff = resolve_request(&req, &coll, None).unwrap();
        assert_eq!(eff.target.address, "h:1");
        assert!(eff.auth.is_none());
    }

    #[test]
    fn collection_auth_scoped_to_prod_is_skipped_in_other_env() {
        use crate::auth::EnvVarAuthConfig;

        std::env::set_var("HS_TEST_PROD_TOKEN", "secret");
        // Build a collection whose auth is a prod-scoped env-var Bearer config.
        let mut collection = base_collection(&[("host", "h:1"), ("uid", "u")]);
        collection.auth = SavedAuthConfig::EnvVar(EnvVarAuthConfig {
            env_var: "HS_TEST_PROD_TOKEN".into(),
            header_name: "authorization".into(),
            prefix: "Bearer ".into(),
            environments: vec!["prod".into()],
        });
        let request = base_request(); // auth: SavedAuthConfig::None

        let dev = env("dev", &[]);
        let prod = env("prod", &[]);

        // dev ⇒ gated out ⇒ no auth header.
        let eff_dev = resolve_request(&request, &collection, Some(&dev)).unwrap();
        assert!(eff_dev.auth.is_none());
        // prod ⇒ active ⇒ header present.
        let eff_prod = resolve_request(&request, &collection, Some(&prod)).unwrap();
        assert_eq!(eff_prod.auth.unwrap().header_value, "Bearer secret");

        std::env::remove_var("HS_TEST_PROD_TOKEN");
    }
}
