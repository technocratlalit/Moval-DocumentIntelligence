/**
 * Unit checks for claim pipeline deterministic stages (no API keys).
 * Run: npx tsx scripts/verify-claim-pipeline.ts
 */
import assert from 'node:assert/strict';
import { htmlTableToMarkdown, resolveTablePlaceholders } from '../src/modules/document/utils/claim/ocr-markdown.util.js';
import { normalizeBilingualLabel, mistralPagesToRawPairs } from '../src/modules/document/utils/claim/label-pairs.util.js';
import { postprocessClaimForm } from '../src/modules/document/utils/claim/postprocess.util.js';
import { computeFieldConfidence } from '../src/modules/document/utils/claim/confidence.util.js';
import { normalizeTemplateVersion } from '../src/modules/document/utils/claim/claim-normalize.util.js';
import { backfillClaimFromHints } from '../src/modules/document/utils/claim/claim-backfill.util.js';
import { flattenClaimForDisplay } from '../src/modules/document/utils/claim/claim-flatten.util.js';
import { extractLossHintsFromMarkdown } from '../src/modules/document/utils/claim/claim-table-pairs.util.js';
import type { MistralOcrPage } from '../src/infrastructure/mistral/mistral-ocr.types.js';

// HTML table → markdown with multi-line chassis join
const html = `<table><tr><th>Chassis No.</th></tr><tr><td>ABC<br/>123456</td></tr></table>`;
const md = htmlTableToMarkdown(html);
assert.ok(md.includes('ABC'), 'chassis cell content preserved');
console.log('✓ htmlTableToMarkdown');

// Table placeholder resolution
const resolved = resolveTablePlaceholders('See [tbl-0.html] here', [
  { id: '0', content: '<table><tr><td>Policy</td><td>123</td></tr></table>', format: 'html' },
]);
assert.ok(resolved.includes('Policy'), 'placeholder resolved');
console.log('✓ resolveTablePlaceholders');

// Bilingual label dedup
assert.equal(normalizeBilingualLabel('नाम / Name', 'english'), 'Name');
assert.equal(normalizeBilingualLabel('नाम / Name', 'hindi'), 'नाम');
console.log('✓ normalizeBilingualLabel');

// Template version: unknown/empty → standard (UIIC-II has no visible "II" on page 1)
assert.equal(normalizeTemplateVersion('unknown'), 'standard');
assert.equal(normalizeTemplateVersion(''), 'standard');
assert.equal(normalizeTemplateVersion('II'), 'II');
assert.equal(normalizeTemplateVersion(' 13.08.2008 '), '13.08.2008');
console.log('✓ normalizeTemplateVersion');

// Raw pairs from blocks
const mockPage: MistralOcrPage[] = [{
  index: 0,
  markdown: '',
  blocks: [
    { type: 'title', content: 'INSURED DETAILS' },
    { type: 'text', content: 'Name: YASH GUPTA' },
    { type: 'text', content: 'Policy No: 18040031236860004298 Vehicle No: JH01FA9881' },
  ],
}];
const pairs = mistralPagesToRawPairs(mockPage, 'english');
assert.ok(pairs.some((p) => p.label === 'Name' && p.value === 'YASH GUPTA'));
console.log('✓ mistralPagesToRawPairs');

// Field confidence uses Mistral `text` tokens (not `word`); malformed entries must not crash
const pagesWithConfidence: MistralOcrPage[] = [{
  index: 0,
  markdown: '',
  blocks: [{ type: 'text', content: 'Policy No: 12345' }],
  confidence_scores: {
    word_confidence_scores: [
      { text: 'Policy', confidence: 0.95, start_index: 0 },
      { text: ' No:', confidence: 0.4, start_index: 6 },
      { confidence: 0.99 },
    ],
  },
}];
const conf = computeFieldConfidence(pagesWithConfidence);
const policyConf = conf.find((f) => f.path === 'policy_details.policy_no');
assert.ok(policyConf, 'policy_details.policy_no confidence computed');
assert.equal(policyConf.flaggedForReview, true, 'low-confidence token flags field');
console.log('✓ computeFieldConfidence');

// OIC-style accident table → loss_details hints
const oicTableMd = `## 5. DETAILS OF ACCIDENT
| (a) Date & Time | : | 18.06.2026 at 10:30 AM |
| (b) Place | : | Steel Gate, Saridhela |
| (c) Speed of your vehicle at the time of accident | : | 30 KM |
| (d) Give a short description of the accident | : | Left side damaged |
| (e) If any third party was responsible | : | No |`;
const lossHints = extractLossHintsFromMarkdown(oicTableMd);
assert.ok(lossHints.some((h) => h.canonicalHint === 'loss_details.date_of_loss' && h.value === '18.06.2026'));
assert.ok(lossHints.some((h) => h.canonicalHint === 'loss_details.time_of_loss' && h.value === '10:30 AM'));
assert.ok(lossHints.some((h) => h.canonicalHint === 'loss_details.place_of_loss_accident'));
console.log('✓ extractLossHintsFromMarkdown');

// Backfill null loss_details from hints
const backfilled = backfillClaimFromHints(
  { loss_details: {}, policy_details: {}, insured_details: {}, vehicle_details: {}, meta: {} },
  lossHints,
);
assert.equal((backfilled.loss_details as Record<string, unknown>).date_of_loss, '18.06.2026');
assert.equal((backfilled.loss_details as Record<string, unknown>).place_of_loss_accident, 'Steel Gate, Saridhela');
console.log('✓ backfillClaimFromHints');

// Flat display DTO
const flat = flattenClaimForDisplay({
  meta: { source_insurer: 'OIC' },
  policy_details: { policy_no: '332703/31/2025/2928' },
  insured_details: { name: 'NAND KUMAR' },
  loss_details: { date_of_loss: '18.06.2026', time_of_loss: '10:30 AM' },
  vehicle_details: { registration_no: 'JH09V7182' },
});
assert.equal(flat.policy_no, '332703/31/2025/2928');
assert.equal(flat.date_of_accident, '18.06.2026');
assert.equal(flat.insurer_code, 'OIC');
console.log('✓ flattenClaimForDisplay');

// Postprocess diff
const { result, diff } = postprocessClaimForm({
  vehicle_details: { registration_no: 'JH 01-FA/9881' },
  loss_details: { date_of_loss: '21/11/2024', estimated_cost_of_repairs: '1,05,922/-' },
  meta: {},
  company_details: {},
  policy_details: {},
  insured_details: {},
  commercial_vehicle_info: {},
  driver_details: {},
  other_insurance_details: null,
  damage_to_insured_vehicle: {},
  workshop_details: {},
  third_party_details: {},
  injury_death_to_driver_occupant: {},
  police_fir_details: {},
  witness_details: {},
  theft_details: {},
  add_on_covers: {},
  past_claims: {},
  declaration: {},
});
assert.equal(result.vehicle_details?.registration_no_normalized, 'JH01FA9881');
assert.equal(result.loss_details?.date_of_loss_iso, '2024-11-21');
assert.equal(result.loss_details?.estimated_cost_of_repairs_numeric, 105922);
assert.ok(diff.length >= 2, 'postprocess emits diff entries');
console.log('✓ postprocessClaimForm');

console.log('\nAll verify-claim-pipeline checks passed.');
