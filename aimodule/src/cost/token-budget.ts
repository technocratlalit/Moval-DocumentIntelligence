/** Dynamic maxOutputTokens — scales with PDF page count per doc type */

function parseCeiling(envCeiling: string | undefined, fallback: number): number {
  if (!envCeiling) return fallback;
  const cleaned = envCeiling.replace(/^["']|["']$/g, '').trim().split(/\s+/)[0];
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Pass 1 meta — gate + columns only, no rows (~300–800 tokens). */
export function computeWorkshopMetaMaxTokens(): number {
  return 4096;
}

/** Pass 2 rows-only per chunk — compact string[][] output. */
export function computeWorkshopRowsMaxTokens(
  pageCount: number,
  envCeiling?: string,
  columnCount?: number,
): number {
  const ceiling = parseCeiling(envCeiling, 65536);
  const perPage = columnCount && columnCount >= 10 ? 8192 : 4096;
  const floor = perPage;
  return Math.min(ceiling, Math.max(floor, pageCount * perPage));
}

/** @deprecated Use computeWorkshopMetaMaxTokens + computeWorkshopRowsMaxTokens */
export function computeWorkshopMaxTokens(pageCount: number, envCeiling?: string): number {
  return computeWorkshopRowsMaxTokens(pageCount, envCeiling);
}

export function computePolicyMaxTokens(pageCount: number, envCeiling?: string): number {
  const ceiling = parseCeiling(envCeiling, 65536);
  // 8192 per page — 3-page NIA cert needs ~12k+ output; old 4096/page landed at 12288 with zero headroom.
  // Floor 16384 covers 1–2 page bundled certificates without inflating small policies.
  const perPage = 8192;
  const floor = 16384;
  return Math.min(ceiling, Math.max(floor, pageCount * perPage));
}

export function computeClaimMaxTokens(pageCount: number, envCeiling?: string): number {
  const ceiling = parseCeiling(envCeiling, 8192);
  const perPage = 2048;
  const floor = 4096;
  return Math.min(ceiling, Math.max(floor, pageCount * perPage));
}

// ponytail: self-check — run via `npx tsx aimodule/src/cost/token-budget.ts`
if (process.argv[1]?.replace(/\\/g, '/').endsWith('token-budget.ts')) {
  console.assert(computeWorkshopRowsMaxTokens(2, undefined, 11) === 16384, 'wide table budget');
  console.assert(computeWorkshopRowsMaxTokens(1, undefined, 7) === 4096, 'narrow table budget');
  console.log('token-budget self-check OK');
}
