import fs from 'fs';
import path from 'path';

function readClaimAsset(...parts: string[]): string {
  const candidates = [
    path.join(process.cwd(), 'src', 'modules', 'document', ...parts),
    path.join(process.cwd(), 'dist', 'modules', 'document', ...parts),
    path.join(process.cwd(), 'aimodule', 'src', 'modules', 'document', ...parts),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  }
  throw new Error(`Claim asset not found: ${parts.join('/')}`);
}

function loadFewShots(insurer: string): string {
  const key = insurer.toLowerCase();
  try {
    return readClaimAsset('prompts', 'claim-few-shot', `${key}.json`);
  } catch {
    return '[]';
  }
}

export function buildClaimMapPrompt(
  insurer: string,
  templateVersion: string,
  cleanedMarkdown: string,
  fieldHints = '',
): string {
  const schema = readClaimAsset('schema', 'claim', 'claim-form-json-schema.json');
  const fewShots = loadFewShots(insurer);

  const hintsBlock = fieldHints.trim()
    ? `\nPRE-EXTRACTED FIELD HINTS (deterministic OCR parse — prefer these when Gemini output would be null):\n${fieldHints}\n`
    : '';

  return `You are mapping raw OCR text from an Indian motor insurance claim form into a fixed JSON schema.

CONTEXT: This form is from insurer "${insurer}", template version "${templateVersion}".
The form may contain a mix of English and Hindi (Devanagari) text.

RULES (follow all exactly):
1. Do not translate any value. If the source text is in Hindi, keep the value in Hindi exactly as written.
2. If a schema field has no corresponding data in the raw text, set it to null. Do not guess, infer, or fabricate.
3. A diagonal strikethrough mark or a single line drawn across a section/field means "not applicable" — map that field as null. Do not write literal text like "N/A" or "crossed out".
4. Checkbox, tick mark (✓/☑), or circled Yes/No fields must be normalized to the exact string "Yes" or "No". If neither option is clearly marked, use "Unknown".
5. For monetary amounts, extract the raw string exactly as written (e.g. "1,05,922" or "62558.22"), including Indian comma grouping. Do not parse or convert to a number.
6. For dates, extract the raw string exactly as written in whatever format appears on the form. Do not reformat.
7. For the vehicle particulars table, if chassis number or any cell content wraps across two lines within the same cell, join them into a single continuous string.
8. When the same field appears in Hindi and English labels side by side, output ONE value for the canonical field — never duplicate.
9. Ignore digital signature watermarks/stamps overlapping the page.
10. Return ONLY valid JSON matching the schema below. No markdown code fences, no commentary.

SECTION MAPPING (insurer-agnostic — do NOT rely on exact header text):
- loss_details ← accident section labeled any of: "LOSS DETAILS", "DETAILS OF ACCIDENT", "दुर्घटना का विवरण", "दुर्घटना का ब्यौरा", or table rows (a) Date & Time, (b) Place, (c) Speed, (d) Description, (e) Third party
- Map (a)→date_of_loss + time_of_loss (split "date at time" into both fields), (b)→place_of_loss_accident, (c)→speed_of_vehicle_at_accident, (d)→brief_description_of_accident, (e)→third_party_responsible_name_address
- damage_to_insured_vehicle ← Section 6 "DAMAGE TO INSURED VEHICLE" (separate from loss_details; repair cost goes here)
- Tables with | (a) Date & Time | : | value | format → extract row labels semantically, not by exact header string
- driver_details ← "DRIVER AT THE TIME OF ACCIDENT" / "चालक दुर्घटना के समय" section

TARGET SCHEMA:
${schema}

FEW-SHOT EXAMPLES (insurer ${insurer}):
${fewShots}
${hintsBlock}
RAW OCR TEXT TO MAP:
${cleanedMarkdown}`;
}

export function buildClaimMapRetryPrompt(basePrompt: string, zodErrors: string): string {
  return `${basePrompt}

Your previous output failed validation:
${zodErrors}

Fix the JSON and return ONLY valid JSON matching the schema.`;
}
