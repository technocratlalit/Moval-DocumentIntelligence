/** Dynamic maxOutputTokens — scales with PDF page count per doc type */

function parseCeiling(envCeiling: string | undefined, fallback: number): number {
  if (!envCeiling) return fallback;
  const cleaned = envCeiling.replace(/^["']|["']$/g, '').trim().split(/\s+/)[0];
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function computeWorkshopMaxTokens(pageCount: number, envCeiling?: string): number {
  const ceiling = parseCeiling(envCeiling, 65536);
  // 20480 per page handles dense 17-column commercial vehicle bills (BharatBenz/DICV/Tata)
  // with 50–65 rows per page. At 16384 a 3-page PDF landed exactly at the 49152 floor with
  // zero headroom (49136/49152 used) causing repeated truncation even in chunk fallback.
  // 20480 gives 3 pages → 61440, safely within the 65536 ceiling.
  // Floor of 49152 still covers 1–2 page chunks without inflating their budget.
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
