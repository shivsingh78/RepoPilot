import { describe, expect, it } from "vitest";
import { CreateRunRequestSchema, parseGitHubRepoUrl } from "./run.js";

describe("parseGitHubRepoUrl", () => {
  it.each([
    ["https://github.com/expressjs/express", "expressjs", "express", null],
    ["https://github.com/expressjs/express.git", "expressjs", "express", null],
    ["https://github.com/expressjs/express/", "expressjs", "express", null],
    ["https://github.com/o-w/re.po_1/tree/feat/x.y", "o-w", "re.po_1", "feat/x.y"],
  ])("accepts %s", (url, owner, repo, ref) => {
    const r = parseGitHubRepoUrl(url);
    expect(r).not.toBeNull();
    expect(r!.owner).toBe(owner);
    expect(r!.repo).toBe(repo);
    expect(r!.ref).toBe(ref);
    expect(r!.normalizedUrl).toBe(`https://github.com/${owner}/${repo}`);
  });

  it.each([
    "http://github.com/a/b",
    "https://gitlab.com/a/b",
    "https://github.com/a",
    "https://github.com/a/b/c",
    "https://github.com/-a/b",
    "https://github.com/a/..",
    "https://github.com/a/b/tree/../etc",
    "https://github.com/a/b?x=1",
    "https://github.com/a/b/tree/",
    "https://evil.com/https://github.com/a/b",
    "ftp://github.com/a/b",
    "",
  ])("rejects %s", (url) => {
    expect(parseGitHubRepoUrl(url)).toBeNull();
  });
});

describe("CreateRunRequestSchema", () => {
  it("applies defaults", () => {
    const r = CreateRunRequestSchema.parse({ repoUrl: "https://github.com/a/b" });
    expect(r.options).toEqual({ maxIssues: 10, createPullRequest: false, allowLifecycleScripts: false });
  });
  it("rejects unknown keys", () => {
    expect(() => CreateRunRequestSchema.parse({ repoUrl: "x", verified: true })).toThrow();
  });
  it("rejects a bad ref", () => {
    expect(() => CreateRunRequestSchema.parse({ repoUrl: "https://github.com/a/b", ref: "a..b" })).toThrow();
  });
});
