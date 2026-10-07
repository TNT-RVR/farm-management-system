import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileText, Scale, TrendingUp } from 'lucide-react'
import { Fold } from '@/components/Fold'
import { HelpNote } from '@/components/HelpNote'
import { InfoPopover } from '@/components/InfoPopover'
import { PriceChart } from '@/components/PriceChart'
import { crossUnitBasis, sameUnitBasis, type BasisPoint } from '@/lib/basis'
import { SeasonalityChart } from '@/components/SeasonalityChart'
import { FuturesCurve } from '@/components/FuturesCurve'
import {
  bySeries,
  percentileOf,
  perBushel,
  seasonality,
  sinceYears,
  TONNE_PER_BU,
  useFuturesCurve,
  useMarketPrices,
  useMarketSeries,
  type MarketSeries, useArchiveCommodity } from '@/lib/markets'
import { PriceAlerts } from '@/components/PriceAlerts'
import { ScenarioPanel } from '@/pages/plan/ScenarioPanel'
import { useCropPosition } from '@/lib/marketing-data'
import { summarise } from '@/lib/marketing'
import { useCropInputs, useCrops } from '@/lib/queries'
import { useCropYear } from '@/lib/crop-year'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'

const ZOOMS = [
  { label: '1y', years: 1 },
  { label: '5y', years: 5 },
  { label: '10y', years: 10 },
  { label: 'All', years: null },
] as const

/**
 * The crops worth putting on this page first, in the order a Prairie Creek year
 * thinks about them. Anything else the ingesters carry still appears, just
 * after these.
 */
const PREFERRED = ['Canola', 'Durum wheat', 'Wheat', 'Barley', 'Corn', 'Feed barley']

/** Named so the basis note can say which bushel weight it used. */
const TONNE_PER_BU_LABEL = (commodity: string | null) => {
  const bu = commodity ? TONNE_PER_BU[commodity.toLowerCase()] : undefined
  return bu ? `${bu} bu/tonne` : 'its bushel weight'
}

const money = (v: number, dp = 2) =>
  v.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: dp })

/** A commodity's series split into the three things they mean. */
function groupSeries(series: MarketSeries[]) {
  return {
    history: series.filter((s) => s.source === 'statcan'),
    bids: series.filter((s) => s.source === 'ab-crop' && s.unit.includes('tonne')),
    futures: series.filter((s) => s.unit.includes('bu') || s.code.startsWith('ice.')),
  }
}

export function MarketsTab() {
  const { data: allSeries, isLoading } = useMarketSeries('crop')
  const { cropYear } = useCropYear()
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const { data: crops } = useCrops()
  const { data: cropInputs } = useCropInputs(cropYear)
  const [commodity, setCommodity] = useState<string | null>(null)
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>(ZOOMS[2])
  const [showArchived, setShowArchived] = useState(false)
  const archiveCommodity = useArchiveCommodity()

  /** Whether every series for a commodity is archived. */
  const isArchived = (name: string) =>
    (allSeries ?? []).filter((s) => s.commodity === name).every((s) => s.archived)
  const archivedCount = useMemo(
    () =>
      new Set((allSeries ?? []).filter((s) => s.archived).map((s) => s.commodity)).size,
    [allSeries],
  )

  const commodities = useMemo(() => {
    const visible = (allSeries ?? []).filter((s) => showArchived || !s.archived)
    const names = [...new Set(visible.map((s) => s.commodity))]
    return names.sort((a, b) => {
      const ia = PREFERRED.indexOf(a)
      const ib = PREFERRED.indexOf(b)
      if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
      return a.localeCompare(b)
    })
  }, [allSeries, showArchived])

  const chosen = commodity ?? commodities[0] ?? null
  const mine = useMemo(
    () => (allSeries ?? []).filter((s) => s.commodity === chosen),
    [allSeries, chosen],
  )
  const groups = useMemo(() => groupSeries(mine), [mine])
  const ids = useMemo(() => mine.map((s) => s.id), [mine])
  const { data: points } = useMarketPrices(ids)

  const byId = useMemo(() => bySeries(points ?? []), [points])
  const historyPoints = useMemo(
    () => groups.history.flatMap((s) => byId.get(s.id) ?? []),
    [groups.history, byId],
  )
  const seasonal = useMemo(() => seasonality(historyPoints), [historyPoints])

  // The latest elevator bid, which is the number you would actually sell into.
  const latestBid = useMemo(() => {
    let best: { series: MarketSeries; on: string; value: number } | null = null
    for (const s of groups.bids) {
      const pts = byId.get(s.id) ?? []
      const last = [...pts].reverse().find((p) => p.value != null)
      if (last?.value != null && (!best || last.observed_on > best.on)) {
        best = { series: s, on: last.observed_on, value: last.value }
      }
    }
    return best
  }, [groups.bids, byId])

  const latestHistory = useMemo(() => {
    const last = [...historyPoints].reverse().find((p) => p.value != null)
    return last ?? null
  }, [historyPoints])

  const pct =
    latestHistory?.value != null ? percentileOf(latestHistory.value, historyPoints) : null

  // ── Feature 6: basis, cash against the board ─────────────────────────────
  //
  // Canola is the honest one: ICE trades in Canadian dollars a tonne, exactly
  // as an elevator quotes it, so no conversion enters the number at all. The US
  // grains need bushel weight and the dollar, and both are shown.
  const boardSeries = useMemo(
    () => groups.futures.find((s) => s.code.startsWith('ice.')) ?? groups.futures[0] ?? null,
    [groups.futures],
  )
  const { data: boardCurve } = useFuturesCurve(boardSeries?.id)
  const { data: fxSeries } = useMarketSeries('fx')
  const fxId = useMemo(
    () => (fxSeries ?? []).find((s) => s.code === 'ab.fx.usdcad')?.id ?? null,
    [fxSeries],
  )
  const { data: fxPoints } = useMarketPrices(fxId ? [fxId] : [])
  const cadPerUsd = useMemo(() => {
    const last = [...(fxPoints ?? [])].reverse().find((p) => p.value != null)
    return last?.value ?? null
  }, [fxPoints])

  const basis = useMemo(() => {
    const nearby = boardCurve?.points?.[0]
    if (!latestBid || !nearby || !boardSeries || !chosen) return null
    if (boardSeries.unit.includes('tonne')) {
      return sameUnitBasis(latestBid.value, nearby.value, '$/tonne')
    }
    if (cadPerUsd == null) return null
    return crossUnitBasis(latestBid.value, nearby.value, chosen, cadPerUsd)
  }, [latestBid, boardCurve, boardSeries, cadPerUsd, chosen])

  const chosenCrop = useMemo(
    () => (crops ?? []).find((c) => c.name.toLowerCase() === (chosen ?? '').toLowerCase()) ?? null,
    [crops, chosen],
  )
  const costPerAcre = useMemo(() => {
    if (!chosenCrop) return null
    const rows = (cropInputs ?? []).filter((i) => i.crop_id === chosenCrop.id && i.cost_per_acre != null)
    return rows.length ? rows.reduce((s, i) => s + Number(i.cost_per_acre), 0) : null
  }, [cropInputs, chosenCrop])

  // How much of the crop on screen is sold. The table itself — every crop,
  // delivered, sold against the market — is Contracts › Position; this page
  // had its own copy with a second contract editor, and one place to keep
  // contracts is enough.
  const { data: positions } = useCropPosition()
  const soldFraction = useMemo(() => {
    if (!chosenCrop) return null
    const p = (positions ?? []).find((r) => r.cropYear === cropYear && r.cropId === chosenCrop.id)
    return p ? summarise(p).pricedFraction : null
  }, [positions, chosenCrop, cropYear])

  if (isLoading) return <p className="text-sm text-gray-500">Loading market data…</p>
  if (commodities.length === 0) {
    return (
      <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
        No market prices yet. The Alberta reviews and StatCan history sync on their own schedule.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {commodities.map((c) => (
            <button
              key={c}
              onClick={() => setCommodity(c)}
              className={cn(
                'rounded-md border px-2.5 py-1 text-sm',
                chosen === c
                  ? 'border-brand-700 bg-brand-700 font-medium text-white'
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
              )}
            >
              {c}
              {showArchived && isArchived(c) && (
                <span className="ml-1 text-[10px] opacity-60">archived</span>
              )}
            </button>
          ))}
        </div>
        {isManager && chosen && (
          <button
            onClick={() =>
              archiveCommodity.mutate({
                commodity: chosen,
                kind: 'crop',
                archived: !isArchived(chosen),
              })
            }
            title={
              isArchived(chosen)
                ? `Show ${chosen} in this list again`
                : `Hide ${chosen} — we do not grow it. The price history is kept.`
            }
            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-500 hover:bg-gray-50 hover:text-gray-800"
          >
            {isArchived(chosen) ? `Unarchive ${chosen}` : `Archive ${chosen}`}
          </button>
        )}
        {archivedCount > 0 && (
          <button
            onClick={() => setShowArchived((v) => !v)}
            className="rounded-md px-2 py-1 text-xs text-gray-500 underline hover:text-gray-800"
          >
            {showArchived ? 'Hide archived' : `Show ${archivedCount} archived`}
          </button>
        )}
        <div className="ml-auto flex rounded-md border border-gray-200 bg-white p-0.5 text-xs">
          {ZOOMS.map((z) => (
            <button
              key={z.label}
              onClick={() => setZoom(z)}
              className={cn(
                'rounded px-2 py-1',
                zoom.label === z.label ? 'bg-brand-700 font-semibold text-white' : 'text-gray-600',
              )}
            >
              {z.label}
            </button>
          ))}
        </div>
      </div>

      {/* Today's numbers, and where they sit in history. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Elevator bid"
          sub={latestBid ? `${latestBid.series.region ?? ''} · ${latestBid.on}` : 'not quoted'}
          value={latestBid ? money(latestBid.value, 0) : '—'}
          extra={
            latestBid && chosen
              ? perBushel(latestBid.value, chosen)
                ? `${money(perBushel(latestBid.value, chosen)!, 2)}/bu`
                : null
              : null
          }
        />
        <Stat
          label="Farm gate"
          sub={latestHistory ? `Alberta · ${latestHistory.observed_on.slice(0, 7)}` : 'no history'}
          value={latestHistory?.value != null ? money(latestHistory.value, 0) : '—'}
        />
        <Stat
          label="Against its own history"
          sub={pct == null ? 'not enough history' : `${historyPoints.length} months on record`}
          value={pct == null ? '—' : `${pct}th percentile`}
          tone={pct == null ? undefined : pct >= 70 ? 'good' : pct <= 30 ? 'poor' : undefined}
        />
      </div>

      {/* 1. Price history, 3. elevator bids on the same axis. */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
          {chosen} — price history
          <InfoPopover title="Farm gate and elevator bid">
            Alberta farm gate monthly, with the weekly elevator bid where we have it. Farm gate is a
            provincial average and a month at a time; the elevator bid is what you would sell into.
          </InfoPopover>
        </h3>
        <PriceChart
          series={[...groups.history, ...groups.bids]}
          points={sinceYears(points ?? [], zoom.years)}
          unit="$/tonne"
        />
      </section>

      {/* 6. Basis, in a line: the working is behind ⓘ, the record of past
          bids and how this one compares is the Basis tab. */}
      <BasisLine
        point={basis}
        cashLabel={`Elevator bid${latestBid?.series.region ? ` · ${latestBid.series.region}` : ''}`}
        boardLabel={boardSeries?.name ?? 'Board'}
        note={
          boardSeries?.unit.includes('tonne')
            ? 'Both sides are Canadian dollars a tonne, so nothing is converted — this is the most trustworthy basis on the page.'
            : cadPerUsd != null
              ? `Board converted to $/tonne at ${TONNE_PER_BU_LABEL(chosen)} and $${cadPerUsd.toFixed(3)} CAD per USD.`
              : undefined
        }
      />

      {/* 9 + 10 + 12: the position and the contracts are on Contracts. */}
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-gray-700">
        <FileText className="h-4 w-4 text-gray-400" />
        {soldFraction != null ? (
          <span>
            <strong className="tabular-nums">{Math.round(soldFraction * 100)}%</strong> of {cropYear}{' '}
            {chosen?.toLowerCase()} sold
          </span>
        ) : (
          <span>What is sold, and what is still to sell</span>
        )}
        <Link to="/contracts?tab=position" className="text-xs text-brand-700 underline">
          Contracts › Position
        </Link>
      </p>

      {/* 7 */}
      <PriceAlerts series={[...groups.bids, ...groups.history]} isManager={isManager} />

      {/* 5. Futures curve. */}
      {groups.futures.length > 0 && (
        <Fold
          title="Forward curve"
          summary="what the market pays today for delivery later"
          storageKey="mkt-forward-curve"
        >
          <HelpNote summary="Sloping up, the market will carry the crop for you; down, it wants it now.">
            What the market is paying today for delivery later. A curve sloping up is the market
            offering to carry the crop for you; sloping down, it wants it now.
          </HelpNote>
          <div className="mt-2 space-y-4">
            {groups.futures.map((s) => (
              <FuturesCurve key={s.id} series={s} />
            ))}
          </div>
        </Fold>
      )}

      {/* 2. Seasonality. */}
      {seasonal.length > 0 && (
        <Fold
          title="The shape of a normal year"
          summary="each month against its year’s average"
          storageKey="mkt-seasonality"
        >
          <HelpNote summary="Last ten years, each month against its own year’s average.">
            Each month against its own year&rsquo;s average, over the last ten years. Indexed
            per year on purpose — otherwise this would just be a picture of which years were dear.
          </HelpNote>
          <SeasonalityChart rows={seasonal} />
        </Fold>
      )}

      {/* 8 + 11. ScenarioPanel draws its own card; inside the fold it loses
          the border so it is not a box in a box. */}
      {chosen && (
        <Fold
          title="Break-even and what-ifs"
          summary={chosen}
          storageKey="mkt-scenario"
          bodyClassName="p-0 [&>section]:rounded-none [&>section]:border-0"
        >
          <ScenarioPanel
            cropName={chosen}
            costPerAcre={costPerAcre}
            defaultYield={chosenCrop?.default_yield_per_acre ?? null}
            yieldUnit={chosenCrop?.yield_unit ?? null}
            todayBidPerBushel={
              latestBid && chosen ? perBushel(latestBid.value, chosen) : null
            }
          />
        </Fold>
      )}
    </div>
  )
}

/**
 * Cash against the board, in one line.
 *
 * Was the full BasisPanel with the subtraction laid out in three big figures.
 * The three figures are all still here — the basis, and the bid and board it
 * came from — and the record of past bids, which says whether today's basis is
 * a good one, is the Basis tab this links to.
 */
function BasisLine({
  point,
  cashLabel,
  boardLabel,
  note,
}: {
  point: BasisPoint | null
  cashLabel: string
  boardLabel: string
  note?: string
}) {
  const fmt = (v: number) =>
    `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-CA', { maximumFractionDigits: 2 })}`
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-700">
      <Scale className="h-4 w-4 text-gray-400" />
      {point ? (
        <>
          <span>
            Basis{' '}
            <strong className={cn('tabular-nums', point.basis >= 0 ? 'text-green-700' : 'text-gray-900')}>
              {fmt(point.basis)}
            </strong>{' '}
            <span className="text-xs text-gray-500">{point.unit}</span>
          </span>
          <span className="text-xs tabular-nums text-gray-500">
            {cashLabel} {fmt(point.cash)} − {boardLabel} {fmt(point.futuresEquivalent)}
          </span>
        </>
      ) : (
        <span className="text-xs text-gray-500">Basis: not enough quoted this week to work it out.</span>
      )}
      <InfoPopover title="What the elevator pays against the board">
        {point ? (
          <p>Basis is the elevator bid minus the board, both in the same unit.</p>
        ) : (
          <p>
            Not enough quoted this week to work it out. Basis needs a cash bid and a board price in
            the same week, and one of them is missing.
          </p>
        )}
        {note && <p>{note}</p>}
      </InfoPopover>
      <Link to="/markets?tab=basis" className="text-xs text-brand-700 underline">
        Basis history
      </Link>
    </div>
  )
}

function Stat({
  label,
  value,
  sub,
  extra,
  tone,
}: {
  label: string
  value: string
  sub?: string
  extra?: string | null
  tone?: 'good' | 'poor'
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-gray-500">
        <TrendingUp className="h-3 w-3" /> {label}
      </p>
      <p
        className={cn(
          'mt-0.5 text-xl font-bold tabular-nums',
          tone === 'good' ? 'text-green-700' : tone === 'poor' ? 'text-red-700' : 'text-gray-900',
        )}
      >
        {value}
      </p>
      {extra && <p className="text-xs tabular-nums text-gray-600">{extra}</p>}
      {sub && <p className="mt-0.5 text-[11px] text-gray-400">{sub}</p>}
    </div>
  )
}
