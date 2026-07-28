/**
 * Offline checks for 4-template claim registry (no Gemini call).
 * Run: npx tsx scripts/verify-claim-templates.ts
 */
import {
  CLAIM_TEMPLATE_IDS,
  CLAIM_TEMPLATES,
  buildTemplateLabelFields,
  formatLabelKeyTable,
} from '../src/modules/document/utils/claim/motor-claim-template-registry.js';
import { assembleClaimResult } from '../src/modules/document/utils/claim/motor-claim.utils.js';
import type { ClaimDataKey } from '../src/modules/document/schema/claim/motor-claim.schema.js';
import { InsuranceClaimDataSchema } from '../src/modules/document/schema/claim/motor-claim.schema.js';

const VALID_KEYS = new Set(Object.keys(InsuranceClaimDataSchema.shape) as ClaimDataKey[]);

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// 1. All 4 templates registered
assert(CLAIM_TEMPLATE_IDS.length === 4, `expected 4 templates, got ${CLAIM_TEMPLATE_IDS.length}`);
for (const id of ['UIIC', 'OIC', 'NIAC', 'NIC'] as const) {
  assert(CLAIM_TEMPLATES[id] != null, `missing template ${id}`);
  assert(CLAIM_TEMPLATES[id].detect.length > 0, `${id} has no detect cues`);
  assert(Object.keys(CLAIM_TEMPLATES[id].labels).length > 10, `${id} label map too small`);
}

// 2. Variant configs
assert(CLAIM_TEMPLATES.UIIC.variants?.one_page != null, 'UIIC one_page variant missing');
assert(CLAIM_TEMPLATES.OIC.variants?.combined != null, 'OIC combined variant missing');
assert(formatLabelKeyTable('UIIC', 'one_page').includes('Date of Loss'), 'UIIC one_page label table');

// 3. Label map keys are valid schema keys
for (const id of CLAIM_TEMPLATE_IDS) {
  for (const key of Object.keys(CLAIM_TEMPLATES[id].labels)) {
    assert(VALID_KEYS.has(key as ClaimDataKey), `${id}: invalid label key "${key}"`);
  }
  for (const variant of Object.values(CLAIM_TEMPLATES[id].variants ?? {})) {
    for (const key of Object.keys(variant.labels)) {
      assert(VALID_KEYS.has(key as ClaimDataKey), `${id} variant: invalid key "${key}"`);
    }
  }
}

// 4. buildTemplateLabelFields returns non-empty for each template
const sample = {
  policyNumber: 'TEST123',
  insuredName: 'CHANDAN SINGH',
  accidentDescription: 'sample narrative',
  registrationNo: 'JH10AR9780',
};

for (const id of CLAIM_TEMPLATE_IDS) {
  const fields = buildTemplateLabelFields(sample, id);
  assert(Object.keys(fields).length >= 3, `${id}: expected label fields, got ${JSON.stringify(fields)}`);
}

const uiicOnePage = buildTemplateLabelFields(
  { policyNumber: 'X', accidentDate: '22/04/2023', estimatedRepairCost: 586202 },
  'UIIC',
  'one_page',
);
assert(uiicOnePage['Policy No'] === 'X', 'UIIC one_page Policy No label');
assert(uiicOnePage['Date of Loss'] === '22/04/2023', 'UIIC one_page Date of Loss label');

// 5. assembleClaimResult strips meta, populates hindiFields + extraFields + formVariant
const result = assembleClaimResult(
  { raw: true },
  {
    policyNumber: '0428',
    insuredName: 'Test',
    confidenceScore: 0.9,
    requiresHumanReview: false,
    sourceTemplate: 'OIC',
    formVariant: 'combined',
    extraFields: [{ key: 'Pin Code', value: '823001' }, { key: 'Policy No', value: '0428' }],
  },
  4,
  'gemini-2.5-flash-lite',
);

assert(!('confidenceScore' in result), 'meta should not be at top level');
assert(result.additionalData.sourceTemplate === 'OIC', 'sourceTemplate in additionalData');
assert(result.additionalData.formVariant === 'combined', 'formVariant in additionalData');
assert(Object.keys(result.hindiFields).length > 0, 'OIC hindiFields should be populated');
assert(result.extraFields?.length === 1 && result.extraFields[0].key === 'Pin Code', 'extraFields deduped');
assert(result.extractedPdfData.pageCount === 4, 'pageCount in extractedPdfData');

// 6. anti-swap only for UIIC/OIC
assert(CLAIM_TEMPLATES.UIIC.antiSwapLayout === true, 'UIIC antiSwap');
assert(CLAIM_TEMPLATES.OIC.antiSwapLayout === true, 'OIC antiSwap');
assert(CLAIM_TEMPLATES.NIAC.antiSwapLayout !== true, 'NIAC no antiSwap');

console.log('verify-claim-templates: all checks passed');
