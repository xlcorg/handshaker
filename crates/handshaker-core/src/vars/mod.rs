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
