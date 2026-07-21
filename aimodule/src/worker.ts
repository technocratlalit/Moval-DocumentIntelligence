//Dedicated worker process — run separately from API in production.

import './instrument.js';
import { logger } from './utils/logger.js';

async function start() {
  await import('./infrastructure/queue/docs/docs.worker.js');
  await import('./infrastructure/queue/dlq/dlq.worker.js');
  logger.info('Worker process started — document workers + DLQ events listener active.');
}

void start();
