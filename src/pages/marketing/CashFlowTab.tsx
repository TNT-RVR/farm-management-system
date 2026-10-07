import { useMemo } from 'react'
import { useContracts, useCropPosition } from '@/lib/marketing-data'
import { cashFlow, type ContractForFlow } from '@/lib/marketing'
import { fmtMoney } from '@/lib/applied'
import { HelpNote } from '@/components/HelpNote'

const monthLabel = (m: string) => {
  const [y, mo] = m.split('-')
  const d = new Date(Number(y), Number(mo) - 1, 1)
  return Number.isNaN(d.getTime()) ? m : d.toLocaleString('en-CA', { month: 'short', year: 'numeric' })
}

/**
 * When contracted grain turns into money.
 *
 * Only contracted bushels appear. Projecting revenue from grain that has not
 * been sold would mean inventing both a price and a delivery date, and a cash
 * flow built on two guesses is worse than no cash flow.
 */
export function CashFlowTab({ year }: { year: number }) {
  const { data: contracts, isLoading } = useContracts()
  const { data: positions } = useCropPosition()

  const cropNames = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of positions ?? []) m.set(p.cropId, p.cropName)
    return m
  }, [positions])

  const { months, undated, total } = useMemo(() => {
    const forYear = (contracts ?? []).filter(
      (c) => c.crop_year === year && c.status !== 'cancelled',
    )
    const mapped: ContractForFlow[] = forYear.map((c) => ({
      id: c.id,
      cropName: c.crop_id ? (cropNames.get(c.crop_id) ?? 'Unnamed crop') : 'No crop set',
      bushels: c.bushels,
      pricePerUnit: c.price_per_unit,
      deliveryStart: c.delivery_start,
      deliveryEnd: c.delivery_end,
      deliveredBu: c.delivered_bu,
    }))
    const flow = cashFlow(mapped)
    return {
      ...flow,
      total: flow.months.reduce((s, m) => s + m.revenue, 0),
    }
  }, [contracts, year, cropNames])

  if (isLoading) return <p className="text-sm text-gray-500">Loading…</p>

  if (!months.length && !undated.length)
    return (
      <p className="rounded-lg border border-gray-200 bg-white px-3 py-10 text-center text-sm text-gray-500">
        No contracts for {year}. Once contracts are entered with delivery windows, this lays their
        revenue out month by month.
      </p>
    )

  const peak = Math.max(...months.map((m) => m.revenue), 1)

  return (
    <>
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Contracted revenue by month</h3>
          <span className="text-sm font-medium tabular-nums text-gray-700">
            {fmtMoney(total)} total
          </span>
        </div>
        <ul className="space-y-1.5">
          {months.map((m) => (
            <li key={m.month} className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-xs text-gray-500">{monthLabel(m.month)}</span>
              <div className="h-5 flex-1 overflow-hidden rounded bg-gray-100">
                <div
                  className="flex h-full items-center rounded bg-brand-600 px-2"
                  style={{ width: `${Math.max((m.revenue / peak) * 100, 4)}%` }}
                >
                  <span className="truncate text-[10px] font-medium text-white">
                    {m.contracts.join(', ')}
                  </span>
                </div>
              </div>
              <span className="w-24 shrink-0 text-right text-xs font-medium tabular-nums text-gray-700">
                {fmtMoney(m.revenue)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {undated.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <h4 className="text-xs font-semibold text-amber-900">
            {undated.length} contract{undated.length === 1 ? '' : 's'} with no delivery window
          </h4>
          <p className="mt-0.5 text-xs text-amber-800">
            Worth {fmtMoney(undated.reduce((s, c) => s + (c.bushels ?? 0) * (c.pricePerUnit ?? 0), 0))}{' '}
            between them, and not on the chart — there is nowhere honest to put them. Add delivery
            dates under Contracts and they will appear.
          </p>
          <ul className="mt-1.5 text-xs text-amber-900">
            {undated.map((c) => (
              <li key={c.id}>
                {c.cropName} · {(c.bushels ?? 0).toLocaleString('en-CA')} ×{' '}
                {fmtMoney(c.pricePerUnit ?? 0)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <HelpNote className="mt-3" summary="Read the shape, not the individual months." title="How windows are spread">
        A delivery window spanning several months is spread evenly across them. Grain actually moves
        when the buyer calls, so read the shape rather than the individual months.
      </HelpNote>
    </>
  )
}
