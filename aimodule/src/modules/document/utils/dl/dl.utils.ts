const MONTH_MAP: Record<string, number> = {
  JAN: 0, JANUARY: 0,
  FEB: 1, FEBRUARY: 1,
  MAR: 2, MARCH: 2,
  APR: 3, APRIL: 3,
  MAY: 4,
  JUN: 5, JUNE: 5,
  JUL: 6, JULY: 6,
  AUG: 7, AUGUST: 7,
  SEP: 8, SEPT: 8, SEPTEMBER: 8,
  OCT: 9, OCTOBER: 9,
  NOV: 10, NOVEMBER: 10,
  DEC: 11, DECEMBER: 11,
};

export function normalizeDLNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return raw.replace(/[\s\-]/g, '').replace(/\//g, '').toUpperCase();
}

export function normalizeBloodGroup(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let upper = raw.toUpperCase().trim();
  if (['U', 'UNKNOWN', 'UNSPECIFIED', '-'].includes(upper)) return null;
  upper = upper.replace(/\s+(VE|RH)\s*$/i, '').trim();
  return upper || null;
}

/** Treat 00000000, all-zero, NA as empty validity */
export function normalizeEmptyDateField(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (['NA', 'N/A', 'NIL', '-', '--'].includes(upper)) return null;
  if (/^0+$/.test(trimmed.replace(/[^0-9]/g, ''))) return null;
  return trimmed;
}

/** Parse Indian DL date formats: DD/MM/YYYY, DD-MMM-YYYY, DD-MMMM-YYYY, DD-MM-YYYY */
export function parseIndianDLDate(dateStr: string | null | undefined): Date | null {
  const normalized = normalizeEmptyDateField(dateStr);
  if (!normalized) return null;

  const ddmmyyyy = normalized.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
  if (ddmmyyyy) {
    const [, dd, mm, yyyy] = ddmmyyyy;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    return isNaN(d.getTime()) ? null : d;
  }

  const ddMonYyyy = normalized.match(/^(\d{2})[\-\/]([A-Za-z]+)[\-\/](\d{4})$/);
  if (ddMonYyyy) {
    const [, dd, monRaw, yyyy] = ddMonYyyy;
    const mon = MONTH_MAP[monRaw.toUpperCase()];
    if (mon === undefined) return null;
    const d = new Date(Number(yyyy), mon, Number(dd));
    return isNaN(d.getTime()) ? null : d;
  }

  const fallback = new Date(normalized);
  return isNaN(fallback.getTime()) ? null : fallback;
}

const STATE_MAP: Record<string, string> = {
  AP: 'ANDHRA PRADESH',
  AR: 'ARUNACHAL PRADESH',
  AS: 'ASSAM',
  BR: 'BIHAR',
  CG: 'CHHATTISGARH',
  GA: 'GOA',
  GJ: 'GUJARAT',
  HR: 'HARYANA',
  HP: 'HIMACHAL PRADESH',
  JH: 'JHARKHAND',
  JK: 'JAMMU AND KASHMIR',
  KA: 'KARNATAKA',
  KL: 'KERALA',
  LA: 'LADAKH',
  LD: 'LAKSHADWEEP',
  MP: 'MADHYA PRADESH',
  MH: 'MAHARASHTRA',
  MN: 'MANIPUR',
  ML: 'MEGHALAYA',
  MZ: 'MIZORAM',
  NL: 'NAGALAND',
  OD: 'ODISHA',
  PB: 'PUNJAB',
  PY: 'PUDUCHERRY',
  RJ: 'RAJASTHAN',
  SK: 'SIKKIM',
  TN: 'TAMIL NADU',
  TS: 'TELANGANA',
  TR: 'TRIPURA',
  UP: 'UTTAR PRADESH',
  UK: 'UTTARAKHAND',
  UA: 'UTTARAKHAND',
  WB: 'WEST BENGAL',
  AN: 'ANDAMAN AND NICOBAR ISLANDS',
  CH: 'CHANDIGARH',
  DN: 'DADRA AND NAGAR HAVELI AND DAMAN AND DIU',
  DL: 'DELHI',
};

export interface DLStateHints {
  stateCode?: string | null;
}

export function detectStateFromDL(
  dlNumber: string | null | undefined,
  hints: DLStateHints = {},
): string | null {
  const cardCode = hints.stateCode?.trim().toUpperCase();
  if (cardCode) {
    const normalized = cardCode === 'UA' ? 'UK' : cardCode;
    if (STATE_MAP[normalized]) return STATE_MAP[normalized];
  }

  if (!dlNumber) return null;

  const cleanDL = normalizeDLNumber(dlNumber);
  if (!cleanDL || cleanDL.length < 2) return null;

  const prefix = cleanDL.substring(0, 2).toUpperCase();
  const normalized = prefix === 'UA' ? 'UK' : prefix;
  return STATE_MAP[normalized] ?? null;
}

type DocumentQuality = 'ORIGINAL_PHOTO' | 'SCANNED_COPY' | 'PHOTOCOPY_IN_PDF';
type DLPurpose = 'ORIGINAL' | 'DUPLICATE' | 'RENEWAL';
type DLFormat = 'OLD_FORMAT' | 'NEW_FORMAT' | 'UNKNOWN';

const DOCUMENT_QUALITY_CANONICAL = new Set<DocumentQuality>([
  'ORIGINAL_PHOTO',
  'SCANNED_COPY',
  'PHOTOCOPY_IN_PDF',
]);

const DOCUMENT_QUALITY_ALIASES: Record<string, DocumentQuality> = {
  PHOTO_IN_PDF: 'PHOTOCOPY_IN_PDF',
  PHOTOS_IN_PDF: 'PHOTOCOPY_IN_PDF',
  IMAGE_IN_PDF: 'PHOTOCOPY_IN_PDF',
  PHOTOCOPY: 'PHOTOCOPY_IN_PDF',
  PHOTOCOPY_PDF: 'PHOTOCOPY_IN_PDF',
  PHOTOGRAPH: 'ORIGINAL_PHOTO',
  PHOTO: 'ORIGINAL_PHOTO',
  CAMERA_PHOTO: 'ORIGINAL_PHOTO',
  MOBILE_PHOTO: 'ORIGINAL_PHOTO',
  ORIGINAL: 'ORIGINAL_PHOTO',
  SCAN: 'SCANNED_COPY',
  DIGITAL_SCAN: 'SCANNED_COPY',
  FLATBED_SCAN: 'SCANNED_COPY',
  SCANNED: 'SCANNED_COPY',
};

const DL_PURPOSE_CANONICAL = new Set<DLPurpose>(['ORIGINAL', 'DUPLICATE', 'RENEWAL']);

const DL_PURPOSE_ALIASES: Record<string, DLPurpose> = {
  DUPLICATED: 'DUPLICATE',
  RENEW: 'RENEWAL',
  RENEWED: 'RENEWAL',
};

const DL_FORMAT_CANONICAL = new Set<DLFormat>(['OLD_FORMAT', 'NEW_FORMAT', 'UNKNOWN']);

const DL_FORMAT_ALIASES: Record<string, DLFormat> = {
  OLD: 'OLD_FORMAT',
  NEW: 'NEW_FORMAT',
  SMART_CARD: 'NEW_FORMAT',
  SMARTCARD: 'NEW_FORMAT',
};

function normalizeEnumToken(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const token = raw.trim().toUpperCase().replace(/[\s\-]+/g, '_');
  return token || null;
}

export function normalizeDocumentQuality(raw: string | null | undefined): DocumentQuality | null {
  const token = normalizeEnumToken(raw);
  if (!token) return null;
  if (DOCUMENT_QUALITY_CANONICAL.has(token as DocumentQuality)) {
    return token as DocumentQuality;
  }
  return DOCUMENT_QUALITY_ALIASES[token] ?? null;
}

export function normalizeDLPurpose(raw: string | null | undefined): DLPurpose | null {
  const token = normalizeEnumToken(raw);
  if (!token) return null;
  if (DL_PURPOSE_CANONICAL.has(token as DLPurpose)) {
    return token as DLPurpose;
  }
  return DL_PURPOSE_ALIASES[token] ?? null;
}

export function normalizeDLFormat(raw: string | null | undefined): DLFormat | null {
  const token = normalizeEnumToken(raw);
  if (!token) return null;
  if (DL_FORMAT_CANONICAL.has(token as DLFormat)) {
    return token as DLFormat;
  }
  return DL_FORMAT_ALIASES[token] ?? null;
}

export function inferDLFormat(
  dlNumber: string | null | undefined,
  fromGemini: string | null | undefined,
): DLFormat | null {
  const normalized = normalizeDLFormat(fromGemini);
  if (normalized) return normalized;

  if (!dlNumber) return null;
  const trimmed = dlNumber.trim();

  if (/^[A-Z]{2}-\d{2}\/\d{4}\//i.test(trimmed)) return 'OLD_FORMAT';
  if (/^[A-Z]{2}\d{2}\s+19\d+/i.test(trimmed)) return 'OLD_FORMAT';

  if (/^[A-Z]{2}\d{2}\s+20\d+/i.test(trimmed)) return 'NEW_FORMAT';
  if (/^[A-Z]{2}\d{2,}/i.test(trimmed.replace(/[\s\-/]/g, ''))) return 'NEW_FORMAT';

  return null;
}

const FATHER_SPOUSE_PREFIXES = [
  /^SON\/DAUGHTER\/WIFE\s+OF\s+/i,
  /^S\/D\/W\s+OF\s+/i,
  /^S\/O\s+/i,
  /^D\/O\s+/i,
  /^W\/O\s+/i,
  /^FATHER\s*:\s*/i,
  /^HUSBAND\s*:\s*/i,
  /^FATHER\s+/i,
  /^HUSBAND\s+/i,
];

export function normalizeFatherSpouseName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let name = raw.trim();
  if (!name) return null;

  for (const prefix of FATHER_SPOUSE_PREFIXES) {
    name = name.replace(prefix, '').trim();
  }

  return name || null;
}

export function computeDLStatus(validityNT: string | null | undefined, validityT: string | null | undefined) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dateNT = parseIndianDLDate(validityNT);
  const dateT = parseIndianDLDate(validityT);

  const isNTValid = dateNT ? dateNT >= today : null;
  const isTValid = dateT ? dateT >= today : null;

  let isExpired = false;
  if (dateNT && dateT) {
    isExpired = dateNT < today && dateT < today;
  } else if (dateNT) {
    isExpired = dateNT < today;
  } else if (dateT) {
    isExpired = dateT < today;
  }

  return { isNTValid, isTValid, isExpired };
}

const CLASS_CODE_ALIASES: Record<string, string> = {
  'M.CYL.': 'MCWG',
  'M.CYL': 'MCWG',
  'M.CYCLE': 'MCWG',
  'MOTOR CYCLE WITH GEAR': 'MCWG',
  'LMV-NT': 'LMV',
  'L.M.V': 'LMV',
  'L.M.V.': 'LMV',
  'LIGHT MOTOR VEHICLE': 'LMV',
  'LIGHT MOTOR VEHICLE NON TRANSPORT': 'LMV',
  MCWOG: 'MCWOG',
  LMVCAB: 'LMVCAB',
  TRANS: 'TRANS',
  LTV: 'LTV',
  COV: 'COV',
};

export function mapDescriptiveClassLabel(description: string | null | undefined): string | null {
  if (!description) return null;
  const upper = description.trim().toUpperCase();
  if (CLASS_CODE_ALIASES[upper]) return CLASS_CODE_ALIASES[upper];
  if (upper.includes('LIGHT MOTOR VEHICLE') && upper.includes('NON TRANSPORT')) return 'LMV';
  if (upper.includes('MOTOR CYCLE') && upper.includes('GEAR')) return 'MCWG';
  if (upper.includes('MOTOR CYCLE')) return 'MCWG';
  return normalizeClassCode(description);
}

function normalizeClassCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toUpperCase();
  return CLASS_CODE_ALIASES[trimmed] ?? trimmed;
}

export interface VehicleClassRow {
  vehicleClass?: string | null;
  classCode?: string | null;
  classDescription?: string | null;
  issuedOn?: string | null;
  issueDate?: string | null;
  validity?: string | null;
  badgeNumber?: string | null;
  badgeIssuedDate?: string | null;
  badgeIssuedBy?: string | null;
}

export function normalizeVehicleClasses(
  rows: VehicleClassRow[] | null | undefined,
): VehicleClassRow[] | null {
  if (!rows || !Array.isArray(rows) || rows.length === 0) return null;

  return rows.map((row) => {
    const fromDescription = mapDescriptiveClassLabel(row.classDescription);
    const classCode = normalizeClassCode(row.classCode ?? row.vehicleClass ?? fromDescription);
    const vehicleClass = normalizeClassCode(row.vehicleClass ?? row.classCode ?? fromDescription);
    const issuedOn =
      normalizeEmptyDateField(row.issuedOn) ??
      normalizeEmptyDateField(row.issueDate);
    const badgeIssuedDate = normalizeEmptyDateField(row.badgeIssuedDate);

    return {
      vehicleClass: vehicleClass ?? classCode,
      classCode: classCode ?? vehicleClass,
      classDescription: row.classDescription?.trim() ?? null,
      issuedOn,
      validity: normalizeEmptyDateField(row.validity),
      badgeNumber: row.badgeNumber?.trim() ?? null,
      badgeIssuedDate,
      badgeIssuedBy: row.badgeIssuedBy?.trim() ?? null,
    };
  });
}

function mergeAddresses(...candidates: (string | null | undefined)[]): string | null {
  const valid = candidates
    .map((c) => (c ? c.trim() : null))
    .filter((c): c is string => !!c);

  if (valid.length === 0) return null;
  return valid.reduce((longest, current) =>
    current.length > longest.length ? current : longest,
  );
}

export function normaliseDLExtraction(raw: Record<string, unknown>): Record<string, unknown> {
  const endorseNo =
    (raw.endorseNo as string | null | undefined) ??
    (raw.endorsementNo as string | null | undefined) ??
    null;
  const endorseDate =
    (raw.endorseDate as string | null | undefined) ??
    (raw.endorsementDate as string | null | undefined) ??
    null;

  const address = mergeAddresses(
    raw.address as string | null | undefined,
    raw.presentAddress as string | null | undefined,
    raw.backAddress as string | null | undefined,
  );

  const presentAddress = (raw.presentAddress as string | null | undefined)?.trim() ?? null;

  const organDonorRaw = raw.organDonor as string | null | undefined;
  let organDonor: string | null = null;
  if (organDonorRaw) {
    const upper = organDonorRaw.trim().toUpperCase();
    if (['Y', 'YES', 'TRUE'].includes(upper)) organDonor = 'Y';
    else if (['N', 'NO', 'FALSE'].includes(upper)) organDonor = 'N';
    else organDonor = organDonorRaw.trim();
  }

  const vehicleClasses = normalizeVehicleClasses(
    raw.vehicleClasses as VehicleClassRow[] | null | undefined,
  );

  const dlNumber = raw.dlNumber as string | null | undefined;
  const dlFormatFromGemini = normalizeDLFormat(raw.dlFormat as string | null | undefined);
  const dlFormat = inferDLFormat(dlNumber, dlFormatFromGemini);

  const stateCodeRaw = (raw.stateCode as string | null | undefined)?.trim().toUpperCase() ?? null;
  const stateCode = stateCodeRaw === 'UA' ? 'UK' : stateCodeRaw;

  return {
    ...raw,
    address,
    presentAddress,
    stateCode,
    endorseNo,
    endorseAuth: (raw.endorseAuth as string | null | undefined)?.trim() ?? null,
    endorseDate: normalizeEmptyDateField(endorseDate),
    endorsementNo: endorseNo,
    endorsementDate: normalizeEmptyDateField(endorseDate),
    fatherSpouseName: normalizeFatherSpouseName(raw.fatherSpouseName as string | null | undefined),
    validityNT: normalizeEmptyDateField(raw.validityNT as string | null | undefined),
    validityT: normalizeEmptyDateField(raw.validityT as string | null | undefined),
    mobileNo: (raw.mobileNo as string | null | undefined)?.trim() ?? null,
    organDonor,
    vehicleClasses,
    hazardousValidity: normalizeEmptyDateField(raw.hazardousValidity as string | null | undefined),
    hillValidity: normalizeEmptyDateField(raw.hillValidity as string | null | undefined),
    bloodGroup: normalizeBloodGroup(raw.bloodGroup as string | null | undefined),
    documentQuality: normalizeDocumentQuality(raw.documentQuality as string | null | undefined),
    dlPurpose: normalizeDLPurpose(raw.dlPurpose as string | null | undefined),
    dlFormat,
    formType: (raw.formType as string | null | undefined)?.trim() ?? null,
  };
}
