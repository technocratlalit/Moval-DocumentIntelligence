import { ZodError } from 'zod';
import { AIService } from '../../../infrastructure/ai/ai.service';
import { UnrecoverableDocumentError } from '../../../shared/errors/document.errors.js';
import { WorkshopBillSchema } from '../schema/workshop/workshop-bill.schema';
import {
  WorkshopMetaSchema,
  WorkshopRowsOnlySchema,
} from '../schema/workshop/workshop-bill.gemini.schema';
import {
  getWorkshopLabourRetryPrompt,
  getWorkshopMetaPrompt,
  getWorkshopRowsChunkPrompt,
  type WorkshopMetaForRows,
} from '../prompts/workshop-bill.prompt';
import {
  normaliseGst,
  computeGrandTotalCheck,
  classifyBillType,
  extractVehicleState,
  normaliseVehicleNo,
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
import {
  computeWorkshopMetaMaxTokens,
  computeWorkshopRowsMaxTokens,
} from '../../../cost/token-budget.js';
import { resolveDocumentPageCount } from '../../../utils/document-page-count.util.js';
import {
  type ColumnsOnlyTable,
  type DynamicTable,
  type RowsChunkTable,
  adoptLateColumns,
  attachRowsToMeta,
  emptyDynamicTable,
  hasRowWidthMismatch,
  mergeDynamicTables,
  parseColumnsOnlyTable,
  parseDynamicTable,
  parseRowsChunkTable,
  normalizeSplitColumns,
  finalizeLabourTable,
  preferChunkLabourColumns,
  isLabourUnderExtracted,
  isLabourExpected,
  splitLabourChargesRows,
  alignLabourToSharedHeader,
  correctIndependentLabourHeaders,
  sortTableBySerial,
  splitPlUnified,
  isWorkshopTruncationError,
} from '../schema/workshop/workshop-bill.shared.js';

export type WorkshopTableLayout = 'split' | 'sequential';

export interface WorkshopExtractOptions {
  /** @deprecated Ignored — output is always dynamic parts/labour/lineItems */
  tableLayout?: WorkshopTableLayout;
}

type WorkshopRawResult = Record<string, unknown>;

type RowsChunkExtractResult = {
  parts: RowsChunkTable;
  labour: RowsChunkTable;
  lineItems?: RowsChunkTable;
};

function rowCount(parts: DynamicTable, labour: DynamicTable, lineItems?: DynamicTable): number {
  return parts.rows.length + labour.rows.length + (lineItems?.rows.length ?? 0);
}

function maxSerialFromTable(table: DynamicTable): number {
  let max = 0;
  for (const row of table.rows) {
    const n = Number(String(row[0] ?? '').trim());
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

function hasSerialGapsForTable(table: DynamicTable): boolean {
  const serials: number[] = [];
  for (const row of table.rows) {
    const n = Number(String(row[0] ?? '').trim());
    if (Number.isFinite(n) && n > 0) serials.push(n);
  }
  if (serials.length <= 1) return false;

  const uniqueSerials = Array.from(new Set(serials)).sort((a, b) => a - b);
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

function hasLabourSerialIncomplete(labour: DynamicTable): boolean {
  if (!labour.rows.length) return false;
  return maxSerialFromTable(labour) > labour.rows.length;
}

function hasSerialGaps(parts: DynamicTable, labour: DynamicTable, lineItems?: DynamicTable): boolean {
  if (lineItems?.rows.length) return hasSerialGapsForTable(lineItems);
  return hasSerialGapsForTable(parts) || hasSerialGapsForTable(labour);
}

function parseRowsChunk(raw: WorkshopRawResult): RowsChunkExtractResult {
  const lineItems = raw.lineItems ? parseRowsChunkTable(raw.lineItems) : undefined;
  return {
    parts: parseRowsChunkTable(raw.parts),
    labour: parseRowsChunkTable(raw.labour),
    lineItems: lineItems?.rows.length || lineItems?.columns?.length ? lineItems : undefined,
  };
}

function metaForRows(meta: WorkshopRawResult): WorkshopMetaForRows {
  return {
    billShape: typeof meta.billShape === 'string' ? meta.billShape : undefined,
    parts: parseColumnsOnlyTable(meta.parts),
    labour: parseColumnsOnlyTable(meta.labour),
    lineItems: meta.lineItems ? parseColumnsOnlyTable(meta.lineItems) : undefined,
  };
}

function promptMetaFromColumns(
  billShape: string | undefined,
  parts: ColumnsOnlyTable,
  labour: ColumnsOnlyTable,
  lineItems?: ColumnsOnlyTable,
): WorkshopMetaForRows {
  return { billShape, parts, labour, lineItems };
}

function maxColumnCount(...tables: (ColumnsOnlyTable | undefined)[]): number {
  return Math.max(0, ...tables.map((t) => t?.columns.length ?? 0));
}

function isSplitLabourMissing(
  billShape: string | undefined,
  labourMeta: ColumnsOnlyTable,
  parts: DynamicTable,
  labour: DynamicTable,
): boolean {
  const isSplit = !billShape || billShape === 'split';
  return isSplit
    && (labourMeta.columns.length > 0 || parts.columns.length > 0)
    && parts.rows.length > 0
    && labour.rows.length === 0;
}

export class WorkshopBillExtractor {
  private aiService: AIService;
  private obs = ObserverService.getInstance();

  constructor() {
    this.aiService = AIService.getInstance();
  }

  private parseWorkshopResult(raw: unknown) {
    try {
      const obj = raw as Record<string, unknown>;
      const normalized = {
        ...obj,
        parts: parseDynamicTable(obj.parts),
        labour: parseDynamicTable(obj.labour),
        lineItems: obj.lineItems ? parseDynamicTable(obj.lineItems) : undefined,
      };
      if (normalized.lineItems && !normalized.lineItems.rows.length && !normalized.lineItems.columns.length) {
        delete normalized.lineItems;
      }
      return WorkshopBillSchema.parse(normalized);
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

  private async runMetaExtract(inputData: unknown, pageCount: number): Promise<WorkshopRawResult> {
    const chunkModel = _config.WORKSHOP_CHUNK_AI_MODEL;
    const metaPages = pageCount > 1 ? [1, pageCount] : [1];
    const slice = await buildSliceInput(inputData, metaPages, 'WORKSHOP-META');
    try {
      return (await this.callGemini(
        slice.input,
        getWorkshopMetaPrompt(pageCount),
        WorkshopMetaSchema,
        computeWorkshopMetaMaxTokens(),
        'WORKSHOP-META',
        chunkModel,
      )) as WorkshopRawResult;
    } finally {
      await slice.dispose();
    }
  }

  private minRowsForChunk(
    pageIndices: number[],
    chunkIndex: number,
    totalPageCount: number,
  ): number {
    const pagesInChunk = pageIndices.length;
    const isFirstChunk = chunkIndex === 0 && pageIndices[0] === 1;
    const isLastChunk = pageIndices[pageIndices.length - 1] === totalPageCount;
    if (isFirstChunk) return 3 + (pagesInChunk - 1) * 8;
    if (isLastChunk) return Math.max(3, pagesInChunk * 5);
    return pagesInChunk * 8;
  }

  private isChunkSoftTruncated(
    rows: number,
    pageIndices: number[],
    chunkIndex: number,
    totalPageCount: number,
  ): boolean {
    if (rows === 0) return false;
    return rows < this.minRowsForChunk(pageIndices, chunkIndex, totalPageCount);
  }

  private async runSingleRowsChunkExtract(
    inputData: unknown,
    pageIndices: number[],
    meta: WorkshopMetaForRows,
    cacheSuffix: string,
    columnCount: number,
    promptOverride?: string,
    modelOverride?: string,
  ): Promise<RowsChunkExtractResult> {
    const chunkModel = modelOverride ?? _config.WORKSHOP_CHUNK_AI_MODEL;
    const chunkTokens = computeWorkshopRowsMaxTokens(
      pageIndices.length,
      _config.WORKSHOP_MAX_OUTPUT_TOKENS,
      columnCount,
    );

    const slice = await buildSliceInput(inputData, pageIndices, cacheSuffix);
    try {
      const chunk = (await this.callGemini(
        slice.input,
        promptOverride ?? getWorkshopRowsChunkPrompt(meta),
        WorkshopRowsOnlySchema,
        chunkTokens,
        cacheSuffix,
        chunkModel,
      )) as WorkshopRawResult;

      return parseRowsChunk(chunk);
    } finally {
      await slice.dispose();
    }
  }

  private chunkToTables(
    chunk: RowsChunkExtractResult,
    partsMeta: ColumnsOnlyTable,
    labourMeta: ColumnsOnlyTable,
    lineItemsMeta?: ColumnsOnlyTable,
  ): { parts: DynamicTable; labour: DynamicTable; lineItems?: DynamicTable } {
    const adoptedParts = adoptLateColumns(partsMeta, chunk.parts);
    const adoptedLabour = adoptLateColumns(labourMeta, chunk.labour, partsMeta);
    const adoptedLineItems = lineItemsMeta && chunk.lineItems
      ? adoptLateColumns(lineItemsMeta, chunk.lineItems)
      : lineItemsMeta;

    const parts = attachRowsToMeta(adoptedParts, chunk.parts);
    const labour = attachRowsToMeta(adoptedLabour, chunk.labour);
    const lineItems = chunk.lineItems
      ? attachRowsToMeta(adoptedLineItems ?? { columns: [] }, chunk.lineItems)
      : undefined;

    return {
      parts,
      labour,
      lineItems: lineItems?.rows.length || lineItems?.columns.length ? lineItems : undefined,
    };
  }

  private async tryLabourRetry(
    inputData: unknown,
    pageIndices: number[],
    promptMeta: WorkshopMetaForRows,
    chunkIndex: number,
    columnCount: number,
    currentLabourMeta: ColumnsOnlyTable,
    resultTables: { parts: DynamicTable; labour: DynamicTable; lineItems?: DynamicTable },
    modelOverride?: string,
  ): Promise<{ labourMeta: ColumnsOnlyTable; tables: { parts: DynamicTable; labour: DynamicTable; lineItems?: DynamicTable } }> {
    const suffix = modelOverride ? `-PRO` : '';
    const labourPrompt = getWorkshopLabourRetryPrompt(promptMeta);

    const runOnPages = async (pages: number[], tag: string) => {
      const labourRetry = await this.runSingleRowsChunkExtract(
        inputData,
        pages,
        promptMeta,
        tag,
        columnCount,
        labourPrompt,
        modelOverride,
      );
      const labourMeta = preferChunkLabourColumns(
        currentLabourMeta,
        labourRetry.labour,
        promptMeta.parts ?? { columns: [] },
      );
      return {
        labourMeta,
        tables: {
          ...resultTables,
          labour: attachRowsToMeta(labourMeta, labourRetry.labour),
        },
      };
    };

    const labourPages = pageIndices.includes(1) ? [1] : pageIndices;
    let result = await runOnPages(labourPages, `WORKSHOP-ROWS-LABOUR-${chunkIndex + 1}${suffix}`);

    if (result.tables.labour.rows.length === 0 && pageIndices.length > 1) {
      const lastPage = pageIndices[pageIndices.length - 1];
      if (!labourPages.includes(lastPage)) {
        this.obs.warn(
          `WorkshopBillExtractor: Labour retry page 1 empty — retrying page ${lastPage}.`,
          { pageIndices },
        );
        result = await runOnPages(
          [lastPage],
          `WORKSHOP-ROWS-LABOUR-${chunkIndex + 1}P${lastPage}${suffix}`,
        );
      }
    }

    return result;
  }

  private async tryLabourContinuation(
    inputData: unknown,
    pageCount: number,
    billShape: string | undefined,
    partsMeta: ColumnsOnlyTable,
    labourMeta: ColumnsOnlyTable,
    currentLabour: DynamicTable,
    labourSubTotal: number,
  ): Promise<{ labour: DynamicTable; labourMeta: ColumnsOnlyTable }> {
    const promptMeta = promptMetaFromColumns(billShape, partsMeta, labourMeta, undefined);
    const columnCount = Math.max(
      partsMeta.columns.length,
      labourMeta.columns.length,
    );
    const continuation = await this.runSingleRowsChunkExtract(
      inputData,
      [pageCount],
      promptMeta,
      `WORKSHOP-ROWS-LABOUR-CONT-${pageCount}`,
      columnCount,
      getWorkshopLabourRetryPrompt(promptMeta),
    );
    const resolvedMeta = preferChunkLabourColumns(labourMeta, continuation.labour, partsMeta);
    const continuationTable = attachRowsToMeta(resolvedMeta, continuation.labour);
    const merged = sortTableBySerial(mergeDynamicTables(currentLabour, continuationTable));
    this.obs.info(
      `WorkshopBillExtractor: Labour continuation on page ${pageCount} — ${currentLabour.rows.length} → ${merged.rows.length} rows.`,
    );
    return { labour: merged, labourMeta: resolvedMeta };
  }

  private async extractRowsChunkResilient(
    inputData: unknown,
    pageIndices: number[],
    chunkIndex: number,
    totalPageCount: number,
    billShape: string | undefined,
    partsMeta: ColumnsOnlyTable,
    labourMeta: ColumnsOnlyTable,
    lineItemsMeta: ColumnsOnlyTable | undefined,
    columnCount: number,
  ): Promise<{ parts: DynamicTable; labour: DynamicTable; lineItems?: DynamicTable; adopted: {
    parts: ColumnsOnlyTable;
    labour: ColumnsOnlyTable;
    lineItems?: ColumnsOnlyTable;
  } }> {
    const pageStart = pageIndices[0];
    const pageEnd = pageIndices[pageIndices.length - 1];

    this.obs.info(
      `WorkshopBillExtractor: Rows chunk ${chunkIndex + 1} — pages ${pageStart}–${pageEnd}`,
    );

    const promptMeta = promptMetaFromColumns(billShape, partsMeta, labourMeta, lineItemsMeta);

    let initial: RowsChunkExtractResult;
    let isTruncated = false;
    let currentPartsMeta = partsMeta;
    let currentLabourMeta = labourMeta;
    let currentLineItemsMeta = lineItemsMeta;
    let resultTables: { parts: DynamicTable; labour: DynamicTable; lineItems?: DynamicTable } = {
      parts: emptyDynamicTable(),
      labour: emptyDynamicTable(),
    };
    let initialRows = 0;

    try {
      initial = await this.runSingleRowsChunkExtract(
        inputData,
        pageIndices,
        promptMeta,
        `WORKSHOP-ROWS-CHUNK-${chunkIndex + 1}`,
        columnCount,
      );

      currentPartsMeta = adoptLateColumns(partsMeta, initial.parts);
      currentLabourMeta = preferChunkLabourColumns(labourMeta, initial.labour, currentPartsMeta);
      currentLineItemsMeta = lineItemsMeta && initial.lineItems
        ? adoptLateColumns(lineItemsMeta, initial.lineItems)
        : lineItemsMeta;

      resultTables = this.chunkToTables(
        initial,
        currentPartsMeta,
        currentLabourMeta,
        currentLineItemsMeta,
      );
      initialRows = rowCount(resultTables.parts, resultTables.labour, resultTables.lineItems);

      isTruncated = this.isChunkSoftTruncated(initialRows, pageIndices, chunkIndex, totalPageCount);
      if (!isTruncated && hasSerialGaps(resultTables.parts, resultTables.labour, resultTables.lineItems)) {
        this.obs.warn(
          `WorkshopBillExtractor: Serial gap on rows chunk ${chunkIndex + 1}. Marking as truncated.`,
          { rows: initialRows },
        );
        isTruncated = true;
      }
      if (!isTruncated && hasLabourSerialIncomplete(resultTables.labour)) {
        this.obs.warn(
          `WorkshopBillExtractor: Labour serial incomplete on chunk ${chunkIndex + 1}. Marking as truncated.`,
          { labourRows: resultTables.labour.rows.length },
        );
        isTruncated = true;
      }

      if (isSplitLabourMissing(billShape, currentLabourMeta, resultTables.parts, resultTables.labour)) {
        this.obs.warn(
          `WorkshopBillExtractor: Split labour missing on chunk ${chunkIndex + 1} — labour-only retry (page 1).`,
          { pageIndices },
        );
        const retried = await this.tryLabourRetry(
          inputData,
          pageIndices,
          promptMeta,
          chunkIndex,
          columnCount,
          currentLabourMeta,
          resultTables,
        );
        currentLabourMeta = retried.labourMeta;
        resultTables = retried.tables;
        if (resultTables.labour.rows.length === 0) {
          isTruncated = true;
        }
      }
    } catch (e) {
      if (isWorkshopTruncationError(e)) {
        this.obs.warn(
          `WorkshopBillExtractor: Rows chunk ${chunkIndex + 1} hard-truncated — falling back page-by-page.`,
          { pageIndices },
        );
        isTruncated = true;
        initial = { parts: { rows: [] }, labour: { rows: [] } };
      } else {
        throw e;
      }
    }

    const labourStillMissing = isSplitLabourMissing(
      billShape,
      currentLabourMeta,
      resultTables.parts,
      resultTables.labour,
    );

    if (!isTruncated) {
      return {
        ...resultTables,
        adopted: {
          parts: currentPartsMeta,
          labour: currentLabourMeta,
          lineItems: currentLineItemsMeta,
        },
      };
    }

    if (pageIndices.length <= 1) {
      const proModel = _config.WORKSHOP_AI_MODEL;
      if (proModel && proModel !== _config.WORKSHOP_CHUNK_AI_MODEL) {
        try {
          if (labourStillMissing) {
            const proLabour = await this.tryLabourRetry(
              inputData,
              pageIndices,
              promptMeta,
              chunkIndex,
              columnCount,
              currentLabourMeta,
              resultTables,
              proModel,
            );
            if (proLabour.tables.labour.rows.length > 0) {
              return {
                ...proLabour.tables,
                adopted: {
                  parts: currentPartsMeta,
                  labour: proLabour.labourMeta,
                  lineItems: currentLineItemsMeta,
                },
              };
            }
          } else {
            const proResult = await this.runSingleRowsChunkExtract(
              inputData,
              pageIndices,
              promptMetaFromColumns(billShape, currentPartsMeta, currentLabourMeta, currentLineItemsMeta),
              `WORKSHOP-ROWS-CHUNK-${chunkIndex + 1}-PRO`,
              columnCount,
              undefined,
              proModel,
            );
            const proTables = this.chunkToTables(
              proResult,
              currentPartsMeta,
              currentLabourMeta,
              currentLineItemsMeta,
            );
            if (rowCount(proTables.parts, proTables.labour, proTables.lineItems) > initialRows) {
              return {
                ...proTables,
                adopted: {
                  parts: adoptLateColumns(currentPartsMeta, proResult.parts),
                  labour: preferChunkLabourColumns(currentLabourMeta, proResult.labour, currentPartsMeta),
                  lineItems: currentLineItemsMeta && proResult.lineItems
                    ? adoptLateColumns(currentLineItemsMeta, proResult.lineItems)
                    : currentLineItemsMeta,
                },
              };
            }
          }
        } catch (e) {
          this.obs.warn(`WorkshopBillExtractor: Pro fallback failed for page ${pageStart}`, { error: e });
        }
      }
      return {
        ...resultTables,
        adopted: {
          parts: currentPartsMeta,
          labour: currentLabourMeta,
          lineItems: currentLineItemsMeta,
        },
      };
    }

    return this.extractRowsPageByPage(
      inputData,
      pageIndices,
      chunkIndex,
      billShape,
      currentPartsMeta,
      currentLabourMeta,
      currentLineItemsMeta,
      columnCount,
      initialRows,
    );
  }

  private async extractRowsPageByPage(
    inputData: unknown,
    pageIndices: number[],
    chunkIndex: number,
    billShape: string | undefined,
    partsMeta: ColumnsOnlyTable,
    labourMeta: ColumnsOnlyTable,
    lineItemsMeta: ColumnsOnlyTable | undefined,
    columnCount: number,
    initialRows: number,
  ): Promise<{ parts: DynamicTable; labour: DynamicTable; lineItems?: DynamicTable; adopted: {
    parts: ColumnsOnlyTable;
    labour: ColumnsOnlyTable;
    lineItems?: ColumnsOnlyTable;
  } }> {
    this.obs.warn(
      `WorkshopBillExtractor: Rows chunk ${chunkIndex + 1} truncated (${initialRows} rows) — retrying page-by-page.`,
      { pageIndices, initialRows },
    );

    let currentPartsMeta = partsMeta;
    let currentLabourMeta = labourMeta;
    let currentLineItemsMeta = lineItemsMeta;
    let mergedParts = emptyDynamicTable();
    let mergedLabour = emptyDynamicTable();
    let mergedLineItems: DynamicTable | undefined;

    for (let p = 0; p < pageIndices.length; p++) {
      const singlePage = [pageIndices[p]];
      let sub = await this.runSingleRowsChunkExtract(
        inputData,
        singlePage,
        promptMetaFromColumns(billShape, currentPartsMeta, currentLabourMeta, currentLineItemsMeta),
        `WORKSHOP-ROWS-CHUNK-${chunkIndex + 1}P${pageIndices[p]}`,
        columnCount,
      );

      currentPartsMeta = adoptLateColumns(currentPartsMeta, sub.parts);
      currentLabourMeta = preferChunkLabourColumns(currentLabourMeta, sub.labour, currentPartsMeta);
      if (currentLineItemsMeta && sub.lineItems) {
        currentLineItemsMeta = adoptLateColumns(currentLineItemsMeta, sub.lineItems);
      }

      const subRows = rowCount(
        attachRowsToMeta(currentPartsMeta, sub.parts),
        attachRowsToMeta(currentLabourMeta, sub.labour),
        sub.lineItems ? attachRowsToMeta(currentLineItemsMeta ?? { columns: [] }, sub.lineItems) : undefined,
      );

      if (subRows >= 15) {
        const proModel = _config.WORKSHOP_AI_MODEL;
        if (proModel && proModel !== _config.WORKSHOP_CHUNK_AI_MODEL) {
          try {
            const proSub = await this.runSingleRowsChunkExtract(
              inputData,
              singlePage,
              promptMetaFromColumns(billShape, currentPartsMeta, currentLabourMeta, currentLineItemsMeta),
              `WORKSHOP-ROWS-CHUNK-${chunkIndex + 1}P${pageIndices[p]}-PRO`,
              columnCount,
              undefined,
              proModel,
            );
            if (rowCount(
              attachRowsToMeta(currentPartsMeta, proSub.parts),
              attachRowsToMeta(currentLabourMeta, proSub.labour),
              proSub.lineItems ? attachRowsToMeta(currentLineItemsMeta ?? { columns: [] }, proSub.lineItems) : undefined,
            ) > subRows) {
              sub = proSub;
              currentPartsMeta = adoptLateColumns(currentPartsMeta, sub.parts);
              currentLabourMeta = preferChunkLabourColumns(currentLabourMeta, sub.labour, currentPartsMeta);
              if (currentLineItemsMeta && sub.lineItems) {
                currentLineItemsMeta = adoptLateColumns(currentLineItemsMeta, sub.lineItems);
              }
            }
          } catch (e) {
            this.obs.warn(`WorkshopBillExtractor: Page ${pageIndices[p]} Pro fallback failed`, { error: e });
          }
        }
      }

      const subTables = this.chunkToTables(sub, currentPartsMeta, currentLabourMeta, currentLineItemsMeta);
      mergedParts = mergeDynamicTables(mergedParts, subTables.parts);
      mergedLabour = mergeDynamicTables(mergedLabour, subTables.labour);
      if (subTables.lineItems) {
        mergedLineItems = mergedLineItems
          ? mergeDynamicTables(mergedLineItems, subTables.lineItems)
          : subTables.lineItems;
      }
    }

    return {
      parts: mergedParts,
      labour: mergedLabour,
      lineItems: mergedLineItems,
      adopted: {
        parts: currentPartsMeta,
        labour: currentLabourMeta,
        lineItems: currentLineItemsMeta,
      },
    };
  }

  private async extractTwoPass(inputData: unknown, pageCount: number): Promise<WorkshopRawResult> {
    this.obs.info(
      `WorkshopBillExtractor: 2-pass mode — ${pageCount} page(s), meta then rows, model=${_config.WORKSHOP_CHUNK_AI_MODEL}`,
    );

    const meta = await this.runMetaExtract(inputData, pageCount);

    enforceDocumentTypeGates(meta, {
      extractorName: 'WorkshopBillExtractor',
      wrongTypeMessage: (typeStr) =>
        `The uploaded document appears to be a "${typeStr}", not a Workshop Bill. ` +
        'Please upload a valid repair/service bill, proforma estimate, or job card.',
      mixedBatchMessage: (pageList) =>
        `Mixed document batch detected for Workshop Bill extraction. ${pageList} ` +
        'Please ensure all uploaded pages belong to the same workshop bill or repair estimate.',
    });

    const metaForPrompt = metaForRows(meta);
    const billShape = metaForPrompt.billShape;
    const normalized = normalizeSplitColumns(
      metaForPrompt.parts ?? { columns: [] },
      metaForPrompt.labour ?? { columns: [] },
      billShape,
    );
    let partsMeta = normalized.parts;
    let labourMeta = normalized.labour;
    let lineItemsMeta = metaForPrompt.lineItems;
    let columnCount = maxColumnCount(partsMeta, labourMeta, lineItemsMeta);

    const chunkSize = _config.WORKSHOP_CHUNK_PAGE_SIZE;
    const chunks = buildPageChunks(pageCount, chunkSize);

    let mergedParts = emptyDynamicTable();
    let mergedLabour = emptyDynamicTable();
    let mergedLineItems: DynamicTable | undefined;

    for (let i = 0; i < chunks.length; i++) {
      const pageIndices = chunks[i];
      const result = await this.extractRowsChunkResilient(
        inputData,
        pageIndices,
        i,
        pageCount,
        billShape,
        partsMeta,
        labourMeta,
        lineItemsMeta,
        columnCount,
      );

      partsMeta = result.adopted.parts;
      labourMeta = result.adopted.labour;
      lineItemsMeta = result.adopted.lineItems;
      columnCount = maxColumnCount(partsMeta, labourMeta, lineItemsMeta);

      mergedParts = mergeDynamicTables(mergedParts, result.parts);
      mergedLabour = mergeDynamicTables(mergedLabour, result.labour);
      if (result.lineItems) {
        mergedLineItems = mergedLineItems
          ? mergeDynamicTables(mergedLineItems, result.lineItems)
          : result.lineItems;
      }
    }

    let finalParts = mergedParts;
    let finalLabour = mergedLabour;

    if (mergedLineItems?.rows.length) {
      const unified: DynamicTable = {
        section: lineItemsMeta?.section ?? partsMeta.section,
        columns: lineItemsMeta?.columns?.length
          ? lineItemsMeta.columns
          : mergedLineItems.columns,
        rows: mergedLineItems.rows,
      };
      const split = splitPlUnified(unified);
      finalParts = split.parts;
      finalLabour = split.labour;
      partsMeta = { section: unified.section, columns: unified.columns };
      labourMeta = { section: unified.section, columns: unified.columns };
    }

    const summaryObj = meta.summary as Record<string, unknown> | null | undefined;
    const labourSubFromSummary = Number(summaryObj?.labourSubTotal ?? 0);

    const needsLabourContinuation = pageCount > 1 && (
      (finalLabour.rows.length > 0 && isLabourUnderExtracted(finalLabour, labourSubFromSummary))
      || isLabourExpected(
        finalLabour.rows.length,
        labourSubFromSummary,
        partsMeta.columns,
        labourMeta,
        finalParts.rows.length,
      )
    );

    if (needsLabourContinuation) {
      this.obs.warn(
        'WorkshopBillExtractor: Labour missing or under-extracted — continuation on last page.',
        { labourSubTotal: labourSubFromSummary, labourRows: finalLabour.rows.length },
      );
      try {
        const continued = await this.tryLabourContinuation(
          inputData,
          pageCount,
          billShape,
          partsMeta,
          labourMeta,
          finalLabour,
          labourSubFromSummary,
        );
        finalLabour = continued.labour;
        labourMeta = continued.labourMeta;
      } catch (e) {
        this.obs.warn('WorkshopBillExtractor: Labour continuation failed', { error: e });
      }
    }

    const chargesSplit = splitLabourChargesRows(
      { section: partsMeta.section, columns: partsMeta.columns, rows: finalParts.rows },
      { section: labourMeta.section, columns: labourMeta.columns, rows: finalLabour.rows },
    );
    if (chargesSplit.labour.rows.length > 0) {
      finalParts = chargesSplit.parts;
      finalLabour = chargesSplit.labour;
      if (!labourMeta.section && chargesSplit.labour.section) {
        labourMeta = { ...labourMeta, section: chargesSplit.labour.section };
      }
    }

    const alignedLabour = alignLabourToSharedHeader(partsMeta.columns, {
      section: labourMeta.section,
      columns: labourMeta.columns,
      rows: finalLabour.rows,
    });
    if (
      alignedLabour.columns.length !== labourMeta.columns.length
      || alignedLabour.rows !== finalLabour.rows
    ) {
      finalLabour = alignedLabour;
      labourMeta = { ...labourMeta, columns: alignedLabour.columns };
    }

    const correctedLabour = correctIndependentLabourHeaders({
      section: labourMeta.section,
      columns: labourMeta.columns,
      rows: finalLabour.rows,
    });
    if (correctedLabour.columns !== labourMeta.columns) {
      finalLabour = correctedLabour;
      labourMeta = { ...labourMeta, columns: correctedLabour.columns };
    }

    if (
      finalLabour.rows.length === 0
      && isLabourExpected(
        0,
        labourSubFromSummary,
        partsMeta.columns,
        labourMeta,
        finalParts.rows.length,
      )
    ) {
      this.obs.warn(
        'WorkshopBillExtractor: labour.rows empty but labour expected — flagging for human review.',
        { labourSubTotal: labourSubFromSummary, labourColumns: labourMeta.columns.length },
      );
      meta.requiresHumanReview = true;
    }

    const maxSr = Math.max(
      maxSerialFromTable(finalParts),
      maxSerialFromTable(finalLabour),
    );
    const totalRows = rowCount(finalParts, finalLabour);
    if (maxSr > 0 && maxSr > totalRows + 2) {
      this.obs.warn(
        `WorkshopBillExtractor: Sr.No gap after merge — maxSr=${maxSr}, rows=${totalRows}. Flagging for human review.`,
        { maxSr, totalRows, pageCount },
      );
      meta.requiresHumanReview = true;
      meta.confidenceScore = Math.min(Number(meta.confidenceScore ?? 1), 0.75);
    }

    const { billShape: _billShape, ...metaRest } = meta;
    const finalizedLabour = finalizeLabourTable(
      { section: labourMeta.section, columns: labourMeta.columns, rows: finalLabour.rows },
      partsMeta.columns.length,
    );

    if (hasRowWidthMismatch(finalParts) || hasRowWidthMismatch(finalizedLabour)) {
      this.obs.warn('WorkshopBillExtractor: Row width mismatch — flagging for human review.');
      meta.requiresHumanReview = true;
      meta.confidenceScore = Math.min(Number(meta.confidenceScore ?? 1), 0.75);
    }

    return {
      ...metaRest,
      parts: {
        section: partsMeta.section,
        columns: partsMeta.columns,
        rows: finalParts.rows,
      },
      labour: {
        section: finalizedLabour.section,
        columns: finalizedLabour.columns,
        rows: finalizedLabour.rows,
      },
    };
  }

  public async extract(
    inputData: unknown,
    _options: WorkshopExtractOptions = {},
  ) {
    const fileCount = Array.isArray(inputData) ? inputData.length : 1;
    const pageCount = resolveDocumentPageCount(inputData);

    this.obs.info(
      `WorkshopBillExtractor: Starting extraction — ${fileCount} file(s), ${pageCount} PDF page(s)`,
    );

    const rawResult = await this.extractTwoPass(inputData, pageCount);

    this.obs.info('WorkshopBillExtractor: Raw extraction complete, validating with Zod schema...');

    const parsedResult = this.parseWorkshopResult(rawResult);

    const hasPartsOrLabour =
      (parsedResult.parts?.rows.length ?? 0) > 0 ||
      (parsedResult.labour?.rows.length ?? 0) > 0 ||
      (parsedResult.lineItems?.rows.length ?? 0) > 0;

    const hasWorkshopIdentity =
      !isEffectivelyEmpty(parsedResult.workshopDetails?.name) ||
      !isEffectivelyEmpty(parsedResult.workshopDetails?.invoiceNumber);

    const confidence = parsedResult.confidenceScore ?? 0;

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
    const partsSubTotal = (summary as Record<string, unknown> | null | undefined)?.['partsSubTotal'] as number | null ?? 0;
    const labourSubTotal = (summary as Record<string, unknown> | null | undefined)?.['labourSubTotal'] as number | null ?? 0;
    const grandTotalFromSummary = summary?.grandTotal ?? 0;

    const grandTotalCheck = computeGrandTotalCheck({
      partsTotal: partsSubTotal,
      labourTotal: labourSubTotal,
      totalTaxAmount: 0,
      grandTotal: grandTotalFromSummary,
      taxInclusiveSubtotals: true,
    });

    if (!grandTotalCheck.ok) {
      this.obs.warn(
        `WorkshopBillExtractor: Grand total mismatch — ` +
        `expected=₹${grandTotalCheck.expected.toFixed(2)}, ` +
        `actual=₹${grandTotalCheck.actual.toFixed(2)}, ` +
        `delta=₹${grandTotalCheck.delta.toFixed(2)}. Flagging for human review.`,
      );
    }

    const gstInfo = normaliseGst({});

    const billType = classifyBillType(
      parsedResult.workshopDetails?.invoiceNumber,
      parsedResult.workshopDetails?.documentTitle,
    );

    const rawVehicle = parsedResult.workshopDetails?.vehicleNumber ?? null;
    const normVehicleNo = normaliseVehicleNo(rawVehicle);
    const vehicleState = extractVehicleState(normVehicleNo);

    const enriched: Record<string, unknown> = {
      ...parsedResult,
      vehicleNumber: normVehicleNo ?? rawVehicle,
      vehicleState,
      billType,
      gstSummary: gstInfo,
      grandTotalVerified: grandTotalCheck.ok,
      requiresHumanReview: parsedResult.requiresHumanReview || !grandTotalCheck.ok,
      extractionMode: 'two-pass',
    };

    this.obs.info(
      `WorkshopBillExtractor: Extraction successful — ` +
      `pages=${pageCount}, ` +
      `parts=${parsedResult.parts?.rows.length ?? 0}, ` +
      `labour=${parsedResult.labour?.rows.length ?? 0}, ` +
      `lineItems=${parsedResult.lineItems?.rows.length ?? 0}, ` +
      `billType=${billType}, ` +
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
