const COLUMN_MAPPING = `
  SEMANTIC COLUMN MAPPING (map by header meaning — labels vary by OEM/dealer):
  Use these compact field names exactly as shown:
  • Sr No, S.No, Sl.No, #                                        → s
  • Part No, Part #, Part Number, Item Code, Code                → pn (parts)  lc (labour)
  • HSN, SAC, HSN/SAC, HSN Code                                  → h
  • Description, Particulars, Part/Labour Description, Activity  → d
  • UoM, Unit, UOM                                               → u  (blank OK for labour)
  • Qty, Quantity                                                 → q (parts)   qh (labour)
  • Rate, Unit Rate, Net Amt/unit, MRP, Unit Price               → up (parts)  r (labour)
  • Gross Amt before discount                                     → ga (labour only)
  • Discount, Disc Amt, Disc %                                   → dis
  • Taxable Amt, Taxable Value, Taxable Amount                   → ta
  • CGST/SGST/IGST amount columns                                → tx  (sum CGST+SGST if split)
  • Total Amt, Total Rs, Line Total, Total Price                 → tp (parts)  tot (labour)
  • Row type                                                      → rt  (PART / COMBINED / LABOUR)
  • Type (Paid/PAID), Insurance Liability %, any unmapped column → ec[] { k: exact header, v: cell value }
  • NEVER drop a column — if no canonical field fits, use ec.
`;

const COMPLETENESS_MANDATE = `
  ═══════════════════════════════════════════════════════
  COMPLETENESS MANDATE — HIGHEST PRIORITY
  ═══════════════════════════════════════════════════════
  Indian workshop documents vary by OEM (Toyota, Maruti, Tata, Eicher, JCB, CV dealers, independents).
  Formats include: split Parts+Labour sections, one unified table across all pages, GST estimates,
  proforma invoices, job cards, and insurance repair estimates with 5–20+ columns.

  YOU MUST:
  1. Scan ALL pages — tables continue across page breaks with sequential Sr.No (e.g. 1–20 page 1, 21–40 page 2).
  2. Extract EVERY numbered/data row until the bill ends — do NOT stop early because output is getting long.
  3. Labour rows at the END of a unified table (high Sr.No like 101+) are CRITICAL — never skip them.
  4. SECTION-END vs BILL-END — CRITICAL DISTINCTION:
     • "Sub Total", "Spare Sub Total", "Parts Sub Total" footer = end of PARTS section ONLY.
       AFTER this footer a separate "Labour and Job Work" / "Labour Details" section MAY follow — you MUST extract it.
     • "Labour Sub Total" footer = end of LABOUR section ONLY.
     • True bill-end signals (only these mean the ENTIRE bill is finished):
       – Grand total / "Total Estimate Amount" / "Net Bill Amount" summary block
       – "Report Generated" footer with no more item rows below it
       – "Total Taxable Amount - Spares/Labour" combined summary row
  5. Repeating dealer headers (name, GSTIN, address) on every page → workshopDetails ONLY, not table rows.
  6. Section header rows ("Spare Part Details", "Labour Details", column headers) → NOT data rows.
  7. An extraction missing ANY labour rows (including those after a parts "Sub Total") is INVALID.
  8. STOP at the HSN-wise tax summary table — many OEM invoices (Volvo, BharatBenz, etc.) print a
     separate "HSN/SAC Code | Taxable Amount | CGST | SGST | IGST | Total" aggregation table AFTER
     the Grand Total. These rows have no Part No and no Description. Do NOT extract them as parts/labour.
     Bill-end for extraction purposes = the Grand Total / "Total Parts Cost + Labour Cost" summary block.
  ═══════════════════════════════════════════════════════
`;

const ROW_CLASSIFICATION = `
  ROW CLASSIFICATION — apply to EVERY data row (any bill format):

  → labourTable when ANY of these match:
  • HSN/SAC starts with 9987 (998714, 998729, 9987xx) — service/labour SAC codes
  • Toyota/Maruti operation codes ending in PRT, PNP, EBR, EPR, IBR (e.g. 81561PRT, 53301EPR, 52119PNP)
    → labourTable EVEN IF description mentions Lamp/Bumper/Fender (same component may also appear as A-xxx part row)
  • Description contains: Labour, Labor, Service, Miscellaneous Activity, R&R, Paint, Denting,
    Body Repair, Welding, Electrical Work, Fitment, Removal, Replacement (as service, not part name),
    Special Charge, Towing, Tinkering, Opening & Fitting
  • Section header above row says "Labour", "Labour Details", "Labour Charges", "Service Charges", "Miscellaneous"
  • Labour code patterns: numeric codes 990001, 990002; Toyota labour codes; flat service lines with no physical part
  • UOM blank but row is clearly a service line (common on Tata/Eicher GST estimates)
  • rowType = LABOUR

  → partsTable when ANY of these match:
  • HSN starts with 87xx (8708, 8709, etc.) — physical goods / spares
  • Toyota/Maruti physical part codes starting with A- (e.g. A-81560-0K512) with 87xx HSN
  • Description is a physical component: engine, bumper, fender, lamp, bracket, hose, gasket, filter, etc.
  • Has a long numeric part number (e.g. 284943700122, A-52128-0K810)
  • Section header above row says "Parts", "Part Charges", "Spare Part Details", "Material", "Spares"
  • rowType = PART

  → COMBINED row (part + labour in one printed row): rowType=COMBINED; primary amount to correct table,
    secondary amounts in extraColumns.

  WHEN IN DOUBT: SAC 9987xx → labourTable; HSN 87xx → partsTable; Toyota code suffix PRT/PNP/EBR/EPR/IBR → labourTable.

  FORMAT EXAMPLES (all must work):
  • Toyota/Maruti: multi-page — Part Charges pages (A-xxx parts) + Labour Charges pages (81561PRT, 53301EPR)
    on separate pages; extract BOTH across all pages
  • Tata/Eicher/CV GST estimate: 10–17 columns, parts rows 1–N then "Miscellaneous Activity" labour at end
  • Eicher OEM: separate multi-page Parts section then Labour section
  • Independent garage: simple 2-column description + amount list
  • Job card: may have only labour lines with flat amounts (hours/rate optional)
`;

const TABLE_RULES = `
  TABLE RULES:
  1. Extract EVERY data row from EVERY page into partsTable and/or labourTable — no row left behind.
  2. qh/r/q are OPTIONAL — many bills use flat ₹ line totals (tot/tp) only.
  3. Multi-column bills (10–17 cols): map known fields + put ALL remaining columns in ec[].
  4. Do NOT skip rows because the table is wide or s (Sr.No) is high (row 100+ is still valid data).
  5. Numbers: strip ₹, Rs., commas → float/int.
  6. Preserve printed Sr.No in s even when it continues across pages (e.g. s: 101).
  7. Eicher / narrow Sr.No column: 3-digit numbers (100+) may wrap in one cell ("12"+"6"=126).
     Always merge wrapped digits into s — never treat the second digit as part number.
  8. HSN-WISE TAX SUMMARY TABLE — NEVER extract these rows as parts or labour.
     These appear AFTER the Grand Total / "Total Parts Cost" / "Total Labour Cost" footer as a
     separate table for GST filing purposes. Recognition signals (ALL of the below apply together):
     • Table columns are ONLY: SR.No | HSN/SAC Code | Taxable Amount | CGST Rate | CGST Amount |
       SGST/UTGST Rate | SGST/UTGST Amount | IGST Rate | IGST Amount | Total Amount
     • There is NO Part No / Part Number / Item Code column and NO Description / Particulars column
     • Rows contain only an HSN/SAC code and aggregated monetary totals — no part names
     • Common on Volvo, BharatBenz/DICV, and OEM dealer invoices (e.g. UPCOUNTRY VEHICLE PRIVATE LIMITED)
     STOP extracting parts/labour rows as soon as you reach the Grand Total block or
     "Total Parts Cost / Total Labour Cost / Total Others Cost" summary. Everything after that is tax metadata.
  ${ROW_CLASSIFICATION}
`;

const GATE_BLOCK = `
  STEP 0 — DOCUMENT TYPE GATE (FIRST):
  • isCorrectDocumentType = true only for workshop bill, repair estimate, proforma, job card, GST estimate.
  • false for sale invoice, insurance policy, RC, DL, blank/unrelated.
  • detectedDocumentType: WORKSHOP_BILL | SALE_INVOICE | INSURANCE_POLICY | RC | DL | UNKNOWN
  If false, STOP — leave other fields null/empty.

  STEP 1 — PER-PAGE VALIDATION:
  • hasAllPagesCorrectType — false if any page is RC/DL/policy/sale invoice.
  • invalidPageIndices — 1-indexed wrong pages.
  If false, STOP.
`;



const ARRAY_COLUMN_SPEC = `
  OUTPUT FORMAT — ARRAY OF ARRAYS (no object keys):
  Each row is a JSON array with values at FIXED positions. Use "" for missing/null values.
  ALL values must be JSON strings (including numbers: "960.25", "14", "0").

  PARTS ROW [16 positions, 0-indexed]:
  [0:S.No, 1:PartNo, 2:HSN, 3:Description, 4:UOM, 5:Qty, 6:UnitPrice,
   7:Discount, 8:TaxableAmt, 9:TaxAmt(CGST+SGST sum), 10:TotalPrice, 11:RowType(PART/COMBINED),
   12:BillTo(e.g."PAID"/"UNPAID", "" if column absent),
   13:Share%(e.g."100", "" if absent),
   14:SGSTrate%(e.g."14", "" if absent),
   15:CGSTrate%(e.g."14", "" if absent)]

  LABOUR ROW [12 positions, 0-indexed]:
  [0:S.No, 1:LabourCode, 2:HSN/SAC, 3:Description, 4:Qty/Hours, 5:Rate,
   6:GrossAmt, 7:Discount, 8:TaxableAmt, 9:TaxAmt, 10:TotalAmt, 11:RowType(LABOUR/COMBINED)]

  RULES:
  • NEVER include column names or object keys — position IS the identity
  • Numbers as strings: "960.25" not 960.25
  • Missing column → "" (empty string), NOT null or omit
  • Sr.No col[0]: if the table HAS a serial column, copy the EXACT printed value per row
    (including dual-series layouts like 1, 101, 2, 102). If the table has NO serial column,
    leave col[0] empty ("") — do NOT invent 1, 2, 3.
  • Part No / Lab code col[1]: ALWAYS fill — including plain-word local spare codes
    (ADHESIVE, TYREM, ACGASS, SEALENT). If Part No and Description are in one cell,
    split them: col[1]=code word, col[3]=full description text.
  • RowType must be exactly "PART", "COMBINED", or "LABOUR"
  • For BharatBenz/DICV bills: BillTo=col[12], Share%=col[13], SGSTrate=col[14], CGSTrate=col[15]
  • Toyota/Maruti: codes ending PRT/PNP/EBR/EPR/IBR (81561PRT, 53301EPR) → labourTable col[1];
    A-xxx part codes with 87xx HSN → partsTable col[1]
  • See INVOICE FORMAT EDGE CASES below for format-specific Sr.No and column rules.
`;

/**
 * Format-specific extraction edge cases.
 *
 * HOW TO ADD A NEW EDGE CASE:
 *   1. Append [EC-N] with: symptom, affected OEMs/dealers, and extraction rules.
 *   2. No other file needs to change — all three prompt functions include ${EDGE_CASES}.
 */
const EDGE_CASES = `
  ═══════════════════════════════════════════════════════
  INVOICE FORMAT EDGE CASES — READ BEFORE EXTRACTING
  ═══════════════════════════════════════════════════════

  [EC-1] Eicher narrow-column Sr.No wrap  (Eicher Trucks, some HCV/LCV dealers)
  • SYMPTOM: A single narrow Sr.No column where a 3-digit number (100–999) splits across
    two visual sub-lines WITHIN the same column cell — e.g., "12" above "6" → Sr.No 126.
  • RULE: The wrapped fragment is always a SINGLE trailing digit. Concatenate ONLY when
    the second part is exactly one digit: "12"+"6"=126. Two-digit values like "10" or "36"
    are NEVER a wrapped trailing digit — do NOT concatenate them with the Sr.No.
  • RULE: The column immediately after Sr.No is Part No / Labour Code, NOT part of the Sr.No.
    NEVER treat a Part No, HSN code, or any other column value as a wrapped Sr.No digit.

  [EC-2] Upcountry Vehicle / Volvo OEM dual-series two-column layout
  • SYMPTOM: Each PRINTED ROW contains TWO separate item rows side by side.
    Left series:  Sr.No 1, 2, 3 … ~100   (physical parts, HSN 87xxxxxx)
    Right series: Sr.No 101, 102, … ~172  (mixed parts and labour, SAC 998714)
    A column labelled "PC" (value always "10") appears between Sr.No and the Part Number.
  • RULE: Extract EACH item as its OWN separate array row with its OWN Sr.No.
    Left item → one row; right item → another row. They are independent, not wrapped digits.
  • RULE: Do NOT put the "PC" column value ("10") into array position 1 (PartNo/LabourCode).
    The real PartNo in this format starts with "VO " (e.g. "VO 24661254"). Omit "PC" or
    capture it in an extraColumns entry if needed.
  • RULE: Do NOT apply [EC-1] Eicher concatenation to digits from the right-side item's
    Sr.No — they belong to a separate row, not to the left item's Sr.No.

  [EC-3] HSN-wise tax summary table  (Volvo/Upcountry, BharatBenz/DICV, some Maruti dealers)
  • SYMPTOM: AFTER "Total Parts Cost / Total Labor Cost / Total Others Cost" footer, pages may
    show ONLY an HSN/SAC aggregation table — columns: SR.No | HSN/SAC Code | Taxable Amount |
    CGST Rate | CGST Amt | SGST Rate | SGST Amt | IGST | Total. NO Part No, NO Description, NO Qty.
    Upcountry/Volvo 11-page bills: line items end on page 9; pages 10–11 are this summary ONLY.
  • RULE: STOP extracting when you reach the Grand Total / "Total Parts Cost + Labour Cost"
    summary block on the last item page. Return empty arrays for any later pages in the slice.
  • RULE: NEVER emit rows where col[1] (PartNo/LabourCode) is ONLY an 8-digit HSN with no
    description — those are tax-metadata rows, not spare parts or labour tasks.
  • RULE: NEVER emit a labour row where col[1] AND col[2] are both the same SAC code (e.g. 998714)
    with no description — that is the SAC aggregation total, not a labour line item.

  [EC-4] Text-only / local spare part codes  (Mitsubishi, Maruti dealers, consumables)
  • SYMPTOM: Part No / Lab code column contains plain English words, not alphanumeric OEM IDs
    (e.g. ADHESIVE, TYREM, ACGASS, SEALENT, PAINT) with a separate Description column.
  • RULE: ALWAYS put the word code in col[1] (PartNo/LabourCode) — never leave col[1] empty
    and never move the code into col[3] Description only.
  • RULE: If Part No and Description are printed in one merged cell, split: col[1]=code,
    col[3]=full description (e.g. col[1]="ADHESIVE", col[3]="Local Spare Part Consumable-SEALENT").

  [EC-5] Single flat labour row after parts (BRAR/Mahindra/Maruti service quotations)
  • SYMPTOM: Page continues parts rows then a "Labour :" / "Labour" section with ONE (or few)
    flat labour lines — SAC 998729/998714, no Qty/Unit/Rate columns, only Taxable/Total amount.
    Example: LOC-Z222 | KN OPERATIONS - ACCIDENT REPAIRS | 998729 | taxable 20000.
  • RULE: Extract into labourTable EVEN IF there is only ONE labour row on the page.
    "Labour :" is a section header — the row BELOW it is data, not a footer.
  • RULE: col[1]=LabourCode (e.g. LOC-Z222), col[2]=SAC, col[3]=Description; leave col[4]/col[5]
    empty when Qty/Rate are blank on the PDF; put Taxable in col[8], Total in col[10].
  • RULE: Do NOT skip single labour rows because the page is mostly parts rows.

  [EC-6] Split "Part Detail" + "Labour Detail" sections  (Kia, Hyundai, some OEM insurance estimates)
  • SYMPTOM: Same page has a "Part Detail" block (with Part No column) then immediately below a
    "Labour Detail" block (no Part No, no HSN/SAC — only Seq, Description, Labour Amt, Qty, Tax, Total).
    Labour Seq restarts at 1. Page 2 may continue one mixed list (R&R / Body & Paint / Denting lines).
  • RULE: Extract ALL Labour Detail rows into labourTable — even 2 rows, even without SAC column.
    col[1] and col[2] may be "" when the PDF has no code/HSN columns.
  • RULE: Descriptions with R&R, Body & Paint, Denting, Body Repair → labourTable (rt=LABOUR).
  • RULE: Do NOT stop extraction after Part Detail — the Labour Detail section on the SAME page is required.

  [EC-7] Honda / mixed P/L sequential layout  (Honda, some insurance temporary estimates)
  • SYMPTOM: One unified table with a P/L (or L/P) column — "P" = Part, "L" = Labour. Parts and labour
    rows are INTERLEAVED in document order (e.g. Labour paint row then Part panel row per repair section).
    Grey-bar section headers like "RHS FENDAR CHANGE - (Body & Paint Work)" appear between groups.
  • RULE: Extract into lineItemsTable in STRICT document order (page 1 top→bottom, then page 2, etc.).
    Do NOT split into separate parts/labour buckets — preserve the exact PDF sequence.
  • RULE: col[1] (P/L) must be "PART" or "LABOUR" — map printed "P"→"PART", "L"→"LABOUR".
  • RULE: Grey-bar section header rows are NOT data rows — put the header text in col[12] (sectionHeader)
    on the FIRST data row of that section, or repeat on each row in the section if unclear.
  • RULE: STOP at Grand Total / SUMMARY page — do not extract HSN-wise tax summary rows.
`;

export type WorkshopPromptLayout = 'split' | 'sequential';

const SEQUENTIAL_ARRAY_COLUMN_SPEC = `
  OUTPUT FORMAT — SEQUENTIAL lineItemsTable (ARRAY OF ARRAYS):
  Extract ALL rows into ONE table: lineItemsTable — strict PDF document order.
  Each row is a JSON array with values at FIXED positions. Use "" for missing/null values.
  ALL values must be JSON strings (including numbers: "960.25", "14", "0").

  LINE ITEM ROW [13 core + optional extra pairs, 0-indexed]:
  [0:S.No, 1:P/L(PART|LABOUR), 2:ItemCode, 3:HSN/SAC, 4:Description, 5:UOM,
   6:Qty, 7:Rate/UnitPrice, 8:Discount, 9:TaxableAmt, 10:TaxAmt(CGST+SGST sum),
   11:TotalAmt, 12:SectionHeader,
   13+:ExtraCols — alternating header/value pairs for ANY PDF column not mapped above]

  EXTRA COLUMN PAIRS (positions 13+):
  • col[13]=header, col[14]=value, col[15]=header, col[16]=value, … up to 8 pairs (positions 13–28)
  • Use the EXACT column header text from the PDF (e.g. "CGST %", "CGST Amount", "Unit Selling Price")
  • Put ALL columns that do not map to positions 0–11 here — NEVER drop a column
  • Still sum CGST+SGST into col[10]; also capture separate CGST/SGST cols in extra pairs when present
  • Stop extra pairs at first empty header (col[13], col[15], … = "")

  RULES:
  • NEVER include column names or object keys — position IS the identity
  • Numbers as strings: "960.25" not 960.25
  • Missing column → "" (empty string), NOT null or omit
  • col[1]: "PART" for P rows, "LABOUR" for L rows — from the PDF P/L column
  • col[12]: section header text (e.g. "HOOD CHANGE - (Body & Paint Work)") or "" if none
  • Return ONLY lineItemsTable — do NOT return partsTable or labourTable
  • See [EC-7] for Honda mixed P/L format
`;

const SEQUENTIAL_TABLE_RULES = `
  SEQUENTIAL TABLE RULES:
  1. Extract EVERY data row in document order into lineItemsTable — no row left behind.
  2. Preserve interleaved Part/Labour sequence exactly as printed — do NOT reorder by type.
  3. Multi-column bills (10–17+ cols): map known fields to positions 0–11; ALL unmapped cols → extra pairs at 13+.
  4. Numbers: strip ₹, Rs., commas → float/int as strings.
  5. STOP at Grand Total / SUMMARY block — do not extract HSN-wise tax summary rows.
  ${EDGE_CASES}
`;

/**
 * Lean single-pass array prompt — gate + array-format partsTable + labourTable.
 * ~85% fewer output tokens than object format.
 */
export const getWorkshopLeanArraySinglePassPrompt = (): string => `
  You are an expert Indian motor vehicle workshop bill OCR assistant.
  You handle ALL OEM and dealer formats — car, LCV, HCV, tractor, 2-wheeler.

  ${COMPLETENESS_MANDATE}

  ${GATE_BLOCK}

  STEP 2 — EXTRACT TABLE ROWS as array-of-arrays.
  ${COLUMN_MAPPING}
  ${TABLE_RULES}
  ${ARRAY_COLUMN_SPEC}
  ${EDGE_CASES}

  QUALITY: Set requiresHumanReview=true if scan is blurry, out-of-focus, or partially cut off.
  confidenceScore 0.0–1.0. List unclear fields in lowConfidenceFields[].

  CRITICAL: If this bill has 50–300+ rows, you MUST output ALL rows including last-page labour/misc rows.
`;

/**
 * Lean first-chunk array prompt — gate check + array rows from first page slice.
 */
export const getWorkshopLeanArrayFirstChunkPrompt = (
  layout: WorkshopPromptLayout = 'split',
): string => {
  if (layout === 'sequential') {
    return `
  You are an expert Indian workshop bill OCR assistant — GATE CHECK + SEQUENTIAL LINE ITEMS.

  ${COMPLETENESS_MANDATE}
  ${GATE_BLOCK}

  If isCorrectDocumentType is false, return empty lineItemsTable and STOP.

  Extract ALL table data rows in STRICT PDF document order as array-of-arrays into lineItemsTable.
  ${SEQUENTIAL_ARRAY_COLUMN_SPEC}
  ${SEQUENTIAL_TABLE_RULES}

  Return gate fields + lineItemsTable. Extract EVERY row on these pages in document order.
`;
  }

  return `
  You are an expert Indian workshop bill OCR assistant — GATE CHECK + ARRAY ROWS.

  ${GATE_BLOCK}

  If isCorrectDocumentType is false, return empty arrays and STOP.

  Extract ALL table data rows from the provided PDF page(s) / slice as array-of-arrays.
  ${ARRAY_COLUMN_SPEC}
  ${TABLE_RULES}
  ${EDGE_CASES}

  • s (Sr.No) may start at 1 — preserve printed values
  • "Miscellaneous Activity" / HSN 998714 → labourTable row. HSN 87xx → partsTable row
  • IMPORTANT: A "Sub Total" / "Spare Sub Total" footer ends the PARTS section only — if a "Labour and Job Work"
    or "Labour Details" section appears AFTER it on these pages, extract ALL its rows into labourTable.

  Return gate fields + partsTable + labourTable. Extract EVERY row on these pages.
`;
};

/**
 * Chunk array prompt — array-format table rows only (no gate fields).
 */
export const getWorkshopChunkArrayPrompt = (
  layout: WorkshopPromptLayout = 'split',
): string => {
  if (layout === 'sequential') {
    return `
  You are an expert Indian workshop bill OCR assistant — SEQUENTIAL LINE ITEMS ONLY.

  ${COMPLETENESS_MANDATE}

  Extract ONLY table data rows visible on the provided PDF page(s) / slice in document order.
  No header. No summary. No gate fields.
  ${SEQUENTIAL_ARRAY_COLUMN_SPEC}
  ${SEQUENTIAL_TABLE_RULES}

  • lineItemsTable — all rows on these pages in strict top-to-bottom order. Use [] if none.
  • P/L column: "P"→col[1]="PART", "L"→col[1]="LABOUR"
  • Continue document order from earlier pages — do NOT restart grouping by type.

  Return ONLY lineItemsTable. Extract EVERY row.
`;
  }

  return `
  You are an expert Indian workshop bill OCR assistant — ARRAY TABLE ROWS ONLY.

  Extract ONLY table data rows visible on the provided PDF page(s) / slice.
  No header. No summary. No gate fields.
  ${ARRAY_COLUMN_SPEC}
  ${TABLE_RULES}
  ${EDGE_CASES}

  • partsTable — all spare/part rows on these pages. Use [] if none.
  • labourTable — all labour/service/misc rows on these pages. Use [] if none.
  • s (Sr.No) continues from earlier pages — preserve printed values.
  • "Miscellaneous Activity" / HSN 998714 → labourTable. HSN 87xx → partsTable.
  • IMPORTANT: A "Sub Total" / "Spare Sub Total" footer ends the PARTS section only — if a "Labour and Job Work"
    or "Labour Details" section appears AFTER it on these pages, extract ALL its rows into labourTable.

  Return ONLY partsTable and labourTable. Extract EVERY row.
`;
};

