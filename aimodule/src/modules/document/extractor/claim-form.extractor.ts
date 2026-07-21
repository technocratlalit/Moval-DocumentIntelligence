import { ZodError } from 'zod';

import { AIService } from '../../../infrastructure/ai/ai.service';
import { MistralOcrService } from '../../../infrastructure/mistral/mistral-ocr.service.js';
import { ClaimFormSchema } from '../schema/claim/claim-form.schema';
import { ClaimFormMappingGeminiSchema } from '../schema/claim/claim-form-mapping.gemini.schema.js';
import type { ClaimFormMappingGeminiResult } from '../schema/claim/claim-form-mapping.gemini.schema.js';
import { buildClaimMappingPrompt } from '../prompts/claim-form-mapping.prompt.js';
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
import { getPrimaryFileInput } from '../utils/pdf-slice.util.js';
import { identifyInsurer, identifyTemplate } from '../utils/claim/claim-form-identify.util.js';
import { getTemplateVersionLabel } from '../utils/claim/claim-template-version.util.js';
import { normalizeClaimForm } from '../utils/claim/claim-form-normalize.util.js';
import { extractHeaderTextFromMistral } from '../utils/claim/mistral-header.util.js';
import { mistralPagesToPairs } from '../utils/claim/mistral-to-pairs.util.js';
import type { ClaimOcrPair } from '../utils/claim/claim-ocr-parse.util.js';
import { mapPairsToCanonical, mergeMappingResults } from '../utils/claim/claim-alias-mapper.util.js';
import { validateMappedFields, needsGeminiFallback } from '../utils/claim/claim-field-validators.util.js';
import { computeMappingConfidence } from '../utils/claim/claim-mapping-confidence.util.js';
import { hasClaimIdentityFields } from '../utils/claim/claim-ocr-fallback.util.js';
import { UnrecoverableDocumentError } from '../../../shared/errors/document.errors.js';
import { _config } from '../../../config/config';

export class ClaimFormExtractor {
  private aiService: AIService;
  private mistralOcr: MistralOcrService;
  private obs = ObserverService.getInstance();

  constructor() {
    this.aiService = AIService.getInstance();
    this.mistralOcr = MistralOcrService.getInstance();
  }

  public async extract(inputData: unknown) {
    this.obs.info('ClaimFormExtractor: Starting extraction');

    if (!this.mistralOcr.isEnabled()) {
      throw new UnrecoverableDocumentError(
        'OCR_UNAVAILABLE',
        'Mistral OCR is not configured. Set MISTRAL_API_KEY to process claim forms.',
      );
    }

    const primary = getPrimaryFileInput(inputData);
    const sourceUrl = primary?.sourceUrl;
    const localFilePath = primary?.localFilePath ?? primary?.localPdfPath;
    const mimeType = primary?.fileData?.mimeType ?? 'application/pdf';

    if (!sourceUrl && !localFilePath) {
      throw new UnrecoverableDocumentError(
        'UNREADABLE_DOCUMENT',
        'No file source available for Mistral OCR. Re-upload the claim form.',
      );
    }

    const ocrResult = await this.mistralOcr.processDocument({
      sourceUrl,
      localFilePath,
      mimeType,
    });

    const headerText = extractHeaderTextFromMistral(ocrResult.pages);
    const insurerHint = identifyInsurer(headerText);
    const template = identifyTemplate(headerText, insurerHint.insurerCode);
    const pairs = mistralPagesToPairs(ocrResult.pages, template);

    if (!pairs.length) {
      throw new UnrecoverableDocumentError(
        'UNREADABLE_DOCUMENT',
        'Mistral OCR returned no readable label-value pairs. Re-upload a clearer claim form.',
      );
    }

    this.obs.info('ClaimFormExtractor: Pass 1 complete', {
      pageCount: ocrResult.pageCount,
      pairCount: pairs.length,
      insurerCode: insurerHint.insurerCode,
      template,
      model: ocrResult.model,
      signaturePresent: ocrResult.signaturePresent,
      averageConfidence: ocrResult.averageConfidence,
    });

    return this.runMappingPipeline(pairs, insurerHint, template, inputData, {
      ocrEngine: 'mistral' as const,
      ocrModel: ocrResult.model,
      pageCount: ocrResult.pageCount,
      averageOcrConfidence: ocrResult.averageConfidence,
      lowConfidenceWordCount: ocrResult.lowConfidenceWordCount,
      signaturePresent: ocrResult.signaturePresent,
    });
  }

  private async runMappingPipeline(
    pairs: ClaimOcrPair[],
    insurerHint: ReturnType<typeof identifyInsurer>,
    template: ReturnType<typeof identifyTemplate>,
    inputData: unknown,
    meta: {
      ocrEngine: 'mistral';
      ocrModel: string;
      pageCount: number;
      averageOcrConfidence: number | null;
      lowConfidenceWordCount: number;
      signaturePresent: boolean;
    },
  ) {
    const aliasResult = mapPairsToCanonical(
      pairs,
      insurerHint.insurerCode,
      template,
      _config.CLAIM_ALIAS_FUZZY_THRESHOLD,
    );

    const validation = validateMappedFields(aliasResult.mapped);
    let merged = { ...validation.valid };
    let geminiFallbackUsed = false;
    let docGate: Partial<ClaimFormMappingGeminiResult> = {
      isCorrectDocumentType: true,
      detectedDocumentType: 'CLAIM_FORM',
      hasAllPagesCorrectType: true,
    };

    const alreadyMapped = Object.keys(merged).filter((k) => !isEffectivelyEmpty(merged[k]));

    if (
      _config.CLAIM_GEMINI_FALLBACK &&
      needsGeminiFallback(merged, aliasResult.unmappedPairs.length, validation.failedFields)
    ) {
      geminiFallbackUsed = true;
      const mappingPrompt = buildClaimMappingPrompt(
        aliasResult.unmappedPairs,
        insurerHint,
        template,
        alreadyMapped,
      );

      const geminiRaw = await this.aiService.processDocument(
        null,
        mappingPrompt,
        ClaimFormMappingGeminiSchema,
        Math.min(_config.CLAIM_MAX_OUTPUT_TOKENS, 2048),
        _config.CLAIM_AI_MODEL,
        _config.CLAIM_MAX_GEMINI_RETRIES,
        'CLAIM',
      ) as ClaimFormMappingGeminiResult;

      docGate = {
        isCorrectDocumentType: geminiRaw.isCorrectDocumentType,
        detectedDocumentType: geminiRaw.detectedDocumentType,
        hasAllPagesCorrectType: geminiRaw.hasAllPagesCorrectType ?? true,
        invalidPageIndices: geminiRaw.invalidPageIndices,
      };

      const geminiFieldMap: Record<string, unknown> = {};
      for (const item of geminiRaw.unmappedMappings ?? []) {
        if (item.canonicalField && item.value) {
          geminiFieldMap[item.canonicalField] = item.value;
        }
      }

      merged = mergeMappingResults(aliasResult, geminiFieldMap, geminiRaw.unmappedMappings ?? undefined);
      merged = validateMappedFields(merged).valid;
    }

    if (insurerHint.insurerCode !== 'OTHER') {
      if (isEffectivelyEmpty(merged.insurerCode)) merged.insurerCode = insurerHint.insurerCode;
      if (isEffectivelyEmpty(merged.insurerName) && insurerHint.insurerName) {
        merged.insurerName = insurerHint.insurerName;
      }
    }
    merged.templateVersion = getTemplateVersionLabel(template);

    if (meta.signaturePresent && isEffectivelyEmpty(merged.signaturePresent)) {
      merged.signaturePresent = true;
    }

    const confidence = computeMappingConfidence({
      mapped: merged,
      pairMappings: aliasResult.pairMappings,
      validatorFailedFields: validation.failedFields,
      totalPairs: pairs.length,
      averageOcrConfidence: meta.averageOcrConfidence,
      lowConfidenceWordCount: meta.lowConfidenceWordCount,
    });

    merged.requiresHumanReview = confidence.requiresHumanReview;
    merged.lowConfidenceFields = [
      ...new Set([...(confidence.lowConfidenceFields ?? []), ...validation.lowConfidenceFields]),
    ];
    merged.confidenceScore = confidence.confidenceScore;
    merged.isCorrectDocumentType = docGate.isCorrectDocumentType ?? true;
    merged.detectedDocumentType = docGate.detectedDocumentType ?? 'CLAIM_FORM';
    merged.hasAllPagesCorrectType = docGate.hasAllPagesCorrectType ?? true;
    merged.invalidPageIndices = docGate.invalidPageIndices ?? null;

    const unmappedExtras = aliasResult.extraFields.filter(
      (e) => e.matchedCanonicalField == null && e.value?.trim(),
    );
    merged.extraFields = unmappedExtras.length > 0
      ? unmappedExtras.map((e) => ({
          key: e.key,
          value: e.value,
          matchedCanonicalField: null,
          sourcePage: e.sourcePage,
          matchMethod: 'none' as const,
        }))
      : null;

    merged.extractionMeta = {
      ocrEngine: meta.ocrEngine,
      ocrModel: meta.ocrModel,
      pageCount: meta.pageCount,
      ocrPairCount: pairs.length,
      templateVersion: getTemplateVersionLabel(template),
      ocrRoute: 'mistral',
      aliasMappedCount: aliasResult.pairMappings.filter((m) => m.canonicalField != null).length,
      geminiFallbackUsed,
      unmappedPairCount: aliasResult.unmappedPairs.length,
      averageOcrConfidence: meta.averageOcrConfidence ?? undefined,
      lowConfidenceWordCount: meta.lowConfidenceWordCount,
      rawPairs: pairs.map((p) => ({
        page: p.page,
        key: p.label,
        value: p.value,
        section: p.section,
      })),
    };

    return this.finalizeResult(normalizeClaimForm(merged), inputData, {
      ocrPairCount: pairs.length,
      geminiFallbackUsed,
    });
  }

  private finalizeResult(
    parsedResult: ReturnType<typeof normalizeClaimForm>,
    inputData: unknown,
    meta: { ocrPairCount: number; geminiFallbackUsed: boolean },
  ) {
    let result;
    try {
      result = ClaimFormSchema.parse(parsedResult);
    } catch (e) {
      if (e instanceof ZodError) {
        throw new UnrecoverableDocumentError(
          'EXTRACTION_SCHEMA_FAILED',
          'Claim form structure could not be validated. Re-upload a clearer scan of the claim form.',
        );
      }
      throw e;
    }

    enforceDocumentTypeGates(result, {
      extractorName: 'ClaimFormExtractor',
      wrongTypeMessage: (typeStr) =>
        `The uploaded document appears to be a "${typeStr}", not a Claim Form. ` +
        'Please upload a valid motor insurance claim / intimation form.',
      mixedBatchMessage: (pageList) =>
        `Mixed document batch detected for Claim Form extraction. ${pageList} ` +
        'Please ensure all uploaded pages belong to the same claim form.',
    });

    const confidence = result.confidenceScore ?? 0;
    const hasClaimIdentity = hasClaimIdentityFields(result);

    if (!hasClaimIdentity) {
      if (result.isCorrectDocumentType === true) {
        result.requiresHumanReview = true;
        const reviewFields = new Set(result.lowConfidenceFields ?? []);
        reviewFields.add('policyNo');
        reviewFields.add('registrationNo');
        reviewFields.add('dateOfLoss');
        result.lowConfidenceFields = [...reviewFields];
      } else {
        rejectWrongTypeOrUnreadable(
          'ClaimFormExtractor',
          confidence,
          confidence >= 0.3,
          'The uploaded document does not appear to be a motor insurance Claim Form. ' +
            'Please upload a valid claim intimation or accident report form.',
          'The uploaded claim form could not be read. ' +
            'Please ensure the image is clear and shows the full claim form. ' +
            'Re-upload a higher quality scan.',
        );
      }
    }

    this.obs.info(
      `ClaimFormExtractor: Extraction complete — policyNo=${result.policyNo ?? 'N/A'}, ` +
        `insuredName=${result.insuredName ?? 'N/A'}, pairs=${meta.ocrPairCount}, ` +
        `confidence=${result.confidenceScore}, geminiFallback=${meta.geminiFallbackUsed}`,
    );

    return mergeDocumentQuality(
      result,
      getQualityHintFromInput(inputData),
      _config.PRESCREEN_BLUR_CONFIDENCE,
    );
  }
}
