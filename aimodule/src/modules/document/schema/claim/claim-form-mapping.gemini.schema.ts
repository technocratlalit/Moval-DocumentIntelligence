import { Schema, Type } from '@google/genai';

const str = (): Schema => ({ type: Type.STRING, nullable: true });

export const ClaimFormMappingGeminiSchema: Schema = {
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
    unmappedMappings: {
      type: Type.ARRAY,
      nullable: true,
      items: {
        type: Type.OBJECT,
        properties: {
          ocrLabel: { type: Type.STRING },
          canonicalField: str(),
          value: str(),
          confidence: { type: Type.NUMBER, nullable: true },
        },
      },
    },
    requiresHumanReview: { type: Type.BOOLEAN },
    lowConfidenceFields: {
      type: Type.ARRAY,
      nullable: true,
      items: { type: Type.STRING },
    },
  },
  required: [
    'isCorrectDocumentType',
    'detectedDocumentType',
    'hasAllPagesCorrectType',
    'requiresHumanReview',
  ],
};

export interface ClaimFormMappingGeminiResult {
  isCorrectDocumentType: boolean;
  detectedDocumentType: string | null;
  hasAllPagesCorrectType: boolean;
  invalidPageIndices?: number[] | null;
  unmappedMappings?: Array<{
    ocrLabel: string;
    canonicalField: string | null;
    value: string | null;
    confidence?: number | null;
  }> | null;
  requiresHumanReview: boolean;
  lowConfidenceFields?: string[] | null;
}
