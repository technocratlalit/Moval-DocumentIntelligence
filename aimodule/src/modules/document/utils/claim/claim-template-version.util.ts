import type { ClaimTemplate } from './claim-form-identify.util.js';

/** Human-readable template version strings for API output. */
export const TEMPLATE_VERSION_LABELS: Record<ClaimTemplate, string> = {
  UIIC_BILINGUAL: 'UIIC_BILINGUAL_V1',
  UIIC_TABULAR: 'UIIC_ONEPAGE_TABULAR_V1',
  OIC_BILINGUAL: 'OIC_BILINGUAL_10SECTION_V1',
  OIC_ENGLISH: 'OIC_BILINGUAL_10SECTION_V1',
  NIAC_TABLE: 'NIAC_TABLE_V1',
  NIC_COMPACT: 'NIC_ENGLISH_SINGLEPAGE_V1',
  NIC_HINDI: 'NIC_HINDI_V1',
  GENERIC: 'GENERIC_V1',
};

export function getTemplateVersionLabel(template: ClaimTemplate): string {
  return TEMPLATE_VERSION_LABELS[template] ?? template;
}
