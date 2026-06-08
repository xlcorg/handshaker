#!/usr/bin/env node
// CLI: `pnpm release <x.y.z> [flags]` — one action to cut a release.
//
// Bumps the version in src-tauri/Cargo.toml, package.json AND Cargo.lock (single source
// of truth is Cargo.toml — Tauri reads it; the others are kept in lockstep), commits,
// creates an annotated `vX.Y.Z` tag, and pushes branch+tag. Pushing the tag triggers the
// GitHub Releases CI (.github/workflows/release.yml), which builds the signed update
// artifacts + latest.json. The TAG does not set the version — we bump FIRST, else CI
// would build the old version and offer no update.
//
// Flags:
//   --dry-run        print the plan and exit; touch nothing
//   --no-push        bump + commit + tag locally, but don't push
//   --skip-checks    skip `pnpm lint` + `pnpm test` preflight
//   --yes, -y        don't ask for confirmation before pushing
//   --remote <name>  push target (default: origin)

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, execSync } from "node:child_process";
import { createInterface } from "node:readline";
import { isValidVersion, bumpCargoToml, bumpPackageJson, bumpCargoLock } from "./version.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---- arg parsing -----------------------------------------------------------
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("-")));
const positional = argv.filter((a) => !a.startsWith("-"));
const version = positional[0];
const remoteIdx = argv.indexOf("--remote");
const remote = remoteIdx !== -1 ? argv[remoteIdx + 1] : "origin";

const DRY = flags.has("--dry-run");
const NO_PUSH = flags.has("--no-push");
const SKIP_CHECKS = flags.has("--skip-checks");
const YES = flags.has("--yes") || flags.has("-y");

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!isValidVersion(version)) {
  die("Usage: pnpm release <x.y.z> [--dry-run] [--no-push] [--skip-checks] [--yes] [--remote <name>]\n  (strict MAJOR.MINOR.PATCH, no 'v' prefix)");
}

const tag = `v${version}`;

// ---- git helpers -----------------------------------------------------------
function git(args, opts = {}) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", ...opts }).trim();
}
function gitInherit(args) {
  execFileSync("git", args, { cwd: root, stdio: "inherit" });
}

// ---- preflight -------------------------------------------------------------
try {
  git(["rev-parse", "--is-inside-work-tree"]);
} catch {
  die("not inside a git repository");
}

const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);

// Read-only facts used by both the dry-run preview and the real preconditions.
// Working tree must be clean except for untracked files (we commit explicit paths only).
const dirty = git(["status", "--porcelain"])
  .split("\n")
  .filter((l) => l && !l.startsWith("?? "));
const tagExists = Boolean(git(["tag", "--list", tag]));

const blockers = [];
if (dirty.length) blockers.push(`working tree has ${dirty.length} uncommitted change(s) — commit or stash first`);
if (tagExists) blockers.push(`tag ${tag} already exists locally — git tag -d ${tag} or pick a new version`);

// ---- plan ------------------------------------------------------------------
console.log(`Release plan:`);
console.log(`  version  ${version}`);
console.log(`  branch   ${branch}`);
console.log(`  tag      ${tag} (annotated)`);
console.log(`  files    src-tauri/Cargo.toml · package.json · Cargo.lock`);
console.log(`  push     ${NO_PUSH ? "(skipped: --no-push)" : `${remote} ${branch} + ${tag}`}`);
console.log(`  checks   ${SKIP_CHECKS ? "(skipped)" : "pnpm lint + pnpm test"}`);

if (DRY) {
  if (blockers.length) {
    console.log("\nBlockers (a real run would abort):");
    blockers.forEach((b) => console.log(`  - ${b}`));
  }
  console.log("\n--dry-run: nothing was changed.");
  process.exit(0);
}

if (blockers.length) die(`cannot release:\n  - ${blockers.join("\n  - ")}`);

// ---- preflight checks (before any mutation) --------------------------------
if (!SKIP_CHECKS) {
  for (const cmd of ["pnpm lint", "pnpm test"]) {
    console.log(`\n▶ ${cmd}`);
    try {
      execSync(cmd, { cwd: root, stdio: "inherit" });
    } catch {
      die(`${cmd} failed — fix it or re-run with --skip-checks (not recommended for a release).`);
    }
  }
}

// ---- confirm ---------------------------------------------------------------
async function confirm() {
  if (YES) return true;
  if (!process.stdin.isTTY) {
    die("non-interactive shell: pass --yes to confirm the release push.");
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((res) =>
    rl.question(`\nProceed — bump, commit, tag ${tag}${NO_PUSH ? "" : `, and push to ${remote}`}? [y/N] `, res),
  );
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

if (!(await confirm())) die("aborted.");

// ---- mutate: bump the three files ------------------------------------------
const edits = [
  ["src-tauri/Cargo.toml", (c) => bumpCargoToml(c, version)],
  ["package.json", (c) => bumpPackageJson(c, version)],
  ["Cargo.lock", (c) => bumpCargoLock(c, "handshaker", version)],
];
for (const [rel, fn] of edits) {
  const p = join(root, rel);
  writeFileSync(p, fn(readFileSync(p, "utf8")));
}
console.log(`✓ bumped version to ${version}`);

// ---- commit (skip if already at target) ------------------------------------
gitInherit(["add", "src-tauri/Cargo.toml", "package.json", "Cargo.lock"]);
const staged = git(["diff", "--cached", "--name-only"]);
if (staged) {
  gitInherit(["commit", "-m", `chore(release): ${tag}`]);
  console.log(`✓ committed ${tag}`);
} else {
  console.log(`• version files already at ${version}; tagging current HEAD`);
}

// ---- tag -------------------------------------------------------------------
gitInherit(["tag", "-a", tag, "-m", tag]);
console.log(`✓ tagged ${tag}`);

// ---- push ------------------------------------------------------------------
if (NO_PUSH) {
  console.log(`\nSkipped push. When ready:\n  git push --atomic ${remote} ${branch} ${tag}`);
  process.exit(0);
}

console.log(`\n▶ git push --atomic ${remote} ${branch} ${tag}`);
try {
  gitInherit(["push", "--atomic", remote, branch, tag]);
} catch {
  die(
    `push failed. The commit + tag exist locally; once fixed, retry:\n` +
      `  git push --atomic ${remote} ${branch} ${tag}`,
  );
}

console.log(`\n✓ released ${tag} — CI is building the artifacts.`);
console.log(`  watch:   gh run watch`);
console.log(`  release: https://github.com/xlcorg/handshaker/releases/tag/${tag}`);
