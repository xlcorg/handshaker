//! Variable substitution for `{{var}}` placeholders.
//!
//! Two entry-points:
//! - [`resolve_string`] — strict; returns `Err(CoreError::UnresolvedVariable | VariableCycle)`.
//!   Used by anything that needs a fully-resolved string (e.g. the invoke path).
//! - [`resolve_template_with_diagnostics`] — non-failing; always returns a `ResolutionReport`
//!   with the best-effort substitution and lists of unresolved names / cycle chain.
//!   Used by UI for live preview.
//!
//! See `docs/superpowers/specs/2026-05-27-plan-04-env-vars-design.md` §4 for full semantics.

use std::collections::HashMap;
use std::sync::LazyLock;

use regex::Regex;

use crate::error::CoreError;

/// Cap on substitution passes; beyond this we assume a cycle (see §4).
pub const MAX_PASSES: usize = 4;

/// Matches `{{name}}` where `name` is any non-empty run of characters other than the
/// `{` / `}` delimiters. The key is taken literally (no trimming) and may contain
/// digits, dots, hyphens, or non-ASCII — it simply has to equal an env/collection key.
/// (Relaxes the former `[a-zA-Z_][a-zA-Z0-9_-]*` rule from master spec §5.2.)
static VAR_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\{\{([^{}]+)\}\}")
        .expect("VAR_RE is a known-good regex")
});

/// Borrowed view over the env- and collection-scope variable maps for one resolve call.
/// Lookup priority is `env > collection`.
pub struct VariableSet<'a> {
    pub env: &'a HashMap<String, String>,
    pub collection: &'a HashMap<String, String>,
}

/// Outcome of [`resolve_template_with_diagnostics`]. Never an error type; missing vars
/// and cycles are *data*, not control flow.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolutionReport {
    /// Best-effort substitution result. Unresolved `{{var}}` placeholders are left as-is.
    pub resolved: String,
    /// Variable names referenced but absent from both `env` and `collection`.
    /// Deduplicated, ordered by first appearance in the final string.
    /// Empty when `cycle_chain` is `Some` (those names are part of the cycle, not missing).
    pub unresolved_vars: Vec<String>,
    /// When substitution did not converge within `MAX_PASSES`, the detected cycle chain
    /// formatted like `["a", "b", "a"]` (start node repeated at end).
    pub cycle_chain: Option<Vec<String>>,
}

#[inline]
fn lookup<'a>(name: &str, vars: &VariableSet<'a>) -> Option<&'a String> {
    vars.env.get(name).or_else(|| vars.collection.get(name))
}

/// Non-failing resolve — collects diagnostics and returns best-effort partial result.
/// Used for UI preview.
pub fn resolve_template_with_diagnostics(
    template: &str,
    vars: &VariableSet<'_>,
) -> ResolutionReport {
    let mut current = template.to_string();
    let mut converged = false;

    for _ in 0..MAX_PASSES {
        let (next, changed) = substitute_once(&current, vars);
        current = next;
        if !changed {
            converged = true;
            break;
        }
    }

    let unresolved_vars = collect_unresolved(&current);

    let cycle_chain = if !converged && !unresolved_vars.is_empty() {
        detect_cycle(&unresolved_vars, vars)
    } else {
        None
    };

    let final_unresolved = if cycle_chain.is_some() {
        Vec::new()
    } else {
        unresolved_vars
    };

    ResolutionReport {
        resolved: current,
        unresolved_vars: final_unresolved,
        cycle_chain,
    }
}

/// Pick the lexicographically smallest seed name and DFS from it through the
/// substitution graph (env ∪ collection definitions). Return the first cycle found.
/// `None` if no cycle is reachable from any seed (shouldn't happen if MAX_PASSES
/// was exhausted with unresolved names remaining, but we handle it defensively).
fn detect_cycle(seeds: &[String], vars: &VariableSet<'_>) -> Option<Vec<String>> {
    let mut sorted: Vec<&String> = seeds.iter().collect();
    sorted.sort();
    for seed in sorted {
        let mut stack: Vec<String> = Vec::new();
        if let Some(chain) = dfs(seed, vars, &mut stack) {
            return Some(chain);
        }
    }
    None
}

fn dfs(name: &str, vars: &VariableSet<'_>, stack: &mut Vec<String>) -> Option<Vec<String>> {
    if let Some(start) = stack.iter().position(|n| n == name) {
        // Back-edge: cycle from `start..` in stack, repeated at end.
        let mut chain: Vec<String> = stack[start..].to_vec();
        chain.push(name.to_string());
        return Some(chain);
    }
    let value = lookup(name, vars)?;
    stack.push(name.to_string());
    for caps in VAR_RE.captures_iter(value) {
        let next = caps.get(1).unwrap().as_str();
        if let Some(chain) = dfs(next, vars, stack) {
            return Some(chain);
        }
    }
    stack.pop();
    None
}

/// Strict resolve — fails on the first unresolved variable or any detected cycle.
/// Use this in the invoke path or anywhere a fully-resolved string is required.
pub fn resolve_string(template: &str, vars: &VariableSet<'_>) -> Result<String, CoreError> {
    let report = resolve_template_with_diagnostics(template, vars);
    if let Some(chain) = report.cycle_chain {
        return Err(CoreError::VariableCycle { chain });
    }
    if let Some(name) = report.unresolved_vars.into_iter().next() {
        return Err(CoreError::UnresolvedVariable { name });
    }
    Ok(report.resolved)
}

/// One substitution pass. Returns the new string and a flag indicating whether any
/// substitution happened (used by the caller to decide whether to continue iterating).
fn substitute_once(input: &str, vars: &VariableSet<'_>) -> (String, bool) {
    let mut out = String::with_capacity(input.len());
    let mut last_end = 0;
    let mut changed = false;
    for caps in VAR_RE.captures_iter(input) {
        let whole = caps.get(0).unwrap();
        let name = caps.get(1).unwrap().as_str();
        out.push_str(&input[last_end..whole.start()]);
        match lookup(name, vars) {
            Some(val) => {
                out.push_str(val);
                changed = true;
            }
            None => out.push_str(whole.as_str()),
        }
        last_end = whole.end();
    }
    out.push_str(&input[last_end..]);
    (out, changed)
}

/// Collect remaining `{{name}}` matches, deduplicated, in first-appearance order.
fn collect_unresolved(s: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for caps in VAR_RE.captures_iter(s) {
        let name = caps.get(1).unwrap().as_str().to_string();
        if !out.contains(&name) {
            out.push(name);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vs<'a>(env: &'a HashMap<String, String>, coll: &'a HashMap<String, String>) -> VariableSet<'a> {
        VariableSet { env, collection: coll }
    }

    fn map(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| ((*k).to_string(), (*v).to_string())).collect()
    }

    #[test]
    fn no_vars_passthrough() {
        let env = map(&[]);
        let coll = map(&[]);
        let r = resolve_template_with_diagnostics("hello world", &vs(&env, &coll));
        assert_eq!(r.resolved, "hello world");
        assert!(r.unresolved_vars.is_empty());
        assert!(r.cycle_chain.is_none());
    }

    #[test]
    fn single_pass_env_only() {
        let env = map(&[("x", "1")]);
        let coll = map(&[]);
        let r = resolve_template_with_diagnostics("{{x}}", &vs(&env, &coll));
        assert_eq!(r.resolved, "1");
        assert!(r.unresolved_vars.is_empty());
    }

    #[test]
    fn single_pass_collection_only() {
        let env = map(&[]);
        let coll = map(&[("x", "c")]);
        let r = resolve_template_with_diagnostics("{{x}}", &vs(&env, &coll));
        assert_eq!(r.resolved, "c");
    }

    #[test]
    fn env_overrides_collection() {
        let env = map(&[("x", "e")]);
        let coll = map(&[("x", "c")]);
        let r = resolve_template_with_diagnostics("{{x}}", &vs(&env, &coll));
        assert_eq!(r.resolved, "e");
    }

    #[test]
    fn digit_leading_name_now_treated_as_var() {
        // The key may be ANY non-brace characters now (no leading-letter rule), so a
        // digit-leading name is a real variable — here unresolved, left as-is.
        let env = map(&[]);
        let coll = map(&[]);
        let r = resolve_template_with_diagnostics("{{1bad}}", &vs(&env, &coll));
        assert_eq!(r.resolved, "{{1bad}}");
        assert_eq!(r.unresolved_vars, vec!["1bad".to_string()]);
    }

    #[test]
    fn any_key_chars_allowed() {
        // Keys may contain digits-leading, dots, and non-ASCII — anything but braces.
        let env = map(&[("1bad", "ok"), ("user.id", "42"), ("ключ", "значение")]);
        let coll = map(&[]);
        let r = resolve_template_with_diagnostics(
            "{{1bad}} {{user.id}} {{ключ}}",
            &vs(&env, &coll),
        );
        assert_eq!(r.resolved, "ok 42 значение");
        assert!(r.unresolved_vars.is_empty());
    }

    #[test]
    fn arbitrary_key_unresolved_when_absent() {
        let env = map(&[]);
        let coll = map(&[]);
        let r = resolve_template_with_diagnostics("{{user.id}}", &vs(&env, &coll));
        assert_eq!(r.resolved, "{{user.id}}");
        assert_eq!(r.unresolved_vars, vec!["user.id".to_string()]);
    }

    #[test]
    fn adjacent_vars_do_not_bleed() {
        // [^{}]+ is greedy but cannot cross a brace, so adjacent placeholders stay distinct.
        let env = map(&[("a", "1"), ("b", "2")]);
        let coll = map(&[]);
        let r = resolve_template_with_diagnostics("{{a}}{{b}}", &vs(&env, &coll));
        assert_eq!(r.resolved, "12");
    }

    #[test]
    fn unresolved_single_collected() {
        let env = map(&[]);
        let coll = map(&[]);
        let r = resolve_template_with_diagnostics("{{missing}}", &vs(&env, &coll));
        assert_eq!(r.resolved, "{{missing}}");
        assert_eq!(r.unresolved_vars, vec!["missing".to_string()]);
        assert!(r.cycle_chain.is_none());
    }

    #[test]
    fn diagnostics_collects_all_unresolved() {
        let env = map(&[]);
        let coll = map(&[]);
        let r = resolve_template_with_diagnostics("{{a}} {{b}} {{a}}", &vs(&env, &coll));
        // Dedup, order-preserving:
        assert_eq!(r.unresolved_vars, vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn chained_two_pass() {
        // {{a}} → {{b}} → "2"
        let env = map(&[("a", "{{b}}"), ("b", "2")]);
        let coll = map(&[]);
        let r = resolve_template_with_diagnostics("{{a}}", &vs(&env, &coll));
        assert_eq!(r.resolved, "2");
        assert!(r.unresolved_vars.is_empty());
        assert!(r.cycle_chain.is_none());
    }

    #[test]
    fn chain_three_hops() {
        // {{a}} → {{b}} → {{c}} → "3" (3 hops, within MAX_PASSES=4)
        let env = map(&[("a", "{{b}}"), ("b", "{{c}}"), ("c", "3")]);
        let coll = map(&[]);
        let r = resolve_template_with_diagnostics("{{a}}", &vs(&env, &coll));
        assert_eq!(r.resolved, "3");
    }

    #[test]
    fn chain_mixed_with_literal() {
        let env = map(&[("uri", "https://api.{{env}}.example.com"), ("env", "prod")]);
        let coll = map(&[]);
        let r = resolve_template_with_diagnostics(
            r#"{"url": "{{uri}}/v1/users"}"#,
            &vs(&env, &coll),
        );
        assert_eq!(r.resolved, r#"{"url": "https://api.prod.example.com/v1/users"}"#);
    }

    #[test]
    fn cycle_two_node() {
        // {{a}} → {{b}} → {{a}} (cycle)
        let env = map(&[("a", "{{b}}"), ("b", "{{a}}")]);
        let coll = map(&[]);
        let r = resolve_template_with_diagnostics("{{a}}", &vs(&env, &coll));
        assert!(r.cycle_chain.is_some(), "expected cycle, got {:?}", r);
        let chain = r.cycle_chain.unwrap();
        // Chain starts and ends with the same name (back-edge form).
        assert_eq!(chain.first(), chain.last());
        // Contains both 'a' and 'b'.
        assert!(chain.contains(&"a".to_string()));
        assert!(chain.contains(&"b".to_string()));
        // When cycle is reported, unresolved_vars is cleared.
        assert!(r.unresolved_vars.is_empty());
    }

    #[test]
    fn cycle_self() {
        // {{a}} → {{a}} (self-loop)
        let env = map(&[("a", "{{a}}")]);
        let coll = map(&[]);
        let r = resolve_template_with_diagnostics("{{a}}", &vs(&env, &coll));
        let chain = r.cycle_chain.expect("expected cycle");
        assert_eq!(chain, vec!["a".to_string(), "a".to_string()]);
    }

    #[test]
    fn cycle_three_node() {
        // a → b → c → a
        let env = map(&[("a", "{{b}}"), ("b", "{{c}}"), ("c", "{{a}}")]);
        let coll = map(&[]);
        let r = resolve_template_with_diagnostics("{{a}}", &vs(&env, &coll));
        let chain = r.cycle_chain.expect("expected cycle");
        // Should include all three names (a, b, c) plus the closing repeat.
        assert!(chain.len() >= 4, "chain too short: {chain:?}");
        assert_eq!(chain.first(), chain.last());
    }

    #[test]
    fn resolve_string_ok_when_resolved() {
        let env = map(&[("x", "1")]);
        let coll = map(&[]);
        let s = resolve_string("{{x}}", &vs(&env, &coll)).unwrap();
        assert_eq!(s, "1");
    }

    #[test]
    fn resolve_string_err_unresolved() {
        let env = map(&[]);
        let coll = map(&[]);
        let err = resolve_string("{{missing}}", &vs(&env, &coll)).unwrap_err();
        match err {
            CoreError::UnresolvedVariable { name } => assert_eq!(name, "missing"),
            other => panic!("expected UnresolvedVariable, got {other:?}"),
        }
    }

    #[test]
    fn resolve_string_err_cycle() {
        let env = map(&[("a", "{{b}}"), ("b", "{{a}}")]);
        let coll = map(&[]);
        let err = resolve_string("{{a}}", &vs(&env, &coll)).unwrap_err();
        match err {
            CoreError::VariableCycle { chain } => {
                assert_eq!(chain.first(), chain.last());
                assert!(chain.contains(&"a".to_string()));
            }
            other => panic!("expected VariableCycle, got {other:?}"),
        }
    }

    #[test]
    fn resolve_string_err_unresolved_picks_first() {
        let env = map(&[]);
        let coll = map(&[]);
        let err = resolve_string("{{first}} {{second}}", &vs(&env, &coll)).unwrap_err();
        match err {
            CoreError::UnresolvedVariable { name } => assert_eq!(name, "first"),
            other => panic!("expected UnresolvedVariable, got {other:?}"),
        }
    }
}
