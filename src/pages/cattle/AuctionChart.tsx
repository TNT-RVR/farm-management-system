import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { PriceChart } from '@/components/PriceChart'
import { HelpNote } from '@/components/HelpNote'
import { sinceYears, useMarketPrices, type MarketSeries } from '@/lib/markets'
import {
  AUCTION_MARKETS,
  MARKET_KEYS,
  marketByKey,
  parseSeriesCode,
  shortDate,
  type AuctionClass,
} from '@/lib/auction-markets'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

// The four auction markets on one chart, one class at a time: a line per
// market, so "what did 400-500 lb steers bring at each" is a glance. All of
// them at once was twenty-odd lines nobody could tell apart.

const GROUPS: { key: string; label: string; classes: AuctionClass[] }[] = [
  { key: 'feeder', label: 'Calves and feeders', classes: ['feeder'] },
  { key: 'yearling', label: 'Yearlings', classes: ['yearling'] },
  { key: 'cull', label: 'Cows, bulls, slaughter', classes: ['cows', 'bulls', 'heiferettes', 'slaughter'] },
]

const KIND_ORDER = ['steers', 'heifers', 'bulls', 'd1-d2', 'd3-d4', 'feeder', 'grain-fed', 'slaughter', 'holstein', 'mature', 'yearling', 'all']
const CLASS_ORDER: AuctionClass[] = ['feeder', 'yearling', 'cows', 'bulls', 'heiferettes', 'slaughter']

/** The market's own note for the week, newest per market. Nothing before the migration lands. */
function useAuctionNotes() {
  return useQuery({
    queryKey: ['auction-notes'],
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 21 * 86_400_000).toISOString().slice(0, 10)
      const { data, error } = await supabase
        .from('auction_reports')
        .select('market, sale_date, comment')
        .not('comment', 'is', null)
        .gte('sale_date', since)
        .order('sale_date', { ascending: false })
        .limit(20)
      if (error) return []
      const seen = new Set<string>()
      return (data ?? []).filter((r) => (seen.has(r.market) ? false : (seen.add(r.market), true))) as {
        market: string
        sale_date: string
        comment: string
      }[]
    },
  })
}

export function AuctionChart({
  series,
  defaultCommodity,
}: {
  /** Every series from the four markets. */
  series: MarketSeries[]
  /** Opens on this class, e.g. "Feeder steers 400-500 lb" — the farm's own. */
  defaultCommodity: string
}) {
  const [group, setGroup] = useState('feeder')
  const [picked, setPicked] = useState<string | null>(null)
  const [zoomYears, setZoomYears] = useState<number | null>(1)
  const { data: notes } = useAuctionNotes()

  const commodities = useMemo(() => {
    const classes = GROUPS.find((g) => g.key === group)?.classes ?? []
    const seen = new Map<string, { commodity: string; sort: [number, number, number] }>()
    for (const s of series) {
      const p = parseSeriesCode(s.code)
      if (!p || !classes.includes(p.cls) || seen.has(s.commodity)) continue
      seen.set(s.commodity, {
        commodity: s.commodity,
        sort: [CLASS_ORDER.indexOf(p.cls), KIND_ORDER.indexOf(p.kind), p.band?.lo ?? 0],
      })
    }
    return [...seen.values()]
      .sort((a, b) => a.sort[0] - b.sort[0] || a.sort[1] - b.sort[1] || a.sort[2] - b.sort[2])
      .map((c) => c.commodity)
  }, [series, group])

  const commodity =
    picked && commodities.includes(picked)
      ? picked
      : commodities.includes(defaultCommodity)
        ? defaultCommodity
        : (commodities[0] ?? null)

  const shown = useMemo(
    () =>
      series
        .filter((s) => s.commodity === commodity && parseSeriesCode(s.code))
        .sort(
          (a, b) =>
            MARKET_KEYS.indexOf(parseSeriesCode(a.code)!.market) - MARKET_KEYS.indexOf(parseSeriesCode(b.code)!.market),
        )
        // The legend names the market; the class is already in the picker.
        .map((s) => ({ ...s, name: marketByKey(parseSeriesCode(s.code)!.market)?.label ?? s.name })),
    [series, commodity],
  )
  const { data: points } = useMarketPrices(shown.map((s) => s.id))
  const colourOf = (id: string) => {
    const s = shown.find((x) => x.id === id)
    const m = s ? parseSeriesCode(s.code)?.market : undefined
    return (m && marketByKey(m)?.colour) || '#64748b'
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-800">Auction prices</h3>
        <div className="flex rounded-md border border-gray-200 p-0.5 text-xs">
          {[
            { label: '1y', years: 1 },
            { label: '2y', years: 2 },
            { label: 'All', years: null },
          ].map((z) => (
            <button
              key={z.label}
              onClick={() => setZoomYears(z.years)}
              className={cn(
                'rounded px-2 py-0.5',
                zoomYears === z.years ? 'bg-brand-700 font-semibold text-white' : 'text-gray-600',
              )}
            >
              {z.label}
            </button>
          ))}
        </div>
      </div>
      <HelpNote
        className="mt-0.5 text-xs"
        summary="Medicine Hat, Lethbridge, Calgary Stockyards and Team online, in $/lb."
        title="Reading the auction chart"
      >
        <p>
          One class at a time, a line per market, drawn in <strong>$/lb</strong>. The markets quote per hundredweight;
          $780/cwt is $7.80/lb.
        </p>
        <p className="mt-1">
          Medicine Hat prints an average and the head sold. Lethbridge prints a range, so its line is the middle of the
          range. Calgary Stockyards and Team print an average. A gap is a week that market sold none of that class, not a
          zero.
        </p>
        <p className="mt-1">
          Weight classes are written differently at each market (400-499, 400 - 500, 401 to 500 lbs) and are put on the
          same 100 lb classes here. Medicine Hat&rsquo;s light &ldquo;slaughter heifers&rdquo; are priced like feeders, so
          they are filed under yearlings, never as calves.
        </p>
      </HelpNote>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        {GROUPS.map((g) => (
          <button
            key={g.key}
            onClick={() => {
              setGroup(g.key)
              setPicked(null)
            }}
            className={cn(
              'rounded-full border px-2.5 py-1',
              group === g.key ? 'border-transparent bg-gray-800 text-white' : 'border-gray-300 text-gray-600',
            )}
          >
            {g.label}
          </button>
        ))}
        {commodities.length > 0 && (
          <select
            value={commodity ?? ''}
            onChange={(e) => setPicked(e.target.value)}
            className="ml-auto rounded-md border border-gray-300 px-2 py-1 text-xs"
            aria-label="Class"
          >
            {commodities.map((c) => (
              <option key={c} value={c}>
                {c}
                {c === defaultCommodity ? ' (ours)' : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">No prices from the four markets for this yet.</p>
      ) : (
        <PriceChart
          series={shown}
          points={sinceYears(points ?? [], zoomYears)}
          unit="$/lb"
          scale={0.01}
          colourOf={colourOf}
        />
      )}

      {(notes ?? []).length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-gray-500 hover:text-gray-800">The markets&rsquo; own notes this week</summary>
          <ul className="mt-1 space-y-2">
            {(notes ?? []).map((n) => (
              <li key={n.market} className="whitespace-pre-line text-gray-600">
                <span className="font-medium text-gray-800">
                  {AUCTION_MARKETS.find((m) => m.key === n.market)?.label ?? n.market}, {shortDate(n.sale_date)}:
                </span>{' '}
                {n.comment}
              </li>
            ))}
          </ul>
        </details>
      )}
      <UpdateNow />
    </section>
  )
}

/**
 * Managers can fetch the four markets now rather than wait for the morning
 * run, or pull two years of history. The background job answers at once and
 * keeps working; the new prices show as they land.
 */
export function UpdateNow() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const run = useMutation({
    mutationFn: async (backfill: boolean) => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/api/cattle-auctions-background', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}`, 'content-type': 'application/json' },
        body: JSON.stringify(backfill ? { backfill: true } : {}),
      })
      if (!res.ok && res.status !== 202) throw new Error(`Could not start it (${res.status})`)
      return backfill
    },
    onSuccess: () => {
      // The run takes a few minutes; look again shortly.
      setTimeout(() => {
        void qc.invalidateQueries({ queryKey: ['market-prices'] })
        void qc.invalidateQueries({ queryKey: ['market-series'] })
        void qc.invalidateQueries({ queryKey: ['auction-notes'] })
      }, 90_000)
    },
  })
  if (!hasManagerAccess(profile?.role)) return null
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      <button
        type="button"
        onClick={() => run.mutate(false)}
        disabled={run.isPending}
        className="rounded-md border border-gray-300 px-2 py-1 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        Update prices now
      </button>
      <button
        type="button"
        onClick={() => run.mutate(true)}
        disabled={run.isPending}
        className="rounded-md border border-gray-300 px-2 py-1 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        title="Reads two years of Medicine Hat reports and Lethbridge weeks. Takes a while; prices fill in as they are read."
      >
        Load two years of history
      </button>
      {run.isSuccess && <span className="text-green-700">Started — prices fill in over the next few minutes.</span>}
      {run.isError && <span className="text-red-600">{(run.error as Error).message}</span>}
    </div>
  )
}
