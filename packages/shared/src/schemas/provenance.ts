import { z } from "zod";

/**
 * Provenance separates what the model *inferred* from what the sandbox *observed*.
 * The two literal types are intentionally disjoint so no record can carry both.
 */
export const AiInferenceSource = z.literal("ai_inference");
export const ObservedSource = z.literal("observed");
export type AiInferenceSource = z.infer<typeof AiInferenceSource>;
export type ObservedSource = z.infer<typeof ObservedSource>;
