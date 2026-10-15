import { Fragment, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, Pencil, Search, Trash2 } from 'lucide-react'
import { RecordEditModal, type EditField } from '@/components/RecordEditor'
import { supabase } from '@/lib/supabase'
import { useJdProducts } from '@/lib/products'
import { useAllBoundaries, useFields } from '@/lib/queries'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { L_PER_US_GAL, currentAcres, inPacks, shedStock, type InvAdjustment, type InvOp, type InvPurchase, type StockLine } from '@/lib/chem-inventory'
import { InfoPopover } from '@/components/InfoPopover'
import { cn } from '@/lib/utils'
import { useFarmSettings } from '@/lib/farm-setup'

/** Everything the inventory needs: invoices, every Deere application, and the counts. */
function useInventoryData() {
  return useQuery({
    queryKey: ['chem-inventory'],
    queryFn: async () => {
      const [purchases, ops, adjustments] = await Promise.all([
        supabase
          .from('product_purchases')
          .select('product_id, invoice_no, invoice_date, description, amount, price_per_canonical, quantity, pack_size, pack_unit, canonical_unit')
          .eq('is_product', true)
          .not('product_id', 'is', null),
        // Duplicates are hidden by RLS, so a hand-entered copy of a job is not
        // taken out of the shed twice.
        supabase
          .from('jd_field_operations')
          .select('id, field_id, started_at, applied_area_ha, as_applied, products, sessions, cost_acres_override, not_ours')
          .eq('operation_type', 'application'),
        supabase.from('chem_stock_adjustments').select('id, product_id, kind, quantity, occurred_on, note').order('occurred_on'),
      ])
      if (purchases.error) throw purchases.error
      if (ops.error) throw ops.error
      if (adjustments.error) throw adjustments.error
      return {
        purchases: (purchases.data ?? []) as InvPurchase[],
        ops: (ops.data ?? []) as unknown as InvOp[],
        adjustments: (adjustments.data ?? []) as InvAdjustment[],
      }
    },
  })
}

/** Correct a hand count or adjustment (Sam, 7 Oct 2026). Managers only, by RLS. */
function useUpdateStockAdjustment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { id: string; kind: 'count' | 'adjust'; quantity: number; occurred_on: string; note: string | null }) => {
      const { id, ...patch } = v
      const { error } = await supabase.from('chem_stock_adjustments').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['chem-inventory'] }),
  })
}

function useDeleteStockAdjustment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('chem_stock_adjustments').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['chem-inventory'] }),
  })
}

/** The count form, in US gallons when the page is showing gallons; saved in litres either way. */
function adjFields(unit: string | null, gallons: boolean): EditField[] {
  const gal = unit === 'L' && gallons
  return [
    {
      key: 'kind',
      label: 'Kind',
      kind: 'select',
      required: true,
      options: [
        { value: 'count', label: 'Count (what was on the shelf)' },
        { value: 'adjust', label: 'Adjustment (+ or −)' },
      ],
    },
    { key: 'occurred_on', label: 'Date', kind: 'date', required: true },
    { key: 'quantity', label: `Quantity (${gal ? 'US gal' : (unit ?? '')})`, kind: 'number', required: true, scale: gal ? 1 / L_PER_US_GAL : undefined },
    { key: 'note', label: 'Note', kind: 'textarea' },
  ]
}

const qtyFmt = (v: number) => v.toLocaleString('en-CA', { maximumFractionDigits: Math.abs(v) < 10 ? 1 : 0 })

/**
 * Chemicals → Inventory. On hand = bought (ICI invoices) − sprayed (Deere) ±
 * what somebody counted or corrected, in litres, US gallons, or the packs it
 * came in.
 */
export function InventoryTab() {
  const { retailerName } = useFarmSettings()
  const { profile } = useAuth()
  const isMgr = hasManagerAccess(profile?.role)
  const { data, isLoading, error } = useInventoryData()
  const { data: book } = useJdProducts()
  const { data: fields } = useFields()
  const { data: boundaries } = useAllBoundaries()
  const [category, setCategory] = useState<'chemical' | 'fertilizer' | 'all'>('chemical')
  const [q, setQ] = useState('')
  const [onlyStock, setOnlyStock] = useState(true)
  const [gallons, setGallons] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [editAdj, setEditAdj] = useState<{ adj: InvAdjustment; line: StockLine } | null>(null)
  const updAdj = useUpdateStockAdjustment()
  const delAdj = useDeleteStockAdjustment()
  // Deere's spray records begin mid-2024 (the first full season is 2025), so
  // anything bought before then has no record of being used. The ledger
  // starts here; stock older than that is set by a count.
  const [start, setStart] = useState('2025-01-01')

  const lines = useMemo(() => {
    if (!data || !book) return []
    const acresOf = currentAcres(boundaries ?? [])
    return shedStock({
      products: book.products,
      aliases: book.aliases,
      purchases: data.purchases,
      ops: data.ops,
      adjustments: data.adjustments,
      acresOf: (fid) => (fid ? (acresOf.get(fid) ?? 0) : 0),
      fieldName: (id) => fields?.find((f) => f.id === id)?.name ?? '',
      start,
    })
  }, [data, book, fields, boundaries, start])

  const all = Array.isArray(lines) ? [] : lines.lines
  const unmatched = Array.isArray(lines) ? new Map<string, number>() : lines.unmatched
  const wholeTank = Array.isArray(lines) ? [] : lines.wholeTank
  const shown = all.filter(
    (l) =>
      (category === 'all' || l.product.category === category) &&
      (!q.trim() || l.product.name.toLowerCase().includes(q.trim().toLowerCase())) &&
      (!onlyStock || Math.abs(l.onHand) > 0.05),
  )
  // Sprayed but never on an ICI invoice: bought from somebody else, most
  // likely. Their stock is only known from a count.
  const short = shown.filter((l) => l.onHand < -0.05 && l.lastBought).length
  const elsewhere = shown.filter((l) => !l.lastBought).length

  const show = (v: number, unit: string | null) =>
    unit === 'L' && gallons ? `${qtyFmt(v / L_PER_US_GAL)} gal` : `${qtyFmt(v)} ${unit ?? ''}`

  if (isLoading) return <p className="py-8 text-center text-sm text-gray-400">Adding up the invoices and the sprayer…</p>
  if (error) return <p className="text-sm text-red-700">{(error as Error).message}</p>

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a product" className="w-48 rounded-md border border-gray-300 py-1.5 pl-8 pr-2 text-sm" />
        </div>
        <div className="flex rounded-md border border-gray-300 text-xs">
          {(['chemical', 'fertilizer', 'all'] as const).map((c) => (
            <button key={c} type="button" onClick={() => setCategory(c)} className={cn('px-2.5 py-1.5 capitalize', category === c ? 'bg-brand-700 text-white' : 'text-gray-700')}>
              {c === 'all' ? 'All' : c === 'chemical' ? 'Chemicals' : 'Fertilizer'}
            </button>
          ))}
        </div>
        <div className="flex rounded-md border border-gray-300 text-xs">
          <button type="button" onClick={() => setGallons(false)} className={cn('px-2.5 py-1.5', !gallons ? 'bg-brand-700 text-white' : 'text-gray-700')}>
            Litres
          </button>
          <button type="button" onClick={() => setGallons(true)} className={cn('px-2.5 py-1.5', gallons ? 'bg-brand-700 text-white' : 'text-gray-700')}>
            US gal
          </button>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          Counting from
          <select value={start} onChange={(e) => setStart(e.target.value)} className="rounded border border-gray-300 px-1 py-1 text-xs">
            <option value="2024-07-01">Jul 2024 (first Deere records)</option>
            <option value="2025-01-01">Jan 2025 (first full season)</option>
            <option value="2026-01-01">Jan 2026</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          <input type="checkbox" checked={onlyStock} onChange={(e) => setOnlyStock(e.target.checked)} /> Hide products at zero
        </label>
        {(short > 0 || elsewhere > 0) && (
          <span className="ml-auto text-right text-xs">
            {short > 0 && <span className="rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-800">{short} below zero — more sprayed than invoiced; count them</span>}
            {elsewhere > 0 && <span className="ml-1 rounded bg-gray-100 px-2 py-0.5 text-gray-700">{elsewhere} sprayed but on no {retailerName} invoice — bought elsewhere?</span>}
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-[10px] uppercase tracking-wide text-gray-400">
            <tr>
              <th className="px-3 py-2 font-medium">Product</th>
              {/* The method behind On hand = Bought − Sprayed ± counts. On this
                  header rather than Bought's, which a phone does not show. */}
              <th className="px-3 py-2 text-right font-medium">
                <span className="inline-flex items-center gap-1">
                  On hand
                  <InfoPopover title="Bought, sprayed and counted">
                    <p>
                      Counting starts on the date chosen above: Deere has no spray records before mid-2024, so anything bought earlier cannot be
                      followed — count what is left of it and the count carries it forward. Bought is every {retailerName} invoice line linked to the product
                      (packs × pack size). Sprayed is what the sprayer measured putting out, or the
                      planned rate over the acres it covered where Deere has no measurement; hand-entered copies of a logged job are not counted twice.
                      A count sets the stock to what was on the shelf that day; everything after it runs on from there. Gallons are US.
                    </p>
                  </InfoPopover>
                </span>
              </th>
              <th className="px-3 py-2 text-right font-medium">In packs</th>
              <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Bought</th>
              <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Sprayed</th>
              <th className="hidden px-3 py-2 text-right font-medium md:table-cell">Counted / fixed</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {shown.map((l) => {
              const isOpen = open === l.product.id
              return (
                <Fragment key={l.product.id}>
                  <tr className="hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => setOpen(isOpen ? null : l.product.id)} className="flex items-center gap-1 text-left font-medium text-gray-900">
                        {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-gray-400" /> : <ChevronRight className="h-3.5 w-3.5 text-gray-400" />}
                        {l.product.name}
                      </button>
                      <span className="ml-5 block text-[11px] text-gray-400">
                        {l.lastBought ? `last bought ${l.lastBought}` : 'no invoice on record'}
                        {l.countedOn && ` · counted ${l.countedOn}`}
                      </span>
                    </td>
                    <td className={cn('px-3 py-2 text-right font-semibold tabular-nums', !l.lastBought ? 'text-gray-400' : l.onHand < -0.05 ? 'text-red-700' : 'text-gray-900')}>
                      {!l.lastBought && !l.countedOn ? 'count it' : show(l.onHand, l.product.unit)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600">{inPacks(l.onHand, l.packSize, l.packUnit) ?? '—'}</td>
                    <td className="hidden px-3 py-2 text-right tabular-nums text-gray-600 sm:table-cell">{show(l.bought, l.product.unit)}</td>
                    <td className="hidden px-3 py-2 text-right tabular-nums text-gray-600 sm:table-cell">{show(l.used, l.product.unit)}</td>
                    <td className="hidden px-3 py-2 text-right tabular-nums text-gray-600 md:table-cell">{Math.abs(l.adjusted) > 0.05 ? show(l.adjusted, l.product.unit) : '—'}</td>
                    <td className="px-3 py-2 text-right">{isMgr && <StockEdit line={l} />}</td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={7} className="bg-gray-50 px-3 py-2">
                        <ul className="max-h-72 space-y-0.5 overflow-auto text-xs">
                          {[...l.entries].reverse().map((e, i) => (
                            <li key={e.adjustment?.id ?? i} className="flex items-center gap-3 tabular-nums">
                              <span className="w-20 shrink-0 text-gray-500">{e.date}</span>
                              <span className={cn('w-20 shrink-0 text-right', e.kind === 'count' ? 'text-brand-700' : e.qty < 0 ? 'text-red-700' : 'text-green-700')}>
                                {e.kind === 'count' ? `= ${show(e.qty, l.product.unit)}` : `${e.qty > 0 ? '+' : ''}${show(e.qty, l.product.unit)}`}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-gray-700">
                                <span className="text-gray-400">{e.kind === 'bought' ? 'bought' : e.kind === 'used' ? 'sprayed' : e.kind === 'count' ? 'counted' : 'adjusted'} · </span>
                                {e.kind === 'used' && e.fieldId ? (
                                  <Link to={`/fields/${e.fieldId}/history`} className="underline decoration-gray-300 hover:text-brand-700">
                                    {e.label}
                                  </Link>
                                ) : (
                                  e.label
                                )}
                              </span>
                              {/* Where the line came from (Sam, 7 Oct 2026): only the hand-made ones are edited here. */}
                              <span className="hidden w-32 shrink-0 truncate text-[11px] text-gray-400 sm:inline">
                                {e.kind === 'bought'
                                  ? `${retailerName} invoice`
                                  : e.kind === 'used'
                                    ? `John Deere ${e.measured ? '(measured)' : '(planned rate)'}`
                                    : 'by hand'}
                              </span>
                              <span className="w-24 shrink-0 text-right text-gray-500">{show(e.balance, l.product.unit)}</span>
                              {isMgr && (
                                <span className="flex w-16 shrink-0 justify-end gap-1">
                                  {e.adjustment && (
                                    <>
                                      <button
                                        type="button"
                                        aria-label="Edit this count"
                                        onClick={() => setEditAdj({ adj: e.adjustment!, line: l })}
                                        className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        aria-label="Delete this count"
                                        onClick={() => {
                                          if (window.confirm(`Delete this ${e.kind === 'count' ? 'count' : 'adjustment'} of ${l.product.name} on ${e.date}?`)) delAdj.mutate(e.adjustment!.id)
                                        }}
                                        className="rounded p-0.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </>
                                  )}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                        {delAdj.error && <p className="mt-1 text-xs text-red-700">{(delAdj.error as Error).message}</p>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
            {!shown.length && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-xs text-gray-500">
                  Nothing matches.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editAdj && (
        <RecordEditModal
          title={`${editAdj.adj.kind === 'count' ? 'Count' : 'Adjustment'} · ${editAdj.line.product.name}`}
          fields={adjFields(editAdj.line.product.unit, gallons)}
          row={editAdj.adj}
          saving={updAdj.isPending}
          error={updAdj.error ? (updAdj.error as Error).message : null}
          onClose={() => {
            updAdj.reset()
            setEditAdj(null)
          }}
          onSave={(v) =>
            updAdj.mutateAsync({
              id: editAdj.adj.id,
              kind: v.kind as 'count' | 'adjust',
              quantity: Number(v.quantity),
              occurred_on: String(v.occurred_on),
              note: (v.note as string | null) ?? null,
            })
          }
          onDelete={() => delAdj.mutateAsync(editAdj.adj.id)}
          deleteConfirm={`Delete this ${editAdj.adj.kind === 'count' ? 'count' : 'adjustment'} of ${editAdj.line.product.name}?`}
        />
      )}

      {wholeTank.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-medium">
            {wholeTank.length} pass{wholeTank.length === 1 ? '' : 'es'} logged a chemical at the whole spray-solution rate, so it is not taken off stock:
          </p>
          <ul className="mt-1 list-disc pl-5">
            {wholeTank.map((w) => (
              <li key={w.opId + w.name}>
                {w.date} · {w.name}
              </li>
            ))}
          </ul>
          <p className="mt-1">Set up in the display as a single product instead of a tank mix with water. Fix the rate in Operations Center, or count the jug.</p>
        </div>
      )}

      {unmatched.size > 0 && (
        <details className="rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-600">
          <summary className="cursor-pointer font-medium text-gray-800">
            {unmatched.size} name{unmatched.size === 1 ? '' : 's'} sprayed in Deere that match no product bought
          </summary>
          <p className="mt-1">Deere spells these differently from anything on an invoice, so what was sprayed is not taken off stock. Count the jug to keep the balance right.</p>
          <ul className="mt-1 columns-2 gap-4">
            {[...unmatched.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 40)
              .map(([name, qty]) => (
                <li key={name}>
                  {name} <span className="text-gray-400">({qtyFmt(qty)})</span>
                </li>
              ))}
          </ul>
        </details>
      )}
    </div>
  )
}

/** Count what is on the shelf, or add/take away a correction. Managers only. */
function StockEdit({ line }: { line: StockLine }) {
  const qc = useQueryClient()
  const [mode, setMode] = useState<'count' | 'adjust' | null>(null)
  const [qty, setQty] = useState('')
  const [asGal, setAsGal] = useState(false)
  const [note, setNote] = useState('')
  const today = new Date().toLocaleDateString('en-CA')
  const save = useMutation({
    mutationFn: async () => {
      const raw = Number(qty)
      const quantity = line.product.unit === 'L' && asGal ? raw * L_PER_US_GAL : raw
      const { error } = await supabase
        .from('chem_stock_adjustments')
        .insert({ product_id: line.product.id, kind: mode!, quantity, occurred_on: today, note: note.trim() || null })
      if (error) throw error
    },
    onSuccess: () => {
      setMode(null)
      setQty('')
      setNote('')
      void qc.invalidateQueries({ queryKey: ['chem-inventory'] })
    },
  })
  if (!mode)
    return (
      <span className="inline-flex gap-1">
        <button type="button" onClick={() => setMode('count')} className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50">
          Count
        </button>
        <button type="button" onClick={() => setMode('adjust')} className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50">
          ±
        </button>
      </span>
    )
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1 text-xs" role="dialog" aria-label={`${mode} ${line.product.name}`}>
      <input
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        inputMode="decimal"
        placeholder={mode === 'count' ? 'on shelf' : '+ or −'}
        className="w-20 rounded border border-gray-300 px-1.5 py-0.5"
        autoFocus
      />
      {line.product.unit === 'L' ? (
        <select value={asGal ? 'gal' : 'L'} onChange={(e) => setAsGal(e.target.value === 'gal')} className="rounded border border-gray-300 px-1 py-0.5" aria-label="Unit">
          <option value="L">L</option>
          <option value="gal">US gal</option>
        </select>
      ) : (
        <span>{line.product.unit}</span>
      )}
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="note" className="w-28 rounded border border-gray-300 px-1.5 py-0.5" />
      <button type="button" disabled={qty.trim() === '' || !Number.isFinite(Number(qty)) || save.isPending} onClick={() => save.mutate()} className="rounded bg-brand-700 px-2 py-0.5 font-semibold text-white disabled:opacity-50">
        Save
      </button>
      <button type="button" onClick={() => setMode(null)} className="text-gray-500 underline">
        cancel
      </button>
      {save.error && <span className="w-full text-right text-red-700">{(save.error as Error).message}</span>}
    </span>
  )
}
