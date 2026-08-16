/** Dynamic maxOutputTokens — scales with PDF page count per doc type */

function parseCeiling(envCeiling: string | undefined, fallback: number): number {
  if (!envCeiling) return fallback;
  const cleaned = envCeiling.replace(/^["']|["']$/g, '').trim().split(/\s+/)[0];
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Dense 17-column commercial vehicle bills (BharatBenz/DICV/Tata): 50–65 rows/page.
 * 20480/page → 3 pages = 61440, within 65536. Floor 49152 covers 1–2 page chunks.
 */
export function computeWorkshopMaxTokens(pageCount: number, envCeiling?: string): number {
  const ceiling = parseCeiling(envCeiling, 65536);
  const perPage = 20480;
  const floor = 49152;
  return Math.min(ceiling, Math.max(floor, pageCount * perPage));
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
  console.assert(computeWorkshopMaxTokens(1) === 49152, '1-page floor');
  console.assert(computeWorkshopMaxTokens(3) === 61440, '3-page BharatBenz budget');
  console.assert(computeWorkshopMaxTokens(4, '65536') === 65536, 'ceiling');
  console.log('token-budget self-check OK');
}
