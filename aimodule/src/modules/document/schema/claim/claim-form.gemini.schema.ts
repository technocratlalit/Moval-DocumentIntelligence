import { Schema, Type } from '@google/genai';

const str = (): Schema => ({ type: Type.STRING, nullable: true });
const num = (): Schema => ({ type: Type.NUMBER, nullable: true });
const bool = (): Schema => ({ type: Type.BOOLEAN, nullable: true });

const businessFields: Record<string, Schema> = {
  insurerCode: str(),
  insurerName: str(),
  templateVersion: str(),

  policyNo: str(),
  claimNo: str(),
  coverNoteNo: str(),
  dateOfIntimation: str(),
  insurancePeriodStart: str(),
  insurancePeriodEnd: str(),

  insuredName: str(),
  insuredNameNative: str(),
  insuredAddress: str(),
  insuredAddressNative: str(),
  pinCode: str(),
  mobileNo: str(),
  email: str(),
  panNo: str(),
  bankAccountHolder: str(),
  bankAccountNo: str(),
  bankIfscCode: str(),

  registrationNo: str(),
  vehicleMake: str(),
  vehicleYear: str(),
  engineNo: str(),
  chassisNo: str(),
  vehicleClass: str(),
  cubicCapacity: str(),

  dateOfLoss: str(),
  timeOfLoss: str(),
  placeOfAccident: str(),
  natureOfLoss: str(),
  accidentDescription: str(),
  accidentDescriptionEnglish: str(),
  vehicleSpeedAtAccident: str(),
  estimatedRepairCost: str(),
  idv: str(),
  inspectionLocation: str(),
  damageDescription: str(),

  driverName: str(),
  driverAgeOrDob: str(),
  driverAddress: str(),
  driverRelationship: str(),
  drivingLicenseNo: str(),
  licenseIssuingAuthority: str(),
  licenseExpiryDate: str(),
  licenseClass: str(),
  alcoholInfluence: bool(),

  policeReportLodged: bool(),
  firNo: str(),
  policeStationName: str(),
  firDate: str(),

  thirdPartyInjury: bool(),
  thirdPartyDeath: bool(),
  thirdPartyPropertyDamage: bool(),
  thirdPartyDetails: str(),
  witnessDetails: str(),

  commercialPermitNo: str(),
  commercialFitnessCert: str(),
  commercialLadenWeight: str(),
  commercialSectionNotApplicable: bool(),

  declarationDate: str(),
  declarationPlace: str(),
  signaturePresent: bool(),

  extraFields: {
    type: Type.ARRAY,
    nullable: true,
    items: {
      type: Type.OBJECT,
      properties: {
        key: { type: Type.STRING },
        value: str(),
        matchedCanonicalField: str(),
        confidence: { type: Type.NUMBER, nullable: true },
        sourcePage: { type: Type.NUMBER, nullable: true },
        matchMethod: str(),
      },
    },
  },
};

export const ClaimFormGeminiSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    isCorrectDocumentType: { type: Type.BOOLEAN },
    detectedDocumentType: str(),
    hasAllPagesCorrectType: { type: Type.BOOLEAN },
    invalidPageIndices: {
      type: Type.ARRAY,
      nullable: true,
      items: { type: Type.NUMBER },
    },
    ...businessFields,
    requiresHumanReview: { type: Type.BOOLEAN },
    lowConfidenceFields: {
      type: Type.ARRAY,
      nullable: true,
      items: { type: Type.STRING },
    },
    confidenceScore: { type: Type.NUMBER },
  },
  required: [
    'isCorrectDocumentType',
    'detectedDocumentType',
    'hasAllPagesCorrectType',
    'requiresHumanReview',
    'confidenceScore',
  ],
};
