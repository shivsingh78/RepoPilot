import pg from "pg";

export type DbPool = pg.Pool;
export type DbClient = pg.PoolClient;

export function createDbPool(connectionString: string, opts: { max?: number } = {}): DbPool {
  const pool = new pg.Pool({
    connectionString,
    max: opts.max ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  pool.on("error", () => {
    /* surfaced by the next query; avoid crashing the process on idle client errors */
  });
  return pool;
}

export async function checkDb(pool: DbPool): Promise<{ ok: boolean; error?: string; latencyMs: number }> {
  const t0 = Date.now();
  try {
    await pool.query("SELECT 1");
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), latencyMs: Date.now() - t0 };
  }
}

export async function withTransaction<T>(pool: DbPool, fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
