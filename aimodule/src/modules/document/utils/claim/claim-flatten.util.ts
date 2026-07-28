function joinPeriod(from?: string | null, to?: string | null): string | null {
  const parts = [from, to].filter(Boolean);
  return parts.length ? parts.join(' TO ') : null;
}

/** Flat PDF-like view for backend / frontend display. */
export function flattenClaimForDisplay(claim: Record<string, unknown>): Record<string, unknown> {
  const meta = (claim.meta ?? {}) as Record<string, unknown>;
  const company = (claim.company_details ?? {}) as Record<string, unknown>;
  const policy = (claim.policy_details ?? {}) as Record<string, unknown>;
  const insured = (claim.insured_details ?? {}) as Record<string, unknown>;
  const vehicle = (claim.vehicle_details ?? {}) as Record<string, unknown>;
  const loss = (claim.loss_details ?? {}) as Record<string, unknown>;
  const driver = (claim.driver_details ?? {}) as Record<string, unknown>;
  const damage = (claim.damage_to_insured_vehicle ?? {}) as Record<string, unknown>;
  const police = (claim.police_fir_details ?? {}) as Record<string, unknown>;
  const declaration = (claim.declaration ?? {}) as Record<string, unknown>;

  return {
    company_name: company.company_name ?? null,
    insurer_code: meta.source_insurer ?? null,
    claim_no: policy.claim_no ?? null,
    policy_no: policy.policy_no ?? null,
    period_of_insurance: joinPeriod(
      policy.period_of_insurance_from as string | null,
      policy.period_of_insurance_to as string | null,
    ),
    insured_name: insured.name ?? null,
    insured_address: insured.address ?? null,
    insured_mobile: insured.mobile ?? null,
    vehicle_regd_no: vehicle.registration_no ?? null,
    vehicle_make_year: vehicle.make ?? vehicle.year ?? null,
    engine_no: vehicle.engine_no ?? null,
    chassis_no: vehicle.chassis_no ?? null,
    vehicle_working_condition: vehicle.vehicle_in_working_condition ?? null,
    purpose_of_use: vehicle.purpose_of_use_at_accident_time ?? null,
    trailer_attached: vehicle.trailer_attached ?? null,
    date_of_accident: loss.date_of_loss ?? null,
    time_of_accident: loss.time_of_loss ?? null,
    place_of_accident: loss.place_of_loss_accident ?? null,
    speed_at_accident: loss.speed_of_vehicle_at_accident ?? null,
    type_of_loss: loss.type_of_loss ?? null,
    brief_description_of_accident: loss.brief_description_of_accident ?? null,
    third_party_responsible: loss.third_party_responsible_name_address ?? null,
    damage_details: damage.full_details_of_damage ?? null,
    estimated_cost_of_repairs: damage.estimated_cost_of_repairs ?? loss.estimated_cost_of_repairs ?? null,
    vehicle_inspection_location: damage.inspection_location_and_time ?? null,
    driver_name: driver.name ?? null,
    driver_age: driver.age ?? null,
    driver_address: driver.address ?? null,
    driver_relationship_to_insured: driver.relationship_to_insured ?? null,
    driver_under_influence: driver.under_influence_of_intoxication ?? null,
    driving_licence_no: driver.driving_license_no ?? null,
    licence_issuing_authority: driver.license_issuing_authority ?? null,
    licence_expiry: driver.license_valid_upto_expiry_date ?? null,
    licence_type: driver.license_type_temp_permanent ?? null,
    prior_accident_history: driver.prior_accident_history ?? null,
    charged_by_police: driver.charged_by_police_details ?? null,
    police_report_lodged: police.reported_to_police ?? null,
    declaration_date: declaration.date ?? null,
    declaration_place: declaration.place ?? null,
    signature_present: declaration.signature_present ?? null,
    signature_of_insured: declaration.signature_of_insured ?? null,
    confidence_score: claim.confidenceScore ?? meta.extraction_confidence ?? null,
    status: claim.status ?? null,
  };
}
