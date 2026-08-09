import { _config } from '../config/config.js';
import type { CostBreakdown, ModelPricing, PricingTier } from './types.js';

function tierRates(tier: PricingTier): { input: number; output: number; cacheInput: number } {
  switch (tier) {
    case 'lite':
      return {
        input: parseFloat(_config.AI_MODEL_LITE_INPUT_USD_PER_1M ?? '0.25'),
        output: parseFloat(_config.AI_MODEL_LITE_OUTPUT_USD_PER_1M ?? '1.50'),
        cacheInput: parseFloat(_config.AI_MODEL_LITE_CACHE_INPUT_USD_PER_1M ?? '0.025'),
      };
    case 'pro':
      return {
        input: parseFloat(_config.AI_MODEL_PRO_INPUT_USD_PER_1M ?? '0.30'),
        output: parseFloat(_config.AI_MODEL_PRO_OUTPUT_USD_PER_1M ?? '2.50'),
        cacheInput: parseFloat(_config.AI_MODEL_PRO_CACHE_INPUT_USD_PER_1M ?? '0.03'),
      };
    default:
      return {
        input: parseFloat(_config.AI_MODEL_INPUT_USD_PER_1M ?? '0.25'),
        output: parseFloat(_config.AI_MODEL_OUTPUT_USD_PER_1M ?? '1.50'),
        cacheInput: parseFloat(_config.AI_MODEL_CACHE_INPUT_USD_PER_1M ?? '0.025'),
      };
  }
}

export function resolvePricingTier(model: string): PricingTier {
  const m = model.toLowerCase();
  const eq = (v?: string) => (v ?? '').toLowerCase() === m;

  // Model ID wins — workshop/policy inherit AI_MODEL_PRO; when that is flash-lite, bill as lite.
  if (m.includes('flash-lite') || m.endsWith('-lite')) return 'lite';
  if (m.includes('pro')) return 'pro';

  if (
    eq(_config.AI_MODEL_LITE) ||
    eq(_config.RC_AI_MODEL) ||
    eq(_config.DL_AI_MODEL) ||
    eq(_config.PRESCREEN_MODEL)
  ) {
    return 'lite';
  }
  if (eq(_config.AI_MODEL_PRO) || eq(_config.POLICY_AI_MODEL)) {
    return 'pro';
  }
  if (eq(_config.AI_MODEL)) return 'default';

  return 'default';
}

export function getModelPricing(model: string): ModelPricing {
  const tier = resolvePricingTier(model);
  const rates = tierRates(tier);
  return {
    inputUsdPer1M: rates.input,
    outputUsdPer1M: rates.output,
    cacheInputUsdPer1M: rates.cacheInput,
    tier,
  };
}

export function computeCost(
  model: string,
  promptTokens: number,
  outputTokens: number,
  cachedTokens = 0,
): CostBreakdown {
  const p = getModelPricing(model);
  const cached = Math.min(Math.max(0, cachedTokens), promptTokens);
  const regularInput = promptTokens - cached;

  const usd =
    (regularInput * p.inputUsdPer1M +
      cached * p.cacheInputUsdPer1M +
      outputTokens * p.outputUsdPer1M) /
    1_000_000;

  const usdWithoutCache =
    (promptTokens * p.inputUsdPer1M + outputTokens * p.outputUsdPer1M) / 1_000_000;

  const usdToInr = parseFloat(_config.USD_TO_INR ?? '84');
  const costUsd = Math.round(usd * 1_000_000) / 1_000_000;
  const costINR = Math.round(usd * usdToInr * 1_000_000) / 1_000_000;
  const savingsUsd = Math.round((usdWithoutCache - usd) * 1_000_000) / 1_000_000;

  return {
    costUsd,
    costINR,
    pricingTier: p.tier,
    inputUsdPer1M: p.inputUsdPer1M,
    outputUsdPer1M: p.outputUsdPer1M,
    cacheInputUsdPer1M: p.cacheInputUsdPer1M,
    cachedTokens: cached,
    regularInputTokens: regularInput,
    savingsUsd,
  };
}
