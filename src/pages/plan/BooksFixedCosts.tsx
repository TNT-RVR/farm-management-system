import { useMemo, useState } from 'react'
import { BookOpen, RefreshCw } from 'lucide-react'
import { Fold } from '@/components/Fold'
import { HelpNote } from '@/components/HelpNote'
import { Select } from '@/components/Select'
import { FIXED_CATEGORIES, useFixedCostLines, usePlanAcres, useSaveFixedCosts, type FixedCategory, type FixedSetting } from '@/lib/farm-costs'
import { money2 } from '@/lib/planner'
import { useQbCompany } from '@/lib/quickbooks'
import {
  BOOKS_CATEGORIES,
  booksCategoryLabel,
  categoryOf,
  fiscalYear,
  fixedFromBooks,
  parseReport,
  partNote,
  total,
  useAccountCategories,
  useQbReport,
  useRefreshQbReport,
  useSetAccountCategory,
  type BooksCategory,
} from '@/lib/qb-books'
import { cn } from '@/lib/utils'

const money0 = (v: number) => v.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 })
const when = (iso: string) => new Date(iso).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const CATEGORY_OPTIONS = BOOKS_CATEGORIES.filter((c) => c.key !== 'income').map((c) => ({
  value: c.key,
  label: c.label,
  group: { fixed: 'Fixed', direct: 'A crop’s own cost', cattle: 'Cattle', out: 'Left out', income: 'Income' }[c.group],
}))

/**
 * Financials → Farm costs → From the books (Sam, 7 Oct 2026: "Fixed
 * expenses from the real books"). The fiscal year's Profit and Loss straight
 * from QuickBooks, each account in its part, the CFO's rules applied (the
 * management fee off labour and overhead, the crops' share), side by side with
 * the figure saved now, and one button to use it.
 *
 * Owners and the accountant only: the parent renders it for them alone, and
 * the report function and the tables refuse anyone else.
 */
export function BooksFixedCosts({ year, locked, setting }: { year: number; locked: boolean; setting: FixedSetting | null }) {
  const { data: company } = useQbCompany()
  const connected = company?.status === 'connected'
  const fy = fiscalYear(year)
  const params = useMemo(() => ({ start_date: fy.start, end_date: fy.end, accounting_method: 'Accrual' }), [fy.start, fy.end])
  const report = useQbReport('ProfitAndLoss', connected ? params : null)
  const refresh = useRefreshQbReport()
  const { data: overrides } = useAccountCategories(company?.realm_id)
  const setCategory = useSetAccountCategory(company?.realm_id)
  const { data: saved } = useFixedCostLines(setting?.crop_year === year ? year : null, true)
  const { data: planAcres } = usePlanAcres(year)
  const save = useSaveFixedCosts()

  const [sharePct, setSharePct] = useState('82')
  const [takeOffFee, setTakeOffFee] = useState(true)
  const savedHasDep = (saved ?? []).some((l) => l.category === 'depreciation')
  const [withDep, setWithDep] = useState<boolean | null>(null)
  const includeDep = withDep ?? savedHasDep

  const parsed = useMemo(() => (report.data ? parseReport(report.data.data) : null), [report.data])
  const share = Math.min(Math.max(Number(sharePct) || 0, 0), 100) / 100
  const books = useMemo(() => (parsed ? fixedFromBooks(parsed, overrides ?? new Map(), { cropShare: share, takeOffFee }) : null), [parsed, overrides, share, takeOffFee])

  if (!company || !connected) return null
  const unfinished = fy.end > new Date().toISOString().slice(0, 10)
  const parts = FIXED_CATEGORIES.filter((c) => c.key !== 'depreciation' || includeDep)
  const savedAmount = (k: FixedCategory) => {
    const l = (saved ?? []).find((x) => x.category === k)
    return l && l.basis === 'farm_total' ? Number(l.amount) : null
  }
  const totalCrops = books ? parts.reduce((s, c) => s + books.parts[c.key].crops, 0) : 0

  const use = () => {
    if (!books) return
    save.mutate({
      year,
      mode: 'breakdown',
      lump: setting?.crop_year === year ? (setting.lump_per_acre ?? null) : null,
      spreadAcres: (setting?.crop_year === year ? setting.spread_acres : null) ?? (planAcres ? Math.round(planAcres * 100) / 100 : null),
      note: setting?.crop_year === year ? setting.note : null,
      lines: FIXED_CATEGORIES.map((c) => {
        const p = books.parts[c.key]
        const on = c.key !== 'depreciation' || includeDep
        const fee = p.fee ? `, less ${money2(p.fee)} of the management fee` : ''
        return {
          category: c.key,
          basis: 'farm_total' as const,
          amount: on && p.accounts.length ? p.crops : null,
          note: on && p.accounts.length ? `${partNote(p.accounts, fy.label)}${fee}; crops' share ${Math.round(share * 100)}%` : null,
        }
      }),
    })
  }

  return (
    <section className="rounded-lg border border-l-4 border-gray-200 border-l-emerald-600 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <BookOpen className="h-4 w-4 text-emerald-700" /> From the books · {fy.label}
        </h2>
        <button
          type="button"
          onClick={() => refresh.mutate({ report: 'ProfitAndLoss', params })}
          disabled={refresh.isPending}
          className="flex items-center gap-1 text-xs text-emerald-800 hover:underline disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', refresh.isPending && 'animate-spin')} />
          {report.data ? `From QuickBooks ${when(report.data.fetched_at)}` : 'Ask QuickBooks'}
        </button>
      </div>
      <HelpNote summary="QuickBooks' Profit and Loss for the year, put into the parts." className="mt-0.5">
        <p>
          The {fy.label} Profit and Loss, accrual basis, read straight from QuickBooks (the report includes payroll, which the
          synced transactions do not). Each expense account goes to a part by its number — change any under &ldquo;Every
          account&rdquo;. The management fee the farm earns comes off labour and overhead by their size, then the crops carry their
          share of each part and the herd the rest. Fertilizer, chemical, seed and fuel are left out: the app costs them per field
          already.
        </p>
      </HelpNote>
      {unfinished && (
        <p className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900">The {fy.label} year isn&apos;t over: these are the books so far.</p>
      )}
      {(report.error || refresh.error) && <p className="mt-2 text-sm text-red-600">{((report.error ?? refresh.error) as Error).message}</p>}
      {report.isLoading && <p className="mt-2 text-sm text-gray-500">Asking QuickBooks…</p>}

      {books && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-700">
            <label className="flex items-center gap-1.5">
              Crops&apos; share
              <input
                value={sharePct}
                onChange={(e) => setSharePct(e.target.value)}
                inputMode="decimal"
                aria-label="Crops' share, percent"
                className="w-14 rounded-md border border-gray-300 px-1.5 py-0.5 text-right tabular-nums"
              />
              %
            </label>
            {books.feeAccounts.length > 0 && (
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={takeOffFee} onChange={(e) => setTakeOffFee(e.target.checked)} />
                Management fee off ({money0(books.feeAccounts.reduce((s, a) => s + total(a), 0))})
              </label>
            )}
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={includeDep} onChange={(e) => setWithDep(e.target.checked)} />
              Include depreciation
            </label>
          </div>

          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="py-1 font-medium">Part</th>
                  <th className="py-1 text-right font-medium">Books</th>
                  <th className="py-1 text-right font-medium">Fee off</th>
                  <th className="py-1 text-right font-medium">Crops&apos; share</th>
                  <th className="py-1 text-right font-medium">Saved now</th>
                  <th className="py-1 text-right font-medium">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 tabular-nums">
                {parts.map((c) => {
                  const p = books.parts[c.key]
                  const now = savedAmount(c.key)
                  const diff = now == null ? null : p.crops - now
                  return (
                    <tr key={c.key}>
                      <td className="py-1.5 pr-2 text-gray-800">{c.label}</td>
                      <td className="py-1.5 text-right text-gray-700">{money0(p.total)}</td>
                      <td className="py-1.5 text-right text-gray-500">{p.fee ? `−${money0(p.fee)}` : '—'}</td>
                      <td className="py-1.5 text-right font-medium text-gray-900">{money0(p.crops)}</td>
                      <td className="py-1.5 text-right text-gray-500">{now == null ? '—' : money0(now)}</td>
                      <td className={cn('py-1.5 text-right', diff == null || Math.abs(diff) < 1 ? 'text-gray-400' : diff > 0 ? 'text-red-700' : 'text-green-700')}>
                        {diff == null ? '—' : Math.abs(diff) < 1 ? 'same' : `${diff > 0 ? '+' : '−'}${money0(Math.abs(diff))}`}
                      </td>
                    </tr>
                  )
                })}
                <tr>
                  <td className="py-1.5 font-semibold text-gray-900" colSpan={3}>
                    Fixed expenses, crops&apos; share
                  </td>
                  <td className="py-1.5 text-right font-semibold text-gray-900">{money0(totalCrops)}</td>
                  <td colSpan={2} className="py-1.5 text-right text-xs text-gray-500">
                    {setting?.spread_acres ? `≈ ${money2(totalCrops / Number(setting.spread_acres))}/ac over ${Math.round(Number(setting.spread_acres)).toLocaleString('en-CA')} ac` : ''}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {books.guessed.length > 0 && (
            <p className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
              {books.guessed.length} account{books.guessed.length === 1 ? '' : 's'} with no rule went to overhead — check{' '}
              {books.guessed.map((a) => a.name).join(', ')} under Every account.
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={use}
              disabled={locked || save.isPending || !totalCrops}
              className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {save.isPending ? 'Saving…' : `Use these for ${year}`}
            </button>
            {locked && <span className="text-xs text-amber-800">{year} is a past year and read-only.</span>}
            {save.isSuccess && <span className="text-xs text-green-700">Saved — every {year} crop budget now carries it.</span>}
            {save.isError && <span className="text-xs text-red-700">{(save.error as Error).message}</span>}
          </div>

          <Fold title="Left out of the fixed figure" storageKey="books-fixed-left-out" className="mt-3">
            <ul className="divide-y divide-gray-100 text-sm">
              {books.leftOut.map((o) => (
                <li key={o.category} className="flex items-baseline justify-between gap-2 py-1">
                  <span className="text-gray-700">
                    {booksCategoryLabel(o.category)}
                    <span className="ml-1 text-xs text-gray-400">{o.accounts.length} account{o.accounts.length === 1 ? '' : 's'}</span>
                  </span>
                  <span className="tabular-nums text-gray-900">{money0(o.total)}</span>
                </li>
              ))}
            </ul>
          </Fold>

          <Fold title="Every account" summary={`${parsed!.accounts.filter((a) => !/INCOME/.test(a.section)).length} expense accounts`} storageKey="books-fixed-accounts" className="mt-2">
            <ul className="divide-y divide-gray-100 text-sm">
              {parsed!.accounts
                .filter((a) => !/INCOME/.test(a.section))
                .map((a) => {
                  const c = categoryOf(a, overrides ?? new Map())
                  return (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-1">
                      <span className="min-w-0 flex-1 text-gray-800">
                        {a.name}
                        {c.changed && <span className="ml-1 rounded bg-emerald-50 px-1 text-[10px] text-emerald-800">changed</span>}
                        {c.guessed && <span className="ml-1 rounded bg-amber-50 px-1 text-[10px] text-amber-900">check</span>}
                      </span>
                      <span className="w-24 text-right tabular-nums text-gray-700">{money0(total(a))}</span>
                      <Select
                        value={c.category}
                        onChange={(v) => setCategory.mutate({ account: a, category: v as BooksCategory })}
                        options={CATEGORY_OPTIONS}
                        size="sm"
                        className="w-52"
                        ariaLabel={`${a.name}: part`}
                      />
                      {c.changed && (
                        <button type="button" onClick={() => setCategory.mutate({ account: a, category: null })} className="text-[11px] text-gray-500 underline">
                          Undo
                        </button>
                      )}
                    </li>
                  )
                })}
            </ul>
            {setCategory.error && <p className="mt-1 text-xs text-red-600">{(setCategory.error as Error).message}</p>}
          </Fold>
        </>
      )}
    </section>
  )
}
