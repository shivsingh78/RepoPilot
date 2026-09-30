/**
 * Closed set of error codes. Adding a code is an API change: update docs/API.md.
 */
export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "INVALID_REPO_URL",
  "REPO_NOT_FOUND",
  "REPO_TOO_LARGE",
  "UNSUPPORTED_ECOSYSTEM",
  "RUN_NOT_FOUND",
  "RUN_TERMINAL",
  "AI_SCHEMA_INVALID",
  "AI_REFUSED",
  "AI_BUDGET_EXCEEDED",
  "PATCH_INVALID",
  "PATCH_NOT_VERIFIED",
  "SANDBOX_UNAVAILABLE",
  "SANDBOX_TIMEOUT",
  "GITHUB_RATE_LIMITED",
  "GITHUB_FORBIDDEN",
  "GITHUB_APP_NOT_INSTALLED",
  "UNAUTHORIZED",
  "RATE_LIMITED",
  "NOT_IMPLEMENTED",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface RepoPilotErrorOptions {
  retryable?: boolean;
  stage?: string;
  details?: unknown;
  userMessage?: string;
  cause?: unknown;
}

export class RepoPilotError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly stage: string | undefined;
  readonly details: unknown;
  readonly userMessage: string;

  constructor(code: ErrorCode, message: string, opts: RepoPilotErrorOptions = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "RepoPilotError";
    this.code = code;
    this.retryable = opts.retryable ?? false;
    this.stage = opts.stage;
    this.details = opts.details;
    this.userMessage = opts.userMessage ?? DEFAULT_USER_MESSAGES[code];
  }
}

const DEFAULT_USER_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: "The request was malformed.",
  INVALID_REPO_URL: "The repository URL is not a valid GitHub repository URL.",
  REPO_NOT_FOUND: "Repository does not exist or is not accessible.",
  REPO_TOO_LARGE: "Repository exceeds the size limits.",
  UNSUPPORTED_ECOSYSTEM: "Only Node.js/TypeScript repositories with a test script are supported.",
  RUN_NOT_FOUND: "Run not found.",
  RUN_TERMINAL: "Run has already finished.",
  AI_SCHEMA_INVALID: "The model returned output that failed validation.",
  AI_REFUSED: "The model declined to process this repository.",
  AI_BUDGET_EXCEEDED: "The run exceeded its model token budget.",
  PATCH_INVALID: "The proposed patch failed validation.",
  PATCH_NOT_VERIFIED: "The patch has not been verified successfully.",
  SANDBOX_UNAVAILABLE: "The verification sandbox is unavailable.",
  SANDBOX_TIMEOUT: "Verification timed out.",
  GITHUB_RATE_LIMITED: "GitHub rate limit reached; try again later.",
  GITHUB_FORBIDDEN: "GitHub denied access to this repository.",
  GITHUB_APP_NOT_INSTALLED: "The RepoPilot GitHub App is not installed on this repository.",
  UNAUTHORIZED: "Missing or invalid API key.",
  RATE_LIMITED: "Too many requests.",
  NOT_IMPLEMENTED: "This capability is not implemented yet.",
  INTERNAL: "An internal error occurred.",
};

export const HTTP_STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  INVALID_REPO_URL: 400,
  REPO_NOT_FOUND: 404,
  REPO_TOO_LARGE: 422,
  UNSUPPORTED_ECOSYSTEM: 422,
  RUN_NOT_FOUND: 404,
  RUN_TERMINAL: 409,
  AI_SCHEMA_INVALID: 502,
  AI_REFUSED: 422,
  AI_BUDGET_EXCEEDED: 422,
  PATCH_INVALID: 422,
  PATCH_NOT_VERIFIED: 409,
  SANDBOX_UNAVAILABLE: 503,
  SANDBOX_TIMEOUT: 504,
  GITHUB_RATE_LIMITED: 429,
  GITHUB_FORBIDDEN: 403,
  GITHUB_APP_NOT_INSTALLED: 404,
  UNAUTHORIZED: 401,
  RATE_LIMITED: 429,
  NOT_IMPLEMENTED: 501,
  INTERNAL: 500,
};

export function isRepoPilotError(e: unknown): e is RepoPilotError {
  return e instanceof RepoPilotError;
}

/** Wrap any thrown value into a RepoPilotError without losing the original. */
export function toRepoPilotError(e: unknown, fallback: ErrorCode = "INTERNAL"): RepoPilotError {
  if (isRepoPilotError(e)) return e;
  const message = e instanceof Error ? e.message : String(e);
  return new RepoPilotError(fallback, message, { cause: e, retryable: false });
}
