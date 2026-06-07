// Pure version-string transforms shared by the `version:bump` CLI. No side effects,
// so they are unit-testable without touching the filesystem.

/** A strict `MAJOR.MINOR.PATCH` semver (no `v` prefix, no pre-release/build suffix). */
export function isValidVersion(v) {
  return /^\d+\.\d+\.\d+$/.test(v);
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

/** Replace the first (top-level) `"version": "..."` in a package.json, minimally. */
export function bumpPackageJson(content, version) {
  const re = /("version"\s*:\s*)"[^"]*"/;
  if (!re.test(content)) throw new Error('bumpPackageJson: no "version" field found');
  return content.replace(re, `$1"${version}"`);
}
