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

export const ExtraColumnSchema = z.object({
  key: z.string(),
  value: z.union([z.string(), z.number(), z.null()]).nullable().optional(),
});

export const ExtraFieldSchema = z.object({
  key: z.string(),
  value: z.string().nullable(),
});

export const WorkshopPartsRowSchema = z.object({
  /** System row index 1..N for UI display — computed post-extraction, not from AI. */
  rowIndex: workshopNumeric.optional(),
  /** Sr.No as printed on the bill; null when the table has no serial column. */
  srNo: workshopNumeric.nullable().optional(),
  partNumber: z.string().nullable().optional(),
  hsnSac: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  uom: z.string().nullable().optional(),
  quantity: workshopNumeric.optional(),
  unitPrice: workshopNumeric.optional(),
  discount: workshopNumeric.optional(),
  taxableAmount: workshopNumeric.optional(),
  taxAmount: workshopNumeric.optional(),
  totalPrice: workshopNumeric.optional(),
  rowType: z.enum(['PART', 'COMBINED']).nullable().optional(),
  extraColumns: z.array(ExtraColumnSchema).nullish().default([]),
});

export const WorkshopLabourRowSchema = z.object({
  rowIndex: workshopNumeric.optional(),
  srNo: workshopNumeric.nullable().optional(),
  labourCode: z.string().nullable().optional(),
  hsnSac: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  quantityOrHours: workshopNumeric.optional(),
  rate: workshopNumeric.optional(),
  grossAmount: workshopNumeric.optional(),
  discount: workshopNumeric.optional(),
  taxableAmount: workshopNumeric.optional(),
  taxAmount: workshopNumeric.optional(),
  totalAmount: workshopNumeric.optional(),
  rowType: z.enum(['LABOUR', 'COMBINED']).nullable().optional(),
  extraColumns: z.array(ExtraColumnSchema).nullish().default([]),
});

export const WorkshopLineItemRowSchema = z.object({
  rowIndex: workshopNumeric.optional(),
  srNo: workshopNumeric.nullable().optional(),
  rowType: z.enum(['PART', 'LABOUR']),
  sectionHeader: z.string().nullable().optional(),
  itemCode: z.string().nullable().optional(),
  hsnSac: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  uom: z.string().nullable().optional(),
  quantity: workshopNumeric.optional(),
  rate: workshopNumeric.optional(),
  partsCost: workshopNumeric.nullable().optional(),
  labourCost: workshopNumeric.nullable().optional(),
  discount: workshopNumeric.optional(),
  taxableAmount: workshopNumeric.optional(),
  taxAmount: workshopNumeric.optional(),
  totalAmount: workshopNumeric.optional(),
  extraColumns: z.array(ExtraColumnSchema).nullish().default([]),
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

/** Default when WORKSHOP_MULTIPASS_PAGE_THRESHOLD env is unset (see config.ts). */
export const WORKSHOP_MULTIPASS_PAGE_THRESHOLD_DEFAULT = 15;

/** Page-chunk size when single-pass hits output truncation (fallback only). */
export const WORKSHOP_CHUNK_PAGE_SIZE = 3;

export { isGeminiTruncationError as isWorkshopTruncationError } from '../../../../utils/gemini-truncation.util.js';

// ---------------------------------------------------------------------------
// Short-key expansion — Gemini outputs compact keys (s, pn, h, d …) to save
// ~25% output tokens on dense bills; expand back before Zod validation.
// ---------------------------------------------------------------------------

function expandExtraColumn(c: unknown): { key: unknown; value: unknown } {
  const col = c as Record<string, unknown>;
  return { key: col.k ?? col.key, value: col.v ?? col.value };
}

function expandPartsRow(row: unknown): Record<string, unknown> {
  const r = row as Record<string, unknown>;
  return {
    srNo: r.s ?? r.srNo,
    partNumber: r.pn ?? r.partNumber,
    hsnSac: r.h ?? r.hsnSac,
    description: r.d ?? r.description,
    uom: r.u ?? r.uom,
    quantity: r.q ?? r.quantity,
    unitPrice: r.up ?? r.unitPrice,
    discount: r.dis ?? r.discount,
    taxableAmount: r.ta ?? r.taxableAmount,
    taxAmount: r.tx ?? r.taxAmount,
    totalPrice: r.tp ?? r.totalPrice,
    rowType: r.rt ?? r.rowType,
    extraColumns: Array.isArray(r.ec ?? r.extraColumns)
      ? ((r.ec ?? r.extraColumns) as unknown[]).map(expandExtraColumn)
      : [],
  };
}

function expandLabourRow(row: unknown): Record<string, unknown> {
  const r = row as Record<string, unknown>;
  return {
    srNo: r.s ?? r.srNo,
    labourCode: r.lc ?? r.labourCode,
    hsnSac: r.h ?? r.hsnSac,
    description: r.d ?? r.description,
    quantityOrHours: r.qh ?? r.quantityOrHours,
    rate: r.r ?? r.rate,
    grossAmount: r.ga ?? r.grossAmount,
    discount: r.dis ?? r.discount,
    taxableAmount: r.ta ?? r.taxableAmount,
    taxAmount: r.tx ?? r.taxAmount,
    totalAmount: r.tot ?? r.totalAmount,
    rowType: r.rt ?? r.rowType,
    extraColumns: Array.isArray(r.ec ?? r.extraColumns)
      ? ((r.ec ?? r.extraColumns) as unknown[]).map(expandExtraColumn)
      : [],
  };
}

/** Expand compact Gemini output keys back to full Zod field names before validation. */
export function expandWorkshopShortKeys(raw: Record<string, unknown>): Record<string, unknown> {
  const rawParts = Array.isArray(raw.partsTable) ? raw.partsTable : [];
  const rawLabour = Array.isArray(raw.labourTable) ? raw.labourTable : [];
  const { partsTable, labourTable } = reclassifyWorkshopShortKeyRows(rawParts, rawLabour);

  return {
    ...raw,
    partsTable: filterHsnSummaryRows(partsTable.map(expandPartsRow)),
    labourTable: filterHsnSummaryRows(labourTable.map(expandLabourRow)),
  };
}



function normalizeSac(v: unknown): string {
  return String(v ?? '').replace(/\s/g, '');
}

function itemCodeFromArrayRow(row: unknown[]): string {
  return String(row[1] ?? '').trim();
}

function sacFromArrayRow(row: unknown[]): string {
  return normalizeSac(row[2]);
}

function isLabourServiceSac(sac: string): boolean {
  return /^9987/i.test(sac);
}

function isPhysicalPartsHsn(hsn: string): boolean {
  return /^87/i.test(hsn);
}

/** Toyota/Maruti unified estimate labour operation codes (81561PRT, 53301EPR, 52119PNP). */
function isOemLabourOperationCode(code: string): boolean {
  const c = code.trim();
  if (!c) return false;
  // A-prefixed rows are physical parts on Toyota bills
  if (/^A-/i.test(c)) return false;
  return /(PRT|PNP|EBR|EPR|IBR)$/i.test(c);
}

/** Service-line descriptions (Kia/Hyundai R&R, body shop, etc.) — prompt-aligned, code-enforced. */
function looksLikeLabourDescription(desc: string): boolean {
  const d = desc.trim();
  if (!d) return false;
  return (
    /\b(R&R|R\s*&\s*R)\b/i.test(d) ||
    /\bDenting\b/i.test(d) ||
    /\bBody\s*(?:&|and)\s*Paint\b/i.test(d) ||
    /\bBody\s*Repair\b/i.test(d) ||
    /\bWelding\b/i.test(d) ||
    /\bTinkering\b/i.test(d) ||
    /\bTowing\b/i.test(d) ||
    /\bMiscellaneous\s+Activity\b/i.test(d) ||
    /\b(?:Labou?r|Service)\s+Charges?\b/i.test(d) ||
    /\bOpening\s*&\s*Fitting\b/i.test(d) ||
    /\bSpecial\s+Charge\b/i.test(d) ||
    /,\s*ONE\s+SIDE,\s*R&R\b/i.test(d)
  );
}

function looksLikeOemPartNumber(code: string): boolean {
  const c = code.trim();
  if (!c) return false;
  if (/^A-/i.test(c)) return true;
  if (looksLikeItemCode(c)) return true;
  const compact = c.replace(/[\s-]/g, '');
  return /^[A-Z0-9]{6,}$/i.test(compact) && /[A-Za-z]/.test(compact) && /\d/.test(compact);
}

function shouldBeLabourRow(code: string, sac: string, desc = ''): boolean {
  if (isLabourServiceSac(sac)) return true;
  if (isOemLabourOperationCode(code)) return true;
  if (looksLikeLabourDescription(desc) && !shouldBePartsRow(code, sac) && !looksLikeOemPartNumber(code)) {
    return true;
  }
  if (looksLikeLabourDescription(desc) && /\b(R&R|R\s*&\s*R)\b/i.test(desc) && !shouldBePartsRow(code, sac)) {
    return true;
  }
  return false;
}

function shouldBePartsRow(code: string, sac: string): boolean {
  if (isPhysicalPartsHsn(sac)) return true;
  if (/^A-/i.test(code.trim())) return true;
  return false;
}


function isLabourOnlyRow(row: unknown): boolean {
  const r = row as Record<string, unknown>;
  const qty     = r.q   ?? r.quantity;
  const price   = r.up  ?? r.unitPrice;
  const taxable = r.ta  ?? r.taxableAmount;
  const total   = r.tp  ?? r.totalPrice;
  const sac     = sacFromShortKeyRow(row);

  const hasNoQtyPrice =
    (qty     === null || qty     === undefined || qty     === 0 || qty     === '') &&
    (price   === null || price   === undefined || price   === 0 || price   === '');

  const hasTotal = total !== null && total !== undefined && total !== '' && Number(total) > 0;
  const hasTaxable = taxable !== null && taxable !== undefined && taxable !== '' && Number(taxable) > 0;

  // Flat labour line (BRAR/Maruti estimate): SAC 9987xx, no qty/rate, taxable or total only
  if (isLabourServiceSac(sac) && hasNoQtyPrice && (hasTotal || hasTaxable)) {
    return true;
  }

  const hasNoPartsFields =
    hasNoQtyPrice &&
    (taxable === null || taxable === undefined || taxable === 0 || taxable === '');

  return hasNoPartsFields && hasTotal;
}

/**
 * Parts-array row that is a flat labour line (SAC 9987xx, no qty/rate, taxable/total present).
 * BRAR/Mahindra quotations: "Labour :" section with one row, no hours/rate columns.
 */
function isFlatLabourPartsArrayRow(fixed: unknown[]): boolean {
  const sac = sacFromArrayRow(fixed);
  if (!isLabourServiceSac(sac)) return false;

  const qty = fixed[5];
  const unitPrice = fixed[6];
  const hasNoQtyPrice =
    (qty === null || qty === undefined || qty === '' || Number(qty) === 0) &&
    (unitPrice === null || unitPrice === undefined || unitPrice === '' || Number(unitPrice) === 0);

  const taxable = fixed[8];
  const total = fixed[10];
  const hasAmount =
    (taxable !== null && taxable !== undefined && taxable !== '' && Number(taxable) > 0) ||
    (total !== null && total !== undefined && total !== '' && Number(total) > 0);

  if (!hasNoQtyPrice || !hasAmount) return false;

  const desc = String(fixed[3] ?? '').trim();
  const code = itemCodeFromArrayRow(fixed);
  const isHsnLen = (s: string) => /^\d{6}$/.test(s) || /^\d{8}$/.test(s);
  if (desc.length > 2 && !isHsnLen(desc.replace(/\s/g, ''))) return true;
  if (code && !isHsnLen(code.replace(/\s/g, ''))) return true;
  return false;
}

function codeFromShortKeyRow(row: unknown): string {
  const r = row as Record<string, unknown>;
  return String(r.pn ?? r.partNumber ?? r.lc ?? r.labourCode ?? '').trim();
}

function sacFromShortKeyRow(row: unknown): string {
  const r = row as Record<string, unknown>;
  return normalizeSac(r.h ?? r.hsnSac);
}

function reclassifyWorkshopShortKeyRows(
  rawParts: unknown[],
  rawLabour: unknown[],
): { partsTable: unknown[]; labourTable: unknown[] } {
  const partsTable: unknown[] = [];
  const labourTable: unknown[] = [];

  for (const row of rawLabour) {
    const code = codeFromShortKeyRow(row);
    const sac = sacFromShortKeyRow(row);
    if (shouldBePartsRow(code, sac) && !shouldBeLabourRow(code, sac)) {
      partsTable.push(row);
    } else {
      labourTable.push(row);
    }
  }

  for (const row of rawParts) {
    const r = row as Record<string, unknown>;
    const code = codeFromShortKeyRow(row);
    const sac = sacFromShortKeyRow(row);
    const desc = String(r.d ?? r.description ?? '').trim();
    // Shared-column layout: labour row that landed in partsTable because it
    // has a code in the "Part Number" column but no parts-specific amounts.
    if (isLabourOnlyRow(row)) {
      labourTable.push(row);
    } else if (shouldBeLabourRow(code, sac, desc)) {
      labourTable.push(row);
    } else {
      partsTable.push(row);
    }
  }

  return { partsTable, labourTable };
}

// ---------------------------------------------------------------------------
// Array-of-arrays expansion — converts positional string arrays back to the
// full-field-name objects expected by Zod (same schema, no code change needed
// downstream).
//
// Parts row [16 positions]: s, pn, h, d, u, q, up, dis, ta, tx, tp, rt,
//                           bt(BillTo), sh(Share%), sgst%, cgst%
// Labour row [12 positions]: s, lc, h, d, qh, r, ga, dis, ta, tx, tot, rt
// ---------------------------------------------------------------------------

const PARTS_ARRAY_KEYS = [
  'srNo', 'partNumber', 'hsnSac', 'description', 'uom', 'quantity',
  'unitPrice', 'discount', 'taxableAmount', 'taxAmount', 'totalPrice', 'rowType',
] as const;

const PARTS_NUMERIC_IDX = new Set([0, 5, 6, 7, 8, 9, 10]);
const PARTS_EXTRA_LABELS = ['Bill To', 'Share%', 'SGST%', 'CGST%'];

const LABOUR_ARRAY_KEYS = [
  'srNo', 'labourCode', 'hsnSac', 'description', 'quantityOrHours', 'rate',
  'grossAmount', 'discount', 'taxableAmount', 'taxAmount', 'totalAmount', 'rowType',
] as const;

const LABOUR_NUMERIC_IDX = new Set([0, 4, 5, 6, 7, 8, 9, 10]);

function coerceVal(v: unknown, isNumeric: boolean): unknown {
  if (v === undefined || v === null || v === '' || v === 'null') return null;
  if (isNumeric) return preprocessWorkshopNumber(v);
  return String(v);
}

/** Part/labour code at col[1] — alphanumeric OEM IDs (IA*, MF*, ID*), not bare HSN digits. */
function looksLikeItemCode(v: unknown): boolean {
  const s = String(v ?? '').trim();
  if (!s) return false;
  if (/[A-Za-z]/.test(s)) return true;
  // Pure-numeric string: must be a real part code, not an HSN code.

  const digits = s.replace(/\s/g, '');
  if (/^\d{6}$/.test(digits) || /^\d{8}$/.test(digits)) return false;
  // Very long numeric part codes (10+ digits) are valid item codes.
  return /^\d{10,}$/.test(digits);
}

/**
 * Eicher bills use a very narrow Sr.No column — 3-digit numbers (100+) wrap in one cell
 * (e.g. "12" + "6" = 126). Flash-lite may emit them as two array positions, shifting all
 * columns left. Merge when col[0]+col[1] forms 100–999 and col[2] is the real item code.
 */
function fixWrappedSrNoArrayRow(arr: unknown[]): unknown[] {
  if (arr.length < 3) return arr;

  const srNo = String(arr[0] ?? '').trim();
  const next = String(arr[1] ?? '').trim();
  if (!/^\d{1,2}$/.test(srNo) || !/^\d{1}$/.test(next)) return arr;

  const combined = parseInt(`${srNo}${next}`, 10);
  if (combined < 100 || combined > 999) return arr;
  if (!looksLikeItemCode(arr[2])) return arr;

  // EC-2: Upcountry/Volvo — PC column or VO part code means this is not Eicher wrap.
  if (next === '10') return arr;
  const thirdCol = String(arr[2] ?? '').trim();
  if (/^VO\s/i.test(thirdCol)) return arr;

  return [String(combined), ...arr.slice(2)];
}

/**
 * EC-2: Upcountry/Volvo bills print a "PC" column (always "10") between Sr.No
 * and Part No. Strip it when the next column is a real item code.
 */
function stripPcColumn(arr: unknown[]): unknown[] {
  if (arr.length < 3) return arr;
  if (String(arr[1] ?? '').trim() !== '10') return arr;
  const thirdCol = String(arr[2] ?? '').trim();
  if (/^VO\s/i.test(thirdCol) || looksLikeItemCode(arr[2])) {
    return [arr[0], ...arr.slice(2)];
  }
  return arr;
}

/** HSN-wise tax summary rows leaked into parts/labour (EC-3). */
function isHsnSummaryRow(row: Record<string, unknown>): boolean {
  const code = String(row.partNumber ?? row.labourCode ?? '').trim();
  const hsn = String(row.hsnSac ?? '').trim();
  const desc = String(row.description ?? '').trim();
  const digits = (s: string) => s.replace(/\s/g, '');
  const isHsnLen = (s: string) => /^\d{6}$/.test(s) || /^\d{8}$/.test(s);

  const qty = row.quantity ?? row.quantityOrHours;
  const price = row.unitPrice ?? row.rate;
  const noQty = qty === null || qty === undefined || qty === '' || Number(qty) === 0;
  const noPrice = price === null || price === undefined || price === '' || Number(price) === 0;
  if (!noQty || !noPrice) return false;

  const normCode = normalizeSac(code);
  const normHsn = normalizeSac(hsn);
  const effectiveHsn = isHsnLen(normHsn) ? normHsn : (isHsnLen(normCode) ? normCode : '');
  if (!effectiveHsn) return false;

  const descEmptyOrHsn =
    !desc ||
    desc === hsn ||
    desc === code ||
    isHsnLen(digits(desc));

  // Pattern A: code and hsnSac both set, equal, no line-item description
  if (isHsnLen(normCode) && normCode === normHsn && descEmptyOrHsn) {
    return true;
  }

  // Pattern B: hsnSac only — no real part/labour code
  if (!code && descEmptyOrHsn) {
    return true;
  }

  // Pattern C: HSN misplaced in partNumber/labourCode, hsnSac blank (Volvo pages 10–11)
  if (
    isHsnLen(normCode) &&
    !looksLikeItemCode(code) &&
    (!hsn || normCode === normHsn) &&
    descEmptyOrHsn
  ) {
    return true;
  }

  // Pattern D: SAC aggregation row — labourCode IS the SAC (998714) with no task description
  // Real labour lines have a distinct operation code (81801-2) or a description; not code === sac only.
  if (
    isLabourServiceSac(normHsn || normCode) &&
    normCode === normHsn &&
    normCode !== '' &&
    descEmptyOrHsn
  ) {
    return true;
  }

  return false;
}

/** Drop HSN summary rows before cross-table rescue (array format). */
function isHsnSummaryArrayRow(fixed: unknown[], forLabour: boolean): boolean {
  const code = itemCodeFromArrayRow(fixed);
  const sac = sacFromArrayRow(fixed);
  const desc = String(fixed[3] ?? '').trim();
  const qty = forLabour ? fixed[4] : fixed[5];
  const price = forLabour ? fixed[5] : fixed[6];
  return isHsnSummaryRow({
    partNumber: code,
    labourCode: code,
    hsnSac: sac || (isHsnLenDigits(code) ? code : null),
    description: desc || null,
    quantity: qty,
    unitPrice: price,
    quantityOrHours: qty,
    rate: price,
  });
}

function isHsnLenDigits(s: string): boolean {
  const d = s.replace(/\s/g, '');
  return /^\d{6}$/.test(d) || /^\d{8}$/.test(d);
}

function filterHsnSummaryRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.filter((row) => !isHsnSummaryRow(row));
}


function rescuePartCodeColumn(arr: unknown[]): unknown[] {
  if (arr.length < 4) return arr;
  const col1 = String(arr[1] ?? '').trim();
  if (col1) return arr;

  const col3 = String(arr[3] ?? '').trim();
  const merged = col3.match(/^([A-Z][A-Z0-9]{2,20})\s+(.+)$/);
  if (merged && !/^\d{6,8}$/.test(merged[1].replace(/\s/g, ''))) {
    return [arr[0], merged[1], arr[2], merged[2], ...arr.slice(4)];
  }
  return arr;
}


const KNOWN_ROW_TYPES = new Set(['PART', 'COMBINED', 'LABOUR']);

function fixMissingUomArrayRow(arr: unknown[]): unknown[] {
  if (arr.length < 11) return arr;
  const pos4 = String(arr[4] ?? '').trim();
  const pos10 = String(arr[10] ?? '').trim();
  const pos4IsNumeric = pos4 !== '' && /^\d+(\.\d+)?$/.test(pos4);
  const pos10IsRowType = KNOWN_ROW_TYPES.has(pos10);
  if (pos4IsNumeric && pos10IsRowType) {
    // Insert empty string at position 4 (UOM) to restore correct alignment.
    return [...arr.slice(0, 4), '', ...arr.slice(4)];
  }
  return arr;
}

function expandPartsArrayRow(arr: unknown[]): Record<string, unknown> {
  const afterPc = stripPcColumn(arr);
  const afterCode = rescuePartCodeColumn(afterPc);
  const afterSrFix = fixWrappedSrNoArrayRow(afterCode);
  const fixed = fixMissingUomArrayRow(afterSrFix);
  const row: Record<string, unknown> = {};
  PARTS_ARRAY_KEYS.forEach((k, i) => {
    row[k] = coerceVal(fixed[i], PARTS_NUMERIC_IDX.has(i));
  });
  // Sanitize rowType — partsTable only accepts PART or COMBINED.

  const rt = row.rowType as string | null | undefined;
  if (rt && rt !== 'PART' && rt !== 'COMBINED') {
    row.rowType = null;
  }
  const extras: { key: string; value: string | null }[] = [];
  for (let i = 12; i < Math.min(fixed.length, 16); i++) {
    const v = fixed[i];
    if (v !== undefined && v !== null && v !== '' && v !== 'null') {
      extras.push({ key: PARTS_EXTRA_LABELS[i - 12], value: String(v) });
    }
  }
  row.extraColumns = extras;
  return row;
}


function remapPartsArrayRowToLabourArray(fixed: unknown[]): unknown[] {
  const col4 = String(fixed[4] ?? '').trim();
  const col4IsQty = col4 !== '' && /^\d+(\.\d+)?$/.test(col4);

  if (col4IsQty) {
    return [
      fixed[0], fixed[1], fixed[2], fixed[3],
      fixed[4], fixed[5], fixed[6] ?? '',
      fixed[7], fixed[8], fixed[9], fixed[10], fixed[11] ?? '',
    ];
  }

  return [
    fixed[0], fixed[1], fixed[2], fixed[3],
    fixed[5], fixed[6], '',
    fixed[7], fixed[8], fixed[9], fixed[10], fixed[11] ?? '',
  ];
}

function expandLabourArrayRow(arr: unknown[]): Record<string, unknown> {
  const afterPc = stripPcColumn(arr);
  const afterCode = rescuePartCodeColumn(afterPc);
  const fixed = fixWrappedSrNoArrayRow(afterCode);
  const row: Record<string, unknown> = {};
  LABOUR_ARRAY_KEYS.forEach((k, i) => {
    row[k] = coerceVal(fixed[i], LABOUR_NUMERIC_IDX.has(i));
  });
  // Sanitize rowType — labourTable only accepts LABOUR or COMBINED.
  const rt = row.rowType as string | null | undefined;
  if (rt && rt !== 'LABOUR' && rt !== 'COMBINED') {
    row.rowType = null;
  }
  row.extraColumns = [];
  return row;
}


export function expandWorkshopArrayRows(raw: Record<string, unknown>): Record<string, unknown> {
  const rawParts = Array.isArray(raw.partsTable) ? (raw.partsTable as unknown[][]) : [];
  const rawLabour = Array.isArray(raw.labourTable) ? (raw.labourTable as unknown[][]) : [];

  const rescuedFromLabour: unknown[][] = [];
  const trueLabour: unknown[][] = [];

  for (const row of rawLabour) {
    const stripped = stripPcColumn(row);
    const withCode = rescuePartCodeColumn(stripped);
    const fixed = fixWrappedSrNoArrayRow(withCode);
    if (isHsnSummaryArrayRow(fixed, true)) continue;
    const code = itemCodeFromArrayRow(fixed);
    const sac = sacFromArrayRow(fixed);
    const rowType = String(fixed[11] ?? '').toUpperCase().trim();
    // HSN 87xx / A-xxx parts misclassified into labourTable, or AI explicitly tagged PART
    if ((shouldBePartsRow(code, sac) && !shouldBeLabourRow(code, sac)) || rowType === 'PART') {
      rescuedFromLabour.push(fixed);
    } else {
      trueLabour.push(fixed);
    }
  }

  const rescuedFromParts: unknown[][] = [];
  const trueParts: unknown[][] = [];

  for (const row of rawParts) {
    const stripped = stripPcColumn(row);
    const withCode = rescuePartCodeColumn(stripped);
    const fixed = fixWrappedSrNoArrayRow(withCode);
    if (isHsnSummaryArrayRow(fixed, false)) continue;
    const code = itemCodeFromArrayRow(fixed);
    const sac = sacFromArrayRow(fixed);
    const desc = String(fixed[3] ?? '').trim();
    const rowType = String(fixed[11] ?? '').toUpperCase().trim();

    const qty      = fixed[5];
    const unitPrice = fixed[6];
    const taxable  = fixed[8];
    const total    = fixed[10];

    const noPartsFields =
      (qty      === null || qty      === undefined || qty      === '' || Number(qty)      === 0) &&
      (unitPrice === null || unitPrice === undefined || unitPrice === '' || Number(unitPrice) === 0) &&
      (taxable   === null || taxable   === undefined || taxable   === '' || Number(taxable)  === 0);
    const hasTotal = total !== null && total !== undefined && total !== '' && Number(total) > 0;

    if (
      (noPartsFields && hasTotal) ||
      shouldBeLabourRow(code, sac, desc) ||
      rowType === 'LABOUR' ||
      isFlatLabourPartsArrayRow(fixed)
    ) {
      // Rescue: labour-only row, SAC 9987xx/OEM code, description-based (Kia R&R), or rt=LABOUR
      rescuedFromParts.push(remapPartsArrayRowToLabourArray(fixed));
    } else {
      trueParts.push(fixed);
    }
  }

  const finalParts = filterHsnSummaryRows([...trueParts, ...rescuedFromLabour].map(expandPartsArrayRow));
  const finalLabour = filterHsnSummaryRows([...trueLabour, ...rescuedFromParts].map(expandLabourArrayRow));

  return {
    ...raw,
    partsTable: finalParts,
    labourTable: finalLabour,
  };
}


export function isArrayRowFormat(raw: Record<string, unknown>): boolean {
  if (Array.isArray(raw.lineItemsTable) && raw.lineItemsTable.length > 0) {
    return Array.isArray((raw.lineItemsTable as unknown[])[0]);
  }
  if (Array.isArray(raw.partsTable) && raw.partsTable.length > 0) {
    return Array.isArray((raw.partsTable as unknown[])[0]);
  }
  if (Array.isArray(raw.labourTable) && raw.labourTable.length > 0) {
    return Array.isArray((raw.labourTable as unknown[])[0]);
  }
  return false;
}

export function isLineItemsArrayFormat(raw: Record<string, unknown>): boolean {
  return Array.isArray(raw.lineItemsTable) && raw.lineItemsTable.length > 0
    && Array.isArray((raw.lineItemsTable as unknown[])[0]);
}

// ---------------------------------------------------------------------------
// Sequential line-items array — preserves PDF document order (Honda P/L etc.)
// [0:s, 1:pl(PART|LABOUR), 2:code, 3:hsn, 4:desc, 5:uom, 6:qty, 7:rate,
//  8:dis, 9:ta, 10:tx, 11:total, 12:sectionHeader,
//  13+: extra column pairs — header, value, header, value, … (max 8 pairs)]
// ---------------------------------------------------------------------------

const LINE_ITEMS_ARRAY_KEYS = [
  'srNo', 'rowType', 'itemCode', 'hsnSac', 'description', 'uom', 'quantity', 'rate',
  'discount', 'taxableAmount', 'taxAmount', 'totalAmount', 'sectionHeader',
] as const;

const LINE_ITEMS_NUMERIC_IDX = new Set([0, 6, 7, 8, 9, 10, 11]);
const LINE_ITEMS_EXTRA_START = 13;
const LINE_ITEMS_MAX_EXTRA_PAIRS = 8;

function parseLineItemExtraColumnPairs(fixed: unknown[]): { key: string; value: string | null }[] {
  const extras: { key: string; value: string | null }[] = [];
  const maxIdx = Math.min(
    fixed.length,
    LINE_ITEMS_EXTRA_START + LINE_ITEMS_MAX_EXTRA_PAIRS * 2,
  );
  for (let i = LINE_ITEMS_EXTRA_START; i + 1 < maxIdx; i += 2) {
    const key = String(fixed[i] ?? '').trim();
    if (!key) break;
    const raw = fixed[i + 1];
    if (raw === undefined || raw === null || raw === '' || raw === 'null') {
      extras.push({ key, value: null });
    } else {
      extras.push({ key, value: String(raw) });
    }
  }
  return extras;
}

function normalizeRowTypeFromPl(v: unknown): 'PART' | 'LABOUR' {
  const s = String(v ?? '').trim().toUpperCase();
  if (s === 'L' || s === 'LABOUR' || s === 'LABOR') return 'LABOUR';
  return 'PART';
}

function expandLineItemArrayRow(arr: unknown[]): Record<string, unknown> {
  const afterPc = stripPcColumn(arr);
  const afterCode = rescuePartCodeColumn(afterPc);
  const afterSrFix = fixWrappedSrNoArrayRow(afterCode);
  const fixed = fixMissingUomArrayRow(afterSrFix);
  const row: Record<string, unknown> = {};
  LINE_ITEMS_ARRAY_KEYS.forEach((k, i) => {
    if (k === 'rowType') {
      row[k] = normalizeRowTypeFromPl(fixed[i]);
      return;
    }
    row[k] = coerceVal(fixed[i], LINE_ITEMS_NUMERIC_IDX.has(i));
  });
  const rt = row.rowType as 'PART' | 'LABOUR';
  const total = row.totalAmount as number | null;
  row.partsCost = rt === 'PART' ? total : null;
  row.labourCost = rt === 'LABOUR' ? total : null;
  row.extraColumns = parseLineItemExtraColumnPairs(fixed);
  return row;
}

export function expandLineItemsArrayRows(raw: Record<string, unknown>): Record<string, unknown> {
  const rawItems = Array.isArray(raw.lineItemsTable) ? raw.lineItemsTable : [];
  let lineItemsTable: Record<string, unknown>[];

  if (rawItems.length > 0 && Array.isArray(rawItems[0])) {
    lineItemsTable = (rawItems as unknown[][])
      .map((row) => expandLineItemArrayRow(row))
      .filter((row) => {
        const desc = String(row.description ?? '').trim();
        const code = String(row.itemCode ?? '').trim();
        const total = Number(row.totalAmount ?? 0);
        return (desc.length > 0 || code.length > 0) && (total > 0 || Number(row.taxableAmount ?? 0) > 0);
      });
  } else {
    lineItemsTable = rawItems as Record<string, unknown>[];
  }

  return {
    ...raw,
    tableLayout: 'sequential',
    lineItemsTable,
  };
}

export function deriveSplitTablesFromLineItems(
  lineItems: Record<string, unknown>[],
): { partsTable: Record<string, unknown>[]; labourTable: Record<string, unknown>[] } {
  const partsTable: Record<string, unknown>[] = [];
  const labourTable: Record<string, unknown>[] = [];

  for (const item of lineItems) {
    const rt = item.rowType as string;
    if (rt === 'LABOUR') {
      labourTable.push({
        srNo: item.srNo,
        labourCode: item.itemCode,
        hsnSac: item.hsnSac,
        description: item.description,
        quantityOrHours: item.quantity,
        rate: item.rate,
        grossAmount: item.taxableAmount,
        discount: item.discount,
        taxableAmount: item.taxableAmount,
        taxAmount: item.taxAmount,
        totalAmount: item.totalAmount,
        rowType: 'LABOUR',
        extraColumns: item.extraColumns ?? [],
      });
    } else {
      partsTable.push({
        srNo: item.srNo,
        partNumber: item.itemCode,
        hsnSac: item.hsnSac,
        description: item.description,
        uom: item.uom,
        quantity: item.quantity,
        unitPrice: item.rate,
        discount: item.discount,
        taxableAmount: item.taxableAmount,
        taxAmount: item.taxAmount,
        totalPrice: item.totalAmount,
        rowType: 'PART',
        extraColumns: item.extraColumns ?? [],
      });
    }
  }

  return { partsTable, labourTable };
}
