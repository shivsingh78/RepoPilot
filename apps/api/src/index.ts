import { apiEnvSchema, createDbPool, createLogger, createQueue, createRedisConnection, parseEnv, QUEUE_NAMES, runMigrations } from "@repopilot/shared";
import { createApp } from "./app.js";

const env = parseEnv(apiEnvSchema);
const logger = createLogger({ service: "api", level: env.LOG_LEVEL, pretty: env.NODE_ENV === "development" });

const db = createDbPool(env.DATABASE_URL);
const redis = createRedisConnection(env.REDIS_URL);
const pipelineQueue = createQueue(QUEUE_NAMES.pipeline, redis);

if (env.NODE_ENV !== "production") {
  const m = await runMigrations(db);
  if (m.applied.length) logger.info({ applied: m.applied }, "migrations applied");
}

const app = createApp({ env, logger, db, redis, pipelineQueue });
const server = app.listen(env.PORT, () => logger.info({ port: env.PORT }, "api listening"));

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  server.close();
  await pipelineQueue.close().catch(() => undefined);
  await redis.quit().catch(() => undefined);
  await db.end().catch(() => undefined);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
