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
        'Reuse the same headers on continuation pages even if headers are not reprinted. ' +
        'Do not invent, rename, or drop columns. For nested tax headers (e.g. CGST Rate / CGST Amt), ' +
        'use the leaf labels as separate column names.',
    ),
  rows: z
    .array(z.array(z.string()))
    .describe(
      'One inner array per printed table row; cell[i] matches columns[i]. ' +
        'Keep values exactly as printed (including commas and decimals). Use "" for blank cells. ' +
        'Include unpriced detail/continuation rows under a parent (e.g. same code BODREP99 with ' +
        'description "- RIM REPLACE" and blank SAC/QTY/price) — do not drop them. ' +
        'When a cell wraps across lines in the PDF, join with a single space — never use HTML ' +
        '(no <br>, <br/>, or entities).',
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
    .describe('Invoice, estimate, or job-card number if printed'),
  vehicleNumber: z
    .string()
    .nullable()
    .describe(
      'Vehicle registration / Regn. / Reg. No. if printed anywhere on the bill ' +
        '(header, order block, or first table info row such as "Reg. No : JH-10CS-2856"). ' +
        'Return the plate value only (e.g. JH-10CS-2856).',
    ),
  lineItems: LlamaDynamicTableSchema.describe(
    'ONE combined table of ALL line items from EVERY page of the PDF, in document order. ' +
      'Include both spare-parts/material rows AND labour/service rows when they share the same ' +
      'printed Lab/Part table (interleaved serial numbers are normal — do not skip either group). ' +
      'Include unpriced detail/sub-description rows under a parent line. ' +
      'Do not split into parts vs labour here. Do not omit rows. Do not stop early. ' +
      'Skip only section title rows (Labour Charges / Part Charges), pure totals/grand-total ' +
      'summary rows, and HSN tax-summary tables at the end. ' +
      'Optional vehicle-info banner rows (Ste/Door/KMR/Reg. No.) may be included if present.',
  ),
  grandTotal: z
    .number()
    .nullable()
    .describe('Final payable / grand total / total invoice value if printed; null if absent'),
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
    !lineItems?.properties?.rows
  ) {
    throw new Error('llamaWorkshopJsonSchema missing lineItems columns+rows object shape');
  }
}
