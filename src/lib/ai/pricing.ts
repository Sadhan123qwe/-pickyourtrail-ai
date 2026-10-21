/**
 * Approximate list prices in USD per 1M tokens, used only to ESTIMATE spend
 * for the usage dashboard and budget guard. Verify against current provider
 * pricing; override with OPENAI_PRICE_INPUT_PER_1M / OPENAI_PRICE_OUTPUT_PER_1M
 * for models not listed here.
 */
const PRICES: Record<string, { input: number; cachedInput: number; output: number }> = {
  // Current models (input/output from the OpenAI models page, 2026-10; cached-input price assumed at 25% of input).
  "gpt-6-luna": { input: 0.1, cachedInput: 0.025, output: 0.5 },
  "gpt-6.1-sol": { input: 2.0, cachedInput: 0.5, output: 10.0 },
  "gpt-6-astra": { input: 10.0, cachedInput: 2.5, output: 50.0 },
  // Older models, still accepted if configured.
  "gpt-4.1-mini": { input: 0.4, cachedInput: 0.1, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, cachedInput: 0.025, output: 0.4 },
  "gpt-4.1": { input: 2.0, cachedInput: 0.5, output: 8.0 },
  "gpt-4o-mini": { input: 0.15, cachedInput: 0.075, output: 0.6 },
  "gpt-4o": { input: 2.5, cachedInput: 1.25, output: 10.0 },
  "gpt-5-mini": { input: 0.25, cachedInput: 0.025, output: 2.0 },
  "gpt-5-nano": { input: 0.05, cachedInput: 0.005, output: 0.4 },
  "gpt-5": { input: 1.25, cachedInput: 0.125, output: 10.0 },
};

function envPrice(name: string): number | undefined {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : undefined;
}

export function priceFor(model: string): { input: number; cachedInput: number; output: number } | null {
  const input = envPrice("OPENAI_PRICE_INPUT_PER_1M");
  const output = envPrice("OPENAI_PRICE_OUTPUT_PER_1M");
  if (input && output) return { input, cachedInput: input / 4, output };
  const key = Object.keys(PRICES)
    .sort((a, b) => b.length - a.length)
    .find((k) => model === k || model.startsWith(`${k}-`));
  return key ? PRICES[key] : null;
}

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number, cachedTokens = 0): number {
  const price = priceFor(model);
  if (!price) return 0;
  const uncached = Math.max(inputTokens - cachedTokens, 0);
  return (uncached * price.input + cachedTokens * price.cachedInput + outputTokens * price.output) / 1_000_000;
}
