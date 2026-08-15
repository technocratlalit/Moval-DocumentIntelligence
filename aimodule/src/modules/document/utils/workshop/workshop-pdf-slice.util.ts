export {
  buildSliceInput,
  getPrimaryFileInput,
  normalizePageList,
  type PdfFileInput,
  type SliceInputResult,
} from '../pdf-slice.util.js';

import { normalizePageList } from '../pdf-slice.util.js';

export type WorkshopTableLayout = 'SPLIT' | 'UNIFIED';

export interface WorkshopPageMap {
  tableLayout: WorkshopTableLayout;
  partsPageIndices: number[];
  labourPageIndices: number[];
  skipPageIndices: number[];
}

/** Default OEM-style split: early pages = parts, late page = labour, last = terms */
export function defaultPageSplit(pageCount: number): WorkshopPageMap {
  if (pageCount <= 1) {
    return { tableLayout: 'UNIFIED', partsPageIndices: [1], labourPageIndices: [], skipPageIndices: [] };
  }
  if (pageCount === 2) {
    return { tableLayout: 'SPLIT', partsPageIndices: [1], labourPageIndices: [2], skipPageIndices: [] };
  }

  const skip = [pageCount];
  const labour = [pageCount - 1];
  const parts = Array.from({ length: pageCount - 2 }, (_, i) => i + 1);

  return { tableLayout: 'SPLIT', partsPageIndices: parts, labourPageIndices: labour, skipPageIndices: skip };
}

export function resolvePageMap(meta: Record<string, unknown>, pageCount: number): WorkshopPageMap {
  const layoutRaw = String(meta.tableLayout ?? 'SPLIT').toUpperCase();
  const tableLayout: WorkshopTableLayout = layoutRaw === 'UNIFIED' ? 'UNIFIED' : 'SPLIT';

  if (tableLayout === 'UNIFIED') {
    return {
      tableLayout: 'UNIFIED',
      partsPageIndices: [],
      labourPageIndices: [],
      skipPageIndices: normalizePageList(meta.skipPageIndices, pageCount),
    };
  }

  let parts = normalizePageList(meta.partsPageIndices, pageCount);
  let labour = normalizePageList(meta.labourPageIndices, pageCount);
  const skip = normalizePageList(meta.skipPageIndices, pageCount);

  if (parts.length === 0 && labour.length === 0) {
    const fallback = defaultPageSplit(pageCount);
    parts = fallback.partsPageIndices;
    labour = fallback.labourPageIndices;
  }

  return { tableLayout: 'SPLIT', partsPageIndices: parts, labourPageIndices: labour, skipPageIndices: skip };
}

// Backward-compatible alias
export type WorkshopFileInput = import('../pdf-slice.util.js').PdfFileInput;

/** Split 1..pageCount into contiguous page-index groups (e.g. 4 pages per chunk). */
export function buildPageChunks(pageCount: number, chunkSize: number): number[][] {
  if (pageCount <= 0 || chunkSize <= 0) return [];
  const chunks: number[][] = [];
  for (let start = 1; start <= pageCount; start += chunkSize) {
    const end = Math.min(start + chunkSize - 1, pageCount);
    chunks.push(Array.from({ length: end - start + 1 }, (_, i) => start + i));
  }
  return chunks;
}
