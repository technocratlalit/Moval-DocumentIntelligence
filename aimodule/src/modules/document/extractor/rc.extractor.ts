import { AIService } from '../../../infrastructure/ai/ai.service';
import { RCGeminiSchema } from '../schema/rc/rc.gemini.schema';
import { RCSchema } from '../schema/rc/rc.schema';
import { getRCPrompt } from '../prompts/rc.prompt';
import {
  detectStateFromRegNo,
  extractStateCode,
  computeRCStatus,
  normaliseFinanceFields,
  normaliseRCExtraction,
  deriveHypothecation,
} from '../utils/rc/rc.utils';
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

export class RCExtractor {
  private aiService: AIService;
  private obs = ObserverService.getInstance();

  constructor() {
    this.aiService = AIService.getInstance();
  }

  // main function to extract all data 
  public async extract(inputData: any) {
    const isMultiSide = Array.isArray(inputData) && inputData.length > 1;
   
    const maxTokens = parseInt(_config.RC_MAX_OUTPUT_TOKENS ?? '2048', 10);

    this.obs.info(
      `RCExtractor: Starting extraction — mode=${isMultiSide ? 'FRONT+BACK (2 images)' : 'SINGLE FILE'}, maxOutputTokens=${maxTokens}`
    );

    const rawResult = await this.aiService.processDocument(
      inputData,
      getRCPrompt(),
      RCGeminiSchema,
      maxTokens,
      _config.RC_AI_MODEL,
      _config.RC_MAX_GEMINI_RETRIES,
      'RC',
    );

    this.obs.info('RCExtractor: Raw extraction complete, applying normalizations...');

    const cleaned = normaliseRCExtraction(rawResult as Record<string, unknown>);

    const stateHints = {
      cardStateCode: cleaned.stateCode as string | null | undefined,
      rtoCode: cleaned.rtoCode as string | null | undefined,
    };
    const finance = normaliseFinanceFields({
      purpose: cleaned.purpose as string | null | undefined,
      financeBank: cleaned.financeBank as string | null | undefined,
      hypothecatedTo: cleaned.hypothecatedTo as string | null | undefined,
    });
    const hypothecation = deriveHypothecation(finance);

    const derivedStateCode =
      extractStateCode(cleaned.registrationNo as string | null | undefined, stateHints) ??
      stateHints.cardStateCode ??
      null;

    const derivedState = detectStateFromRegNo(cleaned.registrationNo as string | null | undefined, {
      ...stateHints,
      cardStateCode: derivedStateCode,
    });
    const rcStatus = computeRCStatus(cleaned.regValidity as string | null | undefined);

    const mergedData = {
      ...cleaned,
      ...finance,
      hypothecation,
      state: derivedState,
      rcStatus,
    };

    // Validate with Zod
    const parsedResult = RCSchema.parse(mergedData);

    enforceDocumentTypeGates(parsedResult, {
      extractorName: 'RCExtractor',
      wrongTypeMessage: (typeStr) =>
        `The uploaded document appears to be a "${typeStr}", not a Registration Certificate (RC). ` +
        'Please upload the vehicle RC card (front/back) or a scanned RC PDF.',
      mixedBatchMessage: (pageList) =>
        `Mixed document batch detected for RC extraction. ${pageList} ` +
        'Please ensure all uploaded pages belong to the same RC (front/back only). ' +
        'Remove any DL cards, insurance policies, or workshop bills from the upload.',
    });

    const noRegistrationNo = isEffectivelyEmpty(parsedResult.registrationNo);
    const noChassisNo = isEffectivelyEmpty(parsedResult.chassisNo);
    const noEngineNo = isEffectivelyEmpty(parsedResult.engineNo);
    const confidence = parsedResult.confidenceScore ?? 0;
    const hasNoRCIdentifiers = noRegistrationNo && noChassisNo && noEngineNo;
    const isLikelyDLCard =
      !noRegistrationNo &&
      noChassisNo &&
      noEngineNo && 
      confidence < 0.55;

    if (hasNoRCIdentifiers || isLikelyDLCard) {
      rejectWrongTypeOrUnreadable(
        'RCExtractor',
        confidence,
        confidence >= 0.3,
        'The uploaded document does not appear to be a Registration Certificate (RC). ' +
          'Please upload the correct RC document. ' +
          'Supported formats: physical RC card (front/back) or a scanned RC PDF.',
        'The uploaded document could not be read. ' +
          'Please ensure the image is clear, well-lit, and shows the full RC card. ' +
          'Re-upload a higher quality image.',
      );
    }

    this.obs.info(
      `RCExtractor: Extraction successful — ` +
      `regNo=${parsedResult.registrationNo ?? 'N/A'} | ` +
      `state=${parsedResult.state ?? 'N/A'} | ` +
      `confidence=${parsedResult.confidenceScore}`
    );

    return mergeDocumentQuality(
      parsedResult,
      getQualityHintFromInput(inputData),
      _config.PRESCREEN_BLUR_CONFIDENCE,
    );
  }
}
