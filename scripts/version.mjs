// Pure version-string transforms shared by the `version:bump` CLI. No side effects,
// so they are unit-testable without touching the filesystem.

/** A strict `MAJOR.MINOR.PATCH` semver (no `v` prefix, no pre-release/build suffix). */
export function isValidVersion(v) {
  return /^\d+\.\d+\.\d+$/.test(v);
}

/** The bump levels accepted by {@link nextVersion}. */
export const BUMP_LEVELS = ["major", "minor", "patch"];

/**
 * Increment a strict `x.y.z` version by one semver level, resetting lower parts:
 * patch -> x.y.(z+1), minor -> x.(y+1).0, major -> (x+1).0.0.
 */
export function nextVersion(current, level) {
  if (!isValidVersion(current)) throw new Error(`nextVersion: invalid current version "${current}"`);
  const [major, minor, patch] = current.split(".").map(Number);
  switch (level) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`nextVersion: unknown level "${level}" (use ${BUMP_LEVELS.join(" | ")})`);
  }
}

/** Read the `[package]` `version = "..."` from a Cargo.toml, ignoring dependency versions. */
export function readCargoTomlVersion(content) {
  let inPackage = false;
  for (const line of content.split(/\r?\n/)) {
    const section = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (section) {
      inPackage = section[1].trim() === "package";
      continue;
    }
    if (inPackage) {
      const m = line.match(/^\s*version\s*=\s*"([^"]*)"/);
      if (m) return m[1];
    }
  }
  throw new Error('readCargoTomlVersion: no [package] version = "..." found');
}

/**
 * Replace the `version = "..."` line inside the `[package]` table of a Cargo.toml,
 * leaving every other `version = "..."` (e.g. under `[workspace.dependencies]`) untouched.
 * Original line endings (LF or CRLF) are preserved.
 */
export function bumpCargoToml(content, version) {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  let inPackage = false;
  let done = false;
  const out = lines.map((line) => {
    const section = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (section) {
      inPackage = section[1].trim() === "package";
      return line;
    }
    if (inPackage && !done && /^\s*version\s*=\s*"[^"]*"/.test(line)) {
      done = true;
      return line.replace(/version\s*=\s*"[^"]*"/, `version = "${version}"`);
    }
    return line;
  });
  if (!done) throw new Error('bumpCargoToml: no [package] version = "..." line found');
  return out.join(eol);
}

/**
 * Replace the `version = "..."` line inside the `[[package]]` block whose
 * `name = "<pkgName>"` in a Cargo.lock, leaving every other package untouched.
 * Matches the name exactly (so `handshaker` does NOT touch `handshaker-core`).
 * Original line endings (LF or CRLF) are preserved.
 */
export function bumpCargoLock(content, pkgName, version) {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  let currentName = null;
  let done = false;
  const out = lines.map((line) => {
    if (/^\s*\[\[package\]\]\s*$/.test(line)) {
      currentName = null;
      return line;
    }
    const nameMatch = line.match(/^\s*name\s*=\s*"([^"]*)"\s*$/);
    if (nameMatch) {
      currentName = nameMatch[1];
      return line;
    }
    if (!done && currentName === pkgName && /^\s*version\s*=\s*"[^"]*"/.test(line)) {
      done = true;
      return line.replace(/version\s*=\s*"[^"]*"/, `version = "${version}"`);
    }
    return line;
  });
  if (!done) throw new Error(`bumpCargoLock: package "${pkgName}" not found in Cargo.lock`);
  return out.join(eol);
}

/** Replace the first (top-level) `"version": "..."` in a package.json, minimally. */
export function bumpPackageJson(content, version) {
  const re = /("version"\s*:\s*)"[^"]*"/;
  if (!re.test(content)) throw new Error('bumpPackageJson: no "version" field found');
  return content.replace(re, `$1"${version}"`);
}
