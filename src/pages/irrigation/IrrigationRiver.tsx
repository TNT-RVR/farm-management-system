import { DateField } from '@/components/DateField'
import { useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ArrowDown, ArrowUp, ExternalLink, Minus, Waves } from 'lucide-react'
import { useRiverFlow, useRiverSeries } from '@/lib/irrigation'
import { useRanches, useSetRanch, type Ranch } from '@/lib/ranches'
import {
  combineHourly,
  estimateLagHours,
  INFLOW_STATIONS,
  mergeDischarge,
  recentTrend,
  stationPageUrl,
  type RiverRanch,
} from '@/lib/river'
import { Select } from '@/components/Select'
import { HelpNote } from '@/components/HelpNote'
import { useWheelZoom } from '@/lib/useWheelZoom'
import { cn } from '@/lib/utils'
import { WaterQualityCard } from './WaterQualityCard'

// The two ranches sit on different water, so the River tab is split by ranch.
//
// Home Ranch draws from the Oldman above its mouth: the dam-controlled inflow
// (Oldman below dam + Belly + St. Mary + Waterton) passes Lethbridge, where the
// irrigation districts divert, and reaches the farm near the mouth.
//
// East Ranch sits BELOW the Oldman–Bow confluence, so the water arriving there
// is the South Saskatchewan — which is why the Bow matters on its own and gets
// its own high-water threshold. Station numbers verified against
// api.weather.gc.ca (names in the comments are the gauges' own).
type Reach = { station: string; short: string; color: string }
type RanchRiver = {
  chartTitle: string
  inflowLabel: string
  inflowStations: { station: string; short: string }[]
  mid: Reach
  home: Reach
  /** Cross-correlated fallback lag (h). Null = don't invent one; show "—". */
  typicalToMid: number | null
  typicalToHome: number | null
  /** East Ranch only: the mid reach carries its own editable threshold. */
  midThresholdColumn?: 'bow_alert_cms'
  footnote: string
}

const RANCH_RIVER: Record<string, RanchRiver> = {
  'Home Ranch': {
    chartTitle: 'Oldman River flow — discharge (m³/s)',
    inflowLabel: 'Combined inflow',
    inflowStations: INFLOW_STATIONS,
    mid: { station: '05AD007', short: 'Lethbridge', color: '#0284c7' },
    home: { station: '05AG006', short: 'Oldman near mouth (farm)', color: '#059669' },
    // From cross-correlating a year of flow (see git history).
    typicalToMid: 22,
    typicalToHome: 40,
    footnote:
      '“Combined inflow” is the summed dam-controlled flow of the Oldman (below its dam) plus the Belly, St. Mary and ' +
      'Waterton. Flow drops before Lethbridge because the irrigation districts divert water; watch the combined-inflow ' +
      'line jump to see a release coming.',
  },
  'East Ranch': {
    chartTitle: 'South Saskatchewan River flow — discharge (m³/s)',
    inflowLabel: 'Oldman + Bow (combined)',
    inflowStations: [
      { station: '05AG006', short: 'Oldman R.' }, // OLDMAN RIVER NEAR THE MOUTH
      { station: '05BN012', short: 'Bow R.' }, // BOW RIVER NEAR THE MOUTH
    ],
    mid: { station: '05BN012', short: 'Bow River near mouth', color: '#0284c7' },
    home: { station: '05AJ001', short: 'S. Sask. at Medicine Hat (farm)', color: '#059669' },
    // No cross-correlated baseline for this reach yet — derive from the loaded
    // window or show "—" rather than publishing a number nobody measured.
    typicalToMid: null,
    typicalToHome: null,
    midThresholdColumn: 'bow_alert_cms',
    footnote:
      'East Ranch sits below the Oldman–Bow confluence, so its water is the South Saskatchewan — the Oldman and the Bow ' +
      'arrive together. The Bow is charted on its own line because a release on it alone can lift the river here, and it ' +
      'carries its own high-water threshold.',
  },
}

const CHAIN = [
  { key: 'inflow', width: 1.75, color: '#7c3aed' },
  { key: 'mid', width: 2.25, color: '#0284c7' },
  { key: 'home', width: 1.5, color: '#059669' },
] as const

type RangeKey = '6h' | '1d' | '3d' | '1w' | '1m' | 'all' | 'custom'
const RANGES: { value: RangeKey; label: string }[] = [
  { value: '6h', label: '6 hours' },
  { value: '1d', label: '1 day' },
  { value: '3d', label: '3 days' },
  { value: '1w', label: '1 week' },
  { value: '1m', label: '1 month' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom…' },
]

const HOUR = 3_600_000
const DAY = 86_400_000

function window(key: RangeKey, customFrom: string, customTo: string): { from: string; to: string; daily: boolean } {
  const now = Date.now()
  const iso = (ms: number) => new Date(ms).toISOString()
  switch (key) {
    case '6h':
      return { from: iso(now - 6 * HOUR), to: iso(now), daily: false }
    case '1d':
      return { from: iso(now - DAY), to: iso(now), daily: false }
    case '3d':
      return { from: iso(now - 3 * DAY), to: iso(now), daily: false }
    case '1w':
      return { from: iso(now - 7 * DAY), to: iso(now), daily: false }
    case '1m':
      return { from: iso(now - 30 * DAY), to: iso(now), daily: false }
    case 'all':
      return { from: '2000-01-01T00:00:00Z', to: iso(now), daily: true }
    case 'custom': {
      const f = customFrom ? new Date(customFrom + 'T00:00:00').getTime() : now - 7 * DAY
      const t = customTo ? new Date(customTo + 'T23:59:59').getTime() : now
      // Realtime only: the live gauge keeps ~30 days and this year's daily-mean
      // history isn't published yet, so anything older simply isn't available
      // (the graph shows a note). Use 'All time' for the long daily record.
      return { from: iso(f), to: iso(t), daily: false }
    }
  }
}

const fmtHrs = (h: number | null | undefined) =>
  h == null ? '—' : h < 1 ? '<1 h' : h < 48 ? `${Math.round(h)} h` : `${(h / 24).toFixed(1)} d`

function TrendIcon({ delta }: { delta: number }) {
  if (delta >= 10) return <ArrowUp className="h-4 w-4 text-red-600" />
  if (delta <= -10) return <ArrowDown className="h-4 w-4 text-sky-600" />
  return <Minus className="h-4 w-4 text-gray-400" />
}

function StationCard({
  short,
  color,
  q,
  level,
  trend,
  isHome,
  station,
  subtext,
  components,
}: {
  short: string
  color: string
  q: number | null
  level?: number | null
  trend: ReturnType<typeof recentTrend>
  isHome?: boolean
  station?: string
  subtext?: string
  components?: { short: string; q: number | null; station: string }[]
}) {
  return (
    <div className={cn('rounded-lg border bg-white p-3', isHome ? 'border-brand-300 ring-1 ring-brand-200' : 'border-gray-200')}>
      <div className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
        <p className="truncate text-xs font-semibold text-gray-700">{short}</p>
        {isHome && <span className="rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">your farm</span>}
        {trend && <TrendIcon delta={trend.deltaPct} />}
        {station && (
          <a
            href={stationPageUrl(station)}
            target="_blank"
            rel="noreferrer"
            title={`Environment Canada station ${station} — source data`}
            aria-label={`Open Environment Canada station ${station} data (new tab)`}
            className="ml-auto shrink-0 text-gray-300 hover:text-brand-700"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
      <p className="mt-1 text-xl font-bold tabular-nums text-gray-900">
        {q != null ? Math.round(q * 10) / 10 : '—'} <span className="text-sm font-normal text-gray-400">m³/s</span>
      </p>
      {components ? (
        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px]">
          {components.map((c) => (
            <a
              key={c.station}
              href={stationPageUrl(c.station)}
              target="_blank"
              rel="noreferrer"
              title={`${c.short} — Environment Canada station ${c.station}`}
              className="inline-flex items-center gap-0.5 text-gray-500 hover:text-brand-700"
            >
              {c.short.replace(/ R\.$/, '').replace(' (below dam)', '')} {c.q ?? '—'}
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          ))}
        </div>
      ) : (
        <p className="truncate text-[11px] text-gray-400">
          {subtext ?? (level != null ? `${level} m` : '—')}
          {trend ? ` · ${trend.deltaPct >= 0 ? '+' : ''}${Math.round(trend.deltaPct)}% / ${trend.hoursBack}h` : ''}
        </p>
      )}
    </div>
  )
}

/** Inline editor for one of the ranch's m³/s alert thresholds. */
function ThresholdEditor({
  label,
  ranch,
  column,
  isManager,
}: {
  label: string
  ranch: Ranch | undefined
  column: 'river_alert_cms' | 'bow_alert_cms'
  isManager: boolean
}) {
  const setRanch = useSetRanch()
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState('')
  const current = ranch?.[column] == null ? null : Number(ranch[column])

  return (
    <div className="flex items-center gap-2 text-xs text-gray-500">
      <span>{label} &gt;</span>
      {editing && isManager ? (
        <>
          <input
            type="number"
            autoFocus
            value={val}
            onChange={(e) => setVal(e.target.value)}
            placeholder="m³/s"
            className="w-20 rounded-md border border-gray-300 px-2 py-1 text-right text-sm tabular-nums"
          />
          <button
            onClick={() =>
              ranch &&
              setRanch.mutate(
                { id: ranch.id, patch: { [column]: val === '' ? null : Number(val) } },
                { onSuccess: () => setEditing(false) },
              )
            }
            className="rounded-md bg-brand-700 px-2.5 py-1 font-semibold text-white hover:bg-brand-800"
          >
            Save
          </button>
        </>
      ) : (
        <button
          disabled={!isManager || !ranch}
          onClick={() => {
            setVal(current != null ? String(current) : '')
            setEditing(true)
          }}
          className="rounded-md border border-gray-200 px-2.5 py-1 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          {current != null ? `${current} m³/s` : 'set threshold'}
        </button>
      )}
    </div>
  )
}

export function IrrigationRiver({ isManager, ranchName }: { isManager: boolean; ranchName: RiverRanch }) {
  const cfg = RANCH_RIVER[ranchName]
  const { data: ranches } = useRanches()
  const ranch = ranches?.find((r) => r.name === ranchName)

  const [range, setRange] = useState<RangeKey>('1w')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  // Stable window (window() reads Date.now(); recomputing inline would thrash
  // the react-query keys and the fetch would never settle).
  const w = useMemo(() => window(range, customFrom, customTo), [range, customFrom, customTo])

  // Fixed hook count regardless of ranch: the inflow list is padded to 4 and
  // useRiverSeries is disabled for a null station.
  const inflowIds = [0, 1, 2, 3].map((i) => cfg.inflowStations[i]?.station ?? null)
  const in1 = useRiverSeries(inflowIds[0], w.from, w.to, w.daily)
  const in2 = useRiverSeries(inflowIds[1], w.from, w.to, w.daily)
  const in3 = useRiverSeries(inflowIds[2], w.from, w.to, w.daily)
  const in4 = useRiverSeries(inflowIds[3], w.from, w.to, w.daily)
  const midLatest = useRiverFlow(cfg.mid.station)
  const homeLatest = useRiverFlow(cfg.home.station)
  const midSeries = useRiverSeries(cfg.mid.station, w.from, w.to, w.daily)
  const homeSeries = useRiverSeries(cfg.home.station, w.from, w.to, w.daily)

  const inflowRaw = useMemo(
    () => [in1.data?.series ?? [], in2.data?.series ?? [], in3.data?.series ?? [], in4.data?.series ?? []],
    [in1.data, in2.data, in3.data, in4.data],
  )
  const seriesByKey = useMemo(
    () => ({
      inflow: combineHourly(inflowRaw),
      mid: midSeries.data?.series ?? [],
      home: homeSeries.data?.series ?? [],
    }),
    [inflowRaw, midSeries.data, homeSeries.data],
  )
  const inflowComponents = useMemo(
    () =>
      cfg.inflowStations.map((s, i) => {
        const last = [...inflowRaw[i]].reverse().find((p) => p.discharge != null)
        return { short: s.short, q: last?.discharge ?? null, station: s.station }
      }),
    [inflowRaw, cfg.inflowStations],
  )
  const inflowQ = seriesByKey.inflow.at(-1)?.discharge ?? null

  const merged = useMemo(() => mergeDischarge(seriesByKey), [seriesByKey])
  const dataMin = merged.length ? merged[0].ms : NaN
  const dataMax = merged.length ? merged[merged.length - 1].ms : NaN
  const { attach: zoomAttach, domain: zoomDomain, reset: zoomReset, zoomed } = useWheelZoom(dataMin, dataMax)
  const trends = useMemo(
    () => ({
      inflow: recentTrend(seriesByKey.inflow),
      mid: recentTrend(seriesByKey.mid),
      home: recentTrend(seriesByKey.home),
    }),
    [seriesByKey],
  )

  // Travel time derived from the loaded window, falling back to the measured
  // typical where one exists (null → "—", never a made-up number).
  const lagMid = useMemo(() => estimateLagHours(seriesByKey.inflow, seriesByKey.mid).lagH, [seriesByKey])
  const lagHome = useMemo(() => estimateLagHours(seriesByKey.inflow, seriesByKey.home).lagH, [seriesByKey])
  const toMid = lagMid ?? cfg.typicalToMid
  const toHome = lagHome ?? cfg.typicalToHome

  const threshold = ranch?.river_alert_cms == null ? null : Number(ranch.river_alert_cms)
  const midThreshold =
    cfg.midThresholdColumn && ranch?.[cfg.midThresholdColumn] != null
      ? Number(ranch[cfg.midThresholdColumn])
      : null
  const homeQ = homeLatest.data?.discharge
  const midQ = midLatest.data?.discharge
  const over = homeQ != null && threshold != null && homeQ > threshold
  const midOver = midQ != null && midThreshold != null && midQ > midThreshold

  const upstreamRising = trends.inflow?.rising ?? false
  const eta = upstreamRising && trends.inflow && toHome != null ? new Date(trends.inflow.latestMs + toHome * HOUR) : null

  const isLoading = in1.isLoading || midSeries.isLoading || homeSeries.isLoading
  const isError = in1.isError && midSeries.isError && homeSeries.isError

  const RETENTION = "The live gauge keeps only ~30 days and this year's daily history isn't published yet"
  const gapNote = useMemo(() => {
    if (w.daily || isLoading || isError) return null
    const wantFrom = new Date(w.from).getTime()
    if (merged.length === 0) return `${RETENTION}, so flow older than about 30 days back isn't available.`
    const earliest = merged[0].ms
    if (earliest - wantFrom <= 3 * DAY) return null
    return `${RETENTION} — showing from ${new Date(earliest).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}.`
  }, [merged, w, isLoading, isError])

  const fmtTick = (ms: number) => {
    const d = new Date(ms)
    return range === '6h' || range === '1d'
      ? d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })
      : d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: range === 'all' ? '2-digit' : undefined })
  }

  return (
    <div>
      {/* Live readings along the river */}
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StationCard short={cfg.inflowLabel} color="#7c3aed" q={inflowQ} trend={trends.inflow} components={inflowComponents} />
        <StationCard
          short={cfg.mid.short}
          color={cfg.mid.color}
          q={midQ ?? null}
          level={midLatest.data?.level}
          trend={trends.mid}
          station={cfg.mid.station}
        />
        <StationCard
          short={cfg.home.short}
          color={cfg.home.color}
          q={homeQ ?? null}
          level={homeLatest.data?.level}
          trend={trends.home}
          isHome
          station={cfg.home.station}
        />
      </div>

      {/* Pull-pumps status + thresholds */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3">
        <div className="flex items-center gap-2">
          <Waves className={cn('h-5 w-5 shrink-0', over || midOver ? 'text-red-600' : 'text-sky-500')} />
          <p className="text-sm text-gray-700">
            At {ranchName}: <span className="font-semibold">{homeQ != null ? `${homeQ} m³/s` : 'no data'}</span>
            {threshold != null && homeQ != null && (
              <span
                className={cn(
                  'ml-2 rounded-full px-2 py-0.5 text-xs font-semibold',
                  over ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800',
                )}
              >
                {over ? 'Pull pumps' : 'OK'}
              </span>
            )}
            {midOver && (
              <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
                Bow high
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ThresholdEditor label="Pull-pumps alert" ranch={ranch} column="river_alert_cms" isManager={isManager} />
          {cfg.midThresholdColumn && (
            <ThresholdEditor label="Bow high-water" ranch={ranch} column={cfg.midThresholdColumn} isManager={isManager} />
          )}
        </div>
      </div>

      {/* Travel time + upstream-release forecast */}
      <div
        className={cn(
          'mb-3 rounded-lg border p-3',
          upstreamRising ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white',
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-900">
            Upstream → {ranchName} <span className="font-bold text-gray-700">≈ {fmtHrs(toHome)}</span>
            {lagHome == null && cfg.typicalToHome != null && (
              <span className="ml-1 text-xs font-normal text-gray-400">(typical)</span>
            )}
            {toHome == null && (
              <span className="ml-1 text-xs font-normal text-gray-400">(not enough data yet)</span>
            )}
          </h3>
          <p className="text-xs text-gray-500">
            {cfg.inflowLabel} · via {cfg.mid.short} ≈ {fmtHrs(toMid)}
          </p>
        </div>
        <p className="mt-1.5 text-sm">
          {upstreamRising && eta ? (
            <span className="font-medium text-amber-900">
              ⚠ Upstream flow is rising ({trends.inflow!.deltaPct >= 0 ? '+' : ''}
              {Math.round(trends.inflow!.deltaPct)}% in {trends.inflow!.hoursBack} h → {Math.round(trends.inflow!.latestQ)} m³/s).
              A pulse is on its way — expect it at {ranchName} around{' '}
              <span className="font-bold">
                {eta.toLocaleString('en-CA', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
              </span>{' '}
              (~{fmtHrs(toHome)} out).
            </span>
          ) : upstreamRising ? (
            <span className="font-medium text-amber-900">
              ⚠ Upstream flow is rising, but there isn't enough overlapping data to time its arrival yet.
            </span>
          ) : (
            <span className="text-gray-500">Upstream flow is steady. You'll be alerted automatically if that changes.</span>
          )}
        </p>
      </div>

      {/* Range selector */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select value={range} size="sm" ariaLabel="Time range" className="w-40" onChange={(v) => { setRange(v as RangeKey); zoomReset() }} options={RANGES} />
        {range === 'custom' && (
          <>
            <DateField value={customFrom} onChange={(v) => { setCustomFrom(v); zoomReset() }} className="rounded-md border border-gray-300 px-2 py-1 text-sm" />
            <span className="text-gray-400">→</span>
            <DateField value={customTo} onChange={(v) => { setCustomTo(v); zoomReset() }} className="rounded-md border border-gray-300 px-2 py-1 text-sm" />
          </>
        )}
        <span className="text-xs text-gray-400">{w.daily ? 'daily means' : 'real-time (~5 min)'}</span>
        {zoomed && (
          <button onClick={zoomReset} className="rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50">
            Reset zoom
          </button>
        )}
      </div>
      {gapNote && <p className="mb-2 rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-800">{gapNote}</p>}

      {/* Multi-station flow graph */}
      <div className="rounded-lg border border-gray-200 bg-white p-3">
        <h2 className="mb-1 text-center text-sm font-semibold text-gray-900">{cfg.chartTitle}</h2>
        {isLoading ? (
          <p className="py-16 text-center text-sm text-gray-400">Loading…</p>
        ) : isError ? (
          <p className="py-16 text-center text-sm text-gray-400">River data unavailable right now.</p>
        ) : merged.length === 0 ? (
          <p className="py-16 text-center text-sm text-gray-400">No readings in this range.</p>
        ) : (
          <div ref={zoomAttach}>
          <ResponsiveContainer width="100%" height={420}>
            <LineChart data={merged} margin={{ top: 10, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
              <XAxis dataKey="ms" type="number" domain={zoomDomain ?? ['dataMin', 'dataMax']} allowDataOverflow scale="time" tickFormatter={fmtTick} tick={{ fontSize: 11 }} minTickGap={44} />
              <YAxis tick={{ fontSize: 11 }} label={{ value: 'm³/s', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
              <Tooltip
                labelFormatter={(ms) => new Date(Number(ms)).toLocaleString('en-CA')}
                formatter={(value, name) => [value == null ? '—' : `${Number(value).toFixed(1)} m³/s`, name as string]}
              />
              {threshold != null && (
                <ReferenceLine y={threshold} stroke="#ef4444" strokeDasharray="5 4" label={{ value: `Pull-pumps ${threshold}`, fontSize: 10, fill: '#ef4444', position: 'insideTopRight' }} />
              )}
              {midThreshold != null && (
                <ReferenceLine y={midThreshold} stroke="#f59e0b" strokeDasharray="5 4" label={{ value: `Bow ${midThreshold}`, fontSize: 10, fill: '#b45309', position: 'insideBottomRight' }} />
              )}
              {CHAIN.map((def) => (
                <Line
                  key={def.key}
                  type="monotone"
                  dataKey={def.key}
                  name={def.key === 'inflow' ? cfg.inflowLabel : def.key === 'mid' ? cfg.mid.short : cfg.home.short}
                  stroke={def.color}
                  strokeWidth={def.width}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
          </div>
        )}
        <HelpNote className="mt-1 px-1" summary="Scroll on the chart to zoom in/out." title="Reading the river chart">
          <p>{cfg.footnote}</p>
        </HelpNote>
      </div>
      <WaterQualityCard isManager={isManager} />
    </div>
  )
}
