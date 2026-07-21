import type { ClaimOcrPair } from '../utils/claim/claim-ocr-parse.util.js';
import type { ClaimTemplate } from '../utils/claim/claim-field-aliases.js';
import { FIELD_ALIASES } from '../utils/claim/claim-field-aliases.js';
import { pairsToStructuredText } from '../utils/claim/claim-pairs-to-text.util.js';

function buildAliasExcerpt(fields: string[]): string {
  const lines: string[] = [];
  for (const field of fields) {
    const aliases = FIELD_ALIASES[field];
    if (aliases?.length) {
      lines.push(`${field}: ${aliases.slice(0, 6).join(' | ')}`);
    }
  }
  return lines.join('\n');
}

export function buildClaimMappingPrompt(
  unmappedPairs: ClaimOcrPair[],
  insurerHint?: { insurerCode?: string; insurerName?: string | null },
  template?: ClaimTemplate,
  alreadyMappedFields?: string[],
): string {
  const hint = insurerHint?.insurerCode
    ? `INSURER: ${insurerHint.insurerCode}${insurerHint.insurerName ? ` — ${insurerHint.insurerName}` : ''}\n`
    : '';
  const templateHint = template ? `TEMPLATE: ${template}\n` : '';
  const mappedNote = alreadyMappedFields?.length
    ? `\nALREADY MAPPED (do NOT remap): ${alreadyMappedFields.join(', ')}\n`
    : '';

  const priorityFields = [
    'policyNo', 'claimNo', 'dateOfIntimation', 'insurancePeriodStart',
    'registrationNo', 'insuredName', 'dateOfLoss', 'accidentDescription',
    'driverName', 'drivingLicenseNo', 'engineNo', 'chassisNo',
  ];

  const structured = pairsToStructuredText(unmappedPairs);

  return `
You are mapping REMAINING unmapped OCR label-value pairs from Mistral OCR to canonical motor claim form fields.
Do NOT invent data. Map ONLY the pairs listed below.
Pairs from table cells are positionally correct — do not reassign values across columns.

${hint}${templateHint}${mappedNote}
RULES:
• Map each pair to exactly one canonicalField OR leave canonicalField null.
• Use section context to disambiguate repeated labels like "(a) Name".
• policyNo must NOT receive "Period of insurance" text — that maps to insurancePeriodStart/End.
• claimNo must NOT receive intimation date text — that maps to dateOfIntimation.
• Preserve Hindi/Devanagari values verbatim in accidentDescription.
• Output unmappedMappings array only — do NOT output full schema.

KNOWN ALIAS HINTS:
${buildAliasExcerpt(priorityFields)}

--- UNMAPPED PAIRS START ---
${structured}
--- UNMAPPED PAIRS END ---
`.trim();
}
