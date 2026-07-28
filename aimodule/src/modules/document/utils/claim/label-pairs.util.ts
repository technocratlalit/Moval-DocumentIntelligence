import type { MistralOcrPage } from '../../../../infrastructure/mistral/mistral-ocr.types.js';

export interface ClaimRawPair {
  section: string;
  label: string;
  labelRaw?: string;
  value: string | null;
  canonicalHint?: string;
}

const LABEL_VALUE_RE = /^(.{2,80}?)[\s:：]+(.+)$/s;
const BILINGUAL_SPLIT_RE = /\s*[\/|·]\s*/;
const NA_VALUES = new Set(['na', 'n/a', 'nil', 'no', '-', '—', 'none']);

const LABEL_HINTS: Array<{ pattern: RegExp; hint: string }> = [
  { pattern: /policy\s*no/i, hint: 'policy_details.policy_no' },
  { pattern: /claim\s*no/i, hint: 'policy_details.claim_no' },
  { pattern: /certificate\s*no/i, hint: 'policy_details.certificate_no' },
  { pattern: /cover\s*note/i, hint: 'policy_details.cover_note_no' },
  { pattern: /^(नाम|name)$/i, hint: 'insured_details.name' },
  { pattern: /address/i, hint: 'insured_details.address' },
  { pattern: /mobile|phone|telephone/i, hint: 'insured_details.mobile' },
  { pattern: /vehicle\s*no|registration|regn/i, hint: 'vehicle_details.registration_no' },
  { pattern: /engine\s*no/i, hint: 'vehicle_details.engine_no' },
  { pattern: /chassis\s*no/i, hint: 'vehicle_details.chassis_no' },
  { pattern: /date.*accident|date.*loss|date.*occurrence/i, hint: 'loss_details.date_of_loss' },
  { pattern: /place.*loss|place.*accident/i, hint: 'loss_details.place_of_loss_accident' },
  { pattern: /type.*loss/i, hint: 'loss_details.type_of_loss' },
  { pattern: /estimated.*cost|cost.*repair/i, hint: 'loss_details.estimated_cost_of_repairs' },
  { pattern: /driving\s*licen/i, hint: 'driver_details.driving_license_no' },
  { pattern: /valid\s*up\s*to/i, hint: 'driver_details.license_valid_upto_expiry_date' },
];

/** Pick display label from bilingual raw label. */
export function normalizeBilingualLabel(raw: string, formLanguage: 'hindi' | 'english' | 'mixed' = 'english'): string {
  const parts = raw.split(BILINGUAL_SPLIT_RE).map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return raw.trim();

  const hasDevanagari = (s: string) => /[\u0900-\u097F]/.test(s);
  const english = parts.find((p) => !hasDevanagari(p));
  const hindi = parts.find((p) => hasDevanagari(p));

  if (formLanguage === 'hindi' && hindi) return hindi;
  if (english) return english;
  return parts[0];
}

function guessCanonicalHint(label: string): string | undefined {
  for (const { pattern, hint } of LABEL_HINTS) {
    if (pattern.test(label)) return hint;
  }
  return undefined;
}

function cleanValue(val: string | null): string | null {
  if (val == null) return null;
  const t = val.trim();
  if (!t || NA_VALUES.has(t.toLowerCase())) return null;
  return t;
}

function parseBlockToPair(section: string, content: string, formLanguage: 'hindi' | 'english' | 'mixed'): ClaimRawPair | null {
  const line = content.replace(/\n/g, ' ').trim();
  const m = line.match(LABEL_VALUE_RE);
  if (!m) return null;

  const labelRaw = m[1].trim();
  const label = normalizeBilingualLabel(labelRaw, formLanguage);
  const value = cleanValue(m[2].trim());
  if (!label) return null;

  return {
    section,
    label,
    labelRaw: labelRaw !== label ? labelRaw : undefined,
    value,
    canonicalHint: guessCanonicalHint(label),
  };
}

/** Build deterministic label-value pairs from Mistral blocks (one label per concept). */
export function mistralPagesToRawPairs(
  pages: MistralOcrPage[],
  formLanguage: 'hindi' | 'english' | 'mixed' = 'english',
): ClaimRawPair[] {
  const pairs: ClaimRawPair[] = [];
  let currentSection = 'Header';

  for (const page of pages) {
    const pageLabel = `Page ${(page.index ?? 0) + 1}`;

    for (const block of page.blocks ?? []) {
      const content = (block.content ?? '').trim();
      if (!content) continue;

      if (block.type === 'title') {
        currentSection = content.replace(/^#+\s*/, '').trim() || pageLabel;
        continue;
      }

      if (block.type === 'text' || block.type === 'list') {
        const pair = parseBlockToPair(currentSection, content, formLanguage);
        if (pair) pairs.push(pair);
      }
    }

    // Header line with multiple fields: Policy No ... Vehicle No ...
    const headerLine = page.blocks
      ?.filter((b) => b.type === 'text')
      .map((b) => b.content)
      .find((c) => /policy\s*no/i.test(c) && /vehicle/i.test(c));

    if (headerLine) {
      const policyM = headerLine.match(/policy\s*no[:\s]*([A-Z0-9]+)/i);
      const vehicleM = headerLine.match(/vehicle\s*no[:\s]*([A-Z0-9]+)/i);
      const engineM = headerLine.match(/engine\s*no[:\s]*([A-Z0-9]+)/i);
      const chassisM = headerLine.match(/chassis\s*no[:\s]*([A-Z0-9]+)/i);
      if (policyM) pairs.push({ section: 'Header', label: 'Policy No', value: policyM[1], canonicalHint: 'policy_details.policy_no' });
      if (vehicleM) pairs.push({ section: 'Header', label: 'Vehicle No', value: vehicleM[1], canonicalHint: 'vehicle_details.registration_no' });
      if (engineM) pairs.push({ section: 'Header', label: 'Engine No', value: engineM[1], canonicalHint: 'vehicle_details.engine_no' });
      if (chassisM) pairs.push({ section: 'Header', label: 'Chassis No', value: chassisM[1], canonicalHint: 'vehicle_details.chassis_no' });
    }
  }

  // Dedupe by canonicalHint — keep last non-null
  const byHint = new Map<string, ClaimRawPair>();
  for (const p of pairs) {
    const key = p.canonicalHint ?? `${p.section}::${p.label}`;
    const existing = byHint.get(key);
    if (!existing || (p.value && !existing.value)) byHint.set(key, p);
    else if (p.value) byHint.set(key, p);
  }

  return [...byHint.values()];
}

export function pairsToStructuredText(pairs: ClaimRawPair[]): string {
  const bySection = new Map<string, ClaimRawPair[]>();
  for (const p of pairs) {
    const list = bySection.get(p.section) ?? [];
    list.push(p);
    bySection.set(p.section, list);
  }

  const lines: string[] = [];
  for (const [section, sectionPairs] of bySection) {
    lines.push(`\n## ${section}`);
    for (const p of sectionPairs) {
      lines.push(`${p.label}: ${p.value ?? ''}`);
    }
  }
  return lines.join('\n');
}
