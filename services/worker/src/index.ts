import { createDbPool, createLogger, createQueue, createRedisConnection, parseEnv, QUEUE_NAMES, runMigrations, workerEnvSchema } from "@repopilot/shared";
import { startHealthServer } from "./health.js";
import { createPipelineWorker } from "./pipeline/worker.js";

const env = parseEnv(workerEnvSchema);
const logger = createLogger({ service: "worker", level: env.LOG_LEVEL, pretty: env.NODE_ENV === "development" });

const db = createDbPool(env.DATABASE_URL, { max: env.PIPELINE_CONCURRENCY + env.SANDBOX_CONCURRENCY + 2 });
const redis = createRedisConnection(env.REDIS_URL);
const pipelineQueue = createQueue(QUEUE_NAMES.pipeline, redis);
const sandboxQueue = createQueue(QUEUE_NAMES.sandbox, redis);

if (env.NODE_ENV !== "production") {
  const m = await runMigrations(db);
  if (m.applied.length) logger.info({ applied: m.applied }, "migrations applied");
}

const ctx = { env, logger, db, redis, pipelineQueue, sandboxQueue };
const pipelineWorker = createPipelineWorker(ctx, QUEUE_NAMES.pipeline, env.PIPELINE_CONCURRENCY);
const sandboxWorker = createPipelineWorker(ctx, QUEUE_NAMES.sandbox, env.SANDBOX_CONCURRENCY);
const health = startHealthServer({ port: env.WORKER_HEALTH_PORT, db, redis, logger });

logger.info({ pipelineConcurrency: env.PIPELINE_CONCURRENCY, sandboxConcurrency: env.SANDBOX_CONCURRENCY }, "worker started");

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  await Promise.allSettled([pipelineWorker.close(), sandboxWorker.close()]);
  health.close();
  await Promise.allSettled([pipelineQueue.close(), sandboxQueue.close()]);
  await redis.quit().catch(() => undefined);
  await db.end().catch(() => undefined);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
