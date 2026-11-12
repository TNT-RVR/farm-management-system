import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { HelpNote } from '@/components/HelpNote'
import { Select } from '@/components/Select'
import {
  AGRIPROFIT_SOURCE,
  BENCHMARK_YEAR,
  benchmarkLine,
  capitalLines,
  costLines,
  inBenchmarkUnit,
  unmatchedCrops,
  type BenchmarkZone,
} from '@/lib/agriprofit'
import { money } from '@/lib/planner'
import { CARD_HEAD, TABLE_HEAD, TABLE_TH } from '@/lib/table-style'
import { cn } from '@/lib/utils'
import type { BudgetLine } from '@/lib/planner'

/**
 * Financials → Benchmark: our budget beside Alberta's published one.
 *
 * The budget tab says what each crop costs us and makes. This says what it cost
 * the Alberta producers who reported their cost of production in the same soil
 * zone. It is the one number in the research library the money pages can use
 * without modelling anything.
 *
 * Nothing here is a verdict. Our cost per acre and theirs are built differently
 * — see the help note — so the screen lines the figures up and says what each
 * one includes rather than printing a percentage over or under.
 */

const n0 = (v: number) => v.toLocaleString('en-CA', { maximumFractionDigits: 0 })
const n1 = (v: number) => v.toLocaleString('en-CA', { maximumFractionDigits: 1 })

export function BenchmarkTab({ budget }: { budget: BudgetLine[] }) {
  const [zone, setZone] = useState<BenchmarkZone>('irrigated')
  const [open, setOpen] = useState<string | null>(null)

  const lines = useMemo(
    () =>
      budget
        .map((b) =>
          benchmarkLine(
            {
              cropName: b.crop.name,
              acres: b.acres,
              yieldPerAcre: b.weightedYield,
              yieldUnit: b.crop.yield_unit,
              costPerAcre: b.costPerAcre,
              marginPerAcre: b.marginPerAcre,
            },
            zone,
          ),
        )
        .sort((a, b) => b.acres - a.acres),
    [budget, zone],
  )
  const matched = lines.filter((l) => l.benchmark)
  const missing = useMemo(
    () => unmatchedCrops(budget.map((b) => b.crop.name), zone),
    [budget, zone],
  )
  const source = AGRIPROFIT_SOURCE[zone]

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select
          value={zone}
          onChange={(v) => setZone(v as BenchmarkZone)}
          options={[
            { value: 'irrigated', label: 'Irrigated soil zone' },
            { value: 'black', label: 'Black soil zone, dryland' },
          ]}
          className="w-56"
        />
        <span className="text-xs text-gray-500">
          AgriProfit$ {BENCHMARK_YEAR} · {source.zone}
        </span>
      </div>

      {zone === 'black' && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="h-3.5 w-3.5" /> A different soil zone from ours
          </p>
          <p className="mt-0.5">
            This farm is in the Brown soil zone and irrigated. The black soil zone set is dryland
            and further north, and is here because it is the only dryland benchmark published for{' '}
            {BENCHMARK_YEAR} — read it as context, not as our dryland.
          </p>
        </div>
      )}

      {missing.length > 0 && (
        <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
          No {BENCHMARK_YEAR} benchmark is published for {missing.join(', ')}, so{' '}
          {missing.length === 1 ? 'it is' : 'they are'} left out rather than compared with the
          nearest crop.
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <p className={cn('font-medium', CARD_HEAD)}>Per acre, ours against the benchmark</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] table-fixed text-sm">
            <thead className={TABLE_HEAD}>
              <tr>
                <th className="px-3 py-2 font-medium">Crop</th>
                <th className="px-3 py-2 text-right font-medium" style={{ width: '10%' }}>Acres</th>
                <th className="px-3 py-2 text-right font-medium" style={{ width: '14%' }}>Yield /ac</th>
                <th className="px-3 py-2 text-right font-medium" style={{ width: '13%' }}>Our cost /ac</th>
                <th className="px-3 py-2 text-right font-medium" style={{ width: '13%' }}>
                  Their total /ac
                </th>
                <th className="px-3 py-2 text-right font-medium" style={{ width: '13%' }}>
                  Our margin /ac
                </th>
                <th className="px-3 py-2 text-right font-medium" style={{ width: '14%' }}>
                  Their return to equity
                </th>
              </tr>
            </thead>
            <tbody>
              {matched.map((l) => {
                const b = l.benchmark!
                return (
                  <Fragment key={l.crop}>
                    <tr
                      onClick={() => setOpen(open === l.crop ? null : l.crop)}
                      className="cursor-pointer border-b border-gray-100 hover:bg-gray-50"
                    >
                      <td className="px-3 py-2 font-medium text-gray-900">
                        {l.crop}
                        <span className="ml-1.5 text-[11px] font-normal text-gray-400">
                          vs {b.crop}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-700">{n0(l.acres)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                        {/* Converted into their unit where the conversion is
                            exact, because two numbers in different units are
                            not a comparison. 8,818 lb of hay beside 4.5 tonnes
                            reads as a disaster until it says 4.0. */}
                        {(() => {
                          const converted = inBenchmarkUnit(l.ourYield, l.ourUnit, b.unit)
                          if (converted != null) {
                            return (
                              <span title={`${n1(l.ourYield ?? 0)} ${l.ourUnit} as recorded`}>
                                {n1(converted)}
                              </span>
                            )
                          }
                          return l.ourYield == null ? '—' : `${n1(l.ourYield)} ${l.ourUnit ?? ''}`.trim()
                        })()}
                        <span className="text-gray-400">
                          {' / '}
                          {b.yieldPerAcre == null ? '—' : `${n1(b.yieldPerAcre)} ${b.unit ?? ''}`.trim()}
                        </span>
                        {!l.sameUnit && inBenchmarkUnit(l.ourYield, l.ourUnit, b.unit) == null && (
                          <span
                            className="ml-1 text-amber-700"
                            title={`Ours is in ${l.ourUnit ?? 'no unit'}, the benchmark is in ${b.unit}. There is no exact conversion between them — a bushel is not a mass without a test weight — so these two yields are not comparable as they stand.`}
                          >
                            ≠
                          </span>
                        )}
                      </td>
                      {/* A cost of exactly nothing means none was entered, not
                          that the crop was free; $0 beside their $548 would be
                          read as a saving. */}
                      <td className="px-3 py-2 text-right tabular-nums text-gray-900">
                        {!l.ourCostPerAcre ? (
                          <span className="text-gray-400" title="No cost entered for this crop in the budget">
                            not set
                          </span>
                        ) : (
                          money(l.ourCostPerAcre)
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                        {b.totalCosts == null ? '—' : money(b.totalCosts)}
                      </td>
                      <td
                        className={cn(
                          'px-3 py-2 text-right font-medium tabular-nums',
                          (l.ourMarginPerAcre ?? 0) < 0 ? 'text-red-700' : 'text-gray-900',
                        )}
                      >
                        {l.ourMarginPerAcre == null || !l.ourCostPerAcre ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          money(l.ourMarginPerAcre)
                        )}
                      </td>
                      <td
                        className={cn(
                          'px-3 py-2 text-right tabular-nums',
                          (b.returnToEquity ?? 0) < 0 ? 'text-red-700' : 'text-gray-700',
                        )}
                      >
                        {b.returnToEquity == null ? '—' : money(b.returnToEquity)}
                      </td>
                    </tr>
                    {open === l.crop && (
                      <tr className="border-b border-gray-100 bg-gray-50/60">
                        <td colSpan={7} className="px-3 py-2">
                          <div className="grid gap-3 md:grid-cols-2">
                            <BenchBreakdown
                              title={`What ${b.crop} cost per acre — variable`}
                              lines={costLines(b)}
                              total={b.variableCosts}
                              totalLabel="Variable costs"
                            />
                            <BenchBreakdown
                              title="Capital"
                              lines={capitalLines(b)}
                              total={b.capitalCosts}
                              totalLabel="Capital costs"
                              extra={[
                                ['Cash costs', b.cashCosts],
                                ['Total production costs', b.totalCosts],
                                ['Gross return', b.grossReturn],
                                ['Gross margin', b.grossMargin],
                                ['Return to equity', b.returnToEquity],
                              ]}
                            />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {matched.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-sm text-gray-400">
                    None of this year&rsquo;s crops has a {BENCHMARK_YEAR} benchmark in this zone.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <HelpNote
        className="mt-2"
        summary="Two differently built numbers, lined up rather than scored."
        title="What this comparison can and cannot tell you"
      >
        The benchmark is Alberta Agriculture&rsquo;s AgriProfit$ {BENCHMARK_YEAR} cost and return
        benchmark for the {source.zone}, built from cost-of-production data that Alberta producers
        sent in. The publication itself says benchmarks should not replace a farm&rsquo;s own
        records, and that relying on regional figures alone risks over or underestimating both costs
        and returns.
        <br />
        <br />
        Our cost per acre comes from the crop plan, input prices and the farm&rsquo;s fixed costs.
        Theirs includes unpaid labour, equipment and building depreciation, rent, and taxes and
        water rates, whether or not ours does. That is why the screen shows their <b>cash costs</b>{' '}
        and their <b>total production costs</b> separately in the breakdown, and prints no
        percentage over or under: which of their totals ours belongs against depends on how the
        budget was built.
        <br />
        <br />
        The publication books hay and silage in tonnes, so our yield is converted into its unit
        wherever that conversion is exact — pounds, tons and tonnes all convert, and the figure as
        recorded is on the tooltip. A ≠ means there is no exact conversion: a bushel is not a mass
        until you assume a test weight, and that weight differs by crop, so those two yields are
        left uncompared rather than reconciled on a guess. Crops with no published benchmark are
        listed above rather than matched to the nearest one.
        <br />
        <br />
        <Link
          to={`/research?tab=search&q=${encodeURIComponent(source.paper)}`}
          className="font-medium underline"
        >
          Open the publication in the research library
        </Link>
      </HelpNote>
    </div>
  )
}

function BenchBreakdown({
  title,
  lines,
  total,
  totalLabel,
  extra,
}: {
  title: string
  lines: [string, number][]
  total: number | null
  totalLabel: string
  extra?: [string, number | null][]
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <p className={cn('text-[11px] font-medium', CARD_HEAD)}>{title}</p>
      <table className="w-full text-[11px]">
        <tbody>
          {lines.map(([label, v]) => (
            <tr key={label} className="border-t border-gray-100">
              <td className={cn(TABLE_TH, 'font-normal text-gray-600')}>{label}</td>
              <td className="px-3 py-1 text-right tabular-nums text-gray-900">{money(v)}</td>
            </tr>
          ))}
          <tr className="border-t border-gray-300 bg-gray-50">
            <td className={cn(TABLE_TH, 'font-semibold text-gray-900')}>{totalLabel}</td>
            <td className="px-3 py-1 text-right font-semibold tabular-nums text-gray-900">
              {total == null ? '—' : money(total)}
            </td>
          </tr>
          {extra?.map(([label, v]) => (
            <tr key={label} className="border-t border-gray-100">
              <td className={cn(TABLE_TH, 'font-normal text-gray-600')}>{label}</td>
              <td
                className={cn(
                  'px-3 py-1 text-right tabular-nums',
                  (v ?? 0) < 0 ? 'text-red-700' : 'text-gray-900',
                )}
              >
                {v == null ? '—' : money(v)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
