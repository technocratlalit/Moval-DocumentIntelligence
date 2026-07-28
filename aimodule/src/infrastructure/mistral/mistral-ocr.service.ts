import fs from 'fs/promises';
import axios from 'axios';
import { _config } from '../../config/config.js';
import { ObserverService } from '../observabllity/observer.service.js';
import { recordMistralOcrCall } from '../../cost/tracker.js';
import type { MistralOcrInput, MistralOcrPage, MistralOcrResult } from './mistral-ocr.types.js';

const OCR_ENDPOINT = 'https://api.mistral.ai/v1/ocr';

export class MistralOcrService {
  private static instance: MistralOcrService;
  private obs = ObserverService.getInstance();

  static getInstance(): MistralOcrService {
    if (!MistralOcrService.instance) {
      MistralOcrService.instance = new MistralOcrService();
    }
    return MistralOcrService.instance;
  }

  isEnabled(): boolean {
    return Boolean(_config.MISTRAL_API_KEY);
  }

  async processDocument(input: MistralOcrInput): Promise<MistralOcrResult> {
    if (!_config.MISTRAL_API_KEY) {
      throw new Error('MISTRAL_API_KEY is not configured');
    }

    const start = Date.now();
    const document = await this.buildDocumentPayload(input);

    this.obs.info('MistralOcrService: starting OCR', {
      docType: document.type,
      hasUrl: Boolean(input.sourceUrl),
      hasLocal: Boolean(input.localFilePath),
    });

    try {
      const { data } = await axios.post(
        OCR_ENDPOINT,
        {
          model: _config.MISTRAL_OCR_MODEL,
          document,
          table_format: _config.MISTRAL_OCR_TABLE_FORMAT,
          include_blocks: _config.MISTRAL_OCR_INCLUDE_BLOCKS,
          extract_header: _config.MISTRAL_OCR_EXTRACT_HEADER,
          extract_footer: _config.MISTRAL_OCR_EXTRACT_FOOTER,
          confidence_scores_granularity: _config.MISTRAL_OCR_CONFIDENCE,
          include_image_base64: _config.MISTRAL_OCR_INCLUDE_IMAGE_BASE64,
        },
        {
          headers: {
            Authorization: `Bearer ${_config.MISTRAL_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 300_000,
        },
      );

      const pages = (data.pages ?? []) as MistralOcrPage[];
      const pageCount = pages.length;

      if (pageCount > _config.MISTRAL_OCR_MAX_PAGES) {
        throw new Error(
          `Claim form has ${pageCount} pages; max ${_config.MISTRAL_OCR_MAX_PAGES} supported.`,
        );
      }

      const signaturePresent = pages.some((p) =>
        p.blocks?.some((b) => b.type === 'signature'),
      );

      const confidences = pages
        .map((p) => p.confidence_scores?.average_page_confidence_score)
        .filter((c): c is number => typeof c === 'number');

      const lowConfidenceWordCount = pages.reduce((sum, p) => {
        const words = p.confidence_scores?.word_confidence_scores ?? [];
        return sum + words.filter((w) => w.confidence < 0.6).length;
      }, 0);

      const costUsd = pageCount * _config.MISTRAL_COST_PER_PAGE_USD;
      const latencyMs = Date.now() - start;

      recordMistralOcrCall({
        pages: pageCount,
        costUsd,
        latencyMs,
        status: 'success',
      });

      this.obs.info('MistralOcrService: OCR complete', {
        pageCount,
        latencyMs,
        lowConfidenceWordCount,
      });

      return {
        pages,
        model: String(data.model ?? _config.MISTRAL_OCR_MODEL),
        pageCount,
        latencyMs,
        signaturePresent,
        averageConfidence: confidences.length
          ? confidences.reduce((a, b) => a + b, 0) / confidences.length
          : null,
        lowConfidenceWordCount,
      };
    } catch (err: unknown) {
      const latencyMs = Date.now() - start;
      const msg = err instanceof Error ? err.message : String(err);
      recordMistralOcrCall({ pages: 0, costUsd: 0, latencyMs, status: 'failure' });
      throw new Error(`Mistral OCR failed: ${msg}`);
    }
  }

  private async buildDocumentPayload(
    input: MistralOcrInput,
  ): Promise<{ type: string; document_url?: string; document_base64?: string }> {
    if (input.sourceUrl) {
      return { type: 'document_url', document_url: input.sourceUrl };
    }
    if (input.localFilePath) {
      const buf = await fs.readFile(input.localFilePath);
      const b64 = buf.toString('base64');
      const mime = input.mimeType ?? 'application/pdf';
      return { type: 'document_base64', document_base64: `data:${mime};base64,${b64}` };
    }
    throw new Error('Mistral OCR requires sourceUrl or localFilePath');
  }
}
