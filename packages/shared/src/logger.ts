import pino from "pino";

export type Logger = pino.Logger;

const REDACT_PATHS = [
  "req.headers.authorization",
  "headers.authorization",
  "authorization",
  "apiKey",
  "token",
  "ANTHROPIC_API_KEY",
  "GITHUB_TOKEN",
  "GITHUB_APP_PRIVATE_KEY",
  "DATABASE_URL",
  "REDIS_URL",
];

export function createLogger(opts: { service: string; level?: string; pretty?: boolean }): Logger {
  return pino({
    name: opts.service,
    level: opts.level ?? "info",
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    base: { service: opts.service },
    ...(opts.pretty ? { transport: { target: "pino-pretty", options: { colorize: true } } } : {}),
  });
}
