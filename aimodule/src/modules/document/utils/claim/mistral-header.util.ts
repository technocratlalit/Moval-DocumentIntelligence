import type { MistralOcrPage } from '../../../../infrastructure/mistral/mistral-ocr.types.js';

/** Extract header text from page 0 for insurer/template identification. */
export function extractHeaderTextFromMistral(pages: MistralOcrPage[]): string {
  const first = pages[0];
  if (!first) return '';

  const parts: string[] = [];

  if (first.header) parts.push(first.header);

  for (const block of first.blocks ?? []) {
    if (block.type === 'title' || block.type === 'header') {
      parts.push(block.content);
    }
  }

  if (parts.length === 0 && first.markdown) {
    parts.push(first.markdown.slice(0, 800));
  }

  return parts.join('\n');
}
