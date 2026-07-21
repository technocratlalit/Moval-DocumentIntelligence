import { z } from 'zod';

const numericPreprocess = z.preprocess((val: unknown) => {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[^0-9.-]+/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }
  return null;
}, z.number().nullable());

const boolPreprocess = z.preprocess((val: unknown) => {
  if (typeof val === 'boolean') return val;
  if (val == null) return null;
  const s = String(val).trim().toLowerCase();
  if (['yes', 'y', 'true', '1'].includes(s)) return true;
  if (['no', 'n', 'false', '0'].includes(s)) return false;
  return null;
}, z.boolean().nullable());

export const ClaimFormSchema = z.object({
  // Document type gate
  isCorrectDocumentType: z.boolean().optional(),
  detectedDocumentType: z.string().nullable().optional(),
  hasAllPagesCorrectType: z.boolean().optional(),
  invalidPageIndices: z.array(z.number()).nullable().optional(),

  // Form identity
  insurerCode: z.string().nullable().optional(),
  insurerName: z.string().nullable().optional(),
  templateVersion: z.string().nullable().optional(),

  // Policy / claim header
  policyNo: z.string().nullable().optional(),
  claimNo: z.string().nullable().optional(),
  coverNoteNo: z.string().nullable().optional(),
  dateOfIntimation: z.string().nullable().optional(),
  insurancePeriodStart: z.string().nullable().optional(),
  insurancePeriodEnd: z.string().nullable().optional(),

  // Insured
  insuredName: z.string().nullable().optional(),
  insuredNameNative: z.string().nullable().optional(),
  insuredAddress: z.string().nullable().optional(),
  insuredAddressNative: z.string().nullable().optional(),
  pinCode: z.string().nullable().optional(),
  mobileNo: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  panNo: z.string().nullable().optional(),
  bankAccountHolder: z.string().nullable().optional(),
  bankAccountNo: z.string().nullable().optional(),
  bankIfscCode: z.string().nullable().optional(),

  // Vehicle
  registrationNo: z.string().nullable().optional(),
  vehicleMake: z.string().nullable().optional(),
  vehicleYear: z.string().nullable().optional(),
  engineNo: z.string().nullable().optional(),
  chassisNo: z.string().nullable().optional(),
  vehicleClass: z.string().nullable().optional(),
  cubicCapacity: z.string().nullable().optional(),

  // Loss / accident
  dateOfLoss: z.string().nullable().optional(),
  timeOfLoss: z.string().nullable().optional(),
  placeOfAccident: z.string().nullable().optional(),
  natureOfLoss: z.string().nullable().optional(),
  accidentDescription: z.string().nullable().optional(),
  accidentDescriptionEnglish: z.string().nullable().optional(),
  vehicleSpeedAtAccident: z.string().nullable().optional(),
  estimatedRepairCost: numericPreprocess,
  idv: numericPreprocess,
  inspectionLocation: z.string().nullable().optional(),
  damageDescription: z.string().nullable().optional(),

  // Driver
  driverName: z.string().nullable().optional(),
  driverAgeOrDob: z.string().nullable().optional(),
  driverAddress: z.string().nullable().optional(),
  driverRelationship: z.string().nullable().optional(),
  drivingLicenseNo: z.string().nullable().optional(),
  licenseIssuingAuthority: z.string().nullable().optional(),
  licenseExpiryDate: z.string().nullable().optional(),
  licenseClass: z.string().nullable().optional(),
  alcoholInfluence: boolPreprocess,

  // Police
  policeReportLodged: boolPreprocess,
  firNo: z.string().nullable().optional(),
  policeStationName: z.string().nullable().optional(),
  firDate: z.string().nullable().optional(),

  // Third party / witnesses
  thirdPartyInjury: boolPreprocess,
  thirdPartyDeath: boolPreprocess,
  thirdPartyPropertyDamage: boolPreprocess,
  thirdPartyDetails: z.string().nullable().optional(),
  witnessDetails: z.string().nullable().optional(),

  // Commercial vehicle
  commercialPermitNo: z.string().nullable().optional(),
  commercialFitnessCert: z.string().nullable().optional(),
  commercialLadenWeight: z.string().nullable().optional(),
  commercialSectionNotApplicable: boolPreprocess,

  // Declaration
  declarationDate: z.string().nullable().optional(),
  declarationPlace: z.string().nullable().optional(),
  signaturePresent: boolPreprocess,

  // Unmapped OCR pairs + extraction metadata
  extraFields: z.array(z.object({
    key: z.string(),
    value: z.string().nullable(),
    matchedCanonicalField: z.string().nullable().optional(),
    confidence: z.number().optional(),
    sourcePage: z.number().optional(),
    matchMethod: z.enum(['exact', 'fuzzy', 'section', 'gemini', 'none']).optional(),
  })).nullish(),
  extractionMeta: z.object({
    ocrPairCount: z.number().optional(),
    ocrEngine: z.literal('mistral').optional(),
    ocrModel: z.string().optional(),
    pageCount: z.number().optional(),
    averageOcrConfidence: z.number().optional(),
    lowConfidenceWordCount: z.number().optional(),
    templateVersion: z.string().optional(),
    ocrRoute: z.literal('mistral').optional(),
    aliasMappedCount: z.number().optional(),
    geminiFallbackUsed: z.boolean().optional(),
    unmappedPairCount: z.number().optional(),
    rawPairs: z.array(z.object({
      page: z.number(),
      key: z.string(),
      value: z.string().nullable(),
      section: z.string().optional(),
    })).optional(),
  }).nullish(),

  // Quality
  requiresHumanReview: z.boolean(),
  lowConfidenceFields: z.array(z.string()).nullish(),
  confidenceScore: z.number().catch(0),
});

export type IClaimFormSchema = z.infer<typeof ClaimFormSchema>;
