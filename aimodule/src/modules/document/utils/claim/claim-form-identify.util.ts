export type InsurerCode =
  | 'UIIC'
  | 'NIAC'
  | 'NIC'
  | 'OIC'
  | 'BAJAJ'
  | 'HDFC'
  | 'IFFCO'
  | 'SBI'
  | 'RELIANCE'
  | 'OTHER';

export interface InsurerIdentification {
  insurerCode: InsurerCode;
  insurerName: string | null;
}

export type ClaimTemplate =
  | 'UIIC_BILINGUAL'
  | 'UIIC_TABULAR'
  | 'OIC_BILINGUAL'
  | 'OIC_ENGLISH'
  | 'NIAC_TABLE'
  | 'NIC_COMPACT'
  | 'NIC_HINDI'
  | 'GENERIC';

/** Detect form template variant from header OCR text — no LLM. */
export function identifyTemplate(headerText: string, insurerCode: InsurerCode): ClaimTemplate {
  const text = headerText ?? '';

  if (/[\u0900-\u097F]/.test(text) && /मोटर\s*बीमा\s*दावा/i.test(text)) {
    return 'NIC_HINDI';
  }

  switch (insurerCode) {
    case 'UIIC':
      if (/\([कखग]\)/.test(text) || (/[\u0900-\u097F]/.test(text) && /UNITED\s+INDIA/i.test(text))) {
        return 'UIIC_BILINGUAL';
      }
      if (/Claim\s*No/i.test(text) && /Workshop/i.test(text)) {
        return 'UIIC_TABULAR';
      }
      return 'UIIC_BILINGUAL';

    case 'OIC':
      if (/[\u0900-\u097F]/.test(text) && /ORIENTAL/i.test(text)) {
        return 'OIC_BILINGUAL';
      }
      return 'OIC_ENGLISH';

    case 'NIAC':
      return 'NIAC_TABLE';

    case 'NIC':
      if (/[\u0900-\u097F]/.test(text)) return 'NIC_HINDI';
      return 'NIC_COMPACT';

    default:
      return 'GENERIC';
  }
}

const INSURER_PATTERNS: { code: InsurerCode; name: string; patterns: RegExp[] }[] = [
  {
    code: 'UIIC',
    name: 'United India Insurance Company Limited',
    patterns: [/UNITED\s+INDIA/i, /\bUIIC\b/i],
  },
  {
    code: 'NIAC',
    name: 'The New India Assurance Company Limited',
    patterns: [/NEW\s+INDIA\s+ASSURANCE/i, /\bNIAC\b/i, /\bNIA\b/i],
  },
  {
    code: 'NIC',
    name: 'National Insurance Company Limited',
    patterns: [/NATIONAL\s+INSURANCE/i, /\bNIC\b/i],
  },
  {
    code: 'OIC',
    name: 'The Oriental Insurance Company Limited',
    patterns: [/ORIENTAL\s+INSURANCE/i, /\bOIC\b/i],
  },
  {
    code: 'BAJAJ',
    name: 'Bajaj Allianz General Insurance',
    patterns: [/BAJAJ\s+ALLIANZ/i],
  },
  {
    code: 'HDFC',
    name: 'HDFC ERGO General Insurance',
    patterns: [/HDFC\s+ERGO/i],
  },
  {
    code: 'IFFCO',
    name: 'IFFCO Tokio General Insurance',
    patterns: [/IFFCO\s+TOKIO/i],
  },
  {
    code: 'SBI',
    name: 'SBI General Insurance',
    patterns: [/SBI\s+GENERAL/i],
  },
  {
    code: 'RELIANCE',
    name: 'Reliance General Insurance',
    patterns: [/RELIANCE\s+GENERAL/i],
  },
];

/** Classify insurer from header / first-page OCR text — no LLM. */
export function identifyInsurer(headerText: string): InsurerIdentification {
  const text = headerText ?? '';

  for (const entry of INSURER_PATTERNS) {
    if (entry.patterns.some((p) => p.test(text))) {
      return { insurerCode: entry.code, insurerName: entry.name };
    }
  }

  return { insurerCode: 'OTHER', insurerName: null };
}
