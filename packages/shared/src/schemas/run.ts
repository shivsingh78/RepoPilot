import { z } from "zod";

export const STAGES = [
  "ingest",
  "manifest",
  "select_context",
  "analyze",
  "generate_patches",
  "validate_patches",
  "generate_tests",
  "verify_baseline",
  "verify_patches",
  "finalize",
] as const;
export const StageSchema = z.enum(STAGES);
export type Stage = z.infer<typeof StageSchema>;

/** Stages that must run on the low-concurrency sandbox queue. */
export const SANDBOX_STAGES: ReadonlySet<Stage> = new Set(["verify_baseline", "verify_patches"]);

export const RUN_STATUSES = ["queued", "running", "completed", "failed", "cancelling", "cancelled"] as const;
export const RunStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof RunStatusSchema>;
export const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set(["completed", "failed", "cancelled"]);

export const RunOptionsSchema = z
  .object({
    maxIssues: z.number().int().min(1).max(25).default(10),
    createPullRequest: z.boolean().default(false),
    allowLifecycleScripts: z.boolean().default(false),
  })
  .strict();
export type RunOptions = z.infer<typeof RunOptionsSchema>;

/**
 * Strict GitHub repository URL. Anything else is rejected before any network call
 * (docs/SECURITY.md T6). Owner/repo character sets follow GitHub's rules.
 */
const GITHUB_URL_RE =
  /^https:\/\/github\.com\/(?<owner>[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\/(?<repo>[A-Za-z0-9_.-]{1,100}?)(?:\.git)?(?:\/tree\/(?<ref>[A-Za-z0-9._\-/]{1,200}))?\/?$/;

export interface ParsedRepoUrl {
  owner: string;
  repo: string;
  ref: string | null;
  normalizedUrl: string;
}

export function parseGitHubRepoUrl(input: string): ParsedRepoUrl | null {
  const m = GITHUB_URL_RE.exec(input.trim());
  if (!m || !m.groups) return null;
  const owner = m.groups["owner"]!;
  const repo = m.groups["repo"]!;
  if (repo === "." || repo === "..") return null;
  const ref = m.groups["ref"] ?? null;
  if (ref && (ref.includes("..") || ref.startsWith("/") || ref.endsWith("/") || ref.endsWith(".lock"))) return null;
  return { owner, repo, ref, normalizedUrl: `https://github.com/${owner}/${repo}` };
}

export const RefSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._\-/]+$/, "ref contains invalid characters")
  .refine((r) => !r.includes("..") && !r.startsWith("/") && !r.endsWith("/"), "invalid ref");

export const CreateRunRequestSchema = z
  .object({
    repoUrl: z.string().min(1).max(500),
    ref: RefSchema.optional(),
    options: RunOptionsSchema.default({ maxIssues: 10, createPullRequest: false, allowLifecycleScripts: false }),
  })
  .strict();
export type CreateRunRequest = z.infer<typeof CreateRunRequestSchema>;

export const RunSchema = z.object({
  id: z.uuid(),
  repoUrl: z.string(),
  owner: z.string(),
  repo: z.string(),
  ref: z.string().nullable(),
  commitSha: z.string().nullable(),
  status: RunStatusSchema,
  stage: StageSchema,
  options: RunOptionsSchema,
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export type Run = z.infer<typeof RunSchema>;

export const RUN_EVENT_LEVELS = ["debug", "info", "warn", "error"] as const;
export const RunEventSchema = z.object({
  id: z.number().int(),
  runId: z.uuid(),
  stage: StageSchema.nullable(),
  level: z.enum(RUN_EVENT_LEVELS),
  type: z.string(),
  message: z.string(),
  data: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type RunEvent = z.infer<typeof RunEventSchema>;
