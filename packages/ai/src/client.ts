import Anthropic from "@anthropic-ai/sdk";

/**
 * Anthropic client factory. Only the worker constructs this (docs/SECURITY.md §4).
 * Model ids are configuration, never hard-coded in stage logic.
 */
export const DEFAULT_MODEL = "claude-opus-5-5";

export interface AiClientConfig {
  apiKey: string;
  model?: string;
  /** Milliseconds. SDK default is 10 minutes; stages stream, so keep the default. */
  timeoutMs?: number;
  maxRetries?: number;
}

export function createAnthropicClient(cfg: AiClientConfig): Anthropic {
  return new Anthropic({
    apiKey: cfg.apiKey,
    ...(cfg.timeoutMs !== undefined ? { timeout: cfg.timeoutMs } : {}),
    maxRetries: cfg.maxRetries ?? 2,
  });
}

/** Per-run token budget (docs/PRD.md §7). Enforced by stage code before each call. */
export interface TokenBudget {
  maxInputTokens: number;
  maxOutputTokens: number;
}

export const DEFAULT_TOKEN_BUDGET: TokenBudget = {
  maxInputTokens: 600_000,
  maxOutputTokens: 60_000,
};
