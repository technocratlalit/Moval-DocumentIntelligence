import { createHmac } from 'crypto';
import { gzip } from 'zlib';
import { promisify } from 'util';
import { _config } from '../../config/config.js';
import { ObserverService } from '../observabllity/observer.service.js';

const gzipAsync = promisify(gzip);

/**
 * WebhookService
 *
 * Pushes extraction results to the downstream receiver (Laravel backend) via
 * an HMAC-signed HTTP POST. URL from per-job tenant (WEBHOOK_URL_IN/COM) or WEBHOOK_URL fallback.
 *
 * Security: every payload is signed with HMAC-SHA256(WEBHOOK_SECRET, body).
 * The receiver must verify the X-Webhook-Signature header before processing.
 *
 * Retry: up to MAX_ATTEMPTS with exponential backoff (1s, 2s, 4s).
 * If all retries fail the error is logged via ObserverService but does NOT
 * throw — webhook delivery is best-effort and must never crash the worker.
 */

export interface WebhookPayload {
  correlationId: string;
  jobId: string | undefined;
  documentType: string;
  status: 'success' | 'failure';
  result: unknown | null;
  error: string | null;
  durationMs: number;
  timestamp: string;
  totalTokens?: number | null;
  totalCostINR?: number | null;
}

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1000;
// Compress payload when body exceeds this size to avoid HTTP 413 on large PDFs
const GZIP_THRESHOLD_BYTES = 50_000; // 50 KB

function sign(body: string): string {
  const secret = _config.WEBHOOK_SECRET ?? '';
  return createHmac('sha256', secret).update(body).digest('hex');
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Gzip-compress a string using Node.js built-in zlib. */
async function gzipBody(data: string): Promise<Buffer> {
  return gzipAsync(Buffer.from(data, 'utf-8'));
}

export class WebhookService {
  private readonly obs = ObserverService.getInstance();

 
  public async send(payload: WebhookPayload, urlOverride?: string | null): Promise<void> {
    const url = urlOverride ?? _config.WEBHOOK_URL;
    if (!url) return; // webhook not configured — skip silently

    const rawBody = JSON.stringify(payload);
    const signature = sign(rawBody);

    // Compress large payloads (e.g. 400+ row workshop results) to avoid HTTP 413
    const rawByteLen = Buffer.byteLength(rawBody, 'utf-8');
    const shouldCompress = rawByteLen > GZIP_THRESHOLD_BYTES;
    let sendBody: string | Buffer = rawBody;
    const extraHeaders: Record<string, string> = {};

    if (shouldCompress) {
      try {
        sendBody = await gzipBody(rawBody);
        extraHeaders['Content-Encoding'] = 'gzip';
        this.obs.info('Webhook: payload compressed with gzip', {
          originalBytes: rawByteLen,
          compressedBytes: (sendBody as Buffer).length,
          jobId: payload.jobId,
        });
      } catch (e) {
        // Fall back to uncompressed on any compression error
        this.obs.warn('Webhook: gzip compression failed, sending uncompressed', { error: String(e) });
        sendBody = rawBody;
      }
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Signature': signature,
            'X-Correlation-Id': payload.correlationId,
            ...extraHeaders,
          },
          body: sendBody as any,
          signal: AbortSignal.timeout(10_000), // 10s per attempt
        });

        if (res.ok) {
          this.obs.info('Webhook delivered', {
            url, jobId: payload.jobId, attempt, status: payload.status,
          });
          return;
        }

        this.obs.warn(`Webhook returned non-2xx on attempt ${attempt}`, {
          url, httpStatus: res.status, jobId: payload.jobId,
        });
      } catch (err) {
        this.obs.warn(`Webhook attempt ${attempt} failed (network/timeout)`, {
          url, jobId: payload.jobId, error: String(err),
        });
      }

      if (attempt < MAX_ATTEMPTS) {
        await sleep(BASE_DELAY_MS * Math.pow(2, attempt - 1)); // 1s, 2s, 4s
      }
    }

    this.obs.logError(
      `Webhook delivery failed after ${MAX_ATTEMPTS} attempts — result dropped`,
      undefined,
      { url, jobId: payload.jobId, documentType: payload.documentType },
    );
  }
}
