//! Turn a `SavedRequest` + its folder ancestors + collection + active env into a
//! fully-resolved `EffectiveRequest` (master spec §5.5, three-step walk).
//!
//! Pure except for the `std::env` read inside auth resolution → fully testable.

use std::collections::HashMap;

use crate::auth::{resolve_auth, AuthByEnv};
use crate::env::Environment;
use crate::error::CoreError;
use crate::grpc::GrpcTarget;
use crate::vars::{resolve_string, VariableSet};

use super::{Collection, EffectiveRequest, Folder, SavedRequest};

/// Resolve one request. `ancestors` is the folder chain from OUTERMOST → INNERMOST
/// (the `Collection` is passed separately; only folders appear here).
/// `active_env` is `None` for "No environment".
pub fn resolve_request(
    request: &SavedRequest,
    ancestors: &[&Folder],
    collection: &Collection,
    active_env: Option<&Environment>,
) -> Result<EffectiveRequest, CoreError> {
    // --- 1. Variables (priority env > collection) ---
    let empty = HashMap::new();
    let env_vars = active_env.map(|e| &e.variables).unwrap_or(&empty);
    let vars = VariableSet { env: env_vars, collection: &collection.variables };

    let address = resolve_string(&request.address_template, &vars)?;
    let body_json = resolve_string(&request.body_template, &vars)?;
    let mut metadata = HashMap::with_capacity(request.metadata.len());
    for (k, v) in &request.metadata {
        // Keys are literal; only values are templated.
        metadata.insert(k.clone(), resolve_string(v, &vars)?);
    }

    // --- 2. TLS ---
    let tls = request.tls_override.unwrap_or(collection.default_tls);
    let target = GrpcTarget::new(address, tls, collection.skip_tls_verify)?;

    // --- 3. Auth (nearest node defining a config for the active env wins) ---
    let auth = match active_env {
        None => None,
        Some(env) => resolve_auth_chain(request, ancestors, collection, &env.name)?,
    };

    Ok(EffectiveRequest {
        target,
        service: request.service.clone(),
        method: request.method.clone(),
        body_json,
        metadata,
        auth,
    })
}

/// Walk Request → innermost Folder → … → Collection; resolve the first node that
/// defines a config for `env_name`. No node defines one → unauthenticated (`None`).
fn resolve_auth_chain(
    request: &SavedRequest,
    ancestors: &[&Folder],
    collection: &Collection,
    env_name: &str,
) -> Result<Option<crate::auth::AuthCredentials>, CoreError> {
    let mut chain: Vec<&AuthByEnv> = Vec::with_capacity(ancestors.len() + 2);
    chain.push(&request.auth_by_env);
    for folder in ancestors.iter().rev() {
        chain.push(&folder.auth_by_env);
    }
    chain.push(&collection.auth_by_env);

    for abe in chain {
        if let Some(cfg) = abe.for_env(env_name) {
            return resolve_auth(cfg);
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{EnvVarAuthConfig, SavedAuthConfig};
    use crate::collections::ids::{CollectionId, ItemId};
    use crate::collections::Item;
    use uuid::Uuid;

    fn env(name: &str, kv: &[(&str, &str)]) -> Environment {
        Environment {
            name: name.to_string(),
            variables: kv.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
        }
    }

    fn base_collection(vars: &[(&str, &str)]) -> Collection {
        Collection {
            id: CollectionId(Uuid::from_u128(1)),
            name: "c".into(),
            items: vec![],
            variables: vars.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
            auth_by_env: AuthByEnv::default(),
            default_tls: false,
            skip_tls_verify: false,
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
            metadata: HashMap::new(),
            auth_by_env: AuthByEnv::default(),
            tls_override: None,
        }
    }

    #[test]
    fn resolves_address_and_body_env_over_collection() {
        let coll = base_collection(&[("host", "coll:1"), ("uid", "cuid")]);
        let active = env("prod", &[("host", "api:443")]);
        let mut req = base_request();
        req.metadata.insert("x-trace".into(), "{{uid}}".into());
        let eff = resolve_request(&req, &[], &coll, Some(&active)).unwrap();
        assert_eq!(eff.target.address, "api:443"); // env wins
        assert_eq!(eff.body_json, r#"{"id":"cuid"}"#); // collection fills uid
        assert_eq!(eff.metadata.get("x-trace"), Some(&"cuid".to_string()));
    }

    #[test]
    fn unresolved_variable_errors() {
        let coll = base_collection(&[]);
        let active = env("prod", &[]);
        let req = base_request(); // {{host}} unresolved
        match resolve_request(&req, &[], &coll, Some(&active)).unwrap_err() {
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
            resolve_request(&req, &[], &coll, Some(&active)).unwrap_err(),
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
        let eff = resolve_request(&req, &[], &coll, Some(&active)).unwrap();
        assert!(eff.target.tls);
    }

    #[test]
    fn auth_nearest_some_wins_request_over_collection() {
        let var = "HANDSHAKER_TEST_AUTH_TASK5_REQ";
        std::env::set_var(var, "rtoken");
        let mut coll = base_collection(&[("host", "h:1"), ("uid", "u")]);
        coll.auth_by_env.configs.insert(
            "prod".into(),
            SavedAuthConfig::EnvVar(EnvVarAuthConfig {
                env_var: "SHOULD_NOT_BE_USED".into(),
                header_name: "authorization".into(),
                prefix: "Bearer ".into(),
            }),
        );
        let mut req = base_request();
        req.auth_by_env.configs.insert(
            "prod".into(),
            SavedAuthConfig::EnvVar(EnvVarAuthConfig {
                env_var: var.into(),
                header_name: "authorization".into(),
                prefix: "Bearer ".into(),
            }),
        );
        let active = env("prod", &[]);
        let eff = resolve_request(&req, &[], &coll, Some(&active)).unwrap();
        assert_eq!(eff.auth.unwrap().header_value, "Bearer rtoken");
        std::env::remove_var(var);
    }

    #[test]
    fn auth_falls_back_to_folder_then_collection() {
        let var = "HANDSHAKER_TEST_AUTH_TASK5_FOLDER";
        std::env::set_var(var, "ftoken");
        let coll = base_collection(&[("host", "h:1"), ("uid", "u")]);
        let folder = Folder {
            id: ItemId(Uuid::from_u128(9)),
            name: "f".into(),
            items: vec![],
            auth_by_env: {
                let mut a = AuthByEnv::default();
                a.configs.insert(
                    "prod".into(),
                    SavedAuthConfig::EnvVar(EnvVarAuthConfig {
                        env_var: var.into(),
                        header_name: "authorization".into(),
                        prefix: "Bearer ".into(),
                    }),
                );
                a
            },
        };
        let req = base_request(); // no auth on request
        let active = env("prod", &[]);
        let eff = resolve_request(&req, &[&folder], &coll, Some(&active)).unwrap();
        assert_eq!(eff.auth.unwrap().header_value, "Bearer ftoken");
        std::env::remove_var(var);
    }

    #[test]
    fn no_auth_config_anywhere_is_unauthenticated() {
        let coll = base_collection(&[("host", "h:1"), ("uid", "u")]);
        let active = env("prod", &[]);
        let req = base_request();
        let eff = resolve_request(&req, &[], &coll, Some(&active)).unwrap();
        assert!(eff.auth.is_none());
    }

    #[test]
    fn no_active_env_means_no_auth_and_empty_env_vars() {
        // host comes from collection; no env → env map empty, auth skipped.
        let coll = base_collection(&[("host", "h:1"), ("uid", "u")]);
        let req = base_request();
        let eff = resolve_request(&req, &[], &coll, None).unwrap();
        assert_eq!(eff.target.address, "h:1");
        assert!(eff.auth.is_none());
    }

    // Silence unused import warning when Item is only used in other test modules.
    #[allow(dead_code)]
    fn _uses_item(_: &Item) {}
}
