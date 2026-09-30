import type { Logger, Run, Stage } from "@repopilot/shared";
import { STAGES } from "@repopilot/shared";
import type { WorkerContext } from "./context.js";

export interface StageContext {
  ctx: WorkerContext;
  run: Run;
  log: Logger;
  /** Resolves true if cancellation was requested; handlers check this between steps. */
  isCancelled: () => Promise<boolean>;
}

/**
 * A stage handler does its work idempotently and returns the next stage, or null when
 * the pipeline is complete. It must not enqueue jobs itself; the processor does that.
 */
export type StageHandler = (sc: StageContext) => Promise<Stage | null>;

export function nextStageOf(stage: Stage): Stage | null {
  const i = STAGES.indexOf(stage);
  return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1]! : null;
}

/**
 * Stage registry. Day 1 registers no handlers: every stage resolves to NOT_IMPLEMENTED
 * so the queue → worker → database plumbing can be proven end to end without pretending
 * that ingestion or analysis exist. Day 2 fills in `ingest` and `manifest` first.
 */
export const STAGE_HANDLERS: Partial<Record<Stage, StageHandler>> = {};

export function getStageHandler(stage: Stage): StageHandler | undefined {
  return STAGE_HANDLERS[stage];
}
