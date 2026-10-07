import { useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Legend,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { CalendarClock, Check, Minus, Plus, X } from 'lucide-react'
import { BasisPanel } from '@/components/BasisPanel'
import { PriceAlerts } from '@/components/PriceAlerts'
import { FuturesCurve } from '@/components/FuturesCurve'
import { InfoPopover } from '@/components/InfoPopover'
import { SeasonalityChart } from '@/components/SeasonalityChart'
import { cashEquivalent, sameUnitBasis } from '@/lib/basis'
import {
  bySeries,
  seasonality,
  useFuturesCurve,
  useMarketPrices,
  useMarketSeries,
  type MarketSeries,
} from '@/lib/markets'
import {
  CLASS_COLOURS,
  CLASS_FALLBACK,
  animalClasses,
  byYear,
  byYearAndClass,
  cwtToLb,
  derivePrice,
  scoreHindsight,
  useCattleSales,
  weightSlide,
} from '@/lib/cattleMarkets'
import {
  bandMid,
  bandPrice,
  bandKey,
  commodityFor,
  explainHeadline,
  headlinePrice,
  headlineSub,
  isAuctionSeries,
  parseSeriesCode,
  type AuctionQuote,
  type Headline,
} from '@/lib/auction-markets'
import { AuctionChart, UpdateNow } from '@/pages/cattle/AuctionChart'
import { CattleEconomics } from '@/pages/cattle/Economics'
import { SaleEditor } from '@/pages/cattle/SaleEditor'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { Fold } from '@/components/Fold'
import { HelpNote } from '@/components/HelpNote'
import { cn } from '@/lib/utils'
import { useFarmSettings } from '@/lib/farm-setup'
import { monthName, ranchSale, saleWeightSource } from '@/lib/calf-sale'
import { useMainRanch, useRanches } from '@/lib/ranches'
import type { CattleSale } from '@/lib/cattleMarkets'

const money = (v: number, dp = 2) => `$${v.toFixed(dp)}`

export function CattleMarketsTab({ onGoToSettings }: { onGoToSettings?: (ranchId?: string | null) => void } = {}) {
  const { data: sales, isLoading: salesLoading } = useCattleSales()
  const { data: series } = useMarketSeries(['cattle', 'fx'])
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const [editing, setEditing] = useState<CattleSale | 'new' | null>(null)
  // What each ranch actually sells, and when (Sam, 5 Oct 2026): East Ranch
  // typed 750 lb steers / 650 lb heifers in November; Home Ranch from its own
  // sales, in December. Farm setup's one figure only where a ranch has neither.
  const farm = useFarmSettings()
  const mainRanch = useMainRanch()
  const { data: ranchRows } = useRanches()
  const [saleRanchId, setSaleRanchId] = useState<string | null>(null)
  const saleRanch = ranchRows?.find((r) => r.id === saleRanchId) ?? mainRanch
  const sale = useMemo(() => ranchSale(saleRanch, sales ?? [], farm), [saleRanch, sales, farm])
  const OUR_WEIGHT_LB = sale.steers.lb
  const HEIFER_WEIGHT_LB = sale.heifers.lb
  const calfSaleMonth = sale.month
  const saleMonthName = monthName(calfSaleMonth)
  const saleMonthCode = String(calfSaleMonth).padStart(2, '0')

  // Since 5 Oct 2026: only the four auction markets the farm sells into —
  // Medicine Hat, Lethbridge, Calgary Stockyards, Team online. The Alberta
  // review's Clyde, Ponoka, Strathmore and Ontario are still stored, but are
  // no longer drawn or used here.
  const auctionSeries = useMemo(() => (series ?? []).filter((s) => isAuctionSeries(s.code)), [series])
  /** Feeder steers and heifers by weight class — what the headline, basis and alerts read. */
  const feederSeries = useMemo(
    () =>
      auctionSeries.filter((s) => {
        const p = parseSeriesCode(s.code)
        return p?.cls === 'feeder' && (p.kind === 'steers' || p.kind === 'heifers') && p.band != null
      }),
    [auctionSeries],
  )
  const ids = useMemo(() => feederSeries.map((s) => s.id), [feederSeries])
  const { data: feederPoints } = useMarketPrices(ids)

  const years = useMemo(() => byYear(sales ?? []), [sales])

  // ── The headline: steers and heifers at the farm's own sale weight ────────
  const today = new Date().toLocaleDateString('en-CA')
  const feederQuotes = useMemo(() => {
    const byId = bySeries(feederPoints ?? [])
    const out: Record<'steers' | 'heifers', AuctionQuote[]> = { steers: [], heifers: [] }
    for (const s of feederSeries) {
      const p = parseSeriesCode(s.code)!
      for (const pt of byId.get(s.id) ?? []) {
        if (pt.value == null) continue
        out[p.kind as 'steers' | 'heifers'].push({ market: p.market, band: p.band!, perCwt: pt.value, on: pt.observed_on })
      }
    }
    return out
  }, [feederSeries, feederPoints])
  const headline = useMemo(
    () => ({
      steers: headlinePrice(feederQuotes.steers, OUR_WEIGHT_LB, today),
      heifers: headlinePrice(feederQuotes.heifers, HEIFER_WEIGHT_LB, today),
    }),
    [feederQuotes, OUR_WEIGHT_LB, HEIFER_WEIGHT_LB, today],
  )

  // This week's steer classes, each priced the way the headline prices it, for
  // moving the CME board onto the farm's weight. Open-topped classes are left
  // out: they have no middle to slide from.
  const derived = useMemo(() => {
    const byBand = new Map<string, AuctionQuote[]>()
    for (const q of feederQuotes.steers) {
      if (q.band.hi == null) continue
      const list = byBand.get(bandKey(q.band)) ?? []
      list.push(q)
      byBand.set(bandKey(q.band), list)
    }
    const classes = [...byBand.values()]
      .map((qs) => bandPrice(qs, today))
      .filter((b): b is NonNullable<typeof b> => b != null)
      .map((b) => ({ lo: b.band.lo, hi: b.band.hi!, perCwt: b.perCwt }))
      .sort((a, b) => a.lo - b.lo)
    if (classes.length === 0) return null
    return { lightest: classes[0], slide: weightSlide(classes) }
  }, [feederQuotes, today])

  // ── C13: score the lock-in calls already made ────────────────────────────
  //
  // The market series only goes back as far as we have been ingesting it, so
  // most years cannot be scored yet. Those are shown as "not yet" rather than
  // as a draw.
  const hindsight = useMemo(() => {
    const byId = bySeries(feederPoints ?? [])
    const all = feederSeries.flatMap((s) => byId.get(s.id) ?? [])
    const marketOn = (iso: string): number | null => {
      // Nearest observation within a fortnight; beyond that it is not that week.
      let best: { gap: number; value: number } | null = null
      for (const p of all) {
        if (p.value == null) continue
        const gap = Math.abs(new Date(p.observed_on).getTime() - new Date(iso).getTime())
        if (gap <= 14 * 86_400_000 && (!best || gap < best.gap)) {
          best = { gap, value: cwtToLb(p.value) }
        }
      }
      return best?.value ?? null
    }
    return scoreHindsight(years, marketOn)
  }, [years, feederSeries, feederPoints])

  // C4: the shape of a normal year, from every feeder quote we hold.
  const seasonal = useMemo(() => seasonality(feederPoints ?? [], 10), [feederPoints])

  // C7 + C8: what the board works out to in Alberta dollars, and what the local
  // market is paying over or under it.
  const feederFut = (series ?? []).find((s) => s.code === 'cme.feeder')
  const { data: feederCurve } = useFuturesCurve(feederFut?.id)
  const fx = useMemo(() => {
    const s = (series ?? []).find((x) => x.code === 'ab.fx.usdcad')
    return s ? { series: s } : null
  }, [series])
  const { data: fxPoints } = useMarketPrices(fx ? [fx.series.id] : [])
  const cadPerUsd = useMemo(() => {
    const last = [...(fxPoints ?? [])].reverse().find((p) => p.value != null)
    return last?.value ?? null
  }, [fxPoints])

  const boardCad = useMemo(() => {
    const nearby = feederCurve?.points?.[0]
    if (!nearby || cadPerUsd == null) return null
    return { value: cashEquivalent(nearby.value, cadPerUsd), month: nearby.contract_month }
  }, [feederCurve, cadPerUsd])

  const basis = useMemo(() => {
    // Compared against the heaviest class we have a live quote for, because
    // that is the one closest to what the CME feeder contract actually is.
    const byId = bySeries(feederPoints ?? [])
    let heaviest: { lo: number; value: number } | null = null
    for (const s of feederSeries) {
      const band = parseSeriesCode(s.code)?.band
      const last = [...(byId.get(s.id) ?? [])].reverse().find((p) => p.value != null)
      if (!band || last?.value == null) continue
      if (!heaviest || band.lo > heaviest.lo) heaviest = { lo: band.lo, value: last.value }
    }
    if (!heaviest || boardCad?.value == null) return null
    // In $/lb like everything else on this tab. Mixing hundredweight and pounds
    // on one screen is what made the chart unreadable in the first place.
    return sameUnitBasis(cwtToLb(heaviest.value), cwtToLb(boardCad.value), '$/lb')
  }, [feederSeries, feederPoints, boardCad])

  // Every basis we can reconstruct from the weeks we hold, for "is this normal".
  const basisHistory = useMemo(() => {
    if (boardCad?.value == null) return [] as number[]
    // Only one board quote is stored per week so far, so this is thin by design
    // until the weekly ingest has been running a while. The panel says so.
    return basis ? [basis.basis] : []
  }, [basis, boardCad])

  const curveSlope = useMemo(() => {
    const pts = feederCurve?.points ?? []
    if (pts.length < 2) return null
    return pts[pts.length - 1].value - pts[0].value
  }, [feederCurve])

  /** A heavier class we have a live quote for, for the value-of-gain sum. */
  const heavierQuoted = useMemo(() => {
    const byId = bySeries(feederPoints ?? [])
    let best: { lb: number; pricePerLb: number } | null = null
    for (const s of feederSeries) {
      const p = parseSeriesCode(s.code)
      if (p?.kind !== 'steers' || !p.band) continue
      const last = [...(byId.get(s.id) ?? [])].reverse().find((x) => x.value != null)
      if (last?.value == null) continue
      const mid = bandMid(p.band)
      if (mid > OUR_WEIGHT_LB && (!best || mid < best.lb)) {
        best = { lb: mid, pricePerLb: cwtToLb(last.value) }
      }
    }
    return best
  }, [feederSeries, feederPoints, OUR_WEIGHT_LB])

  /**
   * What the sale month's board implies for our calves, at this week's basis.
   *
   * The board is for a heavy feeder in US dollars; our calves are light and
   * Canadian. So it is converted at the day's rate, moved onto our weight with
   * the same slide the derived price uses, and then the CURRENT basis is
   * applied — because a buyer bidding forward is doing exactly that arithmetic.
   * Null unless every piece is there; a forward price built on two guesses is
   * not a bid, and the strategy card says "needs a forward bid" instead.
   */
  const forwardPricePerLb = useMemo(() => {
    const pts = feederCurve?.points ?? []
    // The contract nearest the month the calves actually move in (farm setup; December by default).
    const dec = pts.find((p) => p.contract_month.slice(5, 7) === saleMonthCode) ?? pts.at(-1)
    if (!dec || cadPerUsd == null || basis?.basis == null || !derived?.slide || !derived.lightest) {
      return null
    }
    const boardCwt = dec.value * cadPerUsd
    // Move the board onto our weight, then add the local basis.
    const atOurWeight = derivePrice(
      OUR_WEIGHT_LB,
      { ...derived.lightest, perCwt: boardCwt },
      derived.slide,
    )
    return cwtToLb(atOurWeight) + basis.basis
  }, [feederCurve, cadPerUsd, basis, derived, saleMonthCode, OUR_WEIGHT_LB])

  if (salesLoading) return <p className="text-sm text-gray-500">Loading…</p>

  const priced = years.filter((y) => y.price != null)
  const latestYear = priced.at(-1)
  const forwardYears = years.filter((y) => y.forward)

  // Thirteen cards stacked open made this the longest page in the app. They
  // are grouped by the question they answer: Decide (the farm's own numbers,
  // open), Our sales and Market (folded, remembered per device).
  return (
    <div className="space-y-4">
      {/* Headline */}
      {(ranchRows ?? []).length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
          <span>Sale weights for</span>
          <div className="flex rounded-md border border-gray-200 p-0.5">
            {(ranchRows ?? []).map((r) => (
              <button
                key={r.id}
                onClick={() => setSaleRanchId(r.id)}
                className={cn('rounded px-2 py-0.5', r.id === saleRanch?.id ? 'bg-brand-700 font-semibold text-white' : 'text-gray-600 hover:bg-gray-50')}
              >
                {r.name}
              </button>
            ))}
          </div>
          <span>
            · sold in {saleMonthName}; steers {saleWeightSource(sale.steers)}, heifers {saleWeightSource(sale.heifers)}
          </span>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Last sale"
          value={latestYear?.price != null ? `${money(latestYear.price)}/lb` : '—'}
          sub={latestYear ? `${latestYear.year} · ${latestYear.head} head` : undefined}
        />
        <TodayStat sex="steers" weightLb={OUR_WEIGHT_LB} h={headline.steers} ranch={saleRanch?.name ?? null} source={saleWeightSource(sale.steers)} />
        <TodayStat sex="heifers" weightLb={HEIFER_WEIGHT_LB} h={headline.heifers} ranch={saleRanch?.name ?? null} source={saleWeightSource(sale.heifers)} />
        <Stat
          label="Priced forward"
          value={`${forwardYears.length} of ${years.length}`}
          sub={
            forwardYears.at(-1)?.daysAhead
              ? `${forwardYears.at(-1)!.daysAhead} days ahead last time`
              : undefined
          }
        />
      </div>

      {/* Decide — C9, C11, C12, C14: the farm's own numbers */}
      <CattleEconomics
        ranch={saleRanch?.name ?? latestYear?.ranch ?? ''}
        year={new Date().getFullYear()}
        isManager={isManager}
        ourWeightLb={OUR_WEIGHT_LB}
        todayPricePerLb={headline.steers?.perLb ?? null}
        forwardPricePerLb={forwardPricePerLb}
        onEditCosts={() => onGoToSettings?.(saleRanch?.id)}
        historyPricesPerLb={priced.map((y) => y.price!).filter((p) => p != null)}
        basis={basis?.basis ?? null}
        basisHistory={basisHistory}
        curveSlope={curveSlope}
        heavierClass={heavierQuoted}
      />

      <Fold
        title="Our sales"
        summary={`${(sales ?? []).length} lots · ${forwardYears.length} years priced forward`}
        storageKey="cattle-markets-sales"
        bodyClassName="space-y-4 bg-gray-50/50"
      >
        {/* C1 + C3: what we actually got, year by year */}
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-800">What the calves sold for</h3>
            {isManager && (
              <button
                onClick={() => setEditing('new')}
                className="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                <Plus className="h-3.5 w-3.5" /> Record a sale
              </button>
            )}
          </div>
          <HelpNote className="mt-0.5 text-xs" summary="Weighted by pounds; a hollow point was priced forward." title="About this chart">
            <p>
              Every year since 2008, weighted by pounds rather than by lot. A hollow point was priced
              forward — agreed months before the calves moved.
            </p>
          </HelpNote>
          <SalesHistoryChart rows={priced} sales={sales ?? []} />
          {/* Open by default. The $/lb and buyer of each lot are the record
              somebody comes to this page for, and behind a closed disclosure they
              may as well not exist. */}
          <details className="mt-2" open>
            <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-800">
              Every lot ({(sales ?? []).length})
            </summary>
            <div className="mt-2 max-h-72 overflow-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-gray-500">
                  <tr>
                    {/* pr-3 on every column but the last. Without it a
                        right-aligned figure sits flush against the next column's
                        left-aligned text — "$2.35Hillcrest Auction" — which is two
                        columns in the markup and one to anybody reading it. */}
                    <th className="pb-1 pr-3 font-medium">Year</th>
                    <th className="pb-1 pr-3 font-medium">Ranch</th>
                    <th className="pb-1 pr-3 font-medium">Class</th>
                    <th className="pb-1 pr-3 text-right font-medium">Head</th>
                    <th className="pb-1 pr-3 text-right font-medium">Avg lb</th>
                    <th className="pb-1 pr-6 text-right font-medium">$/lb</th>
                    <th className="pb-1 font-medium">Buyer</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(sales ?? []).map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => isManager && setEditing(s)}
                      className={cn(isManager && 'cursor-pointer hover:bg-gray-50')}
                    >
                      <td className="py-1 pr-3">{s.crop_year}</td>
                      <td className="py-1 pr-3 text-gray-600">{s.ranch}</td>
                      <td className="py-1 pr-3 capitalize text-gray-600">{s.animal_class}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{s.head ?? '—'}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">
                        {s.avg_weight_lb != null ? s.avg_weight_lb.toFixed(0) : '—'}
                      </td>
                      <td className="py-1 pr-6 text-right font-medium tabular-nums">
                        {s.price_per_lb != null ? (
                          money(s.price_per_lb)
                        ) : (
                          <span className="font-normal text-gray-300" title={s.notes ?? undefined}>
                            no price
                          </span>
                        )}
                      </td>
                      <td className="py-1 text-gray-500">{s.buyer ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>

        {/* C13: hindsight */}
        <HindsightTable hindsight={hindsight} />
      </Fold>

      {editing && (
        <SaleEditor
          existing={editing === 'new' ? undefined : editing}
          ranches={[
            ...new Set([...(sales ?? []).map((s) => s.ranch), ...(ranchRows ?? []).map((r) => r.name)]),
          ]}
          isManager={isManager}
          onClose={() => setEditing(null)}
        />
      )}

      <Fold
        title="Market"
        summary="Medicine Hat, Lethbridge, Calgary Stockyards and Team online; the board, basis and the seasonal shape"
        storageKey="cattle-markets-market"
        bodyClassName="space-y-4 bg-gray-50/50"
      >
        {/* C2: the four auction markets beside it */}
        {auctionSeries.length === 0 && (
          <section className="rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-gray-800">Auction prices</h3>
            <p className="mt-1 text-xs text-gray-500">No prices from Medicine Hat, Lethbridge, Calgary Stockyards or Team online yet. They come in each morning.</p>
            <UpdateNow />
          </section>
        )}
        {auctionSeries.length > 0 && (
          <AuctionChart
            series={auctionSeries}
            defaultCommodity={commodityFor({
              cls: 'feeder',
              kind: 'steers',
              band: { lo: Math.floor(OUR_WEIGHT_LB / 100) * 100, hi: Math.floor(OUR_WEIGHT_LB / 100) * 100 + 100 },
            })}
          />
        )}

        {/* C6: the forward curve */}
        <CattleFutures series={series ?? []} />

        {/* C7 + C8 */}
        <BasisPanel
          title="Alberta against the board"
          point={basis}
          cashLabel="Alberta cash, heaviest quoted class"
          boardLabel={`CME feeder in CAD/lb${boardCad?.month ? ` (${boardCad.month.slice(0, 7)})` : ''}`}
          note={
            cadPerUsd != null
              ? `Converted at $${cadPerUsd.toFixed(3)} CAD per USD. When the local price moves, check here first — often it was the dollar, not the cattle.`
              : undefined
          }
        />

        {/* C4 */}
        {seasonal.length > 0 && (
          <section className="rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-gray-800">The shape of a normal year</h3>
            <HelpNote className="mt-0.5 text-xs" summary="Each month against its own year’s average." title="The shape of a normal year">
              <p>
                Each month against its own year&rsquo;s average. You sell in {saleMonthName} — this is what
                {' '}{saleMonthName} usually costs you, or pays you.
              </p>
            </HelpNote>
            <SeasonalityChart rows={seasonal} />
          </section>
        )}

        {/* C10 */}
        <PriceAlerts series={feederSeries} isManager={isManager} />

        <HelpNote
          summary="Cattle prices: Medicine Hat, Lethbridge, Calgary Stockyards and Team online."
          title="Where the prices come from"
        >
          <p>
            Four auction markets, read every day: Medicine Hat Feeder Co-op (its scanned sale reports, read by Claude
            and checked against their own totals), Perlich Bros at Lethbridge, Calgary Stockyards (sale at Strathmore)
            and the Team online feeder sale. Each is watched on the Integrations page, so a market that stops
            reporting is noticed.
          </p>
          <p className="mt-1">
            The figures at the top prefer Medicine Hat and Lethbridge, the nearest markets, when they sold the class in
            the last two weeks; otherwise they average the markets that did. When nobody sold the farm&rsquo;s own
            class, it is worked out from the classes either side and marked derived or extrapolated. The CME board and
            the dollar still come from Alberta Agriculture&rsquo;s weekly review.
          </p>
        </HelpNote>
      </Fold>
    </div>
  )
}

/** C13: every forward sale, scored against the market at delivery. */
function HindsightTable({ hindsight }: { hindsight: ReturnType<typeof scoreHindsight> }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
        <CalendarClock className="h-4 w-4 text-gray-400" /> Did locking in pay?
      </h3>
      <HelpNote className="mt-0.5 text-xs" summary="Every forward sale, against the market at delivery." title="How locking in is scored">
        <p>
          Every forward sale, against where the market actually was by delivery. Years we have no
          market data for are left unscored rather than counted as a draw.
        </p>
      </HelpNote>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 text-left text-xs text-gray-500">
            <tr>
              <th className="pb-1 pr-3 font-medium">Year</th>
              <th className="pb-1 pr-3 font-medium">Sold</th>
              <th className="pb-1 pr-4 text-right font-medium">Ahead</th>
              <th className="pb-1 pr-4 text-right font-medium">Locked at</th>
              <th className="pb-1 pr-4 text-right font-medium">Market at delivery</th>
              <th className="pb-1 text-right font-medium">Call</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {hindsight.length === 0 && (
              <tr>
                <td colSpan={6} className="py-3 text-center text-sm text-gray-400">
                  No forward sales recorded yet.
                </td>
              </tr>
            )}
            {hindsight.map((h) => (
              <tr key={`${h.row.year}-${h.row.ranch}`}>
                <td className="py-1.5 pr-3 font-medium text-gray-800">{h.row.year}</td>
                <td className="py-1.5 pr-3 text-gray-600">{h.row.saleDate}</td>
                <td className="py-1.5 pr-4 text-right tabular-nums text-gray-600">
                  {h.row.daysAhead} d
                </td>
                <td className="py-1.5 pr-4 text-right tabular-nums text-gray-800">
                  {h.row.price != null ? `${money(h.row.price)}/lb` : '—'}
                </td>
                <td className="py-1.5 pr-4 text-right tabular-nums text-gray-600">
                  {h.marketAtDelivery != null ? (
                    `${money(h.marketAtDelivery)}/lb`
                  ) : (
                    <span className="text-gray-300">not yet</span>
                  )}
                </td>
                <td className="py-1.5 text-right">
                  {h.advantage == null ? (
                    <Minus className="ml-auto h-4 w-4 text-gray-300" />
                  ) : h.advantage >= 0 ? (
                    <span className="flex items-center justify-end gap-1 tabular-nums text-green-700">
                      <Check className="h-3.5 w-3.5" /> +{money(h.advantage)}
                    </span>
                  ) : (
                    <span className="flex items-center justify-end gap-1 tabular-nums text-red-700">
                      <X className="h-3.5 w-3.5" /> {money(h.advantage)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** The forward curves worth showing, in the order a decision uses them. */
function CattleFutures({ series }: { series: MarketSeries[] }) {
  const wanted = ['cme.feeder', 'cme.live', 'cme.cad']
  const found = wanted
    .map((code) => series.find((s) => s.code === code))
    .filter((s): s is MarketSeries => s != null)
  if (found.length === 0) return null
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-800">The forward market</h3>
      <HelpNote className="mt-0.5 text-xs" summary="What a feedlot bidding on your calves works from." title="Why the board matters">
        <p>
          A feedlot bidding on your calves is working from the CME board, converted at the day&rsquo;s
          dollar. Both curves are here for that reason.
        </p>
      </HelpNote>
      <div className="mt-2 space-y-4">
        {found.map((s) => (
          <FuturesCurve key={s.id} series={s} />
        ))}
      </div>
    </section>
  )
}

function SalesHistoryChart({
  rows,
  sales,
}: {
  rows: ReturnType<typeof byYear>
  sales: CattleSale[]
}) {
  const classes = useMemo(() => animalClasses(sales), [sales])
  // Heifers and bulls by default because between them they are 41 of the 44
  // lots ever recorded; steers and runts are two and one, and drawn by default
  // they are three dots pretending to be a trend.
  const [shown, setShown] = useState<Set<string>>(
    () => new Set(classes.filter((c) => c === 'heifers' || c === 'bulls')),
  )
  const [showAverage, setShowAverage] = useState(true)

  const picked = useMemo(() => classes.filter((c) => shown.has(c)), [classes, shown])
  const perClass = useMemo(() => byYearAndClass(sales, picked), [sales, picked])

  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-400">No priced sales recorded.</p>
  }

  // One row per year carrying the average and every shown class, so the lines
  // share an x-axis without Recharts having to reconcile two datasets.
  const avgByYear = new Map(rows.map((r) => [r.year, r]))
  const years = [...new Set([...rows.map((r) => r.year), ...perClass.map((p) => p.year)])].sort(
    (a, b) => a - b,
  )
  const line = years.map((year) => ({
    year,
    price: avgByYear.get(year)?.price ?? null,
    forward: avgByYear.get(year)?.forward ?? false,
    ...(perClass.find((p) => p.year === year) ?? {}),
  }))

  const toggle = (c: string) =>
    setShown((prev) => {
      const next = new Set(prev)
      if (next.has(c)) next.delete(c)
      else next.add(c)
      return next
    })

  return (
    <div className="mt-3">
      <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs">
        {classes.map((c) => {
          const on = shown.has(c)
          const colour = CLASS_COLOURS[c] ?? CLASS_FALLBACK
          return (
            <button
              key={c}
              onClick={() => toggle(c)}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-2.5 py-1 capitalize',
                on ? 'border-transparent text-white' : 'border-gray-300 text-gray-500',
              )}
              style={on ? { background: colour } : undefined}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: on ? '#fff' : colour }} />
              {c}
            </button>
          )
        })}
        <button
          onClick={() => setShowAverage((v) => !v)}
          className={cn(
            'ml-auto rounded-full border px-2.5 py-1',
            showAverage
              ? 'border-transparent bg-gray-800 text-white'
              : 'border-gray-300 text-gray-500',
          )}
        >
          All classes, weighted
        </button>
      </div>

      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={line} margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="year" tick={{ fontSize: 11, fill: '#94a3b8' }} />
          <YAxis
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            width={48}
            tickFormatter={(v: number) => `$${v.toFixed(2)}`}
          />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #e2e8f0' }}
            formatter={(v, name) => [`$${Number(v).toFixed(2)}/lb`, String(name)]}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />

          {picked.map((c) => (
            <Line
              key={c}
              type="monotone"
              name={c}
              dataKey={c}
              stroke={CLASS_COLOURS[c] ?? CLASS_FALLBACK}
              strokeWidth={2}
              // A class not sold that year is null; joining across the gap
              // would draw a price nobody was ever paid.
              connectNulls={false}
              dot={{ r: 3 }}
              isAnimationActive={false}
            />
          ))}

          {showAverage && (
            <Line
              type="monotone"
              name="All classes"
              dataKey="price"
              stroke="#0f766e"
              strokeWidth={2.4}
              strokeDasharray={picked.length ? '5 3' : undefined}
              isAnimationActive={false}
              dot={(props: { cx?: number; cy?: number; index?: number }) => {
                const r = line[props.index ?? 0]
                return (
                  <circle
                    key={r?.year ?? props.index}
                    cx={props.cx}
                    cy={props.cy}
                    r={4}
                    // Hollow where the price was agreed months ahead of delivery.
                    fill={r?.forward ? '#ffffff' : '#0f766e'}
                    stroke="#0f766e"
                    strokeWidth={2}
                  />
                )
              }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

const KIND_BADGE: Record<Headline['kind'], string> = {
  quote: 'bg-green-100 text-green-800',
  derived: 'bg-amber-100 text-amber-800',
  extrapolated: 'bg-orange-100 text-orange-800',
}

/**
 * "Today, 450 lb steers": the sex, the farm's sale weight (Farm setup), the
 * markets and sale dates behind it, and whether it is a quote or worked out —
 * with the arithmetic behind the info button.
 */
function TodayStat({ sex, weightLb, h, ranch, source }: { sex: 'steers' | 'heifers'; weightLb: number; h: Headline | null; ranch: string | null; source: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-center gap-1">
        <p className="text-[11px] uppercase tracking-wide text-gray-500">
          Today, {weightLb} lb {sex}
        </p>
        {h && (
          // Outside the uppercase label: the panel is a DOM child of whatever
          // holds the button and would inherit the text-transform.
          <InfoPopover title={`How the ${weightLb} lb ${sex} price is worked out`}>
            <div className="space-y-1.5 text-xs text-gray-700">
              {explainHeadline(h, sex).map((p, i) => (
                <p key={i}>{p}</p>
              ))}
              <p className="text-gray-500">
                The weight is {ranch ? `${ranch}’s` : 'the farm’s'} {sex === 'steers' ? 'steer' : 'heifer'} sale weight ({source}) — set it in Cattle settings.
                {sex === 'steers' &&
                  ' Until 5 Oct 2026 this card took whichever market’s 500–600 lb row came first — Clyde, $660.50/cwt on 2 Oct — and slid it down 100 lb at $0.57/cwt a pound (the 500–600 and 600–700 lb averages across markets, $640.01 and $583.00): $660.50 + 100 × $0.57 = $717.50/cwt, or $7.17/lb. Clyde is not one of the farm’s markets and one row is not the market, so that is no longer done.'}
              </p>
            </div>
          </InfoPopover>
        )}
      </div>
      <p className="mt-0.5 text-xl font-bold tabular-nums text-gray-900">
        {h ? `${money(h.perLb)}/lb` : '—'}
        {h && (
          <span className={cn('ml-1.5 rounded px-1 text-[10px] font-medium uppercase', KIND_BADGE[h.kind])}>{h.kind}</span>
        )}
      </p>
      <p className="mt-0.5 text-[11px] text-gray-400">
        {h ? headlineSub(h) : `none sold near ${weightLb} lb at the four markets in the last two weeks`}
      </p>
    </div>
  )
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub?: string
  tone?: 'derived'
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums text-gray-900">
        {value}
        {tone === 'derived' && value !== '—' && (
          <span className="ml-1.5 rounded bg-amber-100 px-1 text-[10px] font-medium uppercase text-amber-800">
            derived
          </span>
        )}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-gray-400">{sub}</p>}
    </div>
  )
}
