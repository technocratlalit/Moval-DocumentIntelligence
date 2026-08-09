import fs from 'fs';
import os from 'os';
import path from 'path';
import axios from 'axios';
import LlamaCloud from '@llamaindex/llama-cloud';
import { _config } from '../../../config/config.js';
import { ApiError } from '../../../shared/errors/apiError.js';
import {
  emptyDynamicTable,
  parseDynamicTable,
  type DynamicTable,
} from '../schema/workshop/workshop-bill.shared.js';
import { llamaWorkshopJsonSchema } from '../schema/workshop/workshop-bill.llamaparse.schema.js';

const POLL_TIMEOUT_MS = 10 * 60 * 1000;
const EXTRACT_TIER = 'agentic_plus' as const;
const TOTAL_TOLERANCE = 1.5; // rupees — rounding / missing rows

const REG_NO_RE =
  /\b(?:Reg\.?\s*No\.?|Regn\.?|Registration|Veh\.?\s*Reg\.?\s*No\.?)\s*[:.]?\s*([A-Z]{2}[-\s]?\d{1,2}[-\s]?[A-Z]{0,3}[-\s]?\d{1,4})\b/i;

const TOTALS_ROW_RE =
  /^(grand\s*)?total|net\s*amount|amount\s*in\s*words|total\s*amount|total\s*tax|taxable\s*amt/i;

const NOTE_RE = /\b(not\s+included|excluded|after\s+dismantle|to\s+be\s+shared\s+later)\b/i;

const NON_BILLING_RE =
  /terms\s*&?\s*conditions|customer\s*signature|authorized\s*signat|gate\s*pass|feedback\s*form|delivery\s*policy|parking\s*charge/i;

type ExtractConfigurationDataSchema = {
  [key: string]: { [key: string]: unknown } | Array<unknown> | string | number | boolean | null;
};

type SectionKind = 'PART' | 'LABOUR' | 'MISC' | 'UNDEFINED';

export type RepairGroup = {
  id: string;
  title: string;
  members: Array<{ bucket: 'parts' | 'labour'; index: number }>;
};

export type RepairEstimate = {
  partNo: string | null;
  description: string | null;
  demandType: string | null;
  components: { rr: number | null; denting: number | null; painting: number | null };
  total: number | null;
  row: string[];
};

async function downloadPdfToTemp(url: string): Promise<string> {
  const timeoutMs = _config.PDF_DOWNLOAD_TIMEOUT_MS ?? 90_000;
  const response = await axios.get(url, {
    responseType: 'stream',
    maxContentLength: 50 * 1024 * 1024,
    timeout: timeoutMs,
  });

  const contentType = String(response.headers['content-type'] ?? '').toLowerCase();
  if (contentType && !contentType.includes('pdf') && !contentType.includes('octet-stream')) {
    throw ApiError.badRequest(`Expected a PDF URL, got content-type: ${contentType}`);
  }

  const tmpPath = path.join(
    os.tmpdir(),
    `llama-workshop-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`,
  );
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(tmpPath);
    response.data.pipe(out);
    out.on('finish', () => resolve());
    out.on('error', reject);
    response.data.on('error', reject);
  });
  return tmpPath;
}

function cleanCell(v: unknown): string {
  return String(v ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\\&/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function asNullableString(v: unknown): string | null {
  if (v == null) return null;
  const s = cleanCell(v);
  return s === '' ? null : s;
}

function asNullableNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[^0-9.-]+/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function normalizeHsn(raw: string): string {
  return String(raw ?? '').replace(/[^\d]/g, '');
}

function isServiceHsn(hsn: string): boolean {
  return hsn.startsWith('9987');
}

function findColumnIndex(columns: string[], ...needles: string[]): number {
  const lower = columns.map((c) => c.toLowerCase());
  for (const needle of needles) {
    const n = needle.toLowerCase();
    const i = lower.findIndex((c) => c.includes(n));
    if (i >= 0) return i;
  }
  return -1;
}

function findExplicitPlColumnIndex(columns: string[]): number {
  for (let i = 0; i < columns.length; i++) {
    const norm = columns[i].replace(/\s+/g, '').toUpperCase();
    if (norm === 'P/L' || norm === 'P-L' || norm === 'PL' || norm === 'P|L') return i;
  }
  return -1;
}

function findTypeColumnIndex(columns: string[]): number {
  return columns.findIndex((c) => /^type$/i.test(c.trim()));
}

function cellLooksNumeric(s: string): boolean {
  if (!s) return false;
  return /[\d]/.test(s.replace(/[,.\s%-]/g, ''));
}

function rowBannerText(row: string[]): string {
  return row.filter((c) => c.trim()).join(' ').trim();
}

function normalizeTable(raw: unknown): DynamicTable {
  const table = parseDynamicTable(raw);
  const hsnIdx = findColumnIndex(table.columns, 'hsn/sac', 'hsn', 'sac');
  return {
    ...table,
    columns: table.columns.map(cleanCell),
    rows: table.rows.map((row) =>
      row.map((cell, i) => {
        const cleaned = cleanCell(cell);
        if (i === hsnIdx && cleaned) {
          const digits = normalizeHsn(cleaned);
          return digits || cleaned;
        }
        return cleaned;
      }),
    ),
  };
}

function detectSection(text: string): SectionKind | null {
  const t = text
    .replace(/[:.\-–—]+$/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!t) return null;
  if (/^undefined\s+parts?$/.test(t)) return 'UNDEFINED';
  if (/^miscellaneous$|^misc\.?$/.test(t)) return 'MISC';
  if (
    /^(spare\s+)?parts?(\s+(details?|charges?|invoice|bill))?$/.test(t) ||
    /^part\s+(details?|charges?|invoice)$/.test(t)
  ) {
    return 'PART';
  }
  if (
    /^(labour|labor)(\s+(details?|charges?|invoice))?$/.test(t) ||
    /^(labour|labor)\s+and\s+services$/.test(t)
  ) {
    return 'LABOUR';
  }
  return null;
}

function isRepairGroupBanner(row: string[], hsnIdx: number, plIdx: number, amountIdxs: number[]): boolean {
  const joined = rowBannerText(row);
  if (!joined) return false;
  if (/\(body\s*&\s*paint/i.test(joined)) return true;

  const marker = plIdx >= 0 ? (row[plIdx] ?? '').trim().toUpperCase() : '';
  if (marker === 'P' || marker === 'L') return false;
  const hsn = hsnIdx >= 0 ? normalizeHsn(row[hsnIdx] ?? '') : '';
  if (hsn.length >= 4) return false;
  if (amountIdxs.some((i) => cellLooksNumeric(row[i] ?? ''))) return false;

  const nonEmpty = row.filter((c) => c.trim());
  if (nonEmpty.length === 1 && nonEmpty[0].length >= 4 && !/^\d+$/.test(nonEmpty[0])) {
    if (/change|repair|paint|fitting|opening|dent|bumper|fender|hood|door/i.test(nonEmpty[0])) {
      return true;
    }
  }
  return false;
}

function isTotalsOrJunkRow(row: string[]): boolean {
  const joined = rowBannerText(row);
  if (!joined) return true;
  if (TOTALS_ROW_RE.test(joined)) return true;
  if (NON_BILLING_RE.test(joined)) return true;
  return false;
}

function extractRegNoFromRows(rows: string[][]): string | null {
  for (const row of rows) {
    for (const cell of row) {
      const m = cell.match(REG_NO_RE);
      if (m?.[1]) return cleanCell(m[1].replace(/\s+/g, '').toUpperCase());
    }
  }
  return null;
}

function isVehicleInfoRow(row: string[]): boolean {
  const nonEmpty = row.filter((c) => c.trim());
  return nonEmpty.length <= 2 && nonEmpty.some((c) => REG_NO_RE.test(c));
}

function hasLineItemText(row: string[], codeIdx: number, descIdx: number): boolean {
  const code = codeIdx >= 0 ? (row[codeIdx] ?? '').trim() : '';
  const desc = descIdx >= 0 ? (row[descIdx] ?? '').trim() : '';
  if (code || desc) return true;
  return row.some((c) => c.trim());
}

function isContinuationRow(
  row: string[],
  hsnIdx: number,
  amountIdxs: number[],
  codeIdx: number,
  descIdx: number,
): boolean {
  const hsn = hsnIdx >= 0 ? normalizeHsn(row[hsnIdx] ?? '') : '';
  if (hsn.length >= 4) return false;
  if (amountIdxs.some((i) => cellLooksNumeric(row[i] ?? ''))) return false;
  return hasLineItemText(row, codeIdx, descIdx);
}

function typeColumnIsLabour(value: string): boolean | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  if (/^l(abou?r)?$/.test(v) || v === 'service' || v === 'labour' || v === 'labor') return true;
  if (/^p(art)?s?$/.test(v) || v === 'part' || v === 'parts') return false;
  return null;
}

function hasPricedOrMarkedLine(
  row: string[],
  hsnIdx: number,
  plIdx: number,
  amountIdxs: number[],
): boolean {
  const marker = plIdx >= 0 ? (row[plIdx] ?? '').trim().toUpperCase() : '';
  if (marker === 'P' || marker === 'L') return true;
  const hsn = hsnIdx >= 0 ? normalizeHsn(row[hsnIdx] ?? '') : '';
  if (hsn.length >= 4) return true;
  return amountIdxs.some((i) => cellLooksNumeric(row[i] ?? ''));
}

function amountColumnIndexes(columns: string[]): number[] {
  return [
    findColumnIndex(columns, 'taxable'),
    findColumnIndex(columns, 'unit price'),
    findColumnIndex(columns, 'unit rate'),
    findColumnIndex(columns, 'labour/part price'),
    findColumnIndex(columns, 'total amt'),
    findColumnIndex(columns, 'total amount'),
    findColumnIndex(columns, 'net amt'),
    findColumnIndex(columns, 'total'),
    findColumnIndex(columns, 'amount'),
    findColumnIndex(columns, 'mrp'),
    findColumnIndex(columns, 'rate'),
  ].filter((i) => i >= 0);
}

/** Prefer rightmost money-like column for sum reconciliation */
function primaryAmountIndex(columns: string[]): number {
  const preferred = [
    findColumnIndex(columns, 'total amt'),
    findColumnIndex(columns, 'total amount'),
    findColumnIndex(columns, 'labour/part price'),
    findColumnIndex(columns, 'taxable'),
    findColumnIndex(columns, 'total'),
    findColumnIndex(columns, 'amount'),
  ].filter((i) => i >= 0);
  return preferred.length ? preferred[0] : -1;
}

function sumTableAmount(table: DynamicTable): number {
  const idx = primaryAmountIndex(table.columns);
  if (idx < 0) return 0;
  let sum = 0;
  for (const row of table.rows) {
    const n = asNullableNumber(row[idx]);
    if (n != null) sum += n;
  }
  return sum;
}

export function inferDocumentType(title: string | null): string | null {
  if (!title) return null;
  const t = title.toLowerCase();
  if (/supplementary/.test(t)) return 'SUPPLEMENTARY_ESTIMATE';
  if (/temporary\s*estimate/.test(t)) return 'TEMPORARY_ESTIMATE';
  if (/pre[-\s]?invoice/.test(t)) return 'PRE_INVOICE';
  if (/tax\s*invoice|invoice/.test(t)) return 'TAX_INVOICE';
  if (/quotation|quote/.test(t)) return 'QUOTATION';
  if (/estimate/.test(t)) return 'ESTIMATE';
  return null;
}

export function inferServiceHint(description: string): string {
  const d = description.toLowerCase();
  if (/paint/.test(d)) return 'PAINTING';
  if (/dent/.test(d)) return 'DENTING';
  if (/r\s*&\s*r|removal|refit|r&r/.test(d)) return 'R_AND_R';
  if (/tow/.test(d)) return 'TOWING';
  if (/\bac\b|refrigerant|gas\s*charg/.test(d)) return 'AC_SERVICE';
  if (/glass|windshield|windscreen/.test(d)) return 'GLASS_FITTING';
  if (/align/.test(d)) return 'ALIGNMENT';
  if (/electric/.test(d)) return 'ELECTRICAL';
  if (/mechanic|engine|gear\s*box/.test(d)) return 'MECHANICAL';
  if (/body\s*repair|bodrep/.test(d)) return 'BODY_REPAIR';
  if (/inspect|diagnos/.test(d)) return 'DIAGNOSTIC';
  return 'OTHER';
}

export function isInsuranceCompositeSchema(columns: string[]): boolean {
  const joined = columns.join(' | ').toLowerCase();
  const hasRr = /r\s*&\s*r|r\s*and\s*r|r&r\s*cost|r&r\s*hrs/.test(joined);
  const hasDent = /denting/.test(joined);
  const hasPaint = /painting/.test(joined);
  return hasRr && (hasDent || hasPaint);
}

function parseCompositeRow(row: string[], columns: string[]): RepairEstimate {
  const codeIdx = findColumnIndex(columns, 'part no', 'part number', 'code');
  const descIdx = findColumnIndex(columns, 'description', 'part description', 'particular');
  const demandIdx = findColumnIndex(columns, 'demand type');
  const rrIdx = findColumnIndex(columns, 'r&r cost', 'r & r cost', 'r and r cost', 'r&r');
  const dentIdx = findColumnIndex(columns, 'denting');
  const paintIdx = findColumnIndex(columns, 'painting');
  const totalIdx = findColumnIndex(columns, 'total');
  return {
    partNo: codeIdx >= 0 ? asNullableString(row[codeIdx]) : null,
    description: descIdx >= 0 ? asNullableString(row[descIdx]) : asNullableString(rowBannerText(row)),
    demandType: demandIdx >= 0 ? asNullableString(row[demandIdx]) : null,
    components: {
      rr: rrIdx >= 0 ? asNullableNumber(row[rrIdx]) : null,
      denting: dentIdx >= 0 ? asNullableNumber(row[dentIdx]) : null,
      painting: paintIdx >= 0 ? asNullableNumber(row[paintIdx]) : null,
    },
    total: totalIdx >= 0 ? asNullableNumber(row[totalIdx]) : null,
    row: [...row],
  };
}

export type ProcessLineItemsResult = {
  parts: DynamicTable;
  labour: DynamicTable;
  misc: DynamicTable;
  undefinedParts: DynamicTable;
  repairGroups: RepairGroup[];
  repairEstimates: RepairEstimate[];
  notes: string[];
  labourServiceHints: string[];
  vehicleFromRows: string | null;
};

/**
 * Classify lineItems → parts/labour (+ misc/undefined), repair groups, notes, Maruti composites.
 * Priority: P/L → section → Type → HSN 9987 → continuation inherit only.
 */
export function processLineItems(lineItems: DynamicTable): ProcessLineItemsResult {
  const columns = lineItems.columns;
  const empty = emptyDynamicTable();
  if (!columns.length) {
    return {
      parts: empty,
      labour: empty,
      misc: empty,
      undefinedParts: empty,
      repairGroups: [],
      repairEstimates: [],
      notes: [],
      labourServiceHints: [],
      vehicleFromRows: null,
    };
  }

  // Maruti insurance composite — one physical row = part + services
  if (isInsuranceCompositeSchema(columns)) {
    const estimates: RepairEstimate[] = [];
    const notes: string[] = [];
    for (const row of lineItems.rows) {
      const banner = rowBannerText(row);
      if (!banner) continue;
      if (NOTE_RE.test(banner) && !amountColumnIndexes(columns).some((i) => cellLooksNumeric(row[i] ?? ''))) {
        notes.push(banner);
        continue;
      }
      if (detectSection(banner) || isTotalsOrJunkRow(row)) continue;
      estimates.push(parseCompositeRow(row, columns));
    }
    return {
      parts: { columns: [...columns], rows: estimates.map((e) => e.row) },
      labour: { columns: [...columns], rows: [] },
      misc: emptyDynamicTable(),
      undefinedParts: emptyDynamicTable(),
      repairGroups: [],
      repairEstimates: estimates,
      notes,
      labourServiceHints: [],
      vehicleFromRows: extractRegNoFromRows(lineItems.rows),
    };
  }

  const hsnIdx = findColumnIndex(columns, 'hsn/sac', 'hsn', 'sac');
  const codeIdx = findColumnIndex(
    columns,
    'code / part',
    'part no',
    'part number',
    'part#',
    'job code',
    'code',
  );
  const descIdx = findColumnIndex(
    columns,
    'description',
    'particular',
    'lab/part',
    'labour description',
  );
  const plIdx = findExplicitPlColumnIndex(columns);
  const typeIdx = findTypeColumnIndex(columns);
  const amountIdxs = amountColumnIndexes(columns);

  const partsRows: string[][] = [];
  const labourRows: string[][] = [];
  const miscRows: string[][] = [];
  const undefinedRows: string[][] = [];
  const labourServiceHints: string[] = [];
  const notes: string[] = [];
  const repairGroups: RepairGroup[] = [];
  let currentGroup: RepairGroup | null = null;
  let section: SectionKind | null = null;
  let lastIsLabour: boolean | null = null;
  let groupSeq = 0;

  const vehicleFromRows = extractRegNoFromRows(lineItems.rows);

  const attachToGroup = (bucket: 'parts' | 'labour', index: number) => {
    if (!currentGroup) return;
    currentGroup.members.push({ bucket, index });
  };

  const pushLabour = (row: string[]) => {
    const idx = labourRows.length;
    labourRows.push(row);
    const desc = descIdx >= 0 ? (row[descIdx] ?? '') : rowBannerText(row);
    labourServiceHints.push(inferServiceHint(desc));
    lastIsLabour = true;
    attachToGroup('labour', idx);
  };

  const pushParts = (row: string[]) => {
    const idx = partsRows.length;
    partsRows.push(row);
    lastIsLabour = false;
    attachToGroup('parts', idx);
  };

  const push = (row: string[], isLabour: boolean) => {
    if (section === 'MISC') {
      miscRows.push(row);
      lastIsLabour = isLabour;
      return;
    }
    if (section === 'UNDEFINED') {
      undefinedRows.push(row);
      lastIsLabour = isLabour;
      return;
    }
    if (isLabour) pushLabour(row);
    else pushParts(row);
  };

  for (const row of lineItems.rows) {
    if (isVehicleInfoRow(row)) continue;

    const banner = rowBannerText(row);
    if (NOTE_RE.test(banner) && !hasPricedOrMarkedLine(row, hsnIdx, plIdx, amountIdxs)) {
      notes.push(banner);
      continue;
    }

    const sectionHit = detectSection(banner);
    if (sectionHit && !hasPricedOrMarkedLine(row, hsnIdx, plIdx, amountIdxs)) {
      // Repeated Parts header on continuation page: keep same PART section (don't clear group)
      if (!(sectionHit === 'PART' && section === 'PART')) {
        currentGroup = null;
      }
      section = sectionHit;
      continue;
    }

    if (isRepairGroupBanner(row, hsnIdx, plIdx, amountIdxs)) {
      groupSeq += 1;
      currentGroup = {
        id: `rg_${groupSeq}`,
        title: banner.replace(/\s*[-–—]?\s*\(body\s*&\s*paint[^)]*\)/i, '').trim() || banner,
        members: [],
      };
      repairGroups.push(currentGroup);
      continue;
    }

    if (isTotalsOrJunkRow(row) && !hasPricedOrMarkedLine(row, hsnIdx, plIdx, amountIdxs)) continue;
    if (!hasLineItemText(row, codeIdx, descIdx) && plIdx < 0) continue;

    if (plIdx >= 0) {
      const marker = (row[plIdx] ?? '').trim().toUpperCase();
      if (marker === 'L') {
        push(row, true);
        continue;
      }
      if (marker === 'P') {
        push(row, false);
        continue;
      }
    }

    if (typeIdx >= 0) {
      const typed = typeColumnIsLabour(row[typeIdx] ?? '');
      if (typed != null) {
        push(row, typed);
        continue;
      }
    }

    if (section === 'LABOUR' || section === 'MISC' || section === 'UNDEFINED') {
      push(row, section === 'LABOUR');
      continue;
    }
    if (section === 'PART') {
      const hsn = hsnIdx >= 0 ? normalizeHsn(row[hsnIdx] ?? '') : '';
      if (isServiceHsn(hsn)) {
        push(row, true);
        continue;
      }
      push(row, false);
      continue;
    }

    const hsn = hsnIdx >= 0 ? normalizeHsn(row[hsnIdx] ?? '') : '';
    if (hsn.length >= 4) {
      push(row, isServiceHsn(hsn));
      continue;
    }

    if (isContinuationRow(row, hsnIdx, amountIdxs, codeIdx, descIdx) && lastIsLabour != null) {
      push(row, lastIsLabour);
      continue;
    }

    if (
      amountIdxs.some((i) => cellLooksNumeric(row[i] ?? '')) ||
      (codeIdx >= 0 && (row[codeIdx] ?? '').trim())
    ) {
      push(row, false);
      continue;
    }

    if (lastIsLabour != null && isContinuationRow(row, hsnIdx, amountIdxs, codeIdx, descIdx)) {
      push(row, lastIsLabour);
    }
  }

  return {
    parts: { columns: [...columns], rows: partsRows },
    labour: { columns: [...columns], rows: labourRows },
    misc: { columns: [...columns], rows: miscRows },
    undefinedParts: { columns: [...columns], rows: undefinedRows },
    repairGroups: repairGroups.filter((g) => g.members.length > 0),
    repairEstimates: [],
    notes,
    labourServiceHints,
    vehicleFromRows,
  };
}

/** @deprecated use processLineItems — kept for call sites/tests expecting split shape */
export function splitLineItems(lineItems: DynamicTable) {
  const r = processLineItems(lineItems);
  return {
    parts: r.parts,
    labour: r.labour,
    vehicleFromRows: r.vehicleFromRows,
  };
}

function reconcileTotals(
  parts: DynamicTable,
  labour: DynamicTable,
  partsTotal: number | null,
  labourTotal: number | null,
  grandTotal: number | null,
): { confidenceScore: number; requiresHumanReview: boolean } {
  let review = false;
  const partsSum = sumTableAmount(parts);
  const labourSum = sumTableAmount(labour);

  if (partsTotal != null && Math.abs(partsSum - partsTotal) > TOTAL_TOLERANCE && parts.rows.length > 0) {
    review = true;
  }
  if (labourTotal != null && Math.abs(labourSum - labourTotal) > TOTAL_TOLERANCE && labour.rows.length > 0) {
    review = true;
  }
  if (
    grandTotal != null &&
    partsTotal != null &&
    labourTotal != null &&
    Math.abs(partsTotal + labourTotal - grandTotal) > TOTAL_TOLERANCE * 2
  ) {
    // summary box may include tax — only soft flag if line sums wildly off grand
    const lineSum = partsSum + labourSum;
    if (lineSum > 0 && Math.abs(lineSum - grandTotal) > Math.max(TOTAL_TOLERANCE * 5, grandTotal * 0.15)) {
      review = true;
    }
  }

  return {
    confidenceScore: review ? 0.75 : 0.9,
    requiresHumanReview: review,
  };
}

/** Map LlamaExtract payload → WORKSHOP UI / webhook shape (+ additive fields) */
export function normalizeLlamaWorkshopResult(raw: unknown) {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  let processed: ProcessLineItemsResult;
  if (obj.lineItems != null) {
    processed = processLineItems(normalizeTable(obj.lineItems));
  } else {
    const parts = normalizeTable(obj.parts);
    const labour = normalizeTable(obj.labour);
    processed = {
      parts,
      labour,
      misc: emptyDynamicTable(),
      undefinedParts: emptyDynamicTable(),
      repairGroups: [],
      repairEstimates: [],
      notes: [],
      labourServiceHints: labour.rows.map((row) => {
        const descIdx = findColumnIndex(labour.columns, 'description', 'particular', 'lab/part');
        return inferServiceHint(descIdx >= 0 ? (row[descIdx] ?? '') : rowBannerText(row));
      }),
      vehicleFromRows: null,
    };
  }

  const documentTitle = asNullableString(obj.documentTitle);
  const partsTotal = asNullableNumber(obj.partsTotal);
  const labourTotal = asNullableNumber(obj.labourTotal);
  const grandTotal = asNullableNumber(obj.grandTotal);
  const quality = reconcileTotals(
    processed.parts,
    processed.labour,
    partsTotal,
    labourTotal,
    grandTotal,
  );

  return {
    workshopDetails: {
      name: asNullableString(obj.workshopName),
      invoiceNumber: asNullableString(obj.invoiceNumber),
      vehicleNumber: asNullableString(obj.vehicleNumber) ?? processed.vehicleFromRows,
      gstin: null,
      invoiceDate: null,
      documentTitle,
      jobCardNumber: null,
      customerName: null,
      odometerReading: null,
    },
    documentType: inferDocumentType(documentTitle),
    summary: {
      grandTotal,
      partsTotal,
      labourTotal,
    },
    parts: processed.parts,
    labour: processed.labour,
    misc: processed.misc,
    undefinedParts: processed.undefinedParts,
    repairGroups: processed.repairGroups,
    repairEstimates: processed.repairEstimates,
    notes: processed.notes,
    labourServiceHints: processed.labourServiceHints,
    confidenceScore: quality.confidenceScore,
    requiresHumanReview: quality.requiresHumanReview,
  };
}

// ponytail: self-checks — layout families + additive fields
{
  const honda = processLineItems({
    columns: ['P/L', 'Part Number', 'HSN', 'Description', 'Total'],
    rows: [
      ['', '', '', 'RHS FENDER CHANGE - (Body & Paint Work)', ''],
      ['L', 'PAINT1', '998714', 'PAINT CHGS FRONT FENDER', '1000'],
      ['P', '74100', '87089900', 'PANEL R.FR FENDER', '5000'],
    ],
  });
  console.assert(honda.labour.rows.length === 1 && honda.parts.rows.length === 1, 'Honda P/L');
  console.assert(honda.repairGroups.length === 1 && honda.repairGroups[0].members.length === 2, 'Honda repair group');
  console.assert(honda.labourServiceHints[0] === 'PAINTING', 'serviceHint painting');

  const toyotaCols = ['Code / Part No', 'Description', 'SAC/HSN', 'QTY', 'Labour/Part Price'];
  const toyota = processLineItems({
    columns: toyotaCols,
    rows: [
      ['Labour Charges', '', '', '', ''],
      ['52119PNP', 'Front Bumper Cover - Paint', '998729', '', '2,851.00'],
      ['BODREP99', 'Others - Body Repair', '998729', '', '4,224.00'],
      ['BODREP99', '- RIM REPLACE', '', '', ''],
      ['Part Charges', '', '', '', ''],
      ['A-42611-WC020', 'WHEEL, DISC', '87087000', '1', '1,589.00'],
      ['', 'NOTE: Cabin Painting not included in this quotation.', '', '', ''],
    ],
  });
  console.assert(toyota.labour.rows.length === 3, 'Toyota labour + child');
  console.assert(toyota.parts.rows.length === 1, 'Toyota parts');
  console.assert(toyota.notes.length === 1, 'estimate note');

  const volvo = processLineItems({
    columns: ['SR', 'HSN/SAC', 'Description', 'Taxable'],
    rows: [
      ['64', '40169390', 'TAPE', '100'],
      ['164', '998714', 'Tilt cylinder removed and fitted', '500'],
      ['65', '84159000', 'COOLANT PIPE', '200'],
    ],
  });
  console.assert(volvo.parts.rows.length === 2 && volvo.labour.rows.length === 1, 'Volvo interleaved');

  const misc = processLineItems({
    columns: ['Code', 'Description', 'Amt'],
    rows: [
      ['Miscellaneous', '', ''],
      ['', 'AC GAS', '50'],
      ['Undefined Parts', '', ''],
      ['', 'Sealant', '10'],
    ],
  });
  console.assert(misc.misc.rows.length === 1 && misc.undefinedParts.rows.length === 1, 'misc/undefined');

  console.assert(isInsuranceCompositeSchema(['Part No', 'Part Description', 'R&R Cost', 'Denting Cost', 'Painting Cost', 'Total']), 'composite schema');
  const maruti = processLineItems({
    columns: ['Part No', 'Part Description', 'Demand Type', 'R&R Cost', 'Denting Cost', 'Painting Cost', 'Total'],
    rows: [
      ['P1', 'PANEL FRONT HOOD', 'REPAIR', '615', '1000', '7365', '8980'],
    ],
  });
  console.assert(maruti.repairEstimates.length === 1 && maruti.repairEstimates[0].demandType === 'REPAIR', 'Maruti composite');

  console.assert(normalizeHsn('8708.99.00') === '87089900', 'normalizeHsn');
  console.assert(inferDocumentType('Insurance Temporary Estimate') === 'TEMPORARY_ESTIMATE', 'documentType');

  const norm = normalizeLlamaWorkshopResult({
    workshopName: 'W',
    documentTitle: 'TEMPORARY ESTIMATE',
    invoiceNumber: '1',
    vehicleNumber: null,
    lineItems: {
      columns: ['P/L', 'HSN', 'Description', 'Total'],
      rows: [
        ['L', '998714', 'Paint', '100'],
        ['P', '87089900', 'Panel', '200'],
      ],
    },
    partsTotal: 200,
    labourTotal: 100,
    grandTotal: 300,
  });
  console.assert(norm.documentType === 'TEMPORARY_ESTIMATE', 'norm documentType');
  console.assert(norm.requiresHumanReview === false, 'reconcile ok');
  console.assert(norm.repairGroups.length === 0, 'no orphan groups');
}

export class WorkshopBillExtractor {
  async extract(urls: string[]): Promise<ReturnType<typeof normalizeLlamaWorkshopResult>> {
    const apiKey = _config.LLAMA_CLOUD_API_KEY;
    if (!apiKey || apiKey === 'changeme') {
      throw ApiError.badRequest('LLAMA_CLOUD_API_KEY is not configured.');
    }

    const url = urls.find(Boolean);
    if (!url) {
      throw ApiError.badRequest('At least one PDF URL is required.');
    }

    let tmpPath: string | undefined;
    try {
      tmpPath = await downloadPdfToTemp(url);
      const client = new LlamaCloud({ apiKey, timeout: POLL_TIMEOUT_MS });
      const fileObj = await client.files.create({
        file: fs.createReadStream(tmpPath),
        purpose: 'extract',
      });

      const job = await client.extract.run(
        {
          file_input: fileObj.id,
          configuration: {
            data_schema: llamaWorkshopJsonSchema as ExtractConfigurationDataSchema,
            extraction_target: 'per_doc',
            tier: EXTRACT_TIER,
          },
        },
        { timeout: 600 },
      );

      if (job.status !== 'COMPLETED') {
        throw ApiError.internalServerError(
          job.error_message ?? `LlamaExtract failed with status ${job.status}`,
        );
      }

      return normalizeLlamaWorkshopResult(job.extract_result);
    } catch (err: any) {
      if (err instanceof ApiError) throw err;
      const msg = err?.message ?? String(err);
      if (err?.status === 401 || /unauthorized|invalid.*api.?key/i.test(msg)) {
        throw ApiError.unauthorized('LlamaCloud API key rejected.');
      }
      throw ApiError.internalServerError(`LlamaExtract error: ${msg}`);
    } finally {
      if (tmpPath) {
        fs.promises.unlink(tmpPath).catch(() => {});
      }
    }
  }
}
