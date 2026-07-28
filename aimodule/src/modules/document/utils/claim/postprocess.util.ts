import type { CanonicalClaim, FlaggedField } from '../../schema/claim/claim-form.schema.js';
import {
  cleanNilString,
  getPath,
  maskAadhar,
  normalizeRegistrationNo,
  parseIndianAmount,
  setPath,
  toIsoDate,
} from './claim-normalize.util.js';

export interface PostprocessDiff {
  path: string;
  before: unknown;
  after: unknown;
}

const DATE_ISO_PATHS: Array<{ raw: string; iso: string }> = [
  { raw: 'loss_details.date_of_loss', iso: 'loss_details.date_of_loss_iso' },
  { raw: 'driver_details.license_valid_upto_expiry_date', iso: 'driver_details.license_valid_upto_expiry_date_iso' },
  { raw: 'police_fir_details.date_of_reporting', iso: 'police_fir_details.date_of_reporting_iso' },
  { raw: 'declaration.date', iso: 'declaration.date_iso' },
  { raw: 'policy_details.period_of_insurance_from', iso: 'policy_details.period_of_insurance_from_iso' },
  { raw: 'policy_details.period_of_insurance_to', iso: 'policy_details.period_of_insurance_to_iso' },
];

function walkStrings(obj: unknown, fn: (s: string) => string | null): unknown {
  if (obj == null) return obj;
  if (typeof obj === 'string') return fn(obj);
  if (Array.isArray(obj)) return obj.map((v) => walkStrings(v, fn));
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = walkStrings(v, fn);
    }
    return out;
  }
  return obj;
}

export function postprocessClaimForm(
  raw: Record<string, unknown>,
  uploadDate = new Date(),
): { result: Record<string, unknown>; diff: PostprocessDiff[] } {
  const result = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
  const diff: PostprocessDiff[] = [];

  const record = (path: string, before: unknown, after: unknown) => {
    if (before !== after && (before != null || after != null)) {
      diff.push({ path, before, after });
    }
    setPath(result, path, after);
  };

  // Trim / null-out NA values recursively on string leaves
  const cleaned = walkStrings(result, (s) => cleanNilString(s)) as Record<string, unknown>;
  Object.assign(result, cleaned);

  const regNo = getPath(result, 'vehicle_details.registration_no') as string | null;
  const regNorm = normalizeRegistrationNo(regNo);
  record('vehicle_details.registration_no_normalized', getPath(result, 'vehicle_details.registration_no_normalized'), regNorm);

  for (const { raw: rawPath, iso } of DATE_ISO_PATHS) {
    const rawVal = getPath(result, rawPath) as string | null;
    const isoVal = toIsoDate(rawVal);
    if (isoVal) record(iso, getPath(result, iso), isoVal);
  }

  const amountRaw = getPath(result, 'loss_details.estimated_cost_of_repairs') as string | null;
  const amountNum = parseIndianAmount(amountRaw);
  if (amountNum != null) {
    record('loss_details.estimated_cost_of_repairs_numeric', getPath(result, 'loss_details.estimated_cost_of_repairs_numeric'), amountNum);
  }

  const aadhar = getPath(result, 'insured_details.aadhar_no') as string | null;
  if (aadhar) {
    record('insured_details.aadhar_no', aadhar, maskAadhar(aadhar));
  }

  // Inject meta from classify if present at top level
  if (result.meta && typeof result.meta === 'object') {
    const meta = result.meta as Record<string, unknown>;
    if (meta.source_insurer == null && result._classifyInsurer) {
      meta.source_insurer = result._classifyInsurer;
      delete result._classifyInsurer;
    }
  }

  void uploadDate; // used by validateCrossFields
  return { result, diff };
}

function normalizeName(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9\u0900-\u097F]/g, '');
}

function fuzzyNameMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return true;
  return na === nb || na.includes(nb) || nb.includes(na);
}

export function validateCrossFields(
  result: Record<string, unknown>,
  uploadDate = new Date(),
): FlaggedField[] {
  const flags: FlaggedField[] = [];

  const insuredName = getPath(result, 'insured_details.name') as string | null;
  const signature = getPath(result, 'declaration.signature_of_insured') as string | null;
  const insuredType = getPath(result, 'insured_details.insured_type') as string | null;

  if (signature && insuredName && !fuzzyNameMatch(signature, insuredName) && insuredType !== 'company') {
    flags.push({
      path: 'declaration.signature_of_insured',
      reason: 'Signature name does not match insured name',
    });
  }

  const datePaths = [
    'loss_details.date_of_loss_iso',
    'declaration.date_iso',
    'driver_details.license_valid_upto_expiry_date_iso',
  ];
  const today = uploadDate.toISOString().slice(0, 10);

  for (const p of datePaths) {
    const iso = getPath(result, p) as string | null;
    if (iso && iso > today) {
      flags.push({ path: p.replace('_iso', ''), reason: 'Date appears to be in the future' });
    }
  }

  const lossIso = getPath(result, 'loss_details.date_of_loss_iso') as string | null;
  const periodFrom = getPath(result, 'policy_details.period_of_insurance_from_iso') as string | null;
  const periodTo = getPath(result, 'policy_details.period_of_insurance_to_iso') as string | null;

  if (lossIso && periodFrom && periodTo && (lossIso < periodFrom || lossIso > periodTo)) {
    flags.push({
      path: 'loss_details.date_of_loss',
      reason: 'Loss date outside policy insurance period',
    });
  }

  const regNorm = getPath(result, 'vehicle_details.registration_no_normalized') as string | null;
  if (regNorm && regNorm.length > 0 && regNorm.length < 6) {
    flags.push({
      path: 'vehicle_details.registration_no',
      reason: 'Registration number format looks incomplete',
      confidence: 0.4,
    });
  }

  return flags;
}

export function computeOverallConfidence(
  fieldConfidence: Array<{ path: string; confidence: number }>,
): number {
  if (!fieldConfidence.length) return 0.75;
  const sum = fieldConfidence.reduce((a, f) => a + f.confidence, 0);
  return Math.round((sum / fieldConfidence.length) * 100) / 100;
}
