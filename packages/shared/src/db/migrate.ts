import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DbPool } from "./client.js";

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations");
const LOCK_KEY = 7263_0001; // arbitrary advisory lock id for migrations

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/**
 * Applies packages/shared/migrations/*.sql in lexical order, once each, under an
 * advisory lock so concurrent api/worker starts cannot race.
 */
export async function runMigrations(pool: DbPool, dir: string = MIGRATIONS_DIR): Promise<MigrationResult> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const client = await pool.connect();
  const applied: string[] = [];
  const skipped: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const { rows } = await client.query<{ version: string }>("SELECT version FROM schema_migrations");
    const done = new Set(rows.map((r) => r.version));
    for (const file of files) {
      const version = file.replace(/\.sql$/, "");
      if (done.has(version)) {
        skipped.push(version);
        continue;
      }
      const sql = await readFile(path.join(dir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
        await client.query("COMMIT");
        applied.push(version);
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${version} failed: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => undefined);
    client.release();
  }
  return { applied, skipped };
}
