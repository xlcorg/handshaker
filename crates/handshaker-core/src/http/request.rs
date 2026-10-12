//! Template → ready-to-send request: the HTTP half of the spine's prefix.

use bytes::Bytes;

use crate::auth::{AuthCredentials, TokenSource};
use crate::collections::resolve::{Resolution, Slot};
use crate::collections::{CallAuth, Collection, HttpTemplate};
use crate::env::Environment;
use crate::error::CoreError;
use crate::vars::builtins::{expand_builtins, BuiltinGenerator};

use super::body::{encode, implied_content_type, ResolvedBody};
use super::url::HttpUrl;
use super::{HttpBody, HttpMethod};

pub(crate) struct Prepared {
    /// Ready to send, with the materialized auth header already in place.
    pub(crate) request: OutboundHttpRequest,
    pub(crate) auth: CallAuth,
}

enum BodySlots {
    None,
    Json(Slot),
    Text(Slot),
    Form(Vec<(Slot, Slot)>),
}

/// The spine's fixed order: resolve every template into one session, so `settle` reports
/// every unresolved `{{var}}` at once. Then built-ins expand in the URL, query names and
/// values, header values and the body, never in header names. Then the URL parses, then
/// auth materializes (the first side effect), then the implied `Content-Type` and the auth
/// header go on last, so the header is never expanded. A resolve or URL failure returns
/// before any env var read, token fetch, or network use.
pub(crate) async fn prepare(
    template: &HttpTemplate,
    collection: Option<&Collection>,
    active_env: Option<&Environment>,
    tokens: &dyn TokenSource,
    builtins: &(dyn BuiltinGenerator + Send + Sync),
) -> Result<Prepared, CoreError> {
    let mut r = Resolution::begin(collection, active_env);
    let url = r.take(&template.url_template);
    let query = r.pairs(&template.query);
    let headers = r.rows(&template.headers);
    let body = match &template.body {
        HttpBody::None => BodySlots::None,
        HttpBody::Json { text } => BodySlots::Json(r.take(text)),
        HttpBody::Text { text } => BodySlots::Text(r.take(text)),
        HttpBody::Form { fields } => BodySlots::Form(r.pairs(fields)),
    };
    let pick = r.pick_auth(&template.auth);
    let mut s = r.settle()?;

    let mut text = |slot: Slot| expand_builtins(&s.text(slot), builtins);
    let url = HttpUrl::parse(&text(url))?;
    let query: Vec<(String, String)> = query.into_iter().map(|(k, v)| (text(k), text(v))).collect();
    let mut headers: Vec<(String, String)> =
        headers.into_iter().map(|(k, v)| (k, text(v))).collect();
    let body = match body {
        BodySlots::None => ResolvedBody::None,
        BodySlots::Json(t) => ResolvedBody::Json(text(t)),
        BodySlots::Text(t) => ResolvedBody::Text(text(t)),
        BodySlots::Form(fields) => ResolvedBody::Form(
            fields
                .into_iter()
                .map(|(k, v)| (text(k), text(v)))
                .collect(),
        ),
    };

    if let Some(content_type) = implied_content_type(&body) {
        if !headers
            .iter()
            .any(|(name, _)| name.eq_ignore_ascii_case("content-type"))
        {
            headers.push(("content-type".into(), content_type.into()));
        }
    }
    let skip_verify = s.skip_verify();
    let auth = s.materialize(pick, tokens).await?;
    let request = OutboundHttpRequest {
        method: template.method,
        url: url.with_query(&query),
        headers,
        body: encode(body),
        skip_verify,
    }
    .with_auth(auth.header());
    Ok(Prepared { request, auth })
}

/// What an `HttpTransport` sends. Built only by `prepare`.
#[derive(Debug, Clone)]
pub struct OutboundHttpRequest {
    pub(crate) method: HttpMethod,
    pub(crate) url: HttpUrl,
    pub(crate) headers: Vec<(String, String)>,
    pub(crate) body: Option<Bytes>,
    /// From the collection's `skip_tls_verify`; meaningful only for `https`.
    pub(crate) skip_verify: bool,
}

impl OutboundHttpRequest {
    /// Put the credential in place. It replaces every header of the same name (ASCII
    /// case-insensitive), so exactly one copy is sent and the materialized value wins over
    /// a user row. Idempotent, which the 401 retry relies on when it swaps in a fresh token.
    pub(crate) fn with_auth(mut self, header: Option<&AuthCredentials>) -> Self {
        if let Some(creds) = header {
            self.headers
                .retain(|(name, _)| !name.eq_ignore_ascii_case(&creds.header_name));
            self.headers
                .push((creds.header_name.clone(), creds.header_value.clone()));
        }
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{AuthCredentials, SavedAuthConfig, StaticTokenSource};
    use crate::collections::MetadataRow;
    use crate::send::tests::{env_with_sec, oauth_template, NoBuiltins, SeqGuids};

    fn row(key: &str, value: &str) -> MetadataRow {
        MetadataRow {
            key: key.into(),
            value: value.into(),
            enabled: true,
        }
    }

    fn template(url: &str) -> HttpTemplate {
        HttpTemplate {
            method: HttpMethod::Post,
            url_template: url.into(),
            query: vec![],
            headers: vec![],
            body: HttpBody::None,
            auth: SavedAuthConfig::None,
        }
    }

    fn tokens(value: &str) -> StaticTokenSource {
        StaticTokenSource {
            header: AuthCredentials {
                header_name: "authorization".into(),
                header_value: value.into(),
            },
        }
    }

    #[tokio::test]
    async fn builtins_expand_in_url_query_header_values_and_body_but_not_names_or_auth() {
        let mut t = template("https://api.test/{{$guid}}");
        t.query = vec![row("{{$guid}}", "{{$guid}}")];
        t.headers = vec![row("x-{{$guid}}", "{{$guid}}")];
        t.body = HttpBody::Form {
            fields: vec![row("{{$guid}}", "{{$guid}}")],
        };
        t.auth = oauth_template();

        let p = prepare(
            &t,
            None,
            Some(&env_with_sec()),
            &tokens("Bearer {{$guid}}"),
            &*SeqGuids::new(),
        )
        .await
        .unwrap();

        assert_eq!(p.request.url.as_url().as_str(), "https://api.test/G0?G1=G2");
        assert_eq!(
            p.request.headers,
            vec![
                ("x-{{$guid}}".to_string(), "G3".to_string()),
                (
                    "content-type".to_string(),
                    "application/x-www-form-urlencoded".to_string()
                ),
                ("authorization".to_string(), "Bearer {{$guid}}".to_string()),
            ]
        );
        assert_eq!(p.request.body, Some(Bytes::from("G4=G5")));
    }

    #[tokio::test]
    async fn disabled_and_keyless_rows_are_neither_resolved_nor_sent() {
        let mut t = template("http://api.test/x");
        t.query = vec![
            MetadataRow {
                key: "off".into(),
                value: "{{missing}}".into(),
                enabled: false,
            },
            row("", "{{missing}}"),
            row("on", "1"),
        ];
        t.headers = vec![
            MetadataRow {
                key: "x-off".into(),
                value: "{{missing}}".into(),
                enabled: false,
            },
            row("", "{{missing}}"),
        ];

        let p = prepare(&t, None, None, &tokens("t"), &NoBuiltins)
            .await
            .unwrap();

        assert_eq!(p.request.url.as_url().as_str(), "http://api.test/x?on=1");
        assert!(p.request.headers.is_empty(), "{:?}", p.request.headers);
        assert_eq!(p.request.body, None);
    }

    #[tokio::test]
    async fn a_user_content_type_in_any_case_beats_the_implied_one() {
        let mut t = template("http://api.test/x");
        t.headers = vec![row("Content-TYPE", "application/vnd.api+json")];
        t.body = HttpBody::Json { text: "{}".into() };

        let p = prepare(&t, None, None, &tokens("t"), &NoBuiltins)
            .await
            .unwrap();

        assert_eq!(
            p.request.headers,
            vec![(
                "Content-TYPE".to_string(),
                "application/vnd.api+json".to_string()
            )]
        );
        assert_eq!(p.request.body, Some(Bytes::from("{}")));
    }

    #[tokio::test]
    async fn the_auth_header_replaces_a_user_row_case_insensitively_and_reapplies_idempotently() {
        let mut t = template("http://api.test/x");
        t.headers = vec![row("Authorization", "Bearer mine"), row("x-a", "1")];
        t.auth = oauth_template();

        let p = prepare(
            &t,
            None,
            Some(&env_with_sec()),
            &tokens("Bearer old"),
            &NoBuiltins,
        )
        .await
        .unwrap();
        let expected_old = vec![
            ("x-a".to_string(), "1".to_string()),
            ("authorization".to_string(), "Bearer old".to_string()),
        ];
        assert_eq!(p.request.headers, expected_old);

        let fresh = AuthCredentials {
            header_name: "Authorization".into(),
            header_value: "Bearer new".into(),
        };
        let retried = p.request.with_auth(Some(&fresh)).with_auth(Some(&fresh));
        assert_eq!(
            retried.headers,
            vec![
                ("x-a".to_string(), "1".to_string()),
                ("Authorization".to_string(), "Bearer new".to_string())
            ]
        );
    }
}
