import { hasLabourChargesColumn, type ColumnsOnlyTable } from '../schema/workshop/workshop-bill.shared.js';

const COMPLETENESS_MANDATE = `
  ═══════════════════════════════════════════════════════
  COMPLETENESS MANDATE — HIGHEST PRIORITY
  ═══════════════════════════════════════════════════════
  Indian workshop documents vary by OEM (Toyota, Maruti, Tata, Eicher, JCB, CV dealers, independents).
  Formats include: split Parts+Labour sections, one unified P/L table, GST estimates, proforma invoices,
  job cards, and insurance repair estimates with 5–20+ columns.

  YOU MUST:
  1. Scan ALL pages — tables continue across page breaks with sequential Sr.No.
  2. Extract EVERY numbered/data row until the bill ends — do NOT stop early.
  3. Labour rows at the END of a bill (after parts subtotal) are CRITICAL — always extract them.
  4. "Sub Total" / "Spare Sub Total" = end of PARTS section ONLY — Labour section may follow.
  5. STOP at Grand Total / HSN-wise tax summary — do NOT extract tax aggregation rows as line items.
  6. Gate Pass / Terms & Conditions / release slip pages → no table rows, but valid package pages.
`;

const GATE_BLOCK = `
  STEP 0 — DOCUMENT TYPE GATE (FIRST):
  • isCorrectDocumentType = true only for workshop bill, repair estimate, proforma, job card, GST estimate.
  • false for sale invoice, insurance policy, RC, DL, blank/unrelated.
  • hasAllPagesCorrectType = true when all pages belong to the same workshop job package.
  If isCorrectDocumentType is false, return empty columns and STOP.
`;

const WIDE_TABLE_RULE = `
  WIDE TABLE RULE (Honda/Toyota insurance estimates, 18–21 columns):
  • Count EVERY header cell — CGST %, CGST Amt, SGST %, SGST Amt are FOUR separate columns, never merge.
  • columns.length must equal every data row cell count exactly.
  • Never drop trailing tax columns on later pages.
`;

const ROW_CLASSIFICATION = `
  OUTPUT SHAPE — ALWAYS THE SAME (regardless of PDF design):
  • Final output always has parts + labour tables (lineItems is internal routing only).
  • columns = EXACT PDF header strings in order; section = EXACT short PDF title — NEVER a description.

  billShape = "split" (SHAPE A) — separate Parts + Labour sections (Eicher, Tata, Maruti, Kia):
    → parts.columns from Parts section; labour.columns from Labour section (empty if not on page 1)
    → rows pass: parts.rows from Parts, labour.rows from Labour
    → split_independent: "Part Detail" + "Labour Detail" — parts.columns and labour.columns are SEPARATE lists (labour often has no Part No / OP Code column)
    → split_shared_header: Kia invoice same-page — Parts + Labour share ONE header row, parts.columns = labour.columns = same list

  billShape = "pl_unified" (SHAPE B) — Honda-style P/L column, interleaved rows:
    → parts.columns AND labour.columns = SAME full PDF header list (including P/L as first column)
    → rows pass: put ALL interleaved rows in lineItems.rows (code splits P→parts, L→labour later)

  billShape = "unified_no_pl" (SHAPE C) — one table, no P/L column (NIC estimation):
    → parts.columns only; all rows → parts.rows; labour.columns = []
`;

const EDGE_CASES = `
  EDGE CASES:
  • Eicher Sr.No wrap: "12"+"6" in one cell → 126 (single trailing digit only)
  • Dual-column Volvo/Upcountry: each side item is its own row
  • HSN summary after Grand Total: STOP — not line items
  • Labour section on last page only: leave labour.columns empty in meta; rows pass will discover it
  • Honda wide table (18–21 cols): CGST %, CGST Amt, SGST %, SGST Amt = 4 separate columns
  • Bold section headers in table (e.g. "FRONT DOOR REPAIR PAINT"): skip row; MUST extract next data row
  • P/L interleaved rows: do NOT stop after parts block — extract all L rows too
  • Labour table continues across page breaks with sequential Sr.No. — extract ALL continuation rows on every page
  • Page 2+ may have labour rows only (no parts) — still extract into labour.rows
  • Last page summary only: no table rows; totals go to summary (Part Amt, Labour Amt, Grand Total)

  EDGE CASE 1 — split_independent (Dhoot/Hyundai/Kumbhat):
  • Part Detail → parts.columns (Part Description, Part No, Part Amt, …)
  • Labour Detail → labour.columns (Labour Description, Labour Amt, …) — NEVER copy Part Description / Part Amt
  • parts.rows width = parts.columns.length; labour.rows width = labour.columns.length

  EDGE CASE 2 — split_shared_header (Maruti/Kia):
  • ONE shared header row → parts.columns = labour.columns (same list)
  • Parts rows: amount in Taxable Amount; Labour Charges = 0.00
  • Labour rows: amount in Labour Charges column (last col); may be on page 2
`;

function formatColumnsBlock(label: string, table: ColumnsOnlyTable | undefined): string {
  const cols = table?.columns ?? [];
  const section = table?.section ? ` (section: "${table.section}")` : '';
  if (!cols.length) {
    return `  ${label}: not yet known — if this section appears on these pages, return columns once + rows`;
  }
  return `  ${label}${section}: ${JSON.stringify(cols)} — each row MUST have exactly ${cols.length} values`;
}

/** Pass 1 — page 1 (+ last page when multi-page): gate, details, summary, column headers. NO rows. */
export const getWorkshopMetaPrompt = (pageCount = 1): string => `
  You are an expert Indian motor vehicle workshop bill OCR assistant — META PASS ONLY.

  ${GATE_BLOCK}
  ${ROW_CLASSIFICATION}
  ${WIDE_TABLE_RULE}

  You are shown page 1${pageCount > 1 ? ` and page ${pageCount} (last page)` : ''}.

  Extract:
  • Gate fields (document type check)
  • workshopDetails (name, GSTIN, invoice no, vehicle no, job card, customer, etc.) — from page 1
  • summary (grandTotal, partsSubTotal, labourSubTotal):
      - from billing page if visible (look for "Part Sub Total", "Labor Sub Total", "Labour Sub Total", "Grand Total")
      - from page 1 or LAST page — MUST extract "Part Amt" / "Labour Amt" footer lines when present
      - Maruti dealer unified table: extract "Taxable Amount" subtotal → partsSubTotal AND "Labour Charges" subtotal → labourSubTotal from last page summary block
  • billShape (split | pl_unified | unified_no_pl)
  • parts.section + parts.columns — EXACT verbatim PDF header strings from the Parts section (never simplify: use "Part/OP code" not "Part No")
  • labour.section + labour.columns — EXACT section title + headers when labour block is visible on page 1, else []
      - ALWAYS set labour.section when "Labour Detail", "Labour and Services", "Labour Invoice", or similar is visible
      - for split_independent (Part Detail + Labour Detail): labour.columns = EXACT headers from Labour section — "Labour Description", "Labour Amt"; never Part Description / Part Amt
      - for pl_unified: labour.columns = same list as parts.columns (including P/L)
      - for split_shared_header (Kia invoice same-page): parts.columns = labour.columns = EXACT same shared header row
      - for split Maruti/Eicher separate sections: parts.columns and labour.columns are INDEPENDENT lists from each section's own headers
  • lineItems.section + lineItems.columns — only for billShape=pl_unified (same headers as parts)

  COLUMN RULE: Copy header text character-for-character from the PDF. Never rename, abbreviate, or merge columns.

  CRITICAL: Do NOT extract any table data rows. columns arrays only. rows are forbidden.
  ${EDGE_CASES}
`;

export type WorkshopMetaForRows = {
  billShape?: string;
  parts?: ColumnsOnlyTable;
  labour?: ColumnsOnlyTable;
  lineItems?: ColumnsOnlyTable;
};

/** Pass 2 — per chunk: rows only; columns provided in prompt. */
export const getWorkshopRowsChunkPrompt = (meta: WorkshopMetaForRows): string => {
  const shape = meta.billShape ?? 'split';
  const partsBlock = formatColumnsBlock('parts', meta.parts);
  const labourBlock = formatColumnsBlock('labour', meta.labour);
  const lineItemsBlock = formatColumnsBlock('lineItems', meta.lineItems);

  const plUnifiedRules = shape === 'pl_unified'
    ? `
  PL_UNIFIED ROWS:
  • Put ALL interleaved P and L rows into lineItems.rows only (parts.rows and labour.rows = [])
  • First column is P/L — values are "P" or "L"
  • Each row MUST have exactly ${meta.lineItems?.columns?.length ?? meta.parts?.columns?.length ?? 'N'} values — never drop trailing tax columns
`
    : '';

  const splitShapeRules = shape === 'split'
    ? `
  SPLIT ROWS — follow EDGE CASE 1 (independent) or EDGE CASE 2 (shared-header) above:
  • parts.rows = ALL part rows; labour.rows = ALL labour rows on these pages — mandatory
  • Output parts.rows and labour.rows separately — never mix sections
  • Each row length MUST equal its section column count exactly
  • Do NOT stop after parts block — labour on same or later pages is required
  • Section title rows ("Part Detail...", "Labour Detail...") are NOT data rows
`
    : '';

  return `
  You are an expert Indian workshop bill OCR assistant — ROWS ONLY.

  ${COMPLETENESS_MANDATE}
  ${WIDE_TABLE_RULE}
  ${EDGE_CASES}

  billShape: ${shape}
${plUnifiedRules}${splitShapeRules}
  KNOWN COLUMNS (do NOT repeat in output — output rows only):
${partsBlock}
${labourBlock}
${lineItemsBlock}

  RULES:
  • Output ONLY parts.rows, labour.rows, lineItems.rows as string[][]
  • Each row = values in column order; use "" for empty cells
  • row.length MUST equal columns.length on every row — never truncate
  • Match column count exactly when columns are known above
  • If a section first appears here with unknown columns: return section + columns once AND rows
  • NEVER output column names inside each row
  • Extract EVERY data row on these pages; use [] if none for a section
  • Skip bold section header rows (no numeric data) but extract the data rows that follow
`;
};

/** Labour-only retry when split bill returned parts but no labour rows. */
export const getWorkshopLabourRetryPrompt = (meta: WorkshopMetaForRows): string => {
  const colCount = Math.max(meta.parts?.columns?.length ?? 0, meta.labour?.columns?.length ?? 0);
  const authoritativeCols = (meta.parts?.columns?.length ?? 0) >= (meta.labour?.columns?.length ?? 0)
    ? meta.parts?.columns
    : meta.labour?.columns;
  const labourBlock = formatColumnsBlock('labour', meta.labour);
  const sharedCols = authoritativeCols?.length
    ? `\n  Shared PDF headers (use for every labour row): ${JSON.stringify(authoritativeCols)}`
    : '';
  const marutiSharedRules = hasLabourChargesColumn(meta.parts?.columns ?? [])
    ? `
  Maruti shared-header: labour.rows MUST use the SAME ${colCount} columns as parts.
  Each row = exactly ${colCount} values. Amount in "Labour Charges" (last column).
  Part Number (col 2) = codes like ZF9993, ZF9992. Never use "-".
`
    : '';

  return `
  You are an expert Indian workshop bill OCR assistant — LABOUR ROWS ONLY (retry).

  ${COMPLETENESS_MANDATE}

  A prior pass extracted parts but MISSED labour rows. Extract labour ONLY on these pages.

  billShape: split (Kia / Maruti style)
${labourBlock}${sharedCols}${marutiSharedRules}

  RULES:
  • Output labour.rows ONLY — parts.rows MUST be []
  • Find "Labour", "Labour and Services", "Labour Invoice", or "Labour Detail" section below the parts block
  • Maruti dealer: rows with amount in "Labour Charges" column (not Taxable Amount)
  • Extract EVERY labour data row; section title rows are NOT data rows
  • Each row MUST have exactly ${colCount || 'N'} values — use shared PDF headers above
  • If sections share one header row, match parts.columns cell-for-cell
`;
};
