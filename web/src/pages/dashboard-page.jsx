import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from 'recharts'
import { RefreshCwIcon } from 'lucide-react'
import { toast } from 'sonner'
import { getQueueHealth, mapApiError } from '@/api/admin'
import { HealthCheckCard } from '@/components/health/health-status'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const chartConfig = { waiting: { label: 'Waiting', color: 'var(--chart-1)' } }

const BAR_COLORS = {
  rc: 'hsl(221 83% 53%)',
  dl: 'hsl(142 71% 45%)',
  insurance: 'hsl(271 81% 56%)',
  'dead-letter': 'hsl(0 72% 51%)',
}

function StatCard({ title, value, description, loading }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">
          {loading ? <Skeleton className="h-8 w-16" /> : value}
        </CardTitle>
      </CardHeader>
      {description && <CardContent><p className="text-xs text-muted-foreground">{description}</p></CardContent>}
    </Card>
  )
}

export function DashboardPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchHealth = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    try {
      setData(await getQueueHealth())
    } catch (error) {
      toast.error(mapApiError(error))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { fetchHealth() }, [fetchHealth])
  useEffect(() => {
    const interval = setInterval(() => fetchHealth(true), 30_000)
    return () => clearInterval(interval)
  }, [fetchHealth])

  const stats = useMemo(() => {
    if (!data?.queues) return { waiting: 0, active: 0, overloaded: 0, dlqDepth: 0 }
    const docQueues = data.queues.filter((q) => q.queueName !== 'dead-letter-queue')
    const dlq = data.queues.find((q) => q.queueName === 'dead-letter-queue')
    return {
      waiting: docQueues.reduce((s, q) => s + q.waiting, 0),
      active: docQueues.reduce((s, q) => s + q.active, 0),
      overloaded: data.queues.filter((q) => q.overloaded).length,
      dlqDepth: dlq?.waiting ?? 0,
    }
  }, [data])

  const chartData = useMemo(
    () => data?.queues?.map((q) => ({ name: q.queueName.replace('-queue', ''), waiting: q.waiting })) ?? [],
    [data],
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Queue health</h2>
          <p className="text-sm text-muted-foreground">docs-intelligence BullMQ queues</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => fetchHealth(true)} disabled={refreshing}>
          <RefreshCwIcon className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </Button>
      </div>
      <HealthCheckCard />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Waiting jobs" value={stats.waiting} loading={loading} />
        <StatCard title="Active jobs" value={stats.active} loading={loading} />
        <StatCard title="Overloaded queues" value={stats.overloaded} description={`Limit: ${data?.maxQueueSize ?? '—'}`} loading={loading} />
        <StatCard title="DLQ depth" value={stats.dlqDepth} description={`Threshold: ${data?.dlqThreshold ?? '—'}`} loading={loading} />
      </div>
      <Card>
        <CardHeader><CardTitle>Waiting by queue</CardTitle></CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-[240px] w-full" /> : (
            <ChartContainer config={chartConfig} className="aspect-auto h-[240px] w-full">
              <BarChart data={chartData}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="waiting" radius={4}>
                  {chartData.map((entry) => (
                    <Cell key={entry.name} fill={BAR_COLORS[entry.name] ?? 'var(--color-waiting)'} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>All queues</CardTitle></CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-40 w-full" /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Queue</TableHead>
                  <TableHead className="text-right">Waiting</TableHead>
                  <TableHead className="text-right">Active</TableHead>
                  <TableHead className="text-right">Delayed</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.queues?.map((q) => (
                  <TableRow key={q.queueName}>
                    <TableCell className="font-medium">{q.queueName}</TableCell>
                    <TableCell className="text-right tabular-nums">{q.waiting}</TableCell>
                    <TableCell className="text-right tabular-nums">{q.active}</TableCell>
                    <TableCell className="text-right tabular-nums">{q.delayed}</TableCell>
                    <TableCell className="text-right tabular-nums">{q.failed}</TableCell>
                    <TableCell>
                      <Badge variant={q.overloaded ? 'destructive' : 'secondary'}>
                        {q.overloaded ? 'Overloaded' : 'Healthy'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
