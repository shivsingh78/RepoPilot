import type { DbPool, DbClient } from "../client.js";
import { newId } from "../../ids.js";
import type { Run, RunOptions, RunStatus, Stage } from "../../schemas/run.js";

type Queryable = Pick<DbPool | DbClient, "query">;

interface RunRow {
  id: string;
  repo_url: string;
  owner: string;
  repo: string;
  ref: string | null;
  commit_sha: string | null;
  status: RunStatus;
  stage: Stage;
  options: RunOptions;
  error_code: string | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

function toRun(r: RunRow): Run {
  return {
    id: r.id,
    repoUrl: r.repo_url,
    owner: r.owner,
    repo: r.repo,
    ref: r.ref,
    commitSha: r.commit_sha,
    status: r.status,
    stage: r.stage,
    options: r.options,
    errorCode: r.error_code,
    errorMessage: r.error_message,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    startedAt: r.started_at?.toISOString() ?? null,
    finishedAt: r.finished_at?.toISOString() ?? null,
  };
}

const COLS = `id, repo_url, owner, repo, ref, commit_sha, status, stage, options, error_code, error_message, created_at, updated_at, started_at, finished_at`;

export interface CreateRunInput {
  repoUrl: string;
  owner: string;
  repo: string;
  ref: string | null;
  options: RunOptions;
}

export const runsRepo = {
  async create(db: Queryable, input: CreateRunInput): Promise<Run> {
    const id = newId();
    const { rows } = await db.query<RunRow>(
      `INSERT INTO runs (id, repo_url, owner, repo, ref, status, stage, options)
       VALUES ($1, $2, $3, $4, $5, 'queued', 'ingest', $6)
       RETURNING ${COLS}`,
      [id, input.repoUrl, input.owner, input.repo, input.ref, JSON.stringify(input.options)],
    );
    return toRun(rows[0]!);
  },

  async getById(db: Queryable, id: string): Promise<Run | null> {
    const { rows } = await db.query<RunRow>(`SELECT ${COLS} FROM runs WHERE id = $1`, [id]);
    return rows[0] ? toRun(rows[0]) : null;
  },

  async list(db: Queryable, opts: { limit: number; cursor?: string | null; status?: RunStatus }): Promise<{ runs: Run[]; nextCursor: string | null }> {
    const params: unknown[] = [];
    const where: string[] = [];
    if (opts.cursor) {
      params.push(opts.cursor);
      where.push(`id < $${params.length}`);
    }
    if (opts.status) {
      params.push(opts.status);
      where.push(`status = $${params.length}`);
    }
    params.push(opts.limit + 1);
    const { rows } = await db.query<RunRow>(
      `SELECT ${COLS} FROM runs ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT $${params.length}`,
      params,
    );
    const page = rows.slice(0, opts.limit).map(toRun);
    const nextCursor = rows.length > opts.limit ? page[page.length - 1]!.id : null;
    return { runs: page, nextCursor };
  },

  /** Transition to running (idempotent; only sets started_at once). */
  async markRunning(db: Queryable, id: string, stage: Stage): Promise<void> {
    await db.query(
      `UPDATE runs SET status = 'running', stage = $2, started_at = COALESCE(started_at, now()), updated_at = now()
       WHERE id = $1 AND status IN ('queued', 'running')`,
      [id, stage],
    );
  },

  async advanceStage(db: Queryable, id: string, stage: Stage): Promise<void> {
    await db.query(`UPDATE runs SET stage = $2, updated_at = now() WHERE id = $1`, [id, stage]);
  },

  async setCommitSha(db: Queryable, id: string, sha: string): Promise<void> {
    await db.query(`UPDATE runs SET commit_sha = $2, updated_at = now() WHERE id = $1`, [id, sha]);
  },

  async markCompleted(db: Queryable, id: string): Promise<void> {
    await db.query(
      `UPDATE runs SET status = 'completed', stage = 'finalize', finished_at = now(), updated_at = now() WHERE id = $1`,
      [id],
    );
  },

  async markFailed(db: Queryable, id: string, errorCode: string, errorMessage: string): Promise<void> {
    await db.query(
      `UPDATE runs SET status = 'failed', error_code = $2, error_message = $3, finished_at = now(), updated_at = now()
       WHERE id = $1 AND status NOT IN ('completed', 'cancelled')`,
      [id, errorCode, errorMessage.slice(0, 2000)],
    );
  },

  /** Returns true if the run was moved to cancelling; false if already terminal. */
  async requestCancel(db: Queryable, id: string): Promise<boolean> {
    const { rowCount } = await db.query(
      `UPDATE runs SET status = 'cancelling', updated_at = now()
       WHERE id = $1 AND status IN ('queued', 'running')`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  },

  async markCancelled(db: Queryable, id: string): Promise<void> {
    await db.query(
      `UPDATE runs SET status = 'cancelled', finished_at = now(), updated_at = now() WHERE id = $1 AND status = 'cancelling'`,
      [id],
    );
  },
};
