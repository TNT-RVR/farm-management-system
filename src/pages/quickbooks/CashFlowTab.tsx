import { Fragment, useMemo, useState } from 'react'
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { RefreshCw } from 'lucide-react'
import { Fold } from '@/components/Fold'
import { HelpNote } from '@/components/HelpNote'
import { Select } from '@/components/Select'
import { useAccountCategories, useRefreshQbReport } from '@/lib/qb-books'
import {
  cashForecast,
  cashKindLabel,
  kindLines,
  monthLabel,
  peakMonths,
  useBooksByMonth,
  useCashFacts,
  usePlanFigures,
  type ForecastMonth,
} from '@/lib/cash-flow'
import { cn } from '@/lib/utils'

const money0 = (v: number) => v.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 })
const short = (v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${Math.round(v / 1e3)}k` : String(Math.round(v)))
const when = (iso: string) => new Date(iso).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/**
 * QuickBooks → Cash flow (Sam, 7 Oct 2026: "Cash flow forecast from real
 * payment timing"). The next twelve months, month by month: the plan's
 * figures (or last year's) spread over the months the books say each kind is
 * paid, plus the bills, invoices and loan payments already known, from the
 * bank balances today. Owners and the accountant only; the page checks
 * before this is drawn and the database refuses anyone else.
 */
export function CashFlowTab({ realm }: { realm: string }) {
  const today = useMemo(() => new Date().toLocaleDateString('en-CA'), [])
  const [basis, setBasis] = useState<'plan' | 'books'>('plan')
  const [more, setMore] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const { data: overrides } = useAccountCategories(realm)
  const books = useBooksByMonth(true, today, overrides)
  const facts = useCashFacts(realm, today, overrides)
  const plan = usePlanFigures(today)
  const refresh = useRefreshQbReport()

  const lines = useMemo(() => kindLines(books.years, plan, basis === 'plan'), [books.years, plan, basis])
  const forecast = useMemo(
    () =>
      facts.data && books.years.length
        ? cashForecast({ today, opening: facts.data.opening, kinds: lines.map((l) => ({ key: l.key, side: l.side, annual: l.annual, shares: l.timing.shares })), known: facts.data.known })
        : null,
    [facts.data, books.years.length, lines, today],
  )

  const reportErrors = books.errors.filter(Boolean)
  const assumed = lines.filter((l) => l.timing.from === 'assumed')
  const refreshAll = async () => {
    for (const y of books.asked) await refresh.mutateAsync({ report: 'ProfitAndLoss', params: y.params })
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={basis}
          ariaLabel="Amounts from"
          size="sm"
          className="w-52"
          onChange={(v) => setBasis(v as 'plan' | 'books')}
          options={[
            { value: 'plan', label: 'Plan where it has a figure' },
            { value: 'books', label: 'Last year’s books' },
          ]}
        />
        <button
          type="button"
          onClick={() => void refreshAll()}
          disabled={refresh.isPending}
          className="ml-auto flex items-center gap-1 text-xs text-brand-800 hover:underline disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', refresh.isPending && 'animate-spin')} />
          {books.fetchedAt ? `From QuickBooks ${when(books.fetchedAt)}` : 'Ask QuickBooks'}
        </button>
      </div>
      <HelpNote summary="Each kind's year spread over the months the books say it's paid, plus bills, invoices and loans already known.">
        <p>
          <b>When.</b> QuickBooks&apos; Profit and Loss on the cash basis, by month, for the last three fiscal years (Sep–Aug): cash basis
          counts a bill when it was paid and an invoice when the money came in, payroll included. Each kind&apos;s share of the year by month
          is the average of those years. A kind with under two years of history uses the lender review&apos;s stated timing and is marked
          &ldquo;assumed&rdquo;.
        </p>
        <p className="mt-1.5">
          <b>How much.</b> Seed, fertilizer, chemical, fuel, custom work and insurance are this fiscal year&apos;s crop budgets × planned acres;
          crop sales are the crop just harvested at the plan&apos;s yield and price. Everything else, or any kind the plan has no figure for, is
          last fiscal year&apos;s cash from the books. Depreciation and inventory changes move no money and are left out.
        </p>
        <p className="mt-1.5">
          <b>Already known.</b> Open bills and invoices go on their due dates (overdue ones this month) and come off their kind&apos;s year so they
          aren&apos;t counted twice; invoices due over a year ago are left out. Loan principal repeats each payment of the last twelve months a
          year on, held to what is still owing. Card balances are paid this month. Opening cash is the bank accounts&apos; balances at the last
          sync. This month counts only the days left in it.
        </p>
        <p className="mt-1.5">
          <b>Not in it.</b> GST, buying or selling equipment and land, owner draws and the operating line&apos;s draws and repayments: none of
          them are on the Profit and Loss.
        </p>
      </HelpNote>

      {reportErrors.length > 0 && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{reportErrors[0]}</p>}
      {facts.error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{(facts.error as Error).message}</p>}
      {(books.loading || facts.isLoading) && <p className="text-sm text-gray-500">Asking QuickBooks…</p>}
      {!books.loading && !books.years.length && !reportErrors.length && <p className="text-sm text-gray-500">No Profit and Loss came back for the last three years.</p>}
      {basis === 'plan' && !plan && books.years.length > 0 && <p className="text-xs text-gray-500">Reading the plan…</p>}

      {forecast && facts.data && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Cash today" value={money0(facts.data.opening)} />
            <Stat label={`Low point · ${monthLabel(forecast.low.month)}`} value={money0(forecast.low.balance)} bad={forecast.low.balance < 0} />
            <Stat label="In / out, 12 months" value={`${short(forecast.totalIn)} / ${short(forecast.totalOut)}`} />
            <Stat label={`End of ${monthLabel(forecast.months[forecast.months.length - 1].month)}`} value={money0(forecast.months[forecast.months.length - 1].balance)} bad={forecast.months[forecast.months.length - 1].balance < 0} />
          </div>
          {assumed.length > 0 && (
            <p className="text-xs text-amber-800">Timing assumed (under two years in the books): {assumed.map((l) => l.label.toLowerCase()).join(', ')}.</p>
          )}

          <BalanceChart months={forecast.months} />

          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-1.5 text-left font-medium">Month</th>
                  <th className="px-2 py-1.5 text-right font-medium">In</th>
                  <th className="px-2 py-1.5 text-right font-medium">Out</th>
                  <th className="px-2 py-1.5 text-right font-medium">Net</th>
                  <th className="px-3 py-1.5 text-right font-medium">Balance</th>
                  {more && (
                    <>
                      <th className="px-2 py-1.5 text-right font-medium">Bills</th>
                      <th className="px-2 py-1.5 text-right font-medium">Invoices</th>
                      <th className="px-2 py-1.5 text-right font-medium">Loans & cards</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {forecast.months.map((m) => (
                  <Fragment key={m.month}>
                    <tr onClick={() => setOpen(open === m.month ? null : m.month)} className={cn('cursor-pointer hover:bg-gray-50', m.month === forecast.low.month && 'bg-amber-50')}>
                      <td className="px-3 py-1.5 text-gray-800">{monthLabel(m.month)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-gray-900">{short(m.in)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-gray-900">{short(m.out)}</td>
                      <td className={cn('px-2 py-1.5 text-right tabular-nums', m.net < 0 ? 'text-red-700' : 'text-emerald-700')}>{short(m.net)}</td>
                      <td className={cn('px-3 py-1.5 text-right font-medium tabular-nums', m.balance < 0 ? 'text-red-700' : 'text-gray-900')}>{money0(m.balance)}</td>
                      {more && (
                        <>
                          <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">{m.known.payable ? short(m.known.payable) : ''}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">{m.known.receivable ? short(m.known.receivable) : ''}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">{m.known.loan + m.known.card ? short(m.known.loan + m.known.card) : ''}</td>
                        </>
                      )}
                    </tr>
                    {open === m.month && (
                      <tr>
                        <td colSpan={more ? 8 : 5} className="bg-gray-50 px-3 py-2">
                          <MonthDetail m={m} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
            <button type="button" onClick={() => setMore((x) => !x)} className="w-full border-t border-gray-100 px-3 py-1.5 text-left text-xs text-brand-800 hover:bg-gray-50">
              {more ? 'Show less' : 'Show more: bills, invoices, loans'}
            </button>
          </div>

          <Fold title="By kind" summary={`${lines.length} kinds`} storageKey="cash-flow-kinds">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-gray-500">
                  <tr>
                    <th className="py-1 pr-2 text-left font-medium">Kind</th>
                    <th className="py-1 pr-2 text-right font-medium">Year</th>
                    <th className="py-1 pr-2 text-right font-medium">Last year</th>
                    <th className="py-1 pr-2 text-left font-medium">Amount from</th>
                    <th className="py-1 text-left font-medium">Paid in</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {lines.map((l) => (
                    <tr key={l.key} className="align-top">
                      <td className="py-1 pr-2 text-gray-800">
                        {l.label}
                        <span className="text-gray-400"> · {l.side}</span>
                      </td>
                      <td className="py-1 pr-2 text-right tabular-nums text-gray-900">{money0(l.annual)}</td>
                      <td className="py-1 pr-2 text-right tabular-nums text-gray-500">{money0(l.lastYear)}</td>
                      <td className="py-1 pr-2 text-gray-600">
                        {l.from}
                        {forecast.takenOff[l.key] ? <span className="text-gray-400"> · less {money0(forecast.takenOff[l.key])} open</span> : null}
                      </td>
                      <td className="py-1 text-gray-600">
                        {peakMonths(l.timing.shares) || 'spread through the year'}
                        <span className={cn(l.timing.from === 'assumed' ? 'text-amber-700' : 'text-gray-400')}>
                          {' '}
                          · {l.timing.from === 'books' ? `books, ${l.timing.years} yr` : 'assumed'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Fold>

          <Fold title="Already known" summary={`${facts.data.open.length} open bills and invoices, ${facts.data.loans.length} loans`} storageKey="cash-flow-known">
            <KnownList facts={facts.data} />
          </Fold>
        </>
      )}
    </section>
  )
}

function Stat({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <div className="truncate text-[11px] text-gray-500">{label}</div>
      <div className={cn('text-base font-semibold tabular-nums', bad ? 'text-red-700' : 'text-gray-900')}>{value}</div>
    </div>
  )
}

function MonthDetail({ m }: { m: ForecastMonth }) {
  const kinds = Object.entries(m.kinds).sort((a, b) => b[1] - a[1])
  const known = [
    { label: 'Open bills', v: m.known.payable },
    { label: 'Open invoices', v: m.known.receivable },
    { label: 'Loan payments', v: m.known.loan },
    { label: 'Cards owing', v: m.known.card },
  ].filter((k) => k.v)
  return (
    <ul className="grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
      {kinds.map(([k, v]) => (
        <li key={k} className="flex justify-between gap-2">
          <span className="text-gray-700">{cashKindLabel(k)}</span>
          <span className="tabular-nums text-gray-900">{money0(v)}</span>
        </li>
      ))}
      {known.map((k) => (
        <li key={k.label} className="flex justify-between gap-2">
          <span className="text-gray-700">{k.label}</span>
          <span className={cn('tabular-nums', k.v < 0 ? 'text-red-700' : 'text-emerald-700')}>{money0(k.v)}</span>
        </li>
      ))}
    </ul>
  )
}

function KnownList({ facts }: { facts: NonNullable<ReturnType<typeof useCashFacts>['data']> }) {
  const bills = facts.open.filter((d) => d.entity === 'Bill')
  const invoices = facts.open.filter((d) => d.entity === 'Invoice')
  const sum = (xs: { balance?: number; amount?: number }[]) => xs.reduce((s, x) => s + (x.balance ?? x.amount ?? 0), 0)
  const row = (label: string, value: string, note?: string) => (
    <li key={label} className="flex items-baseline justify-between gap-2">
      <span className="min-w-0 text-gray-700">
        {label}
        {note && <span className="text-gray-400"> · {note}</span>}
      </span>
      <span className="shrink-0 tabular-nums text-gray-900">{value}</span>
    </li>
  )
  return (
    <div className="space-y-3 text-xs">
      <ul className="space-y-0.5">
        {row('Bank accounts', money0(facts.opening), `${facts.banks.length} accounts, at the last sync`)}
        {row('Open bills', money0(sum(bills)), `${bills.length}`)}
        {row('Open invoices', money0(sum(invoices)), `${invoices.length}`)}
        {facts.stale.count > 0 && row('Left out: due over a year ago', money0(facts.stale.amount), `${facts.stale.count}`)}
        {facts.cards.length > 0 && row('Cards owing', money0(sum(facts.cards)), `${facts.cards.length} cards, paid this month`)}
      </ul>
      {facts.loans.length > 0 && (
        <div>
          <p className="mb-0.5 font-medium text-gray-800">Loan principal, next 12 months</p>
          <ul className="space-y-0.5">{facts.loans.map((l) => row(l.name, money0(l.projected), `${l.payments} payments last year, ${money0(l.owing)} owing`))}</ul>
        </div>
      )}
      {facts.notPlaced.length > 0 && (
        <div>
          <p className="mb-0.5 font-medium text-gray-800">Owing, no payments to repeat</p>
          <ul className="space-y-0.5">{facts.notPlaced.map((l) => row(l.name, money0(l.amount)))}</ul>
          <p className="mt-0.5 text-gray-500">Not in the forecast: when these are paid isn&apos;t in the books.</p>
        </div>
      )}
    </div>
  )
}

function BalanceChart({ months }: { months: ForecastMonth[] }) {
  const data = months.map((m) => ({ name: monthLabel(m.month).slice(0, 3), net: Math.round(m.net), balance: Math.round(m.balance) }))
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-2">
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} />
          <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} width={48} tickFormatter={(v: number) => short(v)} />
          <ReferenceLine y={0} stroke="#64748b" />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #e2e8f0' }}
            formatter={(v, n) => [money0(Number(v)), n === 'balance' ? 'Balance' : 'Net']}
          />
          <Bar dataKey="net" isAnimationActive={false} radius={[2, 2, 0, 0]}>
            {data.map((d) => (
              <Cell key={d.name} fill={d.net >= 0 ? '#0f766e' : '#c2410c'} fillOpacity={0.55} />
            ))}
          </Bar>
          <Line dataKey="balance" type="monotone" stroke="#0284c7" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
