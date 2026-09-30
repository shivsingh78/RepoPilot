import { createDbPool } from "./client.js";
import { runMigrations } from "./migrate.js";
import { dataEnvSchema, parseEnv } from "../env.js";

const env = parseEnv(dataEnvSchema);
const pool = createDbPool(env.DATABASE_URL, { max: 2 });
try {
  const result = await runMigrations(pool);
  console.warn(`migrations applied: ${result.applied.length ? result.applied.join(", ") : "(none)"}; already applied: ${result.skipped.length}`);
} finally {
  await pool.end();
}
