/**
 * Live E2E smoke test for claim extraction with stage debug dumps.
 *
 * Usage:
 *   CLAIM_DEBUG_DUMP=true npx tsx scripts/smoke-claim-local.ts --pdf "pdf/CLAIM FORM- UIIC-II.pdf"
 *   npx tsx scripts/smoke-claim-local.ts --pdf path/to/form.pdf --skip-prescreen
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '..', '.env') });
config({ path: path.join(__dirname, '..', '.env') });

const args = process.argv.slice(2);
const pdfIdx = args.indexOf('--pdf');
const pdfPath = pdfIdx >= 0 ? args[pdfIdx + 1] : path.join(__dirname, '..', 'pdf', 'CLAIM FORM- UIIC-II.pdf');
const skipPrescreen = args.includes('--skip-prescreen');

if (!fs.existsSync(pdfPath)) {
  console.error(`PDF not found: ${pdfPath}`);
  process.exit(1);
}

process.env.CLAIM_DEBUG_DUMP = process.env.CLAIM_DEBUG_DUMP ?? 'true';
process.env.CLAIM_DEBUG_DUMP_DIR = process.env.CLAIM_DEBUG_DUMP_DIR ?? path.join(__dirname, '..', 'tmp', 'claim-debug');

async function main() {
  const { ClaimFormExtractor } = await import('../src/modules/document/extractor/claim-form.extractor.js');
  const { _config } = await import('../src/config/config.js');

  if (!_config.MISTRAL_API_KEY || !_config.GEMINI_API_KEY) {
    console.error('Set MISTRAL_API_KEY and GEMINI_API_KEY in .env');
    process.exit(1);
  }

  if (skipPrescreen) {
    process.env.PRESCREEN_ENABLED = 'false';
  }

  const mimeType = 'application/pdf';
  const input = {
    fileData: { fileUri: '', mimeType },
    pageCount: 1,
    sourceUrl: '',
    localPdfPath: pdfPath,
    localFilePath: pdfPath,
  };

  console.log(`Running claim extraction on: ${pdfPath}`);
  console.log(`CLAIM_DEBUG_DUMP=${process.env.CLAIM_DEBUG_DUMP}`);
  console.log(`CLAIM_DEBUG_DUMP_DIR=${process.env.CLAIM_DEBUG_DUMP_DIR}`);

  const extractor = new ClaimFormExtractor();
  const result = await extractor.extract(input);

  console.log('\n--- Final result summary ---');
  console.log(JSON.stringify({
    status: result.status,
    insurer: result.meta?.source_insurer,
    policyNo: result.policy_details?.policy_no,
    vehicleNo: result.vehicle_details?.registration_no,
    confidenceScore: result.confidenceScore,
    flaggedFields: result.extractionMeta?.flaggedFields?.length ?? 0,
    debugStages: result.extractionMeta?.debugStages,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
