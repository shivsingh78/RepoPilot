import request from "supertest";
import { describe, expect, it } from "vitest";
import type { ApiEnv, DbPool, PipelineQueue, RedisConnection } from "@repopilot/shared";
import { createLogger } from "@repopilot/shared";
import { createApp } from "./app.js";

/** Unit tests with stubbed dependencies; integration tests live in tests/integration. */
function makeApp(overrides: Partial<{ dbOk: boolean; redisOk: boolean; apiKeys: string[] }> = {}) {
  const env: ApiEnv = {
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    DATABASE_URL: "postgres://x",
    REDIS_URL: "redis://x",
    PORT: 0,
    API_KEYS: overrides.apiKeys ?? [],
    CORS_ORIGIN: "http://localhost:3000",
  };
  const db = {
    query: async () => {
      if (overrides.dbOk === false) throw new Error("db down");
      return { rows: [], rowCount: 0 };
    },
  } as unknown as DbPool;
  const redis = { ping: async () => (overrides.redisOk === false ? "NOPE" : "PONG") } as unknown as RedisConnection;
  const pipelineQueue = { name: "pipeline", add: async () => ({ id: "x" }) } as unknown as PipelineQueue;
  return createApp({ env, logger: createLogger({ service: "api-test", level: "silent" }), db, redis, pipelineQueue });
}

describe("api app", () => {
  it("GET /health is always ok", async () => {
    const res = await request(makeApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("GET /ready reports 503 when a dependency is down", async () => {
    const res = await request(makeApp({ dbOk: false })).get("/ready");
    expect(res.status).toBe(503);
    expect(res.body.checks.postgres.ok).toBe(false);
    expect(res.body.checks.redis.ok).toBe(true);
  });

  it("rejects invalid run bodies with VALIDATION_ERROR", async () => {
    const res = await request(makeApp()).post("/api/v1/runs").send({ nope: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects non-GitHub URLs with INVALID_REPO_URL", async () => {
    const res = await request(makeApp()).post("/api/v1/runs").send({ repoUrl: "https://gitlab.com/a/b" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_REPO_URL");
  });

  it("returns 400 on malformed JSON", async () => {
    const res = await request(makeApp()).post("/api/v1/runs").set("content-type", "application/json").send("{bad");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("enforces bearer auth when API_KEYS is set", async () => {
    const app = makeApp({ apiKeys: ["secret-1"] });
    expect((await request(app).get("/api/v1/runs")).status).toBe(401);
    expect((await request(app).get("/api/v1/runs").set("authorization", "Bearer wrong")).status).toBe(401);
    expect((await request(app).get("/api/v1/runs").set("authorization", "Bearer secret-1")).status).toBe(200);
    expect((await request(app).get("/health")).status).toBe(200);
  });

  it("reserved result routes return 501", async () => {
    const res = await request(makeApp()).get("/api/v1/runs/018f0000-0000-7000-8000-000000000000/issues");
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe("NOT_IMPLEMENTED");
  });
});
