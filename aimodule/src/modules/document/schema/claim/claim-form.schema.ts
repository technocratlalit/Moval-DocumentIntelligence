import { z } from 'zod';

const str = () => z.string().nullable().optional();
const yesNo = () => z.enum(['Yes', 'No', 'Unknown']).nullable().optional();

const BankSchema = z.object({
  bank_name: str(),
  branch_name: str(),
  account_no: str(),
  account_type: str(),
  ifsc_code: str(),
  micr_code: str(),
}).nullable().optional();

const MetaSchema = z.object({
  source_insurer: z.enum(['UIIC', 'OIC', 'NIAC', 'NIC']).nullable().optional(),
  source_template_version: str(),
  form_language: z.enum(['hindi', 'english', 'mixed']).nullable().optional(),
  extraction_confidence: z.number().min(0).max(1).nullable().optional(),
}).nullable().optional();

const CompanyDetailsSchema = z.object({
  company_name: str(),
  registered_office_address: str(),
  divisional_branch_office: str(),
  office_code: str(),
  telephone_no: str(),
}).nullable().optional();

const PolicyDetailsSchema = z.object({
  policy_no: str(),
  cover_note_no: str(),
  certificate_no: str(),
  claim_no: str(),
  period_of_insurance_from: str(),
  period_of_insurance_to: str(),
  gst_no: str(),
}).nullable().optional();

const InsuredDetailsSchema = z.object({
  insured_type: z.enum(['individual', 'company']).nullable().optional(),
  name: str(),
  address: str(),
  pin_code: str(),
  mobile: str(),
  landline: str(),
  email: str(),
  pan_no: str(),
  aadhar_no: str(),
  bank_ac_particulars: BankSchema,
}).nullable().optional();

const VehicleDetailsSchema = z.object({
  registration_no: str(),
  registration_no_normalized: str(),
  make: str(),
  model: str(),
  year: str(),
  engine_no: str(),
  chassis_no: str(),
  cubic_carrying_capacity: str(),
  hypothecation_details: str(),
  vehicle_in_working_condition: yesNo(),
  purpose_of_use_at_accident_time: str(),
  trailer_attached: yesNo(),
  motorcycle_sidecar_attached: yesNo(),
  pillion_rider_carried: yesNo(),
  no_of_occupants_carried: str(),
}).nullable().optional();

const CommercialVehicleInfoSchema = z.object({
  registered_laden_weight: str(),
  unladen_weight: str(),
  weight_of_goods_carried: str(),
  no_of_passengers_carried: str(),
  no_of_passengers_permitted: str(),
  type_nature_of_permit: str(),
  nature_of_goods_carried: str(),
  plying_for_hire: yesNo(),
  trailer_attached_lorry_jeep: yesNo(),
  load_challan_gr_lr_no: str(),
  fitness_certificate_valid_upto: str(),
}).nullable().optional();

const LossDetailsSchema = z.object({
  date_of_loss: str(),
  date_of_loss_iso: str(),
  time_of_loss: str(),
  place_of_loss_accident: str(),
  type_of_loss: str(),
  speed_of_vehicle_at_accident: str(),
  brief_description_of_accident: str(),
  estimated_cost_of_repairs: str(),
  estimated_cost_of_repairs_numeric: z.number().nullable().optional(),
  third_party_responsible_name_address: str(),
}).nullable().optional();

const DriverDetailsSchema = z.object({
  name: str(),
  age: str(),
  address: str(),
  relationship_to_insured: str(),
  is_paid_driver: yesNo(),
  years_in_employment_if_paid: str(),
  under_influence_of_intoxication: yesNo(),
  driving_license_no: str(),
  license_issuing_authority: str(),
  license_valid_upto_expiry_date: str(),
  license_valid_upto_expiry_date_iso: str(),
  license_type_temp_permanent: str(),
  authorized_vehicle_types_to_drive: str(),
  endorsement_suspension_details: str(),
  prior_accident_history: str(),
  charged_by_police_details: str(),
  was_driver_injured: yesNo(),
}).nullable().optional();

const DamageSchema = z.object({
  full_details_of_damage: str(),
  estimated_cost_of_repairs: str(),
  idv: str(),
  inspection_location_and_time: str(),
}).nullable().optional();

const WorkshopDetailsSchema = z.object({
  workshop_name_address: str(),
  workshop_contact_person: str(),
  workshop_mobile: str(),
  workshop_phone: str(),
  workshop_email: str(),
  estimated_loss: str(),
}).nullable().optional();

const ThirdPartyDetailsSchema = z.object({
  third_party_involved: yesNo(),
  loss_type_death_injury_property: str(),
  name: str(),
  age: str(),
  address: str(),
  personal_injury_details: str(),
  hospital_name_address: str(),
  treatment_undergone: str(),
  property_damage_details: str(),
  third_party_vehicle_no: str(),
  claim_notice_received: yesNo(),
  remarks: str(),
}).nullable().optional();

const InjuryDeathSchema = z.object({
  was_driver_or_occupant_injured: yesNo(),
  injury_details: str(),
  no_of_persons_injured: str(),
  no_of_deaths: str(),
  wages_paid_to_workman: str(),
  tppd_damage_cost: str(),
}).nullable().optional();

const PoliceFirSchema = z.object({
  reported_to_police: yesNo(),
  fir_gd_no_or_crime_diary_no: str(),
  date_of_reporting: str(),
  date_of_reporting_iso: str(),
  police_station_name: str(),
  reason_for_delayed_or_no_fir: str(),
}).nullable().optional();

const WitnessDetailsSchema = z.object({
  names_and_addresses_of_passengers_witnesses: str(),
  police_constable_took_particulars: yesNo(),
  phone: str(),
}).nullable().optional();

const TheftDetailsSchema = z.object({
  date_time: str(),
  place: str(),
  what_was_stolen: str(),
  theft_of_vehicle: yesNo(),
  theft_of_accessories: yesNo(),
  accessory_name_make_serial_idv: str(),
  estimated_replacement_cost: str(),
  discovered_reported_by: str(),
  reported_to_police: yesNo(),
  police_station: str(),
  cr_diary_no: str(),
}).nullable().optional();

const AddOnCoversSchema = z.object({
  courtesy_car_availed: yesNo(),
  medical_expenses_cover: yesNo(),
  loss_of_personal_effects_cover: yesNo(),
  return_to_invoice_cover: yesNo(),
  engine_gearbox_protection_cover: yesNo(),
  nil_depreciation_cover: yesNo(),
}).nullable().optional();

const PastClaimsSchema = z.object({
  prior_claim_on_same_vehicle_current_period: yesNo(),
  prior_claim_details: str(),
}).nullable().optional();

const DeclarationSchema = z.object({
  date: str(),
  date_iso: str(),
  place: str(),
  signature_of_insured: str(),
  signature_present: z.boolean().nullable().optional(),
}).nullable().optional();

export const CanonicalClaimSchema = z.object({
  meta: MetaSchema,
  company_details: CompanyDetailsSchema,
  policy_details: PolicyDetailsSchema,
  insured_details: InsuredDetailsSchema,
  vehicle_details: VehicleDetailsSchema,
  commercial_vehicle_info: CommercialVehicleInfoSchema,
  loss_details: LossDetailsSchema,
  driver_details: DriverDetailsSchema,
  other_insurance_details: str(),
  damage_to_insured_vehicle: DamageSchema,
  workshop_details: WorkshopDetailsSchema,
  third_party_details: ThirdPartyDetailsSchema,
  injury_death_to_driver_occupant: InjuryDeathSchema,
  police_fir_details: PoliceFirSchema,
  witness_details: WitnessDetailsSchema,
  theft_details: TheftDetailsSchema,
  add_on_covers: AddOnCoversSchema,
  past_claims: PastClaimsSchema,
  declaration: DeclarationSchema,
});

export type CanonicalClaim = z.infer<typeof CanonicalClaimSchema>;

export const ClaimClassifySchema = z.object({
  insurer: z.enum(['UIIC', 'OIC', 'NIAC', 'NIC', 'unknown']),
  template_version: z.string(),
  form_language: z.enum(['hindi', 'english', 'mixed', 'unknown']),
});

export type ClaimClassifyResult = z.infer<typeof ClaimClassifySchema>;

export interface FlaggedField {
  path: string;
  reason: string;
  confidence?: number;
}

export interface ClaimExtractionMeta {
  ocrEngine: 'mistral';
  ocrModel: string;
  ocrRoute: 'mistral';
  pageCount: number;
  ocrPairCount?: number;
  averageOcrConfidence?: number | null;
  lowConfidenceWordCount?: number;
  rawPairs?: Array<{ section: string; label: string; labelRaw?: string; value: string | null; canonicalHint?: string }>;
  rawExtractions?: Array<{ sourceModel: string; rawJson: unknown; createdAt: string }>;
  flaggedFields?: FlaggedField[];
  fieldConfidence?: Array<{ path: string; confidence: number; flaggedForReview: boolean }>;
  debugStages?: Array<{ stage: string; file?: string }>;
  pipelineStatus?: string;
  postprocessDiff?: Array<{ path: string; before: unknown; after: unknown }>;
  fieldHints?: Array<{ canonicalHint: string; label: string; value: string; source: string }>;
  display?: Record<string, unknown>;
  cleanedMarkdown?: string;
  geminiRaw?: Record<string, unknown>;
}

export interface ClaimExtractionResult extends CanonicalClaim {
  confidenceScore?: number;
  requiresHumanReview?: boolean;
  lowConfidenceFields?: string[];
  status?: 'completed' | 'needs_review';
  display?: Record<string, unknown>;
  extractionMeta?: ClaimExtractionMeta;
}
