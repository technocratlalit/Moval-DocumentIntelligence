import { z } from 'zod';
import {
  ExtraFieldSchema,
  WorkshopDetailsSchema,
  WorkshopDocumentGateSchema,
  WorkshopLabourRowSchema,
  WorkshopLineItemRowSchema,
  WorkshopPartsRowSchema,
  WorkshopSummarySchema,
} from './workshop-bill.shared.js';

export const WorkshopBillSchema = WorkshopDocumentGateSchema.extend({
  workshopDetails: WorkshopDetailsSchema,

  tableLayout: z.enum(['split', 'sequential']).optional().default('sequential'),
  lineItemsTable: z.array(WorkshopLineItemRowSchema).nullish().default([]),
  partsTable: z.array(WorkshopPartsRowSchema).nullish().default([]),
  labourTable: z.array(WorkshopLabourRowSchema).nullish().default([]),
  summary: WorkshopSummarySchema,

  confidenceScore: z.number().min(0).max(1).describe('Overall confidence score of the extraction from 0 to 1'),
  requiresHumanReview: z.boolean().describe('Flag indicating if human review is required'),

  extraFields: z.array(ExtraFieldSchema).nullable().optional(),
});

export type IWorkshopBillSchema = z.infer<typeof WorkshopBillSchema>;
