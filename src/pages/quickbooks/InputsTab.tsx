import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Sprout } from 'lucide-react'
import { Fold } from '@/components/Fold'
import { HelpNote } from '@/components/HelpNote'
import { useCropYear } from '@/lib/crop-year'
import { byVendor, compareInputs, INPUT_KINDS, type InputsCompare } from '@/lib/inputs-vs-books-core'
import { fiscalYear, parseReport, useAccountCategories, useQbReport } from '@/lib/qb-books'
import { useCropBooks } from '@/lib/reports/crop-books'
import { ourRows } from '@/lib/reports/agristability-form'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

const db = supabase as unknown as SupabaseClient
const money0 = (v: number) => v.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 })
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—')

/**
 * QuickBooks → Inputs vs Deere (Sam, 7 Oct 2026: "Real input costs per
 * field vs Deere"). The fiscal year's fertilizer, chemical, seed and fuel as
 * the books paid them, against what the app costs on the fields from the
 * Deere passes and the price book; then field by field, with what the ICI
 * invoices put on each field; and who the books paid.
 */
export function InputsTab({ realm }: { realm: string }) {
  const { cropYear: year } = useCropYear()
  const fy = fiscalYear(year)
  const params = useMemo(() => ({ start_date: fy.start, end_date: fy.end, accounting_method: 'Accrual' }), [fy.start, fy.end])
  const report = useQbReport('ProfitAndLoss', params)
  const { data: overrides } = useAccountCategories(realm)
  const cb = useCropBooks(year)
  const [rows, setRows] = useState<{ year: number; rows: ReturnType<typeof ourRows> } | null>(null)
  const ici = useQuery({
    queryKey: ['ici_field_lines', 'invoiced', year],
    queryFn: async () => {
      const { data, error } = await db.from('ici_field_lines').select('field_id, amount').eq('crop_year', year).in('kind', ['blend', 'edge', 'floating', 'fertilizer'])
      if (error) throw error
      return (data ?? []) as { field_id: string | null; amount: number | null }[]
    },
  })
  const parsed = useMemo(() => (report.data ? parseReport(report.data.data) : null), [report.data])
  const cmp: InputsCompare | null = useMemo(
    () => (parsed && overrides ? compareInputs({ report: parsed, overrides, rows: rows?.year === year ? rows.rows : [], ici: ici.data ?? [] }) : null),
    [parsed, overrides, rows, year, ici.data],
  )
  const ids = useMemo(() => [...(cmp?.accountKind.keys() ?? [])].sort(), [cmp])
  const vendorLines = useQuery({
    queryKey: ['qb-input-vendor-lines', realm, fy.start, ids],
    enabled: ids.length > 0,
    queryFn: async () => {
      const out: { account_id: string | null; party_name: string | null; amount: number | null }[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db
          .from('qb_lines')
          .select('entity, account_id, party_name, amount')
          .eq('realm_id', realm)
          .in('entity', ['Bill', 'Purchase', 'VendorCredit'])
          .in('account_id', ids)
          .gte('txn_date', fy.start)
          .lte('txn_date', fy.end)
          .range(from, from + 999)
        if (error) throw error
        // A vendor credit takes off.
        out.push(...(data ?? []).map((l) => ({ ...l, amount: (l.entity === 'VendorCredit' ? -1 : 1) * (Number(l.amount) || 0) })))
        if (!data || data.length < 1000) break
      }
      return out
    },
  })
  const vendors = useMemo(() => (cmp && vendorLines.data ? byVendor(vendorLines.data, cmp.accountKind) : null), [cmp, vendorLines.data])

  const compared = rows?.year === year
  const booksTotal = cmp?.kinds.reduce((s, k) => s + k.books, 0) ?? 0
  const appTotal = cmp?.kinds.reduce((s, k) => s + k.app, 0) ?? 0

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
            <Sprout className="h-4 w-4 text-emerald-700" /> Inputs: the books against the fields · {year} crop ({fy.label})
          </h2>
          {!compared && (
            <button
              type="button"
              onClick={() => setRows({ year, rows: ourRows(cb.build()) })}
              disabled={!cb.ready}
              className="rounded-md bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {cb.ready ? 'Compare with the fields' : 'Loading the fields…'}
            </button>
          )}
        </div>
        <HelpNote summary="What the books paid, against what the app costs on the fields from the Deere passes." className="mt-0.5">
          <p>
            Books: the {fy.label} Profit and Loss, the accounts filed as fertilizer, chemical, seed and fuel (change a filing on Financials → Farm costs →
            From the books). Fields: our crops in the {year} plan, what the machines put on each field priced off the price book (the Profit/Loss Map&apos;s
            figures). The gap is what the field costs miss: inputs bought but not yet put on (or put on last season), a retailer&apos;s custom application
            Deere never recorded, a product with no price in the price book, the landlord&apos;s share on a shared-input deal, and fuel the pickups, yard and
            cattle burn. &ldquo;Invoiced&rdquo; is what the ICI invoices&apos; notes put on that field.
          </p>
        </HelpNote>
        {cb.error && <p className="mt-2 text-sm text-red-600">{cb.error.message}</p>}
        {report.error && <p className="mt-2 text-sm text-red-600">{(report.error as Error).message}</p>}
        {report.isLoading && <p className="mt-2 text-sm text-gray-500">Asking QuickBooks…</p>}

        {cmp && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="py-1 font-medium">Input</th>
                  <th className="py-1 text-right font-medium">Books</th>
                  <th className="py-1 text-right font-medium">On the fields</th>
                  <th className="py-1 text-right font-medium">Not on a field</th>
                  <th className="py-1 text-right font-medium">Placed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 tabular-nums">
                {cmp.kinds.map((k) => (
                  <tr key={k.kind}>
                    <td className="py-1.5 text-gray-800">{INPUT_KINDS.find((x) => x.key === k.kind)!.label}</td>
                    <td className="py-1.5 text-right text-gray-900">{money0(k.books)}</td>
                    <td className="py-1.5 text-right text-gray-700">{compared ? money0(k.app) : '—'}</td>
                    <td className={cn('py-1.5 text-right', compared && k.gap > 0 ? 'text-amber-800' : 'text-gray-500')}>{compared ? money0(k.gap) : '—'}</td>
                    <td className="py-1.5 text-right text-gray-600">{compared ? pct(k.app, k.books) : '—'}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-1.5 text-gray-900">Inputs</td>
                  <td className="py-1.5 text-right text-gray-900">{money0(booksTotal)}</td>
                  <td className="py-1.5 text-right text-gray-900">{compared ? money0(appTotal) : '—'}</td>
                  <td className="py-1.5 text-right text-gray-900">{compared ? money0(booksTotal - appTotal) : '—'}</td>
                  <td className="py-1.5 text-right text-gray-700">{compared ? pct(appTotal, booksTotal) : '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      {cmp && compared && (
        <Fold title="Field by field" summary={`${cmp.fields.length} fields`} storageKey="qb-inputs-fields" defaultOpen>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="py-1 font-medium">Field</th>
                  <th className="py-1 text-right font-medium">Fert</th>
                  <th className="py-1 text-right font-medium">Chem</th>
                  <th className="py-1 text-right font-medium">Seed</th>
                  <th className="py-1 text-right font-medium">Fuel</th>
                  <th className="py-1 text-right font-medium">$/ac</th>
                  <th className="py-1 text-right font-medium">Invoiced fert</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 tabular-nums">
                {cmp.fields.map((f) => (
                  <tr key={f.fieldId}>
                    <td className="py-1.5 pr-2">
                      <Link to={`/fields/${f.fieldId}`} className="text-gray-900 hover:text-brand-700 hover:underline">
                        {f.field}
                      </Link>
                      <span className="block text-[11px] text-gray-500">
                        {f.crop ?? '—'} · {Math.round(f.acres).toLocaleString('en-CA')} ac
                      </span>
                    </td>
                    <td className="py-1.5 text-right text-gray-700">{money0(f.app.fertilizer)}</td>
                    <td className="py-1.5 text-right text-gray-700">{money0(f.app.chemical)}</td>
                    <td className="py-1.5 text-right text-gray-700">{money0(f.app.seed)}</td>
                    <td className="py-1.5 text-right text-gray-700">{money0(f.app.fuel)}</td>
                    <td className="py-1.5 text-right font-medium text-gray-900">{f.acres > 0 ? money0(f.appTotal / f.acres) : '—'}</td>
                    <td
                      className={cn(
                        'py-1.5 text-right',
                        f.invoiced == null ? 'text-gray-400' : f.invoiced > f.app.fertilizer * 1.1 + 100 ? 'text-amber-800' : 'text-gray-700',
                      )}
                      title={f.invoiced != null && f.invoiced > f.app.fertilizer * 1.1 + 100 ? 'More fertilizer invoiced to this field than the passes cost' : undefined}
                    >
                      {f.invoiced == null ? '—' : money0(f.invoiced)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Fold>
      )}

      {cmp && vendors && (
        <Fold title="Who the books paid" storageKey="qb-inputs-vendors">
          <div className="grid gap-3 sm:grid-cols-2">
            {cmp.kinds.map((k) => {
              const list = vendors.get(k.kind) ?? []
              const listed = list.reduce((s, v) => s + v.amount, 0)
              return (
                <div key={k.kind}>
                  <h3 className="text-xs font-semibold text-gray-700">{INPUT_KINDS.find((x) => x.key === k.kind)!.label}</h3>
                  <ul className="mt-1 divide-y divide-gray-100 text-sm">
                    {list.slice(0, 8).map((v) => (
                      <li key={v.vendor} className="flex justify-between gap-2 py-0.5">
                        <span className="truncate text-gray-800">{v.vendor}</span>
                        <span className="tabular-nums text-gray-700">{money0(v.amount)}</span>
                      </li>
                    ))}
                    {list.length > 8 && (
                      <li className="flex justify-between gap-2 py-0.5 text-gray-500">
                        <span>{list.length - 8} more</span>
                        <span className="tabular-nums">{money0(list.slice(8).reduce((s, v) => s + v.amount, 0))}</span>
                      </li>
                    )}
                    {Math.abs(k.books - listed) >= 1 && (
                      <li className="flex justify-between gap-2 py-0.5 text-gray-500">
                        <span>Journal entries and other adjustments</span>
                        <span className="tabular-nums">{money0(k.books - listed)}</span>
                      </li>
                    )}
                  </ul>
                </div>
              )
            })}
          </div>
        </Fold>
      )}
    </div>
  )
}
