//! End-to-end integration test for the `vars` public API.
//! Verifies multi-line templates with chained vars resolve, and that a key may be ANY
//! non-brace characters (incl. spaces / hyphens). Note: with arbitrary keys there is no
//! escape for literal `{{...}}` — any `{{x}}` is treated as a variable reference.

use std::collections::HashMap;

use handshaker_core::vars::{resolve_string, VariableSet};

fn map(pairs: &[(&str, &str)]) -> HashMap<String, String> {
    pairs.iter().map(|(k, v)| ((*k).to_string(), (*v).to_string())).collect()
}

#[test]
fn multiline_template_with_chained_vars_resolves() {
    let env = map(&[
        ("uri-root", "https://api.{{stage}}.example.com"),
        ("stage", "prod"),
        ("uid", "abc-123"),
        ("full name", "Ada"),
    ]);
    let coll = map(&[]);
    let vars = VariableSet { env: &env, collection: &coll };

    let template = "\
        POST {{uri-root}}/v1/users\n\
        Authorization: Bearer ...\n\
        \n\
        { \"user_id\": \"{{uid}}\", \"owner\": \"{{full name}}\" }\n\
    ";
    let resolved = resolve_string(template, &vars).expect("resolve");
    assert!(resolved.contains("https://api.prod.example.com/v1/users"));
    assert!(resolved.contains(r#""user_id": "abc-123""#));
    // Keys may be any non-brace characters now — a space-containing key resolves too.
    assert!(resolved.contains(r#""owner": "Ada""#), "got: {resolved}");
}
