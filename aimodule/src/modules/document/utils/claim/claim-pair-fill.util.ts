import type { ClaimOcrPair } from './claim-ocr-parse.util.js';
import type { InsurerCode } from './claim-form-identify.util.js';

type FieldKey = string;

interface LabelRule {
  field: FieldKey;
  labels: RegExp[];
  sections?: RegExp[];
  excludeSections?: RegExp[];
  transform?: (value: string, pair: ClaimOcrPair) => string | Record<string, string>;
}

const LABEL_RULES: LabelRule[] = [
  {
    field: 'policyNo',
    labels: [/certificate\s*\/\s*policy\s*no/i, /policy\s*no/i, /cover\s*note\s*no/i],
  },
  {
    field: 'claimNo',
    labels: [/claim\s*no/i, /intimation\s*no/i],
  },
  {
    field: 'insurancePeriodStart',
    labels: [/period\s*of\s*insurance/i, /insurance\s*period/i],
    transform: (v) => {
      const m = v.match(/(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})\s*(?:to|-)\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i);
      return m ? { insurancePeriodStart: m[1], insurancePeriodEnd: m[2] } : v;
    },
  },
  {
    field: 'insuredName',
    labels: [
      /reporting\s*branch/i,
      /divisional\s*office/i,
      /^\(?a\)?\s*name$/i,
      /name\s*of\s*the\s*insured/i,
      /insured\s*name/i,
    ],
    excludeSections: [/driver/i, /third/i],
  },
  {
    field: 'insuredAddress',
    labels: [/^\(?b\)?\s*address/i, /address\s*for\s*correspondence/i, /insured\s*address/i],
    sections: [/insured/i],
    excludeSections: [/driver/i],
  },
  {
    field: 'mobileNo',
    labels: [/telephone/i, /mobile/i, /phone/i],
    sections: [/insured/i],
  },
  {
    field: 'registrationNo',
    labels: [/regd\.?\s*no/i, /registration\s*no/i, /reg\.?\s*no/i, /vehicle\s*no/i],
    sections: [/vehicle/i, /insured\s*vehicle/i],
  },
  {
    field: 'vehicleMake',
    labels: [/make\s*(?:&|and)\s*year/i, /^make$/i, /manufacturer/i],
    sections: [/vehicle/i],
    transform: (v) => {
      const parts = v.split(/\s+/);
      return parts[0] ?? v;
    },
  },
  {
    field: 'vehicleYear',
    labels: [/make\s*(?:&|and)\s*year/i, /^year$/i],
    sections: [/vehicle/i],
    transform: (v) => {
      const m = v.match(/\b(19|20)\d{2}\b/);
      return m ? m[0] : v;
    },
  },
  {
    field: 'engineNo',
    labels: [/engine\s*no/i],
  },
  {
    field: 'chassisNo',
    labels: [/chassis\s*no/i],
  },
  {
    field: 'driverName',
    labels: [/^\(?a\)?\s*name$/i, /driver\s*name/i, /name\s*(?:&|and)\s*address\s*of\s*the\s*driver/i],
    sections: [/driver/i, /wheel/i],
    excludeSections: [/^\d*\.?\s*insured\b/i, /third/i, /details\s*of\s*accident/i, /^\d*\.?\s*vehicle/i],
    transform: (v) => v.split(/\b(?:age|dob|date\s*of\s*birth)\b/i)[0]?.trim() ?? v,
  },
  {
    field: 'driverAgeOrDob',
    labels: [/^\(?b\)?\s*age$/i, /age\s*or\s*dob/i, /date\s*of\s*birth/i],
    sections: [/driver/i],
  },
  {
    field: 'driverAddress',
    labels: [/^\(?c\)?\s*address/i, /driver\s*address/i],
    sections: [/driver/i],
  },
  {
    field: 'driverRelationship',
    labels: [/relationship/i, /is\s*the\s*driver/i, /relation/i],
    sections: [/driver/i],
  },
  {
    field: 'drivingLicenseNo',
    labels: [/driving\s*licen/i, /dl\s*no/i, /licence\s*no/i],
    sections: [/driver/i],
    transform: (v) => {
      const beforeAuthority = v.split(/issuing\s*authority/i)[0]?.trim() ?? v;
      const compact = beforeAuthority.replace(/\s+/g, '');
      const m =
        compact.match(/[A-Z]{2}\d{2,}[A-Z0-9]{5,}/i) ??
        beforeAuthority.match(/\b([A-Z]{2}[\dA-Z\s]{8,})\b/i);
      return m ? String(m[0]).replace(/\s/g, '') : beforeAuthority;
    },
  },
  {
    field: 'licenseIssuingAuthority',
    labels: [/issuing\s*authority/i, /rto/i],
    sections: [/driver/i],
  },
  {
    field: 'licenseExpiryDate',
    labels: [/date\s*of\s*expiry/i, /licence\s*expiry/i, /valid\s*upto/i],
    sections: [/driver/i],
  },
  {
    field: 'alcoholInfluence',
    labels: [/intoxication/i, /alcohol/i, /under\s*influence/i],
    sections: [/driver/i],
  },
  {
    field: 'dateOfLoss',
    labels: [/date\s*and\s*time/i, /date\s*of\s*(?:accident|loss|occurrence)/i],
    sections: [/accident/i, /loss/i, /details\s*of\s*accident/i],
    transform: (v) => {
      const m = v.match(/(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/);
      return m ? m[1] : '';
    },
  },
  {
    field: 'timeOfLoss',
    labels: [/date\s*and\s*time/i, /time\s*of\s*(?:accident|loss)/i],
    sections: [/accident/i, /loss/i],
    transform: (v) => {
      const m = v.match(/(\d{1,2}:\d{2}\s*(?:am|pm)?)/i);
      return m ? m[1] : '';
    },
  },
  {
    field: 'placeOfAccident',
    labels: [/^\(?b\)?\s*place/i, /place\s*of\s*accident/i, /location/i],
    sections: [/accident/i, /loss/i],
  },
  {
    field: 'vehicleSpeedAtAccident',
    labels: [/speed/i],
    sections: [/accident/i],
  },
  {
    field: 'accidentDescription',
    labels: [/short\s*description/i, /particulars\s*of\s*the\s*accident/i, /description\s*of\s*the\s*accident/i, /accident\s*description/i, /brief\s*particulars/i],
    sections: [/accident/i, /loss/i],
  },
  {
    field: 'damageDescription',
    labels: [/full\s*details\s*of\s*damage/i, /nature\s*(?:&|and)\s*description/i, /damage\s*description/i],
    sections: [/damage/i, /vehicle/i],
  },
  {
    field: 'estimatedRepairCost',
    labels: [/estimated\s*cost/i, /repair\s*estimate/i, /approximate\s*estimated/i],
  },
  {
    field: 'inspectionLocation',
    labels: [/inspection/i, /where\s*the\s*damaged\s*vehicle/i],
  },
  {
    field: 'declarationDate',
    labels: [/^date$/i, /declaration\s*date/i],
    sections: [/declaration/i, /signature/i],
  },
  {
    field: 'declarationPlace',
    labels: [/^place$/i, /declaration\s*place/i],
    sections: [/declaration/i, /signature/i],
  },
  {
    field: 'witnessDetails',
    labels: [/witness/i],
    excludeSections: [/third/i],
  },
  {
    field: 'firNo',
    labels: [/fir\s*no/i, /police\s*report/i, /complaint\s*no/i],
  },
  {
    field: 'commercialSectionNotApplicable',
    labels: [/commercial/i, /additional\s*information/i],
    transform: (v) => (/\bn\.?\s*a\.?\b/i.test(v) ? 'true' : v),
  },
];

function isEmpty(val: unknown): boolean {
  return val == null || val === '' || val === 'null';
}

function sectionMatches(section: string, patterns?: RegExp[]): boolean {
  if (!patterns?.length) return true;
  return patterns.some((p) => p.test(section));
}

function findBestPair(pairs: ClaimOcrPair[], rule: LabelRule): ClaimOcrPair | null {
  for (const pair of pairs) {
    if (rule.sections && !sectionMatches(pair.section, rule.sections)) continue;
    if (rule.excludeSections && sectionMatches(pair.section, rule.excludeSections)) continue;
    if (rule.labels.some((re) => re.test(pair.label))) return pair;
  }
  for (const pair of pairs) {
    if (rule.excludeSections && sectionMatches(pair.section, rule.excludeSections)) continue;
    if (rule.labels.some((re) => re.test(pair.label))) return pair;
  }
  return null;
}

/** Fill null canonical fields from OCR label:value pairs (no extra Gemini call). */
export function fillFromOcrPairs(
  raw: Record<string, unknown>,
  pairs: ClaimOcrPair[],
  _insurerCode?: InsurerCode | null,
): Record<string, unknown> {
  const out = { ...raw };

  for (const rule of LABEL_RULES) {
    if (!isEmpty(out[rule.field])) continue;

    const pair = findBestPair(pairs, rule);
    if (!pair) continue;

    if (rule.transform) {
      const result = rule.transform(pair.value, pair);
      if (typeof result === 'string') {
        out[rule.field] = result;
      } else {
        for (const [k, v] of Object.entries(result)) {
          if (isEmpty(out[k])) out[k] = v;
        }
      }
    } else {
      out[rule.field] = pair.value;
    }
  }

  return out;
}

const SUSPICIOUS_FIELD_CHECKS: Record<string, RegExp> = {
  insuredName: /branch|office|divisional|reporting|insured\s*vehicle/i,
  driverName: /issuing\s*authority|licence|license|expiry/i,
  drivingLicenseNo: /authority|expiry|issuing/i,
};

/** Clear obvious Gemini mis-maps, then refill from OCR pairs. */
export function refillSuspiciousFields(
  raw: Record<string, unknown>,
  pairs: ClaimOcrPair[],
  insurerCode?: InsurerCode | null,
): Record<string, unknown> {
  const cleared = { ...raw };
  for (const [field, pattern] of Object.entries(SUSPICIOUS_FIELD_CHECKS)) {
    const val = cleared[field];
    if (!isEmpty(val) && pattern.test(String(val))) {
      cleared[field] = null;
    }
  }
  return fillFromOcrPairs(cleared, pairs, insurerCode);
}

/** Collect pairs that did not map to any known canonical field key. */
export function collectUnmappedPairs(
  pairs: ClaimOcrPair[],
  mapped: Record<string, unknown>,
): { key: string; value: string }[] {
  const usedValues = new Set(
    Object.values(mapped)
      .filter((v) => v != null && v !== '')
      .map(String),
  );

  const extras: { key: string; value: string }[] = [];
  for (const pair of pairs) {
    if (usedValues.has(pair.value)) continue;
    const key = pair.section ? `${pair.section} / ${pair.label}` : pair.label;
    extras.push({ key, value: pair.value });
  }

  return extras.slice(0, 50);
}
