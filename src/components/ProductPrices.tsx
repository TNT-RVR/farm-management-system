import { Fragment, useMemo, useState } from 'react'
import { useRecropRules } from '@/lib/recrop'
import { ArrowDown, ArrowUp, ChevronRight, FileText, Plus, Search, ShieldAlert } from 'lucide-react'
import {
  productTypeLabel,
  useAddProduct,
  useDeleteProduct,
  useCropByFieldSeason,
  useJdProducts,
  useLinkAlias,
  useProductApplications,
  useProductPurchases,
  useRegistrationTypes,
  useSaveProduct,
  type JdProduct,
  type ProductApplication,
} from '@/lib/products'
import { fmtMoney } from '@/lib/applied'
import {
  compareRows,
  defaultSort,
  groupProducts,
  type SortDir,
  type SortKey,
  type SortableRow,
} from '@/lib/product-groups'
import { openChemicalLabel } from '@/lib/chemicals'
import { UnpricedMatches } from '@/components/UnpricedMatches'
import { InvoiceViewer } from '@/components/InvoiceViewer'
import { RegistrationPicker } from '@/components/RegistrationPicker'
import { MergeProductDialog } from '@/components/MergeProductDialog'
import { ProductSheetCell } from '@/components/ProductSheetCell'
import { ManualUseEditor } from '@/components/ManualUseEditor'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { handAddedProduct } from '@/lib/product-hand'
import { carryover, type CropKey, type RecropRule } from '@/lib/rotation-engine'

/**
 * The price book behind every input cost in the app.
 *
 * Product names are typed by hand into Operations Center, so the same jug arrives
 * spelt several ways. Case and punctuation differences were folded automatically
 * on import; anything beyond that ("Merge" vs "Merge Adjuvant") is a judgement
 * about whether two names are the same product, which only you can make.
 */
/** A price older than a season is worth a second look before costing with it. */
const STALE_DAYS = 400

function isStale(iso: string): boolean {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  return (Date.now() - d.getTime()) / 86_400_000 > STALE_DAYS
}

/** Everything one row needs, gathered once so sorting and rendering agree. */
type Row = SortableRow & {
  product: JdProduct
  aliases: string[]
  applications: ProductApplication[]
  fields: string[]
  /** Crops it has actually gone on, from the crop plans behind the applications. */
  crops: string[]
  /** Herbicide, fungicide… from the registry, or adjuvant / fertiliser from the note. */
  type: string | null
  /** Newest invoice this product appears on, for the View button. */
  invoiceNo: string | null
}

const COLUMNS: { key: SortKey; label: string; align?: 'right' }[] = [
  { key: 'name', label: 'Product' },
  { key: 'unit', label: 'Unit' },
  { key: 'price', label: 'Price', align: 'right' },
  { key: 'priced_on', label: 'Last priced' },
  { key: 'fields', label: 'Applied on' },
  { key: 'applied', label: 'Last applied' },
]

/**
 * The pricing table, for one kind of product.
 *
 * Chemicals and fertiliser are priced identically — per litre or per kilogram,
 * off the most recent invoice — and read in different places. One component,
 * filtered, rather than two that drift apart.
 */
export function ProductPrices({
  category = 'chemical',
}: { category?: 'chemical' | 'fertilizer' } = {}) {
  const { data, isLoading } = useJdProducts()
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const { data: apps } = useProductApplications()
  const { data: purchases } = useProductPurchases()
  const { data: cropBySeason } = useCropByFieldSeason()
  const { data: regTypes } = useRegistrationTypes(
    (data?.products ?? []).map((p) => p.pmra_registration ?? '').filter(Boolean),
  )
  const { data: recrop } = useRecropRules(category === 'chemical')
  const saveProduct = useSaveProduct()
  const linkAlias = useLinkAlias()
  // Sam, 7 Oct 2026: a product can be typed in by hand, and a hand-added one deleted.
  const addProduct = useAddProduct()
  const deleteProduct = useDeleteProduct()
  const [adding, setAdding] = useState<{ name: string; unit: 'L' | 'kg'; price: string } | null>(null)
  // Added this visit: shown even while never-applied products are hidden, or it would vanish on Save.
  const [justAdded, setJustAdded] = useState<Set<string>>(() => new Set())
  const [q, setQ] = useState('')
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>(null)
  // Blends are only worth folding on the fertiliser list; chemicals are not a
  // family. On by default there, and off with one click when you want the lot.
  const [grouped, setGrouped] = useState(category === 'fertilizer')
  // Products that have never been sprayed — an invoice line from years back,
  // a Deere spelling nobody used — are noise when looking a price up. Hidden
  // by default, one tick to see the lot; the choice sticks per browser.
  const HIDE_KEY = `prices_hideNeverApplied_${category}`
  const [hideNeverApplied, setHideNeverApplied] = useState(() => {
    try {
      return localStorage.getItem(HIDE_KEY) !== '0'
    } catch {
      return true
    }
  })
  const toggleHide = (on: boolean) => {
    setHideNeverApplied(on)
    try {
      localStorage.setItem(HIDE_KEY, on ? '1' : '0')
    } catch {
      /* private window */
    }
  }
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [invoice, setInvoice] = useState<{ no: string; productId: string } | null>(null)
  const [linking, setLinking] = useState<JdProduct | null>(null)
  // The row being folded into another product.
  const [merging, setMerging] = useState<JdProduct | null>(null)
  // The row whose last-sprayed date and crops are being typed in.
  const [editingUse, setEditingUse] = useState<JdProduct | null>(null)

  const rows = useMemo<Row[]>(() => {
    if (!data) return []
    const aliasesFor = new Map<string, string[]>()
    for (const a of data.aliases) {
      if (!a.product_id) continue
      const list = aliasesFor.get(a.product_id) ?? []
      list.push(a.deere_name)
      aliasesFor.set(a.product_id, list)
    }
    const needle = q.trim().toLowerCase()

    const built = data.products
      // Anything without a category predates the split and is a chemical:
      // the list was built from Deere spray applications.
      .filter((p) => (p.category ?? 'chemical') === category)
      .map((p): Row => {
        const applications = apps?.byProduct.get(p.id) ?? []
        // Named fields only. An application whose field Deere never matched
        // still counts as an application, but it cannot be listed as a place.
        const fields = [...new Set(applications.map((a) => a.field_name).filter(Boolean))].sort() as string[]
        const dates = applications.map((a) => a.applied_on).filter(Boolean) as string[]
        // Deere's record plus what a person has added by hand; the newer
        // date wins and the crops are added together.
        const crops = [
          ...new Set([
            ...(applications
              .map((a) =>
                a.field_id && a.crop_season ? cropBySeason?.get(`${a.field_id}|${a.crop_season}`) : null,
              )
              .filter(Boolean) as string[]),
            ...(p.manual_crops ?? []),
          ]),
        ].sort()
        return {
          product: p,
          aliases: aliasesFor.get(p.id) ?? [],
          applications,
          fields,
          crops,
          type: productTypeLabel(p.pmra_registration ? regTypes?.get(p.pmra_registration) : null, p.label_note),
          invoiceNo: purchases?.byProduct.get(p.id)?.[0]?.invoice_no ?? null,
          name: p.name,
          unit: p.unit,
          price: p.price_per_unit,
          pricedOn: p.price_updated_on,
          lastApplied: [...dates, ...(p.manual_last_applied ? [p.manual_last_applied] : [])].reduce<string | null>((a, b) => (a && a > b ? a : b), null),
          fieldCount: fields.length,
        }
      })
    // Priced first until a column is chosen: the list is read to look a price
    // up, and a row without one has nothing to say.
    const filtered = built.filter(
      (r) =>
        (!hideNeverApplied || r.lastApplied != null || justAdded.has(r.product.id)) &&
        (!needle ||
          r.name.toLowerCase().includes(needle) ||
          r.aliases.some((a) => a.toLowerCase().includes(needle)) ||
          r.fields.some((f) => f.toLowerCase().includes(needle))),
    )
    return sort
      ? [...filtered].sort((a, b) => compareRows(a, b, sort.key, sort.dir))
      : defaultSort(filtered)
  }, [data, apps, purchases, q, category, sort, hideNeverApplied, cropBySeason, regTypes, justAdded])

  const neverApplied = useMemo(
    () =>
      (data?.products ?? []).filter(
        (p) => (p.category ?? 'chemical') === category && !apps?.byProduct.get(p.id)?.length,
      ).length,
    [data, apps, category],
  )

  const sections = useMemo(() => groupProducts(rows, grouped), [rows, grouped])

  const mine = (data?.products ?? []).filter((p) => (p.category ?? 'chemical') === category)
  const priced = mine.filter((p) => p.price_per_unit != null).length
  const total = mine.length

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))

  /**
   * Open the approved label for a registration.
   *
   * The tab is opened FIRST, empty, and pointed at the PDF once the current
   * document id comes back. Opening it after the await is a popup the browser
   * blocks, because by then the click is no longer what caused it.
   *
   * WITHOUT `noopener`, which matters: passing it makes window.open return
   * null by definition — the whole point is that the opener cannot reach the
   * new window — so the handle needed to redirect the blank tab never arrives.
   * The first version passed it, fell through to its own fallback, and
   * navigated the price list away to the PDF while leaving an empty tab
   * behind. The opener reference is severed on the new window instead, which
   * gets the same protection and keeps the handle.
   *
   * Any failure lands on Health Canada's registry search for that number — a
   * worse link, but a real one, and better than a dead icon on the page
   * somebody opened to check a precaution.
   */
  const openLabel = openChemicalLabel

  const commit = (p: JdProduct) => {
    const raw = draft[p.id]
    if (raw === undefined) return
    const trimmed = raw.trim()
    // An empty box clears the price back to "unknown" rather than setting zero,
    // which would read as free on every field the product touched.
    const value = trimmed === '' ? null : Number(trimmed)
    if (value != null && (!Number.isFinite(value) || value < 0)) return
    if (value !== p.price_per_unit) saveProduct.mutate({ id: p.id, price_per_unit: value })
    setDraft((d) => {
      const next = { ...d }
      delete next[p.id]
      return next
    })
  }

  if (isLoading) return <p className="p-4 text-sm text-gray-500 md:p-6">Loading…</p>

  // The sortable columns, plus Type, Crops, Invoice, the Deere aliases, and Label on chemicals.
  const colSpan = COLUMNS.length + 4 + (category === 'chemical' ? 2 : 0)

  const renderRow = (r: Row) => {
    const p = r.product
    const isOpen = open[p.id]
    return (
      <Fragment key={p.id}>
        <tr className={cn(p.price_per_unit == null && 'bg-amber-50/40')}>
          <td className="px-3 py-2 font-medium text-gray-800">
            {p.name}
            {/* Same jug, spelt again by an invoice or an operator. This is the
                judgement the importer will not make; one click here makes it. */}
            <button
              type="button"
              onClick={() => setMerging(p)}
              title="This is a second spelling of another product — fold it in"
              className="ml-2 text-[11px] font-normal text-gray-400 underline decoration-dotted hover:text-gray-800"
            >
              same as…
            </button>
            {/* Only once the applications and invoices have loaded, or every product would look unused. */}
            {isManager &&
              apps &&
              purchases &&
              handAddedProduct({
                aliases: r.aliases.length,
                purchases: purchases?.byProduct.get(p.id)?.length ?? 0,
                applications: r.applications.length,
              }) && (
                <button
                  type="button"
                  disabled={deleteProduct.isPending}
                  onClick={() => {
                    if (window.confirm(`Delete ${p.name} from the price list? It was added by hand: no Deere record or invoice uses it.`)) deleteProduct.mutate(p.id)
                  }}
                  title="Added by hand and used by nothing — remove it"
                  className="ml-2 text-[11px] font-normal text-red-400 underline decoration-dotted hover:text-red-700"
                >
                  delete
                </button>
              )}
          </td>
          <td className="px-3 py-2 text-xs text-gray-600">{r.type ?? <span className="text-gray-300">—</span>}</td>
          <td className="px-3 py-2">
            <select
              value={p.unit}
              onChange={(e) => saveProduct.mutate({ id: p.id, unit: e.target.value as 'L' | 'kg' })}
              className="rounded border border-gray-300 px-1.5 py-1 text-xs"
            >
              <option value="L">$ / L</option>
              <option value="kg">$ / kg</option>
            </select>
          </td>
          <td className="px-3 py-2 text-right">
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={draft[p.id] ?? p.price_per_unit ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, [p.id]: e.target.value }))}
              onBlur={() => commit(p)}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              placeholder="—"
              className="w-24 rounded border border-gray-300 px-2 py-1 text-right text-sm tabular-nums"
            />
          </td>
          {/* Where the price came from, and when. A price with no date is
              one somebody typed, and it has been ageing quietly ever
              since while the field costs treated it as current. */}
          <td className="px-3 py-2 text-xs">
            {p.price_updated_on ? (
              <span className={cn(isStale(p.price_updated_on) && 'text-amber-700')}>
                {p.price_updated_on}
                {p.price_source && (
                  <span className="block text-[10px] text-gray-400">{p.price_source}</span>
                )}
              </span>
            ) : p.price_per_unit != null ? (
              <span className="text-gray-400">entered by hand</span>
            ) : (
              <span className="text-gray-300">—</span>
            )}
          </td>
          {/* Which fields it went on. Two named, then a count — the full list
              is one click away and a dozen field names in a cell is a wall. */}
          <td className="px-3 py-2 text-xs">
            {r.fields.length === 0 ? (
              <span className="text-gray-300">—</span>
            ) : (
              <button
                type="button"
                onClick={() => setOpen((o) => ({ ...o, [p.id]: !o[p.id] }))}
                className="inline-flex items-start gap-1 text-left text-gray-700 hover:text-gray-900"
              >
                <ChevronRight
                  className={cn('mt-0.5 h-3 w-3 shrink-0 text-gray-400 transition-transform', isOpen && 'rotate-90')}
                />
                <span>
                  {r.fields.slice(0, 2).join(', ')}
                  {r.fields.length > 2 && (
                    <span className="text-gray-400"> +{r.fields.length - 2} more</span>
                  )}
                </span>
              </button>
            )}
          </td>
          {/* The crops it has actually gone on — not the label's list. */}
          <td className="px-3 py-2 text-xs text-gray-700">
            {r.crops.length === 0 ? <span className="text-gray-300">—</span> : r.crops.join(', ')}
          </td>
          {category === 'chemical' && (
            <td className="px-3 py-2 text-xs">
              {(() => {
                const next = notNextYear(p.pmra_registration, recrop)
                if (next == null) return <span className="text-gray-300" title="The label's re-cropping section has not been read yet">—</span>
                if (!next.length) return <span className="text-green-700">none</span>
                return (
                  <span className="text-red-700" title={next.map((n) => `${n.crop}: ${n.why}`).join(' · ')}>
                    {next.map((n) => n.crop).join(', ')}
                  </span>
                )
              })()}
            </td>
          )}
          <td className="px-3 py-2 text-xs">
            {r.lastApplied ? (
              <span>
                {r.lastApplied}
                {p.manual_last_applied === r.lastApplied && (
                  <span className="ml-1 text-[10px] text-gray-400" title="Typed in, not from Deere">
                    typed
                  </span>
                )}
                <span className="block text-[10px] text-gray-400">
                  {r.applications.length} application{r.applications.length === 1 ? '' : 's'}
                  {isManager && (
                    <button
                      type="button"
                      onClick={() => setEditingUse(p)}
                      className="ml-1 underline decoration-dotted hover:text-gray-800"
                    >
                      edit
                    </button>
                  )}
                </span>
              </span>
            ) : isManager ? (
              <button
                type="button"
                onClick={() => setEditingUse(p)}
                className="text-gray-400 underline decoration-dotted hover:text-gray-800"
              >
                add when &amp; what
              </button>
            ) : (
              <span className="text-gray-300">—</span>
            )}
          </td>
          {category === 'chemical' && (
            <td className="px-3 py-2 text-xs">
              {p.pmra_registration ? (
                <span className="flex flex-col gap-0.5">
                  {/* The approved label, which in Canada IS the safety
                      document — precautions, protective equipment, first aid
                      and re-entry are all on it. Straight off Health Canada's
                      registry so it is always the current issue, rather than a
                      copy of ours that quietly goes out of date.

                      Where the label has not been fetched yet there is still
                      the registry search page, which is a worse link but a
                      real one; a dead icon on a page somebody opened to check
                      a precaution is the wrong failure. */}
                  <button
                    type="button"
                    onClick={() => openLabel(p.pmra_registration as string)}
                    title="Open the approved label — precautions, protective equipment, first aid, re-entry"
                    className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"
                  >
                    <ShieldAlert className="h-3.5 w-3.5" />
                    Label
                  </button>
                  <button
                    type="button"
                    onClick={() => setLinking(p)}
                    title="Change which registered product this is"
                    className="text-left tabular-nums text-gray-500 underline decoration-dotted hover:text-gray-900"
                  >
                    {p.pmra_registration}
                  </button>
                </span>
              ) : (
                // No registration: the reason why, the supplier sheet if there
                // is one, or the amber button until somebody has looked.
                <ProductSheetCell product={p} canEdit={isManager} onLink={() => setLinking(p)} />
              )}
            </td>
          )}
          <td className="px-3 py-2 text-xs">
            {r.invoiceNo ? (
              <button
                type="button"
                onClick={() => setInvoice({ no: r.invoiceNo as string, productId: p.id })}
                className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                <FileText className="h-3 w-3" />
                View
              </button>
            ) : (
              <span className="text-gray-300">—</span>
            )}
          </td>
          <td className="px-3 py-2 text-xs text-gray-500">
            {r.aliases.map((a) => (
              <span key={a} className="mr-1 inline-flex items-center gap-1">
                <span>{a}</span>
                {r.aliases.length > 1 && (
                  <button
                    type="button"
                    title="Not this product — split it out"
                    onClick={() => linkAlias.mutate({ deere_name: a, product_id: null })}
                    className="text-gray-300 hover:text-red-600"
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          </td>
        </tr>

        {/* The record of what went where and when, which is the whole reason
            for keeping application history against a price. */}
        {isOpen && (
          <tr className="bg-gray-50/70">
            <td colSpan={colSpan} className="px-3 py-2">
              <table className="w-full text-xs">
                <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
                  <tr>
                    <th className="py-1 pr-4 font-medium">Date</th>
                    <th className="py-1 pr-4 font-medium">Field</th>
                    <th className="py-1 pr-4 font-medium">Rate</th>
                    <th className="py-1 pr-4 font-medium">Season</th>
                    <th className="py-1 font-medium">Applied as</th>
                  </tr>
                </thead>
                <tbody>
                  {r.applications.map((a) => (
                    <tr key={`${a.operation_id}-${a.applied_name}-${a.field_id}`}>
                      <td className="py-1 pr-4 tabular-nums text-gray-700">{a.applied_on ?? '—'}</td>
                      <td className="py-1 pr-4 text-gray-700">{a.field_name ?? 'unmatched field'}</td>
                      <td className="py-1 pr-4 tabular-nums text-gray-600">
                        {a.rate_value == null
                          ? '—'
                          : `${Number(a.rate_value).toLocaleString('en-CA', { maximumFractionDigits: 3 })} ${a.rate_unit ?? ''}`}
                      </td>
                      <td className="py-1 pr-4 text-gray-500">{a.crop_season ?? '—'}</td>
                      <td className="py-1 text-gray-500">
                        {a.applied_name}
                        {a.from_mix && a.mix_name && (
                          <span className="text-gray-400"> · in {a.mix_name}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </td>
          </tr>
        )}
      </Fragment>
    )
  }

  return (
    <div className="p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Product prices</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {priced} of {total} products priced. Prices are per litre or per kilogram, and drive the
            input costs on every field.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <label
            className="flex items-center gap-1.5 text-xs text-gray-600"
            title="Products with no application on record — an old invoice line, a spelling nobody used"
          >
            <input
              type="checkbox"
              checked={hideNeverApplied}
              onChange={(e) => toggleHide(e.target.checked)}
              className="rounded border-gray-300"
            />
            Hide never applied{neverApplied > 0 && ` (${neverApplied})`}
          </label>
          {category === 'fertilizer' && (
            <label className="flex items-center gap-1.5 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={grouped}
                onChange={(e) => setGrouped(e.target.checked)}
                className="rounded border-gray-300"
              />
              Group blends by year
            </label>
          )}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search products or fields"
              className="rounded-md border border-gray-300 py-1.5 pl-8 pr-2 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Above the table, because it is a thing to deal with rather than a
          thing to look up, and the rows it is about are scattered through a
          hundred-and-something products. */}
      <UnpricedMatches products={data?.products ?? []} category={category} />

      {isManager && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          {adding ? (
            <>
              <input
                value={adding.name}
                onChange={(e) => setAdding({ ...adding, name: e.target.value })}
                placeholder={category === 'fertilizer' ? 'Product, e.g. 12-51-0' : 'Product name'}
                aria-label="New product name"
                className="w-56 rounded border border-gray-300 px-2 py-1 text-sm"
                autoFocus
              />
              <select
                value={adding.unit}
                onChange={(e) => setAdding({ ...adding, unit: e.target.value as 'L' | 'kg' })}
                aria-label="Unit"
                className="rounded border border-gray-300 px-1.5 py-1"
              >
                <option value="L">$ / L</option>
                <option value="kg">$ / kg</option>
              </select>
              <input
                value={adding.price}
                onChange={(e) => setAdding({ ...adding, price: e.target.value })}
                inputMode="decimal"
                placeholder="Price (optional)"
                aria-label="Price per unit"
                className="w-28 rounded border border-gray-300 px-2 py-1 text-right text-sm tabular-nums"
              />
              <button
                type="button"
                disabled={!adding.name.trim() || addProduct.isPending || (adding.price.trim() !== '' && !(Number(adding.price) >= 0))}
                onClick={() =>
                  addProduct.mutate(
                    {
                      name: adding.name,
                      unit: adding.unit,
                      price_per_unit: adding.price.trim() === '' ? null : Number(adding.price),
                      category,
                    },
                    {
                      onSuccess: (id) => {
                        setJustAdded((s) => new Set(s).add(id))
                        setAdding(null)
                      },
                    },
                  )
                }
                className="rounded-md bg-brand-700 px-3 py-1 font-semibold text-white disabled:opacity-50"
              >
                {addProduct.isPending ? 'Adding…' : 'Add'}
              </button>
              <button
                type="button"
                onClick={() => {
                  addProduct.reset()
                  setAdding(null)
                }}
                className="text-gray-500 underline"
              >
                cancel
              </button>
              {addProduct.error && <span className="text-red-700">{(addProduct.error as Error).message}</span>}
            </>
          ) : (
            <button
              type="button"
              onClick={() => setAdding({ name: '', unit: category === 'fertilizer' ? 'kg' : 'L', price: '' })}
              className="inline-flex items-center gap-1 font-medium text-brand-700 underline"
            >
              <Plus className="h-3.5 w-3.5" /> Add a product by hand
            </button>
          )}
          {deleteProduct.error && <span className="text-red-700">{(deleteProduct.error as Error).message}</span>}
        </div>
      )}

      <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              {COLUMNS.map((c) => (
                <Fragment key={c.key}>
                <th
                  className={cn('px-3 py-2 font-medium', c.align === 'right' && 'text-right')}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(c.key)}
                    className={cn(
                      'inline-flex items-center gap-1 hover:text-gray-900',
                      sort?.key === c.key && 'text-gray-900',
                    )}
                  >
                    {c.label}
                    {sort?.key === c.key &&
                      (sort.dir === 'asc' ? (
                        <ArrowUp className="h-3 w-3" />
                      ) : (
                        <ArrowDown className="h-3 w-3" />
                      ))}
                  </button>
                </th>
                  {c.key === 'name' && <th className="px-3 py-2 font-medium">Type</th>}
                  {c.key === 'fields' && (
                    <th className="px-3 py-2 font-medium" title="Crops it has actually been sprayed on here, not everything the label allows">
                      Crops sprayed
                    </th>
                  )}
                  {c.key === 'fields' && category === 'chemical' && (
                    <th
                      className="px-3 py-2 font-medium"
                      title="From the label: our crops that cannot be planted the spring after a June spray (or need a bioassay). Hover a cell for the label's words."
                    >
                      Can&apos;t grow next year
                    </th>
                  )}
                </Fragment>
              ))}
              {category === 'chemical' && (
                <th
                  className="px-3 py-2 font-medium"
                  title="The Health Canada registration. Without it the label cannot be read, so there is no re-entry interval."
                >
                  Label
                </th>
              )}
              <th className="px-3 py-2 font-medium">Invoice</th>
              <th className="px-3 py-2 font-medium">Recorded in Deere as</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sections.map((s) =>
              s.kind === 'row' ? (
                renderRow(s.item)
              ) : (
                <Fragment key={s.key}>
                  <tr className="bg-gray-100/70">
                    <td colSpan={colSpan} className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setOpen((o) => ({ ...o, [s.key]: !o[s.key] }))}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-800"
                      >
                        <ChevronRight
                          className={cn('h-3.5 w-3.5 text-gray-400 transition-transform', open[s.key] && 'rotate-90')}
                        />
                        {s.label}
                        <span className="font-normal text-gray-500">
                          · {s.items.length} blends
                          {priceRange(s.items)}
                        </span>
                      </button>
                    </td>
                  </tr>
                  {open[s.key] && s.items.map(renderRow)}
                </Fragment>
              ),
            )}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-gray-500">
            {q ? `No products match “${q}”.` : 'Nothing to show.'}
            {hideNeverApplied && neverApplied > 0 && (
              <>
                {' '}
                <button
                  type="button"
                  onClick={() => toggleHide(false)}
                  className="text-brand-700 underline"
                >
                  Show the {neverApplied} never applied
                </button>
              </>
            )}
          </p>
        )}
      </div>

      <p className="mt-3 text-xs text-gray-500">
        Products appear here automatically as they turn up in synced field work. A price of{' '}
        {fmtMoney(0)} is a real price; leave the box empty for “not known yet” so the field pages
        show a blank instead of a free pass.
      </p>

      {editingUse && <ManualUseEditor product={editingUse} onClose={() => setEditingUse(null)} />}

      {merging && data && (
        <MergeProductDialog
          duplicate={merging}
          products={data.products}
          onClose={() => setMerging(null)}
        />
      )}

      {linking && (
        <RegistrationPicker
          productId={linking.id}
          productName={linking.name}
          current={linking.pmra_registration}
          onClose={() => setLinking(null)}
        />
      )}

      {invoice && (
        <InvoiceViewer
          invoiceNo={invoice.no}
          highlightProductId={invoice.productId}
          onClose={() => setInvoice(null)}
        />
      )}
    </div>
  )
}

/** "· $0.89–$1.36/kg" for a collapsed group, so it says something folded up. */
function priceRange(items: Row[]): string {
  const prices = items.map((i) => i.price).filter((p): p is number => p != null)
  if (!prices.length) return ''
  const lo = Math.min(...prices)
  const hi = Math.max(...prices)
  const unit = items[0]?.unit ?? ''
  return lo === hi
    ? ` · ${fmtMoney(lo)}/${unit}`
    : ` · ${fmtMoney(lo)}–${fmtMoney(hi)}/${unit}`
}

/** Every product's following-crop rules, read off the labels. */
const NEXT_YEAR_CROPS: { key: CropKey; name: string }[] = [
  { key: 'canola', name: 'canola' },
  { key: 'corn', name: 'corn' },
  { key: 'potato', name: 'potatoes' },
  { key: 'dry_bean', name: 'dry beans' },
  { key: 'wheat', name: 'wheat' },
  { key: 'durum', name: 'durum' },
  { key: 'barley', name: 'barley' },
  { key: 'oats', name: 'oats' },
  { key: 'pea', name: 'peas' },
  { key: 'alfalfa', name: 'alfalfa' },
  { key: 'carrot', name: 'carrots' },
  { key: 'spinach', name: 'spinach' },
]

/** Our crops the label rules out the spring after a mid-June spray; null when the label is unread. */
function notNextYear(reg: string | null, data: { byReg: Map<string, RecropRule[]>; read: Set<string> } | undefined) {
  if (!reg || !data || !data.read.has(reg)) return null
  const out: { crop: string; why: string }[] = []
  for (const c of NEXT_YEAR_CROPS) {
    const all = carryover(c.key, [{ product: '', registration: reg, appliedOn: '2026-06-15' }], data.byReg, '2027-05-01')
    // A named restriction outranks a catch-all bioassay.
    const hit = all.find((h) => h.block) ?? all[0]
    if (hit) out.push({ crop: hit.block ? c.name : `${c.name} (bioassay)`, why: hit.message.replace(/^ sprayed 2026-06-15: /, '') })
  }
  return out
}
