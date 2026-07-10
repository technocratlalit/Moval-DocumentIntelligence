import { Request, Response, NextFunction } from 'express';
import { DocsQueueService } from '../../infrastructure/queue/docs/docs-queue.service.js';
import { QueueOverloadedError } from '../../shared/errors/apiError.js';
import { asyncHandler } from '../../shared/middleware/asyncHandler.middleware.js';
import { getCorrelationId } from '../../shared/context/correlation.context.js';
import { _config } from '../../config/config.js';
import type { JobPriorityLevel } from '../../cost/types.js';

const KNOWN_UNRECOVERABLE_CODES = [
  'UNREADABLE_DOCUMENT',
  'WRONG_DOCUMENT_TYPE',
  'RESPONSE_TRUNCATED',
  'INVALID_URL',
  'UNSUPPORTED_FILE_TYPE',
  'FILE_TOO_LARGE',
];

const FRIENDLY_MESSAGES: Record<string, string> = {
  INVALID_URL: 'Please upload a valid file URL. The provided URL does not exist or is not accessible.',
  UNSUPPORTED_FILE_TYPE: 'Please upload a valid file. Only JPEG, PNG, HEIC, and PDF files are supported.',
  FILE_TOO_LARGE: 'The uploaded file is too large. Maximum allowed size is 50 MB for PDFs and 20 MB for images.',
  UNREADABLE_DOCUMENT: 'The document could not be read. Please upload a clear, well-lit image or a valid PDF.',
  WRONG_DOCUMENT_TYPE: 'The uploaded document does not match the selected document type. Please upload the correct document.',
  RESPONSE_TRUNCATED: 'The document has too many pages to process at once. Please upload a shorter document or split it into fewer pages.',
};

function resolveUrls(urls: string | string[]): string[] {
  if (Array.isArray(urls)) return urls;
  if (typeof urls === 'string') return [urls];
  return [];
}

function mapUnrecoverableError(error: any, res: Response): boolean {
  const errMsg: string = error?.message || '';
  for (const code of KNOWN_UNRECOVERABLE_CODES) {
    if (errMsg.includes(code)) {
      res.status(422).json({
        success: false,
        code,
        message: FRIENDLY_MESSAGES[code] ?? 'An error occurred while processing the document. Please try again.',
      });
      return true;
    }
  }
  return false;
}

function parseJobResult(result: unknown): {
  data: unknown;
  totalTokens?: number;
  totalCostINR?: number;
  durationMs?: number;
} {
  if (
    result &&
    typeof result === 'object' &&
    'data' in result &&
    (result as { data?: unknown }).data !== undefined
  ) {
    const envelope = result as {
      data: unknown;
      totalTokens?: number;
      totalCostINR?: number;
      durationMs?: number;
    };
    return {
      data: envelope.data,
      totalTokens: envelope.totalTokens,
      totalCostINR: envelope.totalCostINR,
      durationMs: envelope.durationMs,
    };
  }
  return { data: result };
}

export class DocumentController {
  private docsQueueService = new DocsQueueService();

  public extractDocument = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { type, urls, mode, priority, documentName, documentId, tableLayout } = req.body;
    const finalUrls = resolveUrls(urls);

    if (!type || finalUrls.length === 0) {
      res.status(400).json({ success: false, message: 'Document type and URL(s) are required.' });
      return;
    }

   
    const typeUpper = (type as string).toUpperCase();
    const smartDefault =
      typeUpper === 'RC' || typeUpper === 'DL' ? 'sync' : 'async';
    const extractMode: string = mode ?? _config.DEFAULT_EXTRACT_MODE ?? smartDefault;
    const priorityLevel = (priority ?? 'normal') as JobPriorityLevel;

    try {
      const workshopTableLayout =
        typeUpper === 'WORKSHOP'
          ? (tableLayout === 'split' ? 'split' : 'sequential')
          : undefined;

      const enqueueResult = await this.docsQueueService.enqueueDocument(type, finalUrls, {
        priorityLevel,
        documentName,
        documentId,
        tableLayout: workshopTableLayout,
      });

      if (enqueueResult.fromCache && enqueueResult.cachedResult != null) {
        res.status(200).json({
          success: true,
          message: 'Document extracted successfully (cached).',
          cached: true,
          jobId: enqueueResult.contentJobId,
          correlationId: getCorrelationId(),
          data: enqueueResult.cachedResult,
          totalTokens: 0,
          totalCostINR: 0,
          durationMs: 0,
        });
        return;
      }

      if (extractMode === 'async') {
        res.status(202).json({
          success: true,
          message: 'Document queued for extraction. Result will be sent via webhook.',
          jobId: enqueueResult.contentJobId,
          correlationId: getCorrelationId(),
          status: 'queued',
        });
        return;
      }

      const finished = await this.docsQueueService.waitForJob(enqueueResult.job, enqueueResult.queueEvents);
      const { data, totalTokens, totalCostINR, durationMs } = parseJobResult(finished);

      res.status(200).json({
        success: true,
        message: 'Document extracted successfully.',
        jobId: enqueueResult.contentJobId,
        correlationId: getCorrelationId(),
        data,
        ...(totalTokens != null ? { totalTokens } : {}),
        ...(totalCostINR != null ? { totalCostINR } : {}),
        ...(durationMs != null ? { durationMs } : {}),
      });
    } catch (error: any) {
      if (error instanceof QueueOverloadedError) {
        res.set('Retry-After', String(error.retryAfterSeconds));
        res.status(503).json({ success: false, message: error.message });
        return;
      }
      if (mapUnrecoverableError(error, res)) return;
      throw error;
    }
  });

  public getJobStatus = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
    if (!jobId) {
      res.status(400).json({ success: false, message: 'jobId is required.' });
      return;
    }

    const status = await this.docsQueueService.getJobStatus(jobId);
    if (!status) {
      res.status(404).json({ success: false, message: 'Job not found.' });
      return;
    }

    res.status(200).json({ success: true, ...status });
  });
}
