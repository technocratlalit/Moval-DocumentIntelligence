/**
 * Strict Gemini schema — spec fields only (no premium line-item arrays).
 * Keeps output small for flash-lite single-pass (~₹0.5–₹1 per policy).
 */
import { Schema, Type } from '@google/genai';

const str = (): Schema => ({ type: Type.STRING, nullable: true });
const num = (): Schema => ({ type: Type.NUMBER, nullable: true });

const addOnCoverItem: Schema = {
  type: Type.OBJECT,
  properties: {
    name: str(),
    opted: { type: Type.BOOLEAN, nullable: true },
  },
};

const documentGateProps: Record<string, Schema> = {
  isCorrectDocumentType: { type: Type.BOOLEAN },
  detectedDocumentType: str(),
  hasAllPagesCorrectType: {
    type: Type.BOOLEAN,
    description:
      'True when every page belongs to the same policy package — schedule plus dealer brochure ' +
      'or info pages from the same policy are valid.',
  },
  invalidPageIndices: {
    type: Type.ARRAY,
    nullable: true,
    description:
      '1-indexed pages that are truly unrelated (RC, DL, workshop bill, different policy). ' +
      'Do NOT list dealer Must to Know / detachable brochure pages from the same policy.',
    items: { type: Type.NUMBER },
  },
  confidenceScore: { type: Type.NUMBER },
  requiresHumanReview: { type: Type.BOOLEAN },
};

const gateRequired = [
  'isCorrectDocumentType',
  'detectedDocumentType',
  'hasAllPagesCorrectType',
  'confidenceScore',
  'requiresHumanReview',
];

/** Strict spec — matches product field list only */
const strictSpecFields: Record<string, Schema> = {
  policyNumber: str(),
  insurerName: str(),
  insuredName: str(),
  insuredAddress: str(),
  registrationNo: str(),
  policyType: str(),
  totalIdv: num(),
  policyStartDate: str(),
  policyEndDate: str(),
  ncbPercentage: num(),
  grossPremiumPaid: num(),
  engineNo: str(),
  chassisNo: str(),
  vehicleMake: {
    ...str(),
    description: 'Vehicle make from Motor Vehicle Details / Particulars of Vehicle table.',
  },
  vehicleModel: {
    ...str(),
    description: 'Vehicle model and variant from schedule table.',
  },
  financierName: {
    ...str(),
    description: 'Financier / hypothecation bank name. null when Not Financed / N/A / NIL.',
  },
  geographicalArea: {
    ...str(),
    description: 'Geographical area e.g. India, INDIA.',
  },
  tpLiabilityLimit: {
    ...num(),
    description: 'Third-party property damage limit in rupees (e.g. 750000). null for stand-alone OD.',
  },
  paCoverAmount: {
    ...num(),
    description: 'Compulsory PA / owner-driver sum insured in rupees (e.g. 1500000). null if absent.',
  },
  engineProtectOpted: {
    type: Type.BOOLEAN,
    nullable: true,
    description: 'true if Engine Protect add-on is opted; false if absent.',
  },
  consumablesCoverOpted: {
    type: Type.BOOLEAN,
    nullable: true,
    description: 'true if Consumables add-on is opted; false if absent.',
  },
  nomineeName: str(),
  registrationAuthority: str(),
};

export const PolicySinglePassGeminiSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    ...documentGateProps,
    ...strictSpecFields,
    addOnCovers: { type: Type.ARRAY, nullable: true, items: addOnCoverItem },
  },
  required: gateRequired,
};

/** @deprecated Multipass disabled — kept for type compatibility */
export const PolicyGateGeminiSchema = PolicySinglePassGeminiSchema;
export const PolicyDataGeminiSchema = PolicySinglePassGeminiSchema;
export const PolicyPremiumGeminiSchema = PolicySinglePassGeminiSchema;
export const InsurancePolicyGeminiSchema = PolicySinglePassGeminiSchema;
export const PolicyMetaGeminiSchema = PolicySinglePassGeminiSchema;
