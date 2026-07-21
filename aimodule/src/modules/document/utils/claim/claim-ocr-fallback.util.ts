function isEmpty(val: unknown): boolean {
  return val == null || val === '' || val === 'null';
}

/** Fill missing canonical fields from OCR plain text when Gemini misses them. */
export function applyClaimOcrFallback(
  raw: Record<string, unknown>,
  ocrText: string,
): Record<string, unknown> {
  const out = { ...raw };
  const text = ocrText.replace(/\r/g, '');

  if (isEmpty(out.policyNo)) {
    const m = text.match(
      /(?:policy\s*no\.?|cover\s*note\s*no\.?)[\s.:]*([A-Z0-9][A-Z0-9\/\-\s]{4,})/i,
    );
    if (m) out.policyNo = m[1].replace(/\s+/g, '').trim();
  }

  if (isEmpty(out.registrationNo)) {
    const m = text.match(
      /(?:regd\.?\s*no\.?|registration\s*no\.?|reg\.?\s*no\.?)[\s.:]*([A-Z]{2}\s*\d{1,2}\s*[A-Z]{1,3}\s*\d{3,4})/i,
    );
    if (m) out.registrationNo = m[1].replace(/\s+/g, ' ').trim();
  }

  if (isEmpty(out.dateOfLoss)) {
    const m = text.match(
      /(?:date\s*of\s*(?:accident|loss)|date\s*of\s*occurrence)[\s.:]*(\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4})/i,
    );
    if (m) out.dateOfLoss = m[1].trim();
  }

  if (isEmpty(out.insuredName)) {
    const m = text.match(
      /(?:name\s*of\s*the\s*insured|insured\s*name)[\s.:]*([A-Z][A-Z.\s]{2,40})/i,
    );
    if (m) out.insuredName = m[1].trim();
  }

  if (isEmpty(out.engineNo)) {
    const m = text.match(/(?:engine\s*no\.?)[\s.:]*([A-Z0-9]{6,20})/i);
    if (m) out.engineNo = m[1].trim();
  }

  if (isEmpty(out.chassisNo)) {
    const m = text.match(/(?:chassis\s*no\.?)[\s.:]*([A-Z0-9]{10,20})/i);
    if (m) out.chassisNo = m[1].trim();
  }

  if (isEmpty(out.driverName)) {
    const m = text.match(
      /(?:name\s*(?:&|and)\s*address\s*of\s*the\s*driver|driver\s*name)[\s.:]*([A-Z][A-Z.\s]{2,40})/i,
    );
    if (m) out.driverName = m[1].trim();
  }

  return out;
}

export function hasClaimIdentityFields(fields: {
  policyNo?: string | null;
  registrationNo?: string | null;
  dateOfLoss?: string | null;
  claimNo?: string | null;
  insuredName?: string | null;
  engineNo?: string | null;
  driverName?: string | null;
  chassisNo?: string | null;
}): boolean {
  return [
    fields.policyNo,
    fields.registrationNo,
    fields.dateOfLoss,
    fields.claimNo,
    fields.insuredName,
    fields.engineNo,
    fields.driverName,
    fields.chassisNo,
  ].some((v) => !isEmpty(v));
}
