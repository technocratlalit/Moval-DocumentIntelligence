import { AIService } from '../../../infrastructure/ai/ai.service';
import { DLGeminiSchema } from '../schema/dl/dl.gemini.schema';
import { DLSchema } from '../schema/dl/dl.schema';
import { getDLPrompt } from '../prompts/dl.prompt';
import {
  normalizeDLNumber,
  detectStateFromDL,
  computeDLStatus,
  normaliseDLExtraction,
} from '../utils/dl/dl.utils';
import { shapeDLResponse } from '../utils/dl/dl-response.util.js';
import { ObserverService } from '../../../infrastructure/observabllity/observer.service.js';
import {
  enforceDocumentTypeGates,
  isEffectivelyEmpty,
  rejectWrongTypeOrUnreadable,
} from '../utils/document-gates.util.js';
import {
  getQualityHintFromInput,
  mergeDocumentQuality,
} from '../utils/document-quality.util.js';
import { _config } from '../../../config/config';

export class DLExtractor {
  private aiService: AIService;
  private obs = ObserverService.getInstance();

  constructor() {
    this.aiService = AIService.getInstance();
  }

  public async extract(inputData: any) {
    const isMultiPage = Array.isArray(inputData) && inputData.length > 1;
    // DL output is typically ~400–600 tokens; cap at 2048 by default
    const maxTokens = parseInt(_config.DL_MAX_OUTPUT_TOKENS ?? '2048', 10);

    this.obs.info(
      `DLExtractor: Starting extraction — mode=${isMultiPage ? `MULTI_PAGE (${(inputData as any[]).length} images)` : 'SINGLE FILE'}, maxOutputTokens=${maxTokens}`
    );

    const rawResult = await this.aiService.processDocument(
      inputData,
      getDLPrompt(),
      DLGeminiSchema,
      maxTokens,
      _config.DL_AI_MODEL,
      _config.DL_MAX_GEMINI_RETRIES,
      'DL',
    );

    this.obs.info('DLExtractor: Raw extraction complete, applying normalizations...');

    const cleaned = normaliseDLExtraction(rawResult as Record<string, unknown>);

    const normalizedData = {
      ...cleaned,
      dlNumberNormalized: normalizeDLNumber(cleaned.dlNumber as string | null | undefined),
      state: detectStateFromDL(cleaned.dlNumber as string | null | undefined, {
        stateCode: cleaned.stateCode as string | null | undefined,
      }),
      dlStatus: computeDLStatus(
        cleaned.validityNT as string | null | undefined,
        cleaned.validityT as string | null | undefined,
      ),
    };

    // Validate with Zod
    const parsedResult = DLSchema.parse(normalizedData);

    enforceDocumentTypeGates(parsedResult, {
      extractorName: 'DLExtractor',
      wrongTypeMessage: (typeStr) =>
        `The uploaded document appears to be a "${typeStr}", not a Driving Licence (DL). ` +
        'Please upload the DL card (front/back) or a scanned DL PDF.',
      mixedBatchMessage: (pageList) =>
        `Mixed document batch detected for DL extraction. ${pageList} ` +
        'Please ensure all uploaded pages belong to the same DL card (front/back only). ' +
        'Remove any RC cards, insurance policies, or workshop bills from the upload.',
    });

    const confidence = parsedResult.confidenceScore ?? 0;
    const hasNoDLIdentifiers =
      isEffectivelyEmpty(parsedResult.dlNumber) &&
      (!parsedResult.vehicleClasses || parsedResult.vehicleClasses.length === 0);

    if (hasNoDLIdentifiers) {
      rejectWrongTypeOrUnreadable(
        'DLExtractor',
        confidence,
        confidence >= 0.3,
        'The uploaded document does not appear to be a Driving License (DL). ' +
          'Please upload the correct DL document. ' +
          'Supported formats: physical DL card (front/back) or a scanned DL PDF.',
        'The uploaded document could not be read. ' +
          'Please ensure the image is clear, well-lit, and shows the full DL card. ' +
          'Re-upload a higher quality image.',
      );
    }

    const withQuality = mergeDocumentQuality(
      parsedResult,
      getQualityHintFromInput(inputData),
      _config.PRESCREEN_BLUR_CONFIDENCE,
    );

    return shapeDLResponse(withQuality);
  }
}
