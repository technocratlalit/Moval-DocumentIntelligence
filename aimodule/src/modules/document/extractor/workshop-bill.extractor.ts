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
/** Long multi-page interleaved bills need higher tier for full row coverage */
const EXTRACT_TIER = 'agentic_plus' as const;

/** Indian service SAC range (e.g. Volvo 998714, Toyota 998729) */
function isLabourHsn(hsn: string): boolean {
  return /^\d+$/.test(hsn) && hsn.startsWith('99');
}

const SECTION_BANNER_RE = /^(labour|part)\s*charges?$/i;

const REG_NO_RE =
  /\b(?:Reg\.?\s*No\.?|Regn\.?|Registration)\s*[:.]?\s*([A-Z]{2}[-\s]?\d{1,2}[-\s]?[A-Z]{0,3}[-\s]?\d{1,4})\b/i;

/** Narrow cast — SDK expects a loose JSON-schema object map */
type ExtractConfigurationDataSchema = {
  [key: string]: { [key: string]: unknown } | Array<unknown> | string | number | boolean | null;
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

function normalizeTable(raw: unknown): DynamicTable {
  const table = parseDynamicTable(raw);
  return {
    ...table,
    columns: table.columns.map(cleanCell),
    rows: table.rows.map((row) => row.map(cleanCell)),
  };
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

function cellLooksNumeric(s: string): boolean {
  if (!s) return false;
  return /[\d]/.test(s.replace(/[,.\s%-]/g, ''));
}

function extractRegNoFromRows(rows: string[][]): string | null {
  for (const row of rows) {
    for (const cell of row) {
      const m = cell.match(REG_NO_RE);
      if (m?.[1]) return cleanCell(m[1].replace(/\s+/g, '-').toUpperCase());
    }
  }
  return null;
}

function isSectionBannerRow(row: string[]): boolean {
  const first = row.find((c) => c.trim()) ?? '';
  return SECTION_BANNER_RE.test(first.trim());
}

/** Pure vehicle-info banner (Reg. No. etc.) — not a table line item */
function isVehicleInfoRow(row: string[]): boolean {
  const joined = row.filter(Boolean).join(' ');
  if (!joined) return true;
  if (REG_NO_RE.test(joined) && !row.some((c, i) => i > 0 && cellLooksNumeric(c) && !REG_NO_RE.test(c))) {
    // Reg. No. row with no separate priced cells
    const onlyInfo = row.every((c) => !c || REG_NO_RE.test(c) || /^(ste|door|kmr|odo)/i.test(c));
    if (onlyInfo || REG_NO_RE.test(joined)) {
      // Skip if no line-item-looking code+desc pair beyond the reg text alone
      const nonEmpty = row.filter((c) => c.trim());
      return nonEmpty.length <= 2 && nonEmpty.some((c) => REG_NO_RE.test(c));
    }
  }
  return false;
}

function hasLineItemText(row: string[], codeIdx: number, descIdx: number): boolean {
  const code = codeIdx >= 0 ? (row[codeIdx] ?? '').trim() : '';
  const desc = descIdx >= 0 ? (row[descIdx] ?? '').trim() : '';
  if (code || desc) return true;
  return row.some((c) => c.trim());
}

/**
 * Split combined lineItems into parts vs labour.
 * Labour = Indian service SAC (starts with 99); unpriced detail rows inherit last bucket.
 */
export function splitLineItems(lineItems: DynamicTable): {
  parts: DynamicTable;
  labour: DynamicTable;
  vehicleFromRows: string | null;
} {
  const columns = lineItems.columns;
  if (!columns.length) {
    return { parts: emptyDynamicTable(), labour: emptyDynamicTable(), vehicleFromRows: null };
  }

  const hsnIdx = findColumnIndex(columns, 'hsn/sac', 'hsn', 'sac');
  const codeIdx = findColumnIndex(columns, 'code / part', 'part no', 'part number', 'code');
  const descIdx = findColumnIndex(columns, 'description', 'lab/part', 'particular');

  const partsRows: string[][] = [];
  const labourRows: string[][] = [];
  const vehicleFromRows = extractRegNoFromRows(lineItems.rows);
  let lastIsLabour: boolean | null = null;

  for (const row of lineItems.rows) {
    if (isSectionBannerRow(row)) continue;
    if (isVehicleInfoRow(row)) continue;
    if (!hasLineItemText(row, codeIdx, descIdx)) continue;

    const hsn = hsnIdx >= 0 ? (row[hsnIdx] ?? '').replace(/\s/g, '') : '';
    if (hsn.length >= 4 && /^\d+$/.test(hsn)) {
      lastIsLabour = isLabourHsn(hsn);
      if (lastIsLabour) labourRows.push(row);
      else partsRows.push(row);
      continue;
    }

    // Unpriced detail / continuation — keep and inherit previous labour/parts bucket
    if (lastIsLabour === true) labourRows.push(row);
    else if (lastIsLabour === false) partsRows.push(row);
    else partsRows.push(row); // ponytail: no prior HSN → parts
  }

  return {
    parts: { columns: [...columns], rows: partsRows },
    labour: { columns: [...columns], rows: labourRows },
    vehicleFromRows,
  };
}

/** Map LlamaExtract payload → existing WORKSHOP UI / webhook shape */
export function normalizeLlamaWorkshopResult(raw: unknown) {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  // Prefer new lineItems; fall back to legacy parts+labour if an old cached payload appears
  let parts: DynamicTable;
  let labour: DynamicTable;
  let vehicleFromRows: string | null = null;

  if (obj.lineItems != null) {
    const lineItems = normalizeTable(obj.lineItems);
    const split = splitLineItems(lineItems);
    parts = split.parts;
    labour = split.labour;
    vehicleFromRows = split.vehicleFromRows;
  } else {
    parts = normalizeTable(obj.parts);
    labour = normalizeTable(obj.labour);
  }

  const vehicleNumber =
    asNullableString(obj.vehicleNumber) ?? vehicleFromRows;

  return {
    workshopDetails: {
      name: asNullableString(obj.workshopName),
      invoiceNumber: asNullableString(obj.invoiceNumber),
      vehicleNumber,
      gstin: null,
      invoiceDate: null,
      documentTitle: null,
      jobCardNumber: null,
      customerName: null,
      odometerReading: null,
    },
    summary: {
      grandTotal: asNullableNumber(obj.grandTotal),
    },
    parts,
    labour,
    confidenceScore: 0.9,
    requiresHumanReview: false,
  };
}

// ponytail: self-check — HSN split + detail-row inherit + Reg. No.
{
  const cols = ['Code / Part No', 'Description', 'SAC/HSN', 'QTY', 'Labour/Part Price'];
  const split = splitLineItems({
    columns: cols,
    rows: [
      ['Labour Charges', '', '', '', ''],
      ['52119PNP', 'Front Bumper Cover - Paint', '998729', '', '2,851.00'],
      ['BODREP99', 'Others - Body Repair', '998729', '', '4,224.00'],
      ['BODREP99', '- RIM REPLACE', '', '', ''],
      ['BODREP99', '- ARM REPACE', '', '', ''],
      ['BODREP99', '- DRIVE SHATF REPLACE', '', '', ''],
      ['Part Charges', '', '', '', ''],
      ['A-42611-WC020', 'WHEEL, DISC', '87087000', '1', '1,589.00'],
      ['Reg. No : JH-10CS-2856', '', '', '', ''],
    ],
  });
  console.assert(split.labour.rows.length === 5, 'splitLineItems labour + BODREP99 details');
  console.assert(split.parts.rows.length === 1, 'splitLineItems parts goods HSN');
  console.assert(split.vehicleFromRows?.includes('JH-10CS-2856'), 'splitLineItems Reg. No');
  const norm = normalizeLlamaWorkshopResult({
    workshopName: 'Test',
    invoiceNumber: null,
    vehicleNumber: null,
    lineItems: { columns: cols, rows: [['A-1', 'BOLT', '87089900', '1', '10']] },
    grandTotal: 10,
  });
  console.assert(norm.parts.rows.length === 1 && norm.labour.rows.length === 0, 'normalize via lineItems');
}

/**
 * Workshop bill extraction via LlamaCloud Extract (dynamic columns/rows).
 * Takes PDF URL(s) — does not use Gemini.
 */
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
