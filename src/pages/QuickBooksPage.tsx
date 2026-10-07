import { lazy, Suspense, useState } from 'react'
import { SETUP_LINKS, SetupLink } from '@/components/SetupLink'
import { useSearchParams } from 'react-router-dom'
import { CircleDollarSign, Paperclip } from 'lucide-react'
import { DateField } from '@/components/DateField'
import { PageHeader } from '@/components/PageHeader'
import { QbAskBar } from '@/components/QbAskBar'
import { PillTabs } from '@/components/PillTabs'
import { Select } from '@/components/Select'
import { canSeeFinances, useAuth } from '@/lib/auth'
import {
  QB_TXN_TYPES,
  openQbAttachment,
  qbTypeLabel,
  useQbAttachments,
  useQbCompany,
  useQbLines,
  useQbTotals,
  useQbTransactions,
  type QbTotalsBy,
  type QbTxn,
} from '@/lib/quickbooks'
import { cn } from '@/lib/utils'

const money = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 })
const input = 'rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900'

type Tab = 'transactions' | 'spending' | 'cash' | 'inputs' | 'ask'
const TABS = [
  { key: 'transactions', label: 'Transactions' },
  { key: 'spending', label: 'Spending' },
  { key: 'cash', label: 'Cash flow' },
  { key: 'inputs', label: 'Inputs vs Deere' },
  { key: 'ask', label: 'Ask' },
] as const

// The forecast reads the crop plan too; only load it when the tab opens.
const InputsTab = lazy(() => import('@/pages/quickbooks/InputsTab').then((m) => ({ default: m.InputsTab })))
const CashFlowTab = lazy(() => import('@/pages/quickbooks/CashFlowTab').then((m) => ({ default: m.CashFlowTab })))

const thisYear = new Date().getFullYear()

/**
 * The farm's QuickBooks, read into the app: find any bill or invoice and open
 * its PDF, add spending up by vendor, account or month, see the year's cash
 * flow ahead, and ask questions of it. Owners and the CPA only — the
 * database refuses everyone else.
 */
export function QuickBooksPage() {
  const { profile } = useAuth()
  const finances = canSeeFinances(profile)
  const { data: company, isLoading } = useQbCompany()
  const [params, setParams] = useSearchParams()
  const tab = (TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'transactions') as Tab
  const [from, setFrom] = useState(`${thisYear}-01-01`)
  const [to, setTo] = useState('')

  const header = (
    <PageHeader
      title="QuickBooks"
      icon={<CircleDollarSign className="h-5 w-5 text-brand-700" />}
      subtitle={
        company?.realm_id
          ? `${company.company_name ?? 'Company'} · ${company.environment === 'production' ? 'live books' : 'sandbox (test data)'} · synced ${company.last_sync_at ? new Date(company.last_sync_at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : 'not yet'}`
          : undefined
      }
    />
  )

  if (!finances) {
    return (
      <div className="mx-auto max-w-4xl p-4 md:p-6">
        {header}
        <p className="text-sm text-gray-600">The books are for the owners and the farm&apos;s accountant.</p>
      </div>
    )
  }
  if (isLoading) return <div className="mx-auto max-w-4xl p-4 md:p-6">{header}<p className="text-sm text-gray-500">Loading…</p></div>
  if (!company?.realm_id) {
    return (
      <div className="mx-auto max-w-4xl p-4 md:p-6">
        {header}
        <p className="text-sm text-gray-600">
          QuickBooks isn&apos;t connected.{' '}
          <SetupLink managerOnly to={SETUP_LINKS.integration('quickbooks')}>
            Connect it on Integrations
          </SetupLink>
        </p>
      </div>
    )
  }

  const realm = company.realm_id
  return (
    <div className="mx-auto max-w-5xl space-y-3 p-4 md:p-6">
      {header}
      {company.environment !== 'production' && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Sandbox: Intuit&apos;s sample company, not the farm&apos;s books. Nothing here is real money.
        </p>
      )}
      {company.last_error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{company.last_error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <PillTabs tabs={TABS} value={tab} onChange={(k) => setParams((p) => { p.set('tab', k); return p }, { replace: true })} />
        {tab !== 'cash' && tab !== 'inputs' && (
          <div className="ml-auto flex items-center gap-1.5 text-xs text-gray-600">
            <DateField value={from} onChange={setFrom} ariaLabel="From" />
            <span>to</span>
            <DateField value={to} onChange={setTo} ariaLabel="To" />
          </div>
        )}
      </div>

      {tab === 'transactions' && <Transactions realm={realm} from={from} to={to} />}
      {tab === 'spending' && <Spending realm={realm} from={from} to={to} />}
      {tab === 'cash' && (
        <Suspense fallback={<p className="text-sm text-gray-500">Loading…</p>}>
          <CashFlowTab realm={realm} />
        </Suspense>
      )}
      {tab === 'inputs' && (
        <Suspense fallback={<p className="text-sm text-gray-500">Loading…</p>}>
          <InputsTab realm={realm} />
        </Suspense>
      )}
      {tab === 'ask' && <QbAskBar />}
    </div>
  )
}

function Transactions({ realm, from, to }: { realm: string; from: string; to: string }) {
  const [type, setType] = useState('')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const { data, isLoading, error } = useQbTransactions({ realm, types: type ? [type] : [], from: from || undefined, to: to || undefined, search })

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 p-2">
        <Select
          value={type}
          ariaLabel="Type"
          size="sm"
          className="w-44"
          onChange={setType}
          options={[{ value: '', label: 'All types' }, ...QB_TXN_TYPES]}
        />
        <input className={cn(input, 'min-w-0 flex-1')} placeholder="Vendor, customer, number or memo" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="text-xs text-gray-500">{data ? `${data.length}${data.length === 500 ? '+ (narrow it)' : ''}` : ''}</span>
      </div>
      {isLoading && <p className="p-3 text-sm text-gray-500">Loading…</p>}
      {error && <p className="p-3 text-sm text-red-600">{(error as Error).message}</p>}
      {data && !data.length && <p className="p-3 text-sm text-gray-500">Nothing matches.</p>}
      <ul className="divide-y divide-gray-100">
        {(data ?? []).map((t) => (
          <li key={t.id}>
            <button
              onClick={() => setOpen(open === t.id ? null : t.id)}
              className="grid w-full grid-cols-[5.5rem_1fr_auto] items-baseline gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 sm:grid-cols-[6rem_8rem_1fr_6rem_auto]"
            >
              <span className="tabular-nums text-gray-600">{t.txn_date ?? '—'}</span>
              <span className="hidden text-gray-500 sm:block">
                {qbTypeLabel(t.entity)}
                {t.doc_number ? ` ${t.doc_number}` : ''}
              </span>
              <span className="truncate font-medium text-gray-900">{t.party_name ?? t.memo ?? '—'}</span>
              <span className="hidden text-right text-xs text-gray-500 sm:block">{t.balance ? `owing ${money(t.balance)}` : ''}</span>
              <span className="text-right tabular-nums text-gray-900">{money(t.total)}</span>
            </button>
            {open === t.id && <TxnDetail realm={realm} txn={t} />}
          </li>
        ))}
      </ul>
    </section>
  )
}

function TxnDetail({ realm, txn }: { realm: string; txn: QbTxn }) {
  const { data: lines } = useQbLines(txn.id)
  const { data: files } = useQbAttachments(realm, txn.entity, txn.qb_id)
  const [err, setErr] = useState<string | null>(null)
  return (
    <div className="space-y-2 bg-gray-50 px-3 py-2 text-xs">
      {txn.memo && <p className="text-gray-600">{txn.memo}</p>}
      <table className="w-full">
        <tbody>
          {(lines ?? []).map((l) => (
            <tr key={l.line_no} className="align-top">
              <td className="py-0.5 pr-2 text-gray-700">{l.account_name ?? l.item_name ?? '—'}{l.class_name ? <span className="text-gray-400"> · {l.class_name}</span> : null}</td>
              <td className="py-0.5 pr-2 text-gray-500">{l.description}{l.qty ? ` (${l.qty} × ${money(l.unit_price)})` : ''}</td>
              <td className="py-0.5 text-right tabular-nums text-gray-900">{money(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap gap-2">
        {(files ?? []).map((f) => (
          <button
            key={f.qb_id}
            onClick={() => {
              setErr(null)
              openQbAttachment(f.qb_id).catch((e) => setErr((e as Error).message))
            }}
            className="flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-gray-800 hover:bg-gray-100"
          >
            <Paperclip className="h-3.5 w-3.5" /> {f.name ?? 'Attachment'}
          </button>
        ))}
        {files && !files.length && <span className="text-gray-400">No file attached in QuickBooks.</span>}
      </div>
      {err && <p className="text-red-600">{err}</p>}
    </div>
  )
}

const BY: { value: QbTotalsBy; label: string }[] = [
  { value: 'party', label: 'By vendor / customer' },
  { value: 'account', label: 'By account' },
  { value: 'month', label: 'By month' },
  { value: 'class', label: 'By class' },
  { value: 'item', label: 'By item' },
]

function Spending({ realm, from, to }: { realm: string; from: string; to: string }) {
  const [by, setBy] = useState<QbTotalsBy>('party')
  const [side, setSide] = useState<'out' | 'in'>('out')
  const { data, isLoading, error } = useQbTotals(realm, from || null, to || null, by, side)
  const total = (data ?? []).reduce((s, r) => s + r.amount, 0)
  const max = Math.max(1, ...(data ?? []).map((r) => Math.abs(r.amount)))
  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 p-2">
        <Select
          value={side}
          ariaLabel="Money out or in"
          size="sm"
          className="w-36"
          onChange={(v) => setSide(v as 'out' | 'in')}
          options={[
            { value: 'out', label: 'Money out' },
            { value: 'in', label: 'Money in' },
          ]}
        />
        <Select value={by} ariaLabel="Group by" size="sm" className="w-48" onChange={(v) => setBy(v as QbTotalsBy)} options={BY} />
        <span className="ml-auto text-sm font-semibold tabular-nums text-gray-900">{money(total)}</span>
      </div>
      {isLoading && <p className="p-3 text-sm text-gray-500">Adding up…</p>}
      {error && <p className="p-3 text-sm text-red-600">{(error as Error).message}</p>}
      {data && !data.length && <p className="p-3 text-sm text-gray-500">Nothing in that range.</p>}
      <ul className="divide-y divide-gray-100">
        {(data ?? []).map((r) => (
          <li key={r.label} className="px-3 py-1.5 text-sm">
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-gray-800">{r.label}</span>
              <span className="text-xs text-gray-400">{r.transactions}</span>
              <span className="w-28 text-right tabular-nums text-gray-900">{money(r.amount)}</span>
            </div>
            <div className="mt-0.5 h-1 rounded bg-gray-100">
              <div className="h-1 rounded bg-brand-600" style={{ width: `${(Math.abs(r.amount) / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
