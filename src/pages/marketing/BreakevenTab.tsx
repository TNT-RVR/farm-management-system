import { useMemo } from 'react'
import { useCropInputs, useCropPosition, useLatestCropPrices } from '@/lib/marketing-data'
import { breakeven, isMarketable, marginPerUnit, totalCostPerAcre } from '@/lib/marketing'
import { fmtMoney } from '@/lib/applied'
import { fmtUnitPrice } from '@/lib/board-price'
import { HelpNote } from '@/components/HelpNote'
import { CardList, RowCard } from '@/components/RowCards'
import { cn } from '@/lib/utils'
import { TABLE_HEAD } from '@/lib/table-style'

/**
 * What a bushel cost to grow.
 *
 * Built from the crop budget's cost-per-acre lines divided by the yield the
 * plan expects. Both halves are estimates and the screen says so — a breakeven
 * quoted to the cent off a budgeted yield is precision the number does not
 * have. It is still the single most useful figure on a marketing screen,
 * because a price means nothing without it.
 */
const DASH = <span className="text-gray-300">—</span>

export function BreakevenTab({ year }: { year: number }) {
  const { data: positions, isLoading } = useCropPosition()
  const { data: inputs } = useCropInputs()
  const { data: prices } = useLatestCropPrices()

  const rows = useMemo(() => {
    return (positions ?? [])
      .filter((p) => p.cropYear === year && isMarketable(p))
      .map((p) => {
        const lines = inputs?.get(`${p.cropYear}:${p.cropId}`) ?? []
        const costPerAcre = totalCostPerAcre(lines)
        const yieldPerAcre = p.acres > 0 ? p.expected / p.acres : 0
        const be = lines.length ? breakeven(costPerAcre, yieldPerAcre) : null
        const board = prices?.byCrop.get(p.cropId)
        // The yield range, per acre: a low yield is a high breakeven.
        const low = p.acres > 0 && p.expectedLow != null ? p.expectedLow / p.acres : yieldPerAcre
        const high = p.acres > 0 && p.expectedHigh != null ? p.expectedHigh / p.acres : yieldPerAcre
        const ranged = high - low > 0.05
        return {
          p,
          lines,
          costPerAcre,
          yieldPerAcre,
          yieldLow: ranged ? low : null,
          yieldHigh: ranged ? high : null,
          breakevenRange: ranged && lines.length ? { best: breakeven(costPerAcre, high), worst: breakeven(costPerAcre, low) } : null,
          breakevenPerUnit: be,
          board,
          margin: marginPerUnit(board?.value ?? null, be),
        }
      })
      .sort((a, b) => b.p.expected - a.p.expected)
  }, [positions, inputs, prices, year])

  if (isLoading) return <p className="text-sm text-gray-500">Loading…</p>
  if (!rows.length)
    return (
      <p className="rounded-lg border border-gray-200 bg-white px-3 py-10 text-center text-sm text-gray-500">
        Nothing to cost for {year}.
      </p>
    )

  const missingBudget = rows.filter((r) => !r.lines.length).length

  // Each figure built once, for the phone card and the table cell alike.
  const cells = rows.map((r) => ({
    r,
    cost: r.lines.length ? fmtMoney(r.costPerAcre) : null,
    yld:
      r.yieldPerAcre > 0 ? (
        <>
          {`${r.yieldPerAcre.toLocaleString('en-CA', { maximumFractionDigits: 1 })} ${r.p.unit}`}
          {r.yieldLow != null && r.yieldHigh != null && (
            <span className="block text-xs text-gray-400">
              {r.yieldLow.toLocaleString('en-CA', { maximumFractionDigits: 1 })}–
              {r.yieldHigh.toLocaleString('en-CA', { maximumFractionDigits: 1 })}
            </span>
          )}
          {(r.p.cutAcres ?? 0) > 0 && (
            <span className="block text-xs font-medium text-amber-800">
              cut on {Math.round(r.p.cutAcres ?? 0).toLocaleString('en-CA')} ac
            </span>
          )}
          {(r.p.preCleanAcres > 0 || r.p.cleanAcres > 0) && (
            <span className="block text-xs text-gray-400">
              {[
                r.p.cleanAcres > 0 ? `${Math.round(r.p.cleanAcres)} ac clean` : null,
                r.p.preCleanAcres > 0 ? `${Math.round(r.p.preCleanAcres)} ac pre-clean` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          )}
        </>
      ) : null,
    be:
      r.breakevenPerUnit == null ? null : (
        <>
          {`${fmtUnitPrice(r.breakevenPerUnit, r.p.unit)}/${r.p.unit}`}
          {r.breakevenRange?.best != null && r.breakevenRange.worst != null && (
            <span className="block text-xs font-normal text-gray-400">
              {fmtUnitPrice(r.breakevenRange.best, r.p.unit)} to {fmtUnitPrice(r.breakevenRange.worst, r.p.unit)}
            </span>
          )}
        </>
      ),
    board: r.board ? (
      <span title={`${r.board.name}, ${r.board.on} — ${r.board.basis}`}>
        {`${fmtUnitPrice(r.board.value, r.board.unit)}/${r.board.unit}`}
        {r.board.converted && <span className="block text-xs text-gray-400">from {r.board.quoted}</span>}
      </span>
    ) : null,
    margin: r.margin == null ? null : `${r.margin >= 0 ? '+' : ''}${fmtUnitPrice(r.margin, r.p.unit)}`,
    where: r.lines.length ? (
      r.lines
        .filter((l) => l.costPerAcre > 0)
        .map((l) => `${l.category} ${fmtMoney(l.costPerAcre)}`)
        .join(' · ')
    ) : (
      <span className="text-amber-800">No budget lines for this crop</span>
    ),
  }))

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      {/* One crop a card on a phone, its margin on the right (design review, Nov 2026). */}
      <CardList>
        {cells.map(({ r, cost, yld, be, board, margin, where }) => (
          <RowCard
            key={r.p.cropId}
            heading={r.p.cropName}
            actions={
              margin && (
                <span className={cn('text-sm font-semibold tabular-nums', r.margin! >= 0 ? 'text-green-700' : 'text-red-700')}>
                  {margin}
                </span>
              )
            }
            facts={[
              { label: 'Breakeven', node: be },
              { label: 'Board', node: board },
              { label: 'Cost / acre', node: cost },
              { label: 'Yield / acre', node: yld },
              { label: 'Cost from', node: where },
            ]}
          />
        ))}
      </CardList>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-max min-w-full text-sm">
          <thead className={TABLE_HEAD}>
            <tr>
              <th className="px-3 py-2 font-medium">Crop</th>
              <th className="px-3 py-2 text-right font-medium">Cost / acre</th>
              <th className="px-3 py-2 text-right font-medium">Yield / acre</th>
              <th className="px-3 py-2 text-right font-medium">Breakeven</th>
              <th className="px-3 py-2 text-right font-medium">Board</th>
              <th className="px-3 py-2 text-right font-medium">Margin</th>
              <th className="px-3 py-2 font-medium">Where the cost comes from</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {cells.map(({ r, cost, yld, be, board, margin, where }) => (
              <tr key={r.p.cropId} className={cn(!r.lines.length && 'bg-amber-50/40')}>
                <td className="px-3 py-2 font-medium text-gray-800">{r.p.cropName}</td>
                <td className="px-3 py-2 text-right tabular-nums">{cost ?? DASH}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-600">{yld ?? DASH}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{be ?? DASH}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-600">{board ?? DASH}</td>
                <td
                  className={cn(
                    'px-3 py-2 text-right font-medium tabular-nums',
                    r.margin != null && (r.margin >= 0 ? 'text-green-700' : 'text-red-700'),
                  )}
                >
                  {margin ?? <span className="font-normal text-gray-300">—</span>}
                </td>
                <td className="px-3 py-2 text-xs text-gray-500">{where}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>

      <div className="mt-3 space-y-1 text-xs text-gray-500">
        <HelpNote summary="Budgeted cost per acre ÷ the plan’s yield — a working figure." title="Breakeven and board">
          <p>
            Breakeven is budgeted cost per acre divided by the yield the crop plan expects. Both are
            estimates, so treat it as a working figure rather than a settled cost — it moves when
            either the budget or the yield estimate does.
          </p>
          <p>
            Board is the newest market price linked to the crop. Those series are quoted per tonne, so
            they are converted to the crop&apos;s unit — bushels by the crop&apos;s test weight, or the
            standard bushel weight where none is recorded.
          </p>
        </HelpNote>
        {missingBudget > 0 && (
          <p className="text-amber-800">
            {missingBudget} crop{missingBudget === 1 ? ' has' : 's have'} no budget lines under Crop
            financials, so no breakeven can be worked out for {missingBudget === 1 ? 'it' : 'them'}.
          </p>
        )}
      </div>
    </>
  )
}
