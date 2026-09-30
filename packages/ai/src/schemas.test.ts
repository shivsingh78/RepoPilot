import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { AnalysisOutputSchema, FORBIDDEN_AI_OUTPUT_KEYS, PatchOutputSchema, TestOutputSchema } from "./schemas.js";

const validIssue = {
  title: "Off-by-one in pagination",
  category: "bug",
  severity: "medium",
  confidence: 0.8,
  file: "src/page.ts",
  lineStart: 10,
  lineEnd: 12,
  explanation: "…",
  evidence: "for (i = 0; i <= n; i++)",
};

function collectKeys(schema: z.ZodTypeAny, acc = new Set<string>()): Set<string> {
  const def = (schema as unknown as { def?: { type?: string; shape?: Record<string, z.ZodTypeAny>; element?: z.ZodTypeAny; innerType?: z.ZodTypeAny } }).def;
  if (!def) return acc;
  if (def.type === "object" && def.shape) {
    for (const [k, v] of Object.entries(def.shape)) {
      acc.add(k);
      collectKeys(v, acc);
    }
  } else if (def.type === "array" && def.element) {
    collectKeys(def.element, acc);
  } else if (def.innerType) {
    collectKeys(def.innerType, acc);
  }
  return acc;
}

describe("AI output schemas", () => {
  it("accepts a valid analysis output", () => {
    expect(AnalysisOutputSchema.parse({ issues: [validIssue] }).issues).toHaveLength(1);
  });

  it("rejects any attempt by the model to assert verification", () => {
    expect(() => AnalysisOutputSchema.parse({ issues: [validIssue], verified: true })).toThrow();
    expect(() => AnalysisOutputSchema.parse({ issues: [{ ...validIssue, testsPass: true }] })).toThrow();
    expect(() =>
      PatchOutputSchema.parse({
        patches: [{ issueRef: 0, rationale: "x", unifiedDiff: "--- a\n+++ b\n", filesTouched: ["a"], exitCode: 0 }],
      }),
    ).toThrow();
  });

  it("contains no forbidden runtime-result keys anywhere in the schema tree", () => {
    for (const schema of [AnalysisOutputSchema, PatchOutputSchema, TestOutputSchema]) {
      const keys = collectKeys(schema);
      expect(keys.size).toBeGreaterThan(0);
      for (const forbidden of FORBIDDEN_AI_OUTPUT_KEYS) {
        expect(keys.has(forbidden)).toBe(false);
      }
    }
  });

  it("bounds confidence to [0,1]", () => {
    expect(() => AnalysisOutputSchema.parse({ issues: [{ ...validIssue, confidence: 1.5 }] })).toThrow();
  });
});
