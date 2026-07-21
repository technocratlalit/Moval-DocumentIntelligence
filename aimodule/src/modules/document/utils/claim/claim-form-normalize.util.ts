import type { IClaimFormSchema } from '../../schema/claim/claim-form.schema.js';

const NULLISH = /^(no|n\/a|na|nil|none|not\s+applicable|-+|\.+)$/i;

const HIGH_RISK_FIELDS = [
  'policyNo',
  'engineNo',
  'chassisNo',
  'drivingLicenseNo',
  'estimatedRepairCost',
  'accidentDescription',
] as const;

function cleanString(val: unknown): string | null {
  if (val == null) return null;
  const s = String(val).trim();
  if (!s || NULLISH.test(s)) return null;
  return s;
}

function cleanAmount(val: unknown): number | null {
  if (val == null) return null;
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  const cleaned = String(val).replace(/[^0-9.-]+/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function cleanBool(val: unknown): boolean | null {
  if (typeof val === 'boolean') return val;
  if (val == null) return null;
  const s = String(val).trim().toLowerCase();
  if (['yes', 'y', 'true', '1'].includes(s)) return true;
  if (['no', 'n', 'false', '0'].includes(s)) return false;
  return null;
}

/** Normalize claim form fields after Gemini extraction. */
export function normalizeClaimForm(raw: Record<string, unknown>): IClaimFormSchema {
  const lowConfidence = new Set(
    Array.isArray(raw.lowConfidenceFields)
      ? raw.lowConfidenceFields.map(String)
      : [],
  );

  for (const field of HIGH_RISK_FIELDS) {
    lowConfidence.add(field);
  }

  const confidence = typeof raw.confidenceScore === 'number' ? raw.confidenceScore : 0;
  if (confidence < 0.75 && cleanString(raw.accidentDescription)) {
    lowConfidence.add('accidentDescription');
  }

  return {
    isCorrectDocumentType: Boolean(raw.isCorrectDocumentType),
    detectedDocumentType: cleanString(raw.detectedDocumentType),
    hasAllPagesCorrectType: raw.hasAllPagesCorrectType !== false,
    invalidPageIndices: Array.isArray(raw.invalidPageIndices)
      ? raw.invalidPageIndices.filter((n) => typeof n === 'number')
      : null,

    insurerCode: cleanString(raw.insurerCode),
    insurerName: cleanString(raw.insurerName),
    templateVersion: cleanString(raw.templateVersion),

    policyNo: cleanString(raw.policyNo),
    claimNo: cleanString(raw.claimNo),
    coverNoteNo: cleanString(raw.coverNoteNo),
    dateOfIntimation: cleanString(raw.dateOfIntimation),
    insurancePeriodStart: cleanString(raw.insurancePeriodStart),
    insurancePeriodEnd: cleanString(raw.insurancePeriodEnd),

    insuredName: cleanString(raw.insuredName),
    insuredNameNative: cleanString(raw.insuredNameNative),
    insuredAddress: cleanString(raw.insuredAddress),
    insuredAddressNative: cleanString(raw.insuredAddressNative),
    pinCode: cleanString(raw.pinCode),
    mobileNo: cleanString(raw.mobileNo),
    email: cleanString(raw.email),
    panNo: cleanString(raw.panNo),
    bankAccountHolder: cleanString(raw.bankAccountHolder),
    bankAccountNo: cleanString(raw.bankAccountNo),
    bankIfscCode: cleanString(raw.bankIfscCode),

    registrationNo: cleanString(raw.registrationNo),
    vehicleMake: cleanString(raw.vehicleMake),
    vehicleYear: cleanString(raw.vehicleYear),
    engineNo: cleanString(raw.engineNo),
    chassisNo: cleanString(raw.chassisNo),
    vehicleClass: cleanString(raw.vehicleClass),
    cubicCapacity: cleanString(raw.cubicCapacity),

    dateOfLoss: cleanString(raw.dateOfLoss),
    timeOfLoss: cleanString(raw.timeOfLoss),
    placeOfAccident: cleanString(raw.placeOfAccident),
    natureOfLoss: cleanString(raw.natureOfLoss),
    accidentDescription: cleanString(raw.accidentDescription),
    accidentDescriptionEnglish: cleanString(raw.accidentDescriptionEnglish),
    vehicleSpeedAtAccident: cleanString(raw.vehicleSpeedAtAccident),
    estimatedRepairCost: cleanAmount(raw.estimatedRepairCost ?? raw.estimatedLoss),
    idv: cleanAmount(raw.idv),
    inspectionLocation: cleanString(raw.inspectionLocation),
    damageDescription: cleanString(raw.damageDescription ?? raw.descriptionOfDamage),

    driverName: cleanString(raw.driverName),
    driverAgeOrDob: cleanString(raw.driverAgeOrDob),
    driverAddress: cleanString(raw.driverAddress),
    driverRelationship: cleanString(raw.driverRelationship),
    drivingLicenseNo: cleanString(raw.drivingLicenseNo),
    licenseIssuingAuthority: cleanString(raw.licenseIssuingAuthority),
    licenseExpiryDate: cleanString(raw.licenseExpiryDate),
    licenseClass: cleanString(raw.licenseClass),
    alcoholInfluence: cleanBool(raw.alcoholInfluence),

    policeReportLodged: cleanBool(raw.policeReportLodged),
    firNo: cleanString(raw.firNo ?? raw.policeReportNo),
    policeStationName: cleanString(raw.policeStationName),
    firDate: cleanString(raw.firDate),

    thirdPartyInjury: cleanBool(raw.thirdPartyInjury),
    thirdPartyDeath: cleanBool(raw.thirdPartyDeath),
    thirdPartyPropertyDamage: cleanBool(raw.thirdPartyPropertyDamage),
    thirdPartyDetails: cleanString(raw.thirdPartyDetails),
    witnessDetails: cleanString(raw.witnessDetails),

    commercialPermitNo: cleanString(raw.commercialPermitNo),
    commercialFitnessCert: cleanString(raw.commercialFitnessCert),
    commercialLadenWeight: cleanString(raw.commercialLadenWeight),
    commercialSectionNotApplicable: cleanBool(raw.commercialSectionNotApplicable),

    declarationDate: cleanString(raw.declarationDate),
    declarationPlace: cleanString(raw.declarationPlace),
    signaturePresent: cleanBool(raw.signaturePresent),

    extraFields: Array.isArray(raw.extraFields)
      ? raw.extraFields
          .filter((f) => f && typeof f === 'object' && 'key' in f)
          .map((f) => {
            const item = f as {
              key: unknown;
              value: unknown;
              matchedCanonicalField?: unknown;
              confidence?: unknown;
              sourcePage?: unknown;
              matchMethod?: unknown;
            };
            return {
              key: String(item.key),
              value: cleanString(item.value),
              matchedCanonicalField: cleanString(item.matchedCanonicalField),
              confidence: typeof item.confidence === 'number' ? item.confidence : undefined,
              sourcePage: typeof item.sourcePage === 'number' ? item.sourcePage : undefined,
              matchMethod: typeof item.matchMethod === 'string'
                ? item.matchMethod as 'exact' | 'fuzzy' | 'section' | 'gemini' | 'none'
                : undefined,
            };
          })
      : null,
    extractionMeta: raw.extractionMeta && typeof raw.extractionMeta === 'object'
      ? {
          ocrPairCount: typeof (raw.extractionMeta as { ocrPairCount?: unknown }).ocrPairCount === 'number'
            ? (raw.extractionMeta as { ocrPairCount: number }).ocrPairCount
            : undefined,
          ocrEngine: (raw.extractionMeta as { ocrEngine?: unknown }).ocrEngine === 'mistral'
            ? 'mistral' as const
            : undefined,
          ocrModel: cleanString((raw.extractionMeta as { ocrModel?: unknown }).ocrModel) ?? undefined,
          pageCount: typeof (raw.extractionMeta as { pageCount?: unknown }).pageCount === 'number'
            ? (raw.extractionMeta as { pageCount: number }).pageCount
            : undefined,
          averageOcrConfidence: typeof (raw.extractionMeta as { averageOcrConfidence?: unknown }).averageOcrConfidence === 'number'
            ? (raw.extractionMeta as { averageOcrConfidence: number }).averageOcrConfidence
            : undefined,
          lowConfidenceWordCount: typeof (raw.extractionMeta as { lowConfidenceWordCount?: unknown }).lowConfidenceWordCount === 'number'
            ? (raw.extractionMeta as { lowConfidenceWordCount: number }).lowConfidenceWordCount
            : undefined,
          templateVersion: cleanString((raw.extractionMeta as { templateVersion?: unknown }).templateVersion) ?? undefined,
          ocrRoute: (raw.extractionMeta as { ocrRoute?: unknown }).ocrRoute === 'mistral' ? 'mistral' as const
            : undefined,
          aliasMappedCount: typeof (raw.extractionMeta as { aliasMappedCount?: unknown }).aliasMappedCount === 'number'
            ? (raw.extractionMeta as { aliasMappedCount: number }).aliasMappedCount
            : undefined,
          geminiFallbackUsed: typeof (raw.extractionMeta as { geminiFallbackUsed?: unknown }).geminiFallbackUsed === 'boolean'
            ? (raw.extractionMeta as { geminiFallbackUsed: boolean }).geminiFallbackUsed
            : undefined,
          unmappedPairCount: typeof (raw.extractionMeta as { unmappedPairCount?: unknown }).unmappedPairCount === 'number'
            ? (raw.extractionMeta as { unmappedPairCount: number }).unmappedPairCount
            : undefined,
          rawPairs: Array.isArray((raw.extractionMeta as { rawPairs?: unknown }).rawPairs)
            ? (raw.extractionMeta as { rawPairs: Array<{ page: unknown; key: unknown; value: unknown; section?: unknown }> }).rawPairs
                .filter((p) => p && typeof p === 'object')
                .map((p) => ({
                  page: typeof p.page === 'number' ? p.page : 0,
                  key: String(p.key ?? ''),
                  value: cleanString(p.value),
                  section: cleanString(p.section) ?? undefined,
                }))
            : undefined,
        }
      : null,

    requiresHumanReview: Boolean(raw.requiresHumanReview),
    lowConfidenceFields: [...lowConfidence],
    confidenceScore: confidence,
  };
}
