import { ZodError } from 'zod';
import { AIService } from '../../../infrastructure/ai/ai.service.js';
import { ObserverService } from '../../../infrastructure/observabllity/observer.service.js';
import { UnrecoverableDocumentError } from '../../../shared/errors/document.errors.js';
import { _config } from '../../../config/config.js';
import { computeClaimMaxTokens } from '../../../cost/token-budget.js';
import { resolveDocumentPageCount } from '../../../utils/document-page-count.util.js';
import {
  ClaimSinglePassGeminiSchema,
  InsuranceClaimSchema,
  type IInsuranceClaimResult,
  type IInsuranceClaimSchema,
} from '../schema/claim/motor-claim.schema.js';
import { getMotorClaimPrompt } from '../prompts/motor-claim.prompt.js';
import {
  assembleClaimResult,
  mergeClaimConfidence,
  normalizeMotorClaimFields,
} from '../utils/claim/motor-claim.utils.js';
import {
  enforceDocumentTypeGates,
  isEffectivelyEmpty,
  rejectWrongTypeOrUnreadable,
} from '../utils/document-gates.util.js';
import {
  getQualityHintFromInput,
  mergeDocumentQuality,
} from '../utils/document-quality.util.js';

export class ClaimFormExtractor {
  private aiService = AIService.getInstance();
  private obs = ObserverService.getInstance();

  private parseClaimResult(raw: unknown): IInsuranceClaimSchema & { lowConfidenceFields?: string[] | null } {
    try {
      const normalized = normalizeMotorClaimFields(raw as Record<string, unknown>);
      const parsed = InsuranceClaimSchema.parse(normalized);
      const quality = mergeClaimConfidence(parsed);
      return { ...parsed, ...quality };
    } catch (e) {
      if (e instanceof ZodError) {
        throw new UnrecoverableDocumentError(
          'EXTRACTION_SCHEMA_FAILED',
          'Claim form structure could not be validated. Re-upload a clearer scan or PDF.',
        );
      }
      throw e;
    }
  }

  async extract(inputData: unknown): Promise<IInsuranceClaimResult> {
    const pageCount = resolveDocumentPageCount(inputData);
    const maxPages = _config.CLAIM_MAX_PDF_PAGES ?? 5;

    if (pageCount > maxPages) {
      throw new UnrecoverableDocumentError(
        'TOO_MANY_PAGES',
        `Claim form has ${pageCount} pages; max ${maxPages} supported.`,
      );
    }

    const isMultiPage = Array.isArray(inputData) && inputData.length > 1;
    const maxTokens = computeClaimMaxTokens(
      pageCount,
      String(_config.CLAIM_MAX_OUTPUT_TOKENS ?? 8192),
    );

    this.obs.info(
      `ClaimFormExtractor: Starting extraction — ${pageCount} page(s), ` +
        `mode=${isMultiPage ? `MULTI_IMAGE (${(inputData as unknown[]).length})` : 'SINGLE FILE'}, ` +
        `maxOutputTokens=${maxTokens}`,
    );

    const rawResult = await this.aiService.processDocument(
      inputData,
      getMotorClaimPrompt(),
      ClaimSinglePassGeminiSchema,
      maxTokens,
      _config.CLAIM_AI_MODEL,
      _config.CLAIM_MAX_GEMINI_RETRIES,
      'CLAIM',
    );

    this.obs.info('ClaimFormExtractor: Raw extraction complete, applying normalizations...');

    const parsed = this.parseClaimResult(rawResult);
    const gateInput = {
      ...parsed,
      confidenceScore: parsed.confidenceScore ?? undefined,
      requiresHumanReview: parsed.requiresHumanReview ?? undefined,
    };

    enforceDocumentTypeGates(gateInput, {
      extractorName: 'ClaimFormExtractor',
      wrongTypeMessage: (typeStr) =>
        `The uploaded document appears to be a "${typeStr}", not a motor insurance claim form. ` +
        'Please upload a UIIC/OIC/NIAC/NIC motor claim form PDF or scan.',
      mixedBatchMessage: (pageList) =>
        `Mixed document batch detected for claim extraction. ${pageList} ` +
        'Please ensure all uploaded pages belong to the same claim form.',
    });

    const confidence = parsed.confidenceScore ?? 0;
    const hasNoClaimIdentifiers =
      isEffectivelyEmpty(parsed.policyNumber) &&
      isEffectivelyEmpty(parsed.insuredName) &&
      isEffectivelyEmpty(parsed.registrationNo) &&
      isEffectivelyEmpty(parsed.accidentDate);

    if (hasNoClaimIdentifiers) {
      rejectWrongTypeOrUnreadable(
        'ClaimFormExtractor',
        confidence,
        confidence >= 0.3,
        'The uploaded document does not appear to be a motor insurance claim form. ' +
          'Please upload the correct claim form (UIIC, OIC, NIAC, or NIC).',
        'The uploaded claim form could not be read. ' +
          'Please ensure the scan is clear and all pages are included.',
      );
    }

    const withQuality = mergeDocumentQuality(
      parsed,
      getQualityHintFromInput(inputData),
      _config.PRESCREEN_BLUR_CONFIDENCE,
    );

    const result = assembleClaimResult(
      rawResult,
      withQuality,
      pageCount,
      _config.CLAIM_AI_MODEL ?? 'gemini-2.5-flash-lite',
    );

    this.obs.info('ClaimFormExtractor: complete', {
      insurer: result.insurerName,
      policyNo: result.policyNumber,
      requiresHumanReview: result.additionalData.requiresHumanReview,
    });

    return result;
  }
}
