import { z } from "zod";

/**
 * Environment validation. Each process validates only what it needs so that,
 * for example, the API never requires ANTHROPIC_API_KEY (see docs/SECURITY.md §4).
 * A process refuses to start on invalid configuration.
 */

const nodeEnv = z.enum(["development", "test", "production"]).default("development");
const logLevel = z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info");
const port = z.coerce.number().int().min(1).max(65535);
const commaList = z
  .string()
  .optional()
  .transform((v) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean));

export const baseEnvSchema = z.object({
  NODE_ENV: nodeEnv,
  LOG_LEVEL: logLevel,
});

export const dataEnvSchema = baseEnvSchema.extend({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required").refine((v) => /^postgres(ql)?:\/\//.test(v), "DATABASE_URL must be a postgres:// URL"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required").refine((v) => /^rediss?:\/\//.test(v), "REDIS_URL must be a redis:// URL"),
});

export const apiEnvSchema = dataEnvSchema.extend({
  PORT: port.default(4000),
  API_KEYS: commaList,
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
});

export const workerEnvSchema = dataEnvSchema.extend({
  WORKER_HEALTH_PORT: port.default(4001),
  PIPELINE_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
  SANDBOX_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  WORKSPACE_ROOT: z.string().default("./workspaces"),
  // Optional on Day 1; required by AI stages when they are implemented.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-opus-5-5"),
  GITHUB_TOKEN: z.string().optional(),
});

export const webEnvSchema = baseEnvSchema.extend({
  API_BASE_URL: z.string().url().default("http://localhost:4000"),
  API_KEY: z.string().optional(),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;
export type WebEnv = z.infer<typeof webEnvSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: { path: string; message: string }[]) {
    super(
      `Invalid environment configuration:\n` +
        issues.map((i) => `  - ${i.path || "(root)"}: ${i.message}`).join("\n"),
    );
    this.name = "EnvValidationError";
  }
}

export function parseEnv<S extends z.ZodTypeAny>(schema: S, source: NodeJS.ProcessEnv = process.env): z.infer<S> {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })),
    );
  }
  return result.data;
}
