import { z } from 'zod';

export const RCSchema = z.object({
  // Document Type Gate
  isCorrectDocumentType: z.boolean().optional(),
  detectedDocumentType: z.string().nullable().optional(),
  hasAllPagesCorrectType: z.boolean().optional(),
  invalidPageIndices: z.array(z.number()).nullable().optional(),

  // Core fields per spec
  registrationNo:   z.string().nullish(),
  ownerName:        z.string().nullish(),
  fatherSpouseName: z.string().nullish(),
  address:          z.string().nullish(),
  ownerSerial:      z.string().nullish(),
  chassisNo:        z.string().nullish(),
  engineNo:         z.string().nullish(),
  manufacturer:     z.string().nullish(),
  modelNo:          z.string().nullish(),
  fuel:             z.string().nullish(),
  registrationDate: z.string().nullish(),
  regValidity:      z.string().nullish(),
  taxPaidUpto:      z.string().nullish(),
  seatingCapacity:  z.string().nullish(),
  standingCapacity: z.string().nullish(),
  colour:           z.string().nullish(),
  vehicleClass:     z.string().nullish(),
  bodyType:         z.string().nullish(),
  wheelBase:        z.string().nullish(),
  cubicCapacity:    z.string().nullish(),
  purpose:          z.string().nullish(),
  financeBank:      z.string().nullish(),
  hypothecatedTo:   z.string().nullish(),
  hypothecation:    z.enum(['Yes', 'No']).nullish(),
  stateCode:        z.string().nullish(),
  issuingAuthority: z.string().nullish(),
  rtoCode:          z.string().nullish(),
  fitnessValidUpto: z.string().nullish(),
  insuranceUpto:    z.string().nullish(),
  unladenWeight:    z.string().nullish(),
  ladenWeight:      z.string().nullish(),
  cardSerialNo:     z.string().nullish(),
  formType:         z.string().nullish(),

  // Computed post-extraction
  state: z.string().nullish(),
  rcStatus: z.object({
    isValid: z.boolean().nullish(),
    isExpired: z.boolean().nullish(),
    daysUntilExpiry: z.number().nullish(),
  }).nullish(),

  // Review flags
  requiresHumanReview: z.boolean(),
  lowConfidenceFields: z.array(z.string()).nullish(),
  confidenceScore: z.number().catch(0),
});

export type IRCSchema = z.infer<typeof RCSchema>;
