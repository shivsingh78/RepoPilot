import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

export function requestId(): RequestHandler {
  return (req, res, next) => {
    const incoming = req.headers["x-request-id"];
    const id = typeof incoming === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(incoming) ? incoming : randomUUID();
    req.headers["x-request-id"] = id;
    res.setHeader("x-request-id", id);
    next();
  };
}
