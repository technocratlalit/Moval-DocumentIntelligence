import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BracesIcon, CopyIcon, ExternalLinkIcon, FlaskConicalIcon, MoreVerticalIcon,
  RefreshCwIcon, Trash2Icon, UploadIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { mapTesterError as mapApiError, deleteExtraction, deleteUpload, getExtraction, listExtractions, listUploads, startExtraction, uploadFile } from '@/api/test-backend'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ExtractionInspectDialog } from '@/components/extraction/extraction-inspect-dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { defaultMode, getDocMeta, rowSummary } from '@/lib/extraction-summary'

const STATUS_VARIANT = {
  completed: 'secondary',
  failed: 'destructive',
  queued: 'outline',
  processing: 'outline',
}

function formatTokens(job) {
  if (job.totalTokens != null) return job.totalTokens.toLocaleString()
  if (job.cached) return '0'
  return '—'
}

function formatCost(job) {
  if (job.totalCostINR != null) return `₹${job.totalCostINR.toFixed(4)}`
  if (job.cached) return '₹0.0000'
  return '—'
}

function resolveMode(docType, modeChoice) {
  if (modeChoice === 'sync' || modeChoice === 'async') return modeChoice
  return defaultMode(docType)
}

function resolveRecordId(record) {
  return String(record?._id ?? record?.id ?? '').trim()
}

export function DocTestPage({ docType }) {
  const [modeChoice, setModeChoice] = useState('auto')
  const [priority, setPriority] = useState('normal')
  const [files, setFiles] = useState([])
  const [savedUploads, setSavedUploads] = useState([])
  const [selectedUploadIds, setSelectedUploadIds] = useState([])
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [deletingJobId, setDeletingJobId] = useState(null)
  const [pendingDeleteUpload, setPendingDeleteUpload] = useState(null)
  const [pendingDeleteJob, setPendingDeleteJob] = useState(null)
  const [inspectJob, setInspectJob] = useState(null)
  const fileInputRef = useRef(null)

  const docMeta = getDocMeta(docType)
  const hasPending = jobs.some((j) => j.status === 'queued' || j.status === 'processing')
  const historyColumns = docType === 'POLICY'
    ? { tertiary: 'Vehicle · Premium' }
    : { tertiary: 'Detail' }

  const fetchJobs = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    try {
      const result = await listExtractions({ type: docType, limit: 50 })
      setJobs(result.items ?? [])
    } catch (error) {
      toast.error(mapApiError(error))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [docType])

  const fetchUploads = useCallback(async () => {
    try {
      const items = await listUploads(docMeta.purpose)
      setSavedUploads(Array.isArray(items) ? items : [])
    } catch (error) {
      toast.error(mapApiError(error))
    }
  }, [docMeta.purpose])

  useEffect(() => { fetchJobs() }, [fetchJobs])
  useEffect(() => { fetchUploads() }, [fetchUploads])

  useEffect(() => {
    if (!hasPending) return undefined
    const interval = setInterval(() => fetchJobs(true), 3000)
    return () => clearInterval(interval)
  }, [hasPending, fetchJobs])

  async function handleUpload() {
    if (!files.length) {
      toast.error('Choose at least one file to upload.')
      return
    }
    setUploading(true)
    try {
      await Promise.all(files.map((f) => uploadFile(f, docMeta.purpose)))
      toast.success(`${files.length} file(s) uploaded to R2 and saved.`)
      setFiles([])
      if (fileInputRef.current) fileInputRef.current.value = ''
      await fetchUploads()
    } catch (error) {
      toast.error(mapApiError(error))
    } finally {
      setUploading(false)
    }
  }

  async function handleExtract() {
    if (!selectedUploadIds.length) {
      toast.error('Select one or more uploaded files, then click Extract.')
      return
    }
    setExtracting(true)
    try {
      const mode = resolveMode(docType, modeChoice)
      await startExtraction({
        documentType: docType,
        uploadIds: selectedUploadIds,
        mode,
        priority,
      })
      toast.success('Extraction started.')
      setSelectedUploadIds([])
      await fetchJobs(true)
    } catch (error) {
      toast.error(mapApiError(error))
    } finally {
      setExtracting(false)
    }
  }

  async function handleConfirmDeleteUpload() {
    if (!pendingDeleteUpload) return
    const uploadId = resolveRecordId(pendingDeleteUpload)
    if (!uploadId) {
      toast.error('Could not delete: missing upload id.')
      return
    }
    setDeletingId(uploadId)
    try {
      await deleteUpload(uploadId)
      toast.success(`Deleted ${pendingDeleteUpload.originalName}.`)
      setSelectedUploadIds((prev) => prev.filter((id) => id !== uploadId))
      setPendingDeleteUpload(null)
      await fetchUploads()
    } catch (error) {
      toast.error(mapApiError(error))
    } finally {
      setDeletingId(null)
    }
  }

  async function handleConfirmDeleteJob() {
    if (!pendingDeleteJob) return
    const jobId = resolveRecordId(pendingDeleteJob)
    if (!jobId) {
      toast.error('Could not delete: missing extraction id.')
      return
    }
    setDeletingJobId(jobId)
    try {
      await deleteExtraction(jobId)
      toast.success('Extraction record deleted.')
      if (resolveRecordId(inspectJob) === jobId) setInspectJob(null)
      setJobs((prev) => prev.filter((j) => resolveRecordId(j) !== jobId))
      setPendingDeleteJob(null)
    } catch (error) {
      toast.error(mapApiError(error))
    } finally {
      setDeletingJobId(null)
    }
  }

  async function copyUrl(url) {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('URL copied.')
    } catch {
      toast.error('Could not copy URL.')
    }
  }

  function toggleUploadSelection(id) {
    setSelectedUploadIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  async function refreshJob(job) {
    try {
      const updated = await getExtraction(job._id)
      setJobs((prev) => prev.map((j) => (j._id === updated._id ? updated : j)))
      if (inspectJob?._id === updated._id) setInspectJob(updated)
    } catch (error) {
      toast.error(mapApiError(error))
    }
  }

  async function copyJson(job) {
    try {
      await navigator.clipboard.writeText(formatJson(job.result ?? job))
      toast.success('Copied JSON.')
    } catch {
      toast.error('Could not copy.')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{docMeta.label} Tester</h2>
          <p className="text-sm text-muted-foreground">Upload → extract → view results in table</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => fetchJobs(true)} disabled={refreshing}>
          <RefreshCwIcon className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </Button>
      </div>

      <Card>
          <CardHeader>
            <CardTitle className="text-base">1. Upload to R2</CardTitle>
            <CardDescription>
              Upload {docMeta.label} files — they are stored in R2 and saved in MongoDB with a public URL.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="grid w-full max-w-md gap-2">
                <Label htmlFor="doc-file">PDF or image</Label>
                <Input
                  id="doc-file"
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,image/*"
                  multiple={docType === 'RC' || docType === 'DL'}
                  disabled={uploading || extracting}
                  className="cursor-pointer"
                  onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                />
                {files.length > 0 && (
                  <p className="text-xs text-muted-foreground">{files.map((f) => f.name).join(', ')}</p>
                )}
              </div>
              <Button onClick={handleUpload} disabled={uploading || !files.length}>
                {uploading ? 'Uploading…' : <><UploadIcon /> Upload</>}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Select & extract</CardTitle>
            <CardDescription>
              Pick uploaded files, set mode/priority, then run extraction via aimodule.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-4">
              <div className="grid gap-2">
                <Label htmlFor="extract-mode">Mode</Label>
                <NativeSelect id="extract-mode" value={modeChoice} onChange={(e) => setModeChoice(e.target.value)} disabled={extracting}>
                  <NativeSelectOption value="auto">Auto (RC/DL sync, Workshop/Policy async)</NativeSelectOption>
                  <NativeSelectOption value="sync">Sync — wait for result</NativeSelectOption>
                  <NativeSelectOption value="async">Async — webhook</NativeSelectOption>
                </NativeSelect>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="extract-priority">Priority</Label>
                <NativeSelect id="extract-priority" value={priority} onChange={(e) => setPriority(e.target.value)} disabled={extracting}>
                  <NativeSelectOption value="normal">Normal</NativeSelectOption>
                  <NativeSelectOption value="urgent">Urgent</NativeSelectOption>
                  <NativeSelectOption value="low">Low</NativeSelectOption>
                </NativeSelect>
              </div>
              <div className="flex items-end">
                <Button
                  onClick={handleExtract}
                  disabled={extracting || !selectedUploadIds.length}
                >
                  {extracting ? 'Extracting…' : 'Extract selected'}
                </Button>
              </div>
            </div>

            {savedUploads.length === 0 ? (
              <Empty className="border py-6">
                <EmptyHeader>
                  <EmptyMedia variant="icon"><UploadIcon /></EmptyMedia>
                  <EmptyTitle>No uploads yet</EmptyTitle>
                  <EmptyDescription>Upload a file above — it will appear here with its URL.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>File</TableHead>
                    <TableHead>URL</TableHead>
                    <TableHead>Uploaded</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {savedUploads.map((u) => (
                    <TableRow key={u._id} data-selected={selectedUploadIds.includes(u._id)}>
                      <TableCell>
                        <input
                          type="checkbox"
                          className="cursor-pointer"
                          checked={selectedUploadIds.includes(u._id)}
                          onChange={() => toggleUploadSelection(u._id)}
                          disabled={extracting || deletingId === u._id}
                          aria-label={`Select ${u.originalName}`}
                        />
                      </TableCell>
                      <TableCell className="max-w-[160px] truncate font-medium">{u.originalName}</TableCell>
                      <TableCell>
                        <a
                          href={u.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex cursor-pointer text-primary hover:text-primary/80"
                          aria-label={`Open ${u.originalName}`}
                          title={u.url}
                        >
                          <ExternalLinkIcon className="size-4" />
                        </a>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {u.createdAt ? new Date(u.createdAt).toLocaleString() : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon-sm" onClick={() => copyUrl(u.url)} aria-label="Copy URL">
                            <CopyIcon />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setPendingDeleteUpload(u)}
                            disabled={deletingId === u._id || extracting}
                            aria-label="Delete file"
                          >
                            <Trash2Icon className="text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>3. Extraction history</CardTitle>
            <CardDescription>{docMeta.label} jobs from MongoDB</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-40 w-full" />
            ) : jobs.length === 0 ? (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyMedia variant="icon"><FlaskConicalIcon /></EmptyMedia>
                  <EmptyTitle>No extractions yet</EmptyTitle>
                  <EmptyDescription>Upload a document and run extract.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>{historyColumns.tertiary}</TableHead>
                    <TableHead>Confidence</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Completed At</TableHead>
                    <TableHead>Total Tokens</TableHead>
                    <TableHead>Cost (₹)</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((job) => {
                    const s = rowSummary(job)
                    return (
                      <TableRow key={job._id}>
                        <TableCell className="max-w-[140px] truncate text-sm">{s.fileName}</TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANT[job.status] ?? 'outline'}>{job.status}</Badge>
                        </TableCell>
                        <TableCell className="max-w-[120px] truncate">{s.tertiary}</TableCell>
                        <TableCell className="tabular-nums">
                          {s.confidence != null ? s.confidence.toFixed(2) : '—'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {job.createdAt ? new Date(job.createdAt).toLocaleString() : '—'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {job.completedAt ? new Date(job.completedAt).toLocaleString() : '—'}
                        </TableCell>
                        <TableCell className="tabular-nums text-xs">
                          {formatTokens(job)}
                        </TableCell>
                        <TableCell className="tabular-nums text-xs">
                          {formatCost(job)}
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon-sm" aria-label="Job actions">
                                <MoreVerticalIcon />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setInspectJob(job)}>
                                <BracesIcon /> View result
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => refreshJob(job)}>
                                <RefreshCwIcon /> Refresh status
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => copyJson(job)}>
                                <CopyIcon /> Copy JSON
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                disabled={deletingJobId === job._id}
                                onClick={() => setPendingDeleteJob(job)}
                              >
                                <Trash2Icon /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      <ExtractionInspectDialog
        job={inspectJob}
        onClose={() => setInspectJob(null)}
        onCopyJson={copyJson}
      />

      <AlertDialog
        open={Boolean(pendingDeleteUpload)}
        onOpenChange={(open) => { if (!open && !deletingId) setPendingDeleteUpload(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete uploaded file?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes <span className="font-medium">{pendingDeleteUpload?.originalName}</span> from
              storage and MongoDB. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(deletingId)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={Boolean(deletingId)}
              onClick={(e) => { e.preventDefault(); handleConfirmDeleteUpload() }}
            >
              {deletingId ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(pendingDeleteJob)}
        onOpenChange={(open) => { if (!open && !deletingJobId) setPendingDeleteJob(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete extraction record?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the extraction history for{' '}
              <span className="font-medium">{rowSummary(pendingDeleteJob ?? {}).fileName}</span>{' '}
              from MongoDB. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(deletingJobId)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={Boolean(deletingJobId)}
              onClick={(e) => { e.preventDefault(); handleConfirmDeleteJob() }}
            >
              {deletingJobId ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
