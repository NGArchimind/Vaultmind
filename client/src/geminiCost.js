// Estimated cost of a Gemini call, in GBP. Prices are Google's paid-tier list
// prices in USD per 1M tokens (checked 2026-09-28). Thinking tokens are billed
// as output, so they are included. Pro charges a higher rate for prompts over
// 200k tokens.
const USD_TO_GBP = 0.79;

const PRICES = {
  "gemini-2.5-flash": () => ({ input: 0.30, output: 2.50 }),
  "gemini-2.5-pro": (inputTokens) => inputTokens > 200_000
    ? { input: 2.50, output: 15.00 }
    : { input: 1.25, output: 10.00 },
};

export function estimateCostGBP(model, usage) {
  const input = usage?.input_tokens || 0;
  const output = (usage?.output_tokens || 0) + (usage?.thinking_tokens || 0);
  const rate = (PRICES[model] || PRICES["gemini-2.5-flash"])(input);
  return ((input / 1_000_000) * rate.input + (output / 1_000_000) * rate.output) * USD_TO_GBP;
}
