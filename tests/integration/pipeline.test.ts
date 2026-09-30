/**
 * End-to-end plumbing test: API → PostgreSQL → Redis/BullMQ → worker → PostgreSQL.
 * Requires real PostgreSQL and Redis (docker compose up postgres redis). Skipped unless RUN_INTEGRATION=1.
 * On Day 1 no stage handler exists, so the expected terminal state is `failed` with NOT_IMPLEMENTED —
 * this proves the state machine and failure path without pretending ingestion exists.
 */
import request from "supertest";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDbPool,
  createQueue,
  createRedisConnection,
  QUEUE_NAMES,
  runMigrations,
  type ApiEnv,
  type DbPool,
  type PipelineQueue,
  type RedisConnection,
  type WorkerEnv,
} from "@repopilot/shared";
import { createApp } from "../../apps/api/src/app.js";
import { createPipelineWorker } from "../../services/worker/src/pipeline/worker.js";

const RUN = process.env["RUN_INTEGRATION"] === "1";
const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgres://repopilot:repopilot@localhost:5432/repopilot";
const REDIS_URL = process.env["REDIS_URL"] ?? "redis://localhost:6379";

describe.skipIf(!RUN)("pipeline plumbing (integration)", () => {
  let db: DbPool;
  let redis: RedisConnection;
  let pipelineQueue: PipelineQueue;
  let sandboxQueue: PipelineQueue;
  let worker: ReturnType<typeof createPipelineWorker>;
  const logger = pino({ level: "silent" });

  beforeAll(async () => {
    db = createDbPool(DATABASE_URL, { max: 4 });
    redis = createRedisConnection(REDIS_URL);
    await runMigrations(db);
    // isolate from any other queue consumers/leftover jobs
    pipelineQueue = createQueue(QUEUE_NAMES.pipeline, redis);
    sandboxQueue = createQueue(QUEUE_NAMES.sandbox, redis);
    await pipelineQueue.obliterate({ force: true });
    const workerEnv: WorkerEnv = {
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      DATABASE_URL,
      REDIS_URL,
      WORKER_HEALTH_PORT: 0,
      PIPELINE_CONCURRENCY: 1,
      SANDBOX_CONCURRENCY: 1,
      WORKSPACE_ROOT: "./workspaces",
      ANTHROPIC_MODEL: "claude-opus-5-5",
    };
    worker = createPipelineWorker({ env: workerEnv, logger, db, redis, pipelineQueue, sandboxQueue }, QUEUE_NAMES.pipeline, 1);
    await worker.waitUntilReady();
  });

  afterAll(async () => {
    await worker?.close();
    await pipelineQueue?.close();
    await sandboxQueue?.close();
    await redis?.quit();
    await db?.end();
  });

  function app() {
    const env: ApiEnv = { NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL, REDIS_URL, PORT: 0, API_KEYS: [], CORS_ORIGIN: "*" };
    return createApp({ env, logger, db, redis, pipelineQueue });
  }

  it("readiness reports healthy dependencies", async () => {
    const res = await request(app()).get("/ready");
    expect(res.status).toBe(200);
    expect(res.body.checks.postgres.ok).toBe(true);
    expect(res.body.checks.redis.ok).toBe(true);
  });

  it("creates a run, the worker processes the ingest job, and the run reaches a terminal state with an event trail", async () => {
    const create = await request(app()).post("/api/v1/runs").send({ repoUrl: "https://github.com/expressjs/express/tree/master" });
    expect(create.status).toBe(202);
    const run = create.body.run;
    expect(run.status).toBe("queued");
    expect(run.stage).toBe("ingest");
    expect(run.owner).toBe("expressjs");
    expect(run.ref).toBe("master");

    // wait for the worker
    let final = run;
    for (let i = 0; i < 50 && !["completed", "failed", "cancelled"].includes(final.status); i++) {
      await new Promise((r) => setTimeout(r, 200));
      final = (await request(app()).get(`/api/v1/runs/${run.id}`)).body.run;
    }
    expect(final.status).toBe("failed");
    expect(final.errorCode).toBe("NOT_IMPLEMENTED");
    expect(final.finishedAt).not.toBeNull();

    const events = (await request(app()).get(`/api/v1/runs/${run.id}/events`)).body.events;
    const types = events.map((e: { type: string }) => e.type);
    expect(types).toEqual(["run_created", "stage_started", "stage_failed"]);
    const failed = events.find((e: { type: string }) => e.type === "stage_failed");
    expect(failed.data.code).toBe("NOT_IMPLEMENTED");
    expect(failed.data.willRetry).toBe(false);
  });

  it("cancel moves a queued run to cancelling and rejects cancelling a terminal run", async () => {
    await worker.pause();
    try {
      const create = await request(app()).post("/api/v1/runs").send({ repoUrl: "https://github.com/a/b" });
      const id = create.body.run.id;
      const cancel = await request(app()).post(`/api/v1/runs/${id}/cancel`);
      expect(cancel.status).toBe(202);
      expect(cancel.body.run.status).toBe("cancelling");
      await worker.resume();
      let final = cancel.body.run;
      for (let i = 0; i < 50 && final.status !== "cancelled"; i++) {
        await new Promise((r) => setTimeout(r, 200));
        final = (await request(app()).get(`/api/v1/runs/${id}`)).body.run;
      }
      expect(final.status).toBe("cancelled");
      const again = await request(app()).post(`/api/v1/runs/${id}/cancel`);
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("RUN_TERMINAL");
    } finally {
      if (worker.isPaused()) await worker.resume();
    }
  });

  it("schema enforces provenance: verification_runs rejects any source other than observed", async () => {
    const { rows } = await db.query<{ id: string }>(`SELECT id FROM runs ORDER BY id DESC LIMIT 1`);
    const runId = rows[0]!.id;
    await expect(
      db.query(
        `INSERT INTO verification_runs (id, run_id, patch_id, kind, source, status) VALUES (gen_random_uuid(), $1, NULL, 'baseline', 'ai_inference', 'completed')`,
        [runId],
      ),
    ).rejects.toThrow(/verification_runs_source_check/);
  });
});
