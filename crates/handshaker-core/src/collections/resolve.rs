//! Turn a `SavedRequest` + collection + active env into a fully-resolved
//! `EffectiveRequest`. Auth resolves request → collection (folders carry none).
//!
//! Pure except for the `std::env` read inside auth resolution → fully testable.

use std::collections::HashMap;

use crate::auth::{pick_auth_config, resolve_auth};
use crate::env::Environment;
use crate::error::CoreError;
use crate::grpc::GrpcTarget;
use crate::vars::{resolve_template_with_diagnostics, VariableSet};

use super::{Collection, EffectiveRequest, SavedRequest};

/// Resolve one request. `collection` is `None` for an unbound draft (no collection
/// vars, no collection auth, TLS defaults `false`/`false`). `active_env` is `None`
/// for "No environment".
pub fn resolve_request(
    request: &SavedRequest,
    collection: Option<&Collection>,
    active_env: Option<&Environment>,
) -> Result<EffectiveRequest, CoreError> {
    // --- 1. Variables (priority env > collection) ---
    // VariableSet borrows `&HashMap` (resolution is order-agnostic). The stored
    // maps are now IndexMap, so convert here — the maps are tiny.
    let env_vars: HashMap<String, String> = active_env
        .map(|e| e.variables.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
        .unwrap_or_default();
    let collection_vars: HashMap<String, String> = collection
        .map(|c| c.variables.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
        .unwrap_or_default();
    let vars = VariableSet { env: &env_vars, collection: &collection_vars };

    let mut acc = ResolveAcc::default();
    let address = acc.take(&request.address_template, &vars);
    let body_json = acc.take(&request.body_template, &vars);
    let mut metadata = HashMap::with_capacity(request.metadata.len());
    for row in &request.metadata {
        if !row.enabled {
            continue; // disabled rows are not sent
        }
        // Keys are literal; only values are templated. Last enabled row wins on dup key.
        metadata.insert(row.key.clone(), acc.take(&row.value, &vars));
    }
    if let Some(err) = acc.into_failure() {
        return Err(err);
    }

    // --- 2. TLS ---
    let default_tls = collection.map_or(false, |c| c.default_tls);
    let skip_verify = collection.map_or(false, |c| c.skip_tls_verify);
    let tls = request.tls_override.unwrap_or(default_tls);
    let target = GrpcTarget::new(address, tls, skip_verify)?;

    // --- 3. Auth (nearest active config: request → collection; folders carry none) ---
    let collection_auth = collection.map(|c| &c.auth);
    let auth = match pick_auth_config(&request.auth, collection_auth, active_env.map(|e| e.name.as_str())) {
        Some(cfg) => resolve_auth(cfg)?, // sync path unchanged in this slice
        None => None,
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

/// Accumulates unresolved vars (deduped, encounter order) + first cycle across fields.
#[derive(Default)]
struct ResolveAcc {
    unresolved: Vec<String>,
    cycle: Option<Vec<String>>,
}

impl ResolveAcc {
    fn take(&mut self, template: &str, vars: &VariableSet<'_>) -> String {
        let report = resolve_template_with_diagnostics(template, vars);
        for v in report.unresolved_vars {
            if !self.unresolved.iter().any(|n| n == &v) {
                self.unresolved.push(v);
            }
        }
        if self.cycle.is_none() {
            self.cycle = report.cycle_chain;
        }
        report.resolved
    }

    fn into_failure(self) -> Option<CoreError> {
        if self.cycle.is_some() || !self.unresolved.is_empty() {
            Some(CoreError::ResolveFailed { unresolved: self.unresolved, cycle: self.cycle })
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{EnvVarAuthConfig, SavedAuthConfig};
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
        let eff = resolve_request(&req, Some(&coll), Some(&active)).unwrap();
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
        let eff = resolve_request(&req, Some(&coll), Some(&active)).unwrap();
        assert_eq!(eff.metadata.get("on"), Some(&"1".to_string()));
        assert!(eff.metadata.get("off").is_none());
    }

    #[test]
    fn resolve_failure_reports_all_unresolved_at_once() {
        let coll = base_collection(&[]); // nothing defined
        let active = env("prod", &[]);
        let mut req = base_request();
        req.address_template = "{{host}}".into();
        req.body_template = r#"{"id":"{{uid}}","x":"{{host}}"}"#.into();
        req.metadata = vec![MetadataRow { key: "k".into(), value: "{{tok}}".into(), enabled: true }];
        match resolve_request(&req, Some(&coll), Some(&active)).unwrap_err() {
            CoreError::ResolveFailed { unresolved, cycle } => {
                assert_eq!(cycle, None);
                // deduped, encounter order across address, body, metadata
                assert_eq!(unresolved, vec!["host".to_string(), "uid".to_string(), "tok".to_string()]);
            }
            other => panic!("expected ResolveFailed, got {other:?}"),
        }
    }

    #[test]
    fn resolve_failure_reports_cycle() {
        let mut coll = base_collection(&[]);
        coll.variables.insert("a".into(), "{{b}}".into());
        coll.variables.insert("b".into(), "{{a}}".into());
        let active = env("prod", &[]);
        let mut req = base_request();
        req.address_template = "{{a}}".into();
        req.body_template = "{}".into();
        match resolve_request(&req, Some(&coll), Some(&active)).unwrap_err() {
            CoreError::ResolveFailed { cycle: Some(chain), .. } => {
                assert_eq!(chain.first(), chain.last());
            }
            other => panic!("expected ResolveFailed cycle, got {other:?}"),
        }
    }

    #[test]
    fn builtin_in_body_is_not_unresolved() {
        let coll = base_collection(&[("host", "h:1")]);
        let active = env("prod", &[]);
        let mut req = base_request();
        req.body_template = r#"{"id":"{{$guid}}"}"#.into();
        let eff = resolve_request(&req, Some(&coll), Some(&active)).unwrap();
        assert_eq!(eff.body_json, r#"{"id":"{{$guid}}"}"#); // left literal for send-time expansion
    }

    #[test]
    fn tls_override_beats_collection_default() {
        let mut coll = base_collection(&[("host", "h:1"), ("uid", "u")]);
        coll.default_tls = false;
        let active = env("prod", &[]);
        let mut req = base_request();
        req.tls_override = Some(true);
        let eff = resolve_request(&req, Some(&coll), Some(&active)).unwrap();
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
        let eff = resolve_request(&req, Some(&coll), Some(&active)).unwrap();
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
        let eff = resolve_request(&req, Some(&coll), Some(&active)).unwrap();
        assert_eq!(eff.auth.unwrap().header_value, "Bearer ctoken");
        std::env::remove_var(var);
    }

    #[test]
    fn no_auth_config_anywhere_is_unauthenticated() {
        let coll = base_collection(&[("host", "h:1"), ("uid", "u")]);
        let active = env("prod", &[]);
        let req = base_request();
        let eff = resolve_request(&req, Some(&coll), Some(&active)).unwrap();
        assert!(eff.auth.is_none());
    }

    #[test]
    fn no_active_env_means_empty_env_vars() {
        // host comes from collection; no env → env map empty.
        let coll = base_collection(&[("host", "h:1"), ("uid", "u")]);
        let req = base_request();
        let eff = resolve_request(&req, Some(&coll), None).unwrap();
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
        let eff_dev = resolve_request(&request, Some(&collection), Some(&dev)).unwrap();
        assert!(eff_dev.auth.is_none());
        // prod ⇒ active ⇒ header present.
        let eff_prod = resolve_request(&request, Some(&collection), Some(&prod)).unwrap();
        assert_eq!(eff_prod.auth.unwrap().header_value, "Bearer secret");

        std::env::remove_var("HS_TEST_PROD_TOKEN");
    }
}
