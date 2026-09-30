import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import type { ApiEnv, DbPool, Logger, PipelineQueue, RedisConnection } from "@repopilot/shared";
import { RepoPilotError } from "@repopilot/shared";
import { requireApiKey } from "./middleware/auth.js";
import { errorHandler } from "./middleware/error-handler.js";
import { requestId } from "./middleware/request-id.js";
import { healthRouter } from "./routes/health.js";
import { runsRouter } from "./routes/runs.js";

export interface AppContext {
  env: ApiEnv;
  logger: Logger;
  db: DbPool;
  redis: RedisConnection;
  pipelineQueue: PipelineQueue;
}

export function createApp(ctx: AppContext) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(requestId());
  app.use(
    pinoHttp({
      logger: ctx.logger,
      genReqId: (req) => req.headers["x-request-id"] as string,
      autoLogging: { ignore: (req) => req.url === "/health" || req.url === "/ready" },
    }),
  );
  app.use(helmet());
  app.use(cors({ origin: ctx.env.CORS_ORIGIN.split(",").map((s) => s.trim()) }));
  app.use(express.json({ limit: "64kb" }));

  app.use(healthRouter(ctx));
  app.use("/api/v1", requireApiKey(ctx.env.API_KEYS), runsRouter(ctx));

  app.use((_req, _res, next) => next(new RepoPilotError("RUN_NOT_FOUND", "Route not found", { userMessage: "Not found" })));
  app.use(errorHandler(ctx.logger));
  return app;
}
