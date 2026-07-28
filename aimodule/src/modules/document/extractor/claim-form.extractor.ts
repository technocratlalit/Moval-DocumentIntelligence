import { AIService } from '../../../infrastructure/ai/ai.service.js';
import { MistralOcrService } from '../../../infrastructure/mistral/mistral-ocr.service.js';
import { ObserverService } from '../../../infrastructure/observabllity/observer.service.js';
import { UnrecoverableDocumentError } from '../../../shared/errors/document.errors.js';
import { JsonUtil } from '../../../utils/json.util.js';
import { _config } from '../../../config/config.js';
import type { FetchedFileResult } from '../../../utils/file-fetcher.util.js';
import {
  CanonicalClaimSchema,
  ClaimClassifySchema,
  type ClaimExtractionResult,
} from '../schema/claim/claim-form.schema.js';
import { CLAIM_CLASSIFY_PROMPT, getClaimClassifySchema } from '../prompts/claim-classify.prompt.js';
import { buildClaimMapPrompt, buildClaimMapRetryPrompt } from '../prompts/claim-map.prompt.js';
import { pagesToCleanedMarkdown, summarizeMistralPages } from '../utils/claim/ocr-markdown.util.js';
import { mistralPagesToRawPairs } from '../utils/claim/label-pairs.util.js';
import {
  dumpStage,
  getClaimDebugStages,
  initClaimDebugDump,
} from '../utils/claim/claim-pipeline-debug.util.js';
import {
  computeOverallConfidence,
  postprocessClaimForm,
  validateCrossFields,
} from '../utils/claim/postprocess.util.js';
import { computeFieldConfidence } from '../utils/claim/confidence.util.js';
import { backfillClaimFromHints } from '../utils/claim/claim-backfill.util.js';
import { flattenClaimForDisplay } from '../utils/claim/claim-flatten.util.js';
import { normalizeTemplateVersion } from '../utils/claim/claim-normalize.util.js';
import { fieldHintsToText, mergeFieldHints } from '../utils/claim/claim-table-pairs.util.js';
import { buildSliceInput } from '../utils/pdf-slice.util.js';
import { getJobId } from '../../../cost/tracker.js';

const CLAIM_SECTIONS = [
  'meta', 'company_details', 'policy_details', 'insured_details', 'vehicle_details',
  'commercial_vehicle_info', 'loss_details', 'driver_details', 'damage_to_insured_vehicle',
  'workshop_details', 'third_party_details', 'injury_death_to_driver_occupant',
  'police_fir_details', 'witness_details', 'theft_details', 'add_on_covers', 'past_claims', 'declaration',
] as const;

function fillMissingClaimSections(data: Record<string, unknown>): Record<string, unknown> {
  const out = { ...data };
  for (const key of CLAIM_SECTIONS) {
    if (out[key] == null) out[key] = {};
  }
  if (out.other_insurance_details === undefined) out.other_insurance_details = null;
  return out;
}

type ClaimInput = FetchedFileResult | FetchedFileResult[];

export class ClaimFormExtractor {
  private aiService = AIService.getInstance();
  private mistralOcr = MistralOcrService.getInstance();
  private obs = ObserverService.getInstance();

  async extract(inputData: ClaimInput): Promise<ClaimExtractionResult> {
    const file = Array.isArray(inputData) ? inputData[0] : inputData;
    if (!file) {
      throw new UnrecoverableDocumentError('UNREADABLE_DOCUMENT', 'No file source for claim form.');
    }

    initClaimDebugDump(getJobId());

    if (!this.mistralOcr.isEnabled()) {
      throw new UnrecoverableDocumentError(
        'SERVICE_UNAVAILABLE',
        'Mistral OCR is not configured. Set MISTRAL_API_KEY.',
      );
    }

    const classifySlice = await this.buildClassifyInput(file);
    let classify;
    try {
      classify = await this.runClassify(classifySlice.input);
    } finally {
      await classifySlice.dispose();
    }

    if (classify.insurer === 'unknown') {
      throw new UnrecoverableDocumentError(
        'WRONG_DOCUMENT_TYPE',
        `Unknown insurer: ${classify.insurer}`,
      );
    }

    const templateVersion = normalizeTemplateVersion(classify.template_version);
    const formLanguage = classify.form_language === 'unknown' ? 'english' : classify.form_language;

    const ocrResult = await this.mistralOcr.processDocument({
      sourceUrl: file.sourceUrl || undefined,
      localFilePath: file.localFilePath ?? file.localPdfPath,
      mimeType: file.fileData?.mimeType,
    });

    await dumpStage('mistral_raw', summarizeMistralPages(ocrResult.pages));

    const rawPairs = mistralPagesToRawPairs(ocrResult.pages, formLanguage);

    const cleanedMarkdown = pagesToCleanedMarkdown(ocrResult.pages);
    if (!cleanedMarkdown.trim()) {
      throw new UnrecoverableDocumentError(
        'UNREADABLE_DOCUMENT',
        'Mistral OCR returned no readable text.',
      );
    }
    await dumpStage('cleaned_markdown', cleanedMarkdown);

    const fieldHints = mergeFieldHints(rawPairs, cleanedMarkdown);
    const hintsText = fieldHintsToText(fieldHints);
    await dumpStage('mistral_pairs', { count: rawPairs.length, pairs: rawPairs, fieldHints });

    const mapPrompt = buildClaimMapPrompt(classify.insurer, templateVersion, cleanedMarkdown, hintsText);
    await dumpStage('gemini_prompt_preview', {
      insurer: classify.insurer,
      templateVersion,
      promptHead: mapPrompt.slice(0, 500),
      promptLength: mapPrompt.length,
    });

    let geminiRaw = await this.runMap(mapPrompt);
    await dumpStage('gemini_raw_json', geminiRaw);

    let validated = this.validateGemini(geminiRaw);
    if (!validated.ok) {
      const retryPrompt = buildClaimMapRetryPrompt(mapPrompt, validated.errors);
      geminiRaw = await this.runMap(retryPrompt);
      await dumpStage('gemini_raw_json', { retry: true, ...geminiRaw });
      validated = this.validateGemini(geminiRaw);
      if (!validated.ok) {
        throw new UnrecoverableDocumentError(
          'SCHEMA_VALIDATION_FAILED',
          validated.errors,
        );
      }
    }

    await dumpStage('gemini_validated', validated.data);

    const withMeta = {
      ...validated.data,
      meta: {
        ...(validated.data.meta as object ?? {}),
        source_insurer: classify.insurer,
        source_template_version: templateVersion,
        form_language: formLanguage,
      },
    };

    const backfilled = backfillClaimFromHints(withMeta, fieldHints, rawPairs);
    const { result: postprocessed, diff } = postprocessClaimForm(backfilled);
    await dumpStage('postprocess_diff', diff);

    const fieldConfidence = computeFieldConfidence(ocrResult.pages);
    const crossFlags = validateCrossFields(postprocessed);
    const lowConfFlags = fieldConfidence
      .filter((f) => f.flaggedForReview)
      .map((f) => ({ path: f.path, reason: 'Low OCR confidence', confidence: f.confidence }));

    const flaggedFields = [...crossFlags, ...lowConfFlags];
    const confidenceScore = computeOverallConfidence(fieldConfidence);
    const requiresHumanReview = flaggedFields.length > 0 || confidenceScore < 0.6;

    const display = flattenClaimForDisplay(postprocessed);

    const finalResult: ClaimExtractionResult = {
      ...(postprocessed as ClaimExtractionResult),
      display,
      confidenceScore,
      requiresHumanReview,
      lowConfidenceFields: fieldConfidence.filter((f) => f.flaggedForReview).map((f) => f.path),
      status: requiresHumanReview ? 'needs_review' : 'completed',
      meta: {
        ...(postprocessed.meta as object ?? {}),
        source_insurer: classify.insurer,
        source_template_version: templateVersion,
        form_language: formLanguage,
        extraction_confidence: confidenceScore,
      },
      extractionMeta: {
        ocrEngine: 'mistral',
        ocrModel: ocrResult.model,
        ocrRoute: 'mistral',
        pageCount: ocrResult.pageCount,
        ocrPairCount: rawPairs.length,
        averageOcrConfidence: ocrResult.averageConfidence,
        lowConfidenceWordCount: ocrResult.lowConfidenceWordCount,
        rawPairs,
        rawExtractions: [
          { sourceModel: 'mistral_ocr', rawJson: ocrResult, createdAt: new Date().toISOString() },
          { sourceModel: 'gemini', rawJson: geminiRaw, createdAt: new Date().toISOString() },
        ],
        flaggedFields,
        fieldConfidence,
        pipelineStatus: requiresHumanReview ? 'needs_review' : 'completed',
        postprocessDiff: diff,
        display,
        fieldHints,
        debugStages: getClaimDebugStages(),
        cleanedMarkdown: _config.CLAIM_DEBUG_DUMP ? cleanedMarkdown : undefined,
        geminiRaw: _config.CLAIM_DEBUG_DUMP ? geminiRaw : undefined,
      },
    };

    await dumpStage('final', {
      status: finalResult.status,
      confidenceScore,
      flaggedCount: flaggedFields.length,
      policyNo: finalResult.policy_details?.policy_no,
    });

    this.obs.info('ClaimFormExtractor: complete', {
      insurer: classify.insurer,
      status: finalResult.status,
      confidenceScore,
    });

    return finalResult;
  }

  private async buildClassifyInput(file: FetchedFileResult) {
    const slice = await buildSliceInput(file, [1], 'claim-classify');
    return slice;
  }

  private async runClassify(input: unknown) {
    const raw = await this.aiService.processDocument(
      input,
      CLAIM_CLASSIFY_PROMPT,
      getClaimClassifySchema(),
      512,
      _config.CLAIM_CLASSIFY_AI_MODEL,
      1,
      'CLAIM_CLASSIFY',
      'extraction',
    );
    const parsed = typeof raw === 'string' ? JsonUtil.cleanAndParse(raw) : raw;
    const result = ClaimClassifySchema.safeParse(parsed);
    if (!result.success) {
      throw new UnrecoverableDocumentError('WRONG_DOCUMENT_TYPE', 'Could not classify claim form.');
    }
    await dumpStage('classify_out', result.data);
    return result.data;
  }

  private async runMap(prompt: string): Promise<Record<string, unknown>> {
    const raw = await this.aiService.processDocument(
      null,
      prompt,
      undefined,
      _config.CLAIM_MAX_OUTPUT_TOKENS,
      _config.CLAIM_AI_MODEL,
      _config.CLAIM_MAX_GEMINI_RETRIES,
      'CLAIM',
      'extraction',
    );
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
      return raw as Record<string, unknown>;
    }
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
    return JsonUtil.cleanAndParse(text) as Record<string, unknown>;
  }

  private validateGemini(data: Record<string, unknown>): { ok: true; data: Record<string, unknown> } | { ok: false; errors: string } {
    const filled = fillMissingClaimSections(data);
    const result = CanonicalClaimSchema.safeParse(filled);
    if (result.success) {
      return { ok: true, data: result.data as Record<string, unknown> };
    }
    return { ok: false, errors: JSON.stringify(result.error.flatten(), null, 2) };
  }
}
