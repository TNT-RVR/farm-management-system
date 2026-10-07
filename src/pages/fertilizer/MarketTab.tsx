import { useMemo, useState } from 'react'
import { CHART_COLOURS, PriceChart } from '@/components/PriceChart'
import { Bell } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PriceAlerts } from '@/components/PriceAlerts'
import { HelpNote } from '@/components/HelpNote'
import { buyWindow } from '@/lib/fert-savings/tools'
import { useMarketPrices, useMarketSeries } from '@/lib/markets'
import { totalsByProduct, type ProductTotal } from '@/lib/fertilizer-plan'
import { cn } from '@/lib/utils'
import { useFarmSettings } from '@/lib/farm-setup'

const ZOOMS = [
  { label: '1y', years: 1 },
  { label: '3y', years: 3 },
  { label: '5y', years: 5 },
  { label: 'All', years: 99 },
]

/** Same calendar day a year / ten years earlier, as an ISO date. */
const shiftYears = (iso: string, back: number) => {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCFullYear(d.getUTCFullYear() - back)
  return d.toISOString().slice(0, 10)
}
const backOneYear = (iso: string) => shiftYears(iso, 1)
const backTenYears = (iso: string) => shiftYears(iso, 10)

const pct = (v: number | null) =>
  v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`

const money = (v: number | null) =>
  v == null ? '—' : `$${v.toLocaleString('en-CA', { maximumFractionDigits: 0 })}`

/** US dollars a short ton into Canadian dollars a tonne. */
const SHORT_TONS_PER_TONNE = 1.10231
const usdTonToCadTonne = (usd: number, fx: number) => usd * SHORT_TONS_PER_TONNE * fx

export function MarketTab({ isManager }: { isManager: boolean }) {
  const { retailerName } = useFarmSettings()
  const { data: everySeries } = useMarketSeries(['fertilizer', 'fx'])
  // The exchange rate rides along for the CAD/tonne equivalent and is not a
  // fertilizer series.
  const allSeries = useMemo(() => (everySeries ?? []).filter((s) => s.kind === 'fertilizer'), [everySeries])
  const fxSeries = useMemo(() => (everySeries ?? []).find((s) => s.code === 'fx.usdcad') ?? null, [everySeries])
  // Three different things share this tab and must not share an axis. The
  // typed quotes are dollars a tonne; the StatCan series is an index whose
  // level is arbitrary; DTN's weekly retail is US dollars a short ton. Plotted
  // together, 143.8 would sit under the chart's dollar label and read as
  // $144/t for urea.
  const indexSeries = useMemo(
    () => (allSeries ?? []).filter((s) => s.unit === 'index'),
    [allSeries],
  )
  const dtnSeries = useMemo(() => (allSeries ?? []).filter((s) => s.source === 'dtn'), [allSeries])
  const ids = useMemo(
    () => [...(allSeries ?? []).map((s) => s.id), ...(fxSeries ? [fxSeries.id] : [])],
    [allSeries, fxSeries],
  )
  const { data: points } = useMarketPrices(ids)
  const [dtnZoom, setDtnZoom] = useState(ZOOMS[0])
  // Which products are drawn. All of them until a tile is clicked off.
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [watching, setWatching] = useState(false)
  const toggleLine = (id: string) =>
    setHidden((h) => {
      const next = new Set(h)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const dtnColour = (id: string) => {
    const i = dtnSeries.findIndex((s) => s.id === id)
    return CHART_COLOURS[(i < 0 ? 0 : i) % CHART_COLOURS.length]
  }

  // This week's retail prices: the newest point per product, the move since
  // the week before and since a year ago, and the exchange rate to read it
  // in our money. This is the "what does it cost this week" half.
  const dtnRead = useMemo(() => {
    const byId = new Map<string, { on: string; value: number }[]>()
    for (const p of points ?? []) {
      if (p.value == null) continue
      if (!byId.has(p.series_id)) byId.set(p.series_id, [])
      byId.get(p.series_id)!.push({ on: p.observed_on, value: p.value })
    }
    const fxRows = fxSeries ? (byId.get(fxSeries.id) ?? []).sort((a, b) => b.on.localeCompare(a.on)) : []
    const fx = fxRows[0] ?? null
    const rows = dtnSeries.map((s) => {
      const pts = (byId.get(s.id) ?? []).sort((a, b) => b.on.localeCompare(a.on))
      const now = pts[0] ?? null
      const prev = pts[1] ?? null
      const yearAgo = now ? pts.find((r) => r.on <= backOneYear(now.on)) ?? null : null
      return {
        series: s,
        now,
        weekChange: now && prev ? now.value - prev.value : null,
        // Where this week sits in its range: the buy-window signal.
        window: buyWindow(pts.map((p) => ({ on: p.on, value: p.value }))),
        yoy: now && yearAgo && yearAgo.value ? (now.value / yearAgo.value - 1) * 100 : null,
        cadTonne: now && fx ? usdTonToCadTonne(now.value, fx.value) : null,
      }
    })
    return { rows, fx, latest: rows.map((r) => r.now?.on ?? '').sort().pop() || null }
  }, [dtnSeries, fxSeries, points])

  const cheapNow = dtnRead.rows.filter((r) => r.window?.state === 'cheap').map((r) => r.series.commodity)
  const dearNow = dtnRead.rows.filter((r) => r.window?.state === 'dear').map((r) => r.series.commodity)

  const dtnPoints = useMemo(() => {
    const dtnIds = new Set(dtnSeries.map((s) => s.id))
    const d = new Date()
    d.setFullYear(d.getFullYear() - dtnZoom.years)
    const cutoff = d.toISOString().slice(0, 10)
    return (points ?? []).filter((p) => dtnIds.has(p.series_id) && p.observed_on >= cutoff)
  }, [points, dtnSeries, dtnZoom])


  // Where the index sits now, how it has moved, and how that compares with the
  // last ten years. "Up 8% on the year and near the top of the decade" is the
  // buying signal; the raw index level on its own says nothing.
  const indexRead = useMemo(() => {
    const byId = new Map<string, { on: string; value: number }[]>()
    for (const p of points ?? []) {
      if (p.value == null) continue
      if (!byId.has(p.series_id)) byId.set(p.series_id, [])
      byId.get(p.series_id)!.push({ on: p.observed_on, value: p.value })
    }
    return indexSeries.map((s) => {
      const rows = (byId.get(s.id) ?? []).sort((a, b) => a.on.localeCompare(b.on))
      const now = rows[rows.length - 1] ?? null
      // Four quarters back, not "the previous point": a gap in publication
      // would otherwise turn a two-year move into a "year on year".
      const yearAgo = now ? rows.find((r) => r.on >= backOneYear(now.on)) ?? null : null
      const decade = now ? rows.filter((r) => r.on >= backTenYears(now.on)) : []
      const lo = decade.length ? Math.min(...decade.map((r) => r.value)) : null
      const hi = decade.length ? Math.max(...decade.map((r) => r.value)) : null
      return {
        series: s,
        now,
        yoy: now && yearAgo && yearAgo.value ? (now.value / yearAgo.value - 1) * 100 : null,
        // 0 = cheapest quarter of the decade, 100 = dearest.
        percentile:
          now && lo != null && hi != null && hi > lo ? ((now.value - lo) / (hi - lo)) * 100 : null,
        lo,
        hi,
      }
    })
  }, [indexSeries, points])

  const indexPoints = useMemo(() => {
    const idxIds = new Set(indexSeries.map((s) => s.id))
    return (points ?? []).filter((p) => idxIds.has(p.series_id))
  }, [points, indexSeries])

  return (
    <div className="space-y-4">
      {/* This week. The one number that decides whether to book the fall
          tonnes now, and the one the other two sources cannot give. */}
      {dtnSeries.length > 0 && (
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-gray-800">This week’s retail prices</h3>
              {/* The exchange rate to three places: the fourth moved a $700
                  tonne by seven cents and only made the line harder to read. */}
              <HelpNote
                className="mt-0.5 text-xs"
                summary={
                  <>
                    US Midwest retail, US$/short ton ≈ C$/tonne
                    {dtnRead.fx ? ` at ${dtnRead.fx.value.toFixed(3)}` : ''}
                    {dtnRead.latest ? ` · week of ${dtnRead.latest}` : ''}
                  </>
                }
                title="Where these prices come from"
              >
                DTN’s weekly average of US Midwest retailer bids, in US dollars a short ton, with
                the Canadian-dollar-per-tonne equivalent beside it
                {dtnRead.fx ? ` at ${dtnRead.fx.value.toFixed(4)} (Bank of Canada, ${dtnRead.fx.on})` : ''}.
                Alberta retail runs above this by freight and moves with it.
              </HelpNote>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex rounded-md border border-gray-200 p-0.5">
                {ZOOMS.slice(0, 3).map((z) => (
                  <button
                    key={z.label}
                    onClick={() => setDtnZoom(z)}
                    className={cn(
                      'rounded px-2 py-0.5 text-xs font-medium',
                      dtnZoom.label === z.label ? 'bg-brand-700 text-white' : 'text-gray-600 hover:bg-gray-50',
                    )}
                  >
                    {z.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setWatching(true)}
                className="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                <Bell className="h-3.5 w-3.5 text-gray-400" /> Price watches
              </button>
            </div>
          </div>

          {/* One tile per product, eight across, each a switch for its line:
              a ring in the line's colour means it is drawn. */}
          <div className="mt-2 grid grid-cols-4 gap-1.5 sm:grid-cols-8">
            {dtnRead.rows.map((r) => {
              const on = !hidden.has(r.series.id)
              const colour = dtnColour(r.series.id)
              return (
                <button
                  key={r.series.id}
                  type="button"
                  onClick={() => toggleLine(r.series.id)}
                  aria-pressed={on}
                  title={on ? 'Click to hide this line' : 'Click to show this line'}
                  style={on ? { boxShadow: `inset 0 0 0 2px ${colour}` } : undefined}
                  className={cn(
                    'rounded-md px-1.5 py-1.5 text-left transition-colors',
                    on ? 'bg-white' : 'bg-gray-50 opacity-60 hover:opacity-90',
                  )}
                >
                  <p className="flex items-center gap-1 truncate text-[10px] font-medium text-gray-500" title={r.series.name}>
                    <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: colour }} />
                    {r.series.commodity}
                  </p>
                  <p className="text-xs font-bold tabular-nums leading-tight text-gray-900">
                    {r.now ? `US$${r.now.value.toLocaleString('en-CA', { maximumFractionDigits: 0 })}` : '—'}
                  </p>
                  {r.cadTonne != null && (
                    <p className="text-[10px] tabular-nums leading-tight text-gray-600">≈ {money(r.cadTonne)}/t</p>
                  )}
                  <p className="text-[9px] leading-tight text-gray-500">
                    {r.weekChange != null && (
                      // Up is bad on this tab.
                      <span className={cn('font-semibold', r.weekChange > 0 ? 'text-red-700' : r.weekChange < 0 ? 'text-green-700' : 'text-gray-500')}>
                        {r.weekChange > 0 ? '▲' : r.weekChange < 0 ? '▼' : '—'}{Math.abs(r.weekChange).toFixed(0)} wk
                      </span>
                    )}
                    {r.yoy != null && <span className="ml-1">{pct(r.yoy)} yr</span>}
                  </p>
                </button>
              )
            })}
          </div>

          {/* Where each product sits in its range — the cheap/dear-third
              badges that were on these tiles — is the Buy-window alert on
              Savings, with the chart and the dollars for what is left to
              book. One line here says whether it is worth going to look. */}
          <p className="mt-1.5 text-[11px] text-gray-500">
            {[
              cheapNow.length ? `${cheapNow.join(', ')} in the cheapest third of ${cheapNow.length === 1 ? 'its' : 'their'} range` : null,
              dearNow.length ? `${dearNow.join(', ')} in the dearest third` : null,
            ]
              .filter(Boolean)
              .join('; ') || 'Nothing in the cheap or dear third of its range'}
            .{' '}
            <Link to="/fertilizer?tab=Savings" className="text-brand-700 underline decoration-dotted">
              Buy-window alert on Savings
            </Link>
          </p>

          {dtnPoints.length > 0 && (
            <PriceChart
              series={dtnSeries.filter((s) => !hidden.has(s.id))}
              points={dtnPoints}
              unit="US$/short ton"
              height={360}
              colourOf={(id) => dtnColour(id)}
              legend={false}
              connectGaps
            />
          )}

          {watching && (
            <div
              className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
              onClick={() => setWatching(false)}
            >
              <div className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
                <PriceAlerts series={dtnSeries} isManager={isManager} />
                {/* Said here, where the line is set, rather than under the
                    tab where it read as a note about something else. */}
                <p className="mt-2 rounded-md bg-white px-3 py-2 text-[11px] text-gray-500 shadow">
                  A watch fires once per crossing, not once per quote — a price that drops through
                  your line and stays there does not keep telling you. Set the line at the price you
                  would actually buy at.
                </p>
                <button
                  type="button"
                  onClick={() => setWatching(false)}
                  className="mt-2 w-full rounded-md bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* What the market has done. This is the half that answers "is now a good
          time to buy" — the typed quotes cannot, because nobody types in ten
          years of history. */}
      {indexSeries.length > 0 && (
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-gray-800">Fertilizer price index</h3>
              <HelpNote
                className="mt-0.5 text-xs"
                summary="What farms have paid, quarterly. An index, not a price — watch the movement."
                title="About the price index"
              >
                <p>
                  What farms have paid, quarterly since 2002 — Alberta, except the phosphate and
                  potash split, which Statistics Canada publishes nationally only. An index, not a
                  price: the level means nothing on its own, the movement is the point.
                </p>
                <p>
                  Statistics Canada table 18-10-0258-01, quarterly and released about six months in
                  arrears, so the newest point is not this week&apos;s price. It answers whether the
                  market is dear by the standards of the last twenty years, which no single quote
                  can. For what you are being charged right now, see what {retailerName} invoiced on the
                  Pricing tab.
                </p>
              </HelpNote>
            </div>
          </div>

          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {indexRead.map((r) => (
              <div key={r.series.id} className="rounded-md bg-gray-50 px-2.5 py-2">
                <p className="truncate text-[11px] font-medium text-gray-500" title={r.series.name}>
                  {r.series.commodity}
                  {r.series.region && (
                    <span className="ml-1 font-normal text-gray-400">{r.series.region}</span>
                  )}
                </p>
                <p className="text-sm font-bold tabular-nums text-gray-900">
                  {r.now ? r.now.value.toFixed(1) : '—'}
                  {r.yoy != null && (
                    <span
                      className={cn(
                        'ml-1.5 text-[11px] font-semibold',
                        // Rising is bad news on this tab, the reverse of crops
                        // and cattle. Worth saying, because the same colour
                        // means the opposite two tabs over.
                        r.yoy > 0 ? 'text-red-700' : 'text-green-700',
                      )}
                    >
                      {pct(r.yoy)} on the year
                    </span>
                  )}
                </p>
                {r.percentile != null && (
                  <p className="text-[10px] text-gray-500">
                    Dearer than {Math.round(r.percentile)}% of the last ten years
                    {r.lo != null && r.hi != null && (
                      <span className="text-gray-400">
                        {' '}
                        (range {r.lo.toFixed(0)}–{r.hi.toFixed(0)})
                      </span>
                    )}
                  </p>
                )}
                {r.now && <p className="text-[10px] text-gray-400">to {r.now.on}</p>}
              </div>
            ))}
          </div>

          {indexPoints.length > 0 ? (
            <PriceChart
              series={indexSeries}
              points={indexPoints}
              unit="index (2012 = 100)"
              currency={false}
            />
          ) : (
            <p className="py-8 text-center text-sm text-gray-400">
              No index data yet — the sync has not run.
            </p>
          )}

        </section>
      )}

      {/* What the retailer charges lives on the Pricing view now, beside the full
          price book, so the farm's own prices are in one place and this view
          is only the market. */}
      <p className="px-1 text-xs text-gray-500">
        What {retailerName} charges this farm, and quotes:{' '}
        <Link to="/fertilizer?tab=Pricing" className="text-brand-700 underline decoration-dotted">
          Prices → Pricing
        </Link>
        .
      </p>
    </div>
  )
}

/** What this year's programme would cost at the latest quotes. */
export function costAtLatest(
  totals: ProductTotal[],
  latest: { name: string; perTonne: number | null }[],
): { product: string; tonnes: number; perTonne: number | null; cost: number | null }[] {
  const byName = new Map(latest.map((l) => [l.name.toLowerCase(), l.perTonne]))
  return totals
    .filter((t) => t.totalTonnes != null)
    .map((t) => {
      // Match on the analysis in the name (46-0-0), which is stable, rather than
      // the trade name, which is not.
      const analysis = t.product.match(/\d{1,2}-\d{1,2}-\d{1,2}(?:-\d{1,2})?/)?.[0] ?? null
      const hit = analysis
        ? [...byName.entries()].find(([name]) => name.includes(analysis))?.[1] ?? null
        : null
      return {
        product: t.product,
        tonnes: t.totalTonnes!,
        perTonne: hit,
        cost: hit != null ? Math.round(hit * t.totalTonnes!) : null,
      }
    })
}

export { totalsByProduct }
