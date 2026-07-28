import type {
  ClaimDataKey,
  ClaimFormVariant,
  ClaimTemplateId,
  IInsuranceClaimData,
} from '../../schema/claim/motor-claim.schema.js';

export type TemplateLabelMap = Partial<Record<ClaimDataKey, string>>;

export interface ClaimVariantConfig {
  detect: string[];
  labels: TemplateLabelMap;
  pages: string[];
}

export interface ClaimTemplateConfig {
  id: ClaimTemplateId;
  detect: string[];
  pages: string[];
  labels: TemplateLabelMap;
  /** UIIC/OIC share section 5/6 swap risk */
  antiSwapLayout?: boolean;
  variants?: Partial<Record<ClaimFormVariant, ClaimVariantConfig>>;
}

const UIIC_LABELS: TemplateLabelMap = {
  insurerName: 'बीमा कंपनी का नाम',
  policyNumber: 'पॉलिसी संख्या',
  claimNumber: 'दावा संख्या',
  divisionalOrBranchOffice: 'मंडल कार्यालय / शाखा कार्यालय',
  policyStartDate: 'बीमा अवधि प्रारंभ',
  policyEndDate: 'बीमा अवधि समाप्ति',
  insuredName: 'बीमाधारक का नाम',
  insuredAddress: 'पत्र व्यवहार का पता',
  insuredMobile: 'दूरभाष संख्या',
  insuredEmail: 'ई-मेल',
  insuredPanOrGstin: 'पैन / जीएसटीआईएन',
  registrationNo: 'पंजीकरण संख्या',
  makeAndModel: 'निर्माता और वर्ष',
  engineNo: 'इंजन संख्या',
  chassisNo: 'चेसिस संख्या',
  accidentDate: 'दुर्घटना की तारीख',
  accidentTime: 'दुर्घटना का समय',
  accidentLocation: 'दुर्घटना का स्थान',
  vehicleSpeedKmph: 'दुर्घटना के समय गाड़ी की रफ्तार',
  typeOfLoss: 'हानि का प्रकार',
  accidentDescription: 'दुर्घटना का संक्षिप्त विवरण',
  driverName: 'चालक का नाम',
  driverAge: 'चालक की आयु',
  driverAddress: 'चालक का पता',
  driverRelationshipToInsured: 'चालक का संबंध',
  drivingLicenseNo: 'ड्राइविंग लाइसेंस संख्या',
  licenseIssuingAuthority: 'लाइसेंस जारीकर्ता',
  licenseExpiryDate: 'लाइसेंस समाप्ति तिथि',
  licenseType: 'लाइसेंस की किस्म स्थायी/अस्थायी',
  damageDescription: 'क्षति का पूरा ब्यौरा',
  estimatedRepairCost: 'मरम्मत का अनुमानित खर्च',
  inspectionWorkshopDetails: 'दुर्घटनाग्रस्त गाड़ी का कब और कहाँ निरीक्षण किया जा सकता है',
  policeReportLodged: 'पुलिस रिपोर्ट दर्ज',
  firOrGdNumber: 'एफआईआर / जीडी संख्या',
  policeStationName: 'थाना का नाम',
  declarationDate: 'घोषणा की तारीख',
  declarationPlace: 'घोषणा का स्थान',
  hasInsuredSignature: 'बीमाधारक के हस्ताक्षर',
};

const UIIC_ONE_PAGE_LABELS: TemplateLabelMap = {
  policyNumber: 'Policy No',
  insuredName: 'Insured Name',
  insuredAddress: 'Insured Address',
  insuredMobile: 'Mob',
  insuredEmail: 'E.mail',
  insuredPanOrGstin: 'PAN No',
  registrationNo: 'Vehicle No',
  makeAndModel: 'Make / Model',
  engineNo: 'Engine No',
  chassisNo: 'Chassis No',
  accidentDate: 'Date of Loss',
  accidentTime: 'Time',
  accidentLocation: 'Place of Accident/Theft',
  accidentDescription: 'Brief description of accident',
  driverName: 'Driver Name',
  drivingLicenseNo: 'Driving License No',
  inspectionWorkshopDetails: 'Name & Address of Workshop',
  estimatedRepairCost: 'Estimate Amount',
  declarationDate: 'Date',
  declarationPlace: 'Place',
  hasInsuredSignature: 'Signature of Insured/Claimant',
};

const OIC_LABELS: TemplateLabelMap = {
  insurerName: 'बीमा कंपनी का नाम',
  policyNumber: 'सर्टीफिकेट/पॉलिसी नं०',
  claimNumber: 'दावा सं०',
  divisionalOrBranchOffice: 'मण्डलीय कार्यालय',
  policyStartDate: 'बीमा की अवधि प्रारंभ',
  policyEndDate: 'बीमा की अवधि समाप्ति',
  insuredName: 'बीमाकृत व्यक्ति का नाम',
  insuredAddress: 'पत्राचार हेतु पता',
  insuredMobile: 'टेलीफोन',
  registrationNo: 'पंजीयन संख्या',
  makeAndModel: 'निर्माण तथा वर्ष',
  engineNo: 'इंजन नं०',
  chassisNo: 'चेचिस नं०',
  accidentDate: 'दुर्घटना की तारीख',
  accidentTime: 'दुर्घटना का समय',
  accidentLocation: 'दुर्घटना का स्थान',
  vehicleSpeedKmph: 'दुर्घटना के समय वाहन की गति',
  accidentDescription: 'दुर्घटना का संक्षिप्त विवरण',
  driverName: 'चालक का नाम',
  driverAge: 'चालक की आयु',
  driverAddress: 'चालक का पता',
  driverRelationshipToInsured: 'चालक का संबंध',
  drivingLicenseNo: 'ड्राइविंग लाइसेंस नं०',
  licenseIssuingAuthority: 'जारी करने वाला प्राधिकारी',
  licenseExpiryDate: 'समाप्ति की तिथि',
  licenseType: 'लाइसेंस स्थाई/अस्थाई',
  damageDescription: 'क्षति का पूरा ब्यौरा',
  estimatedRepairCost: 'मरम्मत का अनुमानित खर्च',
  inspectionWorkshopDetails: 'क्षतिग्रस्त वाहन का परीक्षण कब और कहाँ',
  policeReportLodged: 'पुलिस को सूचना दी गई',
  firOrGdNumber: 'काण्ड सं०',
  policeStationName: 'थाना का नाम',
  declarationDate: 'दिनांक',
  declarationPlace: 'स्थान',
  hasInsuredSignature: 'बीमाकृत व्यक्ति के हस्ताक्षर',
};

const NIAC_LABELS: TemplateLabelMap = {
  insurerName: 'Insurer Name',
  policyNumber: 'Policy No. / Cover Note No.',
  claimNumber: 'Claim No.',
  policyStartDate: 'Period of insurance (from)',
  policyEndDate: 'Period of insurance (to)',
  insuredName: 'Name of the Insured',
  insuredAddress: 'Address of the Insured',
  insuredPanOrGstin: 'PAN No.',
  registrationNo: 'Regd. No.',
  makeAndModel: 'Make',
  engineNo: 'Engine No.',
  chassisNo: 'Chassis No.',
  yearOfManufacture: 'Year',
  cubicCapacityOrCarryingCapacity: 'Cubic / Carrying Capacity',
  accidentDate: 'Date of Accident',
  accidentTime: 'Time of Accident',
  accidentLocation: 'Place',
  accidentDescription: 'Brief particulars of the accident',
  driverName: 'Name of the Driver',
  driverAddress: 'Address of the Driver',
  driverAge: 'Age',
  driverDateOfBirth: 'Date of Birth',
  driverRelationshipToInsured: 'Relationship with Insured',
  drivingLicenseNo: 'Driving Licence No.',
  licenseIssuingAuthority: 'Issuing Authority',
  licenseExpiryDate: 'Date of expiry',
  licenseType: 'Licence temporary/permanent',
  damageDescription: 'Nature & Description of the Damage',
  estimatedRepairCost: 'Approximate Estimated Cost of repairs',
  inspectionWorkshopDetails: 'When & where the damaged vehicle can be inspected',
  idv: 'IDV (Insured Declared Value)',
  firOrGdNumber: 'FIR No. & Date',
  policeStationName: 'Police Station',
  declarationDate: 'Date',
  declarationPlace: 'Place',
  hasInsuredSignature: 'Signature of the Insured',
};

const NIC_LABELS: TemplateLabelMap = {
  insurerName: 'बीमा कंपनी',
  policyNumber: 'पॉलिसी संख्या',
  claimNumber: 'दावा संख्या',
  divisionalOrBranchOffice: 'शाखा/मंडल',
  insuredName: 'नाम',
  insuredAddress: 'पता',
  insuredMobile: 'मोबाईल',
  insuredEmail: 'ईमेल',
  insuredPanOrGstin: 'पैन नं-',
  registrationNo: 'वाहन संख्या',
  engineNo: 'इंजन संख्या',
  chassisNo: 'चेसिस संख्या',
  accidentDate: 'दुर्घटना/घटना की तिथि',
  accidentTime: 'दुर्घटना/घटना का समय',
  accidentLocation: 'घटनास्थल',
  typeOfLoss: 'हानि का प्रकार',
  accidentDescription: 'दुर्घटना/घटना का संक्षिप्त विवरण',
  estimatedRepairCost: 'मरम्मत के लिए अनुमानित लागत',
  driverName: 'चालक का नाम',
  driverAge: 'आयु',
  driverRelationshipToInsured: 'मालिक/चालक संबंध',
  drivingLicenseNo: 'चालक लाइसेंस संख्या',
  licenseExpiryDate: 'लाइसेंस तक मान्य',
  licenseIssuingAuthority: 'जारीकर्ता पदाधिकारी',
  policeReportLodged: 'पुलिस रिपोर्ट दर्ज किया गया',
  firOrGdNumber: 'एफआईआर/जीडी संख्या',
  policeStationName: 'थाना का नाम',
  thirdPartyInjuryOrDamage: 'तृतीय पक्ष का नुकसान',
  declarationDate: 'दिनांक',
  declarationPlace: 'स्थान',
  hasInsuredSignature: 'बीमाकृत का हस्ताक्षर',
};

export const CLAIM_TEMPLATES: Record<ClaimTemplateId, ClaimTemplateConfig> = {
  UIIC: {
    id: 'UIIC',
    detect: ['UNITED INDIA INSURANCE', 'यूनाइटेड इंडिया', 'युनाइटेड इंडिया'],
    pages: [
      'P1: insured + vehicle table',
      'P2: driver section 3',
      'P3: accident §5 + damage §6',
      'P4: witness/theft/declaration',
    ],
    labels: UIIC_LABELS,
    antiSwapLayout: true,
    variants: {
      one_page: {
        detect: ['Date of Loss', 'Estimate Amount', 'Brief description of accident', 'Name & Address of Workshop'],
        pages: ['Single page: insured + vehicle + accident + workshop + declaration'],
        labels: UIIC_ONE_PAGE_LABELS,
      },
    },
  },
  OIC: {
    id: 'OIC',
    detect: ['THE ORIENTAL INSURANCE', 'दि ओरिएण्टल इंश्योरेन्स', 'ORIENTAL INSURANCE COMPANY'],
    pages: [
      'P1: insured + vehicle table',
      'P2: driver section 3',
      'P3: accident §5 + damage §6',
      'P4: witness/theft/declaration',
    ],
    labels: OIC_LABELS,
    antiSwapLayout: true,
    variants: {
      combined: {
        detect: ['combined', '3-5 pages', 'section 8', 'section 9', 'section 10'],
        pages: [
          'P1: insured + vehicle',
          'P2: driver §3',
          'P3: accident §5 + damage §6',
          'P4: witness/theft/declaration §8-10',
        ],
        labels: OIC_LABELS,
      },
    },
  },
  NIAC: {
    id: 'NIAC',
    detect: [
      'THE NEW INDIA ASSURANCE',
      'NEW INDIA ASSURANCE COMPANY',
      'MOTOR VEHICLE CLAIM FORM',
    ],
    pages: [
      'P1: policy + accident table + vehicle particulars',
      'P2: driver on wheel + damage + declaration',
    ],
    labels: NIAC_LABELS,
  },
  NIC: {
    id: 'NIC',
    detect: [
      'National Insurance Company',
      'नेशनल इन्श्योरेन्स',
      'मोटर बीमा दावा प्रपत्र',
    ],
    pages: [
      'P1: header policy/vehicle + insured + accident §2 + driver §3',
      'P2: police §5 + declaration §6',
    ],
    labels: NIC_LABELS,
  },
};

export const CLAIM_TEMPLATE_IDS = Object.keys(CLAIM_TEMPLATES) as ClaimTemplateId[];

function formatLabelValue(val: unknown): string | number | boolean | null {
  if (val == null) return null;
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return val;
  return String(val);
}

export function resolveTemplateId(
  sourceTemplate: string | null | undefined,
): ClaimTemplateId | null {
  if (!sourceTemplate) return null;
  const upper = sourceTemplate.toUpperCase();
  return CLAIM_TEMPLATE_IDS.find((id) => id === upper) ?? null;
}

export function resolveFormVariant(
  formVariant: string | null | undefined,
): ClaimFormVariant | null {
  if (!formVariant) return null;
  const v = formVariant.toLowerCase();
  if (v === 'standard' || v === 'one_page' || v === 'combined') return v;
  return null;
}

function resolveLabels(
  templateId: ClaimTemplateId,
  formVariant: ClaimFormVariant | null,
): TemplateLabelMap {
  const config = CLAIM_TEMPLATES[templateId];
  if (formVariant && config.variants?.[formVariant]?.labels) {
    return config.variants[formVariant]!.labels;
  }
  return config.labels;
}

export function buildTemplateLabelFields(
  data: Partial<IInsuranceClaimData>,
  sourceTemplate: string | null | undefined,
  formVariant?: string | null,
): Record<string, string | number | boolean | null> {
  const templateId = resolveTemplateId(sourceTemplate);
  if (!templateId) return {};

  const labels = resolveLabels(templateId, resolveFormVariant(formVariant));
  const out: Record<string, string | number | boolean | null> = {};

  for (const [key, label] of Object.entries(labels) as Array<[ClaimDataKey, string]>) {
    const val = data[key];
    if (val == null || (typeof val === 'string' && val.trim() === '')) continue;
    out[label] = formatLabelValue(val);
  }

  return out;
}

/** Build label → key table lines for prompt injection */
export function formatLabelKeyTable(
  templateId: ClaimTemplateId,
  formVariant?: ClaimFormVariant | null,
): string {
  const labels = resolveLabels(templateId, formVariant ?? null);
  return Object.entries(labels)
    .map(([key, label]) => `| ${label} | ${key} |`)
    .join('\n');
}

export function hasAntiSwapLayout(sourceTemplate: string | null | undefined): boolean {
  const id = resolveTemplateId(sourceTemplate);
  return id != null && CLAIM_TEMPLATES[id].antiSwapLayout === true;
}
