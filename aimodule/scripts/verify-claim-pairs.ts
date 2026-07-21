/**
 * Quick verification for claim OCR pair parsing + alias mapping (no API calls).
 * Run: npx tsx scripts/verify-claim-pairs.ts
 */
import { parseHtmlToPairs, parseMarkdownToPairs, splitUiicSectionBlob, stripUiicValuePrefix } from '../src/modules/document/utils/claim/claim-ocr-parse.util.js';
import { mapPairsToCanonical } from '../src/modules/document/utils/claim/claim-alias-mapper.util.js';
import { validateMappedFields } from '../src/modules/document/utils/claim/claim-field-validators.util.js';
import { pairsToStructuredText } from '../src/modules/document/utils/claim/claim-pairs-to-text.util.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OIC_HTML = `
<h1>1. INSURED</h1>
<table>
<tr><td>(a) Name</td><td>Mohammad Taiyab Ansari</td></tr>
<tr><td>(b) Address for correspondence</td><td>At-76, Ali Nagar, Wasseypur, Dhanbad</td></tr>
<tr><td>Certificate/Policy No.</td><td>332703/81/2025/2909</td></tr>
<tr><td>Period of Insurance</td><td>02/01/25 to 06/01/26</td></tr>
</table>
<h1>2. INSURED VEHICLE</h1>
<table>
<tr><td>Regd. No.</td><td>BR-01-AB-1234</td></tr>
<tr><td>Engine No.</td><td>DBA1527667</td></tr>
<tr><td>Chassis No.</td><td>MA3FKEB1S00644814</td></tr>
</table>
<h1>3. DRIVER AT TIME OF ACCIDENT</h1>
<table>
<tr><td>(a) Name</td><td>Taiyab Ansari</td></tr>
<tr><td>(g) Driving Licence Number</td><td>JH1020040004756</td></tr>
</table>
<h1>4. DETAILS OF ACCIDENT</h1>
<table>
<tr><td>Date and Time</td><td>07/02/25 10:30 AM</td></tr>
<tr><td>(b) Place</td><td>Dhanbad</td></tr>
<tr><td>Short description of the accident</td><td>गाड़ी सामने से टकरा गई और क्षति हुई</td></tr>
<tr><td>Full details of damage</td><td>Front bumper and headlight damaged</td></tr>
</table>
`;

const NIAC_PAIRS = [
  { page: 1, section: 'GENERAL', label: 'Policy No.', value: '7700008/25205005609' },
  { page: 1, section: 'GENERAL', label: 'Period of insurance', value: '18/04/2025 to 17/04/2026' },
  { page: 1, section: 'GENERAL', label: 'Date & Time of Intimation', value: '11/06/2025' },
  { page: 1, section: 'VEHICLE', label: 'Regd. No.', value: 'JH41OCX9061' },
];

const NIAC_MD = `
## INSURED
| (a) Name | Raj Kumar Singh |
| Policy No. | 1234567890 |
| Regd. No. | DL-01-CA-5678 |
## ACCIDENT
| Date and Time | 15/03/25 2:00 PM |
| Short description of the accident | दुर्घटना में वाहन क्षतिग्रस्त |
`;

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`FAIL: ${msg}`);
}

function run(): void {
  const oicPairs = parseHtmlToPairs(OIC_HTML, 1);
  assert(oicPairs.length >= 10, `OIC pairs count ${oicPairs.length} >= 10`);
  assert(!oicPairs.some((p) => /<\/?td>/i.test(p.value)), 'OIC pairs must not contain HTML tags');

  const oicMapped = mapPairsToCanonical(oicPairs, 'OIC', 'OIC_ENGLISH');
  const oicValid = validateMappedFields(oicMapped.mapped).valid;
  assert(oicValid.policyNo === '332703/81/2025/2909', 'policyNo');
  assert(oicValid.insuredName === 'Mohammad Taiyab Ansari', 'insuredName');
  assert(oicValid.engineNo === 'DBA1527667', 'engineNo');
  assert(oicValid.driverName === 'Taiyab Ansari', 'driverName');
  assert(oicValid.drivingLicenseNo === 'JH1020040004756', 'drivingLicenseNo');
  assert(oicValid.dateOfLoss === '07/02/25', 'dateOfLoss');
  assert(String(oicValid.accidentDescription).includes('गाड़ी'), 'accidentDescription Hindi');

  const structured = pairsToStructuredText(oicPairs);
  assert(structured.includes('Certificate/Policy No.'), 'structured text has policy label');

  const niacMapped = mapPairsToCanonical(NIAC_PAIRS, 'NIAC', 'NIAC_TABLE');
  const niacValid = validateMappedFields(niacMapped.mapped).valid;
  assert(niacValid.policyNo === '7700008/25205005609', 'NIAC policyNo');
  assert(niacValid.insurancePeriodStart === '18/04/2025', 'NIAC insurancePeriodStart');
  assert(niacValid.insurancePeriodEnd === '17/04/2026', 'NIAC insurancePeriodEnd');
  assert(niacValid.dateOfIntimation === '11/06/2025', 'NIAC dateOfIntimation');
  assert(niacValid.registrationNo === 'JH41OCX9061', 'NIAC registrationNo');
  assert(!String(niacValid.policyNo).includes('Period of insurance'), 'NIAC no field-shift policyNo');

  const niacPairs = parseMarkdownToPairs(NIAC_MD, 1);
  const niacMdMapped = mapPairsToCanonical(niacPairs, 'NIAC', 'NIAC_TABLE');
  assert(niacMdMapped.mapped.policyNo === '1234567890', 'NIAC MD policyNo');

  const oicFixturePath = path.join(__dirname, '../fixtures/claim/golden/OIC_nand_kumar_pairs.json');
  const oicFixture = JSON.parse(fs.readFileSync(oicFixturePath, 'utf-8')) as {
    pairs: Array<{ page: number; section: string; label: string; value: string }>;
    expected: Record<string, string>;
  };
  const nandMapped = mapPairsToCanonical(oicFixture.pairs, 'OIC', 'OIC_ENGLISH');
  const nandValid = validateMappedFields(nandMapped.mapped).valid;
  assert(nandValid.policyNo === oicFixture.expected.policyNo, 'OIC Nand Kumar policyNo');
  assert(nandValid.insurancePeriodStart === '15.01.2025', 'OIC Nand Kumar insurancePeriodStart');
  assert(nandValid.insurancePeriodEnd === '14.01.2026', 'OIC Nand Kumar insurancePeriodEnd');
  assert(nandValid.drivingLicenseNo === oicFixture.expected.drivingLicenseNo, 'OIC Nand Kumar drivingLicenseNo');
  assert(nandValid.dateOfLoss === '18.06.2026', 'OIC Nand Kumar dateOfLoss');
  assert(nandValid.timeOfLoss === '10:30 AM', 'OIC Nand Kumar timeOfLoss');
  assert(
    String(nandValid.accidentDescriptionEnglish).includes('steel gate'),
    'OIC Nand Kumar accidentDescriptionEnglish',
  );

  const stripped = stripUiicValuePrefix('(a)', 'Name CHANDAN SINGH');
  assert(stripped.label === 'Name' && stripped.value === 'CHANDAN SINGH', 'UIIC value prefix strip');

  const accidentBlob =
    '(a) Date & Time 30/08/2015 6:30 PM (b) Place PORDAN (c) Speed of your vehicle at the time of accident 40 K.M.P.H.';
  const accidentPairs = splitUiicSectionBlob('5. DETAILS OF ACCIDENT', accidentBlob, 3);
  const accidentMapped = mapPairsToCanonical(accidentPairs, 'UIIC', 'UIIC_BILINGUAL');
  const accidentValid = validateMappedFields(accidentMapped.mapped).valid;
  assert(accidentValid.dateOfLoss === '30/08/2015', 'UIIC accident dateOfLoss');
  assert(accidentValid.placeOfAccident === 'PORDAN', 'UIIC accident placeOfAccident');

  console.log('OK — OIC pairs:', oicPairs.length, '| alias mapped:', oicMapped.pairMappings.filter((m) => m.canonicalField).length);
  console.log('OK — NIAC regression passed, no field-shift on policyNo');
  console.log('OK — OIC Nand Kumar reference sample passed');
  console.log('OK — UIIC section blob split passed');
}

run();
