import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { cullCowPrice, cullCowSourceLine, isCullCowSeries, parseSeriesCode, type CowQuote, type CullCowPrice } from './auction-markets'

/**
 * What a cull cow is worth today: the auction markets' D1-D2 / slaughter cow
 * price (Medicine Hat and Lethbridge first), else the price typed in Cattle
 * settings ($215/cwt, Sam, 5 Oct 2026). The cheque is that price × the
 * ranch's cow weight from the Herd tab.
 */

/** Every D1-D2 and slaughter cow quote at the four markets over the last three weeks. */
export function useCowQuotes() {
  return useQuery({
    queryKey: ['cull-cow-quotes'],
    staleTime: 3_600_000,
    queryFn: async (): Promise<CowQuote[]> => {
      const since = new Date(Date.now() - 21 * 86_400_000).toISOString().slice(0, 10)
      const { data: series, error } = await supabase.from('market_series').select('id, code').like('code', 'ab.cows.%')
      if (error) throw error
      const wanted = (series ?? []).flatMap((s) => {
        const p = parseSeriesCode(s.code)
        return isCullCowSeries(p) ? [{ id: s.id as string, p: p! }] : []
      })
      if (!wanted.length) return []
      const { data, error: e2 } = await supabase
        .from('market_prices')
        .select('series_id, value, observed_on')
        .in('series_id', wanted.map((w) => w.id))
        .gte('observed_on', since)
        .not('value', 'is', null)
      if (e2) throw e2
      const byId = new Map(wanted.map((w) => [w.id, w.p]))
      return (data ?? []).flatMap((r) => {
        const p = byId.get(r.series_id as string)
        return p ? [{ market: p.market, kind: p.kind, band: p.band, perCwt: Number(r.value), on: r.observed_on as string }] : []
      })
    },
  })
}

export type CullCowValue = {
  perCwt: number | null
  /** $ a cow at the ranch's cow weight. */
  cheque: number | null
  from: 'market' | 'typed' | null
  /** Where the price came from, in words. */
  line: string
  market: CullCowPrice | null
}

export function cullCowValue(o: { quotes: CowQuote[] | undefined; weightLb: number | null; typedCwt: number | null; today: string }): CullCowValue {
  const w = o.weightLb && o.weightLb > 0 ? o.weightLb : null
  const market = o.quotes?.length ? cullCowPrice(o.quotes, w ?? 1400, o.today) : null
  if (market) {
    return { perCwt: market.perCwt, cheque: w ? (market.perCwt * w) / 100 : null, from: 'market', line: cullCowSourceLine(market), market }
  }
  if (o.typedCwt != null && o.typedCwt > 0) {
    return {
      perCwt: o.typedCwt,
      cheque: w ? (o.typedCwt * w) / 100 : null,
      from: 'typed',
      line: `typed in Cattle settings ($${o.typedCwt.toFixed(2)}/cwt) — no market sold cull cows in the last two weeks`,
      market: null,
    }
  }
  return { perCwt: null, cheque: null, from: null, line: 'no market price in the last two weeks and none typed in Cattle settings', market: null }
}
