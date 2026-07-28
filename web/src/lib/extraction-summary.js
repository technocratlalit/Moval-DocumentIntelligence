import { formatPolicyFieldValue, normalizePolicyResult } from '@/lib/extraction-fields'

export const DOC_TYPES = [
  { id: 'RC', label: 'RC', purpose: 'rc' },
  { id: 'DL', label: 'DL', purpose: 'dl' },
  { id: 'WORKSHOP', label: 'Workshop', purpose: 'workshop' },
  { id: 'POLICY', label: 'Insurance Policy', purpose: 'policy' },
  { id: 'CLAIM', label: 'Claim Form', purpose: 'claim' },
]

export function getDocMeta(type) {
  return DOC_TYPES.find((d) => d.id === type) ?? DOC_TYPES[0]
}

export function defaultMode(documentType) {
  return documentType === 'RC' || documentType === 'DL' ? 'sync' : 'async'
}

export function rowSummary(job) {
  const r = job.result ?? {}
  const uploads = job.uploadIds ?? []
  const fileName = uploads[0]?.originalName ?? job.urls?.[0]?.split('/').pop() ?? '—'

  switch (job.documentType) {
    case 'RC':
      return {
        fileName,
        primary: r.registrationNo ?? '—',
        secondary: r.ownerName ?? '—',
        tertiary: r.vehicleClass ?? r.state ?? '—',
        confidence: r.confidenceScore,
      }
    case 'DL':
      return {
        fileName,
        primary: r.dlNumber ?? '—',
        secondary: r.name ?? '—',
        tertiary: r.validityNT ?? r.validityT ?? '—',
        confidence: r.confidenceScore,
      }
    case 'WORKSHOP': {
      const lineItemCount = r.lineItemsTable?.length ?? 0
      const partsCount = r.partsTable?.length ?? 0
      const labourCount = r.labourTable?.length ?? 0
      const detail = lineItemCount > 0
        ? `${lineItemCount} line items`
        : `${partsCount} parts · ${labourCount} labour`
      return {
        fileName,
        primary: r.invoiceNo ?? r.jobCardNo ?? r.workshopDetails?.invoiceNumber ?? '—',
        secondary: r.vehicleNo ?? r.vehicleNumber ?? r.workshopDetails?.vehicleNumber ?? '—',
        tertiary: r.summary?.grandTotal != null
          ? `₹${r.summary.grandTotal}`
          : detail,
        confidence: r.confidenceScore,
      }
    }
    case 'POLICY': {
      const p = normalizePolicyResult(r)
      const reg = p.registrationNo
      const premium = p.grossPremiumPaid != null
        ? formatPolicyFieldValue('grossPremiumPaid', p.grossPremiumPaid)
        : null
      const detail = [reg, premium].filter(Boolean).join(' · ')
      return {
        fileName,
        primary: p.policyNumber ?? '—',
        secondary: p.insurerName ?? '—',
        tertiary: detail || '—',
        confidence: p.confidenceScore,
      }
    }
    case 'CLAIM': {
      const d = r.display ?? {}
      const p = r.policy_details ?? {}
      const i = r.insured_details ?? {}
      const v = r.vehicle_details ?? {}
      const l = r.loss_details ?? {}
      return {
        fileName,
        primary: d.policy_no ?? p.policy_no ?? '—',
        secondary: d.insured_name ?? i.name ?? '—',
        tertiary: d.date_of_accident ?? l.date_of_loss ?? d.vehicle_regd_no ?? v.registration_no ?? '—',
        confidence: r.confidenceScore,
      }
    }
    default:
      return { fileName, primary: '—', secondary: '—', tertiary: '—', confidence: null }
  }
}

export function flattenScalars(obj, prefix = '') {
  if (!obj || typeof obj !== 'object') return []
  const rows = []
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value == null) continue
    if (Array.isArray(value)) {
      if (value.length === 0) continue
      if (typeof value[0] !== 'object') rows.push({ key: path, value: value.join(', ') })
      continue
    }
    if (typeof value === 'object') continue
    rows.push({ key: path, value: String(value) })
  }
  return rows.sort((a, b) => a.key.localeCompare(b.key))
}
