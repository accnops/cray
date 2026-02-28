// Pricing per million tokens (as of 2026)
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-5-20251101": { input: 15.0, output: 75.0 },
  "claude-sonnet-4-5-20250929": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4.0 },
  // Fallback for unknown models
  default: { input: 3.0, output: 15.0 },
};

// Cache pricing multipliers
export const CACHE_READ_MULTIPLIER = 0.1; // 10% of input cost
export const CACHE_WRITE_MULTIPLIER = 1.25; // 125% of input cost

export function estimateCost(
  model: string | null,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number
): number {
  const pricing = MODEL_PRICING[model ?? ""] ?? MODEL_PRICING.default;
  const inputCostPerToken = pricing.input / 1_000_000;
  const outputCostPerToken = pricing.output / 1_000_000;

  const inputCost = inputTokens * inputCostPerToken;
  const outputCost = outputTokens * outputCostPerToken;
  const cacheReadCost = cacheReadTokens * inputCostPerToken * CACHE_READ_MULTIPLIER;
  const cacheWriteCost = cacheWriteTokens * inputCostPerToken * CACHE_WRITE_MULTIPLIER;

  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}
