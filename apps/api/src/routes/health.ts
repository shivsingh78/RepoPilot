import { Router } from "express";
import { checkDb, checkRedis } from "@repopilot/shared";
import type { AppContext } from "../app.js";

export const API_VERSION = "0.1.0";

export function healthRouter(ctx: Pick<AppContext, "db" | "redis">): Router {
  const r = Router();
  r.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "api", version: API_VERSION });
  });
  r.get("/ready", async (_req, res) => {
    const [postgres, redis] = await Promise.all([checkDb(ctx.db), checkRedis(ctx.redis)]);
    const ok = postgres.ok && redis.ok;
    res.status(ok ? 200 : 503).json({ status: ok ? "ok" : "degraded", service: "api", checks: { postgres, redis } });
  });
  return r;
}
