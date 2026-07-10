
import { Type, Schema } from '@google/genai';

const str = (): Schema => ({ type: Type.STRING, nullable: true });

export const RCGeminiSchema: Schema = {
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

    registrationNo:    str(),
    ownerName:         str(),
    fatherSpouseName:  str(),
    address:           str(),
    ownerSerial:       str(),
    chassisNo:         str(),
    engineNo:          str(),
    manufacturer:      str(),
    modelNo:           str(),
    fuel:              str(),
    registrationDate:  str(),
    regValidity:       str(),
    taxPaidUpto:       str(),
    seatingCapacity:   str(),
    standingCapacity:  str(),
    colour:            str(),
    vehicleClass:      str(),
    bodyType:          str(),
    wheelBase:         str(),
    cubicCapacity:     str(),
    purpose:           str(),
    financeBank:       str(),
    hypothecatedTo:    str(),
    stateCode:         str(),
    issuingAuthority:  str(),
    rtoCode:           str(),
    fitnessValidUpto:  str(),
    insuranceUpto:     str(),
    unladenWeight:     str(),
    ladenWeight:       str(),
    cardSerialNo:      str(),
    formType:          str(),

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
