/**
 * @repopilot/github — GitHub integration boundary.
 *
 * Day 1: interfaces only. Implementations land on Day 2 (see docs/ARCHITECTURE.md §5, §9).
 * Rules: never shell out to `git`; construct api.github.com URLs only from parsed parts;
 * extraction must reject traversal, symlinks, hardlinks and enforce size limits.
 */
import { z } from "zod";
export { parseGitHubRepoUrl } from "@repopilot/shared";
export type { ParsedRepoUrl } from "@repopilot/shared";

export const RepositoryMetadataSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  defaultBranch: z.string(),
  isPrivate: z.boolean(),
  isArchived: z.boolean(),
  sizeKb: z.number().int().nonnegative(),
});
export type RepositoryMetadata = z.infer<typeof RepositoryMetadataSchema>;

export interface SnapshotLimits {
  maxFiles: number;
  maxTotalBytes: number;
  maxFileBytes: number;
}

export const DEFAULT_SNAPSHOT_LIMITS: SnapshotLimits = {
  maxFiles: 5_000,
  maxTotalBytes: 100 * 1024 * 1024,
  maxFileBytes: 2 * 1024 * 1024,
};

export interface SnapshotResult {
  commitSha: string;
  fileCount: number;
  totalBytes: number;
  rootDir: string;
}

/** Read side: metadata, ref resolution, tarball snapshot. */
export interface GitHubReader {
  getRepository(owner: string, repo: string): Promise<RepositoryMetadata>;
  resolveRef(owner: string, repo: string, ref: string): Promise<string>;
  downloadSnapshot(owner: string, repo: string, sha: string, destDir: string, limits: SnapshotLimits): Promise<SnapshotResult>;
}

/** Write side: branch + commit via Git Data API, then PR. Implemented with GitHub App installation tokens. */
export interface GitHubWriter {
  createBranchWithFiles(input: {
    owner: string;
    repo: string;
    baseSha: string;
    branch: string;
    files: { path: string; content: string }[];
    message: string;
  }): Promise<{ commitSha: string }>;
  openPullRequest(input: { owner: string; repo: string; head: string; base: string; title: string; body: string }): Promise<{ number: number; url: string }>;
}
