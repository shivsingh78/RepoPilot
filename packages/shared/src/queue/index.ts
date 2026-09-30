import { Queue } from "bullmq";
import type { JobsOptions } from "bullmq";
import IORedis from "ioredis";
import { z } from "zod";
import { StageSchema } from "../schemas/run.js";

export const QUEUE_NAMES = {
  pipeline: "pipeline",
  sandbox: "sandbox",
} as const;
export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** Job payloads are intentionally tiny; PostgreSQL is the source of truth. */
export const PipelineJobDataSchema = z.object({
  runId: z.uuid(),
  stage: StageSchema,
});
export type PipelineJobData = z.infer<typeof PipelineJobDataSchema>;

export type RedisConnection = IORedis;

export function createRedisConnection(url: string): RedisConnection {
  return new IORedis(url, {
    // Required by BullMQ so blocking commands are not retried and aborted.
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
  });
}

export async function checkRedis(conn: RedisConnection): Promise<{ ok: boolean; error?: string; latencyMs: number }> {
  const t0 = Date.now();
  try {
    const pong = await conn.ping();
    return { ok: pong === "PONG", latencyMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), latencyMs: Date.now() - t0 };
  }
}

export const DEFAULT_PIPELINE_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
};

export const DEFAULT_SANDBOX_JOB_OPTIONS: JobsOptions = {
  attempts: 1,
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
};

export type PipelineQueue = Queue<PipelineJobData>;

export function createQueue(name: QueueName, connection: RedisConnection): PipelineQueue {
  return new Queue<PipelineJobData>(name, { connection });
}

/** Deterministic job id so duplicate enqueues of the same stage collapse. BullMQ forbids ":" in custom ids. */
export function stageJobId(runId: string, stage: PipelineJobData["stage"]): string {
  return `${runId}__${stage}`;
}

export async function enqueueStage(queue: PipelineQueue, data: PipelineJobData, opts?: JobsOptions): Promise<string> {
  PipelineJobDataSchema.parse(data);
  const base = queue.name === QUEUE_NAMES.sandbox ? DEFAULT_SANDBOX_JOB_OPTIONS : DEFAULT_PIPELINE_JOB_OPTIONS;
  const job = await queue.add(data.stage, data, { ...base, ...opts, jobId: stageJobId(data.runId, data.stage) });
  return job.id ?? stageJobId(data.runId, data.stage);
}
