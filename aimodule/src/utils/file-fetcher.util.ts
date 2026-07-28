import axios from 'axios';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getOptimizeImageStream } from './image.utils.js';
import { StorageService } from '../infrastructure/storage/storage.service.js';
import { AIService } from '../infrastructure/ai/ai.service.js';
import { ObserverService } from '../infrastructure/observabllity/observer.service.js';
import { UnrecoverableDocumentError } from '../shared/errors/document.errors.js';
import { _config } from '../config/config.js';
import { countPdfPages } from './pdf.util.js';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'application/pdf'];

/** Attached by prescreen when scan is blurry or low-confidence but still readable */
export interface FileQualityHint {
  isBlurred: boolean;
  confidence: number;
  reason?: string;
}

export interface FetchedFileResult {
  fileData: { fileUri: string; mimeType: string };
  /** Internal PDF page count from pdf-lib; 1 for images */
  pageCount: number;
  /** Original URL for re-fetch or external OCR when needed */
  sourceUrl: string;
  /** Temp PDF kept for workshop page-slice passes; cleaned up by DocumentService */
  localPdfPath?: string;
  /** Temp path for PDF or image; cleaned up by DocumentService */
  localFilePath?: string;
  /** Set by prescreen when scan is blurry or low-confidence but still readable */
  qualityHint?: FileQualityHint;
}

function downloadTimeoutForMime(mimeType: string | undefined): number {
  if (mimeType === 'application/pdf') {
    return _config.PDF_DOWNLOAD_TIMEOUT_MS;
  }
  return _config.DOWNLOAD_TIMEOUT_MS;
}

export async function fetchFileFromUrl(url: string): Promise<FetchedFileResult> {
  const obs = ObserverService.getInstance();

  try {
    let response: any;
    let mimeType: string | undefined;

    // Phase 1 — connect and receive headers (uses image timeout; PDF gets longer budget in phase 2)
    const connectTimeoutMs = _config.DOWNLOAD_TIMEOUT_MS;

    try {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), connectTimeoutMs);

      response = await axios.get(url, {
        responseType: 'stream',
        maxContentLength: 50 * 1024 * 1024,
        signal: controller.signal as any,
        timeout: connectTimeoutMs,
      });

      clearTimeout(timeoutHandle);
    } catch (axiosErr: any) {
      if (axiosErr.code === 'ERR_CANCELED' || axiosErr.name === 'CanceledError') {
        throw new Error(
          `Download timeout after ${connectTimeoutMs / 1000}s connecting to URL: ${url}`,
        );
      }
      const status: number | undefined = axiosErr?.response?.status;
      if (status && status >= 400 && status < 500) {
        throw new UnrecoverableDocumentError(
          'INVALID_URL',
          `HTTP ${status} fetching file — URL does not exist or is not accessible: ${url}`,
        );
      }
      throw axiosErr;
    }

    mimeType = ((response.headers['content-type'] as string) || 'image/jpeg').split(';')[0].trim().toLowerCase();

    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      throw new UnrecoverableDocumentError(
        'UNSUPPORTED_FILE_TYPE',
        `File at URL has unsupported type '${mimeType}'. Allowed: JPEG, PNG, HEIC, PDF.`,
      );
    }

    const contentLength = response.headers['content-length'];
    const sizeInBytes = contentLength ? parseInt(contentLength as string, 10) : 0;
    const isPDF = mimeType === 'application/pdf';
    const maxSize = isPDF ? 50 * 1024 * 1024 : 20 * 1024 * 1024;
    const streamTimeoutMs = downloadTimeoutForMime(mimeType);
    const deadline = Date.now() + streamTimeoutMs;

    if (sizeInBytes > maxSize) {
      throw new UnrecoverableDocumentError(
        'FILE_TOO_LARGE',
        `File size ${(sizeInBytes / (1024 * 1024)).toFixed(2)}MB exceeds limit (${isPDF ? '50MB for PDFs' : '20MB for images'}).`,
      );
    }

    const ext = isPDF ? '.pdf' : '.jpg';
    const filename = `${Date.now()}-${Math.floor(Math.random() * 10000)}${ext}`;
    const tempFilePath = path.join(os.tmpdir(), filename);

    obs.info(
      `FileFetcher: Downloading ${isPDF ? 'PDF' : 'Image'} from URL`,
      {
        url,
        timeoutSec: streamTimeoutMs / 1000,
        sizeMb: sizeInBytes > 0 ? (sizeInBytes / (1024 * 1024)).toFixed(2) : 'unknown',
      },
    );

    // Phase 2 — stream body to disk (full deadline covers large PDFs from ImageKit/CDN)
    await new Promise<void>((resolve, reject) => {
      const writer = fs.createWriteStream(tempFilePath);
      let downloadedBytes = 0;
      let stream = response.data;

      const onTimeout = () => {
        stream.destroy();
        writer.destroy();
        reject(new Error(
          `Download stream timeout after ${streamTimeoutMs / 1000}s for URL: ${url}`,
        ));
      };

      const deadlineTimer = setTimeout(onTimeout, streamTimeoutMs);

      stream.on('data', (chunk: Buffer) => {
        if (Date.now() > deadline) {
          clearTimeout(deadlineTimer);
          onTimeout();
          return;
        }
        downloadedBytes += chunk.length;
        if (downloadedBytes > maxSize) {
          clearTimeout(deadlineTimer);
          stream.destroy();
          writer.destroy();
          reject(new UnrecoverableDocumentError(
            'FILE_TOO_LARGE',
            `Streamed file exceeded ${maxSize / (1024 * 1024)}MB limit.`,
          ));
        }
      });

      if (!isPDF) {
        stream = stream.pipe(getOptimizeImageStream());
        mimeType = 'image/jpeg';
      }

      stream.pipe(writer);

      writer.on('finish', () => { clearTimeout(deadlineTimer); resolve(); });
      writer.on('error', (err: Error) => { clearTimeout(deadlineTimer); reject(err); });
      stream.on('error', (err: Error) => { clearTimeout(deadlineTimer); reject(err); });
    });

    try {
      let pageCount = 1;

      if (isPDF) {
        pageCount = await countPdfPages(tempFilePath);
        obs.info(`FileFetcher: PDF has ${pageCount} internal page(s)`, { filename, pageCount });
      }

      if (!isPDF) {
        const storageService = StorageService.getInstance();
        storageService.uploadFile(tempFilePath, `documents/${filename}`, mimeType).catch((err: any) => {
          obs.logError('Failed to upload to GCS in background', err);
        });
      } else {
        obs.info(`FileFetcher: Skipped GCS upload for PDF ${filename}`);
      }

      const aiService = AIService.getInstance();
      obs.info(`FileFetcher: Uploading ${isPDF ? 'PDF' : 'Image'} to Gemini File API`, { filename });
      const fileUri = await aiService.uploadFile(tempFilePath, mimeType, filename);
      obs.info(`FileFetcher: Uploaded to Gemini`, { fileUri });

      return {
        fileData: { fileUri, mimeType },
        pageCount,
        sourceUrl: url,
        localFilePath: tempFilePath,
        ...(isPDF ? { localPdfPath: tempFilePath } : {}),
      };
    } finally {
      // Temp files cleaned up by DocumentService after extraction
    }
  } catch (error: any) {
    if (error instanceof UnrecoverableDocumentError) throw error;

    const code = error?.code as string | undefined;
    const msg = String(error?.message ?? error);
    const isBadHost =
      code === 'ENOTFOUND' ||
      code === 'ECONNREFUSED' ||
      code === 'EAI_AGAIN' ||
      code === 'ERR_INVALID_URL' ||
      msg.includes('getaddrinfo');

    if (isBadHost) {
      throw new UnrecoverableDocumentError(
        'INVALID_URL',
        `Cannot reach URL — host does not exist or DNS failed: ${url}`,
      );
    }

    throw new Error(`Failed to fetch file from URL: ${msg}`);
  }
}
