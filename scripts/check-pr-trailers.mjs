// Fails when any commit in a revision range contains a Co-authored-by trailer.
//
// The check reads `git log`. A commit-msg hook cannot see the trailer:
// commit-msg.cursor.co-author appends it after earlier commit-msg hooks.
// Historical commits already on main are out of range for a pull request
// opened against main; pass only the pull request range.

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const TRAILER = /co-authored-by/i;

/** Parse `git log <range> --format=%H%x1e%B%x1e`. */
export function readCommitLog(logText) {
  const commits = [];
  const parts = logText.split("\x1e");
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const hash = parts[i].replace(/^\n/, "").trim();
    const body = parts[i + 1].replace(/^\n/, "").replace(/\s+$/, "");
    if (!hash) continue;
    commits.push({ hash, body });
  }
  return commits;
}

/** Commits whose message contains a Co-authored-by trailer. */
export function coAuthorHits(commits) {
  return commits.filter((commit) => TRAILER.test(commit.body));
}

export function formatHits(hits) {
  return hits
    .map((hit) => `${hit.hash} contains Co-authored-by:\n\n${hit.body}`)
    .join("\n\n");
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

function main() {
  const range = process.argv[2];
  if (!range) {
    console.error("usage: node scripts/check-pr-trailers.mjs <rev-range>");
    process.exit(2);
  }

  let logText;
  try {
    logText = execFileSync("git", ["log", range, "--format=%H%x1e%B%x1e"], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    const stderr = error && error.stderr ? String(error.stderr) : "";
    console.error(stderr || error.message);
    process.exit(2);
  }

  const commits = readCommitLog(logText);
  const hits = coAuthorHits(commits);
  if (hits.length === 0) {
    const noun = commits.length === 1 ? "commit" : "commits";
    console.log(`no Co-authored-by in ${range} (${commits.length} ${noun})`);
    return;
  }

  console.error(formatHits(hits));
  process.exit(1);
}

if (isDirectRun()) main();
