import { z } from 'zod';

/** Strip ₹, Rs., commas — handles Indian grouping (8,25,795.21 → 825795.21) */
export function preprocessWorkshopNumber(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string') {
    const cleanStr = val.replace(/[^0-9.-]+/g, '');
    const num = parseFloat(cleanStr);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

export const workshopNumeric = z.preprocess(preprocessWorkshopNumber, z.number().nullable());

export const ExtraFieldSchema = z.object({
  key: z.string(),
  value: z.string().nullable(),
});

export const WorkshopSummarySchema = z.object({
  totalPartsAmount: workshopNumeric.optional(),
  totalLabourAmount: workshopNumeric.optional(),
  partsSubtotalWithTax: workshopNumeric.optional(),
  labourSubtotalWithTax: workshopNumeric.optional(),
  totalDiscount: workshopNumeric.optional(),
  totalGstAmount: workshopNumeric.optional(),
  igstRate: workshopNumeric.optional(),
  igstAmount: workshopNumeric.optional(),
  cgstRate: workshopNumeric.optional(),
  cgstAmount: workshopNumeric.optional(),
  sgstRate: workshopNumeric.optional(),
  sgstAmount: workshopNumeric.optional(),
  grandTotal: workshopNumeric.optional(),
  amountInWords: z.string().nullable().optional(),
}).nullable().optional();

export const WorkshopDetailsSchema = z.object({
  name: z.string().nullable().optional(),
  gstin: z.string().nullable().optional(),
  invoiceNumber: z.string().nullable().optional(),
  invoiceDate: z.string().nullable().optional(),
  vehicleNumber: z.string().nullable().optional(),
  documentTitle: z.string().nullable().optional(),
  jobCardNumber: z.string().nullable().optional(),
  customerName: z.string().nullable().optional(),
  odometerReading: z.string().nullable().optional(),
}).nullable().optional();

export const WorkshopDocumentGateSchema = z.object({
  isCorrectDocumentType: z.boolean().optional(),
  detectedDocumentType: z.string().nullable().optional(),
  hasAllPagesCorrectType: z.boolean().optional(),
  invalidPageIndices: z.array(z.number()).nullable().optional(),
  confidenceScore: z.number().min(0).max(1).optional(),
  requiresHumanReview: z.boolean().optional(),
});

export const DynamicTableSchema = z.object({
  section: z.string().optional(),
  columns: z.array(z.string()),
  rows: z.array(z.array(z.string())),
});

export type DynamicTable = z.infer<typeof DynamicTableSchema>;

export function emptyDynamicTable(): DynamicTable {
  return { columns: [], rows: [] };
}

/** Coerce raw Gemini output into a DynamicTable. */
export function parseDynamicTable(raw: unknown): DynamicTable {
  if (!raw || typeof raw !== 'object') return emptyDynamicTable();
  const obj = raw as Record<string, unknown>;
  return {
    section: typeof obj.section === 'string' ? obj.section : undefined,
    columns: Array.isArray(obj.columns) ? obj.columns.map(String) : [],
    rows: Array.isArray(obj.rows)
      ? obj.rows
          .filter(Array.isArray)
          .map((row) => (row as unknown[]).map((cell) => String(cell ?? '')))
      : [],
  };
}

/** columns + row arrays → row objects for web display. */
export function zipDynamicTable(table: DynamicTable): Record<string, string>[] {
  const { columns, rows } = table;
  return rows.map((row, i) => {
    const obj: Record<string, string> = { rowIndex: String(i + 1) };
    columns.forEach((col, j) => {
      obj[col] = row[j] ?? '';
    });
    return obj;
  });
}

/** Chunk merge: same columns from first chunk, concat rows, dedupe identical rows. */
export type ColumnsOnlyTable = { section?: string; columns: string[] };

export type RowsChunkTable = { section?: string; columns?: string[]; rows: string[][] };

/** Parse meta-pass table (section + columns only). */
export function parseColumnsOnlyTable(raw: unknown): ColumnsOnlyTable {
  if (!raw || typeof raw !== 'object') return { columns: [] };
  const obj = raw as Record<string, unknown>;
  return {
    section: typeof obj.section === 'string' ? obj.section : undefined,
    columns: Array.isArray(obj.columns) ? obj.columns.map(String) : [],
  };
}

/** Parse row-chunk table (rows required; columns/section optional for late sections). */
export function parseRowsChunkTable(raw: unknown): RowsChunkTable {
  if (!raw || typeof raw !== 'object') return { rows: [] };
  const obj = raw as Record<string, unknown>;
  return {
    section: typeof obj.section === 'string' ? obj.section : undefined,
    columns: Array.isArray(obj.columns) ? obj.columns.map(String) : undefined,
    rows: Array.isArray(obj.rows)
      ? obj.rows
          .filter(Array.isArray)
          .map((row) => (row as unknown[]).map((cell) => String(cell ?? '')))
      : [],
  };
}

/** Build DynamicTable from meta columns + chunk rows; adopt late columns if meta empty. */
export function attachRowsToMeta(meta: ColumnsOnlyTable, chunk: RowsChunkTable): DynamicTable {
  const columns = meta.columns.length ? meta.columns : (chunk.columns ?? []);
  return {
    section: meta.section ?? chunk.section,
    columns,
    rows: chunk.rows,
  };
}

/** Adopt section/columns from chunk when meta pass did not see that section (Eicher labour on page 9). */
export function adoptLateColumns(
  meta: ColumnsOnlyTable,
  chunk: RowsChunkTable,
  partsMeta?: ColumnsOnlyTable,
): ColumnsOnlyTable {
  if (partsMeta) {
    const cols = resolveLabourColumns(meta, chunk, partsMeta);
    if (cols.length) {
      return { section: chunk.section ?? meta.section, columns: cols };
    }
    if (meta.columns.length) return meta;
    return meta;
  }
  if (meta.columns.length) return meta;
  if (!chunk.columns?.length) return meta;
  return { section: chunk.section ?? meta.section, columns: [...chunk.columns] };
}

export function mergeDynamicTables(a: DynamicTable, b: DynamicTable): DynamicTable {
  if (!a.rows.length && !a.columns.length) {
    return { section: b.section, columns: [...b.columns], rows: [...b.rows] };
  }
  if (!b.rows.length) {
    return { section: a.section, columns: [...a.columns], rows: [...a.rows] };
  }

  const columns = a.columns.length ? a.columns : b.columns;
  const seen = new Set<string>();
  const rows: string[][] = [];

  for (const table of [a, b]) {
    for (const row of table.rows) {
      const key = row.join('\x1f');
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
  }

  return { section: a.section ?? b.section, columns, rows };
}

/** Find P/L column index by header name; fallback 0 if header matches P/L pattern. */
export function findPlColumnIndex(columns: string[]): number {
  for (let i = 0; i < columns.length; i++) {
    const norm = columns[i].replace(/\s+/g, '').toUpperCase();
    if (norm === 'P/L' || norm === 'P-L' || norm === 'PL' || norm === 'P|L') return i;
  }
  return 0;
}

/** Split unified P/L table into parts + labour (same columns). */
export function splitPlUnified(table: DynamicTable): { parts: DynamicTable; labour: DynamicTable } {
  const plIdx = findPlColumnIndex(table.columns);
  const partsRows: string[][] = [];
  const labourRows: string[][] = [];

  for (const row of table.rows) {
    const marker = String(row[plIdx] ?? '').trim().toUpperCase();
    if (marker === 'L') labourRows.push(row);
    else if (marker === 'P') partsRows.push(row);
    else partsRows.push(row); // ponytail: unknown marker → parts
  }

  const base = { section: table.section, columns: [...table.columns] };
  return {
    parts: { ...base, rows: partsRows },
    labour: { ...base, rows: labourRows },
  };
}

/** True if any row.length !== columns.length (and columns non-empty). */
export function hasRowWidthMismatch(table: DynamicTable): boolean {
  if (!table.columns.length || !table.rows.length) return false;
  const expected = table.columns.length;
  return table.rows.some((row) => row.length !== expected);
}

/** Kia split: inherit parts.columns into labour only when labour headers are unknown. */
export function normalizeSplitColumns(
  partsMeta: ColumnsOnlyTable,
  labourMeta: ColumnsOnlyTable,
  billShape?: string,
): { parts: ColumnsOnlyTable; labour: ColumnsOnlyTable } {
  const isSplit = !billShape || billShape === 'split';
  if (!isSplit || !partsMeta.columns.length) {
    return { parts: partsMeta, labour: labourMeta };
  }
  const labour = { ...labourMeta };
  if (isSharedHeaderLabour(partsMeta.columns)) {
    labour.columns = [...partsMeta.columns];
    return { parts: partsMeta, labour };
  }
  if (!labour.columns.length && !labour.section) {
    labour.columns = [...partsMeta.columns];
  }
  return { parts: partsMeta, labour };
}

/** Trust chunk-discovered labour headers when they differ from parts (independent sections). */
export function preferChunkLabourColumns(
  meta: ColumnsOnlyTable,
  chunk: RowsChunkTable,
  partsMeta: ColumnsOnlyTable,
): ColumnsOnlyTable {
  const columns = resolveLabourColumns(meta, chunk, partsMeta);
  if (!columns.length) return meta;
  return { section: chunk.section ?? meta.section, columns };
}

/** Sum the last numeric column (typically Total) for reconciliation. */
export function sumTableLastNumericColumn(table: DynamicTable): number {
  if (!table.rows.length) return 0;
  const colIdx = Math.max(0, (table.columns.length || table.rows[0]?.length || 1) - 1);
  let sum = 0;
  for (const row of table.rows) {
    const n = preprocessWorkshopNumber(row[colIdx]);
    if (n != null) sum += n;
  }
  return sum;
}

/** True when printed labourSubTotal exceeds row sum by >15% (under-extraction). */
export function isLabourUnderExtracted(table: DynamicTable, labourSubTotal: number): boolean {
  if (!table.rows.length || labourSubTotal <= 0) return false;
  const rowSum = sumTableLastNumericColumn(table);
  if (rowSum <= 0) return true;
  return rowSum < labourSubTotal * 0.85;
}

/** Sort rows by first-column serial number when numeric. */
export function sortTableBySerial(table: DynamicTable): DynamicTable {
  if (table.rows.length <= 1) return table;
  const rows = [...table.rows].sort((a, b) => {
    const na = Number(String(a[0] ?? '').trim());
    const nb = Number(String(b[0] ?? '').trim());
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return 0;
  });
  return { ...table, rows };
}

export function findLabourChargesColumnIndex(columns: string[]): number {
  return columns.findIndex((c) => /labour\s*charges/i.test(c.trim()));
}

export function hasLabourChargesColumn(columns: string[]): boolean {
  return findLabourChargesColumnIndex(columns) >= 0;
}

/** Maruti/Kia-style: parts + labour share one header row (Labour Charges column present). */
export function isSharedHeaderLabour(partsColumns: string[]): boolean {
  return hasLabourChargesColumn(partsColumns);
}

/** split_independent labour section with its own headers (Labour Description, Labour Amt). */
export function isIndependentLabourColumns(columns: string[]): boolean {
  return columns.some((c) => /labour\s*(description|desc|amt|amount)/i.test(c.trim()));
}

/** Labour headers wrongly copied from parts vocabulary. */
export function hasPartsDerivedLabourHeaders(columns: string[]): boolean {
  if (isIndependentLabourColumns(columns)) return false;
  return columns.some((c) => /^part\s*(description|desc|amt|amount)/i.test(c.trim()));
}

/** Pick labour column headers: chunk labour headers beat parts-derived meta. */
export function resolveLabourColumns(
  meta: ColumnsOnlyTable,
  chunk: RowsChunkTable,
  partsMeta: ColumnsOnlyTable,
): string[] {
  const chunkCols = chunk.columns ?? [];
  if (isSharedHeaderLabour(partsMeta.columns)) {
    return meta.columns.length ? [...meta.columns] : [...partsMeta.columns];
  }
  if (isIndependentLabourColumns(chunkCols)) return [...chunkCols];
  if (isIndependentLabourColumns(meta.columns)) return [...meta.columns];
  if (hasPartsDerivedLabourHeaders(meta.columns) && isIndependentLabourColumns(chunkCols)) {
    return [...chunkCols];
  }
  if (chunkCols.length && chunkCols.length !== partsMeta.columns.length) return [...chunkCols];
  if (!meta.columns.length) return chunkCols.length ? [...chunkCols] : [];
  return [...meta.columns];
}

function renamePartsDerivedLabourHeader(col: string): string {
  const t = col.trim();
  if (/^part\s*description/i.test(t)) return 'Labour Description';
  if (/^part\s*(amt|amount)/i.test(t)) return 'Labour Amt';
  return col;
}

/** Rename Part Description/Amt → Labour Description/Amt when model copied parts headers. */
export function correctIndependentLabourHeaders(labour: DynamicTable): DynamicTable {
  if (!labour.rows.length || hasLabourChargesColumn(labour.columns)) return labour;
  if (isIndependentLabourColumns(labour.columns)) return labour;
  if (!hasPartsDerivedLabourHeaders(labour.columns)) return labour;
  return {
    ...labour,
    columns: labour.columns.map(renamePartsDerivedLabourHeader),
  };
}

function findColumnIndexByPattern(columns: string[], pattern: RegExp): number {
  return columns.findIndex((c) => pattern.test(c.trim()));
}

function alignCompressedLabourRow(partsColumns: string[], row: string[]): string[] {
  const width = partsColumns.length;
  const out = Array(width).fill('');
  const partNoIdx = findColumnIndexByPattern(partsColumns, /^part\s*number/i);
  const descIdx = findColumnIndexByPattern(partsColumns, /description/i);
  const hsnIdx = findColumnIndexByPattern(partsColumns, /hsn|sac/i);
  const labourIdx = findLabourChargesColumnIndex(partsColumns);

  out[0] = String(row[0] ?? '').trim();

  let partNo = '';
  let desc = '';
  let hsn = '';
  let labourCharge = '';
  let maxNumeric = -1;

  for (let i = 1; i < row.length; i++) {
    const cell = String(row[i] ?? '').trim();
    if (!cell || isPlaceholderCell(cell)) continue;

    if (/^\d{6}$/.test(cell)) {
      hsn = cell;
      continue;
    }

    const num = preprocessWorkshopNumber(cell);
    if (num != null && num > 0) {
      if (num > maxNumeric) {
        maxNumeric = num;
        labourCharge = cell;
      }
      continue;
    }

    if (/^[A-Z]{1,3}\d[\w-]*/i.test(cell) && !partNo) {
      partNo = cell;
      continue;
    }

    if (cell.length > desc.length) desc = cell;
  }

  if (partNoIdx >= 0 && partNo) out[partNoIdx] = partNo;
  if (descIdx >= 0 && desc) out[descIdx] = desc;
  if (hsnIdx >= 0 && hsn) out[hsnIdx] = hsn;
  if (labourIdx >= 0 && labourCharge) out[labourIdx] = labourCharge;

  return out;
}

/** Force labour rows onto parts' shared-header grid (Maruti dealer). */
export function alignLabourToSharedHeader(
  partsColumns: string[],
  labour: DynamicTable,
): DynamicTable {
  if (!isSharedHeaderLabour(partsColumns) || !labour.rows.length) return labour;

  const columns = [...partsColumns];
  const rows = labour.rows.map((row) => {
    if (row.length === partsColumns.length) return [...row];
    return alignCompressedLabourRow(partsColumns, row);
  });

  return { section: labour.section, columns, rows };
}

/** True when labour rows are expected but missing (triggers page-2 retry). */
export function isLabourExpected(
  labourRowCount: number,
  labourSubTotal: number,
  partsColumns: string[],
  labourMeta: ColumnsOnlyTable,
  partsRowCount: number,
): boolean {
  if (labourRowCount > 0) return false;
  if (labourSubTotal > 0) return true;
  if (labourMeta.section || labourMeta.columns.length > 0) return true;
  return hasLabourChargesColumn(partsColumns) && partsRowCount > 0;
}

/** Move rows with Labour Charges > 0 from parts to labour (Maruti dealer safety net). */
export function splitLabourChargesRows(
  parts: DynamicTable,
  labour: DynamicTable,
): { parts: DynamicTable; labour: DynamicTable } {
  if (labour.rows.length > 0) return { parts, labour };
  const idx = findLabourChargesColumnIndex(parts.columns);
  if (idx < 0 || !parts.rows.length) return { parts, labour };

  const partsRows: string[][] = [];
  const labourRows: string[][] = [];
  for (const row of parts.rows) {
    const charge = preprocessWorkshopNumber(row[idx]);
    if (charge != null && charge > 0) labourRows.push(row);
    else partsRows.push(row);
  }
  if (!labourRows.length) return { parts, labour };

  return {
    parts: { ...parts, rows: partsRows },
    labour: {
      section: labour.section ?? 'Labour',
      columns: [...parts.columns],
      rows: labourRows,
    },
  };
}

const PHANTOM_CODE_COL = /^part\s*no\.?$|^op\s*code$|^part\/op\s*code$/i;

function isPlaceholderCell(val: string): boolean {
  const v = val.trim().toUpperCase();
  return v === '' || v === 'N/A' || v === 'NA' || v === '-';
}

function dropColumnAt(columns: string[], rows: string[][], index: number): { columns: string[]; rows: string[][] } {
  const nextCols = columns.filter((_, i) => i !== index);
  const nextRows = rows.map((row) => row.filter((_, i) => i !== index));
  return { columns: nextCols, rows: nextRows };
}

function dropRowCellAt(rows: string[][], index: number): string[][] {
  return rows.map((row) => row.filter((_, i) => i !== index));
}

function findPhantomColumnIndices(columns: string[], rows: string[][]): number[] {
  const indices: number[] = [];
  const width = Math.max(columns.length, ...rows.map((r) => r.length));
  for (let i = 0; i < width; i++) {
    const header = (columns[i] ?? '').trim();
    const isCodeCol = PHANTOM_CODE_COL.test(header);
    const allPlaceholder = rows.length > 0 && rows.every((row) => isPlaceholderCell(row[i] ?? ''));
    if (isCodeCol && allPlaceholder) indices.push(i);
  }
  return indices;
}

/** Drop Part No / OP Code columns when every value is a placeholder (independent labour sections). */
export function finalizeLabourTable(
  table: DynamicTable,
  partsColumnCount?: number,
): DynamicTable {
  if (!table.rows.length) return table;

  let columns = [...table.columns];
  let rows = table.rows.map((row) => [...row]);

  let dropIndices = findPhantomColumnIndices(columns, rows);

  // Rows wider than headers: drop extra placeholder-only columns
  const rowWidth = rows[0]?.length ?? 0;
  if (rowWidth > columns.length) {
    for (let i = columns.length; i < rowWidth; i++) {
      if (rows.every((row) => isPlaceholderCell(row[i] ?? ''))) {
        dropIndices.push(i);
      }
    }
  }

  // Same width as parts but code column all N/A (Kumbhat)
  if (
    partsColumnCount
    && columns.length === partsColumnCount
    && dropIndices.length === 0
  ) {
    const codeIdx = columns.findIndex((c) => PHANTOM_CODE_COL.test(c.trim()));
    if (codeIdx >= 0 && rows.every((row) => isPlaceholderCell(row[codeIdx] ?? ''))) {
      dropIndices.push(codeIdx);
    }
  }

  // Dhoot: 6 labour headers, 7 row values (parts-shaped padding with N/A at Part No slot)
  if (
    partsColumnCount
    && rowWidth === columns.length + 1
    && rowWidth === partsColumnCount
    && isIndependentLabourColumns(columns)
    && !hasLabourChargesColumn(columns)
  ) {
    for (let i = 1; i < rowWidth; i++) {
      if (rows.every((row) => isPlaceholderCell(row[i] ?? ''))) {
        rows = dropRowCellAt(rows, i);
        break;
      }
    }
  }

  const uniqueDrops = [...new Set(dropIndices)].sort((a, b) => b - a);
  for (const idx of uniqueDrops) {
    ({ columns, rows } = dropColumnAt(columns, rows, idx));
  }

  return { section: table.section, columns, rows };
}

export const WORKSHOP_MULTIPASS_PAGE_THRESHOLD_DEFAULT = 15;
export const WORKSHOP_CHUNK_PAGE_SIZE = 3;

export { isGeminiTruncationError as isWorkshopTruncationError } from '../../../../utils/gemini-truncation.util.js';

// ponytail: self-check — run via `npx tsx aimodule/src/modules/document/schema/workshop/workshop-bill.shared.ts`
if (process.argv[1]?.replace(/\\/g, '/').endsWith('workshop-bill.shared.ts')) {
  const sample: DynamicTable = {
    columns: ['P/L', 'Code', 'Amt'],
    rows: [['P', 'PART1', '100'], ['L', 'LAB1', '200'], ['P', 'PART2', '50']],
  };
  const { parts, labour } = splitPlUnified(sample);
  console.assert(parts.rows.length === 2 && labour.rows.length === 1, 'splitPlUnified counts');
  console.assert(findPlColumnIndex(['P/L', 'X']) === 0, 'findPlColumnIndex');
  console.assert(!hasRowWidthMismatch({ columns: ['A'], rows: [['1']] }), 'no mismatch');
  console.assert(hasRowWidthMismatch({ columns: ['A', 'B'], rows: [['1']] }), 'mismatch detected');
  const kiaNorm = normalizeSplitColumns(
    { columns: ['A', 'B', 'C'] },
    { columns: [] },
    'split',
  );
  console.assert(kiaNorm.labour.columns.length === 3, 'normalizeSplitColumns inherits when labour empty');
  const independentNorm = normalizeSplitColumns(
    { columns: ['A', 'B', 'C', 'D', 'E'] },
    { section: 'Labour Detail', columns: [] },
    'split',
  );
  console.assert(
    independentNorm.labour.columns.length === 0,
    'normalizeSplitColumns skips inherit when labour.section set',
  );
  const marutiNorm = normalizeSplitColumns(
    { columns: ['A', 'B', 'C', 'D', 'E'] },
    { section: 'Labour Details', columns: ['Sr. No.', 'Labour Description', 'Total Amt.'] },
    'split',
  );
  console.assert(
    marutiNorm.labour.columns[1] === 'Labour Description',
    'normalizeSplitColumns keeps distinct labour headers without Labour Charges col',
  );
  const maruti11Cols = [
    'Srl.', 'Part Number', 'Description', 'Batch', 'HSN/SAC', 'Tax',
    'Qty.', 'Rate', 'Taxable Amount', 'Tax Paid Amount', 'Labour Charges',
  ];
  const marutiSharedNorm = normalizeSplitColumns(
    { columns: maruti11Cols },
    { section: 'Labour', columns: ['Srl.', 'Description', 'Labour Charges'] },
    'split',
  );
  console.assert(
    marutiSharedNorm.labour.columns.length === 11,
    'normalizeSplitColumns inherits shared-header labour columns',
  );
  const sharedPrefer = preferChunkLabourColumns(
    { section: 'Labour', columns: maruti11Cols },
    { columns: ['Srl.', 'Description', 'Labour Charges'], rows: [['1']] },
    { columns: maruti11Cols },
  );
  console.assert(sharedPrefer.columns.length === 11, 'preferChunkLabourColumns keeps shared header');
  const chunkLabour = preferChunkLabourColumns(
    { columns: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] },
    { columns: ['Seq.', 'Labour Description', 'Labour Amt', 'Qty', 'Tax', 'Total'], rows: [['1']] },
    { columns: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] },
  );
  console.assert(chunkLabour.columns.length === 6, 'preferChunkLabourColumns uses chunk when width differs');
  const stripped = finalizeLabourTable({
    columns: ['Seq.', 'Labour Description', 'OP Code', 'Labour Amt', 'Qty', 'Tax', 'Total'],
    rows: [['1', 'R&R', 'N/A', '452.0', '1.0', '81.36', '533.36']],
  }, 7);
  console.assert(
    stripped.columns.length === 6 && !stripped.columns.includes('OP Code'),
    'finalizeLabourTable strips phantom OP Code',
  );
  const kiaKept = finalizeLabourTable({
    columns: ['S.No', 'Part/OP code', 'Part Labor Description', 'Amt'],
    rows: [['1', 'A10VARDPAP2B', 'Painting', '1000']],
  }, 4);
  console.assert(kiaKept.columns.length === 4, 'finalizeLabourTable keeps real OP codes');
  const kumbhatRows: DynamicTable = {
    columns: ['Seq.', 'Labour Description', 'Labour Amt', 'Qty', 'Tax', 'Total'],
    rows: [
      ['1', 'A', '452.0', '1.0', '81.36', '533.36'],
      ['2', 'B', '508.5', '1.0', '91.53', '600.03'],
      ['3', 'C', '226.0', '1.0', '40.68', '266.68'],
      ['4', 'D', '452.0', '1.0', '81.36', '533.36'],
      ['5', 'E', '452.0', '1.0', '81.36', '533.36'],
      ['6', 'F', '452.0', '1.0', '81.36', '533.36'],
      ['7', 'G', '113.0', '1.0', '20.34', '133.34'],
      ['8', 'H', '904.0', '1.0', '162.72', '1066.72'],
      ['9', 'I', '904.0', '1.0', '162.72', '1066.72'],
    ],
  };
  console.assert(isLabourUnderExtracted(kumbhatRows, 72167.03), 'isLabourUnderExtracted');
  const marutiCols = ['Srl.', 'Part Number', 'Description', 'Taxable Amount', 'Labour Charges'];
  console.assert(
    isLabourExpected(0, 0, marutiCols, { columns: marutiCols }, 20),
    'isLabourExpected Maruti Labour Charges column',
  );
  const splitCharges = splitLabourChargesRows(
    {
      columns: marutiCols,
      rows: [
        ['1', 'P1', 'BOLT', '55.00', '0.00'],
        ['1', 'ZF9993', 'PAINTING CHARGES', '', '21135.00'],
      ],
    },
    { columns: [], rows: [] },
  );
  console.assert(
    splitCharges.parts.rows.length === 1 && splitCharges.labour.rows.length === 1,
    'splitLabourChargesRows',
  );
  const aligned = alignLabourToSharedHeader(maruti11Cols, {
    section: 'Labour',
    columns: ['Srl.', 'Description', 'Labour Charges'],
    rows: [['1', '-', 'PAINTING CHARGES', '998729', '21135.00']],
  });
  console.assert(aligned.columns.length === 11, 'alignLabourToSharedHeader columns');
  console.assert(
    aligned.rows[0][2] === 'PAINTING CHARGES' && aligned.rows[0][4] === '998729' && aligned.rows[0][10] === '21135.00',
    'alignLabourToSharedHeader remaps compressed row',
  );
  console.assert(!hasRowWidthMismatch(aligned), 'alignLabourToSharedHeader clears width mismatch');
  const dhootCorrected = correctIndependentLabourHeaders({
    columns: ['Seq.', 'Part Description', 'Part Amt', 'Qty', 'Tax', 'Total'],
    rows: [['1', 'Denting/Repairing Charges', '5,000.00', '1.00', '900.00', '5,900.00']],
  });
  console.assert(
    dhootCorrected.columns[1] === 'Labour Description' && dhootCorrected.columns[2] === 'Labour Amt',
    'correctIndependentLabourHeaders renames parts-derived headers',
  );
  const dhootResolve = resolveLabourColumns(
    { columns: ['Seq.', 'Part Description', 'Part Amt', 'Qty', 'Tax', 'Total'] },
    { columns: ['Seq.', 'Labour Description', 'Labour Amt', 'Qty', 'Tax', 'Total'], rows: [['1']] },
    { columns: ['Seq.', 'Part Description', 'Part No', 'Part Amt', 'Qty', 'Tax', 'Total'] },
  );
  console.assert(dhootResolve[1] === 'Labour Description', 'resolveLabourColumns prefers chunk labour headers');
  const dhootPhantom = finalizeLabourTable({
    columns: ['Seq.', 'Labour Description', 'Labour Amt', 'Qty', 'Tax', 'Total'],
    rows: [
      ['1', 'Denting/Repairing Charges', 'N/A', '5,000.00', '1.00', '900.00', '5,900.00'],
      ['2', 'Removal & refitment charges (bodyshop)', 'N/A', '7,000.00', '1.00', '1,260.00', '8,260.00'],
    ],
  }, 7);
  console.assert(
    dhootPhantom.rows[0][2] === '5,000.00' && !hasRowWidthMismatch(dhootPhantom),
    'finalizeLabourTable drops interior phantom Part No slot',
  );
  console.log('workshop-bill.shared self-check OK');
}
