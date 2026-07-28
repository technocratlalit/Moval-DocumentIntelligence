import type { ClaimFieldHint } from './claim-table-pairs.util.js';
import type { ClaimRawPair } from './label-pairs.util.js';
import { getPath, setPath } from './claim-normalize.util.js';

/** Fill null canonical fields from deterministic hints — never overwrite Gemini values. */
export function backfillClaimFromHints(
  data: Record<string, unknown>,
  hints: ClaimFieldHint[],
  rawPairs: ClaimRawPair[] = [],
): Record<string, unknown> {
  const result = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;

  const sources: Array<{ path: string; value: string }> = [
    ...hints.map((h) => ({ path: h.canonicalHint, value: h.value })),
    ...rawPairs
      .filter((p) => p.canonicalHint && p.value)
      .map((p) => ({ path: p.canonicalHint!, value: p.value! })),
  ];

  for (const { path, value } of sources) {
    if (!path || !value?.trim()) continue;
    const current = getPath(result, path);
    if (current != null && String(current).trim() !== '') continue;
    setPath(result, path, value.trim());
  }

  return result;
}
