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

/// Matches `{{name}}` where `name` starts with a letter or underscore and contains
/// letters / digits / underscore / hyphen. Per master spec §5.2 line 223.
static VAR_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\{\{([a-zA-Z_][a-zA-Z0-9_-]*)\}\}")
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
        None  // Filled in by Task 4 — cycle detection.
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
    fn invalid_name_left_alone() {
        // Names starting with a digit don't match the regex — should pass through literally.
        let env = map(&[]);
        let coll = map(&[]);
        let r = resolve_template_with_diagnostics("{{1bad}}", &vs(&env, &coll));
        assert_eq!(r.resolved, "{{1bad}}");
        assert!(r.unresolved_vars.is_empty());
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
}
