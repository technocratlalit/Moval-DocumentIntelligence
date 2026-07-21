/**
 * Smoke test for Mistral Document OCR on claim forms.
 * Run: npx tsx scripts/smoke-mistral-ocr.ts <url-or-local-path>
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import { MistralOcrService } from '../src/infrastructure/mistral/mistral-ocr.service.js';
import { extractHeaderTextFromMistral } from '../src/modules/document/utils/claim/mistral-header.util.js';
import { identifyInsurer, identifyTemplate } from '../src/modules/document/utils/claim/claim-form-identify.util.js';
import { mistralPagesToPairs } from '../src/modules/document/utils/claim/mistral-to-pairs.util.js';

config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: npx tsx scripts/smoke-mistral-ocr.ts <url-or-local-path>');
    process.exit(1);
  }

  const service = MistralOcrService.getInstance();
  if (!service.isEnabled()) {
    console.error('MISTRAL_API_KEY is not set');
    process.exit(1);
  }

  const isUrl = /^https?:\/\//i.test(arg);
  const localFilePath = isUrl ? undefined : path.resolve(arg);
  const sourceUrl = isUrl ? arg : undefined;
  const mimeType = localFilePath?.toLowerCase().endsWith('.png')
    ? 'image/png'
    : localFilePath?.toLowerCase().match(/\.(jpe?g|heic)$/)
      ? 'image/jpeg'
      : 'application/pdf';

  if (localFilePath && !fs.existsSync(localFilePath)) {
    console.error(`File not found: ${localFilePath}`);
    process.exit(1);
  }

  console.log(`Running Mistral OCR on ${isUrl ? sourceUrl : localFilePath} (${mimeType})...`);

  const result = await service.processDocument({ sourceUrl, localFilePath, mimeType });
  const headerText = extractHeaderTextFromMistral(result.pages);
  const insurer = identifyInsurer(headerText);
  const template = identifyTemplate(headerText, insurer.insurerCode);
  const pairs = mistralPagesToPairs(result.pages, template);

  console.log('\n--- Mistral OCR smoke result ---');
  console.log(`Model: ${result.model}`);
  console.log(`Pages: ${result.pageCount}`);
  console.log(`Pairs: ${pairs.length}`);
  console.log(`Insurer: ${insurer.insurerCode} (${insurer.insurerName ?? 'n/a'})`);
  console.log(`Template: ${template}`);
  console.log(`Signature block: ${result.signaturePresent}`);
  console.log(`Avg confidence: ${result.averageConfidence ?? 'n/a'}`);
  console.log(`Low-confidence words: ${result.lowConfidenceWordCount}`);
  console.log(`Latency: ${result.latencyMs}ms`);

  if (pairs.length > 0) {
    console.log('\nSample pairs (first 8):');
    for (const p of pairs.slice(0, 8)) {
      console.log(`  [p${p.page}] ${p.label} => ${p.value}`);
    }
  }

  const fixturesDir = path.join(__dirname, 'fixtures', 'claim-pairs');
  if (fs.existsSync(fixturesDir)) {
    const golden = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('_pairs.json'));
    if (golden.length) {
      console.log(`\nGolden fixtures available (${golden.length}) — compare offline with verify-claim-pairs.ts`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
