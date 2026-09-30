import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { RepoPilotError } from "@repopilot/shared";

/**
 * Bearer API-key auth. Disabled when no keys are configured (local dev).
 * Comparison is constant-time over SHA-256 digests so key length is not leaked.
 */
export function requireApiKey(keys: readonly string[]): RequestHandler {
  if (keys.length === 0) return (_req, _res, next) => next();
  const digests = keys.map((k) => createHash("sha256").update(k).digest());
  return (req, _res, next) => {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) return next(new RepoPilotError("UNAUTHORIZED", "missing bearer token"));
    const candidate = createHash("sha256").update(token).digest();
    const ok = digests.some((d) => timingSafeEqual(d, candidate));
    return ok ? next() : next(new RepoPilotError("UNAUTHORIZED", "invalid api key"));
  };
}
