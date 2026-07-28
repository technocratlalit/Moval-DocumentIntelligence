export const CLAIM_CLASSIFY_PROMPT = `You are classifying an Indian motor insurance claim form from the first page image.

Identify:
- insurer: UIIC | OIC | NIAC | NIC | unknown
- template_version: optional metadata — roman numeral, print code, or date stamp if visible (e.g. "I", "II", "Unique-Pat/10,000/08-2017", "13.08.2008"); otherwise use "standard"
- form_language: hindi | english | mixed | unknown

Insurer identification (page-1 cues):
- UIIC: "UNITED INDIA INSURANCE CO. LTD.", bilingual Hindi+English, vehicle table with Make/Engine/Chassis/Registration columns
- OIC: "THE ORIENTAL INSURANCE COMPANY LTD.", gear logo, "MOTOR CLAIM FORM"
- NIAC: "THE NEW INDIA ASSURANCE CO. LTD."
- NIC: "NATIONAL INSURANCE COMPANY LIMITED", often compact English layout

Rules:
- insurer is REQUIRED — use "unknown" only if no insurer logo/name is identifiable
- template_version is OPTIONAL — if no version label is visible on page 1, return "standard" (never "unknown")
- form_language: use "unknown" only if truly unclear
- Return ONLY valid JSON: { "insurer": "...", "template_version": "...", "form_language": "..." }`;

const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    insurer: { type: 'string', enum: ['UIIC', 'OIC', 'NIAC', 'NIC', 'unknown'] },
    template_version: { type: 'string' },
    form_language: { type: 'string', enum: ['hindi', 'english', 'mixed', 'unknown'] },
  },
  required: ['insurer', 'template_version', 'form_language'],
};

export function getClaimClassifySchema() {
  return CLASSIFY_SCHEMA;
}
