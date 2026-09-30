import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import type { Logger } from "@repopilot/shared";
import { HTTP_STATUS_BY_CODE, isRepoPilotError } from "@repopilot/shared";

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const requestId = req.headers["x-request-id"];
    if (err instanceof ZodError) {
      res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "The request was malformed.", requestId, details: { issues: err.issues } },
      });
      return;
    }
    // express.json() body parse failures
    if (typeof err === "object" && err !== null && "type" in err && (err as { type?: string }).type === "entity.parse.failed") {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid JSON body.", requestId } });
      return;
    }
    if (isRepoPilotError(err)) {
      const status = HTTP_STATUS_BY_CODE[err.code];
      if (status >= 500) logger.error({ err, requestId }, "request failed");
      res.status(status).json({ error: { code: err.code, message: err.userMessage, requestId, ...(err.details !== undefined && status < 500 ? { details: err.details } : {}) } });
      return;
    }
    logger.error({ err, requestId }, "unhandled error");
    res.status(500).json({ error: { code: "INTERNAL", message: "An internal error occurred.", requestId } });
  };
}
