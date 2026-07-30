import { normalizePageList } from '../pdf-slice.util.js';

export interface PolicyPageMap {
  dataPageIndices: number[];
  premiumPageIndices: number[];
  skipPageIndices: number[];
}

/** Default: early pages = identity/vehicle; mid = premium; late CIS/legal = skip */
export function defaultPolicyPageSplit(pageCount: number): PolicyPageMap {
  if (pageCount === 1) {
    return { dataPageIndices: [1], premiumPageIndices: [1], skipPageIndices: [] };
  }
  if (pageCount === 2) {
    return { dataPageIndices: [1], premiumPageIndices: [1, 2], skipPageIndices: [] };
  }
  // NIA / PSU 3-page cert: schedule p1, premium p2, legal clauses p3 — skip p3
  if (pageCount === 3) {
    return { dataPageIndices: [1], premiumPageIndices: [2], skipPageIndices: [3] };
  }
  if (pageCount === 4) {
    return { dataPageIndices: [1, 2], premiumPageIndices: [2, 3, 4], skipPageIndices: [] };
  }
  if (pageCount === 5) {
    return { dataPageIndices: [1, 2, 3], premiumPageIndices: [2, 3, 4], skipPageIndices: [5] };
  }

  const skip = Array.from({ length: pageCount - 4 }, (_, i) => i + 5);
  const data = [1, 2, 3].filter((p) => p <= pageCount);
  const premium = [2, 4].filter((p) => p <= pageCount && !skip.includes(p));
  if (premium.length === 0) {
    premium.push(...data);
  }

  return { dataPageIndices: data, premiumPageIndices: [...new Set(premium)].sort((a, b) => a - b), skipPageIndices: skip };
}

/** Pages to send for extraction (data + premium, excluding legal/CIS skip pages). */
export function policyExtractPageIndices(pageCount: number): number[] {
  const map = defaultPolicyPageSplit(pageCount);
  return [...new Set([...map.dataPageIndices, ...map.premiumPageIndices])].sort((a, b) => a - b);
}

export function resolvePolicyPageMap(meta: Record<string, unknown>, pageCount: number): PolicyPageMap {
  let data = normalizePageList(meta.dataPageIndices, pageCount);
  let premium = normalizePageList(meta.premiumPageIndices, pageCount);
  const skip = normalizePageList(meta.skipPageIndices, pageCount);

  if (data.length === 0 && premium.length === 0) {
    const fallback = defaultPolicyPageSplit(pageCount);
    data = fallback.dataPageIndices;
    premium = fallback.premiumPageIndices;
  } else if (data.length === 0) {
    data = premium;
  } else if (premium.length === 0) {
    premium = data;
  }

  const skipSet = new Set(skip);
  data = data.filter((p) => !skipSet.has(p));
  premium = premium.filter((p) => !skipSet.has(p));

  return { dataPageIndices: data, premiumPageIndices: premium, skipPageIndices: skip };
}
