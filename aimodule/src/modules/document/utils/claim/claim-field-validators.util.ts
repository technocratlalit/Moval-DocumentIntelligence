const INSTRUCTION_BLOB_RE =
  /\(क\)|\(ख\)|\(ग\)|\(a\)\s*name|\(b\)\s*address|please\s+furnish|कृपया\s*ब्यौरा|give\s*names\s*and\s*address\s*of\s*passengers/i;

const LONG_TEXT_FIELDS = new Set([
  'driverAgeOrDob',
  'panNo',
  'cubicCapacity',
  'witnessDetails',
  'thirdPartyDetails',
  'accidentDescription',
]);

const FIELD_REJECT_PATTERNS: Record<string, RegExp[]> = {
  policyNo: [
    /period\s*of\s*insurance/i,
    /date\s*(?:&|and)\s*time\s*of\s*intimation/i,
    /claim\s*no/i,
    /intimation/i,
    /^MVL\/\d{4}/i,
    /engine\s*no/i,
  ],
  claimNo: [
    /period\s*of\s*insurance/i,
    /policy\s*no/i,
    /date\s*(?:&|and)\s*time\s*of\s*intimation/i,
  ],
  dateOfIntimation: [/period\s*of\s*insurance/i, /policy\s*no/i],
  dateOfLoss: [
    /witness/i,
    /passenger/i,
    /passangers/i,
    /give\s*name\s*and\s*address/i,
  ],
  drivingLicenseNo: [/issuing\s*authority/i, /expiry/i, /date\s*of\s*expiry/i],
  insuredName: [
    /branch\s*\/\s*divisional\s*office/i,
    /^reporting\s*branch$/i,
    /engine\s*no/i,
    /chassis\s*no/i,
    /registration\s*no/i,
    /make\s*and\s*year/i,
  ],
  registrationNo: [/engine\s*no/i, /chassis\s*no/i],
  driverAgeOrDob: [INSTRUCTION_BLOB_RE],
  panNo: [INSTRUCTION_BLOB_RE],
  cubicCapacity: [INSTRUCTION_BLOB_RE],
  witnessDetails: [INSTRUCTION_BLOB_RE],
  thirdPartyDetails: [INSTRUCTION_BLOB_RE],
};

export interface ValidationResult {
  valid: Record<string, unknown>;
  failedFields: string[];
  lowConfidenceFields: string[];
}

function isEmpty(val: unknown): boolean {
  return val == null || val === '' || val === 'null';
}

/** Reject field-shift values; clear invalid fields for re-mapping. */
export function validateMappedFields(mapped: Record<string, unknown>): ValidationResult {
  const valid = { ...mapped };
  const failedFields: string[] = [];
  const lowConfidenceFields: string[] = [];

  for (const [field, patterns] of Object.entries(FIELD_REJECT_PATTERNS)) {
    const val = valid[field];
    if (isEmpty(val)) continue;
    const str = String(val);
    if (patterns.some((p) => p.test(str))) {
      valid[field] = null;
      failedFields.push(field);
      lowConfidenceFields.push(field);
      continue;
    }
    if (LONG_TEXT_FIELDS.has(field) && str.length > 120) {
      valid[field] = null;
      failedFields.push(field);
      lowConfidenceFields.push(field);
    }
  }

  return { valid, failedFields, lowConfidenceFields };
}

/** Re-run alias mapping only for fields that failed validation. */
export function remapFailedFields(
  validated: ValidationResult,
  remapFn: (fields: string[]) => Record<string, unknown>,
): Record<string, unknown> {
  if (validated.failedFields.length === 0) return validated.valid;

  const remapped = remapFn(validated.failedFields);
  const out = { ...validated.valid };
  for (const field of validated.failedFields) {
    if (!isEmpty(remapped[field])) {
      out[field] = remapped[field];
    }
  }
  return out;
}

export const IDENTITY_FIELDS = ['policyNo', 'claimNo', 'registrationNo', 'dateOfLoss', 'dateOfIntimation'] as const;

export function needsGeminiFallback(
  mapped: Record<string, unknown>,
  unmappedCount: number,
  validationFailed: string[],
): boolean {
  const missingIdentity = IDENTITY_FIELDS.filter((f) => isEmpty(mapped[f]));
  if (validationFailed.length > 0) return true;
  if (missingIdentity.length >= 2) return true;
  if (unmappedCount > 5 && missingIdentity.length >= 1) return true;
  return false;
}
