import { mapApiError, testerClient, unwrap } from './client'

export { mapApiError as mapTesterError }

export async function testerLogin(password) {
  const { data } = await testerClient.post('/api/v1/auth/login', { password })
  return unwrap({ data })
}

export async function testerLogout() {
  try {
    await testerClient.post('/api/v1/auth/logout')
  } catch {}
}

export async function testerCheckSession() {
  const { data } = await testerClient.get('/api/v1/auth/me')
  return unwrap({ data })
}

export async function testTesterHealth() {
  const start = performance.now()
  try {
    const { data } = await testerClient.get('/health')
    return {
      ok: Boolean(data?.ok),
      version: data?.version ?? null,
      status: 200,
      message: data?.ok ? `Portal v${data.version} online` : 'Portal offline',
      latencyMs: Math.round(performance.now() - start),
      checkedAt: new Date().toISOString(),
    }
  } catch (error) {
    return {
      ok: false,
      version: null,
      status: error.response?.status ?? 0,
      message: mapApiError(error),
      latencyMs: null,
      checkedAt: new Date().toISOString(),
    }
  }
}

export async function requestUploadUrl(filename, contentType, purpose) {
  return unwrap(await testerClient.post('/api/v1/upload/request-url', { filename, contentType, purpose }))
}

export async function saveUploadRecord(body) {
  return unwrap(await testerClient.post('/api/v1/upload', body))
}

export async function uploadFile(file, purpose) {
  const { uploadUrl, publicUrl, publicId } = await requestUploadUrl(file.name, file.type, purpose)
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type },
  })
  if (!putRes.ok) throw new Error(`Upload to storage failed (${putRes.status})`)
  return saveUploadRecord({
    url: publicUrl,
    publicId,
    originalName: file.name,
    mimeType: file.type,
    size: file.size,
    purpose,
  })
}

export async function listUploads(purpose) {
  return unwrap(await testerClient.get('/api/v1/upload', { params: purpose ? { purpose } : {} }))
}

export async function deleteUpload(id) {
  return unwrap(await testerClient.delete(`/api/v1/upload/${id}`))
}

export async function startExtraction({ documentType, uploadIds, urls, mode, priority }) {
  return unwrap(await testerClient.post('/api/v1/extractions', {
    documentType,
    uploadIds,
    urls,
    mode,
    priority,
  }))
}

export async function listExtractions({ type, page = 1, limit = 20 } = {}) {
  return unwrap(await testerClient.get('/api/v1/extractions', { params: { type, page, limit } }))
}

export async function getExtraction(id) {
  return unwrap(await testerClient.get(`/api/v1/extractions/${id}`))
}

export async function deleteExtraction(id) {
  const jobId = String(id ?? '').trim()
  if (!jobId) throw new Error('Missing extraction id.')
  return unwrap(await testerClient.delete(`/api/v1/extractions/${encodeURIComponent(jobId)}`))
}
