import http from "node:http";
import type { DbPool, Logger, RedisConnection } from "@repopilot/shared";
import { checkDb, checkRedis } from "@repopilot/shared";

export const WORKER_VERSION = "0.1.0";

/** Minimal HTTP server for liveness/readiness only (docs/API.md). Docker check is added with the sandbox runner. */
export function startHealthServer(opts: { port: number; db: DbPool; redis: RedisConnection; logger: Logger }): http.Server {
  const server = http.createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/health") return send(200, { status: "ok", service: "worker", version: WORKER_VERSION });
    if (req.url === "/ready") {
      const [postgres, redis] = await Promise.all([checkDb(opts.db), checkRedis(opts.redis)]);
      const ok = postgres.ok && redis.ok;
      return send(ok ? 200 : 503, { status: ok ? "ok" : "degraded", service: "worker", checks: { postgres, redis } });
    }
    return send(404, { error: { code: "RUN_NOT_FOUND", message: "Not found" } });
  });
  server.listen(opts.port, () => opts.logger.info({ port: opts.port }, "worker health listening"));
  return server;
}
