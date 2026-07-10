
//  state map (shared with DL utils — same prefix logic)
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

const EMPTY_SENTINELS = new Set(['NA', 'N/A', 'NIL', '-', '--', 'N.A.F.', 'NAF']);

export interface RCStateHints {
  cardStateCode?: string | null;
  rtoCode?: string | null;
}

export function isEmptySentinel(raw: string | null | undefined): boolean {
  if (!raw) return true;
  const trimmed = raw.trim();
  if (!trimmed) return true;
  const upper = trimmed.toUpperCase();
  if (EMPTY_SENTINELS.has(upper)) return true;
  if (/^0+$/.test(trimmed.replace(/[^0-9]/g, ''))) return true;
  if (/^0{2}\/0{2}\/0{4}$/.test(trimmed)) return true;
  return false;
}

export function cleanSentinelField(raw: string | null | undefined): string | null {
  if (isEmptySentinel(raw)) return null;
  return raw!.trim();
}

// normalize registration number
export function normalizeRegNo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return raw.replace(/\s+/g, '').toUpperCase();
}

function stateCodeFromRto(rtoCode: string | null | undefined): string | null {
  if (!rtoCode) return null;
  const clean = rtoCode.replace(/\s+/g, '').toUpperCase();
  const match = clean.match(/^([A-Z]{2})/);
  if (match && STATE_MAP[match[1]]) return match[1];
  return null;
}

function isBharatSeriesRegNo(regNo: string): boolean {
  return /^\d{2}BH/i.test(regNo);
}

/** Resolve 2-letter state code — handles classic (JH02…) and Bharat series (23BH…) */
export function extractStateCode(
  regNo: string | null | undefined,
  hints: RCStateHints = {},
): string | null {
  const card = hints.cardStateCode?.trim().toUpperCase();
  if (card && STATE_MAP[card]) return card === 'UA' ? 'UK' : card;

  const clean = normalizeRegNo(regNo);
  if (!clean || clean.length < 2) return null;

  const prefix2 = clean.substring(0, 2).toUpperCase();
  if (STATE_MAP[prefix2]) return prefix2 === 'UA' ? 'UK' : prefix2;

  if (isBharatSeriesRegNo(clean)) {
    return stateCodeFromRto(hints.rtoCode);
  }

  return null;
}

export function detectStateFromRegNo(
  regNo: string | null | undefined,
  hints: RCStateHints = {},
): string | null {
  const code = extractStateCode(regNo, hints);
  if (!code) return null;
  const normalized = code === 'UA' ? 'UK' : code;
  return STATE_MAP[normalized] ?? null;
}

// parse indian date strings → Date object
export function parseIndianDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr || isEmptySentinel(dateStr)) return null;

  const normalized = dateStr.trim();

  const full = normalized.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
  if (full) {
    const [, dd, mm, yyyy] = full;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    return isNaN(d.getTime()) ? null : d;
  }

  const monthYear = normalized.match(/^(\d{2})[\/\-](\d{4})$/);
  if (monthYear) {
    const [, mm, yyyy] = monthYear;
    const d = new Date(Number(yyyy), Number(mm) - 1, 1);
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

  return null;
}

// compute rc status — skip non-date values like "As per Fitness"
export function computeRCStatus(regValidity: string | null | undefined): {
  isValid: boolean | null;
  isExpired: boolean | null;
  daysUntilExpiry: number | null;
} {
  const expiryDate = parseIndianDate(regValidity);

  if (!expiryDate) {
    return { isValid: null, isExpired: null, daysUntilExpiry: null };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diffMs = expiryDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  return {
    isValid: diffDays >= 0,
    isExpired: diffDays < 0,
    daysUntilExpiry: diffDays,
  };
}

export function stripLeadingZeros(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) ? null : parsed;
}

const FINANCE_KEYWORDS = /^(NEW|HPA|HYP|TO|LA|WITH|N\.?A\.?F\.?|PRIVATE|COMMERCIAL)$/i;

function looksLikeFinancer(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || isEmptySentinel(trimmed)) return false;
  if (FINANCE_KEYWORDS.test(trimmed)) return false;
  return trimmed.length > 2;
}

/** Split NEW/HPA + bank from purpose when financeBank / hypothecatedTo missing */
export function normaliseFinanceFields(data: {
  purpose?: string | null;
  financeBank?: string | null;
  hypothecatedTo?: string | null;
}): { purpose: string | null; financeBank: string | null; hypothecatedTo: string | null } {
  let purpose = cleanSentinelField(data.purpose);
  let financeBank = cleanSentinelField(data.financeBank);
  let hypothecatedTo = cleanSentinelField(data.hypothecatedTo);

  if (purpose && /HPA|HYP|LA/i.test(purpose) && !financeBank) {
    const slashParts = purpose.split('/').map((p) => p.trim()).filter(Boolean);
    const bankPart = slashParts.find((p) => looksLikeFinancer(p));
    if (bankPart) {
      financeBank = bankPart;
      if (!hypothecatedTo) hypothecatedTo = bankPart;
    } else {
      const spaceParts = purpose.split(/\s+/).filter(Boolean);
      const bankFromSpace = spaceParts.find((p) => looksLikeFinancer(p));
      if (bankFromSpace) {
        financeBank = bankFromSpace;
        if (!hypothecatedTo) hypothecatedTo = bankFromSpace;
      }
    }
  }

  if (purpose && !financeBank) {
    const purposeOnlyBank = purpose.replace(/^(NEW|TO|PRIVATE|COMMERCIAL)\s*[\/\s]*/i, '').trim();
    if (purposeOnlyBank && looksLikeFinancer(purposeOnlyBank) && purposeOnlyBank !== purpose) {
      financeBank = purposeOnlyBank;
      if (!hypothecatedTo) hypothecatedTo = purposeOnlyBank;
    }
  }

  if (hypothecatedTo && !financeBank && looksLikeFinancer(hypothecatedTo)) {
    financeBank = hypothecatedTo;
  }

  if (financeBank && !hypothecatedTo) {
    hypothecatedTo = financeBank;
  }

  return { purpose, financeBank, hypothecatedTo };
}

export function deriveHypothecation(data: {
  purpose?: string | null;
  financeBank?: string | null;
  hypothecatedTo?: string | null;
}): 'Yes' | 'No' | null {
  const financeBank = cleanSentinelField(data.financeBank);
  const hypothecatedTo = cleanSentinelField(data.hypothecatedTo);
  const purpose = cleanSentinelField(data.purpose);

  if (financeBank || hypothecatedTo) return 'Yes';

  if (purpose && /HPA|HYP|LA\s*WITH/i.test(purpose)) return 'Yes';

  if (purpose && /^(NEW|TO|PRIVATE|COMMERCIAL)$/i.test(purpose.trim())) return 'No';

  if (purpose === null && financeBank === null && hypothecatedTo === null) return null;

  return 'No';
}

export function normaliseRCExtraction(raw: Record<string, unknown>): Record<string, unknown> {
  const fuel =
    cleanSentinelField(raw.fuel as string | null | undefined) ??
    cleanSentinelField(raw.fuelType as string | null | undefined);

  const fitnessValidUpto =
    cleanSentinelField(raw.fitnessValidUpto as string | null | undefined) ??
    cleanSentinelField(raw.fitnessUpto as string | null | undefined);

  return {
    ...raw,
    fuel,
    fitnessValidUpto,
    fatherSpouseName: cleanSentinelField(raw.fatherSpouseName as string | null | undefined),
    address: cleanSentinelField(raw.address as string | null | undefined),
    ownerSerial: cleanSentinelField(raw.ownerSerial as string | null | undefined),
    taxPaidUpto: cleanSentinelField(raw.taxPaidUpto as string | null | undefined),
    cubicCapacity: cleanSentinelField(raw.cubicCapacity as string | null | undefined),
    purpose: cleanSentinelField(raw.purpose as string | null | undefined),
    financeBank: cleanSentinelField(raw.financeBank as string | null | undefined),
    hypothecatedTo: cleanSentinelField(raw.hypothecatedTo as string | null | undefined),
    stateCode: cleanSentinelField(raw.stateCode as string | null | undefined),
    bodyType: cleanSentinelField(raw.bodyType as string | null | undefined),
    wheelBase: cleanSentinelField(raw.wheelBase as string | null | undefined),
    standingCapacity: cleanSentinelField(raw.standingCapacity as string | null | undefined),
    insuranceUpto: cleanSentinelField(raw.insuranceUpto as string | null | undefined),
    cardSerialNo: cleanSentinelField(raw.cardSerialNo as string | null | undefined),
    formType: cleanSentinelField(raw.formType as string | null | undefined),
  };
}
