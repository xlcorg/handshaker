#!/usr/bin/env node
// CLI: `pnpm version:bump <x.y.z>` — single-sources the app version.
//
// The app/updater version is read by Tauri from src-tauri/Cargo.toml (we deliberately
// dropped `version` from tauri.conf.json). package.json is bumped too for tidiness even
// though the updater does not read it. The git TAG does not set the version — bump here
// FIRST, then tag, or CI builds the old version and no update is offered.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidVersion, bumpCargoToml, bumpPackageJson } from "./version.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];

if (!isValidVersion(version)) {
  console.error("Usage: pnpm version:bump <x.y.z>   (strict MAJOR.MINOR.PATCH, no 'v')");
  process.exit(1);
}

const cargoPath = join(root, "src-tauri", "Cargo.toml");
const pkgPath = join(root, "package.json");

writeFileSync(cargoPath, bumpCargoToml(readFileSync(cargoPath, "utf8"), version));
writeFileSync(pkgPath, bumpPackageJson(readFileSync(pkgPath, "utf8"), version));

console.log(`✓ Version set to ${version} in src-tauri/Cargo.toml and package.json`);
console.log("Next steps:");
console.log("  cargo build -p handshaker            # sync Cargo.lock");
console.log(`  git commit -am "chore: bump version to ${version}"`);
console.log(`  git tag v${version} && git push origin main v${version}   # triggers the release CI`);
