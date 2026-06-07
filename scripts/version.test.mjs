import { describe, it, expect } from "vitest";
import { isValidVersion, bumpCargoToml, bumpPackageJson } from "./version.mjs";

describe("isValidVersion", () => {
  it("accepts x.y.z", () => {
    expect(isValidVersion("0.1.1")).toBe(true);
    expect(isValidVersion("12.0.34")).toBe(true);
  });
  it("rejects non-semver-ish input", () => {
    expect(isValidVersion("v0.1.1")).toBe(false);
    expect(isValidVersion("0.1")).toBe(false);
    expect(isValidVersion("0.1.1-beta")).toBe(false);
    expect(isValidVersion("")).toBe(false);
  });
});

describe("bumpCargoToml", () => {
  const toml = [
    "[package]",
    'name = "handshaker"',
    'version = "0.1.0"',
    "edition.workspace = true",
    "",
    "[workspace.dependencies]",
    'tonic = "0.14"',
    'tauri = { version = "2.11", features = [] }',
  ].join("\n");

  it("replaces only the [package] version, not dependency versions", () => {
    const out = bumpCargoToml(toml, "0.2.0");
    expect(out).toContain('version = "0.2.0"');
    // dependency version strings are untouched
    expect(out).toContain('tonic = "0.14"');
    expect(out).toContain('tauri = { version = "2.11", features = [] }');
    // exactly one standalone `version = "..."` line, now 0.2.0
    expect(out).not.toContain('version = "0.1.0"');
  });

  it("preserves CRLF line endings when present", () => {
    const crlf = toml.replace(/\n/g, "\r\n");
    const out = bumpCargoToml(crlf, "0.2.0");
    expect(out).toContain("\r\n");
    expect(out).toContain('version = "0.2.0"');
  });

  it("throws if no [package] version is found", () => {
    expect(() => bumpCargoToml('[workspace]\nmembers = []', "0.2.0")).toThrow();
  });
});

describe("bumpPackageJson", () => {
  const pkg = '{\n  "name": "handshaker",\n  "version": "0.1.0",\n  "type": "module"\n}\n';

  it("replaces the top-level version", () => {
    const out = bumpPackageJson(pkg, "0.2.0");
    expect(out).toContain('"version": "0.2.0"');
    expect(out).not.toContain('"version": "0.1.0"');
    // surrounding keys preserved
    expect(out).toContain('"name": "handshaker"');
    expect(out).toContain('"type": "module"');
  });

  it("throws if no version field is found", () => {
    expect(() => bumpPackageJson('{\n  "name": "x"\n}\n', "0.2.0")).toThrow();
  });
});
