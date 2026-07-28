import {
  CLAIM_TEMPLATES,
  formatLabelKeyTable,
} from '../utils/claim/motor-claim-template-registry.js';
import { EXTRA_FIELDS_RULE, REGIONAL_LANGUAGE_FEW_SHOTS } from './motor-claim.few-shot.js';

const BASE_PROMPT = `
You are an expert Indian Motor Insurance Claim Form extractor (UIIC, OIC, NIAC, NIC).
Analyze all PDF pages/images and return ONE flat JSON record.

INPUT: PDF (all pages) or ordered images. Stitch every page before leaving fields null.

GATING:
• isCorrectDocumentType = true for motor claim forms only.
• detectedDocumentType = MOTOR_CLAIM_FORM | INSURANCE_POLICY | DRIVING_LICENSE | RC_BOOK | WORKSHOP_BILL | UNKNOWN
• invalidPageIndices = 1-indexed wrong pages.

TEMPLATE DETECTION — set sourceTemplate: UIIC | OIC | NIAC | NIC
${Object.values(CLAIM_TEMPLATES)
  .map((t) => `• ${t.id}: ${t.detect.map((d) => `"${d}"`).join(' or ')}`)
  .join('\n')}

FORM VARIANT — set formVariant:
• standard — default multi-section bilingual form (UIIC/OIC 4-page layout)
• one_page — single-page compact English UIIC (labels: "Date of Loss", "Estimate Amount", "Name & Address of Workshop")
• combined — OIC multi-page PDF with all sections stitched (P1 insured → P4 declaration)

ACCURACY RULES:
• BLANK / N/A / diagonal slash across section → null for that section. Never fabricate dates.
• "NO" written in a date field → null (not a date).
• Combined date+time "18.06.2026 at 10.30 AM" → accidentDate + accidentTime.
• Multi-line workshop address → concatenate into inspectionWorkshopDetails.
• Numeric cleanup: strip ₹, Rs., km/h from numbers.

CONFIDENCE:
• confidenceScore 0.0–1.0. requiresHumanReview if < 0.75, wrong type, or missing policyNumber/registrationNo/driverName/accidentDate.
`;

const ANTI_SWAP_RULES = `
=== ANTI-SWAP (UIIC/OIC standard & combined — sections 5 & 6) ===
• accidentDescription = §5(d) narrative ONLY — NOT workshop address.
• damageDescription = §6(a) e.g. "As per Estimate" — NOT inspection location.
• inspectionWorkshopDetails = §6(c) workshop name/address ONLY.
• Keywords JUNCTION, RLY, RAILWAY, STATION, NEAR, WORKSHOP → inspectionWorkshopDetails only.
`;

const UIIC_STANDARD = `
=== UIIC STANDARD (4-page bilingual) ===
${CLAIM_TEMPLATES.UIIC.pages.join('; ')}
Period of Insurance → policyStartDate + policyEndDate. Registration preserve JH-10-AR (digit 10 not HO).
| Printed label | JSON key |
${formatLabelKeyTable('UIIC')}
`;

const UIIC_ONE_PAGE = `
=== UIIC ONE-PAGE (compact English) ===
Set formVariant = "one_page". Single page with Date of Loss, Estimate Amount, workshop block.
| Printed label | JSON key |
${formatLabelKeyTable('UIIC', 'one_page')}
Pin Code, State, Aadhar No, GST NO, Workshop Mobile, injury/theft yes-no → extraFields.
`;

const OIC_STANDARD = `
=== OIC STANDARD ===
${CLAIM_TEMPLATES.OIC.pages.join('; ')}
Certificate/Policy No → policyNumber. दावा सं० → claimNumber. Period "15.01.2025 to 14.01.2026" → policyStartDate/policyEndDate.
| Printed label | JSON key |
${formatLabelKeyTable('OIC')}
`;

const OIC_COMBINED = `
=== OIC COMBINED (multi-page PDF) ===
Set formVariant = "combined". Read ALL pages — merge insured (P1), driver (P2), accident (P3), witness/declaration (P4).
Diagonal slashes across sections 8–10 (injury/witness/theft) → all fields in those sections = null.
| Printed label | JSON key |
${formatLabelKeyTable('OIC', 'combined')}
`;

const NIAC_BLOCK = `
=== NIAC ===
${CLAIM_TEMPLATES.NIAC.pages.join('; ')}
Policy/Cover Note No → policyNumber. Insured name+address split. Accident date+time split.
Brief particulars → accidentDescription (any script verbatim). Vehicle table → registrationNo, engineNo, chassisNo.
| Printed label | JSON key |
${formatLabelKeyTable('NIAC')}
`;

const NIC_BLOCK = `
=== NIC ===
${CLAIM_TEMPLATES.NIC.pages.join('; ')}
Header: पॉलिसी संख्या → policyNumber, वाहन संख्या → registrationNo.
§2: घटनास्थल → accidentLocation, हानि का प्रकार → typeOfLoss, narrative → accidentDescription.
§3: driver fields. §5: police (ना = false). §6: declaration.
| Printed label | JSON key |
${formatLabelKeyTable('NIC')}
`;

export const CLAIM_FORM_EXTRACTION_SYSTEM_PROMPT = [
  BASE_PROMPT,
  REGIONAL_LANGUAGE_FEW_SHOTS,
  EXTRA_FIELDS_RULE,
  ANTI_SWAP_RULES,
  UIIC_STANDARD,
  UIIC_ONE_PAGE,
  OIC_STANDARD,
  OIC_COMBINED,
  NIAC_BLOCK,
  NIC_BLOCK,
].join('\n');

export const getMotorClaimPrompt = (): string => CLAIM_FORM_EXTRACTION_SYSTEM_PROMPT;
