import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Fold } from '@/components/Fold'
import { InfoPopover } from '@/components/InfoPopover'
import { Select } from '@/components/Select'
import { canSeeFinances, hasManagerAccess, useAuth } from '@/lib/auth'
import {
  PLACE_KINDS,
  deliveredPricePerGj,
  gasByMonth,
  gasBySite,
  gasByYear,
  gasSiteLabel,
  noticesWithoutBill,
  useGasBills,
  useGasBillSites,
  useGasSites,
  useNameGasSite,
  useReadQbGasBills,
  type GasBillRow,
  type GasSiteSum,
  type GasSum,
  type PlaceKind,
} from '@/lib/gas-bills'
import { cn } from '@/lib/utils'
import { CARD_HEAD, TABLE_HEAD, TABLE_TH } from '@/lib/table-style'

const money0 = (v: number) => v.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 })
const perGj = (v: number | null) => (v == null ? '—' : `$${v.toFixed(2)}`)
const gj0 = (v: number) => Math.round(v).toLocaleString('en-CA')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`

/**
 * Utilities → Gas (Sam, 13 Oct 2026: "Yes build a gas reader for Direct
 * Energy too"): the natural gas the farm's sites burn and what a GJ costs
 * delivered, from the Direct Energy bills read out of QuickBooks
 * (netlify/shared/gas-bills-qb-read.ts). Each site is named once — shop,
 * house, dryer — and the name holds for every bill of it.
 */
export function GasBills() {
  const { profile } = useAuth()
  const manager = hasManagerAccess(profile?.role)
  const finance = canSeeFinances(profile)
  const { data: bills } = useGasBills()
  const { data: sites } = useGasBillSites()
  const { data: places } = useGasSites()
  const fromQb = useReadQbGasBills()
  const [months, setMonths] = useState('12')
  const [now] = useState(() => Date.now())

  if (!manager) return <p className="text-sm text-gray-500">The gas bills are for managers.</p>
  const from = months === 'all' ? null : new Date(now - Number(months) * 30.44 * 86400_000).toISOString().slice(0, 10)
  const rows = sites ?? []
  const price = deliveredPricePerGj(rows, from)
  const bySite = gasBySite(rows, places ?? [], from)
  const byYear = gasByYear(rows)
  const byMonth = gasByMonth(rows, from)
  const notices = noticesWithoutBill(bills ?? [])
  const noticeYears = new Map<string, { n: number; total: number }>()
  for (const b of notices) {
    const y = (b.bill_date ?? '').slice(0, 4)
    const t = noticeYears.get(y) ?? { n: 0, total: 0 }
    noticeYears.set(y, { n: t.n + 1, total: t.total + Number(b.total ?? 0) })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          Bills ending in the last
          <Select
            value={months}
            onChange={setMonths}
            options={[
              { value: '12', label: '12 months' },
              { value: '24', label: '24 months' },
              { value: 'all', label: 'all bills' },
            ]}
            size="sm"
            className="w-32"
            ariaLabel="Period"
          />
        </label>
        {finance && (
          <button
            type="button"
            onClick={() => fromQb.mutate()}
            disabled={fromQb.isPending}
            className="flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', fromQb.isPending && 'animate-spin')} /> Read the bills in QuickBooks
          </button>
        )}
      </div>
      {fromQb.error && <p className="text-sm text-red-600">{(fromQb.error as Error).message}</p>}
      {fromQb.isSuccess && <p className="text-xs text-gray-600">Reading the gas bills from QuickBooks; they show here in a few minutes.</p>}

      <section className="grid gap-3 sm:grid-cols-3">
        <Stat label="Delivered, a GJ" value={price ? perGj(price.perGj) : '—'} sub={price ? `Gas alone ${perGj(price.gasPerGj)}` : 'No bills in the period'} />
        <Stat label="Used" value={price ? `${gj0(price.gj)} GJ` : '—'} />
        <Stat label="Cost before GST" value={price ? money0(price.cost) : '—'} />
      </section>

      <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="flex items-center gap-1 px-3 pb-2 pt-3">
          <h2 className="text-sm font-semibold text-gray-900">By site</h2>
          <InfoPopover title="Gas sites">
            <p>
              Each ATCO gas site on the bills, by its site ID. Name it once and the name holds for every bill. A gas meter pin on the map whose notes carry the
              site ID or meter number names it by itself.
            </p>
          </InfoPopover>
        </div>
        {bySite.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead className={TABLE_HEAD}>
                <tr>
                  <th className={TABLE_TH}>Site</th>
                  <th className={cn(TABLE_TH, 'text-right')}>Bills</th>
                  <th className={cn(TABLE_TH, 'text-right')}>GJ</th>
                  <th className={cn(TABLE_TH, 'text-right')}>Cost</th>
                  <th className={cn(TABLE_TH, 'text-right')}>$/GJ</th>
                  <th className={cn(TABLE_TH, 'text-right')}>Last bill</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 tabular-nums">
                {bySite.map((s) => (
                  <SiteRow key={s.siteId} s={s} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-3 pb-3 text-sm text-gray-500">No gas bills read yet.</p>
        )}
      </section>

      {byYear.length > 0 && (
        <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <h2 className={cn('font-medium', CARD_HEAD)}>By year</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className={TABLE_HEAD}>
                <tr>
                  <th className={TABLE_TH}>Year</th>
                  <th className={cn(TABLE_TH, 'text-right')}>Bills</th>
                  <th className={cn(TABLE_TH, 'text-right')}>GJ</th>
                  <th className={cn(TABLE_TH, 'text-right')}>Cost</th>
                  <th className={cn(TABLE_TH, 'text-right')}>Delivered $/GJ</th>
                  <th className={cn(TABLE_TH, 'text-right')}>Gas $/GJ</th>
                  <th className={cn(TABLE_TH, 'text-right')}>Carbon tax</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 tabular-nums">
                {byYear.map((y) => (
                  <SumRow key={y.year} label={y.year} t={y} carbon note={noticeYears.get(y.year)} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {byMonth.length > 0 && (
        <Fold title="By month" summary={`${byMonth.length} months`} storageKey="gas-by-month" className="overflow-hidden" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead className={TABLE_HEAD}>
                <tr>
                  <th className={TABLE_TH}>Month</th>
                  <th className={cn(TABLE_TH, 'text-right')}>Bills</th>
                  <th className={cn(TABLE_TH, 'text-right')}>GJ</th>
                  <th className={cn(TABLE_TH, 'text-right')}>Cost</th>
                  <th className={cn(TABLE_TH, 'text-right')}>Delivered $/GJ</th>
                  <th className={cn(TABLE_TH, 'text-right')}>Gas $/GJ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 tabular-nums">
                {byMonth.map((m) => (
                  <SumRow key={m.month} label={monthLabel(m.month)} t={m} />
                ))}
              </tbody>
            </table>
          </div>
        </Fold>
      )}

      {(bills ?? []).length > 0 && (
        <Fold title="Every bill" summary={`${bills!.length} bills`} storageKey="gas-bills-list">
          <ul className="divide-y divide-gray-100 text-sm">
            {bills!.map((b) => (
              <BillRow key={b.id} b={b} />
            ))}
          </ul>
        </Fold>
      )}
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-xl font-semibold tabular-nums text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-500">{sub}</p>}
    </div>
  )
}

function SumRow({ label, t, carbon, note }: { label: string; t: GasSum; carbon?: boolean; note?: { n: number; total: number } }) {
  return (
    <tr>
      <td className="px-3 py-1.5 text-gray-900">
        {label}
        {note && (
          <span className="ml-1.5 text-xs text-gray-500" title="Emailed notices: the amount billed, with no GJ">
            + {money0(note.total)} on {note.n} notice{note.n === 1 ? '' : 's'}
          </span>
        )}
      </td>
      <td className="px-3 py-1.5 text-right text-gray-600">{t.bills}</td>
      <td className="px-3 py-1.5 text-right text-gray-700">{gj0(t.gj)}</td>
      <td className="px-3 py-1.5 text-right font-medium text-gray-900">{money0(t.cost)}</td>
      <td className="px-3 py-1.5 text-right text-gray-700">{perGj(t.perGj)}</td>
      <td className="px-3 py-1.5 text-right text-gray-600">{perGj(t.gasPerGj)}</td>
      {carbon && <td className="px-3 py-1.5 text-right text-gray-600">{t.carbon ? money0(t.carbon) : '—'}</td>}
    </tr>
  )
}

/** A site, and the place it is: named here once, for every bill of it. */
function SiteRow({ s }: { s: GasSiteSum }) {
  const name = useNameGasSite()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(s.place ?? '')
  const [kind, setKind] = useState<PlaceKind | ''>(s.kind ?? '')
  const where = s.legalLand ?? s.address
  const save = (k: PlaceKind | '', text: string) => {
    const label = PLACE_KINDS.find((p) => p.value === k)?.label ?? null
    name.mutate({ siteId: s.siteId, place: text.trim() || label, kind: k || null }, { onSuccess: () => setEditing(false) })
  }
  return (
    <tr>
      <td className="px-3 py-1.5">
        {s.place && !editing ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-gray-900">{s.place}</span>
            <button type="button" onClick={() => setEditing(true)} className="text-[11px] text-brand-700 hover:underline">
              Rename
            </button>
          </span>
        ) : (
          <span className="flex flex-wrap items-center gap-1.5">
            {!s.place && <span className="text-amber-800">{gasSiteLabel(s.siteId, null)}</span>}
            <Select
              value={kind}
              onChange={(v) => {
                setKind(v as PlaceKind | '')
                if (v && !draft.trim()) save(v as PlaceKind, '')
              }}
              options={[{ value: '', label: 'What is it?' }, ...PLACE_KINDS]}
              size="sm"
              className="w-32"
              ariaLabel={`${gasSiteLabel(s.siteId, s.place)}: what it is`}
            />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => draft.trim() && draft.trim() !== (s.place ?? '') && save(kind, draft)}
              onKeyDown={(e) => e.key === 'Enter' && draft.trim() && save(kind, draft)}
              placeholder="Name, e.g. Ranch house"
              aria-label={`${gasSiteLabel(s.siteId, s.place)}: name`}
              className="w-40 rounded-md border border-gray-300 px-2 py-0.5 text-xs"
            />
          </span>
        )}
        <span className="block text-xs text-gray-500">
          Site {s.siteId}
          {where ? ` · ${where}` : ''}
          {s.meter ? ` · meter ${s.meter}` : ''}
        </span>
        {name.error && <span className="block text-xs text-red-600">{(name.error as Error).message}</span>}
      </td>
      <td className="px-3 py-1.5 text-right text-gray-600">{s.bills}</td>
      <td className="px-3 py-1.5 text-right text-gray-700">{gj0(s.gj)}</td>
      <td className="px-3 py-1.5 text-right font-medium text-gray-900">{money0(s.cost)}</td>
      <td className="px-3 py-1.5 text-right text-gray-700">{perGj(s.perGj)}</td>
      <td className="px-3 py-1.5 text-right text-gray-600">{s.last ?? '—'}</td>
    </tr>
  )
}

function BillRow({ b }: { b: GasBillRow }) {
  const period = b.period_start && b.period_end ? `${b.period_start} – ${b.period_end}` : (b.bill_date ?? '—')
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
      <span className="min-w-0 flex-1">
        <span className="text-gray-900">{b.bill_date ?? b.file_name ?? 'Bill'}</span>
        <span className="ml-2 text-xs text-gray-500">{b.status === 'notice' ? 'emailed notice' : period}</span>
        {b.account_number && <span className="ml-2 text-xs text-gray-500">account …{b.account_number.slice(-4)}</span>}
        {b.source === 'quickbooks' && <span className="ml-1 rounded bg-emerald-50 px-1 text-[10px] text-emerald-800">QuickBooks</span>}
        {b.budget_plan && <span className="ml-1 rounded bg-sky-50 px-1 text-[10px] text-sky-800">budget plan</span>}
        {b.adjusted && <span className="ml-1 rounded bg-gray-100 px-1 text-[10px] text-gray-700">adjusted</span>}
        {b.error && <span className="block text-xs text-amber-800">{b.error}</span>}
      </span>
      <span className="tabular-nums text-gray-700">{b.total != null ? money0(Number(b.total)) : '—'}</span>
    </li>
  )
}
