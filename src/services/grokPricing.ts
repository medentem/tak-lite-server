/**
 * xAI Grok API pricing (USD per 1M tokens).
 * Source: https://docs.x.ai/docs/models — update when pricing changes.
 */
export const GROK_MODEL_PRICING: Record<string, { inputPerM: number; outputPerM: number }> = {
  'grok-4-1-fast-reasoning': { inputPerM: 0.20, outputPerM: 0.50 },
  'grok-4-1-fast-non-reasoning': { inputPerM: 0.20, outputPerM: 0.50 },
  'grok-4-fast-reasoning': { inputPerM: 0.20, outputPerM: 0.50 },
  'grok-4-fast-non-reasoning': { inputPerM: 0.20, outputPerM: 0.50 },
  'grok-3': { inputPerM: 0.30, outputPerM: 0.50 },
  'grok-3-mini': { inputPerM: 0.30, outputPerM: 0.50 },
};

/** Default pricing when model is not in map (e.g. new aliases). */
const DEFAULT_PRICING = { inputPerM: 0.20, outputPerM: 0.50 };

/**
 * X Search tool invocation cost (Responses API). xAI charges $5 per 1,000 calls.
 * See https://docs.x.ai/developers/models — Tools Pricing.
 */
export const X_SEARCH_COST_PER_CALL_USD = 5 / 1000;

export interface UsageFromResponse {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
}

/**
 * Compute estimated cost in USD for a single API call.
 */
export function estimateCostUsd(
  model: string,
  usage: UsageFromResponse
): { costUsd: number; promptTokens: number; completionTokens: number; totalTokens: number } {
  const pricing = GROK_MODEL_PRICING[model] ?? DEFAULT_PRICING;
  const promptTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
  const totalTokens = usage.total_tokens ?? promptTokens + completionTokens;

  const costUsd =
    (promptTokens / 1_000_000) * pricing.inputPerM +
    (completionTokens / 1_000_000) * pricing.outputPerM;

  return {
    costUsd,
    promptTokens,
    completionTokens,
    totalTokens,
  };
}

/**
 * Get display-friendly model name for UI.
 */
export function getModelDisplayName(model: string): string {
  const names: Record<string, string> = {
    'grok-4-1-fast-reasoning': 'Grok 4.1 Fast Reasoning',
    'grok-4-1-fast-non-reasoning': 'Grok 4.1 Fast',
    'grok-4-fast-reasoning': 'Grok 4 Fast Reasoning',
    'grok-4-fast-non-reasoning': 'Grok 4 Fast',
    'grok-3': 'Grok 3',
    'grok-3-mini': 'Grok 3 Mini',
  };
  return names[model] ?? model;
}
