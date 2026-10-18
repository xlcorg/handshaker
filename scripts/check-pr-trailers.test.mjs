import { describe, it, expect } from "vitest";
import { coAuthorHits, readCommitLog } from "./check-pr-trailers.mjs";

function logOf(commits) {
  return commits.map((commit) => `${commit.hash}\x1e${commit.body}\x1e`).join("\n");
}

describe("check-pr-trailers", () => {
  it("flags a commit body that contains Co-authored-by", () => {
    const commits = readCommitLog(
      logOf([
        {
          hash: "d2d7aa39b38e46a23ce5c84bdd0c4645cc60971d",
          body: "fix(envs): place save status\n\nCo-authored-by: Cursor Agent <cursoragent@cursor.com>",
        },
      ]),
    );
    const hits = coAuthorHits(commits);
    expect(hits.map((hit) => hit.hash)).toEqual(["d2d7aa39b38e46a23ce5c84bdd0c4645cc60971d"]);
    expect(hits[0].body).toContain("Co-authored-by:");
  });

  it("flags Co-Authored-By regardless of letter case", () => {
    const commits = readCommitLog(
      logOf([
        {
          hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          body: "fix(tauri): grant a permission\n\nCo-Authored-By: Someone <someone@example.com>",
        },
      ]),
    );
    expect(coAuthorHits(commits)).toHaveLength(1);
  });

  it("leaves a clean range and commits outside that range alone", () => {
    const commits = readCommitLog(
      logOf([
        {
          hash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          body: "ci: gate pull requests and reject trailers\n\nThe pull request range is clean.",
        },
      ]),
    );
    expect(coAuthorHits(commits)).toEqual([]);
    expect(readCommitLog("")).toEqual([]);
  });
});
