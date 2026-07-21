import type { MistralOcrPage } from '../../../../infrastructure/mistral/mistral-ocr.types.js';
import type { ClaimTemplate } from './claim-form-identify.util.js';
import { parseUiicBilingualPage } from './uiic-bilingual-pairs.util.js';
import {
  type ClaimOcrPair,
  dedupePairs,
  parseHtmlToPairs,
  parseMarkdownToPairs,
  parsePageContent,
  parsePlainLinesToPairs,
  pushClaimPair,
} from './claim-ocr-parse.util.js';

const SKIP_BLOCK_TYPES = new Set(['header', 'footer']);

function pageNumber(page: MistralOcrPage): number {
  return (page.index ?? 0) + 1;
}

function isTableTemplate(template: ClaimTemplate): boolean {
  return template === 'NIAC_TABLE' || template === 'UIIC_TABULAR';
}

function isListTemplate(template: ClaimTemplate): boolean {
  return (
    template === 'OIC_ENGLISH' ||
    template === 'OIC_BILINGUAL'
  );
}

function parseTablePage(page: MistralOcrPage, pairs: ClaimOcrPair[]): void {
  const pn = pageNumber(page);

  for (const table of page.tables ?? []) {
    if (table.content) {
      pairs.push(...parseHtmlToPairs(table.content, pn));
    }
  }

  for (const block of page.blocks ?? []) {
    if (block.type === 'table' && block.content) {
      pairs.push(...parseHtmlToPairs(block.content, pn));
    }
  }

  if (pairs.filter((p) => p.page === pn).length === 0 && page.markdown) {
    pairs.push(...parsePageContent(page.markdown, pn));
  }
}

function parseListPage(page: MistralOcrPage, pairs: ClaimOcrPair[]): void {
  const pn = pageNumber(page);
  let section = 'GENERAL';

  for (const block of page.blocks ?? []) {
    if (SKIP_BLOCK_TYPES.has(block.type)) continue;

    const content = block.content?.trim() ?? '';
    if (!content) continue;

    if (block.type === 'title') {
      section = content.toUpperCase();
      continue;
    }

    if (block.type === 'list' || block.type === 'text') {
      const lines = content.split('\n');
      parsePlainLinesToPairs(lines, pn, section, pairs);
      continue;
    }

    if (block.type === 'table' && content) {
      pairs.push(...parseHtmlToPairs(content, pn));
    }
  }

  if (pairs.filter((p) => p.page === pn).length === 0 && page.markdown) {
    pairs.push(...parseMarkdownToPairs(page.markdown, pn));
  }
}

function parseGenericPage(page: MistralOcrPage, pairs: ClaimOcrPair[]): void {
  const pn = pageNumber(page);
  let section = 'GENERAL';

  for (const block of page.blocks ?? []) {
    if (SKIP_BLOCK_TYPES.has(block.type) || block.type === 'signature') continue;

    const content = block.content?.trim() ?? '';
    if (!content) continue;

    if (block.type === 'title') {
      section = content.toUpperCase();
      continue;
    }

    if (block.type === 'table') {
      pairs.push(...parseHtmlToPairs(content, pn));
      continue;
    }

    const ci = content.indexOf(':');
    if (ci > 0 && ci < 80) {
      pushClaimPair(pairs, pn, section, content.slice(0, ci), content.slice(ci + 1));
    } else {
      parsePlainLinesToPairs(content.split('\n'), pn, section, pairs);
    }
  }

  if (page.markdown) {
    pairs.push(...parseMarkdownToPairs(page.markdown, pn));
  }
}

/** Convert Mistral OCR pages to ClaimOcrPair[] using template-aware parsing. */
export function mistralPagesToPairs(
  pages: MistralOcrPage[],
  template: ClaimTemplate,
): ClaimOcrPair[] {
  const pairs: ClaimOcrPair[] = [];

  for (const page of pages) {
    if (template === 'UIIC_BILINGUAL') {
      parseUiicBilingualPage(page, pairs);
    } else if (isTableTemplate(template)) {
      parseTablePage(page, pairs);
    } else if (isListTemplate(template)) {
      parseListPage(page, pairs);
    } else {
      parseGenericPage(page, pairs);
    }
  }

  return dedupePairs(pairs);
}
