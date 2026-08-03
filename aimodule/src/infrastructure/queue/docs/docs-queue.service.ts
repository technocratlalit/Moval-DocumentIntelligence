import { Job } from 'bullmq';
import { resolveQueue, resolveJobPriority, findJobAcrossQueues } from './queues.js';
import { QueueOverloadedError, JobTimeoutError } from '../../../shared/errors/apiError.js';
import { _config } from '../../../config/config.js';
import { getCorrelationId } from '../../../shared/context/correlation.context.js';
import { ObserverService } from '../../observabllity/observer.service.js';
import { deriveContentJobId, type ContentJobOptions } from '../../../cost/job-id.util.js';
import { ExtractionResultCache } from '../../../cost/result-cache.service.js';
import type { JobPriorityLevel } from '../../../cost/types.js';
import { AdminService } from '../../../modules/admin/admin.service.js';
import type { WebhookTenant } from '../../webhook/webhook-url.util.js';

export { deriveContentJobId };

export interface EnqueueOptions extends ContentJobOptions {
  priorityLevel?: JobPriorityLevel;
  documentName?: string;   // human-readable file/doc name, e.g. 'vehicle_rc_front.jpg'
  documentId?: string;     // DB record ID from caller (e.g. Laravel document ID)
  tenant?: WebhookTenant;  // Laravel .in / .com — routes webhook after extraction
}

export interface EnqueueResult {
  job: Job;
  queueEvents: any;
  contentJobId: string;
  fromCache: boolean;
  cachedResult?: unknown;
}

export class DocsQueueService {
  private readonly adminService = new AdminService();

  private static mutex = (() => {
    let chain = Promise.resolve();
    return {
      runExclusive<T>(fn: () => Promise<T>): Promise<T> {
        const next = chain.then(fn);
        chain = next.then(() => undefined, () => undefined);
        return next;
      },
    };
  })();

  public async isQueueOverloaded(type: string): Promise<boolean> {
    const maxQueueSize = parseInt(_config.MAX_QUEUE_SIZE || '50', 10);
    const { queue, queueName } = resolveQueue(type);
    const waitingCount = await queue.getWaitingCount();

    ObserverService.getInstance().recordQueueDepth(queueName, waitingCount);

    if (waitingCount >= maxQueueSize) {
      ObserverService.getInstance().warn(
        `Backpressure: ${queueName} size ${waitingCount} >= limit ${maxQueueSize}. Rejecting request.`,
      );
      void this.adminService.onQueueOverload(queueName, waitingCount);
      return true;
    }
    return false;
  }

  public async enqueueDocument(
    type: string,
    urls: string[],
    options: EnqueueOptions = {},
  ): Promise<EnqueueResult> {
    return DocsQueueService.mutex.runExclusive(async () => {
    const typeUpper = type.toUpperCase();
    const resolvedTableLayout =
      typeUpper === 'WORKSHOP'
        ? (options.tableLayout === 'split' ? 'split' : 'sequential')
        : options.tableLayout;

    const cacheOptions: ContentJobOptions = {
      tableLayout: resolvedTableLayout,
    };
    const contentJobId = deriveContentJobId(type, urls, cacheOptions);

    const cached = await ExtractionResultCache.get(type, urls, cacheOptions);
    if (cached != null) {
      return {
        job: { id: contentJobId } as Job,
        queueEvents: null,
        contentJobId,
        fromCache: true,
        cachedResult: cached,
      };
    }

    if (await this.isQueueOverloaded(type)) {
      throw new QueueOverloadedError();
    }

    const correlationId = getCorrelationId();
    const priority = resolveJobPriority(type, options.priorityLevel ?? 'normal');
    const { queue, queueEvents } = resolveQueue(type);

    const job = await queue.add(
      'extract-document',
      {
        type,
        urls,
        correlationId,
        documentName: options.documentName ?? 'unknown',
        documentId: options.documentId ?? 'unknown',
        tableLayout: resolvedTableLayout,
        tenant: options.tenant,
      },
      { priority, jobId: contentJobId },
    );

    ObserverService.getInstance().info(`Job enqueued to ${queue.name}`, {
      jobId: job.id,
      type,
      correlationId,
      priority,
      priorityLevel: options.priorityLevel ?? 'normal',
    });

    return { job, queueEvents, contentJobId, fromCache: false };
    });
  }

  public async waitForJob(job: Job, queueEvents: any): Promise<any> {
    const timeoutMs = _config.JOB_TIMEOUT_MS;
    try {
      return await job.waitUntilFinished(queueEvents, timeoutMs);
    } catch (err: any) {
      if (err?.message?.includes('timed out') || err?.message?.includes('timeout')) {
        throw new JobTimeoutError(job.id ?? 'unknown', `Job ${job.id} did not complete within ${timeoutMs / 1000}s.`);
      }
      throw err;
    }
  }

  public async getJobStatus(jobId: string) {
    const found = await findJobAcrossQueues(jobId);
    if (!found) return null;

    const state = await found.job.getState();
    return {
      jobId: found.job.id,
      queueName: found.queueName,
      state,
      attemptsMade: found.job.attemptsMade,
      documentType: found.job.data?.type,
      correlationId: found.job.data?.correlationId,
      failedReason: found.job.failedReason,
    };
  }
}
