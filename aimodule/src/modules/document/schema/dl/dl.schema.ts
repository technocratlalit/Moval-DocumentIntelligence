import { z } from 'zod';

const VehicleClassEntrySchema = z.object({
  vehicleClass: z.string().nullish(),
  classCode: z.string().nullish(),
  classDescription: z.string().nullish(),
  issuedOn: z.string().nullish(),
  validity: z.string().nullish(),
  badgeNumber: z.string().nullish(),
  badgeIssuedDate: z.string().nullish(),
  badgeIssuedBy: z.string().nullish(),
});

export const DLSchema = z.object({
  // Document Type Gate
  isCorrectDocumentType: z.boolean().optional(),
  detectedDocumentType: z.string().nullable().optional(),
  hasAllPagesCorrectType: z.boolean().optional(),
  invalidPageIndices: z.array(z.number()).nullable().optional(),

  // Core fields per spec
  dlNumber:           z.string().nullish(),
  dlNumberNormalized: z.string().nullish(),
  state:              z.string().nullish(),
  name:               z.string().nullish(),
  fatherSpouseName:   z.string().nullish(),
  dob:                z.string().nullish(),
  address:            z.string().nullish(),
  presentAddress:     z.string().nullish(),
  issueDate:          z.string().nullish(),
  validityNT:         z.string().nullish(),
  validityT:          z.string().nullish(),
  bloodGroup:         z.string().nullish(),
  organDonor:         z.string().nullish(),
  mobileNo:           z.string().nullish(),
  stateCode:          z.string().nullish(),
  issuingRto:         z.string().nullish(),
  endorseNo:          z.string().nullish(),
  endorseAuth:        z.string().nullish(),
  endorseDate:        z.string().nullish(),
  hazardousValidity:  z.string().nullish(),
  hillValidity:       z.string().nullish(),
  dlPurpose:          z.string().nullish(),
  dlFormat:           z.string().nullish(),
  documentQuality:    z.string().nullish(),
  formType:           z.string().nullish(),
  addressComplete:    z.boolean().nullish(),

  vehicleClasses: z.array(VehicleClassEntrySchema).nullish(),

  // Computed (derived post-extraction, not from AI)
  dlStatus: z.object({
    isNTValid: z.boolean().nullish(),
    isTValid: z.boolean().nullish(),
    isExpired: z.boolean().nullish(),
  }).nullish(),

  // Review flags
  requiresHumanReview: z.boolean(),
  lowConfidenceFields: z.array(z.string()).nullish(),
  confidenceScore: z.number().catch(0),
});

export type IDLSchema = z.infer<typeof DLSchema>;
