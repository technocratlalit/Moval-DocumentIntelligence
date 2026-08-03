import { config } from 'dotenv';

config();

/** Parse numeric env vars safely — strips quotes and accidental inline comments in .env */
function parseEnvInt(value: string | undefined, fallback: number): number {
  if (value == null || value === '') return fallback;
  const cleaned = value.replace(/^["']|["']$/g, '').trim().split(/\s+/)[0];
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Treat blank .env values as unset so optional overrides inherit tier defaults. */
function parseEnvOptional(value: string | undefined): string | undefined {
  if (value == null || value.trim() === '') return undefined;
  return value.trim();
}

function parseEnvFloat(value: string | undefined, fallback: number): number {
  if (value == null || value === '') return fallback;
  const cleaned = value.replace(/^["']|["']$/g, '').trim().split(/\s+/)[0];
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : fallback;
}


function parseEnvBool(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === '') return fallback;
  return value.trim().toLowerCase() === 'true';
}


const {
  PORT,
  NODE_ENV,
  JWT_SECRET,
  STORAGE_PROVIDER,
  GEMINI_API_KEY,
  GEMINI_API_KEY_LABEL,
  AI_MODEL,
  AI_MODEL_LITE,
  AI_MODEL_PRO,
  RC_AI_MODEL,
  DL_AI_MODEL,
  WORKSHOP_AI_MODEL,
  WORKSHOP_CHUNK_AI_MODEL,
  POLICY_AI_MODEL,
  RC_MAX_OUTPUT_TOKENS,
  DL_MAX_OUTPUT_TOKENS,
  WORKSHOP_MAX_OUTPUT_TOKENS,
  POLICY_MAX_OUTPUT_TOKENS,
  REDIS_QUEUE_URI,
  GCS_BUCKET_NAME,
  GCS_CLIENT_EMAIL,
  GCS_PROJECT_ID,
  GCS_PRIVATE_KEY,
  REDIS_RATE_LIMIT_URI,
  MAX_QUEUE_SIZE,
  QUEUE_PREFIX,
  JOB_TIMEOUT_MS,
  GEMINI_CIRCUIT_TIMEOUT_MS,
  GEMINI_CIRCUIT_RESET_TIMEOUT_MS,
  WORKER_LOCK_DURATION_MS,
  DOWNLOAD_TIMEOUT_MS,
  PDF_DOWNLOAD_TIMEOUT_MS,
  ADMIN_API_KEY,
  OBSERVABILITY_PROVIDER,
  DLQ_ALERT_THRESHOLD,
  WEBHOOK_URL,
  WEBHOOK_URL_IN,
  WEBHOOK_URL_COM,
  WEBHOOK_SECRET,
  PRESCREEN_ENABLED,
  PRESCREEN_MODEL,
  PRESCREEN_MAX_PDF_PAGES,
  PRESCREEN_MAX_OUTPUT_TOKENS,
  PRESCREEN_REJECT_CONFIDENCE,
  PRESCREEN_BLUR_CONFIDENCE,
  PRESCREEN_LARGE_PDF_PAGE1,
  USD_TO_INR,
  AI_MODEL_INPUT_USD_PER_1M,
  AI_MODEL_OUTPUT_USD_PER_1M,
  AI_MODEL_LITE_INPUT_USD_PER_1M,
  AI_MODEL_LITE_OUTPUT_USD_PER_1M,
  AI_MODEL_PRO_INPUT_USD_PER_1M,
  AI_MODEL_PRO_OUTPUT_USD_PER_1M,
  AI_MODEL_CACHE_INPUT_USD_PER_1M,
  AI_MODEL_LITE_CACHE_INPUT_USD_PER_1M,
  AI_MODEL_PRO_CACHE_INPUT_USD_PER_1M,
  PROMPT_CACHING,
  PROMPT_CACHE_TTL_SECONDS,
  NEW_RELIC_LICENSE_KEY,
  QUEUE_PRIORITY_URGENT,
  QUEUE_PRIORITY_FAST,
  QUEUE_PRIORITY_HEAVY,
  QUEUE_PRIORITY_LOW,
  RUN_WORKERS,
  RUN_DLQ_WORKER,
  RESULT_CACHE_ENABLED,
  RESULT_CACHE_TTL_SECONDS,
  DEFAULT_EXTRACT_MODE,
  WORKSHOP_CHUNK_PAGE_SIZE,
  WORKSHOP_MAX_GEMINI_RETRIES,
  POLICY_MAX_GEMINI_RETRIES,
  RC_MAX_GEMINI_RETRIES,
  DL_MAX_GEMINI_RETRIES,

  CLAIM_AI_MODEL,
  CLAIM_MAX_OUTPUT_TOKENS,
  CLAIM_MAX_GEMINI_RETRIES,
  CLAIM_MAX_PDF_PAGES,
} = process.env;

const jobTimeoutMs = parseEnvInt(JOB_TIMEOUT_MS, 120_000);
const geminiCircuitTimeoutMs = parseEnvInt(GEMINI_CIRCUIT_TIMEOUT_MS, jobTimeoutMs);
const workerLockDurationMs = parseEnvInt(WORKER_LOCK_DURATION_MS, geminiCircuitTimeoutMs + 30_000);

const resolvedAiModel = parseEnvOptional(AI_MODEL);
const resolvedAiModelLite = parseEnvOptional(AI_MODEL_LITE) ?? resolvedAiModel;
const resolvedAiModelPro = parseEnvOptional(AI_MODEL_PRO) ?? resolvedAiModel;

export const _config = {
  // Server
  PORT,
  NODE_ENV,
  JWT_SECRET,

  // Storage
  STORAGE_PROVIDER,
  GCS_BUCKET_NAME,
  GCS_CLIENT_EMAIL,
  GCS_PROJECT_ID,
  GCS_PRIVATE_KEY,

  // Claim form extraction (single Gemini pass)
  CLAIM_AI_MODEL: parseEnvOptional(CLAIM_AI_MODEL) ?? 'gemini-2.5-flash-lite',
  CLAIM_MAX_OUTPUT_TOKENS: parseEnvInt(CLAIM_MAX_OUTPUT_TOKENS, 8192),
  CLAIM_MAX_GEMINI_RETRIES: parseEnvInt(CLAIM_MAX_GEMINI_RETRIES, 1),
  CLAIM_MAX_PDF_PAGES: parseEnvInt(CLAIM_MAX_PDF_PAGES, 5),

  // Gemini
  GEMINI_API_KEY,
  GEMINI_API_KEY_LABEL,
  AI_MODEL:          resolvedAiModel,
  AI_MODEL_LITE:     resolvedAiModelLite,
  AI_MODEL_PRO:        resolvedAiModelPro,
  RC_AI_MODEL:       parseEnvOptional(RC_AI_MODEL)       ?? resolvedAiModelLite,
  DL_AI_MODEL:       parseEnvOptional(DL_AI_MODEL)       ?? resolvedAiModelLite,
  WORKSHOP_AI_MODEL:       parseEnvOptional(WORKSHOP_AI_MODEL)       ?? resolvedAiModelPro,
  /** Model used for chunk-fallback passes (meta + per-chunk). Defaults to AI_MODEL_LITE to save cost. */
  WORKSHOP_CHUNK_AI_MODEL: parseEnvOptional(WORKSHOP_CHUNK_AI_MODEL) ?? resolvedAiModelLite,
  POLICY_AI_MODEL:         parseEnvOptional(POLICY_AI_MODEL)         ?? resolvedAiModelPro,

  // Token ceilings (string — parsed at call site or via cost/token-budget.ts)
  RC_MAX_OUTPUT_TOKENS,
  DL_MAX_OUTPUT_TOKENS,
  WORKSHOP_MAX_OUTPUT_TOKENS,
  POLICY_MAX_OUTPUT_TOKENS,
  /** Pages per local PDF slice when extracting per chunk (default 2). */
  WORKSHOP_CHUNK_PAGE_SIZE: parseEnvInt(WORKSHOP_CHUNK_PAGE_SIZE, 2),
  /** Gemini retries per workshop call — 1 avoids 3× cost on transient errors (default 1). */
  WORKSHOP_MAX_GEMINI_RETRIES: parseEnvInt(WORKSHOP_MAX_GEMINI_RETRIES, 1),
  /** Gemini retries per policy call (default 1). */
  POLICY_MAX_GEMINI_RETRIES: parseEnvInt(POLICY_MAX_GEMINI_RETRIES, 1),
  /** Gemini retries per RC call (default 1). */
  RC_MAX_GEMINI_RETRIES: parseEnvInt(RC_MAX_GEMINI_RETRIES, 1),
  /** Gemini retries per DL call (default 1). */
  DL_MAX_GEMINI_RETRIES: parseEnvInt(DL_MAX_GEMINI_RETRIES, 1),

  // Prescreen
  PRESCREEN_ENABLED:           PRESCREEN_ENABLED ?? 'true',
  PRESCREEN_MODEL:               parseEnvOptional(PRESCREEN_MODEL) ?? resolvedAiModelLite,
  PRESCREEN_MAX_PDF_PAGES:       parseEnvInt(PRESCREEN_MAX_PDF_PAGES, 3),
  PRESCREEN_MAX_OUTPUT_TOKENS:   parseEnvInt(PRESCREEN_MAX_OUTPUT_TOKENS, 512),
  /** Below this prescreen confidence → reject as unreadable (default 0.25). */
  PRESCREEN_REJECT_CONFIDENCE:   parseEnvFloat(PRESCREEN_REJECT_CONFIDENCE, 0.25),
  /** Below this prescreen confidence (or isBlurred) → extract but flag human review (default 0.55). */
  PRESCREEN_BLUR_CONFIDENCE:     parseEnvFloat(PRESCREEN_BLUR_CONFIDENCE, 0.55),
  /** Prescreen page 1 only for PDFs above PRESCREEN_MAX_PDF_PAGES (default true). */
  PRESCREEN_LARGE_PDF_PAGE1:     PRESCREEN_LARGE_PDF_PAGE1 ?? 'true',

  // Pricing (USD per 1M tokens)
  USD_TO_INR:                    USD_TO_INR ?? '84',
  AI_MODEL_INPUT_USD_PER_1M:       AI_MODEL_INPUT_USD_PER_1M       ?? '0.25',
  AI_MODEL_OUTPUT_USD_PER_1M:      AI_MODEL_OUTPUT_USD_PER_1M      ?? '1.50',
  AI_MODEL_LITE_INPUT_USD_PER_1M:  AI_MODEL_LITE_INPUT_USD_PER_1M  ?? '0.25',
  AI_MODEL_LITE_OUTPUT_USD_PER_1M: AI_MODEL_LITE_OUTPUT_USD_PER_1M ?? '1.50',
  AI_MODEL_PRO_INPUT_USD_PER_1M:   AI_MODEL_PRO_INPUT_USD_PER_1M   ?? '0.30',
  AI_MODEL_PRO_OUTPUT_USD_PER_1M:  AI_MODEL_PRO_OUTPUT_USD_PER_1M  ?? '2.50',
  AI_MODEL_CACHE_INPUT_USD_PER_1M:       AI_MODEL_CACHE_INPUT_USD_PER_1M       ?? '0.025',
  AI_MODEL_LITE_CACHE_INPUT_USD_PER_1M:  AI_MODEL_LITE_CACHE_INPUT_USD_PER_1M  ?? '0.025',
  AI_MODEL_PRO_CACHE_INPUT_USD_PER_1M:   AI_MODEL_PRO_CACHE_INPUT_USD_PER_1M   ?? '0.03',

  // Prompt caching: off | implicit | explicit
  PROMPT_CACHING:           PROMPT_CACHING ?? 'implicit',
  PROMPT_CACHE_TTL_SECONDS: parseEnvInt(PROMPT_CACHE_TTL_SECONDS, 3600),

  // Redis / Queue
  REDIS_QUEUE_URI,
  REDIS_RATE_LIMIT_URI,
  MAX_QUEUE_SIZE,
  QUEUE_PREFIX:            QUEUE_PREFIX ?? 'bull',
  JOB_TIMEOUT_MS:          jobTimeoutMs,
  /** Opossum timeout per Gemini call — defaults to JOB_TIMEOUT_MS */
  GEMINI_CIRCUIT_TIMEOUT_MS: geminiCircuitTimeoutMs,
  GEMINI_CIRCUIT_RESET_TIMEOUT_MS: parseEnvInt(GEMINI_CIRCUIT_RESET_TIMEOUT_MS, 30_000),
  /** BullMQ lock renewal — defaults to GEMINI_CIRCUIT_TIMEOUT_MS + 30s */
  WORKER_LOCK_DURATION_MS: workerLockDurationMs,
  DOWNLOAD_TIMEOUT_MS:     parseEnvInt(DOWNLOAD_TIMEOUT_MS, 45_000),
  PDF_DOWNLOAD_TIMEOUT_MS: parseEnvInt(
    PDF_DOWNLOAD_TIMEOUT_MS,
    parseEnvInt(DOWNLOAD_TIMEOUT_MS, 45_000) * 2,
  ),
  QUEUE_PRIORITY_URGENT: parseEnvInt(QUEUE_PRIORITY_URGENT, 1),
  QUEUE_PRIORITY_FAST:   parseEnvInt(QUEUE_PRIORITY_FAST, 1),
  QUEUE_PRIORITY_HEAVY:  parseEnvInt(QUEUE_PRIORITY_HEAVY, 5),
  QUEUE_PRIORITY_LOW:    parseEnvInt(QUEUE_PRIORITY_LOW, 10),

  // Extract API + result cache
  DEFAULT_EXTRACT_MODE:     DEFAULT_EXTRACT_MODE ?? 'sync',
  RESULT_CACHE_ENABLED:     RESULT_CACHE_ENABLED ?? 'true',
  RESULT_CACHE_TTL_SECONDS: parseEnvInt(RESULT_CACHE_TTL_SECONDS, 86_400),

  // Deploy split (prod API: RUN_WORKERS=false)
  RUN_WORKERS:    RUN_WORKERS    ?? 'true',
  RUN_DLQ_WORKER: RUN_DLQ_WORKER ?? 'true',

  // Webhook
  WEBHOOK_URL,
  WEBHOOK_URL_IN,
  WEBHOOK_URL_COM,
  WEBHOOK_SECRET,

  // Observability
  OBSERVABILITY_PROVIDER: OBSERVABILITY_PROVIDER ?? 'newrelic',
  NEW_RELIC_LICENSE_KEY,

  // Admin
  ADMIN_API_KEY,
  DLQ_ALERT_THRESHOLD: parseEnvInt(DLQ_ALERT_THRESHOLD, 20),
};
