import { createHmac } from 'crypto';
import { ExtractionJob } from '../../model/extraction-job.schema.js';
import { _config } from '../../config/config.js';
import { ApiError } from '../../shared/apiError.js';
import { applyClaimFields } from '../extraction/apply-claim-fields.js';

export class WebhookService {
  verifySignature(rawBody, receivedSig) {
    if (!_config.WEBHOOK_SECRET) {
      console.warn('[webhook] WEBHOOK_SECRET not set — skipping signature check');
      return true;
    }
    const expectedSig = createHmac('sha256', _config.WEBHOOK_SECRET)
      .update(rawBody ?? '')
      .digest('hex');
    return receivedSig === expectedSig;
  }

  async handleExtractionComplete(payload) {
    const correlationId = payload?.correlationId;
    if (!correlationId) {
      throw ApiError.badRequest('Missing correlationId in webhook payload.');
    }

    const job = await ExtractionJob.findOne({ correlationId });
    if (!job) {
      console.warn(`[webhook] Unknown correlationId: ${correlationId}`);
      return null;
    }

    job.jobId = payload.jobId ?? job.jobId;
    job.durationMs = payload.durationMs ?? job.durationMs;

    if (payload.status === 'success') {
      job.status = 'completed';
      job.result = payload.result ?? null;
      job.error = null;
      job.completedAt = new Date();
      if (payload.totalTokens != null) job.totalTokens = payload.totalTokens;
      if (payload.totalCostINR != null) job.totalCostINR = payload.totalCostINR;
      applyClaimFields(job, job.result);
    } else {
      job.status = 'failed';
      job.error = payload.error ?? 'Extraction failed';
      job.result = null;
      job.completedAt = new Date();
      if (payload.totalTokens != null) job.totalTokens = payload.totalTokens;
      if (payload.totalCostINR != null) job.totalCostINR = payload.totalCostINR;
    }

    await job.save();

    console.log(`[webhook] Updated job ${job._id} → ${job.status} (${correlationId})`);
    return job;
  }
}
