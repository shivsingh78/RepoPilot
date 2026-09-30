import { describe, expect, it } from "vitest";
import { apiEnvSchema, EnvValidationError, parseEnv, workerEnvSchema } from "./env.js";

const good = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
};

describe("env validation", () => {
  it("parses a valid api environment with defaults", () => {
    const env = parseEnv(apiEnvSchema, { ...good });
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe("development");
    expect(env.API_KEYS).toEqual([]);
  });

  it("splits API_KEYS into a list", () => {
    const env = parseEnv(apiEnvSchema, { ...good, API_KEYS: "a, b,,c" });
    expect(env.API_KEYS).toEqual(["a", "b", "c"]);
  });

  it("rejects a missing DATABASE_URL with a readable error", () => {
    expect(() => parseEnv(apiEnvSchema, { REDIS_URL: good.REDIS_URL })).toThrow(EnvValidationError);
    try {
      parseEnv(apiEnvSchema, { REDIS_URL: good.REDIS_URL });
    } catch (e) {
      expect((e as EnvValidationError).message).toContain("DATABASE_URL");
    }
  });

  it("rejects a non-postgres DATABASE_URL", () => {
    expect(() => parseEnv(apiEnvSchema, { ...good, DATABASE_URL: "mysql://x" })).toThrow(/postgres/);
  });

  it("does not require ANTHROPIC_API_KEY for the worker on day 1", () => {
    const env = parseEnv(workerEnvSchema, { ...good });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_MODEL).toBe("claude-opus-5-5");
  });

  it("coerces numeric ports and rejects out-of-range", () => {
    expect(parseEnv(apiEnvSchema, { ...good, PORT: "8080" }).PORT).toBe(8080);
    expect(() => parseEnv(apiEnvSchema, { ...good, PORT: "70000" })).toThrow(EnvValidationError);
  });
});
