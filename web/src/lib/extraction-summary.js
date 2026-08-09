import { formatPolicyFieldValue, normalizePolicyResult } from '@/lib/extraction-fields'

export const DOC_TYPES = [
  { id: 'RC', label: 'RC', purpose: 'rc' },
  { id: 'DL', label: 'DL', purpose: 'dl' },
  { id: 'POLICY', label: 'Insurance Policy', purpose: 'policy' },
  { id: 'CLAIM', label: 'Claim Form', purpose: 'claim' },
  { id: 'WORKSHOP', label: 'Workshop Bill', purpose: 'workshop' },
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
    case 'POLICY': {
      const p = normalizePolicyResult(r)
      const reg = p.registrationNo
      const vehicle = [p.vehicleMake, p.vehicleModel].filter(Boolean).join(' ')
      const premium = p.grossPremiumPaid != null
        ? formatPolicyFieldValue('grossPremiumPaid', p.grossPremiumPaid)
        : null
      const detail = [reg, vehicle || null, premium].filter(Boolean).join(' · ')
      return {
        fileName,
        primary: p.policyNumber ?? '—',
        secondary: p.insurerName ?? '—',
        tertiary: detail || '—',
        confidence: p.confidenceScore,
      }
    }
    case 'CLAIM':
      return {
        fileName,
        primary: r.policyNumber ?? '—',
        secondary: r.insuredName ?? '—',
        tertiary: r.accidentDate ?? r.registrationNo ?? '—',
        confidence: r.additionalData?.confidenceScore ?? r.confidenceScore,
      }
    case 'WORKSHOP': {
      const d = r.workshopDetails ?? {}
      const partsRows = r.parts?.rows?.length ?? 0
      const labourRows = r.labour?.rows?.length ?? 0
      const docType = r.documentType ? `${r.documentType} · ` : ''
      return {
        fileName,
        primary: d.invoiceNumber ?? d.documentTitle ?? '—',
        secondary: d.vehicleNumber ?? d.name ?? '—',
        tertiary: `${docType}Parts ${partsRows} · Labour ${labourRows}`,
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
