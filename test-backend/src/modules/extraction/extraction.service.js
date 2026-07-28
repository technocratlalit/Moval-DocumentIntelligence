import axios from 'axios';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import mongoose from 'mongoose';
import { ExtractionJob } from '../../model/extraction-job.schema.js';
import { Upload } from '../../model/upload.schema.js';
import { _config } from '../../config/config.js';
import { ApiError } from '../../shared/apiError.js';
import { applyClaimFields } from './apply-claim-fields.js';

const VALID_TYPES = ['RC', 'DL', 'WORKSHOP', 'POLICY', 'CLAIM'];

function defaultMode(documentType) {
  return documentType === 'RC' || documentType === 'DL' ? 'sync' : 'async';
}

function signAimoduleToken() {
  if (!_config.JWT_SECRET) {
    throw ApiError.badRequest('JWT_SECRET is not configured.');
  }
  return jwt.sign(
    {
     id: 'test_user',
      role: 'Surveyor'
     },
      _config.JWT_SECRET, 
      { expiresIn: '1h' }
    );
}

export class ExtractionService {
  async createExtraction({
    documentType,
    uploadIds,
    urls: directUrls,
    mode, 
    priority = 'normal',
    tableLayout,
    correlationId: providedCorrelationId,
  }) {
    const type = (documentType ?? '').toUpperCase();
    if (!VALID_TYPES.includes(type)) {
      throw ApiError.badRequest(`documentType must be one of: ${VALID_TYPES.join(', ')}`);
    }

    let urls = Array.isArray(directUrls) ? directUrls.filter(Boolean) : [];
    let resolvedUploadIds = [];
    let uploads = [];

    if (uploadIds?.length) {
      uploads = await Upload.find({ _id: { $in: uploadIds } });
      if (uploads.length !== uploadIds.length) {
        throw ApiError.badRequest('One or more uploadIds were not found.');
      }
      resolvedUploadIds = uploads.map((u) => u._id);
      urls = uploads.map((u) => u.url);
    }

    if (urls.length === 0) {
      throw ApiError.badRequest('Provide uploadIds or urls.');
    }

    const extractMode = mode ?? defaultMode(type);
    const extractPriority = ['urgent', 'normal', 'low'].includes(priority) ? priority : 'normal';
    const extractTableLayout =
      type === 'WORKSHOP'
        ? (tableLayout === 'split' ? 'split' : 'sequential')
        : undefined;
    const correlationId = providedCorrelationId ?? randomUUID();

    const job = await ExtractionJob.create({
      correlationId,
      documentType: type,
      uploadIds: resolvedUploadIds,
      urls,
      mode: extractMode,
      priority: extractPriority,
      tableLayout: extractTableLayout,
      status: extractMode === 'async' ? 'queued' : 'processing',
    });

    try {
      const token = signAimoduleToken();
      const documentId = job._id.toString();
      let documentName = 'unknown';

      if (uploads && uploads.length > 0) {
        documentName = uploads[0].originalName;
        console.log("name..", documentName)
        console.log("updldo", uploads[0].originalName)
      } else if (urls.length > 0) {
        try {
          const urlObj = new URL(urls[0]);
          documentName = urlObj.pathname.split('/').pop() || 'unknown';
        } catch {
          documentName = urls[0].split('/').pop() || 'unknown';
        }
      }

      const response = await axios.post(
        `${_config.AIMODULE_URL}/api/v1/documents/extract`,
        {
          type,
          urls,
          mode: extractMode,
          priority: extractPriority,
          documentName,
          documentId,
          ...(type === 'WORKSHOP' ? { tableLayout: extractTableLayout } : {}),
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Correlation-Id': correlationId,
            'Content-Type': 'application/json',
          },
          validateStatus: () => true,
        },
      );

      const body = response.data ?? {};

      if (response.status === 200) {
        job.status = 'completed';
        job.jobId = body.jobId ?? job.jobId;
        job.result = body.data ?? body.result ?? null;
        applyClaimFields(job, job.result);
        job.cached = Boolean(body.cached);
        job.totalTokens = body.totalTokens ?? (body.cached ? 0 : undefined);
        job.totalCostINR = body.totalCostINR ?? (body.cached ? 0 : undefined);
        job.durationMs = body.durationMs ?? undefined;
        job.completedAt = new Date();
        await job.save();
        return job;
      }

      if (response.status === 202) {
        job.status = 'queued';
        job.jobId = body.jobId ?? job.jobId;
        await job.save();
        return job;
      }

      job.status = 'failed';
      job.error = body.message ?? `aimodule returned ${response.status}`;
      await job.save();
      throw ApiError.badRequest(job.error);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (err.response) {
        job.status = 'failed';
        job.error = err.response.data?.message ?? err.message;
        await job.save();
        throw ApiError.badRequest(job.error);
      }
      job.status = 'failed';
      job.error = err.message;
      await job.save();
      throw err;
    }
  }

  async listExtractions({ documentType, page = 1, limit = 20 }) {
    const filter = {};
    if (documentType) {
      const type = documentType.toUpperCase();
      if (VALID_TYPES.includes(type)) filter.documentType = type;
    }

    const skip = (Math.max(1, page) - 1) * limit;
    const [items, total] = await Promise.all([
      ExtractionJob.find(filter)
        .populate('uploadIds')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      ExtractionJob.countDocuments(filter),
    ]);

    return { items, total, page: Math.max(1, page), limit };
  }

  async getExtraction(id) {
    const job = await ExtractionJob.findById(id).populate('uploadIds');
    if (!job) throw ApiError.notFound('Extraction job not found.');
    return job;
  }

  async deleteExtraction(id) {
    if (!mongoose.Types.ObjectId.isValid(id)) return false;
    const job = await ExtractionJob.findByIdAndDelete(id);
    return Boolean(job);
  }

  async getReview(id) {
    const job = await this.getExtraction(id);
    if (job.documentType !== 'CLAIM') {
      throw ApiError.badRequest('Review is only available for CLAIM extractions.');
    }
    const upload = job.uploadIds?.[0];
    return {
      id: job._id,
      status: job.status,
      canonicalJson: job.result,
      display: job.result?.display ?? null,
      flaggedFields: job.flaggedFields ?? job.result?.extractionMeta?.flaggedFields ?? [],
      fieldConfidence: job.fieldConfidence ?? [],
      fileUrl: upload?.url ?? job.urls?.[0] ?? null,
      reviewCorrections: job.reviewCorrections ?? [],
    };
  }

  async submitReview(id, corrections = []) {
    const job = await ExtractionJob.findById(id);
    if (!job) throw ApiError.notFound('Extraction job not found.');
    if (job.documentType !== 'CLAIM') {
      throw ApiError.badRequest('Review is only available for CLAIM extractions.');
    }

    const result = { ...(job.result ?? {}) };
    const applied = [];

    for (const c of corrections) {
      if (!c?.path) continue;
      const parts = c.path.split('.');
      let cur = result;
      for (let i = 0; i < parts.length - 1; i++) {
        if (cur[parts[i]] == null) cur[parts[i]] = {};
        cur = cur[parts[i]];
      }
      const key = parts[parts.length - 1];
      applied.push({
        path: c.path,
        oldValue: cur[key],
        newValue: c.newValue,
        correctedAt: new Date(),
      });
      cur[key] = c.newValue;
    }

    job.reviewCorrections = [...(job.reviewCorrections ?? []), ...applied];
    job.result = result;
    job.status = 'completed';
    job.flaggedFields = [];
    await job.save();
    return job;
  }
}
