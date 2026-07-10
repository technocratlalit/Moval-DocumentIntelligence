import type { IDLSchema } from '../../schema/dl/dl.schema.js';

/** Fields printed on the DL card (OCR targets). */
export const DL_EXTRACTED_KEYS = [
  'dlNumber',
  'name',
  'fatherSpouseName',
  'dob',
  'address',
  'presentAddress',
  'issueDate',
  'validityNT',
  'validityT',
  'bloodGroup',
  'organDonor',
  'mobileNo',
  'stateCode',
  'issuingRto',
  'endorseNo',
  'endorseAuth',
  'endorseDate',
  'hazardousValidity',
  'hillValidity',
  'dlPurpose',
  'formType',
  'vehicleClasses',
] as const satisfies readonly (keyof IDLSchema)[];

/** Fields computed after extraction (not printed on card). */
export const DL_DERIVED_KEYS = [
  'dlNumberNormalized',
  'state',
  'dlStatus',
  'dlFormat',
  'addressComplete',
] as const satisfies readonly (keyof IDLSchema)[];

/** Pipeline / quality metadata (not card content). */
export const DL_META_KEYS = [
  'isCorrectDocumentType',
  'detectedDocumentType',
  'hasAllPagesCorrectType',
  'invalidPageIndices',
  'confidenceScore',
  'requiresHumanReview',
  'lowConfidenceFields',
  'documentQuality',
] as const satisfies readonly (keyof IDLSchema)[];

export type DLExtracted = Pick<IDLSchema, (typeof DL_EXTRACTED_KEYS)[number]>;
export type DLDerived = Pick<IDLSchema, (typeof DL_DERIVED_KEYS)[number]>;
export type DLMeta = Pick<IDLSchema, (typeof DL_META_KEYS)[number]>;

export type DLShapedResponse = IDLSchema & {
  extracted: DLExtracted;
  derived: DLDerived;
  meta: DLMeta;
};

function pickKeys<T extends Record<string, unknown>, K extends keyof T>(
  source: T,
  keys: readonly K[],
): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const key of keys) {
    out[key] = source[key];
  }
  return out;
}

/**
 * Split flat DL extraction into extracted / derived / meta sections.
 * Flat top-level keys are preserved for backward compatibility.
 */
export function shapeDLResponse(flat: IDLSchema): DLShapedResponse {
  return {
    ...flat,
    extracted: pickKeys(flat, DL_EXTRACTED_KEYS),
    derived: pickKeys(flat, DL_DERIVED_KEYS),
    meta: pickKeys(flat, DL_META_KEYS),
  };
}
