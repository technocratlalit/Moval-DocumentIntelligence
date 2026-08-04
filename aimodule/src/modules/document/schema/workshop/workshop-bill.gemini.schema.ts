import { Schema, Type } from '@google/genai';

const documentGateProps: Record<string, Schema> = {
  isCorrectDocumentType: {
    type: Type.BOOLEAN,
    description:
      'Set true ONLY for workshop bill, repair estimate, proforma, or job card. ' +
      'False for sale invoice, insurance policy, RC, DL, or unrelated documents.',
  },
  detectedDocumentType: {
    type: Type.STRING,
    nullable: true,
    description: 'WORKSHOP_BILL | SALE_INVOICE | INSURANCE_POLICY | RC | DL | UNKNOWN',
  },
  hasAllPagesCorrectType: {
    type: Type.BOOLEAN,
    description:
      'True when every page belongs to the same workshop job package — billing pages plus ancillary ' +
      'pages (Gate Pass, release slip) from the same RO/reg/workshop visit are valid.',
  },
  invalidPageIndices: {
    type: Type.ARRAY,
    nullable: true,
    description:
      '1-indexed pages that are truly unrelated (RC, DL, policy, different vehicle/job). ' +
      'Do NOT list Gate Pass or release slip from the same visit.',
    items: { type: Type.NUMBER },
  },
  confidenceScore: {
    type: Type.NUMBER,
    description: 'Overall confidence 0.0–1.0.',
  },
  requiresHumanReview: {
    type: Type.BOOLEAN,
    description: 'True if blurry, incomplete, handwritten, or totals do not reconcile.',
  },
};

const workshopDetailsSchema: Schema = {
  type: Type.OBJECT,
  nullable: true,
  properties: {
    name: { type: Type.STRING, nullable: true },
    gstin: { type: Type.STRING, nullable: true },
    invoiceNumber: { type: Type.STRING, nullable: true },
    invoiceDate: { type: Type.STRING, nullable: true },
    vehicleNumber: { type: Type.STRING, nullable: true },
    documentTitle: { type: Type.STRING, nullable: true },
    jobCardNumber: { type: Type.STRING, nullable: true },
    customerName: { type: Type.STRING, nullable: true },
    odometerReading: { type: Type.STRING, nullable: true },
  },
};

const summarySchema: Schema = {
  type: Type.OBJECT,
  nullable: true,
  properties: {
    grandTotal: { type: Type.NUMBER, nullable: true, description: 'Net bill amount / Grand Total as printed' },
    partsSubTotal: { type: Type.NUMBER, nullable: true, description: 'Spare parts subtotal (with tax if printed that way)' },
    labourSubTotal: { type: Type.NUMBER, nullable: true, description: 'Labour subtotal (with tax if printed that way)' },
  },
};

const arrayRow: Schema = {
  type: Type.ARRAY,
  items: { type: Type.STRING },
};

const columnsOnlyTableSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    section: {
      type: Type.STRING,
      nullable: true,
      description: 'EXACT short PDF section title (e.g. "Spare Part Details")',
    },
    columns: {
      type: Type.ARRAY,
      description:
        'EXACT PDF header strings in column order — count every cell (CGST % and CGST Amt are separate). NO rows.',
      items: { type: Type.STRING },
    },
  },
};

const rowsOnlyTableSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    rows: {
      type: Type.ARRAY,
      description: 'Data rows as string arrays — one value per column in order given in prompt',
      items: arrayRow,
    },
    section: {
      type: Type.STRING,
      nullable: true,
      description: 'Only when this section first appears on this chunk and was unknown in meta pass',
    },
    columns: {
      type: Type.ARRAY,
      nullable: true,
      description: 'Only when section headers first seen on this chunk (e.g. Labour on page 9)',
      items: { type: Type.STRING },
    },
  },
  required: ['rows'],
};

const gateRequired = [
  'isCorrectDocumentType',
  'detectedDocumentType',
  'hasAllPagesCorrectType',
  'confidenceScore',
  'requiresHumanReview',
];

/** Pass 1 — meta only: gate + details + summary + column headers (no rows). */
export const WorkshopMetaSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    ...documentGateProps,
    workshopDetails: workshopDetailsSchema,
    summary: summarySchema,
    billShape: {
      type: Type.STRING,
      description:
        'split = separate Parts+Labour sections | pl_unified = P/L column (parts.columns = labour.columns = full headers) | unified_no_pl = one table, no P/L',
    },
    parts: columnsOnlyTableSchema,
    labour: columnsOnlyTableSchema,
    lineItems: {
      ...columnsOnlyTableSchema,
      nullable: true,
      description: 'Internal routing for pl_unified rows pass only — not in final API output',
    },
  },
  required: gateRequired,
};

/** Pass 2 — rows only per chunk; columns injected via prompt. */
export const WorkshopRowsOnlySchema: Schema = {
  type: Type.OBJECT,
  properties: {
    parts: rowsOnlyTableSchema,
    labour: rowsOnlyTableSchema,
    lineItems: {
      ...rowsOnlyTableSchema,
      nullable: true,
      description: 'Internal routing for pl_unified — all interleaved rows here; code splits into parts/labour',
    },
  },
};
