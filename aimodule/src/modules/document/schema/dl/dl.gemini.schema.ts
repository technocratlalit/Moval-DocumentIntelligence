
import { Type, Schema } from '@google/genai';

const str = (): Schema => ({ type: Type.STRING, nullable: true });

const vehicleClassItem: Schema = {
  type: Type.OBJECT,
  properties: {
    vehicleClass: str(),
    classCode: str(),
    classDescription: str(),
    issuedOn: str(),
    validity: str(),
    badgeNumber: str(),
    badgeIssuedDate: str(),
    badgeIssuedBy: str(),
  },
};

export const DLGeminiSchema: Schema = {
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

    dlNumber:         str(),
    name:             str(),
    fatherSpouseName: str(),
    dob:              str(),
    address:          str(),
    presentAddress:   str(),
    issueDate:        str(),
    validityNT:       str(),
    validityT:        str(),
    bloodGroup:       str(),
    organDonor:       str(),
    mobileNo:         str(),
    stateCode:        str(),
    issuingRto:       str(),
    endorseNo:        str(),
    endorseAuth:      str(),
    endorseDate:      str(),
    hazardousValidity: str(),
    hillValidity:     str(),
    dlPurpose:        str(),
    dlFormat:         str(),
    documentQuality:  str(),
    formType:         str(),
    addressComplete:  { type: Type.BOOLEAN, nullable: true },

    vehicleClasses: {
      type: Type.ARRAY,
      nullable: true,
      items: vehicleClassItem,
    },

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
