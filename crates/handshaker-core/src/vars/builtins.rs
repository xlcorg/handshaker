//! Built-in (dynamic) variables: `{{$guid}}`, `{{$timestamp}}`, … — names that are
//! GENERATED at send time rather than looked up. Recognition (`is_builtin`) is shared
//! with the resolver (it reports builtins separately from unresolved vars); GENERATION
//! is injected via [`BuiltinGenerator`] so the core stays deterministic in tests.
//!
//! Per-occurrence semantics: [`expand_builtins`] generates a fresh value for EACH
//! `{{$name}}` occurrence (two `{{$guid}}` → two different GUIDs). Mirror of the
//! frontend set in `src/features/vars/builtins.ts` — keep in sync.

use uuid::Uuid;

use super::VAR_RE;

/// True for a recognized built-in name (always `$`-prefixed). The `$` prefix makes
/// collision with user variables practically impossible; an unknown `$foo` is NOT a
/// builtin and stays a normal (unresolved) variable.
pub fn is_builtin(name: &str) -> bool {
    matches!(
        name,
        "$guid" | "$guid7" | "$timestamp" | "$unixMs" | "$isoTimestamp" | "$randomInt"
    )
}

/// Generates a value for a built-in name, or `None` if the name is not a builtin
/// (caller leaves the `{{…}}` literal untouched). Injected so production uses real
/// clock/uuid/rng while tests use a deterministic fake.
pub trait BuiltinGenerator {
    fn generate(&self, name: &str) -> Option<String>;
}

/// Production generator: real UUIDs, system clock, UUID-derived randomness.
pub struct SystemBuiltins;

impl BuiltinGenerator for SystemBuiltins {
    fn generate(&self, name: &str) -> Option<String> {
        Some(match name {
            "$guid" => Uuid::new_v4().to_string(),
            "$guid7" => Uuid::now_v7().to_string(),
            "$timestamp" => unix_secs().to_string(),
            "$unixMs" => unix_millis().to_string(),
            "$isoTimestamp" => iso8601_utc(unix_secs()),
            "$randomInt" => random_int_0_1000().to_string(),
            _ => return None,
        })
    }
}

fn unix_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn unix_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        // u64 millis saturates ~584M years from epoch — plenty; keeps parity with unix_secs.
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Integer in `0..=1000` (Postman parity) from the 122 random bits of a v4 UUID.
/// Modulo bias over 1001 is ~2^-112 — negligible for generated test data; avoids a
/// dedicated RNG crate.
fn random_int_0_1000() -> u32 {
    let n = u128::from_le_bytes(Uuid::new_v4().into_bytes());
    (n % 1001) as u32
}

/// `YYYY-MM-DDThh:mm:ssZ` (UTC, second precision) from Unix seconds.
fn iso8601_utc(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (hh, mm, ss) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}Z")
}

/// Days since 1970-01-01 → (year, month, day). Howard Hinnant's `civil_from_days`
/// (http://howardhinnant.github.io/date_algorithms.html), valid for the full range.
/// Callers here pass `z >= 0` (the only caller, [`iso8601_utc`], receives `u64` seconds),
/// so the negative-day branch is unreachable in practice but kept for algorithm fidelity.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = (if z >= 0 { z } else { z - 146_096 }) / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Replace EACH `{{$name}}` occurrence with a freshly generated value (per-occurrence).
/// Non-builtin `{{…}}` (and any text) is copied verbatim. Pure given `gen`.
pub fn expand_builtins(s: &str, gen: &impl BuiltinGenerator) -> String {
    let mut out = String::with_capacity(s.len());
    let mut last = 0;
    for caps in VAR_RE.captures_iter(s) {
        let whole = caps.get(0).unwrap();
        let name = caps.get(1).unwrap().as_str();
        out.push_str(&s[last..whole.start()]);
        match gen.generate(name) {
            Some(v) => out.push_str(&v),
            None => out.push_str(whole.as_str()),
        }
        last = whole.end();
    }
    out.push_str(&s[last..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    /// Deterministic fake: returns `"<name>#<seq>"`, proving per-occurrence freshness
    /// (each call advances the counter) without real generation.
    struct SeqBuiltins {
        n: Cell<u32>,
    }
    impl BuiltinGenerator for SeqBuiltins {
        fn generate(&self, name: &str) -> Option<String> {
            if !is_builtin(name) {
                return None;
            }
            let i = self.n.get();
            self.n.set(i + 1);
            Some(format!("{name}#{i}"))
        }
    }

    #[test]
    fn is_builtin_known_and_unknown() {
        assert!(is_builtin("$guid"));
        assert!(is_builtin("$guid7"));
        assert!(is_builtin("$timestamp"));
        assert!(is_builtin("$unixMs"));
        assert!(is_builtin("$isoTimestamp"));
        assert!(is_builtin("$randomInt"));
        assert!(!is_builtin("$foo")); // $-prefixed but not a known builtin
        assert!(!is_builtin("guid")); // no $-prefix → user var
        assert!(!is_builtin("host"));
    }

    #[test]
    fn expand_is_per_occurrence() {
        let gen = SeqBuiltins { n: Cell::new(0) };
        let out = expand_builtins("{{$guid}}-{{$guid}}", &gen);
        assert_eq!(out, "$guid#0-$guid#1"); // two occurrences → two distinct values
    }

    #[test]
    fn expand_leaves_non_builtin_untouched() {
        let gen = SeqBuiltins { n: Cell::new(0) };
        let out = expand_builtins("{{host}} {{$guid}} {{x.y}}", &gen);
        assert_eq!(out, "{{host}} $guid#0 {{x.y}}");
    }

    #[test]
    fn system_guid_is_valid_v4_and_v7() {
        let g4 = SystemBuiltins.generate("$guid").unwrap();
        let u4 = Uuid::parse_str(&g4).unwrap();
        assert_eq!(u4.get_version_num(), 4);
        let g7 = SystemBuiltins.generate("$guid7").unwrap();
        let u7 = Uuid::parse_str(&g7).unwrap();
        assert_eq!(u7.get_version_num(), 7);
        assert_ne!(g4, SystemBuiltins.generate("$guid").unwrap()); // fresh each call
    }

    #[test]
    fn system_timestamps_and_randomint() {
        let secs: u64 = SystemBuiltins.generate("$timestamp").unwrap().parse().unwrap();
        let ms: u64 = SystemBuiltins.generate("$unixMs").unwrap().parse().unwrap();
        assert!(secs > 1_700_000_000); // sanity: after 2023
        assert!(ms >= secs * 1000); // ms is finer-grained
        let n: u32 = SystemBuiltins.generate("$randomInt").unwrap().parse().unwrap();
        assert!(n <= 1000);
        assert!(SystemBuiltins.generate("$nope").is_none());
    }

    #[test]
    fn iso_known_vectors() {
        assert_eq!(iso8601_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso8601_utc(86_400), "1970-01-02T00:00:00Z");
        assert_eq!(iso8601_utc(1_609_459_200), "2021-01-01T00:00:00Z");
        assert_eq!(iso8601_utc(1_609_459_200 + 3661), "2021-01-01T01:01:01Z");
        assert_eq!(iso8601_utc(68_169_600), "1972-02-29T00:00:00Z"); // first post-epoch leap day
        assert_eq!(iso8601_utc(951_782_400), "2000-02-29T00:00:00Z"); // 400-year leap (century)
    }
}
