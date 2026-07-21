/** Shared cost / token tracking types */

export type AICallPhase = 'prescreen' | 'extraction';

export type PricingTier = 'default' | 'lite' | 'pro';

export interface AICallRecord {
  callIndex: number;
  callPhase: AICallPhase;
  model: string;
  promptTokens: number;
  responseTokens: number;
  totalTokens: number;
  cachedTokens: number;
  costUsd: number;
  costINR: number;
  savingsUsd: number;
  latencyMs: number;
  status: 'success' | 'failure';
}

export interface JobCostSummary {
  correlationId: string;
  documentType: string;
  documentName: string;   // e.g. 'vehicle_rc_front.jpg'
  documentId: string;     // e.g. MongoDB / DB record ID
  jobId: string;
  apiKeyLabel: string;
  apiCallCount: number;
  totalPromptTokens: number;
  totalResponseTokens: number;
  totalTokens: number;
  totalCachedTokens: number;
  totalCostUsd: number;
  totalCostINR: number;
  totalSavingsUsd: number;
  calls: AICallRecord[];
}

export interface JobContext {
  correlationId: string;
  documentType: string;
  documentName: string;   // human-readable file/document name
  documentId: string;     // DB record / external ID
  jobId: string;
  apiKeyLabel: string;
  cost: {
    apiCallCount: number;
    totalPromptTokens: number;
    totalResponseTokens: number;
    totalTokens: number;
    totalCachedTokens: number;
    totalCostUsd: number;
    totalCostINR: number;
    totalSavingsUsd: number;
    mistralOcrPages: number;
    mistralOcrCostUsd: number;
    calls: AICallRecord[];
  };
}

export interface CostBreakdown {
  costUsd: number;
  costINR: number;
  pricingTier: PricingTier;
  inputUsdPer1M: number;
  outputUsdPer1M: number;
  cacheInputUsdPer1M: number;
  cachedTokens: number;
  regularInputTokens: number;
  savingsUsd: number;
}

export interface ModelPricing {
  inputUsdPer1M: number;
  outputUsdPer1M: number;
  cacheInputUsdPer1M: number;
  tier: PricingTier;
}

export type JobPriorityLevel = 'urgent' | 'normal' | 'low';

export interface MistralOcrCallRecord {
  pages: number;
  costUsd: number;
  latencyMs: number;
  status: 'success' | 'failure';
}
