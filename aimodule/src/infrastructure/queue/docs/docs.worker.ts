import { Worker, Job } from 'bullmq';
import { bullmqConnection } from '../connection.js';
import {
  RC_QUEUE_NAME, DL_QUEUE_NAME, WORKSHOP_QUEUE_NAME, INSURANCE_QUEUE_NAME, CLAIM_QUEUE_NAME,
  ALL_QUEUES, workshopQueue,
} from './queues.js';
import { DocumentService } from '../../../modules/document/document.service.js';
import { DLQService } from '../dlq/dlq.service.js';
import { AIService } from '../../ai/ai.service.js';
import { ObserverService } from '../../observabllity/observer.service.js';
import { WebhookService } from '../../webhook/webhook.service.js';
import { resolveWebhookUrl } from '../../webhook/webhook-url.util.js';
import { runWithJobContext, getJobCostSummary } from '../../../shared/context/correlation.context.js';
import { logJobCostSummary } from '../../../cost/logger.js';
import { ExtractionResultCache } from '../../../cost/result-cache.service.js';
import { _config } from '../../../config/config.js';

const documentService = new DocumentService();
const dlqService = new DLQService();
const webhookService = new WebhookService();
const obs = ObserverService.getInstance();

/** Gemini circuit only affects Gemini-backed queues — workshop uses LlamaParse */
const GEMINI_QUEUES = ALL_QUEUES.filter((q) => q !== workshopQueue);

// Circuit Breaker → pause / resume Gemini document queues (not workshop)
const breaker = AIService.getInstance().getBreaker();

// on open event
breaker.on('open', async () => {
  obs.warn('Circuit Breaker (Gemini) is OPEN. Pausing Gemini document queues...');
  obs.recordCircuitBreakerState('open');
  for (const q of GEMINI_QUEUES) {
    try {
      await q.pause();
      obs.info(`Queue ${q.name} paused due to circuit open.`);
    } catch (err) {
      obs.logError(`Failed to pause queue ${q.name} on circuit open`, err);
    }
  }
});

// on half open event
breaker.on('halfOpen', async () => {
  obs.info('Circuit Breaker (Gemini) is HALF_OPEN. Resuming Gemini queues for trial job...');
  obs.recordCircuitBreakerState('halfOpen');
  for (const q of GEMINI_QUEUES) {
    try {
      await q.resume();
    } catch (err) {
      obs.logError(`Failed to resume queue ${q.name} on circuit halfOpen`, err);
    }
  }
});

// on close event
breaker.on('close', async () => {
  obs.info('Circuit Breaker (Gemini) is CLOSED. Resuming Gemini document queues.');
  obs.recordCircuitBreakerState('closed');
  for (const q of GEMINI_QUEUES) {
    try {
      await q.resume();
    } catch (err) {
      obs.logError(`Failed to resume queue ${q.name} on circuit close`, err);
    }
  }
});

// Shared Worker Options — lockDuration from WORKER_LOCK_DURATION_MS (default: circuit timeout + 30s)
const sharedWorkerOptions = {
  prefix: _config.QUEUE_PREFIX,
  lockDuration: _config.WORKER_LOCK_DURATION_MS,
  stalledInterval: 30000,
  maxStalledCount: 1,
  skipVersionCheck: true,
};

// Job Processor

const processDocumentJob = async (job: Job): Promise<any> => {
  const { type, urls, correlationId, documentName, documentId, tenant } = job.data;
  const effectiveCorrelationId = correlationId ?? job.id ?? 'no-context';
  const effectiveDocumentName = documentName ?? 'unknown';
  const effectiveDocumentId = documentId ?? 'unknown';
  const startTime = Date.now();
  const webhookUrl = resolveWebhookUrl(tenant);

  const runJob = async () => runWithJobContext(
    effectiveCorrelationId, type, job.id ?? 'unknown',
    async () => {
    obs.info('Worker starting extraction', { jobId: job.id, type, queue: job.queueName });

    const flushJobCost = (status: 'success' | 'failure') => {
      const summary = getJobCostSummary();
      if (summary && summary.apiCallCount > 0) {
        logJobCostSummary(summary, status);
      }
    };

    try {
      const extractedData = await documentService.extractData(type, urls);
      const durationMs = Date.now() - startTime;
      const summary = getJobCostSummary();

      flushJobCost('success');

      obs.logQueueJob({
        queueName: job.queueName,
        jobId: job.id,
        documentType: type,
        attemptsMade: job.attemptsMade,
        durationMs,
        status: 'success',
        correlationId: effectiveCorrelationId,
        aiCostUsd: summary?.totalCostUsd,
        aiCostINR: summary?.totalCostINR,
        aiTotalTokens: summary?.totalTokens,
        aiCallCount: summary?.apiCallCount,
        apiKeyLabel: summary?.apiKeyLabel,
      });

      // Push result to downstream (Laravel) via webhook — best-effort, never throws
      void webhookService.send({
        correlationId: effectiveCorrelationId,
        jobId: job.id,
        documentType: type,
        status: 'success',
        result: extractedData,
        error: null,
        durationMs,
        timestamp: new Date().toISOString(),
        totalTokens: summary?.totalTokens ?? null,
        totalCostINR: summary?.totalCostINR ?? null,
      }, webhookUrl);

      const urlList = Array.isArray(urls) ? urls : [urls];
      void ExtractionResultCache.set(type, urlList, extractedData);

      return {
        data: extractedData,
        totalTokens: summary?.totalTokens ?? 0,
        totalCostINR: summary?.totalCostINR ?? 0,
        durationMs,
      };
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      const isLastAttempt = job.attemptsMade >= (job.opts.attempts ?? 3) - 1;
      const summary = getJobCostSummary();

      flushJobCost('failure');

      obs.logQueueJob({
        queueName: job.queueName,
        jobId: job.id,
        documentType: type,
        attemptsMade: job.attemptsMade,
        durationMs,
        status: 'failure',
        correlationId: effectiveCorrelationId,
        errorStack: error?.stack,
        aiCostUsd: summary?.totalCostUsd,
        aiCostINR: summary?.totalCostINR,
        aiTotalTokens: summary?.totalTokens,
        aiCallCount: summary?.apiCallCount,
        apiKeyLabel: summary?.apiKeyLabel,
      });

      // Only fire the failure webhook on the last attempt (no more retries coming)
      if (isLastAttempt) {
        void webhookService.send({
          correlationId: effectiveCorrelationId,
          jobId: job.id,
          documentType: type,
          status: 'failure',
          result: null,
          error: error?.message ?? 'Unknown extraction error',
          durationMs,
          timestamp: new Date().toISOString(),
          totalTokens: summary?.totalTokens ?? null,
          totalCostINR: summary?.totalCostINR ?? null,
        }, webhookUrl);
      }

      // Preserve cost snapshot for DLQ (async context ends after throw)
      if (summary && summary.apiCallCount > 0) {
        (error as Error & { costSummary?: typeof summary }).costSummary = summary;
      }

      throw error; // Let BullMQ handle retry / DLQ routing
    }
  }, effectiveDocumentName, effectiveDocumentId);

  return runJob();
};

// make the failure handler
const makeFailureHandler = (queueName: string) => (job: Job | undefined, err: Error) => {
  dlqService.handleFailedJob(job, err, queueName);
};

// initialize the workers

// RC Worker - FAST lane: 10 concurrent, 30 jobs/min
export const rcWorker = new Worker(RC_QUEUE_NAME, processDocumentJob, {
  connection: bullmqConnection.duplicate() as any,
  concurrency: 10,
  limiter: { max: 30, duration: 60000 },
  ...sharedWorkerOptions,
});
rcWorker.on('failed', makeFailureHandler(RC_QUEUE_NAME));

// DL Worker - FAST lane: 10 concurrent, 30 jobs/min
export const dlWorker = new Worker(DL_QUEUE_NAME, processDocumentJob, {
  connection: bullmqConnection.duplicate() as any,
  concurrency: 10,
  limiter: { max: 30, duration: 60000 },
  ...sharedWorkerOptions,
});
dlWorker.on('failed', makeFailureHandler(DL_QUEUE_NAME));

// Workshop Worker - HEAVY lane: 2 concurrent, 5 jobs/min
export const workshopWorker = new Worker(WORKSHOP_QUEUE_NAME, processDocumentJob, {
  connection: bullmqConnection.duplicate() as any,
  concurrency: 2,
  limiter: { max: 5, duration: 60000 },
  ...sharedWorkerOptions,
});
workshopWorker.on('failed', makeFailureHandler(WORKSHOP_QUEUE_NAME));

// Insurance Worker - HEAVY lane: 2 concurrent, 5 jobs/min
export const insuranceWorker = new Worker(INSURANCE_QUEUE_NAME, processDocumentJob, {
  connection: bullmqConnection.duplicate() as any,
  concurrency: 2,
  limiter: { max: 5, duration: 60000 },
  ...sharedWorkerOptions,
});
insuranceWorker.on('failed', makeFailureHandler(INSURANCE_QUEUE_NAME));

export const claimWorker = new Worker(CLAIM_QUEUE_NAME, processDocumentJob, {
  connection: bullmqConnection.duplicate() as any,
  concurrency: 2,
  limiter: { max: 8, duration: 60000 },
  ...sharedWorkerOptions,
});
claimWorker.on('failed', makeFailureHandler(CLAIM_QUEUE_NAME));

obs.info('All five document workers initialized: rc-queue, dl-queue, workshop-queue, insurance-queue, claim-queue');
