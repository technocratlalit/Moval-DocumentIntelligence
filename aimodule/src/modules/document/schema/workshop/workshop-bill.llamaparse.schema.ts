import { z } from 'zod';

/**
 * PDF-exact dynamic table for LlamaExtract.
 * columns = printed headers; rows = cell arrays aligned to those headers.
 */
const LlamaDynamicTableSchema = z.object({
  columns: z
    .array(z.string())
    .describe(
      'Exact table column headers as printed on the PDF (usually page 1). ' +
        'Reuse the SAME headers on EVERY continuation page even if headers are not reprinted — ' +
        'page break is not a new section. Include P/L and/or Type columns when printed. ' +
        'Do not invent, rename, or drop columns. Nested tax headers → leaf labels as separate columns. ' +
        'Keep quantity/UOM columns as printed (do not force integers).',
    ),
  rows: z
    .array(z.array(z.string()))
    .describe(
      'One inner array per printed table/billing row; cell[i] matches columns[i]. ' +
        'Keep values exactly as printed (commas, decimals). Use "" for blank. Keep zero-amount rows. ' +
        'Include section titles (Part Details, Labour Charges, Labour and Services, Spare Part Details, ' +
        'Miscellaneous, Undefined Parts, etc.), Body & Paint / repair-group banners, and ' +
        'unpriced detail rows (e.g. BODREP99 "- RIM REPLACE"). Include P and L marker cells. ' +
        'Merge wrapped description lines into one cell with a space — never HTML (<br/>). ' +
        'Do not omit rows. Do not stop early across pages.',
    ),
});

export const LlamaWorkshopExtractSchema = z.object({
  workshopName: z
    .string()
    .nullable()
    .describe('Workshop, dealer, or garage name from the header'),
  invoiceNumber: z
    .string()
    .nullable()
    .describe('Invoice, estimate, RO, or job-card number if printed'),
  vehicleNumber: z
    .string()
    .nullable()
    .describe(
      'Vehicle registration / Regn. / Reg. No. / Veh. Reg. No. if printed ' +
        '(header or info block). Return the plate value only (e.g. JH-10CS-2856 or CG04NK1946).',
    ),
  documentTitle: z
    .string()
    .nullable()
    .describe(
      'Printed document title if present (e.g. TEMPORARY ESTIMATE, Tax Invoice, ' +
        'Supplementary Estimate, Quotation, Insurance Temporary Estimate).',
    ),
  lineItems: LlamaDynamicTableSchema.describe(
    'ONE combined table of ALL billing/line rows from EVERY page, in document order. ' +
      'Include parts and labour/service rows (interleaved P/L or serials are normal). ' +
      'Include section banners and repair-group banners. Include Misc / Undefined Parts rows. ' +
      'Include "not included / excluded" estimate notes as rows if they appear in the table area. ' +
      'Do not split parts vs labour here. Skip ONLY: terms & conditions, signatures, gate pass, ' +
      'feedback forms, payment/parking policy blocks, and pure end-of-doc tax-summary grids that ' +
      'are not line items.',
  ),
  partsTotal: z
    .number()
    .nullable()
    .describe(
      'Document summary Parts total / Total Parts Amt / Final Parts Invoice Amount if printed; null if absent',
    ),
  labourTotal: z
    .number()
    .nullable()
    .describe(
      'Document summary Labour total / Total Labor Amt / Final Labour Invoice Amount if printed; null if absent',
    ),
  grandTotal: z
    .number()
    .nullable()
    .describe('Final payable / grand total / Total Amount with Tax if printed; null if absent'),
});

export type LlamaWorkshopExtract = z.infer<typeof LlamaWorkshopExtractSchema>;

/** JSON Schema for LlamaCloud extract.create data_schema (strip Zod extras) */
const rawJsonSchema = z.toJSONSchema(LlamaWorkshopExtractSchema) as Record<string, unknown>;
const { $schema: _schema, ...rest } = rawJsonSchema;
export const llamaWorkshopJsonSchema: Record<string, unknown> = rest;

// ponytail: self-check — fails import if schema shape breaks
{
  const props = (llamaWorkshopJsonSchema as { properties?: Record<string, unknown> }).properties;
  const lineItems = props?.lineItems as { properties?: Record<string, unknown>; type?: string } | undefined;
  if (
    (llamaWorkshopJsonSchema as { type?: string }).type !== 'object' ||
    lineItems?.type !== 'object' ||
    !lineItems?.properties?.columns ||
    !lineItems?.properties?.rows ||
    !props?.partsTotal ||
    !props?.labourTotal ||
    !props?.documentTitle
  ) {
    throw new Error('llamaWorkshopJsonSchema missing required workshop extract fields');
  }
}
