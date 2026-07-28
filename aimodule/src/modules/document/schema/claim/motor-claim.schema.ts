import { Schema, Type } from '@google/genai';
import { z } from 'zod';
import { ExtraFieldSchema } from '../workshop/workshop-bill.shared.js';

export type ClaimFormVariant = 'standard' | 'one_page' | 'combined';

// ============================================================================
// 1. GEMINI SDK SCHEMA (@google/genai)
// ============================================================================

const str = (): Schema => ({ type: Type.STRING, nullable: true });
const num = (): Schema => ({ type: Type.NUMBER, nullable: true });
const bool = (): Schema => ({ type: Type.BOOLEAN, nullable: true });

const claimDocumentGateProps: Record<string, Schema> = {
  isCorrectDocumentType: { type: Type.BOOLEAN },
  detectedDocumentType: str(),
  hasAllPagesCorrectType: { type: Type.BOOLEAN },
  invalidPageIndices: {
    type: Type.ARRAY,
    nullable: true,
    items: { type: Type.NUMBER },
  },
  confidenceScore: { type: Type.NUMBER },
  requiresHumanReview: { type: Type.BOOLEAN },
  humanReviewFields: {
    type: Type.ARRAY,
    nullable: true,
    items: { type: Type.STRING },
  },
};

const claimGateRequired = [
  'isCorrectDocumentType',
  'detectedDocumentType',
  'hasAllPagesCorrectType',
  'confidenceScore',
  'requiresHumanReview',
];

const claimSpecFields: Record<string, Schema> = {
  sourceTemplate: {
    ...str(),
    description: 'Detected insurer template: UIIC | OIC | NIAC | NIC',
  },
  formVariant: {
    ...str(),
    description: 'Form layout: standard | one_page | combined',
  },
  insurerName: str(),
  policyNumber: str(),
  claimNumber: str(),
  divisionalOrBranchOffice: str(),
  policyStartDate: str(),
  policyEndDate: str(),

  insuredName: str(),
  insuredAddress: str(),
  insuredMobile: str(),
  insuredEmail: str(),
  insuredPanOrGstin: str(),
  bankAccountNumber: str(),
  bankIfscCode: str(),

  registrationNo: str(),
  makeAndModel: str(),
  engineNo: str(),
  chassisNo: str(),
  yearOfManufacture: str(),
  cubicCapacityOrCarryingCapacity: str(),

  permitNumber: str(),
  permitType: str(),
  permitValidUpto: str(),
  fitnessValidUpto: str(),

  accidentDate: str(),
  accidentTime: str(),
  accidentLocation: str(),
  vehicleSpeedKmph: num(),
  typeOfLoss: str(),
  accidentDescription: {
    ...str(),
    description: 'Section 5(d) accident narrative ONLY. Hindi verbatim if handwritten in Hindi. NOT workshop address.',
  },

  driverName: str(),
  driverAge: num(),
  driverAddress: str(),
  driverRelationshipToInsured: str(),
  drivingLicenseNo: str(),
  licenseIssuingAuthority: str(),
  licenseExpiryDate: str(),
  licenseType: str(),
  driverDateOfBirth: str(),

  damageDescription: {
    ...str(),
    description: 'Section 6(a) damage details e.g. As per Estimate. NOT inspection location.',
  },
  estimatedRepairCost: num(),
  idv: num(),
  inspectionWorkshopDetails: {
    ...str(),
    description: 'Section 6(c) where/when vehicle can be inspected. Workshop name/address.',
  },

  policeReportLodged: bool(),
  firOrGdNumber: str(),
  policeStationName: str(),
  thirdPartyInjuryOrDamage: bool(),

  declarationDate: str(),
  declarationPlace: str(),
  hasInsuredSignature: bool(),

  extraFields: {
    type: Type.ARRAY,
    nullable: true,
    description: 'Unmapped printed labels with handwritten values',
    items: {
      type: Type.OBJECT,
      properties: {
        key: { type: Type.STRING },
        value: { type: Type.STRING, nullable: true },
      },
    },
  },
};

export const ClaimSinglePassGeminiSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    ...claimDocumentGateProps,
    ...claimSpecFields,
  },
  required: claimGateRequired,
};

export const InsuranceClaimGeminiSchema = ClaimSinglePassGeminiSchema;

// ============================================================================
// 2. ZOD VALIDATOR SCHEMA
// ============================================================================

const numericPreprocess = z.preprocess((val: unknown) => {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[^0-9.-]+/g, '');
    const parsed = parseFloat(cleaned);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}, z.number().nullable());

const booleanPreprocess = z.preprocess((val: unknown) => {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    const normalized = val.trim().toLowerCase();
    if (['true', 'yes', 'y', '1', 'हाँ', 'हा'].includes(normalized)) return true;
    if (['false', 'no', 'n', '0', 'ना', 'नहीं'].includes(normalized)) return false;
  }
  return null;
}, z.boolean().nullable());

const claimDataShape = {
  insurerName: z.string().nullable().optional(),
  policyNumber: z.string().nullable().optional(),
  claimNumber: z.string().nullable().optional(),
  divisionalOrBranchOffice: z.string().nullable().optional(),
  policyStartDate: z.string().nullable().optional(),
  policyEndDate: z.string().nullable().optional(),

  insuredName: z.string().nullable().optional(),
  insuredAddress: z.string().nullable().optional(),
  insuredMobile: z.string().nullable().optional(),
  insuredEmail: z.string().nullable().optional(),
  insuredPanOrGstin: z.string().nullable().optional(),
  bankAccountNumber: z.string().nullable().optional(),
  bankIfscCode: z.string().nullable().optional(),

  registrationNo: z.string().nullable().optional(),
  makeAndModel: z.string().nullable().optional(),
  engineNo: z.string().nullable().optional(),
  chassisNo: z.string().nullable().optional(),
  yearOfManufacture: z.string().nullable().optional(),
  cubicCapacityOrCarryingCapacity: z.string().nullable().optional(),

  permitNumber: z.string().nullable().optional(),
  permitType: z.string().nullable().optional(),
  permitValidUpto: z.string().nullable().optional(),
  fitnessValidUpto: z.string().nullable().optional(),

  accidentDate: z.string().nullable().optional(),
  accidentTime: z.string().nullable().optional(),
  accidentLocation: z.string().nullable().optional(),
  vehicleSpeedKmph: numericPreprocess.optional(),
  typeOfLoss: z.string().nullable().optional(),
  accidentDescription: z.string().nullable().optional(),

  driverName: z.string().nullable().optional(),
  driverAge: numericPreprocess.optional(),
  driverAddress: z.string().nullable().optional(),
  driverRelationshipToInsured: z.string().nullable().optional(),
  drivingLicenseNo: z.string().nullable().optional(),
  licenseIssuingAuthority: z.string().nullable().optional(),
  licenseExpiryDate: z.string().nullable().optional(),
  licenseType: z.string().nullable().optional(),
  driverDateOfBirth: z.string().nullable().optional(),

  damageDescription: z.string().nullable().optional(),
  estimatedRepairCost: numericPreprocess.optional(),
  idv: numericPreprocess.optional(),
  inspectionWorkshopDetails: z.string().nullable().optional(),

  policeReportLodged: booleanPreprocess.optional(),
  firOrGdNumber: z.string().nullable().optional(),
  policeStationName: z.string().nullable().optional(),
  thirdPartyInjuryOrDamage: booleanPreprocess.optional(),

  declarationDate: z.string().nullable().optional(),
  declarationPlace: z.string().nullable().optional(),
  hasInsuredSignature: booleanPreprocess.optional(),
};

export const InsuranceClaimDataSchema = z.object(claimDataShape);

export const ClaimAdditionalDataSchema = z.object({
  isCorrectDocumentType: z.boolean().optional(),
  detectedDocumentType: z.string().nullable().optional(),
  hasAllPagesCorrectType: z.boolean().optional(),
  invalidPageIndices: z.array(z.number()).nullable().optional(),
  confidenceScore: z.number(),
  requiresHumanReview: z.boolean(),
  humanReviewFields: z.array(z.string()).nullable().optional(),
  sourceTemplate: z.string().nullable().optional(),
  formVariant: z.enum(['standard', 'one_page', 'combined']).nullable().optional(),
  pageCount: z.number().optional(),
  model: z.string().optional(),
  lowConfidenceFields: z.array(z.string()).nullable().optional(),
});

export const ExtractedPdfDataSchema = z.object({
  rawGemini: z.unknown(),
  pageCount: z.number(),
});

/** Full Gemini parse (gates + data inline). Used internally before assembleClaimResult. */
export const InsuranceClaimSchema = z.object({
  isCorrectDocumentType: z.boolean().optional(),
  detectedDocumentType: z.string().nullable().optional(),
  hasAllPagesCorrectType: z.boolean().optional(),
  invalidPageIndices: z.array(z.number()).nullable().optional(),
  confidenceScore: z.number(),
  requiresHumanReview: z.boolean(),
  humanReviewFields: z.array(z.string()).nullable().optional(),
  sourceTemplate: z.string().nullable().optional(),
  formVariant: z.enum(['standard', 'one_page', 'combined']).nullable().optional(),
  extraFields: z.array(ExtraFieldSchema).nullable().optional(),
  ...claimDataShape,
});

export const InsuranceClaimResultSchema = InsuranceClaimDataSchema.extend({
  extraFields: z.array(ExtraFieldSchema).nullable().optional(),
  hindiFields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  additionalData: ClaimAdditionalDataSchema,
  extractedPdfData: ExtractedPdfDataSchema,
});

export type ClaimTemplateId = 'UIIC' | 'OIC' | 'NIAC' | 'NIC';
export type ClaimDataKey = keyof IInsuranceClaimData;

export type IInsuranceClaimData = z.infer<typeof InsuranceClaimDataSchema>;
export type IClaimAdditionalData = z.infer<typeof ClaimAdditionalDataSchema>;
export type IInsuranceClaimSchema = z.infer<typeof InsuranceClaimSchema>;
export type IInsuranceClaimResult = z.infer<typeof InsuranceClaimResultSchema>;

export const CLAIM_META_KEYS = [
  'isCorrectDocumentType',
  'detectedDocumentType',
  'hasAllPagesCorrectType',
  'invalidPageIndices',
  'confidenceScore',
  'requiresHumanReview',
  'humanReviewFields',
  'sourceTemplate',
  'formVariant',
  'lowConfidenceFields',
] as const;

/** Stripped from flat parse before claim data validation */
export const CLAIM_PARSE_STRIP_KEYS = [...CLAIM_META_KEYS, 'extraFields'] as const;
