// insurance-policy.schema.ts — strict spec fields only
import { z } from 'zod';

const numericPreprocess = z.preprocess((val: unknown) => {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[^0-9.-]+/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }
  return null;
}, z.number().nullable());

const booleanPreprocess = z.preprocess((val: unknown) => {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    const normalized = val.trim().toLowerCase();
    if (['true', 'yes', 'y', '1'].includes(normalized)) return true;
    if (['false', 'no', 'n', '0'].includes(normalized)) return false;
  }
  return null;
}, z.boolean().nullable());

const AddOnCoverSchema = z.object({
  name: z.string().nullable().optional(),
  opted: z.boolean().nullable().optional(),
});

export const InsurancePolicySchema = z.object({
  // Document gate (internal validation)
  isCorrectDocumentType: z.boolean().optional(),
  detectedDocumentType: z.string().nullable().optional(),
  hasAllPagesCorrectType: z.boolean().optional(),
  invalidPageIndices: z.array(z.number()).nullable().optional(),

  policyNumber: z.string().nullable().optional(),
  insurerName: z.string().nullable().optional(),
  insuredName: z.string().nullable().optional(),
  insuredAddress: z.string().nullable().optional(),
  registrationNo: z.string().nullable().optional(),
  policyType: z.string().nullable().optional(),
  totalIdv: numericPreprocess,
  policyStartDate: z.string().nullable().optional(),
  policyEndDate: z.string().nullable().optional(),
  ncbPercentage: numericPreprocess,
  grossPremiumPaid: numericPreprocess,
  engineNo: z.string().nullable().optional(),
  chassisNo: z.string().nullable().optional(),
  vehicleMake: z.string().nullable().optional(),
  vehicleModel: z.string().nullable().optional(),
  financierName: z.string().nullable().optional(),
  geographicalArea: z.string().nullable().optional(),
  tpLiabilityLimit: numericPreprocess,
  paCoverAmount: numericPreprocess,
  engineProtectOpted: booleanPreprocess.optional(),
  consumablesCoverOpted: booleanPreprocess.optional(),
  addOnCovers: z.array(AddOnCoverSchema).nullable().optional(),
  nomineeName: z.string().nullable().optional(),
  registrationAuthority: z.string().nullable().optional(),

  policyCoverage: z.string().nullable().optional(),
  confidenceScore: z.number(),
  requiresHumanReview: z.boolean(),
});

export type IInsurancePolicySchema = z.infer<typeof InsurancePolicySchema>;
