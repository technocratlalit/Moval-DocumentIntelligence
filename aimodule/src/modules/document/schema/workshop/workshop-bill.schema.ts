import { z } from 'zod';
import {
  DynamicTableSchema,
  ExtraFieldSchema,
  WorkshopDetailsSchema,
  WorkshopDocumentGateSchema,
  WorkshopSummarySchema,
} from './workshop-bill.shared.js';

export const WorkshopBillSchema = WorkshopDocumentGateSchema.extend({
  workshopDetails: WorkshopDetailsSchema,
  summary: WorkshopSummarySchema,
  parts: DynamicTableSchema.default({ columns: [], rows: [] }),
  labour: DynamicTableSchema.default({ columns: [], rows: [] }),
  lineItems: DynamicTableSchema.optional(),
  confidenceScore: z.number().min(0).max(1).describe('Overall confidence score of the extraction from 0 to 1'),
  requiresHumanReview: z.boolean().describe('Flag indicating if human review is required'),
  extraFields: z.array(ExtraFieldSchema).nullable().optional(),
});

export type IWorkshopBillSchema = z.infer<typeof WorkshopBillSchema>;
