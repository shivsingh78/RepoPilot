import type { DbPool, DbClient } from "../client.js";
import type { RunEvent, Stage } from "../../schemas/run.js";

type Queryable = Pick<DbPool | DbClient, "query">;

interface RunEventRow {
  id: string; // bigserial comes back as string
  run_id: string;
  stage: Stage | null;
  level: RunEvent["level"];
  type: string;
  message: string;
  data: Record<string, unknown>;
  created_at: Date;
}

function toEvent(r: RunEventRow): RunEvent {
  return {
    id: Number(r.id),
    runId: r.run_id,
    stage: r.stage,
    level: r.level,
    type: r.type,
    message: r.message,
    data: r.data ?? {},
    createdAt: r.created_at.toISOString(),
  };
}

export interface AppendEventInput {
  runId: string;
  stage: Stage | null;
  level?: RunEvent["level"];
  type: string;
  message: string;
  data?: Record<string, unknown>;
}

export const runEventsRepo = {
  async append(db: Queryable, input: AppendEventInput): Promise<RunEvent> {
    const { rows } = await db.query<RunEventRow>(
      `INSERT INTO run_events (run_id, stage, level, type, message, data)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, run_id, stage, level, type, message, data, created_at`,
      [input.runId, input.stage, input.level ?? "info", input.type, input.message, JSON.stringify(input.data ?? {})],
    );
    return toEvent(rows[0]!);
  },

  async listForRun(db: Queryable, runId: string, opts: { after?: number; limit?: number } = {}): Promise<RunEvent[]> {
    const { rows } = await db.query<RunEventRow>(
      `SELECT id, run_id, stage, level, type, message, data, created_at
       FROM run_events WHERE run_id = $1 AND id > $2 ORDER BY id ASC LIMIT $3`,
      [runId, opts.after ?? 0, opts.limit ?? 500],
    );
    return rows.map(toEvent);
  },
};
