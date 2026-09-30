import { z } from "zod";

/**
 * Structured-output schemas for every model call. These are passed to the API as
 * output_config.format (via zodOutputFormat) AND used to parse the response.
 *
 * Invariant (docs/ARCHITECTURE.md §1.4, docs/SECURITY.md T4): none of these schemas
 * has any field in which a runtime/verification result could be expressed. All are
 * `.strict()` so extra keys such as "testsPass" are rejected, not ignored.
 */

export const IssueSeverity = z.enum(["low", "medium", "high", "critical"]);
export const IssueCategory = z.enum(["bug", "security", "reliability", "type_safety", "other"]);

export const AiIssueSchema = z
  .object({
    title: z.string().min(1).max(200),
    category: IssueCategory,
    severity: IssueSeverity,
    confidence: z.number().min(0).max(1),
    file: z.string().min(1).max(500),
    lineStart: z.number().int().positive(),
    lineEnd: z.number().int().positive(),
    explanation: z.string().min(1).max(4000),
    evidence: z.string().max(2000),
  })
  .strict();
export type AiIssue = z.infer<typeof AiIssueSchema>;

export const AnalysisOutputSchema = z
  .object({
    issues: z.array(AiIssueSchema).max(25),
  })
  .strict();
export type AnalysisOutput = z.infer<typeof AnalysisOutputSchema>;

export const AiPatchSchema = z
  .object({
    /** 0-based index into the issues list the model was given. */
    issueRef: z.number().int().nonnegative(),
    rationale: z.string().min(1).max(4000),
    unifiedDiff: z.string().min(1).max(200_000),
    filesTouched: z.array(z.string().min(1)).min(1).max(20),
  })
  .strict();
export type AiPatch = z.infer<typeof AiPatchSchema>;

export const PatchOutputSchema = z.object({ patches: z.array(AiPatchSchema).max(25) }).strict();
export type PatchOutput = z.infer<typeof PatchOutputSchema>;

export const AiTestSchema = z
  .object({
    patchRef: z.number().int().nonnegative(),
    path: z.string().min(1).max(500),
    framework: z.enum(["vitest", "jest", "mocha", "node:test"]),
    content: z.string().min(1).max(100_000),
  })
  .strict();
export type AiTest = z.infer<typeof AiTestSchema>;

export const TestOutputSchema = z.object({ tests: z.array(AiTestSchema).max(25) }).strict();
export type TestOutput = z.infer<typeof TestOutputSchema>;

/** Names that must never appear as keys in any AI output schema. Guarded by a unit test. */
export const FORBIDDEN_AI_OUTPUT_KEYS = [
  "verified",
  "verification",
  "testsPass",
  "testsPassed",
  "exitCode",
  "passed",
  "failed",
  "outcome",
  "observed",
] as const;
