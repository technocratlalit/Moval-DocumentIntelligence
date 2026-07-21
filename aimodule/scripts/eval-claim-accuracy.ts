/**
 * Evaluate claim alias mapper against golden fixtures (pairs + expected fields).
 * Run: npx tsx scripts/eval-claim-accuracy.ts
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { mapPairsToCanonical } from '../src/modules/document/utils/claim/claim-alias-mapper.util.js';
import { validateMappedFields } from '../src/modules/document/utils/claim/claim-field-validators.util.js';
import { computeMappingConfidence } from '../src/modules/document/utils/claim/claim-mapping-confidence.util.js';
import type { ClaimOcrPair } from '../src/modules/document/utils/claim/claim-ocr-parse.util.js';
import type { ClaimTemplate } from '../src/modules/document/utils/claim/claim-field-aliases.js';
import type { InsurerCode } from '../src/modules/document/utils/claim/claim-form-identify.util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = path.join(__dirname, '../fixtures/claim/golden');

interface PairRegressionFixture {
  description?: string;
  type?: string;
  insurer?: InsurerCode;
  template?: ClaimTemplate;
  pairs: ClaimOcrPair[];
  expected: Record<string, string>;
  mustNotMatch?: Record<string, string[]>;
  expectedExtraFieldKeys?: string[];
}

function normalizeForCompare(val: unknown): string | null {
  if (val == null || val === '') return null;
  return String(val).replace(/\s+/g, ' ').trim();
}

function runPairRegressionFixture(
  name: string,
  fixture: PairRegressionFixture,
  insurer: InsurerCode,
  template: ClaimTemplate,
): boolean {
  const result = mapPairsToCanonical(fixture.pairs, insurer, template);
  const validated = validateMappedFields(result.mapped);

  let ok = true;
  for (const [field, expected] of Object.entries(fixture.expected)) {
    const actual = normalizeForCompare(validated.valid[field]);
    if (actual !== expected) {
      console.error(`REGRESSION FAIL [${name}] ${field}: expected "${expected}", got "${actual}"`);
      ok = false;
    }
  }

  for (const [field, forbidden] of Object.entries(fixture.mustNotMatch ?? {})) {
    const actual = String(validated.valid[field] ?? '');
    for (const bad of forbidden) {
      if (actual.includes(bad)) {
        console.error(`FIELD-SHIFT FAIL [${name}] ${field}: contains forbidden "${bad}" in "${actual}"`);
        ok = false;
      }
    }
  }

  if (fixture.expectedExtraFieldKeys?.length) {
    const unmappedKeys = result.extraFields
      .filter((e) => e.matchedCanonicalField == null && e.value?.trim())
      .map((e) => e.key.replace(/^[^/]+\/\s*/, ''));
    for (const key of fixture.expectedExtraFieldKeys) {
      if (!unmappedKeys.some((k) => k === key || k.endsWith(key))) {
        console.error(`EXTRA FIELD FAIL [${name}]: expected unmapped key "${key}"`);
        ok = false;
      }
    }
    const extraCount = unmappedKeys.length;
    console.log(`  [${name}] unmapped extraFields: ${extraCount}`);
  }

  if (ok) {
    const conf = computeMappingConfidence({
      mapped: validated.valid,
      pairMappings: result.pairMappings,
      validatorFailedFields: validated.failedFields,
      totalPairs: fixture.pairs.length,
    });
    console.log(`OK — ${name} passed (confidence=${conf.confidenceScore})`);
  }

  return ok;
}

function runAllPairRegressions(): boolean {
  const fixtures: Array<{ name: string; file: string; insurer: InsurerCode; template: ClaimTemplate }> = [
    { name: 'NIAC field-shift', file: 'NIAC_field_shift_regression.json', insurer: 'NIAC', template: 'NIAC_TABLE' },
    { name: 'OIC Nand Kumar', file: 'OIC_nand_kumar_pairs.json', insurer: 'OIC', template: 'OIC_ENGLISH' },
    { name: 'NIC Yash Gupta', file: 'NIC_yash_gupta_pairs.json', insurer: 'NIC', template: 'NIC_COMPACT' },
    { name: 'UIIC Kishor Mandal', file: 'UIIC_kishor_mandal_pairs.json', insurer: 'UIIC', template: 'UIIC_TABULAR' },
    { name: 'UIIC Chandan Singh', file: 'UIIC_chandan_singh_pairs.json', insurer: 'UIIC', template: 'UIIC_BILINGUAL' },
  ];

  let allOk = true;
  for (const { name, file, insurer, template } of fixtures) {
    const fixturePath = path.join(GOLDEN_DIR, file);
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8')) as PairRegressionFixture;
    const ok = runPairRegressionFixture(
      name,
      fixture,
      fixture.insurer ?? insurer,
      fixture.template ?? template,
    );
    if (!ok) allOk = false;
  }
  return allOk;
}

function runGoldenSamples(): boolean {
  const manifestPath = path.join(GOLDEN_DIR, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
    samples: Array<{ id: string; template: string; goldenFile: string; priorityFields: string[]; type?: string }>;
  };

  let samplesWithData = 0;
  let matched = 0;

  for (const sample of manifest.samples) {
    if (sample.type === 'pair_regression') continue;
    const goldenPath = path.join(GOLDEN_DIR, sample.goldenFile);
    if (!fs.existsSync(goldenPath)) continue;

    const raw = fs.readFileSync(goldenPath, 'utf-8').replace(/^\uFEFF/, '');
    const golden = JSON.parse(raw) as Record<string, unknown>;
    if (golden._note && Object.keys(golden).length <= 3) continue;

    const populatedFields = sample.priorityFields.filter((f) => golden[f] != null && golden[f] !== '');
    if (populatedFields.length === 0) continue;
    samplesWithData++;

    console.log(`\nSample ${sample.id} (${sample.template}) — ${populatedFields.length} labeled fields`);
    for (const field of populatedFields) {
      matched++;
      console.log(`  ${field}: ${golden[field]}`);
    }
  }

  console.log(`\nGolden set: ${samplesWithData} PDF samples with labels, ${matched} fields documented`);
  return true;
}

function main(): void {
  console.log('=== Claim accuracy eval ===\n');
  const regressionOk = runAllPairRegressions();
  const goldenOk = runGoldenSamples();

  if (!regressionOk || !goldenOk) {
    process.exit(1);
  }
  console.log('\nAll eval checks passed.');
}

main();
