import type { ClaimRawPair } from './label-pairs.util.js';

export interface ClaimFieldHint {
  canonicalHint: string;
  label: string;
  value: string;
  source: 'table' | 'pair';
}

const LOSS_ROW_RULES: Array<{ pattern: RegExp; hint: string; splitDateTime?: boolean }> = [
  { pattern: /date.*time|date.*accident|date.*loss|date.*occurrence/i, hint: 'loss_details.date_of_loss', splitDateTime: true },
  { pattern: /place(\s|$)|place.*accident|place.*loss|स्थान/i, hint: 'loss_details.place_of_loss_accident' },
  { pattern: /speed.*accident|speed.*vehicle/i, hint: 'loss_details.speed_of_vehicle_at_accident' },
  { pattern: /description.*accident|short.*description|brief.*description|विवरण/i, hint: 'loss_details.brief_description_of_accident' },
  { pattern: /third.party.*responsible|third.party/i, hint: 'loss_details.third_party_responsible_name_address' },
  { pattern: /type.*loss/i, hint: 'loss_details.type_of_loss' },
];

function splitDateTime(value: string): Array<{ hint: string; value: string }> {
  const atMatch = value.match(/^(.+?)\s+at\s+(.+)$/i);
  if (atMatch) {
    return [
      { hint: 'loss_details.date_of_loss', value: atMatch[1].trim() },
      { hint: 'loss_details.time_of_loss', value: atMatch[2].trim() },
    ];
  }
  return [{ hint: 'loss_details.date_of_loss', value: value.trim() }];
}

function hintFromLabel(label: string, value: string): ClaimFieldHint[] {
  const trimmed = value.trim();
  if (!trimmed || /^(na|n\/a|nil|no|-)$/i.test(trimmed)) return [];

  for (const { pattern, hint, splitDateTime: splitDt } of LOSS_ROW_RULES) {
    if (!pattern.test(label)) continue;
    if (splitDt) {
      return splitDateTime(trimmed).map((p) => ({
        canonicalHint: p.hint,
        label,
        value: p.value,
        source: 'table' as const,
      }));
    }
    return [{ canonicalHint: hint, label, value: trimmed, source: 'table' }];
  }
  return [];
}

function parseTableRow(line: string): { label: string; value: string } | null {
  const cells = line.split('|').map((c) => c.trim()).filter((c) => c.length > 0);
  if (cells.length < 2) return null;
  if (cells.every((c) => /^-+$/.test(c))) return null;

  let label = cells[0];
  let value: string;
  if (cells[1] === ':' && cells.length >= 3) {
    value = cells.slice(2).join(' ').trim();
  } else {
    value = cells[cells.length - 1].trim();
  }
  label = label.replace(/^\([a-z]\)\s*/i, '').trim();
  if (!label || !value || label === value) return null;
  return { label, value };
}

/** Scan markdown tables for accident-section row labels → loss_details hints. */
export function extractLossHintsFromMarkdown(markdown: string): ClaimFieldHint[] {
  const hints: ClaimFieldHint[] = [];
  const lines = markdown.split('\n');

  for (const line of lines) {
    if (!line.includes('|')) continue;
    const row = parseTableRow(line);
    if (!row) continue;
    hints.push(...hintFromLabel(row.label, row.value));
  }

  return dedupeHints(hints);
}

function dedupeHints(hints: ClaimFieldHint[]): ClaimFieldHint[] {
  const byPath = new Map<string, ClaimFieldHint>();
  for (const h of hints) {
    const existing = byPath.get(h.canonicalHint);
    if (!existing || h.value.length > existing.value.length) byPath.set(h.canonicalHint, h);
  }
  return [...byPath.values()];
}

export function hintsFromRawPairs(pairs: ClaimRawPair[]): ClaimFieldHint[] {
  const hints: ClaimFieldHint[] = [];
  for (const p of pairs) {
    if (!p.canonicalHint?.startsWith('loss_details.') || !p.value) continue;
    hints.push({
      canonicalHint: p.canonicalHint,
      label: p.label,
      value: p.value,
      source: 'pair',
    });
  }
  return hints;
}

export function mergeFieldHints(rawPairs: ClaimRawPair[], markdown: string): ClaimFieldHint[] {
  return dedupeHints([...extractLossHintsFromMarkdown(markdown), ...hintsFromRawPairs(rawPairs)]);
}

export function fieldHintsToText(hints: ClaimFieldHint[]): string {
  if (!hints.length) return '';
  return hints.map((h) => `${h.canonicalHint}: ${h.value}`).join('\n');
}
