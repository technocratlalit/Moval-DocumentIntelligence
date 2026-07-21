export type ClaimTemplate =
  | 'UIIC_BILINGUAL'
  | 'UIIC_TABULAR'
  | 'OIC_BILINGUAL'
  | 'OIC_ENGLISH'
  | 'NIAC_TABLE'
  | 'NIC_COMPACT'
  | 'NIC_HINDI'
  | 'GENERIC';

export type MatchMethod = 'exact' | 'fuzzy' | 'section' | 'gemini' | 'none';

export interface SectionRule {
  sections?: RegExp[];
  excludeSections?: RegExp[];
  labelPatterns?: RegExp[];
  excludeLabelPatterns?: RegExp[];
  pages?: number[];
  minPage?: number;
  maxPage?: number;
}

/** Canonical field → literal label variants from real Indian motor claim forms. */
export const FIELD_ALIASES: Record<string, string[]> = {
  policyNo: [
    'Policy No.',
    'Policy No',
    'Policy Number',
    'Certificate/Policy No.',
    'Certificate/Policy No',
    'Cover Note No.',
    'Cover Note No',
    'पॉलिसी नंबर',
    'बीमा पत्र संख्या',
  ],
  claimNo: [
    'Claim No.',
    'Claim No',
    'Claim Number',
    'Intimation No.',
    'Intimation No',
    'दावा संख्या',
  ],
  coverNoteNo: ['Cover Note No.', 'Cover Note No', 'Cover Note Number'],
  dateOfIntimation: [
    'Date & Time of Intimation',
    'Date and Time of Intimation',
    'Date of Intimation',
    'Intimation Date',
    'सूचना की तिथि',
  ],
  insurancePeriodStart: [
    'Period of insurance',
    'Period of Insurance',
    'Insurance Period',
    'बीमा अवधि',
  ],
  insurancePeriodEnd: ['Period of insurance', 'Period of Insurance', 'Insurance Period'],
  insuredName: [
    '(a) Name',
    'Name',
    'Name of the Insured',
    'Insured Name',
    'Name of insured',
    'Reporting Branch/Divisional Office',
    'नाम',
    'बीमाकृत का नाम',
  ],
  insuredAddress: [
    '(b) Address for correspondence',
    '(b) Address',
    'Address for correspondence',
    'Address',
    'Insured Address',
    'पता',
  ],
  mobileNo: [
    '(c) Telephone',
    'Telephone',
    'Mobile',
    'Mobile No.',
    'Mobile No',
    'Phone',
    'Contact No.',
    'दूरभाष',
  ],
  email: ['Email', 'E-mail', 'E-Mail ID'],
  panNo: ['PAN', 'PAN No.', 'PAN Number'],
  pinCode: ['Pin Code', 'PIN Code', 'Pincode', 'PIN'],
  registrationNo: [
    'Regd. No.',
    'Regd No',
    'Registration No.',
    'Registration No',
    'Reg. No.',
    'Vehicle No.',
    'Vehicle No',
    'Vehicle Regn No.',
    'गाड़ी संख्या',
    'पंजीकृत अक्षर व संख्या',
  ],
  vehicleMake: ['Make & Year', 'Make and Year', 'Make', 'Manufacturer', 'निर्माता'],
  vehicleYear: ['Make & Year', 'Make and Year', 'Year', 'Year of Mfg'],
  engineNo: ['Engine No.', 'Engine No', 'Engine Number', 'इंजन नं'],
  chassisNo: ['Chassis No.', 'Chassis No', 'Chassis Number', 'शासी नं'],
  vehicleClass: ['Class of Vehicle', 'Vehicle Class', 'Type of Vehicle', 'Model'],
  cubicCapacity: ['Cubic Capacity', 'CC', 'Engine CC'],
  dateOfLoss: [
    'Date and Time',
    'Date & Time',
    'Date & Time (accident)',
    'Date & Time of Accident/ Occurrence',
    'Date of accident',
    'Date of Accident',
    'Date of loss',
    'Date of Loss',
    'Date of occurrence',
    'दुर्घटना की तिथि',
  ],
  timeOfLoss: [
    'Date and Time',
    'Date & Time',
    'Date & Time (accident)',
    'Date & Time of Accident/ Occurrence',
    'Time',
    'Time of accident',
    'Time of loss',
  ],
  placeOfAccident: [
    '(b) Place',
    'Place (accident)',
    'Place of accident',
    'Place of Accident',
    'Place of Loss',
    'Place of Accident/Theft',
    'Location',
    'स्थान',
  ],
  natureOfLoss: ['Nature of loss', 'Nature of Loss', 'Type of Loss', 'Type of loss'],
  accidentDescription: [
    'Short description of the accident',
    'Description of the accident',
    'Particulars of the accident',
    'Brief particulars of the accident',
    'Accident description',
    'दुर्घटना का संक्षिप्त विवरण',
    'दुर्घटना का विवरण',
  ],
  accidentDescriptionEnglish: [
    'Give a short description of the accident',
    'Short Description of Accident/ Incident',
    'Short description of the accident',
  ],
  damageDescription: [
    'Full details of damage',
    'Nature & description of damage',
    'Nature and description of damage',
    'Damage description',
    'क्षति का विवरण',
  ],
  vehicleSpeedAtAccident: [
    'Speed of vehicle',
    'Speed',
    'Vehicle speed at accident',
    'Speed of your vehicle at the time of accident',
  ],
  estimatedRepairCost: [
    'Estimated Cost of Repairs',
    'Estimated Cost of repairs',
    'Estimated cost of repairs',
    'Approximate Estimated Cost of repairs',
    'Estimated Loss',
    'Repair estimate',
    'मरम्मत का अनुमानित खर्च',
  ],
  idv: ['IDV', 'Insured Declared Value', 'IDV : Rs.'],
  inspectionLocation: [
    'Inspection location',
    'Where the damaged vehicle can be inspected',
    'When and where can the damaged vehicle be inspected?',
    'Place of inspection',
  ],
  driverName: [
    '(a) Name',
    'Name (driver)',
    'Driver Name',
    'Name & address of the driver',
    'Name of the driver',
    'चालक का नाम',
  ],
  driverAgeOrDob: ['(b) Age', 'Age or DOB', 'Date of birth', 'Age', 'आयु'],
  driverAddress: [
    '(c) Address',
    'Address (driver)',
    'Driver Address',
    'Address of driver',
  ],
  driverRelationship: [
    'Relationship',
    'If the driver',
    'Is the driver',
    'Is Driver',
    'Relation with insured',
    'Relationship with insured',
  ],
  drivingLicenseNo: [
    'Driving Licence Number',
    'Driving licence Number',
    'Driving Licence No.',
    'Driving License No',
    'Driving Licence No.',
    'DL No.',
    'DL No',
    'Licence No.',
    'लाइसेंस नम्बर',
    'ड्राइविंग लाइसेंस नं',
  ],
  licenseIssuingAuthority: [
    'Issuing Authority',
    'Issuing authority',
    'RTO',
    'Original issuing Authority',
  ],
  licenseExpiryDate: [
    'Date of expiry',
    'Date of Expiry',
    'Licence expiry',
    'Licence Expiry Date',
    'Valid upto',
    'Valid up to',
  ],
  licenseClass: [
    'Was the licence temporary/permanent?',
    'Specify type(s) of Motor Vehicle(s) Authorised to drive',
    'Authorised to drive',
    'Class of vehicle authorised',
    'License class',
  ],
  alcoholInfluence: [
    'Intoxication',
    'Alcohol',
    'Under influence of alcohol',
    'Was driver under influence of drugs/intoxicants',
  ],
  policeReportLodged: [
    'FIR lodged',
    'Police report lodged',
    'Police Report Lodged',
    'Whether FIR lodged',
  ],
  firNo: ['FIR No.', 'FIR No', 'FIR Number', 'Police report no', 'Complaint No.'],
  policeStationName: ['Police Station', 'Police station name'],
  firDate: ['FIR Date', 'Date of FIR'],
  witnessDetails: ['Witness', 'Witnesses', 'Name and address of witnesses'],
  thirdPartyDetails: ['Third party details', 'Third Party Details'],
  thirdPartyPropertyDamage: ['Third Party involve', 'Third party property damage', 'Death/Injury'],
  declarationDate: ['Date', 'Declaration date'],
  declarationPlace: ['Place', 'Declaration place'],
  bankAccountHolder: ['Account holder', 'Name of account holder'],
  bankAccountNo: ['Account No.', 'Bank Account No.', 'Account number'],
  bankIfscCode: ['IFSC', 'IFSC Code'],
  signaturePresent: ['Signature of the Insured', 'Signature'],
};

export const TEMPLATE_SECTION_RULE_OVERRIDES: Partial<
  Record<ClaimTemplate, Partial<Record<string, SectionRule>>>
> = {
  NIC_COMPACT: {
    driverName: { labelPatterns: [/name\s*\(driver\)/i, /driver\s*name/i], minPage: 1 },
    driverAgeOrDob: { minPage: 1 },
    driverAddress: { labelPatterns: [/address\s*\(driver\)/i], minPage: 1 },
    driverRelationship: { minPage: 1 },
    drivingLicenseNo: { minPage: 1 },
    licenseIssuingAuthority: { minPage: 1 },
    licenseExpiryDate: { minPage: 1 },
    licenseClass: { minPage: 1 },
    dateOfLoss: { minPage: 1 },
    timeOfLoss: { minPage: 1 },
    placeOfAccident: { minPage: 1 },
    natureOfLoss: { minPage: 1 },
    accidentDescriptionEnglish: { minPage: 1 },
    estimatedRepairCost: { minPage: 1 },
    policeReportLodged: { minPage: 1 },
    thirdPartyPropertyDamage: { minPage: 1 },
  },
  UIIC_TABULAR: {
    driverName: { labelPatterns: [/driver\s*name/i], minPage: 1 },
    driverAddress: { labelPatterns: [/driver\s*address/i], minPage: 1 },
    drivingLicenseNo: { minPage: 1 },
    licenseExpiryDate: { minPage: 1 },
    dateOfLoss: { minPage: 1 },
    timeOfLoss: { minPage: 1 },
    placeOfAccident: { minPage: 1 },
    estimatedRepairCost: { minPage: 1 },
    alcoholInfluence: { minPage: 1 },
    thirdPartyPropertyDamage: { minPage: 1 },
    registrationNo: { labelPatterns: [/registration\s*no/i], minPage: 1 },
    engineNo: { labelPatterns: [/engine\s*no/i], minPage: 1 },
    chassisNo: { labelPatterns: [/chassis\s*no/i], minPage: 1 },
    vehicleMake: { labelPatterns: [/make/i], minPage: 1 },
    vehicleClass: { labelPatterns: [/model/i], minPage: 1 },
  },
  UIIC_BILINGUAL: {
    insuredName: { maxPage: 1, excludeSections: [/driver/i, /vehicle/i] },
    insuredAddress: { maxPage: 1, excludeSections: [/driver/i, /vehicle/i] },
    mobileNo: { maxPage: 1, excludeSections: [/driver/i] },
    driverName: { minPage: 2, sections: [/driver/i, /चालक/i] },
    driverAgeOrDob: { minPage: 2, sections: [/driver/i, /चालक/i] },
    driverAddress: { minPage: 2, sections: [/driver/i, /चालक/i] },
    drivingLicenseNo: { minPage: 2, sections: [/driver/i, /चालक/i] },
    licenseIssuingAuthority: { minPage: 2, sections: [/driver/i, /चालक/i] },
    alcoholInfluence: { minPage: 2, sections: [/driver/i, /चालक/i] },
    dateOfLoss: { minPage: 3, sections: [/accident/i, /दुर्घटना/i] },
    timeOfLoss: { minPage: 3, sections: [/accident/i, /दुर्घटना/i] },
    placeOfAccident: { minPage: 3, sections: [/accident/i, /दुर्घटना/i] },
    vehicleSpeedAtAccident: { minPage: 3, sections: [/accident/i] },
    accidentDescription: { minPage: 3, sections: [/accident/i] },
    damageDescription: { minPage: 3, sections: [/damage/i, /क्षति/i] },
    estimatedRepairCost: { minPage: 3, sections: [/damage/i, /क्षति/i] },
    inspectionLocation: { minPage: 3, sections: [/damage/i, /inspected/i] },
    engineNo: { sections: [/vehicle/i, /वाहन/i], maxPage: 1 },
    chassisNo: { sections: [/vehicle/i, /वाहन/i], maxPage: 1 },
    registrationNo: { sections: [/vehicle/i, /वाहन/i], maxPage: 1 },
    vehicleMake: { sections: [/vehicle/i, /वाहन/i], maxPage: 1 },
    vehicleYear: { sections: [/vehicle/i, /वाहन/i], maxPage: 1 },
  },
};

export function getSectionRules(field: string, template: ClaimTemplate = 'GENERIC'): SectionRule | undefined {
  const base = SECTION_RULES[field];
  const override = TEMPLATE_SECTION_RULE_OVERRIDES[template]?.[field];
  if (!base && !override) return undefined;
  if (!override) return base;
  if (!base) return override;
  return {
    ...base,
    ...override,
    sections: override.sections ?? base.sections,
    excludeSections: override.excludeSections ?? base.excludeSections,
    labelPatterns: override.labelPatterns ?? base.labelPatterns,
    excludeLabelPatterns: override.excludeLabelPatterns ?? base.excludeLabelPatterns,
    pages: override.pages ?? base.pages,
    minPage: override.minPage ?? base.minPage,
    maxPage: override.maxPage ?? base.maxPage,
  };
}

export const SECTION_RULES: Record<string, SectionRule> = {
  insuredName: {
    excludeLabelPatterns: [/\(driver\)/i, /driver\s*name/i],
    maxPage: 2,
    excludeSections: [/driver/i, /third/i],
  },
  insuredAddress: {
    excludeLabelPatterns: [/\(driver\)/i],
    maxPage: 2,
    excludeSections: [/driver/i],
  },
  mobileNo: { maxPage: 2, excludeSections: [/driver/i] },
  registrationNo: {
    sections: [/vehicle/i, /insured\s*vehicle/i],
    labelPatterns: [/regd\.?\s*no/i, /registration\s*no/i, /vehicle\s*no/i],
    maxPage: 3,
  },
  vehicleMake: { sections: [/vehicle/i], maxPage: 3 },
  vehicleYear: { sections: [/vehicle/i], maxPage: 3 },
  driverName: {
    labelPatterns: [/name\s*\(driver\)/i, /driver\s*name/i],
    minPage: 2,
    sections: [/driver/i, /wheel/i],
    excludeSections: [/^\d*\.?\s*insured\b/i, /third/i, /details\s*of\s*accident/i],
  },
  driverAgeOrDob: { minPage: 2, sections: [/driver/i] },
  driverAddress: {
    labelPatterns: [/address\s*\(driver\)/i],
    minPage: 2,
    sections: [/driver/i],
  },
  driverRelationship: { minPage: 2, sections: [/driver/i] },
  drivingLicenseNo: { minPage: 2, sections: [/driver/i] },
  licenseIssuingAuthority: { minPage: 2, sections: [/driver/i] },
  licenseExpiryDate: { minPage: 2, sections: [/driver/i] },
  licenseClass: { minPage: 2, sections: [/driver/i] },
  dateOfLoss: { sections: [/accident/i, /loss/i, /details\s*of\s*accident/i], minPage: 2 },
  timeOfLoss: { sections: [/accident/i, /loss/i], minPage: 2 },
  placeOfAccident: { sections: [/accident/i, /loss/i], minPage: 2 },
  accidentDescription: { sections: [/accident/i, /loss/i], minPage: 2 },
  accidentDescriptionEnglish: { sections: [/accident/i, /loss/i], minPage: 2 },
  damageDescription: { sections: [/damage/i, /vehicle/i, /accident/i], minPage: 2 },
  vehicleSpeedAtAccident: { sections: [/accident/i], minPage: 2 },
  declarationDate: { sections: [/declaration/i, /signature/i] },
  declarationPlace: { sections: [/declaration/i, /signature/i] },
};

export const TEMPLATE_ALIAS_OVERRIDES: Partial<Record<ClaimTemplate, Partial<Record<string, string[]>>>> = {
  NIAC_TABLE: {
    dateOfIntimation: ['Date & Time of Intimation', 'Date and Time of Intimation'],
    policyNo: ['Policy No.', 'Policy No'],
    insurancePeriodStart: ['Period of insurance', 'Period of Insurance'],
  },
  OIC_ENGLISH: {
    policyNo: ['Certificate/Policy No.', 'Certificate/Policy No'],
    insurancePeriodStart: ['Period of Insurance', 'Period of insurance'],
    accidentDescriptionEnglish: ['Give a short description of the accident'],
    inspectionLocation: ['When and where can the damaged vehicle be inspected?'],
  },
  OIC_BILINGUAL: {
    policyNo: ['Certificate/Policy No.', 'बीमा पत्र संख्या'],
  },
  NIC_COMPACT: {
    policyNo: ['Policy No', 'Policy No.'],
    registrationNo: ['Vehicle No', 'Vehicle No.'],
    dateOfLoss: ['Date & Time of Accident/ Occurrence'],
    placeOfAccident: ['Place of Loss'],
    natureOfLoss: ['Type of Loss'],
    accidentDescriptionEnglish: ['Short Description of Accident/ Incident'],
    driverRelationship: ['Is Driver'],
    licenseExpiryDate: ['Valid up to'],
    licenseClass: ['Authorised to drive'],
    policeReportLodged: ['Police Report Lodged'],
  },
  NIC_HINDI: {
    policyNo: ['पॉलिसी नंबर', 'Policy No.'],
    registrationNo: ['पंजीकृत अक्षर व संख्या', 'Regd. No.'],
  },
  UIIC_TABULAR: {
    insuredName: ['Insured Name'],
    pinCode: ['Pin Code'],
    vehicleClass: ['Model'],
    timeOfLoss: ['Time'],
    placeOfAccident: ['Place of Accident/Theft'],
    estimatedRepairCost: ['Estimated Loss'],
    licenseExpiryDate: ['Licence Expiry Date'],
    alcoholInfluence: ['Was driver under influence of drugs/intoxicants'],
    thirdPartyPropertyDamage: ['Third Party involve'],
  },
  UIIC_BILINGUAL: {
    policyNo: ['Certificate/Policy No.', 'Certificate/Policy No', 'बीमा पत्र संख्या'],
    insurancePeriodStart: ['Period of Insurance', 'बीमा अवधि'],
    claimNo: ['Claim No.', 'Claim No'],
    insuredName: ['Name', '(a) Name'],
    insuredAddress: ['Address for Correspondence', '(b) Address for Correspondence'],
    mobileNo: ['Telephone No.', 'Telephone No', '(c) Telephone No.'],
    engineNo: ['Engine No.', 'इंजन संख्या'],
    chassisNo: ['Chassis No.', 'चेसिस संख्या'],
    registrationNo: ['Registration No.', 'पंजीकृत अक्षर व संख्या', 'Regd. No.'],
    vehicleMake: ['Make and Year', 'गाड़ी के निर्माता का नाम'],
    driverName: ['Name', '(a) Name'],
    driverAgeOrDob: ['Age', '(b) Age'],
    driverAddress: ['Address', '(c) Address'],
    drivingLicenseNo: [
      'Driving License No.',
      'Driving Licence Number',
      'गाड़ी चलाने का लाइसेन्स नम्बर',
    ],
    licenseIssuingAuthority: ['Issuing Authority', 'लाइसेन्स किसने जारी किया'],
    alcoholInfluence: ['Alcohol influence', 'under the influence'],
    dateOfLoss: ['Date and Time', 'Date & Time'],
    timeOfLoss: ['Date and Time', 'Date & Time'],
    placeOfAccident: ['Place'],
    vehicleSpeedAtAccident: ['Speed of vehicle', 'Speed of your vehicle'],
    accidentDescription: ['Short description of the accident'],
    damageDescription: ['Full details of damage'],
    estimatedRepairCost: ['Estimated cost of repairs'],
    inspectionLocation: ['When and where can damaged vehicle be inspected'],
    witnessDetails: ['Witness', 'साक्षी'],
  },
};

export function getAliasesForField(field: string, template: ClaimTemplate = 'GENERIC'): string[] {
  const override = TEMPLATE_ALIAS_OVERRIDES[template]?.[field];
  const base = FIELD_ALIASES[field] ?? [];
  if (!override) return base;
  return [...new Set([...override, ...base])];
}

export function getAllCanonicalFields(): string[] {
  return Object.keys(FIELD_ALIASES);
}
