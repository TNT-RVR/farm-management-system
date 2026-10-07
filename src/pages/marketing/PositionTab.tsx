import { useMemo, useState } from 'react'
import { SETUP_LINKS, SetupLink } from '@/components/SetupLink'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCropPosition, useLatestCropPrices } from '@/lib/marketing-data'
import { isMarketable, summarise, type Position } from '@/lib/marketing'
import { realisedVsMarket } from '@/lib/contracts'
import { perBushel, useMarketSeries } from '@/lib/markets'
import { fmtMoney } from '@/lib/applied'
import { fmtUnitPrice } from '@/lib/board-price'
import { cn } from '@/lib/utils'

/**
 * Every market price in one year, per crop, in $/bu — for "sold vs market".
 *
 * The same sum the Markets page's position panel did, which this table
 * replaced: tonne-quoted series tied to a crop, each point turned into a
 * bushel price at the crop's bushel weight. Fetched for the one year only, so
 * a long price history is not pulled down to average twelve months of it.
 */
function useYearMarketPrices(year: number) {
  const { data: series } = useMarketSeries('crop')
  const linked = useMemo(
    () =>
      (series ?? []).filter(
        (s) => s.crop_id && s.unit.includes('tonne') && perBushel(1, s.commodity) != null,
      ),
    [series],
  )
  const ids = linked.map((s) => s.id).sort()
  const { data: points } = useQuery({
    queryKey: ['market-prices-year', year, ids.join(',')],
    enabled: ids.length > 0,
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('market_prices')
        .select('series_id, observed_on, value')
        .in('series_id', ids)
        .gte('observed_on', `${year}-01-01`)
        .lt('observed_on', `${year + 1}-01-01`)
      if (error) throw error
      return data ?? []
    },
  })
  return useMemo(() => {
    const m = new Map<string, number[]>()
    for (const s of linked) {
      const per = perBushel(1, s.commodity)!
      const vals = (points ?? [])
        .filter((p) => p.series_id === s.id && p.value != null)
        .map((p) => Number(p.value) * per)
      if (vals.length) m.set(s.crop_id!, [...(m.get(s.crop_id!) ?? []), ...vals])
    }
    return m
  }, [linked, points])
}

const qty = (n: number, unit: string) =>
  `${Math.round(n).toLocaleString('en-CA')} ${unit}`

/** A bar showing how much of a crop is sold, in one glance. */
function PricedBar({ fraction }: { fraction: number | null }) {
  if (fraction == null) return <span className="text-xs text-gray-300">—</span>
  const pct = Math.round(fraction * 100)
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-gray-200">
        <div
          className={cn('h-full rounded-full', pct === 0 ? 'bg-gray-300' : 'bg-brand-600')}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>
      <span className="tabular-nums text-xs text-gray-600">{pct}%</span>
    </div>
  )
}

/**
 * Priced against unpriced, per crop.
 *
 * The number the whole screen exists for is the open position — what you still
 * have to sell — and what it is worth at today's board. Everything else is
 * context for it.
 */
export function PositionTab({ year }: { year: number }) {
  const { data, isLoading } = useCropPosition()
  const { data: prices } = useLatestCropPrices()
  const marketPrices = useYearMarketPrices(year)
  const [showAll, setShowAll] = useState(false)

  const rows = useMemo(() => {
    const forYear = (data ?? []).filter((p) => p.cropYear === year)
    return (showAll ? forYear : forYear.filter(isMarketable)).sort(
      (a, b) => b.expected - a.expected,
    )
  }, [data, year, showAll])

  const hidden = (data ?? []).filter((p) => p.cropYear === year && !isMarketable(p)).length

  if (isLoading) return <p className="text-sm text-gray-500">Loading…</p>
  if (rows.length === 0)
    return (
      <p className="rounded-lg border border-gray-200 bg-white px-3 py-10 text-center text-sm text-gray-500">
        Nothing planned for {year} yet.
      </p>
    )

  const anyContracts = rows.some((r) => r.contracted > 0)
  // What is still open is worth, summed over the crops a board price exists for.
  const openAtBoard = rows.reduce((sum, p) => {
    const board = prices?.byCrop.get(p.cropId)
    return board ? sum + (summarise(p).openValueAt(board.value) ?? 0) : sum
  }, 0)

  return (
    <>
      {!anyContracts && (
        <p className="mb-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            No contracts recorded for {year}, so every bushel below counts as open. Enter them under
            Contracts and this becomes a real picture of what is sold.{' '}
            <SetupLink managerOnly to={SETUP_LINKS.contracts()}>Enter contracts</SetupLink>
          </span>
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2 font-medium">Crop</th>
              <th className="px-3 py-2 text-right font-medium">Acres</th>
              <th className="px-3 py-2 text-right font-medium">Expected</th>
              <th className="px-3 py-2 text-right font-medium">Contracted</th>
              <th className="px-3 py-2 text-right font-medium">Delivered</th>
              <th className="px-3 py-2 font-medium">Priced</th>
              <th className="px-3 py-2 text-right font-medium">Avg price</th>
              <th className="px-3 py-2 text-right font-medium">Sold vs market</th>
              <th className="px-3 py-2 text-right font-medium">Open</th>
              <th className="px-3 py-2 text-right font-medium">Open at board</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((p: Position) => {
              const s = summarise(p)
              const board = prices?.byCrop.get(p.cropId)
              // Market prices are per bushel, so only a bushel crop compares.
              const vs =
                p.unit === 'bu'
                  ? realisedVsMarket(s.avgContractPrice, marketPrices.get(p.cropId) ?? [])
                  : null
              return (
                <tr key={`${p.cropYear}-${p.cropId}`}>
                  <td className="px-3 py-2 font-medium text-gray-800">
                    {p.cropName}
                    {p.category === 'own_use' && (
                      <span className="ml-1.5 text-[10px] text-gray-400">own use</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                    {Math.round(p.acres).toLocaleString('en-CA')}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{qty(p.expected, p.unit)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {p.contracted === 0 ? (
                      <span className="text-gray-300">—</span>
                    ) : (
                      qty(p.contracted, p.unit)
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                    {p.delivered > 0 ? qty(p.delivered, p.unit) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <PricedBar fraction={s.pricedFraction} />
                    {s.oversold != null && (
                      <span className="mt-0.5 block text-[10px] font-medium text-red-700">
                        oversold by {qty(s.oversold, p.unit)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {s.avgContractPrice == null ? (
                      <span className="text-gray-300">—</span>
                    ) : (
                      `${fmtUnitPrice(s.avgContractPrice, p.unit)}/${p.unit}`
                    )}
                  </td>
                  {/* What we got against the year's average market price: the
                      after-the-fact judge of timing, not of the price. */}
                  <td
                    className={cn(
                      'px-3 py-2 text-right tabular-nums',
                      vs == null ? 'text-gray-300' : vs.diff >= 0 ? 'text-green-700' : 'text-red-600',
                    )}
                    title={
                      vs
                        ? `Contracted at ${fmtUnitPrice(s.avgContractPrice!, p.unit)} against a ${fmtUnitPrice(vs.market, p.unit)} average`
                        : 'Needs contracts and a few months of market prices'
                    }
                  >
                    {vs == null ? '—' : `${vs.pct >= 0 ? '+' : ''}${vs.pct.toFixed(1)}%`}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {qty(s.open, p.unit)}
                  </td>
                  {/* Only where a board price exists for this crop. A made-up
                      price on an open position is worse than a blank. The
                      series is $/tonne; board.value is already per crop unit. */}
                  <td className="px-3 py-2 text-right tabular-nums">
                    {board ? (
                      <span title={`${board.name}, ${board.on} — ${board.basis}`}>
                        {fmtMoney(s.openValueAt(board.value) ?? 0)}
                        <span className="block text-[10px] text-gray-400">
                          at {fmtUnitPrice(board.value, board.unit)}/{board.unit}
                          {board.converted && ` (from ${board.quoted})`}
                        </span>
                      </span>
                    ) : (
                      <span
                        className="text-gray-300"
                        title="No market series linked to this crop in a unit it can be converted from"
                      >
                        —
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
          {openAtBoard > 0 && (
            <tfoot>
              <tr className="border-t border-gray-200 font-medium">
                <td className="px-3 py-2" colSpan={9}>
                  Open, at today&rsquo;s board
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(openAtBoard)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="mt-2 text-[11px] text-gray-500">
        Expected is planned acres × yield — a forecast until it is in the bin. Contracted and
        delivered are facts.
      </p>

      {hidden > 0 && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="mt-2 text-xs text-gray-500 underline hover:text-gray-700"
        >
          {showAll
            ? 'Hide crops that are never sold'
            : `Show ${hidden} crop${hidden === 1 ? '' : 's'} grown for our own use`}
        </button>
      )}
    </>
  )
}
