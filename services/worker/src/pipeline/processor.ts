import { UnrecoverableError } from "bullmq";
import type { Job } from "bullmq";
import type { PipelineJobData } from "@repopilot/shared";
import { enqueueStage, PipelineJobDataSchema, RepoPilotError, runEventsRepo, runsRepo, SANDBOX_STAGES, toRepoPilotError } from "@repopilot/shared";
import type { WorkerContext } from "./context.js";
import { getStageHandler } from "./stages.js";

/**
 * Executes exactly one stage for one run. State transitions are persisted in PostgreSQL;
 * the job payload only says which run/stage to process.
 *
 * Failure semantics (docs/ARCHITECTURE.md §10–11):
 *  - retryable error and attempts remain  → rethrow so BullMQ retries with backoff
 *  - non-retryable, or attempts exhausted  → mark run failed, throw UnrecoverableError
 */
export async function processPipelineJob(ctx: WorkerContext, job: Job<PipelineJobData>): Promise<void> {
  const data = PipelineJobDataSchema.parse(job.data);
  const log = ctx.logger.child({ runId: data.runId, stage: data.stage, jobId: job.id });

  const run = await runsRepo.getById(ctx.db, data.runId);
  if (!run) {
    log.warn("run not found; dropping job");
    return;
  }
  if (run.status === "cancelling") {
    await runsRepo.markCancelled(ctx.db, run.id);
    await runEventsRepo.append(ctx.db, { runId: run.id, stage: data.stage, type: "run_cancelled", message: "Run cancelled" });
    return;
  }
  if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
    log.info({ status: run.status }, "run already terminal; skipping");
    return;
  }

  await runsRepo.markRunning(ctx.db, run.id, data.stage);
  await runEventsRepo.append(ctx.db, { runId: run.id, stage: data.stage, type: "stage_started", message: `Stage ${data.stage} started`, data: { attempt: job.attemptsMade + 1 } });
  const t0 = Date.now();

  try {
    const handler = getStageHandler(data.stage);
    if (!handler) {
      throw new RepoPilotError("NOT_IMPLEMENTED", `stage ${data.stage} has no handler`, { stage: data.stage, retryable: false });
    }
    const next = await handler({
      ctx,
      run: { ...run, status: "running", stage: data.stage },
      log,
      isCancelled: async () => (await runsRepo.getById(ctx.db, run.id))?.status === "cancelling",
    });
    await runEventsRepo.append(ctx.db, { runId: run.id, stage: data.stage, type: "stage_completed", message: `Stage ${data.stage} completed`, data: { durationMs: Date.now() - t0 } });

    if (next === null) {
      await runsRepo.markCompleted(ctx.db, run.id);
      await runEventsRepo.append(ctx.db, { runId: run.id, stage: data.stage, type: "run_completed", message: "Run completed" });
      return;
    }
    await runsRepo.advanceStage(ctx.db, run.id, next);
    const queue = SANDBOX_STAGES.has(next) ? ctx.sandboxQueue : ctx.pipelineQueue;
    await enqueueStage(queue, { runId: run.id, stage: next });
  } catch (e) {
    const err = toRepoPilotError(e);
    const attemptsAllowed = job.opts.attempts ?? 1;
    const attemptsUsed = job.attemptsMade + 1;
    const willRetry = err.retryable && attemptsUsed < attemptsAllowed;
    await runEventsRepo.append(ctx.db, {
      runId: run.id,
      stage: data.stage,
      level: "error",
      type: "stage_failed",
      message: `Stage ${data.stage} failed: ${err.code}`,
      data: { code: err.code, retryable: err.retryable, attempt: attemptsUsed, willRetry, detail: err.message.slice(0, 500) },
    });
    if (willRetry) {
      log.warn({ err, attempt: attemptsUsed }, "stage failed; will retry");
      throw err;
    }
    log.error({ err }, "stage failed; marking run failed");
    await runsRepo.markFailed(ctx.db, run.id, err.code, err.userMessage);
    throw new UnrecoverableError(`${err.code}: ${err.message}`);
  }
}
