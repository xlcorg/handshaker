//! Plain HTTP Send: an adapter over core `Sender::send_http`. Store reads, the
//! cancel/timeout race, and DTO mapping. No HTTP knowledge lives here.

use handshaker_core::http::HttpCallOptions;
use tauri::State;

use crate::commands::call::{ctx_refs, race_cancel_timeout, resolve_max_message_size};
use crate::ipc::http::{HttpSendReportIpc, HttpTemplateIpc};
use crate::ipc::{CallOptionsIpc, IpcError, SendCtxIpc};
use crate::state::AppState;

/// A status `>= 400` arrives in the report, not as `Err`. `Err` covers resolve failure,
/// an invalid URL, auth preparation, transport failure, timeout and cancel.
pub(crate) async fn http_send_impl(
    state: &AppState,
    request: HttpTemplateIpc,
    ctx: SendCtxIpc,
    request_id: String,
    opts: CallOptionsIpc,
) -> Result<HttpSendReportIpc, IpcError> {
    let template = request.into_core();
    let (collection, active_env) = ctx_refs(state, &ctx);
    let http_opts = HttpCallOptions {
        max_body_bytes: resolve_max_message_size(opts.max_message_bytes),
    };
    let sender = state.sender.clone();
    let work = async move {
        let report = sender
            .send_http(
                &template,
                collection.as_ref(),
                active_env.as_ref(),
                http_opts,
            )
            .await?;
        Ok(HttpSendReportIpc::from_core(report))
    };
    race_cancel_timeout(&state.in_flight, request_id, opts.timeout_ms, work).await
}

/// Send one HTTP request. Cancel it by `request_id` through `grpc_cancel`.
#[tauri::command]
#[specta::specta]
pub async fn http_send(
    state: State<'_, AppState>,
    request: HttpTemplateIpc,
    ctx: SendCtxIpc,
    request_id: String,
    opts: CallOptionsIpc,
) -> Result<HttpSendReportIpc, IpcError> {
    http_send_impl(&state, request, ctx, request_id, opts).await
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use handshaker_core::auth::{AuthCredentials, StaticTokenSource, TokenSource};
    use handshaker_core::error::CoreError;
    use handshaker_core::grpc::testing::FakeTransport;
    use handshaker_core::grpc::InMemoryContractCache;
    use handshaker_core::http::testing::FakeHttpTransport;
    use handshaker_core::http::{
        HeaderRow, HttpCallOptions, HttpResponse, HttpTransport, OutboundHttpRequest, ResponseBody,
    };
    use handshaker_core::send::Sender;
    use handshaker_core::vars::builtins::SystemBuiltins;
    use serde_json::json;
    use tokio::sync::Notify;

    use super::*;
    use crate::commands::grpc::grpc_cancel_impl;
    use crate::ipc::http::UrlProblemIpc;

    fn state_over(http: Arc<dyn HttpTransport>) -> AppState {
        let tokens: Arc<dyn TokenSource> = Arc::new(StaticTokenSource {
            header: AuthCredentials {
                header_name: "authorization".into(),
                header_value: "Bearer t".into(),
            },
        });
        let sender = Arc::new(Sender::new(
            Arc::new(FakeTransport::default()),
            http,
            tokens,
            Arc::new(InMemoryContractCache::new()),
            Arc::new(SystemBuiltins),
        ));
        AppState {
            sender,
            ..AppState::default()
        }
    }

    fn wire_template(url_template: &str) -> HttpTemplateIpc {
        serde_json::from_value(json!({
            "method": "POST",
            "url_template": url_template,
            "query": [
                { "key": "page", "value": "2", "enabled": true },
                { "key": "off", "value": "x", "enabled": false },
            ],
            "headers": [{ "key": "x-trace", "value": "t1", "enabled": true }],
            "body": { "kind": "json", "text": "{\"sku\":\"A1\"}" },
            "auth": { "kind": "none" },
        }))
        .expect("the frontend's wire shape parses")
    }

    fn no_ctx() -> SendCtxIpc {
        SendCtxIpc {
            collection_id: None,
            env_name: None,
        }
    }

    fn opts(timeout_ms: u32) -> CallOptionsIpc {
        CallOptionsIpc {
            timeout_ms,
            max_message_bytes: 0,
        }
    }

    /// Never answers. `entered` fires once the request reached the transport, which is
    /// after the race registered the id.
    #[derive(Default)]
    struct HangingHttp {
        entered: Notify,
    }

    #[async_trait::async_trait]
    impl HttpTransport for HangingHttp {
        async fn send(
            &self,
            _request: OutboundHttpRequest,
            _opts: HttpCallOptions,
        ) -> Result<HttpResponse, CoreError> {
            self.entered.notify_one();
            std::future::pending().await
        }
    }

    #[tokio::test]
    async fn http_send_reads_env_from_ctx_and_maps_the_report_to_wire() {
        let fake = FakeHttpTransport::replying([Ok(HttpResponse {
            status: 404,
            reason: "Not Found".into(),
            headers: vec![HeaderRow {
                name: "content-type".into(),
                value: "application/json".into(),
            }],
            body: ResponseBody::Json {
                text: "{\n  \"error\": \"gone\"\n}".into(),
            },
            size_bytes: 17,
            elapsed_ms: u64::from(u32::MAX) + 5,
        })]);
        let state = state_over(fake.clone());
        state
            .env_store
            .upsert(handshaker_core::env::Environment {
                name: "dev".into(),
                variables: indexmap::IndexMap::from([(
                    "base".to_string(),
                    "https://api.test".to_string(),
                )]),
                color: None,
            })
            .unwrap();
        let ctx = SendCtxIpc {
            collection_id: None,
            env_name: Some("dev".into()),
        };

        let report = http_send_impl(
            &state,
            wire_template("{{base}}/orders"),
            ctx,
            "rid".into(),
            opts(1000),
        )
        .await
        .unwrap();

        assert_eq!(
            serde_json::to_value(&report).unwrap(),
            json!({
                "response": {
                    "status": 404,
                    "reason": "Not Found",
                    "headers": [{ "name": "content-type", "value": "application/json" }],
                    "body": { "type": "json", "text": "{\n  \"error\": \"gone\"\n}" },
                    "size_bytes": 17,
                    "elapsed_ms": 4294967295u32,
                },
                "auth_used": { "kind": "none" },
            })
        );
        let sent = fake.sent();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].url, "https://api.test/orders?page=2");
        assert_eq!(sent[0].header("x-trace"), Some("t1"));
        assert_eq!(sent[0].header("content-type"), Some("application/json"));
        assert_eq!(sent[0].body.as_deref(), Some(&b"{\"sku\":\"A1\"}"[..]));
        assert!(state.in_flight.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn http_send_invalid_url_is_a_structured_error_and_sends_nothing() {
        let fake = FakeHttpTransport::replying([]);
        let state = state_over(fake.clone());

        let err = http_send_impl(
            &state,
            wire_template("ftp://files.test/a"),
            no_ctx(),
            "rid".into(),
            opts(1000),
        )
        .await
        .unwrap_err();

        match err {
            IpcError::InvalidUrl { problem } => {
                assert_eq!(
                    problem,
                    UrlProblemIpc::UnsupportedScheme {
                        scheme: "ftp".into()
                    }
                )
            }
            other => panic!("expected InvalidUrl, got {other:?}"),
        }
        assert_eq!(fake.sent().len(), 0);
    }

    #[tokio::test]
    async fn http_send_times_out_with_deadline_exceeded() {
        let state = state_over(Arc::new(HangingHttp::default()));

        let err = http_send_impl(
            &state,
            wire_template("https://api.test/orders"),
            no_ctx(),
            "rid".into(),
            opts(50),
        )
        .await
        .unwrap_err();

        match err {
            IpcError::DeadlineExceeded { timeout_ms } => assert_eq!(timeout_ms, 50),
            other => panic!("expected DeadlineExceeded, got {other:?}"),
        }
        assert!(state.in_flight.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn http_send_is_cancelled_by_request_id() {
        let http = Arc::new(HangingHttp::default());
        let state = state_over(http.clone());

        let send = http_send_impl(
            &state,
            wire_template("https://api.test/orders"),
            no_ctx(),
            "rid-7".into(),
            opts(60_000),
        );
        let cancel = async {
            http.entered.notified().await;
            grpc_cancel_impl(&state, "rid-7");
        };
        let (result, ()) = tokio::join!(send, cancel);

        assert!(matches!(result, Err(IpcError::Cancelled)), "got {result:?}");
        assert!(state.in_flight.lock().unwrap().is_empty());
    }
}
