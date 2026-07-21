import type { ClaimOcrPair } from './claim-ocr-parse.util.js';

/** Format label:value pairs for Gemini structuring (preserves section context). */
export function pairsToStructuredText(pairs: ClaimOcrPair[]): string {
  if (!pairs.length) return '';

  const sections: string[] = [];
  let currentKey = '';

  for (const pair of pairs) {
    const key = `Page ${pair.page} | ${pair.section}`;
    if (key !== currentKey) {
      if (currentKey) sections.push('');
      sections.push(`--- ${key} ---`);
      currentKey = key;
    }
    sections.push(`${pair.label}: ${pair.value}`);
  }

  return sections.join('\n').trim();
}
