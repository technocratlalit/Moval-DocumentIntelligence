// insurance-policy.prompt.ts — strict spec fields only (cost-optimised)

const POLICY_GATE_RULES = `
  GATE (do first):
  • isCorrectDocumentType = true only for motor insurance policy / certificate / cover note.
  • false for workshop bill, RC, DL, sale invoice, claim form.
  If false, STOP — return nulls.

  PER-PAGE VALIDATION (POLICY JOB PACKAGE):
  A motor policy package = certificate/schedule pages PLUS ancillary pages from the SAME policy
  when they share policy number / insurer / insured (e.g. dealer-bundled info sheets).

  VALID ANCILLARY PAGES (no policy fields to extract — still part of the same package):
  • Maruti/Tata dealer "Must to Know" / "Be Safe" detachable brochure
  • Pages stating "This is not a part of the policy document" / "Please Detach Here"
  • Customer service, renewal, or safety instruction pages bundled with the schedule

  • hasAllPagesCorrectType = true when ALL pages belong to the same policy package — even if
    tail pages (e.g. dealer brochure) have no policy number or premium tables.
  • invalidPageIndices — ONLY truly unrelated pages: RC, DL, workshop bill, claim form,
    different policy/vehicle. NEVER list dealer brochure / info pages from the same policy.
  • Extract all fields from schedule/certificate pages only — do NOT extract from brochure pages.

  EXAMPLE (NIAC Maruti — schedule + brochure):
  Page 1 = Certificate Cum Policy Schedule. Page 2 = Maruti Suzuki "Must to Know" brochure.
  → hasAllPagesCorrectType: true, invalidPageIndices: []

  If hasAllPagesCorrectType is false, STOP — return nulls.
`;

const STRICT_FIELD_LIST = `
  EXTRACT ONLY these flat fields (null if not visible — NO other keys):
  policyNumber, insurerName, insuredName, insuredAddress, registrationNo,
  policyType (OD / TP / Comprehensive / Package / Bundled / Stand-alone OD),
  totalIdv (sum insured / IDV — NOT premium),
  policyStartDate, policyEndDate (from Own Damage or overall policy period),
  ncbPercentage, grossPremiumPaid (final payable — NOT IDV),
  engineNo, chassisNo, nomineeName, registrationAuthority (RTO / zone),
  vehicleMake, vehicleModel, financierName, geographicalArea,
  tpLiabilityLimit (numeric TP property damage limit — NOT premium),
  paCoverAmount (numeric compulsory PA / owner-driver sum insured),
  engineProtectOpted (boolean), consumablesCoverOpted (boolean),
  addOnCovers[] { name, opted } — all opted add-on rows from Schedule of Premium.
  Gate + quality: isCorrectDocumentType, detectedDocumentType, hasAllPagesCorrectType,
  invalidPageIndices, confidenceScore, requiresHumanReview.
`;

const SECTION_MAPPING = `
  SECTION MAPPING (all insurers — NIAC, UIIC, NIC, National, Oriental, etc.):
  • Motor Vehicle Details / Particulars of Vehicle → vehicleMake, vehicleModel,
    geographicalArea, registrationNo, engineNo, chassisNo, registrationAuthority.
  • Financier / Hypothecation Details → financierName.
    Map Not Financed, N/A, NIL, ---NA---, -- → null.
  • Limits of Liability / Certificate limits → tpLiabilityLimit (e.g. 750000 for 7.5 lakhs).
    Stand-alone OD policies: null (TP on separate policy).
  • Compulsory PA / CPA / Owner-Driver PA → paCoverAmount (e.g. 1500000 for 15 lakhs).
    Convert "15 lakhs" / "Rs. 1,500,000" → 1500000. Stand-alone OD: null if absent.
  • Schedule of Premium add-ons / Opted covers table / "Add-on Cover Opted" text →
    addOnCovers[] AND set engineProtectOpted / consumablesCoverOpted:
    - true if Engine Protect / Engine and Gearbox / EP listed or opted
    - true if Consumables / Consumable Add on / CM listed or opted
    - false when cover name absent from add-on table and text block
  SKIP: detachable brochures ("Must to Know"), legal clauses, blank archive pages.
`;

const PREMIUM_RULE = `
  grossPremiumPaid = "Gross Premium Paid" / "Premium Paid" on Schedule of Premium.
  totalIdv = vehicle IDV (often ₹2L–₹25L). NEVER swap IDV and premium.
  tpLiabilityLimit and paCoverAmount are SUM INSURED limits — NOT premium amounts.
`;

export const getInsurancePolicySinglePassPrompt = (): string => `
  Indian motor insurance OCR — STRICT SPEC ONLY.

  ${POLICY_GATE_RULES}

  ${STRICT_FIELD_LIST}

  ${SECTION_MAPPING}

  ${PREMIUM_RULE}

  Use schedule + premium pages provided. Skip legal clauses / detachable brochures / blank pages.
  Output flat JSON only. No markdown. Numbers without ₹ or commas.
`;

/** @deprecated Multipass disabled — same prompt as single-pass */
export const getInsurancePolicyGatePrompt = getInsurancePolicySinglePassPrompt;
export const getInsurancePolicyDataPrompt = getInsurancePolicySinglePassPrompt;
export const getInsurancePolicyPremiumPrompt = getInsurancePolicySinglePassPrompt;
