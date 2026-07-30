


 // Normalise hypothecation value to null when it means "no loan".
 //Accepts: "--NA--", "NA", "N/A", "NIL", "Not Financed", "none", "null", "--"

export function normaliseHypothecation(val: string | null | undefined): string | null {
  if (!val) return null;
  const upper = val.trim().toUpperCase().replace(/-/g, '');
  if (['NA', 'N/A', 'NIL', 'NOT FINANCED', 'NONE', 'NULL', ''].includes(upper)) return null;
  return val.trim();
}

function addOnNameMatches(name: string | null | undefined, pattern: RegExp): boolean {
  if (!name) return false;
  return pattern.test(name.trim());
}

function deriveCoverOptedFromAddOns(
  covers: unknown,
  pattern: RegExp,
): boolean | undefined {
  if (!Array.isArray(covers)) return undefined;
  const matched = covers.some((c) => {
    if (!c || typeof c !== 'object') return false;
    const row = c as { name?: string | null; opted?: boolean | null };
    if (row.opted === false) return false;
    return addOnNameMatches(row.name, pattern);
  });
  return matched ? true : false;
}

const ENGINE_PROTECT_RE = /engine\s*(and\s*gearbox\s*)?protect/i;
const CONSUMABLES_RE = /consumable/i;

export function inferChannelType(
  agentCode: string | null | undefined,
  existing: string | null | undefined
): string {
  if (existing && existing !== 'null') return existing;
  if (!agentCode) return 'DIRECT';
  const code = agentCode.trim().toUpperCase();
  if (code.startsWith('AGI')) return 'AGENT';
  if (code.startsWith('BRC')) return 'BROKER';
  if (code.startsWith('TMIBASL') || code.startsWith('MSIBPL')) return 'BROKER';
  if (/^\d+$/.test(code)) return 'POSP';
  return 'DIRECT';
}

export function derivePolicyCoverage(policyType: string | null | undefined): string {
  if (!policyType) return 'PACKAGE';
  const t = policyType.toUpperCase();
  if (t.includes('TP') && t.includes('ONLY')) return 'TP_ONLY';
  if (t.includes('OD') && t.includes('ONLY')) return 'OD_ONLY';
  if (t.includes('BUNDLED')) return 'BUNDLED_1_3';
  if (t.includes('COMPREHENSIVE') || t.includes('PACKAGE')) return 'PACKAGE';
  return 'PACKAGE';
}

/** Map legacy period/IDV keys from older extractions into strict spec fields. */
export function normalizeStrictPolicyFields(raw: Record<string, unknown>): Record<string, unknown> {
  const out = { ...raw };

  if (!out.policyStartDate && out.ownDamagePeriodFrom) {
    out.policyStartDate = out.ownDamagePeriodFrom;
  }
  if (!out.policyEndDate && out.ownDamagePeriodTo) {
    out.policyEndDate = out.ownDamagePeriodTo;
  }
  if (!out.policyStartDate && out.liabilityPeriodFrom) {
    out.policyStartDate = out.liabilityPeriodFrom;
  }
  if (!out.policyEndDate && out.liabilityPeriodTo) {
    out.policyEndDate = out.liabilityPeriodTo;
  }
  if (out.totalIdv == null && out.vehicleIdv != null) {
    out.totalIdv = out.vehicleIdv;
  }

  if (typeof out.financierName === 'string' || out.financierName == null) {
    out.financierName = normaliseHypothecation(out.financierName as string | null | undefined);
  }

  if (out.engineProtectOpted == null) {
    const derived = deriveCoverOptedFromAddOns(out.addOnCovers, ENGINE_PROTECT_RE);
    if (derived !== undefined) out.engineProtectOpted = derived;
  }
  if (out.consumablesCoverOpted == null) {
    const derived = deriveCoverOptedFromAddOns(out.addOnCovers, CONSUMABLES_RE);
    if (derived !== undefined) out.consumablesCoverOpted = derived;
  }

  return out;
}

export function verifyPremiumMath(data: {
  totalPremium?: number | null;
  igstAmount?: number | null;
  cgstAmount?: number | null;
  sgstAmount?: number | null;
  stampDuty?: number | null;
  grossPremiumPaid?: number | null;
}): boolean {
  const base = data.totalPremium ?? 0;
  const tax =
    (data.igstAmount ?? 0) +
    (data.cgstAmount ?? 0) +
    (data.sgstAmount ?? 0);
  const duty = data.stampDuty ?? 0;
  const expected = base + tax + duty;
  const actual = data.grossPremiumPaid ?? 0;

  // If all values are zero, skip the check
  if (expected === 0 && actual === 0) return true;

  // Allow ±₹5 rounding tolerance
  return Math.abs(expected - actual) <= 5;
}

// ponytail: offline self-check — run via import in dev; no test framework
if (process.env.POLICY_UTILS_SELF_CHECK === '1') {
  const assert = (cond: boolean, msg: string) => { if (!cond) throw new Error(msg); };
  assert(normaliseHypothecation('Not Financed') === null, 'financier NA');
  assert(normaliseHypothecation('CANARA BANK') === 'CANARA BANK', 'financier bank');
  const norm = normalizeStrictPolicyFields({
    financierName: 'N/A',
    addOnCovers: [{ name: 'Engine Protect Cover', opted: true }],
  });
  assert(norm.financierName === null, 'financier normalized');
  assert(norm.engineProtectOpted === true, 'engine from addOnCovers');
}
