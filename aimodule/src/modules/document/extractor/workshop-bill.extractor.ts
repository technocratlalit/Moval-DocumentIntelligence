import { ZodError } from 'zod';
import { AIService } from '../../../infrastructure/ai/ai.service';
import { UnrecoverableDocumentError } from '../../../shared/errors/document.errors.js';
import { WorkshopBillSchema } from '../schema/workshop/workshop-bill.schema';
import {
  WorkshopChunkArraySchema,
  WorkshopChunkArraySequentialSchema,
  WorkshopLeanArraySchema,
  WorkshopLeanArraySequentialSchema,
} from '../schema/workshop/workshop-bill.gemini.schema';
import {
  getWorkshopChunkArrayPrompt,
  getWorkshopLeanArrayFirstChunkPrompt,
} from '../prompts/workshop-bill.prompt';
import {
  normaliseGst,
  computeGrandTotalCheck,
  classifyBillType,
  extractVehicleState,
  normaliseVehicleNo,
  resolveSummaryPartsLabour,
  mergeWorkshopTableRows,
  mergeLineItemsRows,
  resequenceTableSerials,
  assignTableRowIndexes,
} from '../utils/workshop/workshop-bill.utils';
import {
  buildPageChunks,
  buildSliceInput,
} from '../utils/workshop/workshop-pdf-slice.util.js';
import { ObserverService } from '../../../infrastructure/observabllity/observer.service.js';
import {
  enforceDocumentTypeGates,
  isEffectivelyEmpty,
  rejectWrongTypeOrUnreadable,
} from '../utils/document-gates.util.js';
import {
  getQualityHintFromInput,
  mergeDocumentQuality,
} from '../utils/document-quality.util.js';
import { _config } from '../../../config/config';
import { computeWorkshopMaxTokens } from '../../../cost/token-budget.js';
import { resolveDocumentPageCount } from '../../../utils/document-page-count.util.js';
import {
  expandWorkshopShortKeys,
  expandWorkshopArrayRows,
  expandLineItemsArrayRows,
  isArrayRowFormat,
  isLineItemsArrayFormat,
  hasColumnShiftDescriptionIssues,
  countStructurallyBadLineItemDescriptions,
} from '../schema/workshop/workshop-bill.shared.js';

export type WorkshopTableLayout = 'split' | 'sequential';

export interface WorkshopExtractOptions {
  tableLayout?: WorkshopTableLayout;
}

type WorkshopRawResult = Record<string, unknown>;

type LeanChunkExtractResult = {
  raw: WorkshopRawResult;
  parts: Record<string, unknown>[];
  labour: Record<string, unknown>[];
};

type LeanSequentialChunkExtractResult = {
  raw: WorkshopRawResult;
  lineItems: Record<string, unknown>[];
};

export class WorkshopBillExtractor {
  private aiService: AIService;
  private obs = ObserverService.getInstance();

  constructor() {
    this.aiService = AIService.getInstance();
  }

  private parseWorkshopResult(raw: unknown, tableLayout: WorkshopTableLayout = 'split') {
    try {
      const obj = raw as Record<string, unknown>;
      const expanded =
        tableLayout === 'sequential'
          ? expandLineItemsArrayRows(obj)
          : isLineItemsArrayFormat(obj)
            ? expandLineItemsArrayRows(obj)
            : isArrayRowFormat(obj)
              ? expandWorkshopArrayRows(obj)
              : expandWorkshopShortKeys(obj);
      return WorkshopBillSchema.parse(expanded);
    } catch (e) {
      if (e instanceof ZodError) {
        this.obs.logError('WorkshopBillExtractor: Zod validation failed', {
          issueCount: e.issues.length,
          issues: e.issues.slice(0, 10).map(i => ({
            path: i.path.join('.'),
            code: i.code,
            message: i.message,
          })),
        });
        throw new UnrecoverableDocumentError(
          'EXTRACTION_SCHEMA_FAILED',
          'Workshop bill structure could not be validated. Re-upload a clearer PDF or a standard repair invoice.',
        );
      }
      throw e;
    }
  }

  private async callGemini(
    inputData: unknown,
    prompt: string,
    schema: Parameters<AIService['processDocument']>[2],
    maxOutputTokens: number,
    cacheKey: string,
    model?: string,
  ) {
    return this.aiService.processDocument(
      inputData,
      prompt,
      schema,
      maxOutputTokens,
      model ?? _config.WORKSHOP_AI_MODEL,
      _config.WORKSHOP_MAX_GEMINI_RETRIES,
      cacheKey,
    );
  }

  /**
   * Minimum rows expected for a chunk.
   * Dense OEM bills (BharatBenz/DICV) often have ~20+ rows on page 1 alone —
   * thresholds must exceed that so early stop mid-chunk triggers page-by-page retry.
   */
  private minRowsForChunk(
    pageIndices: number[],
    chunkIndex: number,
    totalPageCount: number,
  ): number {
    const pagesInChunk = pageIndices.length;
    const isFirstChunk = chunkIndex === 0 && pageIndices[0] === 1;
    const isLastChunk = pageIndices[pageIndices.length - 1] === totalPageCount;
    // First: 2 pages → 34, 3 pages → 56 (page-1-only ~20 fails)
    if (isFirstChunk) return 12 + (pagesInChunk - 1) * 22;
    // Last chunk often totals/terms — keep soft
    if (isLastChunk) return Math.max(3, pagesInChunk * 5);
    return pagesInChunk * 22;
  }

  /** flash-lite can stop mid-chunk (~16 rows) without throwing — split and retry per page. */
  private isChunkSoftTruncated(
    rowCount: number,
    pageIndices: number[],
    chunkIndex: number,
    totalPageCount: number,
  ): boolean {
    if (rowCount === 0) return false;
    return rowCount < this.minRowsForChunk(pageIndices, chunkIndex, totalPageCount);
  }

  private hasSerialGapsForTable(rows: Record<string, unknown>[]): boolean {
    const serials: number[] = [];
    for (const row of rows) {
      const n = Number(row.srNo);
      if (Number.isFinite(n) && n > 0) {
        serials.push(n);
      }
    }
    if (serials.length <= 1) return false;

    const uniqueSerials = Array.from(new Set(serials)).sort((a, b) => a - b);

    // Split into segments separated by large jumps (≥20).
    // Dual-column invoices (Upcountry/Volvo) interleave two sequences like
    // [1, 101, 2, 102, 3, 103], which sorts to [1,2,3,101,102,103] — a jump of
    // 98 in the middle. Treating those as one range would always flag a gap.
    // Instead we check each contiguous segment independently.
    const segments: number[][] = [[uniqueSerials[0]]];
    for (let i = 1; i < uniqueSerials.length; i++) {
      if (uniqueSerials[i] - uniqueSerials[i - 1] >= 20) {
        segments.push([]);
      }
      segments[segments.length - 1].push(uniqueSerials[i]);
    }

    for (const seg of segments) {
      if (seg.length <= 1) continue;
      const segMin = seg[0];
      const segMax = seg[seg.length - 1];
      if (segMax - segMin + 1 > seg.length) return true;
    }
    return false;
  }

  /**
   * Sequential layout: detect holes in printed Sr.No within the same rowType
   * (e.g. PART 20 → 84). Ignores expected PART→LABOUR section restarts.
   * Unlike hasSerialGapsForTable, does not split on large jumps — those ARE the bug.
   */
  private hasConsecutiveSectionSerialGaps(rows: Record<string, unknown>[]): boolean {
    let prevType: string | null = null;
    let prevSr: number | null = null;

    for (const row of rows) {
      const rt = String(row.rowType ?? '').trim().toUpperCase();
      if (rt !== 'PART' && rt !== 'LABOUR') {
        prevType = null;
        prevSr = null;
        continue;
      }

      const n = Number(row.srNo);
      if (!Number.isFinite(n) || n <= 0) {
        prevType = rt;
        prevSr = null;
        continue;
      }

      if (prevType === rt && prevSr !== null && n - prevSr > 1) {
        return true;
      }

      prevType = rt;
      prevSr = n;
    }

    return false;
  }

  private hasSerialGaps(parts: Record<string, unknown>[], labour: Record<string, unknown>[]): boolean {
    return this.hasSerialGapsForTable(parts) || this.hasSerialGapsForTable(labour);
  }

  private maxSerialFromRows(rows: Record<string, unknown>[]): number {
    let max = 0;
    for (const row of rows) {
      const n = Number(row.srNo);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return max;
  }

  /** Split line items into pageCount contiguous segments (document order). */
  private partitionLineItemsByPageEstimate(
    rows: Record<string, unknown>[],
    pageCount: number,
  ): Record<string, unknown>[][] {
    if (pageCount <= 0) return [];
    if (pageCount === 1) return [rows];
    if (rows.length === 0) return Array.from({ length: pageCount }, () => []);

    const base = Math.floor(rows.length / pageCount);
    const rem = rows.length % pageCount;
    const segments: Record<string, unknown>[][] = [];
    let offset = 0;
    for (let i = 0; i < pageCount; i++) {
      // Prefer proportional sizes; last segment gets the remainder.
      const size = i === pageCount - 1 ? base + rem : base;
      segments.push(rows.slice(offset, offset + size));
      offset += size;
    }
    return segments;
  }

  /**
   * Decide which pages to re-extract vs keep from the initial multi-page pass.
   * Indexes are positions into pageIndices (0..n-1).
   */
  private resolveSequentialPagesToRetry(params: {
    pageIndices: number[];
    initialRows: Record<string, unknown>[];
    softTrunc: boolean;
    serialGap: boolean;
    colShift: boolean;
  }): {
    keepByPageIndex: Map<number, Record<string, unknown>[]>;
    retryPageIndexes: number[];
  } {
    const { pageIndices, initialRows, softTrunc, serialGap, colShift } = params;
    const n = pageIndices.length;
    const keepByPageIndex = new Map<number, Record<string, unknown>[]>();
    const retryPageIndexes: number[] = [];

    const retryAll = () => {
      keepByPageIndex.clear();
      return {
        keepByPageIndex,
        retryPageIndexes: Array.from({ length: n }, (_, i) => i),
      };
    };

    // Soft-trunc with continuous serials → early stop: keep initial as page 0, retry later pages.
    if (softTrunc && !serialGap) {
      keepByPageIndex.set(0, initialRows);
      for (let i = 1; i < n; i++) retryPageIndexes.push(i);
      return { keepByPageIndex, retryPageIndexes };
    }

    // Column-shift only → keep clean estimated page segments, retry dirty ones.
    if (colShift && !softTrunc && !serialGap) {
      const segments = this.partitionLineItemsByPageEstimate(initialRows, n);
      for (let i = 0; i < n; i++) {
        const seg = segments[i] ?? [];
        const segBad =
          hasColumnShiftDescriptionIssues(seg) ||
          (seg.length >= 3 && countStructurallyBadLineItemDescriptions(seg) >= 1);
        if (segBad) {
          retryPageIndexes.push(i);
        } else {
          keepByPageIndex.set(i, seg);
        }
      }
      if (retryPageIndexes.length === 0) return retryAll();
      return { keepByPageIndex, retryPageIndexes };
    }

    // Serial gaps or soft-trunc+gaps — cannot localize safely.
    return retryAll();
  }

  private async runSequentialSinglePageWithOptionalPro(
    inputData: unknown,
    pageNum: number,
    pageIsFirst: boolean,
    chunkIndex: number,
  ): Promise<LeanSequentialChunkExtractResult> {
    let sub = await this.runSingleLeanChunkExtract(
      inputData,
      [pageNum],
      pageIsFirst,
      `WORKSHOP-LEAN-CHUNK-${chunkIndex + 1}P${pageNum}`,
      'sequential',
    ) as LeanSequentialChunkExtractResult;

    const subRows = sub.lineItems.length;
    const subHasColumnShift = hasColumnShiftDescriptionIssues(sub.lineItems);
    if (
      this.hasConsecutiveSectionSerialGaps(sub.lineItems) ||
      subHasColumnShift ||
      subRows >= 15
    ) {
      const proModel = _config.WORKSHOP_AI_MODEL;
      if (proModel && proModel !== _config.WORKSHOP_CHUNK_AI_MODEL) {
        this.obs.warn(
          `WorkshopBillExtractor: Sequential single-page run for page ${pageNum} appears truncated/long/shifted (${subRows} rows). Retrying page with Pro model (${proModel}).`,
        );
        try {
          const proSub = await this.runSingleLeanChunkExtract(
            inputData,
            [pageNum],
            pageIsFirst,
            `WORKSHOP-LEAN-CHUNK-${chunkIndex + 1}P${pageNum}-PRO`,
            'sequential',
            proModel,
          ) as LeanSequentialChunkExtractResult;
          const subBad = countStructurallyBadLineItemDescriptions(sub.lineItems);
          const proBad = countStructurallyBadLineItemDescriptions(proSub.lineItems);
          if (proSub.lineItems.length > subRows || proBad < subBad) {
            this.obs.info(
              `WorkshopBillExtractor: Sequential page ${pageNum} Pro model preferred — rows ${subRows}→${proSub.lineItems.length}, badDesc ${subBad}→${proBad}.`,
            );
            sub = proSub;
          }
        } catch (e) {
          this.obs.warn(`WorkshopBillExtractor: Sequential page ${pageNum} Pro model fallback failed`, { error: e });
        }
      }
    }

    return sub;
  }

  private async runSingleLeanChunkExtract(
    inputData: unknown,
    pageIndices: number[],
    isFirst: boolean,
    cacheSuffix: string,
    tableLayout: WorkshopTableLayout = 'split',
    modelOverride?: string,
  ): Promise<LeanChunkExtractResult | LeanSequentialChunkExtractResult> {
    if (tableLayout === 'sequential') {
      return this.runSingleLeanSequentialChunkExtract(
        inputData,
        pageIndices,
        isFirst,
        cacheSuffix,
        modelOverride,
      );
    }

    const chunkModel = modelOverride ?? _config.WORKSHOP_CHUNK_AI_MODEL;
    const chunkTokens = computeWorkshopMaxTokens(
      pageIndices.length,
      _config.WORKSHOP_MAX_OUTPUT_TOKENS,
    );

    const slice = await buildSliceInput(inputData, pageIndices, cacheSuffix);
    try {
      const chunk = (await this.callGemini(
        slice.input,
        isFirst
          ? getWorkshopLeanArrayFirstChunkPrompt()
          : getWorkshopChunkArrayPrompt(),
        isFirst ? WorkshopLeanArraySchema : WorkshopChunkArraySchema,
        chunkTokens,
        cacheSuffix,
        chunkModel,
      )) as WorkshopRawResult;

      const expanded = expandWorkshopArrayRows(chunk);
      const parts = Array.isArray(expanded.partsTable)
        ? (expanded.partsTable as Record<string, unknown>[])
        : [];
      const labour = Array.isArray(expanded.labourTable)
        ? (expanded.labourTable as Record<string, unknown>[])
        : [];

      return { raw: chunk, parts, labour };
    } finally {
      await slice.dispose();
    }
  }

  private async runSingleLeanSequentialChunkExtract(
    inputData: unknown,
    pageIndices: number[],
    isFirst: boolean,
    cacheSuffix: string,
    modelOverride?: string,
  ): Promise<LeanSequentialChunkExtractResult> {
    const chunkModel = modelOverride ?? _config.WORKSHOP_CHUNK_AI_MODEL;
    const chunkTokens = computeWorkshopMaxTokens(
      pageIndices.length,
      _config.WORKSHOP_MAX_OUTPUT_TOKENS,
    );

    const slice = await buildSliceInput(inputData, pageIndices, cacheSuffix);
    try {
      const chunk = (await this.callGemini(
        slice.input,
        isFirst
          ? getWorkshopLeanArrayFirstChunkPrompt('sequential')
          : getWorkshopChunkArrayPrompt('sequential'),
        isFirst ? WorkshopLeanArraySequentialSchema : WorkshopChunkArraySequentialSchema,
        chunkTokens,
        cacheSuffix,
        chunkModel,
      )) as WorkshopRawResult;

      const expanded = expandLineItemsArrayRows(chunk);
      const lineItems = Array.isArray(expanded.lineItemsTable)
        ? (expanded.lineItemsTable as Record<string, unknown>[])
        : [];

      return { raw: chunk, lineItems };
    } finally {
      await slice.dispose();
    }
  }

  /**
   * Extract one chunk; if flash-lite stops early, retry each page in the chunk separately.
   * Only splits when multi-page chunk looks truncated — keeps cost low for normal bills.
   */
  private async extractLeanChunkResilient(
    inputData: unknown,
    pageIndices: number[],
    chunkIndex: number,
    totalPageCount: number,
    isFirst: boolean,
    tableLayout: WorkshopTableLayout = 'split',
  ): Promise<LeanChunkExtractResult | LeanSequentialChunkExtractResult> {
    const pageStart = pageIndices[0];
    const pageEnd = pageIndices[pageIndices.length - 1];

    this.obs.info(
      `WorkshopBillExtractor: Lean chunk ${chunkIndex + 1} — pages ${pageStart}–${pageEnd} (${tableLayout})`,
    );

    let initial = await this.runSingleLeanChunkExtract(
      inputData,
      pageIndices,
      isFirst,
      `WORKSHOP-LEAN-CHUNK-${chunkIndex + 1}`,
      tableLayout,
    );

    if (tableLayout === 'sequential') {
      return this.extractLeanSequentialChunkResilient(
        inputData,
        pageIndices,
        chunkIndex,
        totalPageCount,
        isFirst,
        initial as LeanSequentialChunkExtractResult,
      );
    }

    const splitInitial = initial as LeanChunkExtractResult;
    let initialRows = splitInitial.parts.length + splitInitial.labour.length;

    let isTruncated = this.isChunkSoftTruncated(initialRows, pageIndices, chunkIndex, totalPageCount);
    if (!isTruncated && this.hasSerialGaps(splitInitial.parts, splitInitial.labour)) {
      this.obs.warn(
        `WorkshopBillExtractor: Gap in serial numbers detected on initial chunk ${chunkIndex + 1}. Marking as truncated.`,
        { parts: splitInitial.parts.length, labour: splitInitial.labour.length }
      );
      isTruncated = true;
    }

    if (!isTruncated) {
      return splitInitial;
    }

    // Single-page chunk truncation fallback: retry with the Pro model (WORKSHOP_AI_MODEL)
    if (pageIndices.length <= 1) {
      const proModel = _config.WORKSHOP_AI_MODEL;
      if (proModel && proModel !== _config.WORKSHOP_CHUNK_AI_MODEL) {
        this.obs.warn(
          `WorkshopBillExtractor: Single-page chunk ${chunkIndex + 1} (page ${pageStart}) is truncated or has gaps. Retrying with Pro model (${proModel}).`,
          { rowCount: initialRows }
        );
        try {
          const proResult = await this.runSingleLeanChunkExtract(
            inputData,
            pageIndices,
            isFirst,
            `WORKSHOP-LEAN-CHUNK-${chunkIndex + 1}-PRO`,
            'split',
            proModel,
          ) as LeanChunkExtractResult;
          const proRows = proResult.parts.length + proResult.labour.length;
          if (proRows > initialRows) {
            this.obs.info(
              `WorkshopBillExtractor: Pro model extraction successful — rows increased from ${initialRows} to ${proRows}.`,
            );
            return proResult;
          }
        } catch (e) {
          this.obs.warn(`WorkshopBillExtractor: Pro model fallback failed for page ${pageStart}, using initial Lite results`, { error: e });
        }
      }
      return splitInitial;
    }

    this.obs.warn(
      `WorkshopBillExtractor: Chunk ${chunkIndex + 1} soft-truncated (${initialRows} rows for ` +
      `pages ${pageStart}–${pageEnd}) — retrying page-by-page.`,
      { pageIndices, initialRows },
    );

    const splitSoftTrunc = this.isChunkSoftTruncated(
      initialRows,
      pageIndices,
      chunkIndex,
      totalPageCount,
    );
    const splitSerialGap = this.hasSerialGaps(splitInitial.parts, splitInitial.labour);
    // Early-stop: continuous serials + soft trunc → keep initial as first page, only extract later pages.
    const splitEarlyStop = splitSoftTrunc && !splitSerialGap;

    const mergedParts: Record<string, unknown>[] = [];
    const mergedLabour: Record<string, unknown>[] = [];
    let gateRaw = splitInitial.raw;

    if (splitEarlyStop) {
      this.obs.warn(
        `WorkshopBillExtractor: Split chunk ${chunkIndex + 1} early-stop — keeping initial rows as page ${pageIndices[0]}, re-extracting later page(s).`,
        { pageIndices, initialRows },
      );
      mergedParts.push(...splitInitial.parts);
      mergedLabour.push(...splitInitial.labour);
    }

    const startIdx = splitEarlyStop ? 1 : 0;
    for (let p = startIdx; p < pageIndices.length; p++) {
      const singlePage = [pageIndices[p]];
      const pageIsFirst = isFirst && p === 0;
      let sub = await this.runSingleLeanChunkExtract(
        inputData,
        singlePage,
        pageIsFirst,
        `WORKSHOP-LEAN-CHUNK-${chunkIndex + 1}P${pageIndices[p]}`,
        'split',
      ) as LeanChunkExtractResult;

      // If a single page run has serial number gaps or output truncation zones (e.g. >= 15 rows),
      // we retry it with the Pro model.
      const subRows = sub.parts.length + sub.labour.length;
      if (this.hasSerialGaps(sub.parts, sub.labour) || subRows >= 15) {
        const proModel = _config.WORKSHOP_AI_MODEL;
        if (proModel && proModel !== _config.WORKSHOP_CHUNK_AI_MODEL) {
          this.obs.warn(
            `WorkshopBillExtractor: Single-page run for page ${pageIndices[p]} appears truncated/long (${subRows} rows). Retrying page with Pro model (${proModel}).`,
          );
          try {
            const proSub = await this.runSingleLeanChunkExtract(
              inputData,
              singlePage,
              pageIsFirst,
              `WORKSHOP-LEAN-CHUNK-${chunkIndex + 1}P${pageIndices[p]}-PRO`,
              'split',
              proModel,
            ) as LeanChunkExtractResult;
            const proRows = proSub.parts.length + proSub.labour.length;
            if (proRows > subRows) {
              this.obs.info(
                `WorkshopBillExtractor: Page ${pageIndices[p]} Pro model extraction successful — rows increased from ${subRows} to ${proRows}.`,
              );
              sub = proSub;
            }
          } catch (e) {
            this.obs.warn(`WorkshopBillExtractor: Page ${pageIndices[p]} Pro model fallback failed`, { error: e });
          }
        }
      }

      if (pageIsFirst) gateRaw = sub.raw;
      resequenceTableSerials(sub.parts, this.maxSerialFromRows(mergedParts));
      resequenceTableSerials(sub.labour, this.maxSerialFromRows(mergedLabour));
      mergedParts.push(...sub.parts);
      mergedLabour.push(...sub.labour);
    }

    // Early-stop fallback: if still short or gapped, also re-extract first page.
    if (splitEarlyStop) {
      const mergedCount = mergedParts.length + mergedLabour.length;
      const stillShort = this.isChunkSoftTruncated(
        mergedCount,
        pageIndices,
        chunkIndex,
        totalPageCount,
      );
      const stillGapped = this.hasSerialGaps(mergedParts, mergedLabour);
      if (stillShort || stillGapped) {
        this.obs.warn(
          `WorkshopBillExtractor: Split chunk ${chunkIndex + 1} early-stop fallback — re-extracting page ${pageIndices[0]}.`,
        );
        const pageIsFirst = isFirst;
        let sub = await this.runSingleLeanChunkExtract(
          inputData,
          [pageIndices[0]],
          pageIsFirst,
          `WORKSHOP-LEAN-CHUNK-${chunkIndex + 1}P${pageIndices[0]}-FALLBACK`,
          'split',
        ) as LeanChunkExtractResult;
        const subRows = sub.parts.length + sub.labour.length;
        if (this.hasSerialGaps(sub.parts, sub.labour) || subRows >= 15) {
          const proModel = _config.WORKSHOP_AI_MODEL;
          if (proModel && proModel !== _config.WORKSHOP_CHUNK_AI_MODEL) {
            try {
              const proSub = await this.runSingleLeanChunkExtract(
                inputData,
                [pageIndices[0]],
                pageIsFirst,
                `WORKSHOP-LEAN-CHUNK-${chunkIndex + 1}P${pageIndices[0]}-FALLBACK-PRO`,
                'split',
                proModel,
              ) as LeanChunkExtractResult;
              if (proSub.parts.length + proSub.labour.length > subRows) {
                sub = proSub;
              }
            } catch (e) {
              this.obs.warn(`WorkshopBillExtractor: Page ${pageIndices[0]} fallback Pro failed`, { error: e });
            }
          }
        }
        if (pageIsFirst) gateRaw = sub.raw;
        const restParts = mergedParts.slice(splitInitial.parts.length);
        const restLabour = mergedLabour.slice(splitInitial.labour.length);
        resequenceTableSerials(sub.parts, 0);
        resequenceTableSerials(sub.labour, 0);
        resequenceTableSerials(restParts, this.maxSerialFromRows(sub.parts));
        resequenceTableSerials(restLabour, this.maxSerialFromRows(sub.labour));
        mergedParts.length = 0;
        mergedLabour.length = 0;
        mergedParts.push(...sub.parts, ...restParts);
        mergedLabour.push(...sub.labour, ...restLabour);
      }
    }

    return { raw: gateRaw, parts: mergedParts, labour: mergedLabour };
  }

  private async extractLeanSequentialChunkResilient(
    inputData: unknown,
    pageIndices: number[],
    chunkIndex: number,
    totalPageCount: number,
    isFirst: boolean,
    initial: LeanSequentialChunkExtractResult,
  ): Promise<LeanSequentialChunkExtractResult> {
    const pageStart = pageIndices[0];
    let initialRows = initial.lineItems.length;

    let isTruncated = this.isChunkSoftTruncated(initialRows, pageIndices, chunkIndex, totalPageCount);
    if (!isTruncated && this.hasSerialGapsForTable(initial.lineItems)) {
      this.obs.warn(
        `WorkshopBillExtractor: Gap in serial numbers on sequential chunk ${chunkIndex + 1}. Marking as truncated.`,
        { lineItems: initialRows },
      );
      isTruncated = true;
    }
    if (!isTruncated && this.hasConsecutiveSectionSerialGaps(initial.lineItems)) {
      this.obs.warn(
        `WorkshopBillExtractor: Consecutive section Sr.No gap on sequential chunk ${chunkIndex + 1}. Marking as truncated.`,
        { lineItems: initialRows },
      );
      isTruncated = true;
    }
    if (!isTruncated && hasColumnShiftDescriptionIssues(initial.lineItems)) {
      this.obs.warn(
        `WorkshopBillExtractor: Column-shift description issues on sequential chunk ${chunkIndex + 1}. Marking as truncated.`,
        {
          lineItems: initialRows,
          badDescriptions: countStructurallyBadLineItemDescriptions(initial.lineItems),
        },
      );
      isTruncated = true;
    }

    if (!isTruncated) {
      return initial;
    }

    if (pageIndices.length <= 1) {
      const proModel = _config.WORKSHOP_AI_MODEL;
      if (proModel && proModel !== _config.WORKSHOP_CHUNK_AI_MODEL) {
        try {
          const proResult = await this.runSingleLeanChunkExtract(
            inputData,
            pageIndices,
            isFirst,
            `WORKSHOP-LEAN-CHUNK-${chunkIndex + 1}-PRO`,
            'sequential',
            proModel,
          ) as LeanSequentialChunkExtractResult;
          const initialBad = countStructurallyBadLineItemDescriptions(initial.lineItems);
          const proBad = countStructurallyBadLineItemDescriptions(proResult.lineItems);
          if (
            proResult.lineItems.length > initialRows ||
            proBad < initialBad
          ) {
            return proResult;
          }
        } catch (e) {
          this.obs.warn(`WorkshopBillExtractor: Sequential Pro fallback failed for page ${pageStart}`, { error: e });
        }
      }
      return initial;
    }

    const softTrunc = this.isChunkSoftTruncated(initialRows, pageIndices, chunkIndex, totalPageCount);
    const serialGap =
      this.hasSerialGapsForTable(initial.lineItems) ||
      this.hasConsecutiveSectionSerialGaps(initial.lineItems);
    const colShift = hasColumnShiftDescriptionIssues(initial.lineItems);

    const { keepByPageIndex, retryPageIndexes } = this.resolveSequentialPagesToRetry({
      pageIndices,
      initialRows: initial.lineItems,
      softTrunc,
      serialGap,
      colShift,
    });

    this.obs.warn(
      `WorkshopBillExtractor: Sequential chunk ${chunkIndex + 1} needs retry — ` +
      `softTrunc=${softTrunc}, serialGap=${serialGap}, colShift=${colShift}; ` +
      `keeping ${keepByPageIndex.size} page(s), re-extracting ${retryPageIndexes.length} page(s).`,
      {
        pageIndices,
        initialRows,
        keepPages: [...keepByPageIndex.keys()].map((i) => pageIndices[i]),
        retryPages: retryPageIndexes.map((i) => pageIndices[i]),
      },
    );

    const pageSlots: (Record<string, unknown>[] | null)[] = pageIndices.map((_, i) =>
      keepByPageIndex.has(i) ? (keepByPageIndex.get(i) as Record<string, unknown>[]) : null,
    );
    const freshlyExtracted = new Set<number>();
    let gateRaw = initial.raw;

    const extractSlot = async (i: number) => {
      const pageNum = pageIndices[i];
      const pageIsFirst = isFirst && i === 0;
      const sub = await this.runSequentialSinglePageWithOptionalPro(
        inputData,
        pageNum,
        pageIsFirst,
        chunkIndex,
      );
      pageSlots[i] = sub.lineItems;
      freshlyExtracted.add(i);
      if (pageIsFirst) gateRaw = sub.raw;
    };

    for (const i of retryPageIndexes) {
      await extractSlot(i);
    }

    for (let i = 0; i < pageSlots.length; i++) {
      if (pageSlots[i] === null) {
        await extractSlot(i);
      }
    }

    let mergedLineItems = pageSlots.flatMap((slot) => slot ?? []);

    // Mixed / incomplete: after early-stop append, fix remaining column-shift or still-short output.
    const stillSoft = this.isChunkSoftTruncated(
      mergedLineItems.length,
      pageIndices,
      chunkIndex,
      totalPageCount,
    );
    const stillGap =
      this.hasSerialGapsForTable(mergedLineItems) ||
      this.hasConsecutiveSectionSerialGaps(mergedLineItems);
    const stillColShift = hasColumnShiftDescriptionIssues(mergedLineItems);

    if (stillSoft || stillGap || stillColShift) {
      const fallbackRetry = new Set<number>();

      if (stillSoft || stillGap) {
        for (let i = 0; i < pageIndices.length; i++) {
          if (!freshlyExtracted.has(i)) fallbackRetry.add(i);
        }
      }

      if (stillColShift) {
        const segments = this.partitionLineItemsByPageEstimate(mergedLineItems, pageIndices.length);
        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i] ?? [];
          const segBad =
            hasColumnShiftDescriptionIssues(seg) ||
            (seg.length >= 3 && countStructurallyBadLineItemDescriptions(seg) >= 1);
          if (segBad) fallbackRetry.add(i);
        }
      }

      if (fallbackRetry.size > 0) {
        this.obs.warn(
          `WorkshopBillExtractor: Sequential chunk ${chunkIndex + 1} post-surgical fallback — re-extracting pages ${[...fallbackRetry].map((i) => pageIndices[i]).join(',')}.`,
        );
        for (const i of fallbackRetry) {
          await extractSlot(i);
        }
        mergedLineItems = pageSlots.flatMap((slot) => slot ?? []);
      }
    }

    return { raw: gateRaw, lineItems: mergedLineItems };
  }

  /**
   * Lean chunk fallback — skips separate meta pass.
   * First chunk includes gate check; subsequent chunks extract tables only.
   * Saves 1 Gemini API call vs full chunk fallback.
   */
  private async extractChunkFallbackLean(
    inputData: unknown,
    pageCount: number,
    tableLayout: WorkshopTableLayout = 'split',
  ): Promise<WorkshopRawResult> {
    const chunkSize = _config.WORKSHOP_CHUNK_PAGE_SIZE;
    const chunks = buildPageChunks(pageCount, chunkSize);

    this.obs.info(
      `WorkshopBillExtractor: Lean chunk mode (${tableLayout}) — ${pageCount} page(s), ` +
      `${chunks.length} slice(s), ${chunkSize} pages/chunk, model=${_config.WORKSHOP_CHUNK_AI_MODEL}`,
    );

    if (tableLayout === 'sequential') {
      const allLineItems: Record<string, unknown>[] = [];
      let gateResult: WorkshopRawResult | undefined;

      for (let i = 0; i < chunks.length; i++) {
        const pageIndices = chunks[i];
        const isFirst = i === 0;

        const result = await this.extractLeanChunkResilient(
          inputData,
          pageIndices,
          i,
          pageCount,
          isFirst,
          'sequential',
        ) as LeanSequentialChunkExtractResult;

        if (isFirst) {
          gateResult = result.raw;
          enforceDocumentTypeGates(result.raw, {
            extractorName: 'WorkshopBillExtractor',
            wrongTypeMessage: (typeStr) =>
              `The uploaded document appears to be a "${typeStr}", not a Workshop Bill. ` +
              'Please upload a valid repair/service bill, proforma estimate, or job card.',
            mixedBatchMessage: (pageList) =>
              `Mixed document batch detected for Workshop Bill extraction. ${pageList} ` +
              'Please ensure all uploaded pages belong to the same workshop bill or repair estimate.',
          });
        }

        allLineItems.push(...result.lineItems);
      }

      const mergedLineItems = mergeLineItemsRows(allLineItems);

      if (this.hasConsecutiveSectionSerialGaps(mergedLineItems)) {
        this.obs.warn(
          `WorkshopBillExtractor: Consecutive section Sr.No gap after sequential merge — ` +
          `rows=${mergedLineItems.length}. Some table rows may be missing; flagging for human review.`,
          { totalRows: mergedLineItems.length, pageCount },
        );
        if (gateResult) {
          gateResult = {
            ...gateResult,
            requiresHumanReview: true,
            confidenceScore: Math.min(Number(gateResult.confidenceScore ?? 1), 0.75),
          };
        }
      }

      if (hasColumnShiftDescriptionIssues(mergedLineItems)) {
        const badDescriptions = countStructurallyBadLineItemDescriptions(mergedLineItems);
        this.obs.warn(
          `WorkshopBillExtractor: Column-shift description issues after sequential merge — ` +
          `badDesc=${badDescriptions}/${mergedLineItems.length}. Flagging for human review.`,
          { badDescriptions, totalRows: mergedLineItems.length, pageCount },
        );
        if (gateResult) {
          gateResult = {
            ...gateResult,
            requiresHumanReview: true,
            confidenceScore: Math.min(Number(gateResult.confidenceScore ?? 1), 0.75),
          };
        }
      }

      return {
        ...(gateResult ?? {}),
        tableLayout: 'sequential',
        lineItemsTable: mergedLineItems,
      };
    }

    const allParts: Record<string, unknown>[] = [];
    const allLabour: Record<string, unknown>[] = [];
    let gateResult: WorkshopRawResult | undefined;

    for (let i = 0; i < chunks.length; i++) {
      const pageIndices = chunks[i];
      const isFirst = i === 0;

      const result = await this.extractLeanChunkResilient(
        inputData,
        pageIndices,
        i,
        pageCount,
        isFirst,
        'split',
      ) as LeanChunkExtractResult;

      if (isFirst) {
        gateResult = result.raw;
        enforceDocumentTypeGates(result.raw, {
          extractorName: 'WorkshopBillExtractor',
          wrongTypeMessage: (typeStr) =>
            `The uploaded document appears to be a "${typeStr}", not a Workshop Bill. ` +
            'Please upload a valid repair/service bill, proforma estimate, or job card.',
          mixedBatchMessage: (pageList) =>
            `Mixed document batch detected for Workshop Bill extraction. ${pageList} ` +
            'Please ensure all uploaded pages belong to the same workshop bill or repair estimate.',
        });
      }

      resequenceTableSerials(result.parts, this.maxSerialFromRows(allParts));
      resequenceTableSerials(result.labour, this.maxSerialFromRows(allLabour));
      allParts.push(...result.parts);
      allLabour.push(...result.labour);
    }

    const mergedParts = mergeWorkshopTableRows(allParts, 'totalPrice');
    const mergedLabour = mergeWorkshopTableRows(allLabour, 'totalAmount');

    const maxSr = Math.max(
      this.maxSerialFromRows(mergedParts),
      this.maxSerialFromRows(mergedLabour),
    );
    const totalRows = mergedParts.length + mergedLabour.length;
    if (maxSr > 0 && maxSr > totalRows + 2) {
      this.obs.warn(
        `WorkshopBillExtractor: Sr.No gap after merge — maxSr=${maxSr}, rows=${totalRows}. ` +
        'Some table rows may be missing; flagging for human review.',
        { maxSr, totalRows, pageCount },
      );
      if (gateResult) {
        gateResult = {
          ...gateResult,
          requiresHumanReview: true,
          confidenceScore: Math.min(Number(gateResult.confidenceScore ?? 1), 0.75),
        };
      }
    }

    return {
      ...(gateResult ?? {}),
      tableLayout: 'split',
      partsTable: mergedParts,
      labourTable: mergedLabour,
    };
  }

  private async extractWithFallback(
    inputData: unknown,
    pageCount: number,
    tableLayout: WorkshopTableLayout = 'split',
  ): Promise<WorkshopRawResult> {
    return this.extractChunkFallbackLean(inputData, pageCount, tableLayout);
  }

  public async extract(
    inputData: unknown,
    options: WorkshopExtractOptions = {},
  ) {
    const tableLayout = options.tableLayout === 'split' ? 'split' : 'sequential';
    const fileCount = Array.isArray(inputData) ? inputData.length : 1;
    const pageCount = resolveDocumentPageCount(inputData);

    this.obs.info(
      `WorkshopBillExtractor: Starting extraction — ${fileCount} file(s), ` +
      `${pageCount} PDF page(s), tableLayout=${tableLayout}`,
    );

    const rawResult = await this.extractWithFallback(inputData, pageCount, tableLayout);

    this.obs.info('WorkshopBillExtractor: Raw extraction complete, validating with Zod schema...');

    const parsedResult = this.parseWorkshopResult(rawResult, tableLayout);

    if (Array.isArray(parsedResult.lineItemsTable) && parsedResult.lineItemsTable.length > 0) {
      assignTableRowIndexes(parsedResult.lineItemsTable as Record<string, unknown>[]);
    }
    if (tableLayout === 'split') {
      if (Array.isArray(parsedResult.partsTable) && parsedResult.partsTable.length > 0) {
        assignTableRowIndexes(parsedResult.partsTable as Record<string, unknown>[]);
      }
      if (Array.isArray(parsedResult.labourTable) && parsedResult.labourTable.length > 0) {
        assignTableRowIndexes(parsedResult.labourTable as Record<string, unknown>[]);
      }
    }

    const confidence = parsedResult.confidenceScore ?? 0;
    const hasPartsOrLabour =
      (parsedResult.partsTable?.length ?? 0) > 0 ||
      (parsedResult.labourTable?.length ?? 0) > 0 ||
      (parsedResult.lineItemsTable?.length ?? 0) > 0;

    const hasWorkshopIdentity =
      !isEffectivelyEmpty(parsedResult.workshopDetails?.name) ||
      !isEffectivelyEmpty(parsedResult.workshopDetails?.invoiceNumber);

    if (!hasPartsOrLabour && !hasWorkshopIdentity) {
      rejectWrongTypeOrUnreadable(
        'WorkshopBillExtractor',
        confidence,
        confidence >= 0.3,
        'The uploaded document does not appear to be a Workshop Bill or Invoice. ' +
        'A valid workshop bill must contain repair parts, labour charges, or at minimum a workshop name and invoice number. ' +
        'Supported formats: Workshop Estimate, Proforma Invoice, Job Card, or Final Invoice (PDF/image).',
        'The uploaded document could not be read. ' +
        'Please ensure the image is clear and shows the full workshop bill. ' +
        'Re-upload a higher quality scan or photo.',
      );
    }

    const summary = parsedResult.summary;
    const gstInfo = normaliseGst({
      igstRate: summary?.igstRate,
      igstAmount: summary?.igstAmount,
      cgstRate: summary?.cgstRate,
      cgstAmount: summary?.cgstAmount,
      sgstRate: summary?.sgstRate,
      sgstAmount: summary?.sgstAmount,
    });

    const { parts, labour, taxInclusive } = resolveSummaryPartsLabour(summary);

    const grandTotalCheck = computeGrandTotalCheck({
      partsTotal: parts,
      labourTotal: labour,
      totalTaxAmount: gstInfo.totalTaxAmount,
      totalGstAmount: summary?.totalGstAmount,
      grandTotal: summary?.grandTotal,
      discountAmount: summary?.totalDiscount,
      taxInclusiveSubtotals: taxInclusive,
    });

    if (!grandTotalCheck.ok) {
      this.obs.warn(
        `WorkshopBillExtractor: Grand total mismatch — ` +
        `expected=₹${grandTotalCheck.expected.toFixed(2)}, ` +
        `actual=₹${grandTotalCheck.actual.toFixed(2)}, ` +
        `delta=₹${grandTotalCheck.delta.toFixed(2)}. Flagging for human review.`,
      );
    }

    const billType = classifyBillType(
      parsedResult.workshopDetails?.invoiceNumber,
      parsedResult.workshopDetails?.documentTitle,
    );

    const rawVehicle = parsedResult.workshopDetails?.vehicleNumber ?? null;
    const normVehicleNo = normaliseVehicleNo(rawVehicle);
    const vehicleState = extractVehicleState(normVehicleNo);

    const enriched: Record<string, unknown> = {
      ...parsedResult,
      tableLayout: parsedResult.tableLayout ?? tableLayout,
      vehicleNumber: normVehicleNo ?? rawVehicle,
      vehicleState,
      billType,
      gstSummary: gstInfo,
      grandTotalVerified: grandTotalCheck.ok,
      requiresHumanReview: parsedResult.requiresHumanReview || !grandTotalCheck.ok,
      extractionMode: 'chunk-fallback',
    };

    if (tableLayout === 'sequential') {
      delete enriched.partsTable;
      delete enriched.labourTable;
    }

    this.obs.info(
      `WorkshopBillExtractor: Extraction successful — ` +
      `pages=${pageCount}, ` +
      `layout=${tableLayout}, ` +
      `lineItems=${parsedResult.lineItemsTable?.length ?? 0}` +
      (tableLayout === 'split'
        ? `, parts=${parsedResult.partsTable?.length ?? 0}, labour=${parsedResult.labourTable?.length ?? 0}`
        : '') +
      `, billType=${billType}, ` +
      `gst=${gstInfo.type}(${gstInfo.rate}%), ` +
      `grandTotalOk=${grandTotalCheck.ok}, ` +
      `vehicleState=${vehicleState ?? 'N/A'}`,
    );

    return mergeDocumentQuality(
      enriched,
      getQualityHintFromInput(inputData),
      _config.PRESCREEN_BLUR_CONFIDENCE,
    );
  }
}
