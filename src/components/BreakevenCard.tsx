import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { BID_CODES, breakeven } from '@/lib/breakeven'
import { money } from '@/lib/profit-loss-lines'
import type { FarmInputs, FieldBooks } from '@/lib/profit-loss-farm'
import { cn } from '@/lib/utils'

/** Latest elevator bid per series code, in $/tonne. */
export function useElevatorBids() {
  return useQuery({
    queryKey: ['elevator-bids', BID_CODES],
    queryFn: async () => {
      const { data: series, error } = await supabase.from('market_series').select('id, code').in('code', BID_CODES)
      if (error) throw error
      const out = new Map<string, number>()
      await Promise.all(
        (series ?? []).map(async (s) => {
          const { data } = await supabase
            .from('market_prices')
            .select('value, observed_on')
            .eq('series_id', s.id)
            .not('value', 'is', null)
            .order('observed_on', { ascending: false })
            .limit(1)
          if (data?.[0]) out.set(s.code, Number(data[0].value))
        }),
      )
      return [...out.entries()]
    },
    staleTime: 3_600_000,
  })
}

const unitPrice = (v: number, unit: string | null) => (unit === 'lbs' ? `$${v.toFixed(3)}/lb` : `$${v.toFixed(2)}/${unit ?? 'unit'}`)

/**
 * Which fields make money at today's prices: each field's cost per acre, the
 * price it needs at its own yield, and the yield it needs at today's bid.
 */
export function BreakevenCard({ books, seasons }: { books: FieldBooks[]; seasons: FarmInputs['seasons'] }) {
  const { data: bidList } = useElevatorBids()
  const [open, setOpen] = useState(true)
  const rows = useMemo(() => {
    const bids = new Map(bidList ?? [])
    return books
      .filter((b) => b.cost > 0 && b.cropName)
      .map((b) => {
        const s = seasons.get(b.fieldId)
        return { b, be: breakeven({ costPerAcre: b.costPerAcre, acres: s?.acres ?? b.acres, yieldTotal: s?.yieldTotal ?? null, unit: s?.yieldUnit ?? null, cropName: b.cropName, planPrice: s?.price ?? null, bids }) }
      })
      .sort((x, y) => (x.be.netAtPrice ?? Infinity) - (y.be.netAtPrice ?? Infinity))
  }, [books, seasons, bidList])

  if (!rows.length) return null
  const losing = rows.filter((r) => r.be.netAtPrice != null && r.be.netAtPrice < 0).length

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-3">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-1 text-left">
        {open ? <ChevronDown className="h-4 w-4 text-gray-500" /> : <ChevronRight className="h-4 w-4 text-gray-500" />}
        <h2 className="text-sm font-semibold text-gray-800">Breakeven</h2>
        {losing > 0 && <span className="ml-auto rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-800">{losing} under water</span>}
      </button>
      {open && (
        <>
          <ul className="mt-2 divide-y divide-gray-100 text-xs">
            {rows.map(({ b, be }) => (
              <li key={b.fieldId} className="py-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-gray-800">
                    {b.name} <span className="text-[10px] text-gray-400">{b.cropName}</span>
                  </span>
                  <span className={cn('shrink-0 tabular-nums', be.netAtPrice == null ? 'text-gray-400' : be.netAtPrice < 0 ? 'text-red-700' : 'text-green-800')}>
                    {be.netAtPrice != null ? `${money(be.netAtPrice)}/ac` : `${money(be.costPerAcre)}/ac cost`}
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] leading-snug text-gray-500">
                  {be.breakevenPrice != null && be.unit ? `needs ${unitPrice(be.breakevenPrice, be.unit)} at ${be.yieldPerAcre!.toFixed(be.unit === 'lbs' ? 0 : 1)} ${be.unit}/ac` : 'no yield yet'}
                  {be.breakevenYield != null && be.price != null && (
                    <>
                      {' · '}needs {be.breakevenYield.toFixed(be.unit === 'lbs' ? 0 : 1)} {be.unit}/ac at {unitPrice(be.price, be.unit)}
                      {be.priceSource === 'bid' ? ` (today’s bid${be.bidLabel ? ` — ${be.bidLabel}` : ''})` : ' (plan price)'}
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-snug text-gray-400">
            Cost is every priced input on the field this year. Today&apos;s bid is the Alberta elevator bid (canola, durum, feed barley, oats, and
            CPS for wheat — the review carries no CWRS elevator bid) turned into $/bu by bushel weight; other crops use the
            target or contract price. Worst first.
          </p>
        </>
      )}
    </section>
  )
}
