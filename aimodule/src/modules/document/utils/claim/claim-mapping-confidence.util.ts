import type { PairMapping } from './claim-alias-mapper.util.js';
import { IDENTITY_FIELDS } from './claim-field-validators.util.js';

const IDENTITY_WEIGHT = 0.4;
const FILL_RATE_WEIGHT = 0.3;
const VALIDATOR_WEIGHT = 0.2;
const UNMAPPED_WEIGHT = 0.1;

const TRACKED_FIELDS = [
  ...IDENTITY_FIELDS,
  'insuredName',
  'engineNo',
  'chassisNo',
  'driverName',
  'drivingLicenseNo',
  'accidentDescription',
  'damageDescription',
  'insurancePeriodStart',
  'insurancePeriodEnd',
  'timeOfLoss',
  'placeOfAccident',
  'estimatedRepairCost',
  'idv',
];

function isFilled(val: unknown): boolean {
  return val != null && val !== '' && val !== 'null';
}

export interface ConfidenceInput {
  mapped: Record<string, unknown>;
  pairMappings: PairMapping[];
  validatorFailedFields: string[];
  totalPairs: number;
  averageOcrConfidence?: number | null;
  lowConfidenceWordCount?: number;
}

export interface ConfidenceResult {
  confidenceScore: number;
  requiresHumanReview: boolean;
  lowConfidenceFields: string[];
}

export function computeMappingConfidence(input: ConfidenceInput): ConfidenceResult {
  const {
    mapped,
    pairMappings,
    validatorFailedFields,
    totalPairs,
    averageOcrConfidence,
    lowConfidenceWordCount,
  } = input;

  const identityFilled =
    IDENTITY_FIELDS.filter((f) => isFilled(mapped[f])).length / IDENTITY_FIELDS.length;

  const fillRate =
    TRACKED_FIELDS.filter((f) => isFilled(mapped[f])).length / TRACKED_FIELDS.length;

  const validatorPassRate =
    validatorFailedFields.length === 0
      ? 1
      : Math.max(0, 1 - validatorFailedFields.length / Math.max(IDENTITY_FIELDS.length, 1));

  const unmappedCount = pairMappings.filter((m) => m.canonicalField == null).length;
  const unmappedScore = totalPairs > 0 ? 1 - unmappedCount / totalPairs : 1;

  const confidenceScore = Math.min(
    1,
    Math.max(
      0,
      identityFilled * IDENTITY_WEIGHT +
        fillRate * FILL_RATE_WEIGHT +
        validatorPassRate * VALIDATOR_WEIGHT +
        unmappedScore * UNMAPPED_WEIGHT,
    ),
  );

  const lowConfidenceFields = new Set<string>(validatorFailedFields);
  for (const field of IDENTITY_FIELDS) {
    if (!isFilled(mapped[field])) lowConfidenceFields.add(field);
  }
  for (const m of pairMappings) {
    if (m.canonicalField && m.confidence < 0.85 && m.confidence > 0) {
      lowConfidenceFields.add(m.canonicalField);
    }
  }

  const requiresHumanReview =
    validatorFailedFields.some((f) => (IDENTITY_FIELDS as readonly string[]).includes(f)) ||
    confidenceScore < 0.7 ||
    IDENTITY_FIELDS.filter((f) => !isFilled(mapped[f])).length >= 2 ||
    (lowConfidenceWordCount != null && lowConfidenceWordCount > 5) ||
    (averageOcrConfidence != null && averageOcrConfidence < 0.65);

  if (lowConfidenceWordCount != null && lowConfidenceWordCount > 0) {
    lowConfidenceFields.add('accidentDescription');
  }
  if (averageOcrConfidence != null && averageOcrConfidence < 0.7) {
    for (const field of IDENTITY_FIELDS) {
      if (!isFilled(mapped[field])) lowConfidenceFields.add(field);
    }
  }

  return {
    confidenceScore: Math.round(confidenceScore * 100) / 100,
    requiresHumanReview,
    lowConfidenceFields: [...lowConfidenceFields],
  };
}
