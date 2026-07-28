import { Queue, QueueEvents } from 'bullmq';
import { bullmqConnection } from '../connection.js';
import { _config } from '../../../config/config.js';
import type { JobPriorityLevel } from '../../../cost/types.js';

const PREFIX = _config.QUEUE_PREFIX;

/** One attempt per job — failure goes to DLQ (paid API, no retry billing). */
const sharedJobOptions = {
  attempts: 1,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { count: 100 },
  removeOnFail: false,
};

export const RC_QUEUE_NAME = 'rc-queue';
export const DL_QUEUE_NAME = 'dl-queue';
export const WORKSHOP_QUEUE_NAME = 'workshop-queue';
export const INSURANCE_QUEUE_NAME = 'insurance-queue';
export const CLAIM_QUEUE_NAME = 'claim-queue';

export const rcQueue = new Queue(RC_QUEUE_NAME, {
  connection: bullmqConnection as any,
  prefix: PREFIX,
  defaultJobOptions: sharedJobOptions,
  skipVersionCheck: true,
});

export const dlQueue = new Queue(DL_QUEUE_NAME, {
  connection: bullmqConnection as any,
  prefix: PREFIX,
  defaultJobOptions: sharedJobOptions,
  skipVersionCheck: true,
});

export const workshopQueue = new Queue(WORKSHOP_QUEUE_NAME, {
  connection: bullmqConnection as any,
  prefix: PREFIX,
  defaultJobOptions: sharedJobOptions,
  skipVersionCheck: true,
});

export const insuranceQueue = new Queue(INSURANCE_QUEUE_NAME, {
  connection: bullmqConnection as any,
  prefix: PREFIX,
  defaultJobOptions: sharedJobOptions,
  skipVersionCheck: true,
});

export const claimQueue = new Queue(CLAIM_QUEUE_NAME, {
  connection: bullmqConnection as any,
  prefix: PREFIX,
  defaultJobOptions: sharedJobOptions,
  skipVersionCheck: true,
});

export const rcQueueEvents = new QueueEvents(RC_QUEUE_NAME, {
  connection: bullmqConnection.duplicate() as any,
  prefix: PREFIX,
  skipVersionCheck: true,
});
export const dlQueueEvents = new QueueEvents(DL_QUEUE_NAME, {
  connection: bullmqConnection.duplicate() as any,
  prefix: PREFIX,
  skipVersionCheck: true,
});
export const workshopQueueEvents = new QueueEvents(WORKSHOP_QUEUE_NAME, {
  connection: bullmqConnection.duplicate() as any,
  prefix: PREFIX,
  skipVersionCheck: true,
});
export const insuranceQueueEvents = new QueueEvents(INSURANCE_QUEUE_NAME, {
  connection: bullmqConnection.duplicate() as any,
  prefix: PREFIX,
  skipVersionCheck: true,
});
export const claimQueueEvents = new QueueEvents(CLAIM_QUEUE_NAME, {
  connection: bullmqConnection.duplicate() as any,
  prefix: PREFIX,
  skipVersionCheck: true,
});
export const ALL_QUEUES = [rcQueue, dlQueue, workshopQueue, insuranceQueue, claimQueue] as const;

interface RouterResult {
  queue: Queue;
  queueName: string;
  queueEvents: QueueEvents;
  defaultPriority: number;
}

export function resolveQueue(type: string): RouterResult {
  switch (type.toUpperCase()) {
    case 'RC':
      return {
        queue: rcQueue,
        queueName: RC_QUEUE_NAME,
        queueEvents: rcQueueEvents,
        defaultPriority: _config.QUEUE_PRIORITY_FAST,
      };
    case 'DL':
      return {
        queue: dlQueue,
        queueName: DL_QUEUE_NAME,
        queueEvents: dlQueueEvents,
        defaultPriority: _config.QUEUE_PRIORITY_FAST,
      };
    case 'WORKSHOP':
      return {
        queue: workshopQueue,
        queueName: WORKSHOP_QUEUE_NAME,
        queueEvents: workshopQueueEvents,
        defaultPriority: _config.QUEUE_PRIORITY_HEAVY,
      };
    case 'POLICY':
      return {
        queue: insuranceQueue,
        queueName: INSURANCE_QUEUE_NAME,
        queueEvents: insuranceQueueEvents,
        defaultPriority: _config.QUEUE_PRIORITY_HEAVY,
      };
    case 'CLAIM':
      return {
        queue: claimQueue,
        queueName: CLAIM_QUEUE_NAME,
        queueEvents: claimQueueEvents,
        defaultPriority: _config.QUEUE_PRIORITY_HEAVY,
      };
    default:
      return {
        queue: workshopQueue,
        queueName: WORKSHOP_QUEUE_NAME,
        queueEvents: workshopQueueEvents,
        defaultPriority: _config.QUEUE_PRIORITY_HEAVY,
      };
  }
}

/** Map request priority level to BullMQ numeric priority (from .env). */
export function resolveJobPriority(type: string, level: JobPriorityLevel = 'normal'): number {
  if (level === 'urgent') return _config.QUEUE_PRIORITY_URGENT;
  if (level === 'low') return _config.QUEUE_PRIORITY_LOW;
  return resolveQueue(type).defaultPriority;
}

/** Find a job across all document queues by BullMQ job id. */
export async function findJobAcrossQueues(jobId: string) {
  for (const queue of ALL_QUEUES) {
    const job = await queue.getJob(jobId);
    if (job) return { job, queueName: queue.name };
  }
  return null;
}
