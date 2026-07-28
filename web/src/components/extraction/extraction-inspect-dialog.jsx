import { useMemo } from 'react'
import { CopyIcon } from 'lucide-react'
import { buildInspectViews } from '@/lib/extraction-fields'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

function formatJson(value) {
  return JSON.stringify(value, null, 2)
}

function FieldTable({ rows }) {
  if (!rows?.length) {
    return <p className="p-4 text-sm text-muted-foreground">No data.</p>
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[30%] min-w-[200px]">Field</TableHead>
          <TableHead>Value</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ key, value }) => (
          <TableRow key={key}>
            <TableCell className="align-top w-[30%] min-w-[200px] text-sm font-medium text-muted-foreground">
              {key}
            </TableCell>
            <TableCell className="whitespace-pre-wrap wrap-break-word text-sm">{value}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function formatColumnLabel(col) {
  const labels = { name: 'Cover name', opted: 'Opted' }
  return labels[col] ?? col
}

function ArrayTable({ columns, rows }) {
  if (!rows?.length) {
    return <p className="p-4 text-sm text-muted-foreground">No rows.</p>
  }
  const cols = columns?.length ? columns : Object.keys(rows[0] ?? {})
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {cols.map((col) => (
            <TableHead key={col} className="min-w-[100px]">{formatColumnLabel(col)}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, idx) => (
          <TableRow key={idx}>
            {cols.map((col) => (
              <TableCell key={col} className="text-sm">
                {row[col] ?? '—'}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function ExtractionInspectDialog({ job, onClose, onCopyJson }) {
  const { tabs, defaultTab } = useMemo(
    () => buildInspectViews(job?.documentType, job?.result),
    [job?.documentType, job?.result],
  )

  return (
    <Dialog open={Boolean(job)} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="flex h-[92vh] w-[96vw] max-w-[1200px] sm:max-w-[1200px] flex-col gap-0 overflow-hidden p-0">
        {/* Fixed header — always visible */}
        <div className="shrink-0 border-b px-5 py-4">
          <p className="text-base font-semibold leading-none">Extraction result</p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {job?.documentType} · {job?.correlationId}
          </p>
          {job?.status === 'failed' && (
            <p className="mt-2 text-sm text-destructive">{job.error ?? 'Extraction failed'}</p>
          )}
        </div>

        {/* Tabs — fill remaining height, only content scrolls */}
        <Tabs defaultValue={defaultTab} className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Scrollable single-row tab bar */}
          <div className="shrink-0 overflow-x-auto border-b">
            <TabsList className="inline-flex h-9 w-max rounded-none border-0 bg-transparent p-0">
              {tabs.map((tab) => (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className="h-9 shrink-0 cursor-pointer rounded-none border-b-2 border-transparent px-3 text-xs font-medium data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground"
                >
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {/* Scrollable content area */}
          <div className="min-h-0 flex-1 overflow-auto">
            {tabs.map((tab) => (
              <TabsContent
                key={tab.id}
                value={tab.id}
                className="mt-0 data-[state=inactive]:hidden"
              >
                {tab.kind === 'fields' && <FieldTable rows={tab.rows} />}
                {tab.kind === 'table' && <ArrayTable columns={tab.columns} rows={tab.rows} />}
                {tab.kind === 'claim_debug' && (
                  <div className="space-y-4 p-3">
                    <FieldTable rows={tab.overviewRows} />
                    {tab.pairRows?.length > 0 && (
                      <>
                        <p className="text-sm font-medium">Raw OCR pairs</p>
                        <ArrayTable columns={['section', 'label', 'value']} rows={tab.pairRows} />
                      </>
                    )}
                    {tab.postprocessDiff?.length > 0 && (
                      <>
                        <p className="text-sm font-medium">Postprocess changes</p>
                        <ArrayTable
                          columns={['path', 'before', 'after']}
                          rows={tab.postprocessDiff.map((d) => ({
                            path: d.path,
                            before: String(d.before ?? '—'),
                            after: String(d.after ?? '—'),
                          }))}
                        />
                      </>
                    )}
                  </div>
                )}
                {tab.kind === 'json' && (
                  <pre className="whitespace-pre-wrap break-all bg-muted/40 p-3 font-mono text-xs">
                    {formatJson(job?.result ?? job)}
                  </pre>
                )}
              </TabsContent>
            ))}
          </div>
        </Tabs>

        {/* Fixed footer — always visible */}
        <div className="shrink-0 border-t px-5 py-3 flex justify-end">
          <Button variant="outline" size="sm" onClick={() => job && onCopyJson(job)}>
            <CopyIcon /> Copy JSON
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
