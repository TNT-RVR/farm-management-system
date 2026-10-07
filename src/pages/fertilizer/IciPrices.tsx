import { useMemo, useState } from 'react'
import { ChevronRight, FileText, Plus, TrendingUp } from 'lucide-react'
import { DateField } from '@/components/DateField'
import { InfoPopover } from '@/components/InfoPopover'
import { HelpNote } from '@/components/HelpNote'
import { InvoiceViewer } from '@/components/InvoiceViewer'
import { PriceChart } from '@/components/PriceChart'
import { Select } from '@/components/Select'
import { fertInfo, fertKind } from '@/lib/fertilizer-info'
import type { MarketSeries } from '@/lib/markets'
import {
  useCropByFieldSeason,
  useJdProducts,
  useProductApplications,
  useProductPurchases,
  useSaveProduct,
  useCreateQuotedProduct,
  type JdProduct,
  type ProductPurchase,
} from '@/lib/products'
import { cn } from '@/lib/utils'
import { useFarmSettings } from '@/lib/farm-setup'
import { STRAIGHTS, straightKeyOf } from '@/lib/fert-savings/straights'

/**
 * What ICI has charged this farm for fertilizer, product by product.
 *
 * Built from the invoice lines rather than from a list of products somebody
 * typed: every fertilizer that has ever been on an ICI invoice is here, at
 * its newest invoiced price, with the invoice a click away — and one that
 * has never been bought is not. A new product on the next invoice appears
 * on its own, because the database makes a product of any fertilizer line
 * it does not recognise.
 *
 * Straights (urea, UAN, MAP, potash, ESN, sulphur) are cards, since those
 * are compared year to year. Blends are a table by season, since each one
 * is a recipe for one field and one spring.
 */
const money = (v: number | null | undefined, digits = 0) =>
  v == null ? '—' : `$${v.toLocaleString('en-CA', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`

/** $/tonne for a dry product priced per kg; $/L for a liquid. */
function displayPrice(p: JdProduct): { value: number | null; unit: string; perTonne: boolean } {
  if (p.price_per_unit == null) return { value: null, unit: p.unit === 'kg' ? '/t' : '/L', perTonne: p.unit === 'kg' }
  return p.unit === 'kg'
    ? { value: Number(p.price_per_unit) * 1000, unit: '/t', perTonne: true }
    : { value: Number(p.price_per_unit), unit: '/L', perTonne: false }
}

type Row = {
  product: JdProduct
  price: ReturnType<typeof displayPrice>
  /** Newest invoice line, if the price came from one. */
  latest: ProductPurchase | null
  /** The line before it on a different invoice, for the move. */
  previous: ProductPurchase | null
  change: number | null
  lastUse: { on: string; field: string; crop: string | null; rate: string | null } | null
  tonnes: number
}

export function IciPrices({ isManager }: { isManager: boolean }) {
  const { retailerName } = useFarmSettings()
  const { data: products } = useJdProducts()
  const { data: purchases } = useProductPurchases()
  const { data: apps } = useProductApplications()
  const { data: cropBySeason } = useCropByFieldSeason()
  const save = useSaveProduct()
  const create = useCreateQuotedProduct()
  const [invoice, setInvoice] = useState<{ no: string; productId: string } | null>(null)
  const [blendsOpen, setBlendsOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [quoting, setQuoting] = useState(false)
  const [form, setForm] = useState({ product_id: '', on: new Date().toISOString().slice(0, 10), value: '' })

  const rows = useMemo<Row[]>(() => {
    return (products?.products ?? [])
      .filter((p) => p.category === 'fertilizer')
      .map((p) => {
        const lines = (purchases?.byProduct.get(p.id) ?? [])
          .filter((l) => l.price_per_canonical != null)
          .sort((a, b) => (b.invoice_date ?? '').localeCompare(a.invoice_date ?? ''))
        const latest = lines[0] ?? null
        const previous = latest ? (lines.find((l) => l.invoice_no !== latest.invoice_no) ?? null) : null
        const price = displayPrice(p)
        const scale = p.unit === 'kg' ? 1000 : 1
        const change =
          latest && previous
            ? (Number(latest.price_per_canonical) - Number(previous.price_per_canonical)) * scale
            : null
        const a = (apps?.byProduct.get(p.id) ?? [])
          .filter((x) => x.applied_on)
          .sort((x, y) => (y.applied_on ?? '').localeCompare(x.applied_on ?? ''))[0]
        const lastUse = a
          ? {
              on: a.applied_on as string,
              field: a.field_name ?? 'unmatched field',
              crop:
                a.field_id && a.crop_season ? (cropBySeason?.get(`${a.field_id}|${a.crop_season}`) ?? null) : null,
              rate: a.rate_value != null ? `${Number(a.rate_value).toLocaleString('en-CA', { maximumFractionDigits: 1 })} ${a.rate_unit ?? ''}`.trim() : null,
            }
          : null
        // Tonnes ever bought, for the blends table: quantity is in the pack
        // unit, which for a blend is the metric tonne.
        const tonnes = lines
          .filter((l) => /metric|tonne/i.test(l.pack_unit ?? ''))
          .reduce((s, l) => s + Number(l.quantity ?? 0), 0)
        return { product: p, price, latest, previous, change, lastUse, tonnes }
      })
  }, [products, purchases, apps, cropBySeason])

  // Only what has a price from ICI or from a typed quote. A product Deere
  // knows but ICI has never invoiced has nothing to say here until it is
  // quoted — it is still offered in the quote form.
  const isQuote = (p: JdProduct) => /^quote/i.test(p.price_source ?? '')
  const straights = useMemo(
    () =>
      rows
        .filter((r) => fertKind(r.product.name) !== 'blend' && (r.latest || isQuote(r.product)))
        .sort((a, b) => Number(!!b.latest) - Number(!!a.latest) || a.product.name.localeCompare(b.product.name)),
    [rows],
  )
  const quotable = useMemo(
    () => rows.filter((r) => fertKind(r.product.name) !== 'blend').sort((a, b) => a.product.name.localeCompare(b.product.name)),
    [rows],
  )
  const blends = useMemo(
    () =>
      rows
        .filter((r) => fertKind(r.product.name) === 'blend' && r.latest)
        .sort((a, b) => (b.latest!.invoice_date ?? '').localeCompare(a.latest!.invoice_date ?? '')),
    [rows],
  )

  // The straights' invoice history as a chart, in $/tonne, so urea this
  // spring sits against urea every other spring.
  const history = useMemo(() => {
    const series: MarketSeries[] = []
    const points: { series_id: string; observed_on: string; value: number; low: null; high: null }[] = []
    for (const r of straights) {
      if (r.product.unit !== 'kg') continue
      const lines = purchases?.byProduct.get(r.product.id) ?? []
      const seen = new Set<string>()
      for (const l of lines) {
        if (l.price_per_canonical == null || !l.invoice_date || seen.has(l.invoice_date)) continue
        seen.add(l.invoice_date)
        points.push({ series_id: r.product.id, observed_on: l.invoice_date, value: Number(l.price_per_canonical) * 1000, low: null, high: null })
      }
      if (seen.size)
        series.push({
          id: r.product.id,
          code: `ici.${r.product.id}`,
          kind: 'fertilizer',
          name: fertInfo(r.product.name).title,
          commodity: fertInfo(r.product.name).title,
          unit: '$/tonne',
          region: retailerName,
          source: 'ici',
          crop_id: null,
          derived: false,
          archived: false,
          notes: null,
        })
    }
    return { series, points: points.sort((a, b) => a.observed_on.localeCompare(b.observed_on)) }
  }, [straights, purchases, retailerName])

  // Straight fertilizers the list has never had — ammonium sulphate, before
  // ICI ever invoiced it. Quotable all the same; saving makes the product.
  const newStraights = useMemo(
    () => STRAIGHTS.filter((st) => !quotable.some((r) => straightKeyOf(r.product.name) === st.key)),
    [quotable],
  )
  const newStraight = form.product_id.startsWith('new:') ? (STRAIGHTS.find((st) => `new:${st.key}` === form.product_id) ?? null) : null
  const quoteTarget: { id: string; unit: string } | null =
    (products?.products ?? []).find((p) => p.id === form.product_id) ??
    (newStraight ? { id: form.product_id, unit: newStraight.densityKgL ? 'L' : 'kg' } : null)

  return (
    <>
      <section className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
              <TrendingUp className="h-4 w-4" /> Latest from {retailerName}
            </h3>
            <HelpNote className="mt-0.5 text-xs" summary="Newest invoiced price for each product. Dry per tonne, liquid per litre." title="About these prices">
              Every fertilizer this farm has bought from {retailerName}, at the newest invoiced price. Dry
              products per tonne, liquids per litre. A quote you type sits here too until the next
              invoice replaces it.
            </HelpNote>
          </div>
          {isManager && (
            <button
              type="button"
              onClick={() => setQuoting(true)}
              className="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <Plus className="h-3.5 w-3.5" /> Record a quote
            </button>
          )}
        </div>

        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {straights.map((r) => {
            const info = fertInfo(r.product.name)
            const quoted = isQuote(r.product)
            return (
              <div key={r.product.id} className="rounded-md bg-gray-50 px-2.5 py-2">
                <p className="flex items-center gap-1 text-[11px] font-medium text-gray-600">
                  {/* The invoice's own name for it, less the "Tonne": two UAN
                      products at different prices must not both read "UAN". */}
                  <span className="truncate" title={r.product.name}>
                    {r.product.name.replace(/^tonne\s+/i, '')}
                  </span>
                  <InfoPopover title={info.title} hover width={420}>
                    <p>{info.what}</p>
                    <p>
                      <b>Used for:</b> {info.usedFor}
                    </p>
                    <p>
                      <b>Last used here:</b>{' '}
                      {r.lastUse ? (
                        <>
                          {r.lastUse.on} on {r.lastUse.field}
                          {r.lastUse.crop ? ` (${r.lastUse.crop})` : ''}
                          {r.lastUse.rate ? ` at ${r.lastUse.rate}` : ''}.
                        </>
                      ) : (
                        'no application on record from Deere.'
                      )}
                    </p>
                    {r.product.name !== info.title && (
                      <p className="text-gray-400">On the invoice as “{r.product.name}”.</p>
                    )}
                  </InfoPopover>
                </p>
                <p className="text-sm font-bold tabular-nums text-gray-900">
                  {money(r.price.value, r.price.perTonne ? 0 : 2)}
                  <span className="ml-0.5 text-[10px] font-normal text-gray-400">{r.price.unit}</span>
                </p>
                {r.change != null && (
                  // Rising is bad news here, the reverse of the crop tabs.
                  <p className={cn('text-[10px]', r.change > 0 ? 'text-red-700' : r.change < 0 ? 'text-green-700' : 'text-gray-500')}>
                    {r.change > 0 ? '▲' : r.change < 0 ? '▼' : '—'} {money(Math.abs(r.change), r.price.perTonne ? 0 : 2)}
                    {r.price.unit} since {r.previous?.invoice_date}
                  </p>
                )}
                <p className="flex flex-wrap items-center gap-x-2 text-[10px] text-gray-400">
                  {r.product.price_updated_on ? (
                    <span>
                      {r.product.price_updated_on}
                      {quoted ? ' · quote' : r.latest ? '' : r.product.price_source ? ` · ${r.product.price_source}` : ''}
                    </span>
                  ) : (
                    <span>no price yet — quote it below</span>
                  )}
                  {r.latest && !quoted && (
                    <button
                      type="button"
                      onClick={() => setInvoice({ no: r.latest!.invoice_no ?? '', productId: r.product.id })}
                      className="inline-flex items-center gap-0.5 font-medium text-brand-700 hover:underline"
                    >
                      <FileText className="h-3 w-3" /> {r.latest.invoice_no}
                    </button>
                  )}
                </p>
              </div>
            )
          })}
        </div>

        {/* The invoice history, folded: it is for the once-a-year question
            "what did urea run the last few springs", not for every visit. */}
        {history.points.length > 1 && (
          <div className="mt-3 rounded-md border border-gray-200">
            <button
              type="button"
              onClick={() => setHistoryOpen((o) => !o)}
              aria-expanded={historyOpen}
              className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm font-medium text-gray-800"
            >
              <ChevronRight className={cn('h-4 w-4 text-gray-400 transition-transform', historyOpen && 'rotate-90')} />
              What {retailerName} has charged over the years
              <span className="font-normal text-gray-500">· $/tonne, one point per invoice, for the straight products</span>
            </button>
            {historyOpen && (
              <div className="border-t border-gray-100 px-2.5 pb-2">
                <PriceChart series={history.series} points={history.points} unit="$/tonne" height={260} />
              </div>
            )}
          </div>
        )}

        {/* Blends, folded: thirty recipes are a wall, and the question they
            answer is "what did blend run that spring". */}
        {blends.length > 0 && (
          <div className="mt-3 rounded-md border border-gray-200">
            <button
              type="button"
              onClick={() => setBlendsOpen((o) => !o)}
              aria-expanded={blendsOpen}
              className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm font-medium text-gray-800"
            >
              <ChevronRight className={cn('h-4 w-4 text-gray-400 transition-transform', blendsOpen && 'rotate-90')} />
              Blends
              <span className="font-normal text-gray-500">
                · {blends.length} recipes · newest {blends[0].latest?.invoice_date}, {money(blends[0].price.value)}/t
              </span>
            </button>
            {blendsOpen && (
              <div className="overflow-x-auto border-t border-gray-100">
                <table className="w-full text-xs">
                  <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
                    <tr>
                      <th className="px-2 py-1 font-medium">Blend</th>
                      <th className="px-2 py-1 text-right font-medium">$/tonne</th>
                      <th className="px-2 py-1 text-right font-medium">Tonnes</th>
                      <th className="px-2 py-1 font-medium">Invoiced</th>
                      <th className="px-2 py-1 font-medium">Last used</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {blends.map((r) => {
                      const info = fertInfo(r.product.name)
                      return (
                        <tr key={r.product.id}>
                          <td className="px-2 py-1 text-gray-800">
                            <span className="inline-flex items-center gap-1">
                              {info.title}
                              <InfoPopover title={info.title} hover width={400}>
                                <p>{info.what}</p>
                                <p>
                                  <b>Used for:</b> {info.usedFor}
                                </p>
                                <p>
                                  <b>Last used here:</b>{' '}
                                  {r.lastUse
                                    ? `${r.lastUse.on} on ${r.lastUse.field}${r.lastUse.crop ? ` (${r.lastUse.crop})` : ''}.`
                                    : 'no application on record from Deere.'}
                                </p>
                              </InfoPopover>
                            </span>
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums text-gray-900">{money(r.price.value)}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-gray-600">
                            {r.tonnes ? r.tonnes.toLocaleString('en-CA', { maximumFractionDigits: 1 }) : '—'}
                          </td>
                          <td className="px-2 py-1 text-gray-600">
                            {r.latest?.invoice_date}{' '}
                            <button
                              type="button"
                              onClick={() => setInvoice({ no: r.latest!.invoice_no ?? '', productId: r.product.id })}
                              className="inline-flex items-center gap-0.5 font-medium text-brand-700 hover:underline"
                            >
                              <FileText className="h-3 w-3" /> {r.latest?.invoice_no}
                            </button>
                          </td>
                          <td className="px-2 py-1 text-gray-600">
                            {r.lastUse ? `${r.lastUse.on} · ${r.lastUse.field}` : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      {/* A quote, for the products between invoices. Sits on the product
          itself, so the field costs use it until an invoice replaces it. */}
      {isManager && quoting && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onClick={() => setQuoting(false)}
        >
        <section className="w-full max-w-lg rounded-lg border border-gray-200 bg-white p-3 shadow-xl" onClick={(e) => e.stopPropagation()}>
          <h3 className="text-sm font-semibold text-gray-800">Record a quote</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            What {retailerName} or anyone else has quoted for a product this farm buys. It becomes that
            product’s price until the next invoice, and the card above says “quote” while it is.
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="text-[11px] font-medium text-gray-500">
              Product
              <Select
                value={form.product_id}
                onChange={(v) => setForm((f) => ({ ...f, product_id: v }))}
                ariaLabel="Product"
                size="sm"
                className="mt-0.5 w-56"
                placeholder="Pick a product…"
                options={[
                  ...quotable.map((r) => ({ value: r.product.id, label: r.product.name.replace(/^tonne\s+/i, '') })),
                  ...newStraights.map((st) => ({ value: `new:${st.key}`, label: `${st.label} (not on the list yet)` })),
                ]}
              />
            </label>
            <label className="text-[11px] font-medium text-gray-500">
              Date
              <DateField
                value={form.on}
                onChange={(v) => setForm((f) => ({ ...f, on: v }))}
                className="mt-0.5 block rounded-md border border-gray-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-[11px] font-medium text-gray-500">
              {quoteTarget?.unit === 'L' ? '$/litre' : '$/tonne'}
              <input
                type="number"
                inputMode="decimal"
                value={form.value}
                onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                className="mt-0.5 block w-28 rounded-md border border-gray-300 px-2 py-1 text-right text-sm tabular-nums"
              />
            </label>
            <button
              onClick={() => {
                const value = Number(form.value)
                if (!quoteTarget || !Number.isFinite(value) || value <= 0) return
                if (newStraight) {
                  create.mutate(
                    {
                      name: newStraight.densityKgL ? newStraight.label : `Tonne ${newStraight.label}`,
                      unit: newStraight.densityKgL ? 'L' : 'kg',
                      price_per_unit: newStraight.densityKgL ? value : value / 1000,
                      on: form.on,
                    },
                    {
                      onSuccess: () => {
                        setForm((f) => ({ ...f, value: '', product_id: '' }))
                        setQuoting(false)
                      },
                    },
                  )
                  return
                }
                save.mutate(
                  {
                    id: quoteTarget.id,
                    price_per_unit: quoteTarget.unit === 'kg' ? value / 1000 : value,
                    price_updated_on: form.on,
                    price_source: `Quote ${form.on}`,
                  },
                  {
                    onSuccess: () => {
                      setForm((f) => ({ ...f, value: '' }))
                      setQuoting(false)
                    },
                  },
                )
              }}
              disabled={!quoteTarget || !form.value || save.isPending || create.isPending}
              className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
            <button
              type="button"
              onClick={() => setQuoting(false)}
              className="rounded-md px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
          {save.isError && <p className="mt-1.5 text-[11px] text-red-700">{(save.error as Error).message}</p>}
          {create.isError && <p className="mt-1.5 text-[11px] text-red-700">{(create.error as Error).message}</p>}
        </section>
        </div>
      )}

      {invoice && (
        <InvoiceViewer invoiceNo={invoice.no} highlightProductId={invoice.productId} onClose={() => setInvoice(null)} />
      )}
    </>
  )
}
