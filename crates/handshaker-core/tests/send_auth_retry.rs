mod common;

use handshaker_core::{
    auth::{AuthCredentials, OAuth2ClientCredentialsConfig, SavedAuthConfig, TokenSource},
    collections::{ids::ItemId, SavedRequest},
    error::CoreError,
    grpc::{invoke::CallOptions, transport::TonicTransport, InMemoryContractCache},
    send::Sender,
    vars::builtins::BuiltinGenerator,
};
use std::sync::{
    atomic::{AtomicBool, AtomicU32, Ordering},
    Arc,
};

#[derive(Default)]
struct ExpiredTokens(AtomicBool);

#[async_trait::async_trait]
impl TokenSource for ExpiredTokens {
    async fn header_for(
        &self,
        _: &OAuth2ClientCredentialsConfig,
    ) -> Result<AuthCredentials, CoreError> {
        Ok(AuthCredentials {
            header_name: "authorization".into(),
            header_value: if self.0.load(Ordering::SeqCst) {
                "Bearer fresh"
            } else {
                "Bearer expired"
            }
            .into(),
        })
    }

    fn invalidate(&self, _: &OAuth2ClientCredentialsConfig) {
        self.0.store(true, Ordering::SeqCst);
    }
}

#[derive(Default)]
struct Guids(AtomicU32);

impl BuiltinGenerator for Guids {
    fn generate(&self, name: &str) -> Option<String> {
        (name == "$guid").then(|| format!("id-{}", self.0.fetch_add(1, Ordering::SeqCst)))
    }
}

#[tokio::test]
async fn one_send_refreshes_rejected_token_and_replays_same_request_over_tonic() {
    let config = common::EchoConfig {
        required_unary_authorization: Some("Bearer fresh".into()),
        ..Default::default()
    };
    let seen = config.seen_unary_requests.clone();
    let (addr, _stop) = common::spawn_echo_server(config).await;
    let sender = Sender::new(
        Arc::new(TonicTransport::new()),
        Arc::new(ExpiredTokens::default()),
        Arc::new(InMemoryContractCache::new()),
        Arc::new(Guids::default()),
    );
    let request = SavedRequest {
        id: ItemId(uuid::Uuid::new_v4()),
        name: "retry".into(),
        address_template: addr.to_string(),
        service: "test.Echo".into(),
        method: "Send".into(),
        body_template: r#"{"id":"{{$guid}}"}"#.into(),
        metadata: vec![],
        auth: SavedAuthConfig::OAuth2ClientCredentials(OAuth2ClientCredentialsConfig {
            token_url: "https://idp.example/token".into(),
            client_id: "client".into(),
            client_secret: "secret".into(),
            scopes: vec![],
            header_name: "authorization".into(),
            prefix: "Bearer ".into(),
            environments: vec![],
        }),
        tls_override: Some(false),
        last_used_at: None,
        use_count: 0,
    };
    let report = sender
        .send(
            &request,
            None,
            None,
            CallOptions {
                max_message_bytes: usize::MAX,
                phase_timeout: None,
            },
        )
        .await
        .expect("send succeeds after token refresh");

    assert_eq!(report.outcome.status_code, 0);
    let response: serde_json::Value =
        serde_json::from_str(report.outcome.response_json.as_deref().unwrap()).unwrap();
    assert_eq!(
        response,
        serde_json::json!({"id": "id-0", "echoed": "echo: id-0"})
    );
    assert_eq!(
        *seen.lock().unwrap(),
        vec![
            ("Bearer expired".into(), "id-0".into()),
            ("Bearer fresh".into(), "id-0".into()),
        ]
    );
}
