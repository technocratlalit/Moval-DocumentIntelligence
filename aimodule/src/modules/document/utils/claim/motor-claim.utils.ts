import {
  CLAIM_META_KEYS,
  CLAIM_PARSE_STRIP_KEYS,
  InsuranceClaimDataSchema,
  InsuranceClaimResultSchema,
  type IClaimAdditionalData,
  type IInsuranceClaimData,
  type IInsuranceClaimResult,
  type IInsuranceClaimSchema,
} from '../../schema/claim/motor-claim.schema.js';
import { buildTemplateLabelFields, hasAntiSwapLayout } from './motor-claim-template-registry.js';

const NIL_RE = /^(na|n\/a|nil|none|-|—|no)$/i;
const WORKSHOP_LOCATION_RE = /\b(JUNCTION|RLY|RAILWAY|STATION|NEAR|WORKSHOP)\b/i;
const JH_HO_OCR_RE = /^([A-Z]{2})-HO-([A-Z]{1,2})\/(\d+)$/;

function cleanNilString(val: string | null | undefined): string | null {
  if (val == null) return null;
  const t = val.trim();
  if (!t || NIL_RE.test(t)) return null;
  return t;
}

function walkStrings(obj: unknown, fn: (s: string) => string | null): unknown {
  if (obj == null) return obj;
  if (typeof obj === 'string') return fn(obj);
  if (Array.isArray(obj)) return obj.map((v) => walkStrings(v, fn));
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = walkStrings(v, fn);
    }
    return out;
  }
  return obj;
}

function isBlank(val: unknown): boolean {
  return val == null || (typeof val === 'string' && val.trim() === '');
}

function isInvalidLicenseExpiry(val: string): boolean {
  if (/\d{1,2}\/\d{1,2}\/\d{2,4}\s+\S/.test(val)) return true;
  const parts = val.trim().split(/\s+/);
  return parts.length > 1 && /\d{4}/.test(val);
}

function applyOcrNormalizers(out: Record<string, unknown>): void {
  if (out.insuredMobile && typeof out.insuredMobile === 'string') {
    const digits = out.insuredMobile.replace(/\D/g, '');
    if (digits.length >= 10) out.insuredMobile = digits;
  }

  if (out.registrationNo && typeof out.registrationNo === 'string') {
    const reg = out.registrationNo.toUpperCase().replace(/\s+/g, '');
    out.registrationNo = reg.replace(JH_HO_OCR_RE, '$1-10-$2/$3');
  }

  if (out.damageDescription && typeof out.damageDescription === 'string') {
    if (/per\s*est/i.test(out.damageDescription)) {
      out.damageDescription = 'As per Estimate';
    }
  }
}

/** UIIC/OIC field-swap repair + review flags. ponytail: heuristic only; prompt is primary fix. */
export function repairClaimFieldMapping(
  out: Record<string, unknown>,
  sourceTemplate?: string | null,
): string[] {
  if (!hasAntiSwapLayout(sourceTemplate)) return [];
  const review: string[] = [];

  const damage = out.damageDescription as string | null | undefined;
  const inspection = out.inspectionWorkshopDetails as string | null | undefined;
  if (damage && WORKSHOP_LOCATION_RE.test(damage) && isBlank(inspection)) {
    out.inspectionWorkshopDetails = damage;
    out.damageDescription = null;
  }

  const expiry = out.licenseExpiryDate as string | null | undefined;
  if (expiry && isInvalidLicenseExpiry(expiry)) {
    out.licenseExpiryDate = null;
    review.push('licenseExpiryDate');
  }

  if (out.drivingLicenseNo && typeof out.drivingLicenseNo === 'string') {
    out.drivingLicenseNo = out.drivingLicenseNo.replace(/\s+/g, '');
  }

  if (!isBlank(out.accidentDate) && isBlank(out.accidentDescription)) {
    review.push('accidentDescription');
  }

  return review;
}

export function normalizeMotorClaimFields(raw: Record<string, unknown>): Record<string, unknown> {
  const out = walkStrings(JSON.parse(JSON.stringify(raw)), cleanNilString) as Record<string, unknown>;

  if (out.registrationNo && typeof out.registrationNo === 'string') {
    out.registrationNo = out.registrationNo.toUpperCase().replace(/\s+/g, '');
  }

  applyOcrNormalizers(out);

  const reviewFields = repairClaimFieldMapping(out, out.sourceTemplate as string | null | undefined);
  if (reviewFields.length) {
    out.requiresHumanReview = true;
    const existing = Array.isArray(out.humanReviewFields)
      ? (out.humanReviewFields as string[])
      : [];
    out.humanReviewFields = [...new Set([...existing, ...reviewFields])];
  }

  if (out.confidenceScore == null) out.confidenceScore = 0.75;
  if (out.requiresHumanReview == null) out.requiresHumanReview = false;
  if (out.isCorrectDocumentType == null) out.isCorrectDocumentType = true;
  if (out.hasAllPagesCorrectType == null) out.hasAllPagesCorrectType = true;

  return out;
}

export function mergeClaimConfidence(fields: {
  confidenceScore?: number;
  requiresHumanReview?: boolean;
  humanReviewFields?: string[] | null;
}): Pick<IClaimAdditionalData, 'confidenceScore' | 'requiresHumanReview' | 'humanReviewFields'> {
  const humanReviewFields = fields.humanReviewFields ?? [];
  const needsReview =
    fields.requiresHumanReview === true ||
    humanReviewFields.length > 0 ||
    (fields.confidenceScore ?? 1) < 0.75;

  return {
    confidenceScore: fields.confidenceScore ?? 0.75,
    requiresHumanReview: needsReview,
    humanReviewFields: humanReviewFields.length ? humanReviewFields : null,
  };
}

function pickMeta(parsed: Record<string, unknown>): IClaimAdditionalData {
  const meta: Record<string, unknown> = {};
  for (const key of CLAIM_META_KEYS) {
    if (key in parsed) meta[key] = parsed[key];
  }
  return meta as IClaimAdditionalData;
}

function stripMeta(parsed: Record<string, unknown>): IInsuranceClaimData {
  const data = { ...parsed };
  for (const key of CLAIM_PARSE_STRIP_KEYS) {
    delete data[key];
  }
  return InsuranceClaimDataSchema.parse(data);
}

function dedupeExtraFields(
  data: IInsuranceClaimData,
  extraFields: Array<{ key: string; value: string | null }> | null | undefined,
): Array<{ key: string; value: string | null }> | null {
  if (!extraFields?.length) return null;

  const canonicalValues = new Set(
    Object.values(data)
      .filter((v) => v != null && typeof v !== 'object')
      .map((v) => String(v).trim().toLowerCase())
      .filter(Boolean),
  );

  const out = extraFields.filter((ef) => {
    const val = ef.value?.trim().toLowerCase();
    if (!val) return false;
    return !canonicalValues.has(val);
  });

  return out.length ? out : null;
}

export function assembleClaimResult(
  rawGemini: unknown,
  parsed: IInsuranceClaimSchema & { lowConfidenceFields?: string[] | null },
  pageCount: number,
  model: string,
): IInsuranceClaimResult {
  const flat = parsed as Record<string, unknown>;
  const additionalData: IClaimAdditionalData = {
    ...pickMeta(flat),
    pageCount,
    model,
    ...(flat.lowConfidenceFields != null
      ? { lowConfidenceFields: flat.lowConfidenceFields as string[] | null }
      : {}),
  };

  const data = stripMeta(flat);
  const extraFields = dedupeExtraFields(
    data,
    flat.extraFields as Array<{ key: string; value: string | null }> | null | undefined,
  );
  const hindiFields = buildTemplateLabelFields(
    data,
    additionalData.sourceTemplate,
    additionalData.formVariant,
  );

  return InsuranceClaimResultSchema.parse({
    ...data,
    extraFields,
    hindiFields,
    additionalData,
    extractedPdfData: { rawGemini, pageCount },
  });
}

// ponytail: self-check — assemble strips meta from top level
if (process.env.NODE_ENV !== 'production') {
  const sample = assembleClaimResult(
    { policyNumber: 'X' },
    {
      policyNumber: 'X',
      confidenceScore: 0.9,
      requiresHumanReview: false,
      sourceTemplate: 'UIIC',
    },
    1,
    'test',
  );
  if ('confidenceScore' in sample || sample.hindiFields['पॉलिसी संख्या'] !== 'X') {
    throw new Error('assembleClaimResult self-check failed');
  }
}
