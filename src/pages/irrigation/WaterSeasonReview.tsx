import { useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CartesianGrid, LabelList, Legend, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowDown, ArrowUp, Download, Lightbulb, Scale } from 'lucide-react'
import { Select } from '@/components/Select'
import { HelpNote } from '@/components/HelpNote'
import { supabase } from '@/lib/supabase'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { cropColour } from '@/lib/crop-colour'
import { downloadBlob, tableReportToCsv } from '@/lib/table-report'
import { conv, depthValue, useUnitSystem, type UnitSystem } from '@/lib/units'
import { cn } from '@/lib/utils'
import { buildWaterReview, reviewTotals, RULES, type WaterReviewRow, type WaterReviewTotals } from '@/lib/water-review'
import { fetchFarmPowerCost, fetchWaterReviewData, perDepth, perUnit, powerPrices, waterReviewReport, type PowerPrices } from '@/lib/reports/water-review'

/** Everything the review reads for one year. The arithmetic is in lib/water-review. */
function useReviewData(year: number) {
  return useQuery({
    queryKey: ['water-season-review', year],
    staleTime: 10 * 60_000,
    queryFn: () => fetchWaterReviewData(year),
  })
}

function useFarmPowerCost() {
  return useQuery({
    queryKey: ['farm-power-cost', 'v2'],
    queryFn: fetchFarmPowerCost,
    staleTime: 10 * 60_000,
  })
}

const n0 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : Math.round(v).toLocaleString('en-CA'))
const n1 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-CA', { maximumFractionDigits: 1 }))
const yieldFmt = (v: number | null | undefined) => (v == null ? '—' : v < 1 ? v.toFixed(2) : v < 20 ? n1(v) : n0(v))
const money = (v: number | null | undefined, dp = 0) =>
  v == null || !Number.isFinite(v) ? '—' : `$${v.toLocaleString('en-CA', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`

/**
 * Twenty columns did not fit a screen, so they come in three sets — the
 * water, the yield it bought, and the dollars — with field, crop and acres in
 * all three. The CSV still carries every column.
 */
type ColSet = 'water' | 'yield' | 'money'
const COL_SETS: { key: ColSet; label: string }[] = [
  { key: 'water', label: 'Water' },
  { key: 'yield', label: 'Yield' },
  { key: 'money', label: '$' },
]

type Col = {
  key: string
  label: string
  title?: string
  left?: boolean
  /** Which set it shows in; none means every set. */
  set?: ColSet
  /** A second way of putting the same dollars, shown with "all ratios". */
  extra?: boolean
  sort: (r: WaterReviewRow) => number | string | null
  cell: (r: WaterReviewRow) => ReactNode
  total?: (t: WaterReviewTotals) => ReactNode
}

function columns(u: UnitSystem, power: PowerPrices): Col[] {
  const other = power.basis === 'sell' ? { rate: power.buy, label: 'bought from the grid' } : { rate: power.sell, label: 'valued at the solar sell price' }
  const unit = conv.depthUnit(u)
  const per = perDepth(u).label
  const dp = u === 'metric' ? 0 : 1
  return [
    {
      key: 'field',
      label: 'Field',
      left: true,
      sort: (r) => r.fieldName,
      cell: (r) => (
        <span className="font-medium text-gray-900" title={r.split ? 'More than one crop on this field this year — the largest is shown' : undefined}>
          {r.fieldName}
          {r.split && <span className="text-gray-400"> *</span>}
        </span>
      ),
      total: (t) => <span className="font-semibold">Farm · {t.fields} fields</span>,
    },
    {
      key: 'crop',
      label: 'Crop',
      left: true,
      sort: (r) => r.cropName,
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: cropColour(r.cropId ? { id: r.cropId, color: r.cropColor } : null) }} />
          {r.cropName}
        </span>
      ),
    },
    { key: 'acres', label: 'Acres', title: 'Irrigated acres under the pivot', sort: (r) => r.acres, cell: (r) => n0(r.acres), total: (t) => n0(t.acres) },
    {
      key: 'gross',
      set: 'water',
      label: `Irrigation (${unit})`,
      title: 'Gross depth applied this year (every logged pass)',
      sort: (r) => r.grossMm,
      cell: (r) => <span title={`${r.events} pass${r.events === 1 ? '' : 'es'} logged`}>{conv.depth(r.grossMm, u, dp)}</span>,
      total: (t) => conv.depth(t.grossMm, u, dp),
    },
    {
      key: 'eff',
      set: 'water',
      label: `Effective (${unit})`,
      title: 'Gross × the pivot’s application efficiency (0.85 when none is on file)',
      sort: (r) => r.effectiveMm,
      cell: (r) => <span title={`${Math.round(r.efficiency * 100)}% efficiency`}>{conv.depth(r.effectiveMm, u, dp)}</span>,
      total: (t) => conv.depth(t.effectiveMm, u, dp),
    },
    { key: 'rain', set: 'water', label: `Rain (${unit})`, title: 'Rain on the actual days of the water balance', sort: (r) => r.rainMm, cell: (r) => conv.depth(r.rainMm, u, dp), total: (t) => conv.depth(t.rainMm, u, dp) },
    { key: 'etc', set: 'water', label: `Crop use (${unit})`, title: 'Crop water use (ETc) on the actual days of the water balance', sort: (r) => r.etcMm, cell: (r) => conv.depth(r.etcMm, u, dp), total: (t) => conv.depth(t.etcMm, u, dp) },
    {
      key: 'stress',
      set: 'water',
      label: 'Stress days',
      title: 'Actual days the balance said “Irrigate now” or “Water stress”',
      sort: (r) => r.stressDays,
      cell: (r) => <span className={cn((r.stressDays ?? 0) >= RULES.stressDaysHigh && 'font-semibold text-red-700')}>{r.stressDays ?? '—'}</span>,
      total: (t) => n1(t.stressDays),
    },
    {
      key: 'below',
      set: 'water',
      label: 'Days short',
      title: 'Actual days the root zone was dried past the readily available water (past RAW, Ks below 1): the crop was short of water',
      sort: (r) => r.belowThresholdDays,
      cell: (r) => r.belowThresholdDays ?? '—',
      total: (t) => n1(t.belowThresholdDays),
    },
    {
      key: 'yield',
      set: 'yield',
      label: 'Yield /ac',
      title: 'Harvested yield when it is in (scale loads, Deere, Farm at Hand), else the plan’s estimate',
      sort: (r) => r.yield,
      cell: (r) =>
        r.yield == null ? (
          '—'
        ) : (
          <span className="whitespace-nowrap" title={r.yieldFrom}>
            {yieldFmt(r.yield)} <span className="text-gray-400">{r.yieldUnit}</span>
            {r.yieldKind === 'estimate' && <span className="ml-1 rounded bg-amber-50 px-1 text-[10px] text-amber-800">est.</span>}
            {r.yieldSuspect && <span className="ml-1 rounded bg-red-50 px-1 text-[10px] text-red-800">unit?</span>}
          </span>
        ),
    },
    { key: 'rel', set: 'yield', label: '% crop avg', title: 'Yield against the acre-weighted average of the same crop on the farm this year', sort: (r) => r.relYield, cell: (r) => (r.relYield == null ? '—' : `${Math.round(r.relYield)}%`) },
    {
      key: 'ypt',
      set: 'yield',
      label: `Yield / ${per} water`,
      title: 'Yield per acre over every inch the crop got: effective irrigation plus rain',
      sort: (r) => r.yieldPerInTotal,
      cell: (r) => yieldFmt(perUnit(r.yieldPerInTotal, u)),
    },
    { key: 'ypi', set: 'yield', label: `Yield / ${per} irrig.`, title: 'Yield per acre over the gross irrigation', sort: (r) => r.yieldPerInIrrigation, cell: (r) => yieldFmt(perUnit(r.yieldPerInIrrigation, u)) },
    {
      key: 'pump',
      set: 'money',
      label: 'Pumping $',
      title: 'Hours = acre-inches × 27,154 gal ÷ (gpm × 60); kW = hp × 0.7457 ÷ 0.9; × the power price chosen above',
      sort: (r) => r.pumpCost,
      cell: (r) =>
        r.pumpCost == null ? (
          <span className="text-amber-700" title={r.pumpNote ?? undefined}>
            —
          </span>
        ) : (
          <span
            title={`${n0(r.pumpHours)} h at ${n0(r.gpm)} gpm (${r.gpmFrom}), ${n0(r.hp)} hp, ${n0(r.kwh)} kWh; ${money(r.kwh != null ? r.kwh * other.rate : null)} if ${other.label}${r.pumpNote ? ` — ${r.pumpNote}` : ''}`}
            className={cn(r.pumpNote && 'underline decoration-dotted')}
          >
            {money(r.pumpCost)}
          </span>
        ),
      total: (t) => (
        <span title={`${t.pumpFields} of ${t.fields} fields have the pump and flow to price; ${money(t.kwh != null ? t.kwh * other.rate : null)} if ${other.label}`}>{money(t.pumpCost)}</span>
      ),
    },
    { key: 'pumpAc', set: 'money', extra: true, label: '$/ac', sort: (r) => r.pumpCostPerAc, cell: (r) => money(r.pumpCostPerAc, 2), total: (t) => money(t.pumpCostPerAc, 2) },
    { key: 'pumpAcIn', set: 'money', label: '$/ac-in', sort: (r) => r.pumpCostPerAcIn, cell: (r) => money(r.pumpCostPerAcIn, 2), total: (t) => money(t.pumpCostPerAcIn, 2) },
    {
      key: 'price',
      set: 'money',
      label: 'Price',
      sort: (r) => r.price,
      cell: (r) =>
        r.price == null ? (
          <span className="text-gray-400" title={r.priceFrom}>
            —
          </span>
        ) : (
          <span title={r.priceFrom} className="whitespace-nowrap">
            {money(r.price, r.price < 1 ? 3 : 2)}
            <span className="text-gray-400">/{r.yieldUnit}</span>
          </span>
        ),
    },
    { key: 'value', set: 'money', label: 'Gross $/ac', title: 'Yield × price', sort: (r) => r.grossPerAc, cell: (r) => money(r.grossPerAc), total: (t) => money(t.grossPerAc) },
    { key: 'valueIn', set: 'money', extra: true, label: `$ / ${per} irrig.`, title: 'Gross $/ac over the gross irrigation', sort: (r) => r.dollarsPerInIrrigation, cell: (r) => money(perUnit(r.dollarsPerInIrrigation, u)) },
  ]
}

type Pt = { x: number; y: number; field: string; crop: string; color: string; stress: number; estimate: boolean; yieldText: string }

/** Stress days as the dot's size: 5 px, up to 13 px at 32 days or more. */
const radius = (stress: number) => 5 + Math.min(stress, 32) / 4

function Dot(p: unknown) {
  const { cx, cy, payload } = p as { cx?: number; cy?: number; payload?: Pt }
  if (cx == null || cy == null || !payload) return <g />
  const r = radius(payload.stress)
  return payload.estimate ? (
    <circle cx={cx} cy={cy} r={r} fill="#ffffff" stroke={payload.color} strokeWidth={2} />
  ) : (
    <circle cx={cx} cy={cy} r={r} fill={payload.color} fillOpacity={0.85} stroke="#ffffff" strokeWidth={1} />
  )
}

function ChartTip({ active, payload, unit }: { active?: boolean; payload?: readonly { payload?: unknown }[]; unit: string }) {
  const pt = active ? (payload?.[0]?.payload as Pt | undefined) : undefined
  if (!pt) return null
  return (
    <div className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs shadow-sm">
      <div className="font-semibold text-gray-900">{pt.field}</div>
      <div className="text-gray-600">{pt.crop}</div>
      <div className="tabular-nums">
        {pt.x.toFixed(unit === 'mm' ? 0 : 1)} {unit} irrigation · {pt.yieldText} ({Math.round(pt.y)}% of the crop average)
      </div>
      <div className="tabular-nums text-gray-500">{pt.stress} stress days</div>
    </div>
  )
}

function YieldWaterChart({ rows, u }: { rows: WaterReviewRow[]; u: UnitSystem }) {
  const unit = conv.depthUnit(u)
  const groups = useMemo(() => {
    const m = new Map<string, { name: string; color: string; pts: Pt[] }>()
    for (const r of rows) {
      // No pass logged means the irrigation is unknown, not nought.
      if (r.relYield == null || r.events === 0 || !r.cropId) continue
      const color = cropColour({ id: r.cropId, color: r.cropColor })
      const g = m.get(r.cropId) ?? { name: r.cropName, color, pts: [] }
      g.pts.push({
        x: depthValue(r.grossMm, u),
        y: r.relYield,
        field: r.fieldName,
        crop: r.cropName,
        color,
        stress: r.stressDays ?? 0,
        estimate: r.yieldKind === 'estimate',
        yieldText: `${yieldFmt(r.yield)} ${r.yieldUnit ?? ''}/ac${r.yieldKind === 'estimate' ? ' (estimate)' : ''}`,
      })
      m.set(r.cropId, g)
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [rows, u])
  const plotted = groups.reduce((s, g) => s + g.pts.length, 0)
  if (!plotted) return <p className="py-6 text-center text-xs text-gray-400">No field has both water and a yield to plot for this year.</p>
  return (
    <div>
      <div className="h-72 w-full sm:h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 16, right: 12, bottom: 24, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              type="number"
              dataKey="x"
              name="Irrigation"
              domain={[0, 'auto']}
              tick={{ fontSize: 11 }}
              label={{ value: `Irrigation applied (${unit}, gross)`, position: 'insideBottom', offset: -14, style: { fontSize: 11 } }}
            />
            <YAxis type="number" dataKey="y" name="Yield" unit="%" domain={['auto', 'auto']} tick={{ fontSize: 11 }} width={48} />
            <ReferenceLine y={100} stroke="#94a3b8" strokeDasharray="5 4" label={{ value: 'crop average', fontSize: 10, fill: '#64748b', position: 'insideTopLeft' }} />
            <Tooltip cursor={{ strokeDasharray: '3 3' }} content={(p) => <ChartTip active={p.active} payload={p.payload} unit={unit} />} />
            <Legend verticalAlign="top" wrapperStyle={{ fontSize: 11, paddingBottom: 4 }} />
            {groups.map((g) => (
              <Scatter key={g.name} name={g.name} data={g.pts} fill={g.color} shape={Dot} isAnimationActive={false}>
                <LabelList dataKey="field" position="top" offset={10} style={{ fontSize: 10, fill: '#4b5563' }} />
              </Scatter>
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <HelpNote className="mt-1" summary="Yield as % of the crop's farm average. Bigger dot = more stress days; hollow = estimate." title="Reading the chart">
        <p>
          Yield is shown as % of that crop&apos;s farm average this year, so every crop shares one axis. A bigger dot spent more days at or past the irrigate trigger; a hollow
          dot&apos;s yield is the plan&apos;s estimate, not a harvest.
        </p>
      </HelpNote>
    </div>
  )
}

/**
 * The two power prices and which one prices the pumping. With solar the farm
 * mostly sells more than it buys, so the power a pump uses is mostly power
 * not sold — worth the sell price, not the grid price.
 */
function PowerCost({ power, farmId }: { power: PowerPrices; farmId: string | null }) {
  const { profile } = useAuth()
  const isMgr = hasManagerAccess(profile?.role)
  const qc = useQueryClient()
  const save = useMutation({
    mutationFn: async (patch: { power_buy_kwh?: number; power_sell_kwh?: number; power_value_basis?: 'sell' | 'buy' }) => {
      const { error } = await supabase.from('farms').update(patch).eq('id', farmId!)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['farm-power-cost'] }),
  })
  const price = (key: 'power_sell_kwh' | 'power_buy_kwh', label: string, value: number, title: string) =>
    isMgr && farmId ? (
      <label className="flex items-center gap-1" title={title}>
        {label} $
        <input
          type="number"
          step="0.005"
          min="0"
          inputMode="decimal"
          key={value}
          defaultValue={value}
          onBlur={(e) => {
            const v = Number(e.target.value)
            if (e.target.value !== '' && Number.isFinite(v) && v >= 0 && v !== value) save.mutate({ [key]: v })
          }}
          className="w-16 rounded-md border border-gray-300 px-1.5 py-1 text-xs"
        />
      </label>
    ) : (
      <span title={title}>
        {label} ${value.toFixed(2)}
      </span>
    )
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
      {price('power_sell_kwh', 'Sell', power.sell, 'What solar power sells for, $/kWh — the income a pump forgoes when it uses it')}
      {price('power_buy_kwh', 'Buy', power.buy, 'What grid power costs, $/kWh all-in')}
      <label className="flex items-center gap-1">
        Price pumping at
        <select
          value={power.basis}
          disabled={!isMgr || !farmId || save.isPending}
          onChange={(e) => save.mutate({ power_value_basis: e.target.value as 'sell' | 'buy' })}
          className="rounded-md border border-gray-300 px-1.5 py-1 text-xs"
          aria-label="Price pumping at"
        >
          <option value="sell">sell price (income forgone)</option>
          <option value="buy">buy price (grid)</option>
        </select>
      </label>
      {save.isPending && <span className="text-gray-400">saving…</span>}
      {save.error && <span className="text-red-700">{(save.error as Error).message}</span>}
    </div>
  )
}

/**
 * Each field's season of water set against its yield and what the water
 * cost to pump: which fields were short, which got more than paid.
 */
export function WaterSeasonReview({ year }: { year: number }) {
  const u = useUnitSystem()
  const [shownYear, setShownYear] = useState(year)
  // Follow the page's year when it changes; the selector picks any other.
  const [pageYear, setPageYear] = useState(year)
  if (pageYear !== year) {
    setPageYear(year)
    setShownYear(year)
  }
  const [today] = useState(() => new Date().toLocaleDateString('en-CA'))
  const q = useReviewData(shownYear)
  const farm = useFarmPowerCost()
  const power = useMemo<PowerPrices>(() => powerPrices(farm.data), [farm.data])
  const rate = power.basis === 'sell' ? power.sell : power.buy
  const rows = useMemo(() => (q.data ? buildWaterReview({ ...q.data, today }, rate) : []), [q.data, today, rate])
  const totals = useMemo(() => reviewTotals(rows), [rows])
  const cols = useMemo(() => columns(u, power), [u, power])
  const [colSet, setColSet] = useState<ColSet>('water')
  const [allRatios, setAllRatios] = useState(false)
  const shownCols = cols.filter((c) => !c.set || (c.set === colSet && (!c.extra || allRatios)))
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'gross', dir: -1 })
  const sorted = useMemo(() => {
    const col = cols.find((c) => c.key === sort.key) ?? cols[0]
    return [...rows].sort((a, b) => {
      const va = col.sort(a)
      const vb = col.sort(b)
      if (va == null && vb == null) return a.fieldName.localeCompare(b.fieldName)
      if (va == null) return 1 // blanks last either way
      if (vb == null) return -1
      const c = typeof va === 'string' || typeof vb === 'string' ? String(va).localeCompare(String(vb)) : va - vb
      return c * sort.dir || a.fieldName.localeCompare(b.fieldName)
    })
  }, [rows, cols, sort])
  const years = Array.from({ length: 6 }, (_, i) => year - i)
  const noBalance = q.data != null && q.data.balance.length === 0
  const missingPump = rows.filter((r) => r.pumpCost == null && r.irrigationIn > 0 && r.pumpNote)
  const cautions = rows.filter((r) => r.pumpCost != null && r.pumpNote)

  const exportCsv = () => {
    const blob = new Blob([tableReportToCsv(waterReviewReport(sorted, totals, shownYear, power, u, today))], { type: 'text/csv;charset=utf-8' })
    downloadBlob(blob, `water-review-${shownYear}.csv`)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
          <Scale className="h-4 w-4 text-sky-700" /> Water against yield
        </h2>
        <Select value={String(shownYear)} onChange={(v) => setShownYear(Number(v))} options={years.map((y) => ({ value: String(y), label: String(y) }))} ariaLabel="Year" size="sm" className="w-24" />
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <PowerCost power={power} farmId={farm.data?.id ?? null} />
          <button
            type="button"
            onClick={exportCsv}
            disabled={!rows.length}
            className="flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
      </div>

      {q.isLoading && <p className="py-6 text-center text-xs text-gray-400">Reading the season&apos;s water, yields and pumps…</p>}
      {q.error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-800">{(q.error as Error).message}</p>}
      {q.data && !rows.length && <p className="rounded-md border border-gray-200 bg-white px-3 py-4 text-center text-xs text-gray-500">No irrigated field has a crop or a season in {shownYear}.</p>}

      {rows.length > 0 && (
        <>
          {noBalance && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
              The water balance did not run in {shownYear}, so this is every pivot with a crop that year. Rain, crop use and stress days need the balance; irrigation shows only where
              passes were logged.
            </p>
          )}

          <section className="rounded-lg border border-gray-200 bg-white p-3">
            <YieldWaterChart rows={rows} u={u} />
          </section>

          <section className="rounded-lg border border-gray-200 bg-white">
            <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-3 py-2">
              <div className="flex rounded-md border border-gray-200 p-0.5 text-xs" role="group" aria-label="Columns">
                {COL_SETS.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    aria-pressed={colSet === s.key}
                    onClick={() => setColSet(s.key)}
                    className={cn('rounded px-2.5 py-0.5', colSet === s.key ? 'bg-brand-700 font-semibold text-white' : 'text-gray-600 hover:bg-gray-50')}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              {colSet === 'money' && (
                <label className="flex items-center gap-1 text-xs text-gray-500">
                  <input type="checkbox" checked={allRatios} onChange={(e) => setAllRatios(e.target.checked)} className="h-3.5 w-3.5 rounded border-gray-300" />
                  all ratios ($/ac, $ per {perDepth(u).label} irrigation)
                </label>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-gray-500">
                  <tr className="border-b border-gray-200">
                    {shownCols.map((c) => {
                      const on = sort.key === c.key
                      return (
                        <th key={c.key} className={cn('px-2 py-1.5 font-medium', c.left ? 'text-left' : 'text-right')} title={c.title} aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                          <button
                            type="button"
                            onClick={() => setSort((s) => (s.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: c.left ? 1 : -1 }))}
                            className={cn('inline-flex items-center gap-0.5 uppercase hover:text-gray-800', on && 'text-gray-900')}
                          >
                            {c.label}
                            {on && (sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                          </button>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sorted.map((r) => (
                    <tr key={r.fieldId} className="hover:bg-gray-50">
                      {shownCols.map((c) => (
                        <td key={c.key} className={cn('px-2 py-1 tabular-nums', c.left ? 'text-left' : 'text-right')}>
                          {c.cell(r)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-gray-50 font-medium text-gray-800">
                    {shownCols.map((c) => (
                      <td key={c.key} className={cn('px-2 py-1.5 tabular-nums', c.left ? 'text-left' : 'text-right')}>
                        {c.total ? c.total(totals) : ''}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="space-y-1 border-t border-gray-100 px-3 py-2 text-[11px] text-gray-500">
              <HelpNote
                summary={
                  <>
                    Pumping priced for {totals.pumpFields} of {totals.fields} fields at ${rate.toFixed(2)}/kWh. * more than one crop (largest shown).
                  </>
                }
                title="Reading the review"
              >
                <p>
                  Depths in the farm row are acre-weighted averages; yields don&apos;t add across crops, so they are left out. Pumping prices {totals.pumpFields} of {totals.fields}{' '}
                  fields at ${rate.toFixed(2)}/kWh. A * marks a field with more than one crop this year (the largest is shown).
                </p>
                <p>
                  {power.basis === 'sell'
                    ? `Power is valued at the solar sell price ($${power.sell.toFixed(2)}/kWh): with solar the farm mostly makes more than it buys, so a kWh a pump uses is a kWh not sold — the income forgone. Any of it drawn from the grid costs $${power.buy.toFixed(2)}/kWh instead`
                    : `Power is priced at the grid buy price ($${power.buy.toFixed(2)}/kWh). With solar most of it is power not sold, worth the sell price ($${power.sell.toFixed(2)}/kWh)`}
                  {totals.kwh != null &&
                    `: ${n0(totals.kwh)} kWh this season is ${money(totals.kwh * power.sell)} at the sell price, ${money(totals.kwh * power.buy)} at the buy price.`}
                  {totals.kwh == null && '.'}
                </p>
                <p>The table shows one set of columns at a time — Water, Yield or $; the CSV has them all.</p>
              </HelpNote>
              {missingPump.length > 0 && (
                <p className="text-amber-800">
                  No pumping cost for: {missingPump.map((r) => `${r.fieldName} (${r.pumpNote!.replace(/^Missing /, 'missing ')})`).join('; ')}. Fill these in on Pivot Information.
                </p>
              )}
              {cautions.map((r) => (
                <p key={r.fieldId}>
                  {r.fieldName}: {r.pumpNote}.
                </p>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-3">
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-800">
              <Lightbulb className="h-4 w-4 text-amber-500" /> What this says
            </h3>
            <ul className="space-y-1 text-xs">
              {sorted.map((r) => (
                <li key={r.fieldId} className="flex flex-wrap gap-x-1.5">
                  <span className="font-medium text-gray-900">{r.fieldName}</span>
                  <span className="text-gray-400">{r.cropName}</span>
                  <span className="text-gray-700">— {r.verdict}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}
