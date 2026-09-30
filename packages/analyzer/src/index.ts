/**
 * @repopilot/analyzer — pure functions over a repository snapshot.
 * No model calls, no Docker, no process spawning (docs/ARCHITECTURE.md §2.1).
 *
 * Day 1: manifest and validation schemas only; builders land on Day 2.
 */
import { z } from "zod";

export const ManifestFileSchema = z.object({
  path: z.string(),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().length(64),
  language: z.string().nullable(),
  lineCount: z.number().int().nonnegative().nullable(),
  isTest: z.boolean(),
  isConfig: z.boolean(),
  isGenerated: z.boolean(),
  isBinary: z.boolean(),
});
export type ManifestFile = z.infer<typeof ManifestFileSchema>;

export const EcosystemSchema = z.object({
  kind: z.literal("node"),
  packageManager: z.enum(["npm", "pnpm", "yarn"]),
  testRunner: z.enum(["vitest", "jest", "mocha", "node:test", "unknown"]),
  typescript: z.boolean(),
  scripts: z.record(z.string(), z.string()),
  nodeVersionHint: z.string().nullable(),
});
export type Ecosystem = z.infer<typeof EcosystemSchema>;

export const ManifestSchema = z.object({
  files: z.array(ManifestFileSchema),
  ecosystem: EcosystemSchema.nullable(),
  entryPoints: z.array(z.string()),
  importEdges: z.array(z.tuple([z.string(), z.string()])),
});
export type Manifest = z.infer<typeof ManifestSchema>;

/** Deterministic patch validation result (docs/ARCHITECTURE.md §7). */
export const PatchValidationSchema = z.object({
  ok: z.boolean(),
  checks: z.array(z.object({ name: z.string(), ok: z.boolean(), detail: z.string().optional() })),
});
export type PatchValidation = z.infer<typeof PatchValidationSchema>;

/** Paths a patch may never touch. Enforced on every hunk target (docs/SECURITY.md T3). */
export const PATCH_PATH_DENYLIST: readonly RegExp[] = [
  /^\.github\//,
  /^\.gitlab-ci\.yml$/,
  /^\.circleci\//,
  /^Dockerfile(\..*)?$/,
  /^docker-compose.*\.ya?ml$/,
  /^(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/,
  /^\.npmrc$/,
  /^\.env(\..*)?$/,
  /(^|\/)\.git\//,
];

export function isDeniedPatchPath(p: string): boolean {
  return PATCH_PATH_DENYLIST.some((re) => re.test(p));
}
