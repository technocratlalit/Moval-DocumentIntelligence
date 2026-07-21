import type { ClaimOcrPair } from './claim-ocr-parse.util.js';
import type { InsurerCode } from './claim-form-identify.util.js';
import { validateMappedFields } from './claim-field-validators.util.js';
import {
  type ClaimTemplate,
  type MatchMethod,
  type SectionRule,
  getAliasesForField,
  getAllCanonicalFields,
  getSectionRules,
} from './claim-field-aliases.js';

export interface PairMapping {
  pair: ClaimOcrPair;
  canonicalField: string | null;
  matchMethod: MatchMethod;
  confidence: number;
}

export interface AliasMapResult {
  mapped: Record<string, unknown>;
  pairMappings: PairMapping[];
  unmappedPairs: ClaimOcrPair[];
  extraFields: Array<{
    key: string;
    value: string;
    matchedCanonicalField: string | null;
    confidence?: number;
    sourcePage?: number;
    matchMethod?: MatchMethod;
  }>;
}

const DATE_TOKEN = /(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4})/;
const PERIOD_RANGE =
  /(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4})\s*(?:to|-)\s*(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4})/i;
const TIME_TOKEN = /(\d{1,2}[.:]\d{2}\s*(?:A\.?M\.?|P\.?M\.?|am|pm)?(?:\/P\.?M\.?)?)/i;

function normalizeLabel(label: string): string {
  return label
    .replace(/^\([a-z\d\u0900-\u097F]+\)\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeAlias(alias: string): string {
  return alias.replace(/\s+/g, ' ').trim().toLowerCase();
}

function sectionMatches(section: string, patterns?: RegExp[]): boolean {
  if (!patterns?.length) return true;
  return patterns.some((p) => p.test(section));
}

function labelRulesPass(pair: ClaimOcrPair, rules?: SectionRule): boolean {
  if (!rules) return true;

  if (rules.excludeLabelPatterns?.some((p) => p.test(pair.label))) return false;
  if (rules.labelPatterns?.length && !rules.labelPatterns.some((p) => p.test(pair.label))) {
    if (!rules.sections?.length && !rules.minPage) return false;
  }
  if (rules.pages?.length && !rules.pages.includes(pair.page)) return false;
  if (rules.minPage != null && pair.page < rules.minPage) {
    const sectionOk = Boolean(rules.sections?.length && sectionMatches(pair.section, rules.sections));
    const labelOk = Boolean(rules.labelPatterns?.some((p) => p.test(pair.label)));
    if (!sectionOk && !labelOk) return false;
  }
  if (rules.maxPage != null && pair.page > rules.maxPage) return false;
  if (rules.sections && !sectionMatches(pair.section, rules.sections)) {
    const hasLabelOrPageHint =
      Boolean(rules.labelPatterns?.some((p) => p.test(pair.label))) ||
      (rules.minPage != null && pair.page >= rules.minPage);
    if (!hasLabelOrPageHint) return false;
  }
  if (rules.excludeSections && sectionMatches(pair.section, rules.excludeSections)) return false;

  return true;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function fuzzyScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.92;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 0;
  return 1 - levenshtein(a, b) / maxLen;
}

function parseBool(value: string): string {
  const s = value.trim().toLowerCase();
  if (['yes', 'y', 'true', '1'].includes(s)) return 'true';
  if (['no', 'n', 'false', '0'].includes(s)) return 'false';
  return value;
}

function stripValueLabelPrefix(field: string, value: string): string {
  const prefixes: Record<string, RegExp> = {
    insuredName: /^name\s+/i,
    insuredAddress: /^address\s+(?:for\s+correspondence\s+)?/i,
    mobileNo: /^telephone\s*no\.?\s*/i,
    driverName: /^name\s+/i,
    driverAddress: /^address\s+/i,
    drivingLicenseNo: /^driving\s*licen[cs]e\s*(?:no\.?|number)?\s*/i,
    licenseIssuingAuthority: /^issuing\s*authority\s*/i,
  };
  const re = prefixes[field];
  return re ? value.replace(re, '').trim() : value;
}

function applyTransform(field: string, value: string): string | Record<string, string> {
  value = stripValueLabelPrefix(field, value);

  switch (field) {
    case 'policyNo': {
      const cleaned = value.replace(/\s+/g, '');
      if (/^MVL\/\d{4}/i.test(cleaned) || /engine\s*no/i.test(value)) return '';
      return cleaned;
    }
    case 'insurancePeriodStart': {
      const m = value.match(PERIOD_RANGE);
      return m ? { insurancePeriodStart: m[1], insurancePeriodEnd: m[2] } : value;
    }
    case 'dateOfLoss': {
      const atSplit = value.split(/\s+at\s+/i)[0]?.trim() ?? value;
      const m = atSplit.match(DATE_TOKEN);
      return m ? m[1] : '';
    }
    case 'timeOfLoss': {
      if (!DATE_TOKEN.test(value)) {
        return value.trim();
      }
      const atPart = value.split(/\s+at\s+/i)[1];
      if (atPart) {
        const m = atPart.match(TIME_TOKEN);
        if (m) return m[1].replace(/\.(?=\d)/g, ':').replace(/\.(?=[AP])/gi, '');
      }
      const tokens = value.match(new RegExp(DATE_TOKEN.source, 'g'));
      if (tokens && tokens.length >= 1) {
        const afterDate = value.slice(value.indexOf(tokens[0]) + tokens[0].length).trim();
        const m = afterDate.match(TIME_TOKEN);
        if (m) return m[1].replace(/\.(?=\d)/g, ':').replace(/\.(?=[AP])/gi, '');
      }
      const m = value.match(TIME_TOKEN);
      return m ? m[1].replace(/\.(?=\d)/g, ':').replace(/\.(?=[AP])/gi, '') : '';
    }
    case 'drivingLicenseNo': {
      const beforeAuthority = value.split(/issuing\s*authority/i)[0]?.trim() ?? value;
      const compact = beforeAuthority.replace(/\s+/g, '');
      const m =
        compact.match(/[A-Z]{2}\d{2,}[A-Z0-9/]{5,}/i) ??
        beforeAuthority.match(/\b([A-Z]{2}[\dA-Z\s/]{8,})\b/i);
      return m ? String(m[0]).replace(/\s/g, '') : beforeAuthority;
    }
    case 'registrationNo':
      return value.replace(/\s+/g, '').replace(/([A-Z]{2}-\d{2})([A-Z])/i, '$1$2');
    case 'driverName':
      return value.split(/\b(?:age|dob|date\s*of\s*birth)\b/i)[0]?.trim() ?? value;
    case 'vehicleMake': {
      const mvl = value.match(/MVL\/(\d{4})/i);
      if (mvl) return { vehicleMake: 'MVL', vehicleYear: mvl[1] };
      if (/^MVL\/\d{4}$/i.test(value.trim())) return 'MVL';
      return value.split(/\s+/)[0] ?? value;
    }
    case 'vehicleYear': {
      const mvl = value.match(/MVL\/(\d{4})/i);
      if (mvl) return mvl[1];
      const m = value.match(/\b(19|20)\d{2}\b/);
      return m ? m[0] : value;
    }
    case 'insuredName':
      if (/engine\s*no|chassis\s*no|registration\s*no|make\s*and\s*year/i.test(value)) {
        return '';
      }
      if (/branch|office|divisional|reporting/i.test(value) && !/^mr\.?\s/i.test(value)) {
        return '';
      }
      return value.replace(/^name\s+/i, '').trim();
    case 'driverRelationship':
      return value.replace(/^\d+\.\s*/, '').trim();
    case 'policeReportLodged':
    case 'alcoholInfluence':
    case 'thirdPartyPropertyDamage':
      return parseBool(value);
    case 'signaturePresent':
      return /signature\s*present/i.test(value) ? 'true' : parseBool(value);
    default:
      return value;
  }
}

function isEmpty(val: unknown): boolean {
  return val == null || val === '' || val === 'null';
}

function matchPairToField(
  pair: ClaimOcrPair,
  field: string,
  template: ClaimTemplate,
  fuzzyThreshold: number,
): { matchMethod: MatchMethod; confidence: number } | null {
  const rules = getSectionRules(field, template);
  const normLabel = normalizeLabel(pair.label);
  const rawNorm = pair.label.replace(/\s+/g, ' ').trim().toLowerCase();
  const aliases = getAliasesForField(field, template);

  for (const alias of aliases) {
    const normAlias = normalizeAlias(alias);
    const rawAlias = alias.replace(/\s+/g, ' ').trim().toLowerCase();
    const exact =
      normLabel === normAlias ||
      rawNorm === rawAlias ||
      pair.label.trim() === alias.trim();

    if (exact && labelRulesPass(pair, rules)) {
      return { matchMethod: rules?.sections ? 'section' : 'exact', confidence: 1 };
    }
  }

  for (const alias of aliases) {
    const score = fuzzyScore(normLabel, normalizeAlias(alias));
    if (score >= fuzzyThreshold && labelRulesPass(pair, rules)) {
      return { matchMethod: 'fuzzy', confidence: score };
    }
  }

  return null;
}

/** Deterministic Pass 2a: map OCR pairs to canonical fields via alias dictionary. */
export function mapPairsToCanonical(
  pairs: ClaimOcrPair[],
  _insurerCode: InsurerCode | null,
  template: ClaimTemplate,
  fuzzyThreshold = 0.85,
): AliasMapResult {
  const mapped: Record<string, unknown> = {};
  const pairMappings: PairMapping[] = [];
  const claimedFields = new Set<string>();

  for (const pair of pairs) {
    let bestField: string | null = null;
    let bestMatch: { matchMethod: MatchMethod; confidence: number } | null = null;

    for (const field of getAllCanonicalFields()) {
      if (claimedFields.has(field) && !['insurancePeriodEnd', 'timeOfLoss'].includes(field)) {
        continue;
      }
      const match = matchPairToField(pair, field, template, fuzzyThreshold);
      if (!match) continue;
      if (!bestMatch || match.confidence > bestMatch.confidence) {
        bestField = field;
        bestMatch = match;
      }
    }

    if (bestField && bestMatch) {
      pairMappings.push({
        pair,
        canonicalField: bestField,
        matchMethod: bestMatch.matchMethod,
        confidence: bestMatch.confidence,
      });
      const transformed = applyTransform(bestField, pair.value);
      if (typeof transformed === 'string') {
        if (!isEmpty(transformed) && isEmpty(mapped[bestField])) {
          mapped[bestField] = transformed;
          claimedFields.add(bestField);
        }
        if (bestField === 'dateOfLoss' && isEmpty(mapped.timeOfLoss)) {
          const timeVal = applyTransform('timeOfLoss', pair.value);
          if (typeof timeVal === 'string' && !isEmpty(timeVal)) {
            mapped.timeOfLoss = timeVal;
            claimedFields.add('timeOfLoss');
          }
        }
      } else {
        for (const [k, v] of Object.entries(transformed)) {
          if (!isEmpty(v) && isEmpty(mapped[k])) {
            mapped[k] = v;
            claimedFields.add(k);
          }
        }
      }
    } else {
      pairMappings.push({ pair, canonicalField: null, matchMethod: 'none', confidence: 0 });
    }
  }

  const unmappedPairs = pairMappings.filter((m) => m.canonicalField == null).map((m) => m.pair);
  const extraFields = pairMappings.map((m) => ({
    key: m.pair.section ? `${m.pair.section} / ${m.pair.label}` : m.pair.label,
    value: m.pair.value,
    matchedCanonicalField: m.canonicalField,
    confidence: m.confidence,
    sourcePage: m.pair.page,
    matchMethod: m.matchMethod,
  }));

  return { mapped, pairMappings, unmappedPairs, extraFields };
}

/** Replay Pass 2 only from stored raw pairs (no OCR). */
export function replayClaimMapping(
  rawPairs: Array<{ page: number; key: string; value: string; section?: string }>,
  insurerCode: InsurerCode | null,
  template: ClaimTemplate,
  fuzzyThreshold = 0.85,
): AliasMapResult {
  const pairs: ClaimOcrPair[] = rawPairs.map((p) => ({
    page: p.page,
    label: p.key,
    value: p.value ?? '',
    section: p.section ?? 'GENERAL',
  }));
  return mapPairsToCanonical(pairs, insurerCode, template, fuzzyThreshold);
}

export function mergeMappingResults(
  aliasResult: AliasMapResult,
  geminiFields: Record<string, unknown>,
  geminiUnmapped?: Array<{
    ocrLabel: string;
    canonicalField: string | null;
    value: string | null;
    confidence?: number | null;
  }>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...aliasResult.mapped };

  const tryMerge = (field: string, value: unknown): void => {
    if (isEmpty(value) || !isEmpty(out[field])) return;
    const candidate = { ...out, [field]: value };
    const { valid, failedFields } = validateMappedFields(candidate);
    if (!failedFields.includes(field) && !isEmpty(valid[field])) {
      out[field] = valid[field];
    }
  };

  for (const [k, v] of Object.entries(geminiFields)) {
    tryMerge(k, v);
  }
  if (geminiUnmapped?.length) {
    for (const item of geminiUnmapped) {
      if (!item.canonicalField) continue;
      tryMerge(item.canonicalField, item.value);
    }
  }
  return out;
}
