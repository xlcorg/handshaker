//! Shared HTTP test support: a scripted transport that records what it was asked to send.
//! Behind the `test-support` feature, like `grpc::testing`, so the IPC crate's tests can
//! drive `http_send_impl` without a network.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use bytes::Bytes;

use crate::error::CoreError;

use super::{
    HttpCallOptions, HttpMethod, HttpResponse, HttpTransport, OutboundHttpRequest, ResponseBody,
};

pub struct FakeHttpTransport {
    replies: Mutex<VecDeque<Result<HttpResponse, CoreError>>>,
    sent: Mutex<Vec<SentHttp>>,
}

/// One recorded exchange, as the server would have seen it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SentHttp {
    pub method: HttpMethod,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<Bytes>,
    pub skip_verify: bool,
}

impl SentHttp {
    /// The first header named `name`, ASCII case-insensitive.
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(n, _)| n.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

impl FakeHttpTransport {
    /// Replies in order, one per send. A send past the script fails as a transport error.
    pub fn replying(
        replies: impl IntoIterator<Item = Result<HttpResponse, CoreError>>,
    ) -> Arc<Self> {
        Arc::new(Self {
            replies: Mutex::new(replies.into_iter().collect()),
            sent: Mutex::new(Vec::new()),
        })
    }

    pub fn sent(&self) -> Vec<SentHttp> {
        self.sent.lock().expect("sent lock").clone()
    }
}

/// A bodiless response with `status`.
pub fn status_response(status: u16) -> HttpResponse {
    HttpResponse {
        status,
        reason: String::new(),
        headers: vec![],
        body: ResponseBody::Empty,
        size_bytes: 0,
        elapsed_ms: 0,
    }
}

#[async_trait::async_trait]
impl HttpTransport for FakeHttpTransport {
    async fn send(
        &self,
        request: OutboundHttpRequest,
        _opts: HttpCallOptions,
    ) -> Result<HttpResponse, CoreError> {
        self.sent.lock().expect("sent lock").push(SentHttp {
            method: request.method,
            url: request.url.as_url().to_string(),
            headers: request.headers,
            body: request.body,
            skip_verify: request.skip_verify,
        });
        self.replies
            .lock()
            .expect("replies lock")
            .pop_front()
            .unwrap_or_else(|| {
                Err(CoreError::Transport(
                    "FakeHttpTransport: no reply scripted".into(),
                ))
            })
    }
}
