import { Worker } from "bullmq";
import type { PipelineJobData, QueueName } from "@repopilot/shared";
import type { WorkerContext } from "./context.js";
import { processPipelineJob } from "./processor.js";

export function createPipelineWorker(ctx: WorkerContext, queueName: QueueName, concurrency: number): Worker<PipelineJobData> {
  const worker = new Worker<PipelineJobData>(queueName, (job) => processPipelineJob(ctx, job), {
    connection: ctx.redis,
    concurrency,
    lockDuration: queueName === "sandbox" ? 20 * 60_000 : 60_000,
  });
  worker.on("failed", (job, err) => ctx.logger.warn({ jobId: job?.id, queue: queueName, err: err.message }, "job failed"));
  worker.on("error", (err) => ctx.logger.error({ err, queue: queueName }, "worker error"));
  return worker;
}
