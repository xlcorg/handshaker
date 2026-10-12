//! The only URL validation: a resolved, built-in-expanded URL becomes an `HttpUrl` or a
//! `UrlProblem` that never carries the URL itself.

use crate::error::CoreError;

/// An absolute `http`/`https` URL with no fragment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct HttpUrl(reqwest::Url);

impl HttpUrl {
    /// `MissingScheme` when the text has no `://` (`localhost:8080/x` would otherwise parse
    /// as scheme `localhost`), `UnsupportedScheme` for anything but http/https, `Malformed`
    /// with the parser's static reason otherwise. A missing host is `Malformed` too: the
    /// parser rejects `http://` with "empty host".
    pub(crate) fn parse(resolved: &str) -> Result<Self, CoreError> {
        let invalid = |problem| CoreError::InvalidUrl { problem };
        let text = resolved.trim();
        if !text.contains("://") {
            return Err(invalid(UrlProblem::MissingScheme));
        }
        let mut url = reqwest::Url::parse(text).map_err(|e| {
            invalid(UrlProblem::Malformed {
                reason: e.to_string(),
            })
        })?;
        if !matches!(url.scheme(), "http" | "https") {
            return Err(invalid(UrlProblem::UnsupportedScheme {
                scheme: url.scheme().to_string(),
            }));
        }
        url.set_fragment(None);
        Ok(HttpUrl(url))
    }

    /// Appends rows as form-urlencoded `key=value` pairs after any query already in the URL.
    pub(crate) fn with_query(mut self, rows: &[(String, String)]) -> Self {
        // `query_pairs_mut` on an empty row list would still leave a bare `?`.
        if !rows.is_empty() {
            self.0.query_pairs_mut().extend_pairs(rows);
        }
        self
    }

    pub(crate) fn as_url(&self) -> &reqwest::Url {
        &self.0
    }
}

/// Why a resolved URL cannot be sent. It never carries the URL: a resolved URL can hold
/// secrets (`?api_key={{key}}`), and errors reach logs and the UI.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum UrlProblem {
    #[error("missing scheme")]
    MissingScheme,
    #[error("unsupported scheme `{scheme}`")]
    UnsupportedScheme { scheme: String },
    #[error("{reason}")]
    Malformed { reason: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    fn problem_of(text: &str) -> (UrlProblem, String) {
        let err = HttpUrl::parse(text).unwrap_err();
        let message = err.to_string();
        match err {
            CoreError::InvalidUrl { problem } => (problem, message),
            other => panic!("expected InvalidUrl, got {other:?}"),
        }
    }

    #[test]
    fn invalid_urls_name_the_problem_and_never_echo_the_url() {
        let cases = [
            (
                "localhost:8080/x?api_key=s3cr3t",
                UrlProblem::MissingScheme,
                "invalid URL: missing scheme",
            ),
            (
                "ftp://files.test/x?api_key=s3cr3t",
                UrlProblem::UnsupportedScheme {
                    scheme: "ftp".into(),
                },
                "invalid URL: unsupported scheme `ftp`",
            ),
            (
                "http://api.test:99999/x?api_key=s3cr3t",
                UrlProblem::Malformed {
                    reason: "invalid port number".into(),
                },
                "invalid URL: invalid port number",
            ),
            (
                "http://",
                UrlProblem::Malformed {
                    reason: "empty host".into(),
                },
                "invalid URL: empty host",
            ),
        ];
        for (text, expected, rendered) in cases {
            let (problem, message) = problem_of(text);
            assert_eq!(problem, expected, "{text}");
            assert_eq!(message, rendered, "{text}");
            assert!(
                !message.contains("s3cr3t") && !message.contains("api.test"),
                "{message}"
            );
        }
    }

    #[test]
    fn query_rows_append_after_the_existing_query_and_the_fragment_is_dropped() {
        let url = HttpUrl::parse(" https://api.test/orders?page=2#top ")
            .unwrap()
            .with_query(&[("q".into(), "a b&c".into()), ("q".into(), "2".into())]);
        assert_eq!(
            url.as_url().as_str(),
            "https://api.test/orders?page=2&q=a+b%26c&q=2"
        );
    }

    #[test]
    fn no_query_rows_leave_the_url_untouched() {
        let url = HttpUrl::parse("http://api.test/orders")
            .unwrap()
            .with_query(&[]);
        assert_eq!(url.as_url().as_str(), "http://api.test/orders");
    }
}
