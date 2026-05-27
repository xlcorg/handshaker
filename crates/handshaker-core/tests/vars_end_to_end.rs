//! End-to-end integration test for the `vars` public API.
//! Verifies multi-line templates with chained vars + literal `{{` braces survive intact.

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
    ]);
    let coll = map(&[]);
    let vars = VariableSet { env: &env, collection: &coll };

    let template = "\
        POST {{uri-root}}/v1/users\n\
        Authorization: Bearer ...\n\
        \n\
        { \"user_id\": \"{{uid}}\", \"note\": \"literal {{{{ stays }}}}\" }\n\
    ";
    let resolved = resolve_string(template, &vars).expect("resolve");
    assert!(resolved.contains("https://api.prod.example.com/v1/users"));
    assert!(resolved.contains(r#""user_id": "abc-123""#));
    // Literal {{ braces — escaped via doubled braces in template — survive untouched
    // because the resolver only matches valid identifier names inside {{...}}.
    // The substring "{{ stays }}" (with a space) doesn't match the regex pattern.
    assert!(resolved.contains("{{ stays }}"), "expected literal `{{{{ stays }}}}` in: {resolved}");
}
