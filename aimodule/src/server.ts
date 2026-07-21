import './instrument.js';
import App from './app.js';
import { _config } from './config/config.js';
import { logger } from './utils/logger.js';
import { ObserverService } from './infrastructure/observabllity/observer.service.js';
import { rcQueue, dlQueue, workshopQueue, insuranceQueue, claimQueue } from './infrastructure/queue/docs/queues.js';
import { dlqQueue } from './infrastructure/queue/dlq/dlq.queue.js';

const obs = ObserverService.getInstance();

function startQueueDepthPoller() {
  const queues = [
    { q: rcQueue, name: 'rc-queue' },
    { q: dlQueue, name: 'dl-queue' },
    { q: workshopQueue, name: 'workshop-queue' },
    { q: insuranceQueue, name: 'insurance-queue' },
    { q: claimQueue, name: 'claim-queue' },
    { q: dlqQueue, name: 'dead-letter-queue' },
  ];

  setInterval(async () => {
    for (const { q, name } of queues) {
      try {
        const depth = await q.getWaitingCount();
        obs.recordQueueDepth(name, depth);
      } catch {
        // ignore transient Redis errors
      }
    }
  }, 30_000);
}

async function loadWorkers() {
  if (_config.RUN_WORKERS === 'true') {
    await import('./infrastructure/queue/docs/docs.worker.js');
    logger.info('Document workers loaded (RUN_WORKERS=true)');
  } else {
    logger.info('Document workers skipped (RUN_WORKERS=false) — API-only mode');
  }

  if (_config.RUN_DLQ_WORKER === 'true') {
    await import('./infrastructure/queue/dlq/dlq.worker.js');
    logger.info('DLQ worker loaded (RUN_DLQ_WORKER=true)');
  }
}

const start = async () => {
  try {
    await loadWorkers();

    const app = new App().getApp();
    const PORT = _config.PORT ?? 8080;

    app.listen(PORT, () => {
      logger.info(`Server is running on port ${PORT}`);
    });

    startQueueDepthPoller();
    logger.info('API server started — queue depth poller active.');
  } catch (error) {
    logger.error(error, 'Failed to start the server');
    process.exit(1);
  }
};

void start();
