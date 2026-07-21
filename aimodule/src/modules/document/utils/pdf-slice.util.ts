import fs from 'fs';
import { AIService } from '../../../infrastructure/ai/ai.service.js';
import { extractPdfPages } from '../../../utils/pdf.util.js';

export interface PdfFileInput {
  fileData?: { fileUri: string; mimeType: string };
  pageCount?: number;
  sourceUrl?: string;
  localPdfPath?: string;
  localFilePath?: string;
}

export function normalizePageList(indices: unknown, pageCount: number): number[] {
  if (!Array.isArray(indices)) return [];
  return [...new Set(indices
    .map((n) => (typeof n === 'number' ? Math.trunc(n) : parseInt(String(n), 10)))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= pageCount))]
    .sort((a, b) => a - b);
}

export function getPrimaryFileInput(inputData: unknown): PdfFileInput | null {
  const item = Array.isArray(inputData) ? inputData[0] : inputData;
  if (!item || typeof item !== 'object') return null;
  return item as PdfFileInput;
}

export interface SliceInputResult {
  input: PdfFileInput;
  pageCount: number;
  dispose: () => Promise<void>;
}

/** Build Gemini input — full PDF or a page slice uploaded as a new file */
export async function buildSliceInput(
  inputData: unknown,
  pageIndices: number[] | null,
  label: string,
): Promise<SliceInputResult> {
  const primary = getPrimaryFileInput(inputData);
  const fullPageCount = primary?.pageCount ?? 1;

  const useSlice =
    pageIndices &&
    pageIndices.length > 0 &&
    primary?.localPdfPath &&
    primary.fileData?.mimeType === 'application/pdf';

  if (!useSlice) {
    return {
      input: primary ?? {},
      pageCount: fullPageCount,
      dispose: async () => {},
    };
  }

  const aiService = AIService.getInstance();
  const slicePath = await extractPdfPages(primary.localPdfPath!, pageIndices);
  const filename = `doc-${label}-${Date.now()}.pdf`;

  try {
    const fileUri = await aiService.uploadFile(slicePath, 'application/pdf', filename);
    return {
      input: {
        fileData: { fileUri, mimeType: 'application/pdf' },
        pageCount: pageIndices.length,
      },
      pageCount: pageIndices.length,
      dispose: async () => {
        await aiService.deleteFile(fileUri).catch(() => undefined);
        await fs.promises.unlink(slicePath).catch(() => undefined);
      },
    };
  } catch (err) {
    await fs.promises.unlink(slicePath).catch(() => undefined);
    throw err;
  }
}
