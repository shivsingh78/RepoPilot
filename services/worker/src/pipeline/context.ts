import type { DbPool, Logger, PipelineQueue, RedisConnection, WorkerEnv } from "@repopilot/shared";

export interface WorkerContext {
  env: WorkerEnv;
  logger: Logger;
  db: DbPool;
  redis: RedisConnection;
  pipelineQueue: PipelineQueue;
  sandboxQueue: PipelineQueue;
}
