import { correlationStore } from '../shared/context/correlation.context.js';
import { _config } from '../config/config.js';
import type { AICallRecord, JobContext, JobCostSummary, MistralOcrCallRecord } from './types.js';

/** Safe API key identifier for logs — never log full key. */
export function getGeminiApiKeyLabel(): string {
  if (_config.GEMINI_API_KEY_LABEL) return _config.GEMINI_API_KEY_LABEL;
  const key = _config.GEMINI_API_KEY ?? '';
  if (key.length >= 8) return `gemini-key-...${key.slice(-8)}`;
  return 'gemini-key-unset';
}

export function createJobContext(
  correlationId: string,
  documentType: string,
  jobId: string,
  documentName = 'unknown',
  documentId = 'unknown',
): JobContext {
  return {
    correlationId,
    documentType,
    documentName,
    documentId,
    jobId,
    apiKeyLabel: getGeminiApiKeyLabel(),
    cost: {
      apiCallCount: 0,
      totalPromptTokens: 0,
      totalResponseTokens: 0,
      totalTokens: 0,
      totalCachedTokens: 0,
      totalCostUsd: 0,
      totalCostINR: 0,
      totalSavingsUsd: 0,
      mistralOcrPages: 0,
      mistralOcrCostUsd: 0,
      calls: [],
    },
  };
}

export function recordMistralOcrCall(record: MistralOcrCallRecord): void {
  const store = correlationStore.getStore();
  if (!store?.cost) return;

  if (record.status === 'success') {
    store.cost.mistralOcrPages += record.pages;
    store.cost.mistralOcrCostUsd += record.costUsd;
    const usdToInr = parseFloat(_config.USD_TO_INR ?? '84');
    store.cost.totalCostUsd += record.costUsd;
    store.cost.totalCostINR += record.costUsd * usdToInr;
  }
}

export function getDocumentType(): string {
  return correlationStore.getStore()?.documentType ?? 'UNKNOWN';
}

export function getDocumentName(): string {
  return correlationStore.getStore()?.documentName ?? 'unknown';
}

export function getDocumentId(): string {
  return correlationStore.getStore()?.documentId ?? 'unknown';
}

export function getJobId(): string {
  return correlationStore.getStore()?.jobId ?? 'no-job';
}

export function getApiKeyLabel(): string {
  return correlationStore.getStore()?.apiKeyLabel ?? getGeminiApiKeyLabel();
}

export function recordAICall(record: Omit<AICallRecord, 'callIndex'>): void {
  const store = correlationStore.getStore();
  if (!store?.cost) return;

  const callIndex = store.cost.apiCallCount + 1;
  store.cost.calls.push({ ...record, callIndex });
  store.cost.apiCallCount = callIndex;
  store.cost.totalPromptTokens += record.promptTokens;
  store.cost.totalResponseTokens += record.responseTokens;
  store.cost.totalTokens += record.totalTokens;
  store.cost.totalCachedTokens += record.cachedTokens;
  store.cost.totalCostUsd += record.costUsd;
  store.cost.totalCostINR += record.costINR;
  store.cost.totalSavingsUsd += record.savingsUsd;
}

export function getJobCostSummary(): JobCostSummary | null {
  const store = correlationStore.getStore();
  if (!store) return null;

  return {
    correlationId: store.correlationId,
    documentType: store.documentType,
    documentName: store.documentName,
    documentId: store.documentId,
    jobId: store.jobId,
    apiKeyLabel: store.apiKeyLabel,
    apiCallCount: store.cost.apiCallCount,
    totalPromptTokens: store.cost.totalPromptTokens,
    totalResponseTokens: store.cost.totalResponseTokens,
    totalTokens: store.cost.totalTokens,
    totalCachedTokens: store.cost.totalCachedTokens,
    totalCostUsd: round6(store.cost.totalCostUsd),
    totalCostINR: round6(store.cost.totalCostINR),
    totalSavingsUsd: round6(store.cost.totalSavingsUsd),
    calls: [...store.cost.calls],
  };
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

