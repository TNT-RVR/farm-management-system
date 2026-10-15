import { ADDER_WINDOW_MONTHS } from '@/lib/fert-savings/adder'
import type { AdderUsed } from '@/lib/fert-savings/data'
import { cn } from '@/lib/utils'
import { farmRetailer } from '@/lib/farm-context'
import { useSavings } from './context'
import { money } from './ui'

const signed = (v: number) => `${v < 0 ? '−' : '+'}${money(Math.abs(v))}`

/**
 * The adder on one product's DTN price, in a line: how much, and where it came
 * from — "+$48/t Alberta adder, from Alberta's input price survey, Feb–Jul 2026".
 */
export function AdderNote({ straightKey, className }: { straightKey: string; className?: string }) {
  const { inputs } = useSavings()
  return <span className={cn('block text-[10px] text-gray-400', className)}>{adderText(inputs.priced.adderOf(straightKey))}</span>
}

export function adderText(a: AdderUsed): string {
  if (a.typed) return `${signed(a.perTonne)}/t Alberta adder, typed in the settings`
  if (a.auto?.perTonne != null) return `${signed(a.perTonne)}/t Alberta adder, ${a.auto.basis}`
  return `Alberta adder of $0: no ${farmRetailer()} invoice or survey month to work one out from`
}

/**
 * Month by month, how a product's adder was worked out, so the figure can be
 * checked rather than trusted. Flagged months are shown, struck through, with
 * the reason they were left out.
 */
export function AdderMonths({ straightKey }: { straightKey: string }) {
  const { inputs } = useSavings()
  const a = inputs.priced.adderOf(straightKey)
  const months = a.auto?.months ?? []
  if (!months.length) return <p className="text-gray-500">No month with both a local price and a DTN week to work an adder out from.</p>
  const used = new Set((a.auto?.used ?? []).map((m) => m.month))
  return (
    <>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left text-gray-500">
            <th className="py-0.5 font-medium">Month</th>
            <th className="py-0.5 text-right font-medium">Here</th>
            <th className="py-0.5 text-right font-medium">DTN, CA$/t</th>
            <th className="py-0.5 text-right font-medium">Adder</th>
          </tr>
        </thead>
        <tbody>
          {months.slice(-8).map((m) => (
            <tr key={m.month} className={cn(!used.has(m.month) && 'text-gray-400', m.flag && 'line-through')} title={m.flag ?? undefined}>
              <td className="py-0.5">
                {m.month}
                <span className="ml-1 text-[10px] text-gray-400">{m.localSource === 'ICI' ? `${farmRetailer()}, ${m.localTonnes!.toFixed(1)} t` : 'survey'}</span>
              </td>
              <td className="py-0.5 text-right tabular-nums">{money(m.local)}</td>
              <td className="py-0.5 text-right tabular-nums" title={`US$${Math.round(m.dtnUsd)}/ton over ${m.dtnWeeks} week${m.dtnWeeks === 1 ? '' : 's'} at ${m.fx.toFixed(4)}${m.fxBorrowedFrom ? ` (rate from ${m.fxBorrowedFrom})` : ''}`}>
                {money(m.dtnCad)}
                {m.fxBorrowedFrom && <span className="text-amber-600">*</span>}
              </td>
              <td className="py-0.5 text-right font-medium tabular-nums">{signed(m.adder)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[10px] text-gray-400">
        {a.auto?.perTonne != null ? `The adder is the median of the dark rows (the ${ADDER_WINDOW_MONTHS} months up to the latest): ${signed(a.auto.perTonne)}/t.` : ''}
        {months.some((m) => m.fxBorrowedFrom) ? ' * no exchange rate stored for that month; the nearest day’s was used.' : ''}
        {a.typed ? ` Not in use: ${signed(a.perTonne)}/t is typed in the settings.` : ''}
      </p>
    </>
  )
}
