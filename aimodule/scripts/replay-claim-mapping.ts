/**
 * Replay Pass 2 alias mapping from stored rawPairs (no OCR / no API).
 * Run: npx tsx scripts/replay-claim-mapping.ts <fixture.json>
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { replayClaimMapping } from '../src/modules/document/utils/claim/claim-alias-mapper.util.js';
import { validateMappedFields } from '../src/modules/document/utils/claim/claim-field-validators.util.js';
import type { ClaimTemplate } from '../src/modules/document/utils/claim/claim-field-aliases.js';
import type { InsurerCode } from '../src/modules/document/utils/claim/claim-form-identify.util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface Fixture {
  insurer?: InsurerCode;
  template?: ClaimTemplate;
  pairs?: Array<{ page: number; section?: string; label: string; value: string }>;
  rawPairs?: Array<{ page: number; section?: string; key: string; value: string | null }>;
}

function main(): void {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: npx tsx scripts/replay-claim-mapping.ts <fixture.json>');
    process.exit(1);
  }

  const fixturePath = path.isAbsolute(arg) ? arg : path.join(process.cwd(), arg);
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8')) as Fixture;

  const rawPairs = fixture.rawPairs ?? fixture.pairs?.map((p) => ({
    page: p.page,
    key: p.label,
    value: p.value,
    section: p.section,
  }));

  if (!rawPairs?.length) {
    console.error('No pairs/rawPairs in fixture');
    process.exit(1);
  }

  const insurer = fixture.insurer ?? 'GENERIC';
  const template = fixture.template ?? 'GENERIC';
  const result = replayClaimMapping(rawPairs, insurer, template);
  const validated = validateMappedFields(result.mapped);

  const unmapped = result.extraFields.filter((e) => e.matchedCanonicalField == null && e.value?.trim());

  console.log(JSON.stringify({
    mapped: validated.valid,
    unmappedPairCount: result.unmappedPairs.length,
    extraFields: unmapped.map((e) => ({ key: e.key, value: e.value })),
  }, null, 2));
}

main();
