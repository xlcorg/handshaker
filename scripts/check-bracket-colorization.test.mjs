import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = "scripts/check-bracket-colorization.py";

function show(revPath) {
  return execFileSync("git", ["show", revPath], { encoding: "utf8" });
}

function runOn(root) {
  return spawnSync("python3", [SCRIPT, "--root", root], { encoding: "utf8" });
}

function tempTree(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "bracket-"));
  for (const [rel, text] of Object.entries(files)) {
    const dest = path.join(dir, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, text);
  }
  return dir;
}

describe("bracket colorization", () => {
  it("passes on this tree", () => {
    const out = execFileSync("python3", [SCRIPT], { encoding: "utf8" });
    expect(out).toContain("bracketPairColorization=0");
    expect(out).toContain("colorizedBracketPairs=src/lib/monaco.ts");
  });

  it("fails on the editor option from a667f2a", () => {
    const dir = tempTree({
      "src/lib/monaco.ts": show("a667f2a:src/lib/monaco.ts"),
    });
    try {
      const result = runOn(dir);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("bracketPairColorization=1");
      expect(result.stdout).toContain("src/lib/monaco.ts:");
      expect(result.stdout).toContain("bracketPairColorization");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes on the language config from 0ba7bfa", () => {
    const dir = tempTree({
      "src/lib/monaco.ts": show("0ba7bfa:src/lib/monaco.ts"),
    });
    try {
      const result = runOn(dir);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("bracketPairColorization=0");
      expect(result.stdout).toContain("colorizedBracketPairs=src/lib/monaco.ts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails when either string leaves monaco.ts", () => {
    const dir = tempTree({
      "src/lib/monaco.ts": "colorizedBracketPairs: []\n",
      "src/features/bodyview/BodyView.tsx":
        "bracketPairColorization: { enabled: false }\ncolorizedBracketPairs: []\n",
    });
    try {
      const result = runOn(dir);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("src/features/bodyview/BodyView.tsx:");
      expect(result.stdout).toContain("bracketPairColorization");
      expect(result.stdout).toContain("colorizedBracketPairs");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("BodyView does not call updateOptions", () => {
    const src = readFileSync("src/features/bodyview/BodyView.tsx", "utf8");
    expect(src.includes("updateOptions")).toBe(false);
    expect(src.includes("createBodyEditor")).toBe(true);
    expect(src.includes("setMinimap")).toBe(true);
    expect(src.includes("forwardViewZoneContextMenu")).toBe(false);
  });
});
