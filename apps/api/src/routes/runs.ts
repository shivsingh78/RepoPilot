import { Router } from "express";
import { z } from "zod";
import {
  CreateRunRequestSchema,
  enqueueStage,
  parseGitHubRepoUrl,
  RepoPilotError,
  runEventsRepo,
  runsRepo,
  RunStatusSchema,
  withTransaction,
} from "@repopilot/shared";
import type { AppContext } from "../app.js";

const IdParam = z.object({ id: z.uuid() });
const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.uuid().optional(),
  status: RunStatusSchema.optional(),
});
const EventsQuery = z.object({ after: z.coerce.number().int().nonnegative().default(0) });

export function runsRouter(ctx: Pick<AppContext, "db" | "pipelineQueue" | "logger">): Router {
  const r = Router();

  r.post("/runs", async (req, res) => {
    const body = CreateRunRequestSchema.parse(req.body);
    const parsed = parseGitHubRepoUrl(body.repoUrl);
    if (!parsed) throw new RepoPilotError("INVALID_REPO_URL", `not a github repo url: ${body.repoUrl}`);
    const ref = body.ref ?? parsed.ref;

    const run = await withTransaction(ctx.db, async (tx) => {
      const created = await runsRepo.create(tx, { repoUrl: parsed.normalizedUrl, owner: parsed.owner, repo: parsed.repo, ref, options: body.options });
      await runEventsRepo.append(tx, { runId: created.id, stage: null, type: "run_created", message: `Run created for ${parsed.owner}/${parsed.repo}${ref ? `@${ref}` : ""}` });
      return created;
    });
    // Enqueue after commit so the worker can always load the row. If enqueueing fails the
    // run must not be left orphaned in `queued`; mark it failed so the state stays truthful.
    try {
      await enqueueStage(ctx.pipelineQueue, { runId: run.id, stage: "ingest" });
    } catch (e) {
      await runsRepo.markFailed(ctx.db, run.id, "INTERNAL", "Failed to enqueue the run");
      await runEventsRepo.append(ctx.db, { runId: run.id, stage: "ingest", level: "error", type: "enqueue_failed", message: "Failed to enqueue the run" });
      throw e;
    }
    res.status(202).json({ run });
  });

  r.get("/runs", async (req, res) => {
    const q = ListQuery.parse(req.query);
    const page = await runsRepo.list(ctx.db, { limit: q.limit, cursor: q.cursor ?? null, status: q.status });
    res.json(page);
  });

  r.get("/runs/:id", async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const run = await runsRepo.getById(ctx.db, id);
    if (!run) throw new RepoPilotError("RUN_NOT_FOUND", `run ${id} not found`);
    res.json({ run });
  });

  r.get("/runs/:id/events", async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const { after } = EventsQuery.parse(req.query);
    const run = await runsRepo.getById(ctx.db, id);
    if (!run) throw new RepoPilotError("RUN_NOT_FOUND", `run ${id} not found`);
    const events = await runEventsRepo.listForRun(ctx.db, id, { after });
    res.json({ events });
  });

  r.post("/runs/:id/cancel", async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const run = await runsRepo.getById(ctx.db, id);
    if (!run) throw new RepoPilotError("RUN_NOT_FOUND", `run ${id} not found`);
    const moved = await runsRepo.requestCancel(ctx.db, id);
    if (!moved) throw new RepoPilotError("RUN_TERMINAL", `run ${id} is ${run.status}`);
    await runEventsRepo.append(ctx.db, { runId: id, stage: run.stage, type: "cancel_requested", message: "Cancellation requested" });
    const updated = await runsRepo.getById(ctx.db, id);
    res.status(202).json({ run: updated });
  });

  // Reserved result routes (docs/API.md). Implemented on Day 2+.
  for (const sub of ["snapshot", "issues", "patches", "tests", "verifications", "pull-requests"]) {
    r.get(`/runs/:id/${sub}`, (_req, _res) => {
      throw new RepoPilotError("NOT_IMPLEMENTED", `${sub} not implemented`);
    });
  }
  r.post("/runs/:id/pull-request", (_req, _res) => {
    throw new RepoPilotError("NOT_IMPLEMENTED", "pull-request creation not implemented");
  });

  return r;
}
