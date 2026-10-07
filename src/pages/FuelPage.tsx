import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Fuel, RefreshCw } from 'lucide-react'
import { DateField } from '@/components/DateField'
import { Fold } from '@/components/Fold'
import { HelpNote } from '@/components/HelpNote'
import { PageHeader } from '@/components/PageHeader'
import { PriceChart } from '@/components/PriceChart'
import { DeleteButton, DetailList, EditButton, RecordEditModal, rowClick, type EditField } from '@/components/RecordEditor'
import { Select } from '@/components/Select'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useBasics, useOperatingSettings } from '@/lib/hauling-data'
import {
  typedDefaultOf,
  useDeleteFuelPurchase,
  useFuelPurchases,
  useRefreshFuelMarket,
  useSaveFuelPurchase,
  useSaveTypedFuelDefault,
  useUpdateFuelPurchase,
  type FuelPurchase,
} from '@/lib/fuel-data'
import { AB_FUEL_TAX, farmCode, retailCode, taxesOn } from '@/lib/fuel-market'
import { useMarketPrices, useMarketSeries, type MarketPoint, type MarketSeries } from '@/lib/markets'
import { FUEL_PRODUCT_LABEL, type FuelProduct } from '@/lib/fuel-supplier-invoice'
import { cn } from '@/lib/utils'
import { PUBLIC_COPY } from '@/config/edition'

const input = 'rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900'
const perL = (v: number | null | undefined, d = 3) => (v == null ? '—' : `$${v.toFixed(d)}`)
const money = (v: number | null | undefined) =>
  v == null ? '—' : `$${v.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** The products shown as cards, in the order the farm buys most of. */
const CARD_PRODUCTS: FuelProduct[] = ['farm_diesel', 'clear_diesel', 'gasoline']

/** Market lines on the chart, by series code. */
const CHART_CODES = [farmCode('diesel'), retailCode('diesel', 'lethbridge'), retailCode('diesel', 'calgary'), retailCode('gasoline', 'lethbridge'), farmCode('gasoline')]

/** A pseudo-series so the farm's own invoices draw on the same chart as the market. */
const INVOICE_SERIES: MarketSeries = {
  id: 'fuel-supplier-farm-diesel',
  code: 'fuel-supplier.farm_diesel',
  kind: 'fuel',
  name: 'Fuel supplier farm diesel (invoices)',
  commodity: 'Farm diesel',
  unit: '$/L',
  region: null,
  source: 'invoice',
  crop_id: null,
  derived: false,
  archived: false,
  notes: null,
}

/**
 * Fuel under Inputs: what Fuel supplier charges, what the market is doing, and
 * the one diesel price every cost in the app uses.
 *
 * The costing price itself is chosen in hauling-data.ts (useBasics), so this
 * page and the trucking screen can never disagree about it.
 */
export function FuelPage() {
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const basics = useBasics()
  const settings = useOperatingSettings()
  const { data: purchases } = useFuelPurchases()
  const { data: allSeries } = useMarketSeries('fuel')
  const series = useMemo(() => (allSeries ?? []).filter((s) => CHART_CODES.includes(s.code)), [allSeries])
  const { data: points } = useMarketPrices(series.map((s) => s.id))
  const refresh = useRefreshFuelMarket()
  const [years, setYears] = useState('1')

  const latestBy = useMemo(() => {
    const m = new Map<FuelProduct, FuelPurchase>()
    for (const p of purchases ?? []) if (!m.has(p.product)) m.set(p.product, p)
    return m
  }, [purchases])

  const latestPoint = (code: string): MarketPoint | null => {
    const s = series.find((x) => x.code === code)
    if (!s) return null
    let best: MarketPoint | null = null
    for (const p of points ?? []) if (p.series_id === s.id && p.value != null && (!best || p.observed_on > best.observed_on)) best = p
    return best
  }

  const chart = useMemo(() => {
    const since = new Date()
    since.setFullYear(since.getFullYear() - Number(years))
    const from = since.toISOString().slice(0, 10)
    const inv: MarketPoint[] = (purchases ?? [])
      .filter((p) => p.product === 'farm_diesel' && p.invoice_date >= from)
      .map((p) => ({ series_id: INVOICE_SERIES.id, observed_on: p.invoice_date, value: p.price_per_l, low: null, high: null }))
    // Ordered as CHART_CODES, so the colours stay put from visit to visit.
    const ordered = CHART_CODES.map((c) => series.find((s) => s.code === c)).filter((s): s is MarketSeries => !!s)
    return {
      series: inv.length ? [INVOICE_SERIES, ...ordered] : ordered,
      points: [...(points ?? []).filter((p) => p.observed_on >= from), ...inv],
    }
  }, [series, points, purchases, years])

  const farmNow = latestPoint(farmCode('diesel'))
  const tax = farmNow ? taxesOn(farmNow.observed_on, 'diesel') : null

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <PageHeader
        title="Fuel"
        icon={<Fuel className="h-5 w-5 text-brand-700" />}
        subtitle={`Costs use ${perL(basics.dieselPerL, 2)}/L diesel · ${basics.dieselSource}`}
      />

      {/* What the farm last paid, per product. */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {CARD_PRODUCTS.map((p) => {
          const l = latestBy.get(p)
          return (
            <div key={p} className="rounded-lg border border-gray-200 bg-white p-3">
              <p className="text-xs text-gray-500">{FUEL_PRODUCT_LABEL[p]} · Fuel supplier</p>
              <p className="text-2xl font-semibold tabular-nums text-gray-900">
                {perL(l?.price_per_l)}
                <span className="text-sm font-normal text-gray-500">/L</span>
              </p>
              <p className="text-[11px] text-gray-500">
                {l ? `${l.invoice_date}${l.invoice_no ? ` · invoice ${l.invoice_no}` : ''} · ${Math.round(l.litres).toLocaleString('en-CA')} L` : 'No invoice yet'}
              </p>
            </div>
          )
        })}
      </section>

      {/* The market this week. */}
      <section className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900">Market</h2>
          <div className="flex items-center gap-2">
            <Select
              size="sm"
              value={years}
              onChange={setYears}
              ariaLabel="How far back"
              options={[
                { value: '1', label: 'Last year' },
                { value: '2', label: 'Two years' },
              ]}
            />
            {isManager && (
              <button
                type="button"
                onClick={() => refresh.mutate()}
                disabled={refresh.isPending}
                className="flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', refresh.isPending && 'animate-spin')} /> Refresh
              </button>
            )}
          </div>
        </div>
        {refresh.error && <p className="mb-2 text-xs text-red-600">{(refresh.error as Error).message}</p>}
        <div className="mb-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          {[
            { label: 'Farm diesel (worked out)', code: farmCode('diesel') },
            { label: 'Lethbridge pump diesel', code: retailCode('diesel', 'lethbridge') },
            { label: 'Lethbridge pump gasoline', code: retailCode('gasoline', 'lethbridge') },
            { label: 'Farm gasoline (worked out)', code: farmCode('gasoline') },
          ].map((t) => {
            const p = latestPoint(t.code)
            return (
              <div key={t.code}>
                <p className="text-[11px] text-gray-500">{t.label}</p>
                <p className="font-semibold tabular-nums">{perL(p?.value)}/L</p>
                <p className="text-[10px] text-gray-400">{p ? `week to ${p.observed_on}` : 'not read yet'}</p>
              </div>
            )
          })}
        </div>
        {chart.series.length ? (
          <PriceChart series={chart.series} points={chart.points} unit="$/L" connectGaps />
        ) : (
          <p className="py-8 text-center text-sm text-gray-400">No market prices yet — the daily read fills this in{isManager ? ', or press Refresh' : ''}.</p>
        )}
        <HelpNote summary="Pump prices with GST; farm lines before GST, as invoices are." className="mt-2">
          <p>
            Pump prices are Natural Resources Canada&apos;s weekly averages (Wednesday to Tuesday, dated by the Tuesday), self-serve, every tax in. The newest
            week is still filling in until its Tuesday.
          </p>
          <p className="mt-1">
            Nobody publishes a marked-fuel price, so the farm lines are worked out from Lethbridge&apos;s: the pump price before GST (the farm claims it
            back), less the Alberta fuel tax marked fuel does not pay, less the federal fuel charge farm fuel was exempt from until it ended on 1 Apr
            2025.
            {tax && ` This week: Alberta ${tax.abClear}¢ clear vs ${tax.abMarked}¢ marked, fuel charge ${tax.fuelCharge}¢.`}
          </p>
          <p className="mt-1">
            Alberta&apos;s rate changes by quarter with the price of oil. The app knows {AB_FUEL_TAX.length} rate periods; a new quarter&apos;s rate needs adding
            in src/lib/fuel-market.ts. Federal excise is treated as paid on both, so it does not change the gap.
          </p>
        </HelpNote>
      </section>

      <CostingCard isManager={isManager} basics={basics} typed={typedDefaultOf(settings.get('fuel_default_per_l'))} by={profile?.full_name ?? null} />

      <PurchaseHistory isManager={isManager} purchases={purchases ?? []} />
    </div>
  )
}

function CostingCard({
  isManager,
  basics,
  typed,
  by,
}: {
  isManager: boolean
  basics: ReturnType<typeof useBasics>
  typed: ReturnType<typeof typedDefaultOf>
  by: string | null
}) {
  const save = useSaveTypedFuelDefault()
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-3">
      <h2 className="text-sm font-semibold text-gray-900">The diesel price costs use</h2>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">
        {perL(basics.dieselPerL, 2)}
        <span className="text-sm font-normal text-gray-500">/L</span>
      </p>
      <p className={cn('text-[11px]', basics.dieselSet ? 'text-brand-700' : 'text-gray-500')}>{basics.dieselSource}</p>
      {basics.dieselSet && (
        <p className="mt-1 text-xs text-amber-700">
          A price set on the{' '}
          <Link to="/hauling" className="underline">
            trucking screen
          </Link>{' '}
          is overriding the invoices and the market.
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gray-600">Typed default</span>
        {isManager ? (
          <input
            inputMode="decimal"
            aria-label="Typed default diesel price per litre"
            value={draft ?? (typed ? typed.perL.toFixed(2) : '')}
            onChange={(e) => setDraft(e.target.value)}
            className={cn(input, 'w-20 text-right')}
          />
        ) : (
          <span className="tabular-nums">{perL(typed?.perL, 2)}</span>
        )}
        <span className="text-xs text-gray-500">/L{typed?.by || typed?.on ? ` · ${[typed.by, typed.on].filter(Boolean).join(', ')}` : ''}</span>
        {draft != null && (
          <button
            type="button"
            disabled={save.isPending}
            onClick={async () => {
              const n = Number(draft)
              if (Number.isFinite(n) && n > 0) await save.mutateAsync({ perL: n, by })
              setDraft(null)
            }}
            className="rounded-md bg-brand-700 px-2 py-0.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            Save
          </button>
        )}
      </div>
      <HelpNote summary="Newest invoice, else the market, else the typed default." className="mt-2">
        <p>
          Every fuel cost in the app — field passes from John Deere&apos;s litres, trucking, manure hauling, spreading — uses one diesel price, chosen in
          this order: a price set on the trucking screen (an override, for a what-if); the newest Fuel supplier farm-diesel invoice; the market farm-diesel
          figure above; the typed default here; Alberta&apos;s monthly farm input survey; and $1.40 if all of those are missing.
        </p>
      </HelpNote>
    </section>
  )
}

const FUEL_EDIT_FIELDS: EditField[] = [
  { key: 'invoice_date', label: 'Date', kind: 'date', required: true },
  {
    key: 'product',
    label: 'Product',
    kind: 'select',
    required: true,
    options: (['farm_diesel', 'clear_diesel', 'gasoline', 'farm_gasoline'] as FuelProduct[]).map((p) => ({ value: p, label: FUEL_PRODUCT_LABEL[p] })),
  },
  { key: 'litres', label: 'Litres', kind: 'number', required: true },
  { key: 'price_per_l', label: '$/L before GST', kind: 'number', step: '0.0001', required: true },
  { key: 'supplier', label: 'Supplier', kind: 'text' },
  { key: 'invoice_no', label: 'Invoice', kind: 'text' },
  { key: 'description', label: 'Equipment or use', kind: 'text', placeholder: 'e.g. 9RX, field shop tank' },
  { key: 'notes', label: 'Note', kind: 'textarea' },
]

function PurchaseHistory({ isManager, purchases }: { isManager: boolean; purchases: FuelPurchase[] }) {
  const save = useSaveFuelPurchase()
  const del = useDeleteFuelPurchase()
  const update = useUpdateFuelPurchase()
  const [showAll, setShowAll] = useState(false)
  // Sam, 7 Oct 2026: a row opens to everything on it; typed lines can be corrected.
  const [openId, setOpenId] = useState<string | null>(null)
  const [editing, setEditing] = useState<FuelPurchase | null>(null)
  const [form, setForm] = useState({ on: new Date().toISOString().slice(0, 10), product: 'farm_diesel' as FuelProduct, litres: '', price: '', invoice: '' })
  const rows = showAll ? purchases : purchases.slice(0, 25)
  const litres = Number(form.litres)
  const price = Number(form.price)
  const valid = litres > 0 && price > 0 && price < 10 && !!form.on

  return (
    <Fold title="Fuel supplier purchases" summary={`${purchases.length} line${purchases.length === 1 ? '' : 's'}`} storageKey="fuel-purchases">
      {purchases.length === 0 ? (
        <p className="py-2 text-sm text-gray-500">No invoices loaded yet. {PUBLIC_COPY ? 'Type them in below.' : 'They arrive from Gmail through Drive once the filer is set up, or can be typed below.'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-[11px] uppercase tracking-wide text-gray-500">
                <th className="py-1 pr-2">Date</th>
                <th className="py-1 pr-2">Invoice</th>
                <th className="py-1 pr-2">Product</th>
                <th className="py-1 pr-2 text-right">Litres</th>
                <th className="py-1 pr-2 text-right">$/L</th>
                <th className="py-1 pr-2 text-right">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const isOpen = openId === p.id
                return (
                  <Fragment key={p.id}>
                    <tr className="cursor-pointer border-b border-gray-100 hover:bg-gray-50" onClick={rowClick(() => setOpenId(isOpen ? null : p.id))} aria-expanded={isOpen}>
                      <td className="py-1 pr-2 tabular-nums">
                        <span className="flex items-center gap-1">
                          <ChevronRight className={cn('h-3.5 w-3.5 text-gray-400 transition-transform', isOpen && 'rotate-90')} />
                          {p.invoice_date}
                        </span>
                      </td>
                      <td className="py-1 pr-2 text-gray-600">{p.invoice_no ?? (p.source === 'typed' ? 'typed' : '—')}</td>
                      <td className="py-1 pr-2" title={p.description ?? undefined}>
                        {FUEL_PRODUCT_LABEL[p.product]}
                        {!p.checked && <span className="ml-1 text-[10px] text-amber-700">check</span>}
                      </td>
                      <td className="py-1 pr-2 text-right tabular-nums">{Math.round(p.litres).toLocaleString('en-CA')}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{perL(p.price_per_l, 4)}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{money(p.amount)}</td>
                      <td className="py-1 text-right">
                        {isManager && p.source === 'typed' && (
                          <span className="flex justify-end gap-1">
                            <EditButton onClick={() => setEditing(p)} />
                            <DeleteButton onDelete={() => del.mutate(p.id)} confirm="Delete this typed fuel line?" />
                          </span>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-gray-100 bg-gray-50/60">
                        <td colSpan={7} className="px-3 py-2">
                          <DetailList
                            rows={[
                              ['Date', p.invoice_date],
                              ['Supplier', p.supplier],
                              ['Invoice', p.invoice_no],
                              ['Product', FUEL_PRODUCT_LABEL[p.product]],
                              ['Description', p.description],
                              ['Litres', p.litres.toLocaleString('en-CA', { maximumFractionDigits: 1 })],
                              ['$/L before GST', perL(p.price_per_l, 4)],
                              ['Amount', money(p.amount)],
                              ['Note', p.notes],
                              ['Came from', p.source === 'typed' ? 'Typed in by hand' : `Fuel supplier invoice${p.source_file ? ` · ${p.source_file}` : ''}`],
                              ['Checked', p.source === 'invoice' ? (p.checked ? 'Yes, the line adds up' : 'Needs checking against the invoice') : null],
                            ]}
                          />
                          {p.source === 'invoice' && <p className="mt-1 text-[11px] text-gray-400">Read from the invoice, so it is not edited here.</p>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
          {purchases.length > 25 && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-1 text-xs text-brand-700 underline">
              {showAll ? 'Show fewer' : `Show all ${purchases.length}`}
            </button>
          )}
        </div>
      )}

      {isManager && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3 text-sm">
          <label className="flex flex-col text-[11px] text-gray-500">
            Date
            <DateField value={form.on} onChange={(v) => setForm({ ...form, on: v })} ariaLabel="Purchase date" />
          </label>
          <label className="flex flex-col text-[11px] text-gray-500">
            Product
            <Select
              value={form.product}
              onChange={(v) => setForm({ ...form, product: v as FuelProduct })}
              ariaLabel="Product"
              options={(['farm_diesel', 'clear_diesel', 'gasoline', 'farm_gasoline'] as FuelProduct[]).map((p) => ({ value: p, label: FUEL_PRODUCT_LABEL[p] }))}
            />
          </label>
          <label className="flex flex-col text-[11px] text-gray-500">
            Litres
            <input inputMode="decimal" value={form.litres} onChange={(e) => setForm({ ...form, litres: e.target.value })} className={cn(input, 'w-24 text-right')} />
          </label>
          <label className="flex flex-col text-[11px] text-gray-500">
            $/L before GST
            <input inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className={cn(input, 'w-24 text-right')} />
          </label>
          <label className="flex flex-col text-[11px] text-gray-500">
            Invoice (optional)
            <input value={form.invoice} onChange={(e) => setForm({ ...form, invoice: e.target.value })} className={cn(input, 'w-28')} />
          </label>
          <button
            type="button"
            disabled={!valid || save.isPending}
            onClick={async () => {
              await save.mutateAsync({ invoice_date: form.on, product: form.product, litres, price_per_l: price, invoice_no: form.invoice })
              setForm({ ...form, litres: '', price: '', invoice: '' })
            }}
            className="rounded-md bg-brand-700 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
          >
            Add purchase
          </button>
          {save.error && <p className="w-full text-xs text-red-600">{(save.error as Error).message}</p>}
        </div>
      )}
      {editing && (
        <RecordEditModal
          title="Edit fuel line"
          fields={FUEL_EDIT_FIELDS}
          row={editing}
          saving={update.isPending}
          error={update.error ? (update.error as Error).message : null}
          onClose={() => {
            update.reset()
            setEditing(null)
          }}
          onSave={(v) =>
            update.mutateAsync({
              id: editing.id,
              invoice_date: String(v.invoice_date),
              product: v.product as FuelProduct,
              litres: Number(v.litres),
              price_per_l: Number(v.price_per_l),
              supplier: String(v.supplier ?? ''),
              invoice_no: (v.invoice_no as string | null) ?? null,
              description: (v.description as string | null) ?? null,
              notes: (v.notes as string | null) ?? null,
            })
          }
          onDelete={() => del.mutateAsync(editing.id)}
          deleteConfirm="Delete this typed fuel line?"
        />
      )}
    </Fold>
  )
}
