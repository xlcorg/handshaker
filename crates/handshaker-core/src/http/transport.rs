//! The network seam of `Sender::send_http`, and its one production implementation.

use std::time::Instant;

use crate::error::{error_chain, CoreError};

use super::body::classify_response;
use super::{HeaderRow, HttpCallOptions, HttpResponse, OutboundHttpRequest, ResponseBody};

const MAX_REDIRECTS: usize = 10;

/// It exists so the spine's invariants (one diagnosis before any network use, the
/// unauthenticated rule, header placement) are tested with an in-process fake, as
/// `GrpcTransport` is.
#[async_trait::async_trait]
pub trait HttpTransport: Send + Sync {
    /// One exchange. `Ok` for any HTTP status. `Err` only when no response was obtained
    /// (DNS, refused, TLS, protocol, body read).
    async fn send(
        &self,
        request: OutboundHttpRequest,
        opts: HttpCallOptions,
    ) -> Result<HttpResponse, CoreError>;
}

/// reqwest over rustls, no cookies and no decompression. Two clients built once,
/// verifying and permissive, picked by `request.skip_verify`. Redirects are followed only
/// while the host stays the one the user typed, so a credential under any header name
/// never leaves it; a cross-host 3xx is returned as the response.
pub struct ReqwestTransport {
    verifying: reqwest::Client,
    permissive: reqwest::Client,
}

impl ReqwestTransport {
    pub fn new(app_version: &str) -> Result<Self, CoreError> {
        let build = |skip_verify: bool| {
            reqwest::Client::builder()
                .use_rustls_tls()
                .danger_accept_invalid_certs(skip_verify)
                .user_agent(format!("Handshaker/{app_version}"))
                .referer(false)
                .redirect(reqwest::redirect::Policy::custom(same_host_redirects))
                .build()
                .map_err(|e| CoreError::Transport(error_chain(&e)))
        };
        Ok(Self {
            verifying: build(false)?,
            permissive: build(true)?,
        })
    }
}

fn same_host_redirects(attempt: reqwest::redirect::Attempt<'_>) -> reqwest::redirect::Action {
    let origin_host = attempt.previous().first().and_then(|u| u.host_str());
    if attempt.previous().len() > MAX_REDIRECTS || attempt.url().host_str() != origin_host {
        attempt.stop()
    } else {
        attempt.follow()
    }
}

#[async_trait::async_trait]
impl HttpTransport for ReqwestTransport {
    async fn send(
        &self,
        request: OutboundHttpRequest,
        opts: HttpCallOptions,
    ) -> Result<HttpResponse, CoreError> {
        let client = if request.skip_verify {
            &self.permissive
        } else {
            &self.verifying
        };
        let mut builder = client.request(request.method.as_reqwest(), request.url.as_url().clone());
        for (name, value) in &request.headers {
            builder = builder.header(name, value);
        }
        if let Some(body) = request.body {
            builder = builder.body(body);
        }

        let started = Instant::now();
        let mut response = builder.send().await.map_err(transport_error)?;
        let status = response.status();
        let headers = response
            .headers()
            .iter()
            .map(|(name, value)| HeaderRow {
                name: name.as_str().to_string(),
                value: String::from_utf8_lossy(value.as_bytes()).into_owned(),
            })
            .collect();
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned);

        let mut bytes = Vec::new();
        let mut too_large = false;
        while let Some(chunk) = response.chunk().await.map_err(transport_error)? {
            bytes.extend_from_slice(&chunk);
            if bytes.len() > opts.max_body_bytes {
                too_large = true;
                break;
            }
        }
        let elapsed_ms = started.elapsed().as_millis() as u64;
        let body = if too_large {
            ResponseBody::TooLarge {
                limit_bytes: opts.max_body_bytes as u64,
            }
        } else {
            classify_response(content_type.as_deref(), &bytes)
        };

        Ok(HttpResponse {
            status: status.as_u16(),
            reason: status.canonical_reason().unwrap_or_default().to_string(),
            headers,
            body,
            size_bytes: bytes.len() as u64,
            elapsed_ms,
        })
    }
}

/// The full source chain, so `classify_connect_error` sees the inner io or rustls text.
/// `without_url` because a resolved URL can carry secrets in its query.
fn transport_error(e: reqwest::Error) -> CoreError {
    CoreError::Transport(error_chain(&e.without_url()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collections::HttpTemplate;
    use crate::http::request::prepare;
    use crate::http::{HttpBody, HttpMethod};
    use crate::send::tests::{static_tokens, NoBuiltins};
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    async fn outbound(url: String) -> OutboundHttpRequest {
        let t = HttpTemplate {
            method: HttpMethod::Get,
            url_template: url,
            query: vec![],
            headers: vec![],
            body: HttpBody::None,
            auth: crate::auth::SavedAuthConfig::None,
        };
        prepare(&t, None, None, &*static_tokens("t"), &NoBuiltins)
            .await
            .unwrap()
            .request
    }

    fn unlimited() -> HttpCallOptions {
        HttpCallOptions {
            max_body_bytes: usize::MAX,
        }
    }

    fn transport() -> ReqwestTransport {
        ReqwestTransport::new("test").unwrap()
    }

    #[tokio::test]
    async fn a_same_host_redirect_is_followed() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/old"))
            .respond_with(ResponseTemplate::new(302).insert_header("location", "/new"))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/new"))
            .respond_with(
                ResponseTemplate::new(200).set_body_raw(r#"{"ok":true}"#, "application/json"),
            )
            .mount(&server)
            .await;

        let response = transport()
            .send(outbound(format!("{}/old", server.uri())).await, unlimited())
            .await
            .unwrap();

        assert_eq!(response.status, 200);
        assert_eq!(
            response.body,
            ResponseBody::Json {
                text: "{\n  \"ok\": true\n}".into()
            }
        );
        assert_eq!(response.size_bytes, 11);
    }

    #[tokio::test]
    async fn a_cross_host_redirect_is_returned_as_the_3xx() {
        let server = MockServer::start().await;
        let elsewhere = format!("http://localhost:{}/landing", server.address().port());
        Mock::given(method("GET"))
            .and(path("/old"))
            .respond_with(ResponseTemplate::new(302).insert_header("location", elsewhere.as_str()))
            .mount(&server)
            .await;

        let response = transport()
            .send(
                outbound(format!("http://127.0.0.1:{}/old", server.address().port())).await,
                unlimited(),
            )
            .await
            .unwrap();

        assert_eq!(response.status, 302);
        assert_eq!(response.reason, "Found");
        assert!(response.headers.contains(&HeaderRow {
            name: "location".into(),
            value: elsewhere
        }));
        assert_eq!(server.received_requests().await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn a_body_over_the_cap_stops_reading_as_too_large() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200).set_body_string("x".repeat(64)))
            .mount(&server)
            .await;

        let response = transport()
            .send(
                outbound(server.uri()).await,
                HttpCallOptions { max_body_bytes: 16 },
            )
            .await
            .unwrap();

        assert_eq!(response.body, ResponseBody::TooLarge { limit_bytes: 16 });
        assert_eq!(response.size_bytes, 64);
    }

    #[tokio::test]
    async fn a_4xx_is_a_response_value() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(404).set_body_string("nope"))
            .mount(&server)
            .await;

        let response = transport()
            .send(outbound(server.uri()).await, unlimited())
            .await
            .unwrap();

        assert_eq!(response.status, 404);
        assert_eq!(response.reason, "Not Found");
        assert_eq!(
            response.body,
            ResponseBody::Text {
                text: "nope".into()
            }
        );
    }

    #[tokio::test]
    async fn a_refused_connection_is_a_transport_error_without_the_url() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);

        let err = transport()
            .send(
                outbound(format!("http://127.0.0.1:{port}/x?api_key=s3cr3t")).await,
                unlimited(),
            )
            .await
            .unwrap_err();

        let CoreError::Transport(message) = err else {
            panic!("expected Transport, got {err:?}")
        };
        assert_eq!(
            crate::grpc::classify_connect_error(&message),
            crate::grpc::ConnectKind::Refused,
            "{message}"
        );
        assert!(
            !message.contains("s3cr3t") && !message.contains(&port.to_string()),
            "{message}"
        );
    }
}
