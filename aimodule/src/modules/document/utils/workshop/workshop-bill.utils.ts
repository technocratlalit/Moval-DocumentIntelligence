//  State Map
const STATE_MAP: Record<string, string> = {
  AP: 'ANDHRA PRADESH',
  AR: 'ARUNACHAL PRADESH',
  AS: 'ASSAM',
  BR: 'BIHAR',
  CG: 'CHHATTISGARH',
  GA: 'GOA',
  GJ: 'GUJARAT',
  HR: 'HARYANA',
  HP: 'HIMACHAL PRADESH',
  JH: 'JHARKHAND',
  JK: 'JAMMU AND KASHMIR',
  KA: 'KARNATAKA',
  KL: 'KERALA',
  LA: 'LADAKH',
  LD: 'LAKSHADWEEP',
  MP: 'MADHYA PRADESH',
  MH: 'MAHARASHTRA',
  MN: 'MANIPUR',
  ML: 'MEGHALAYA',
  MZ: 'MIZORAM',
  NL: 'NAGALAND',
  OD: 'ODISHA',
  PB: 'PUNJAB',
  PY: 'PUDUCHERRY',
  RJ: 'RAJASTHAN',
  SK: 'SIKKIM',
  TN: 'TAMIL NADU',
  TS: 'TELANGANA',
  TR: 'TRIPURA',
  UP: 'UTTAR PRADESH',
  UK: 'UTTARAKHAND',
  WB: 'WEST BENGAL',
  AN: 'ANDAMAN AND NICOBAR ISLANDS',
  CH: 'CHANDIGARH',
  DN: 'DADRA AND NAGAR HAVELI AND DAMAN AND DIU',
  DL: 'DELHI',
};

//normalize gst
export function normaliseGst(data: {
  igstRate?: number | null;
  igstAmount?: number | null;
  cgstRate?: number | null;
  cgstAmount?: number | null;
  sgstRate?: number | null;
  sgstAmount?: number | null;
}): {
  type: 'IGST' | 'CGST_SGST' | 'NONE';
  rate: number;
  totalTaxAmount: number;
} {
  const igst = data.igstAmount ?? 0;
  const cgst = data.cgstAmount ?? 0;
  const sgst = data.sgstAmount ?? 0;

  if (igst > 0) {
    return {
      type: 'IGST',
      rate: data.igstRate ?? 18,
      totalTaxAmount: igst,
    };
  }

  if (cgst > 0 || sgst > 0) {
    return {
      type: 'CGST_SGST',
      rate: (data.cgstRate ?? 0) + (data.sgstRate ?? 0),
      totalTaxAmount: cgst + sgst,
    };
  }

  return { type: 'NONE', rate: 0, totalTaxAmount: 0 };
}

type SummaryLike = {
  totalPartsAmount?: number | null;
  totalLabourAmount?: number | null;
  partsSubtotalWithTax?: number | null;
  labourSubtotalWithTax?: number | null;
  totalGstAmount?: number | null;
  grandTotal?: number | null;
  totalDiscount?: number | null;
};

/** Resolve parts/labour totals from summary — supports tax-inclusive subtotals (Eicher-style) */
export function resolveSummaryPartsLabour(summary: SummaryLike | null | undefined): {
  parts: number;
  labour: number;
  taxInclusive: boolean;
} {
  if (!summary) return { parts: 0, labour: 0, taxInclusive: false };

  const partsWithTax = summary.partsSubtotalWithTax ?? 0;
  const labourWithTax = summary.labourSubtotalWithTax ?? 0;
  if (partsWithTax > 0 || labourWithTax > 0) {
    return { parts: partsWithTax, labour: labourWithTax, taxInclusive: true };
  }

  return {
    parts: summary.totalPartsAmount ?? 0,
    labour: summary.totalLabourAmount ?? 0,
    taxInclusive: false,
  };
}

//compute grand total check
export function computeGrandTotalCheck(data: {
  partsTotal?: number | null;
  labourTotal?: number | null;
  totalTaxAmount: number;
  totalGstAmount?: number | null;
  grandTotal?: number | null;
  discountAmount?: number | null;
  taxInclusiveSubtotals?: boolean;
}): { ok: boolean; expected: number; actual: number; delta: number } {
  const parts = data.partsTotal ?? 0;
  const labour = data.labourTotal ?? 0;
  const tax = data.totalTaxAmount ?? 0;
  const combinedGst = data.totalGstAmount ?? 0;
  const discount = data.discountAmount ?? 0;

  let expected: number;
  if (data.taxInclusiveSubtotals) {
    expected = parts + labour - discount;
  } else if (combinedGst > 0) {
    expected = parts + labour + combinedGst - discount;
  } else {
    expected = parts + labour + tax - discount;
  }

  const actual = data.grandTotal ?? 0;
  const delta = Math.abs(expected - actual);

  return { ok: delta <= 10, expected, actual, delta };
}


export function classifyBillType(
  invoiceNumber: string | null | undefined,
  documentTitle: string | null | undefined
): 'ESTIMATE' | 'PROFORMA' | 'FINAL_INVOICE' | 'UNKNOWN' {
  const checkIn = (s: string | null | undefined) => s?.toUpperCase() ?? '';

  const inv   = checkIn(invoiceNumber);
  const title = checkIn(documentTitle);

  if (inv.startsWith('EST') || title.includes('ESTIMATE')) return 'ESTIMATE';
  if (inv.startsWith('PRO') || inv.startsWith('PF') || title.includes('PROFORMA') || title.includes('PERFORMA')) return 'PROFORMA';
  if (inv.startsWith('INV') || inv.startsWith('TAX') || /^\d+$/.test(inv)) return 'FINAL_INVOICE';

  // Fall back to title keywords
  if (title.includes('FINAL') || title.includes('INVOICE') || title.includes('BILL')) return 'FINAL_INVOICE';

  return 'UNKNOWN';
}

//extract vehicle state
export function extractVehicleState(vehicleNumber: string | null | undefined): string | null {
  const clean = normaliseVehicleNo(vehicleNumber);
  if (!clean || clean.length < 2) return null;
  const prefix = clean.substring(0, 2).toUpperCase();
  return STATE_MAP[prefix] ?? null;
}

//normalise vehicle registration number
//eg: "jh 11 ad 0786" -> "JH11AD0786"
//eg: "jh-11-ad-0786" -> "JH11AD0786"
export function normaliseVehicleNo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return raw.replace(/[\s.\-]+/g, '').toUpperCase();
}

type TableRow = Record<string, unknown>;

function rowDedupeKey(row: TableRow, amountKey: string): string {
  const srNo = String(row.srNo ?? '').trim();
  const code = String(row.partNumber ?? row.labourCode ?? '').trim();
  const desc = String(row.description ?? '').trim().toLowerCase();
  const amount = row[amountKey];
  return `${srNo}|${code}|${desc}|${amount}`;
}

/** Merge chunk pass rows and drop obvious duplicates from repeated page headers. */
export function mergeWorkshopTableRows<T extends TableRow>(
  rows: T[],
  amountKey: 'totalPrice' | 'totalAmount',
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const key = rowDedupeKey(row, amountKey);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/** Merge sequential line items — dedupe by position-aware key. */
export function mergeLineItemsRows<T extends TableRow>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rt = String(row.rowType ?? '').trim();
    const code = String(row.itemCode ?? '').trim();
    const desc = String(row.description ?? '').trim().toLowerCase();
    const total = row.totalAmount;
    const key = `${i}|${rt}|${code}|${desc}|${total}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}


/**
 * Upcountry/Volvo dual-column invoices interleave two Sr.No series in one list
 * (e.g. 1, 101, 2, 102, 3, 103). Offset-based resequencing snowballs these
 * into thousands — detect and handle separately.
 */
function hasInterleavedDualSeries(rows: TableRow[]): boolean {
  const serials = rows
    .map((r) => Number(r.srNo))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (serials.length < 4) return false;

  let patternHits = 0;
  for (let i = 1; i < serials.length; i++) {
    const prev = serials[i - 1];
    const curr = serials[i];
    // High series then drop to low: 101 → 2
    if (prev >= 50 && curr < prev && curr <= 100 && prev - curr >= 40) {
      patternHits++;
    }
    // Low series then jump to high: 5 → 105
    if (prev <= 100 && curr > prev + 40 && curr >= 100) {
      patternHits++;
    }
  }
  return patternHits >= 2;
}

/**
 * Returns true if all rows already have valid, strictly-increasing serial numbers
 * that continued from startSrNo without chunk restarts.
 */
function serialsAreAlreadyContinuous(rows: TableRow[], startSrNo: number): boolean {
  if (rows.length === 0) return true;
  let prev = startSrNo;
  for (const row of rows) {
    const n = Number(row.srNo);
    if (!Number.isFinite(n) || n <= 0) return false;
    if (n <= prev) return false;
    prev = n;
  }
  return true;
}

/**
 * True when the AI reset Sr.No to 1..5 on a new chunk while the merged table
 * had already advanced well past that — NOT when the PDF prints a new section
 * (e.g. labour block at 90, or dual-series 1/101 interleave).
 */
function looksLikeAiChunkRestart(rows: TableRow[], startSrNo: number): boolean {
  if (startSrNo <= 0 || rows.length === 0) return false;

  const serials = rows
    .map((r) => Number(r.srNo))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (serials.length === 0) return false;

  const first = serials[0];
  const min = Math.min(...serials);

  // Legitimate PDF section serials (labour 90+, parts 50+, etc.) — preserve as printed.
  if (min > 10) return false;

  // Chunk opens at 1..5 while prior merged rows already advanced beyond that range.
  return min <= 5 && first <= 5 && startSrNo > min + 10;
}

/**
 * Assign system rowIndex 1..N for UI. Preserve printed srNo when the bill has a
 * serial column; set srNo to null when no row has a printed serial.
 */
export function assignTableRowIndexes<T extends TableRow>(rows: T[]): T[] {
  if (rows.length === 0) return rows;

  const hasPrintedSerial = rows.some((r) => {
    const n = Number(r.srNo);
    return Number.isFinite(n) && n > 0;
  });

  rows.forEach((row, idx) => {
    const rec = row as Record<string, unknown>;
    rec.rowIndex = idx + 1;
    if (!hasPrintedSerial) {
      rec.srNo = null;
    } else {
      const n = Number(rec.srNo);
      if (!Number.isFinite(n) || n <= 0) {
        rec.srNo = null;
      }
    }
  });

  return rows;
}

export function resequenceTableSerials<T extends TableRow>(
  rows: T[],
  startSrNo = 0,
): T[] {
  if (rows.length === 0) return rows;

  const hasAnySerial = rows.some((r) => {
    const n = Number(r.srNo);
    return Number.isFinite(n) && n > 0;
  });

  if (!hasAnySerial) {
    return rows;
  }

  // Dual-series interleave (1, 101, 2, 102…) — preserve printed Sr.No as-is.
  if (hasInterleavedDualSeries(rows)) {
    return rows;
  }

  if (serialsAreAlreadyContinuous(rows, startSrNo)) {
    return rows;
  }

  // Default: preserve PDF-printed serials (e.g. labour 90–172 after parts 1–100).
  // Only apply offset when the AI clearly restarted numbering at 1..5 per chunk.
  if (!looksLikeAiChunkRestart(rows, startSrNo)) {
    return rows;
  }

  // AI chunk restart — walk through and apply an offset each time serial resets.
  let offset = startSrNo;
  let prevOriginal = 0;
  let counter = startSrNo;

  for (const row of rows) {
    const orig = Number(row.srNo);
    const valid = Number.isFinite(orig) && orig > 0;

    if (valid) {
      if (orig <= prevOriginal) {
        offset = counter;
      }
      const assigned = orig + offset;
      (row as Record<string, unknown>).srNo = assigned;
      prevOriginal = orig;
      counter = assigned;
    } else {
      counter += 1;
      (row as Record<string, unknown>).srNo = counter;
      prevOriginal = counter - offset;
    }
  }

  return rows;
}
