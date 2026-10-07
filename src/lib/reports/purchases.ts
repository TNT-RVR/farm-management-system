import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { surveyKeyOf } from '@/lib/fert-savings/adder'
import { straightKeyOf } from '@/lib/fert-savings/straights'
import { fetchAll, num, pick, yearParam, type Cell, type GatherContext, type ParamValues, type ReportData, type ReportGroup } from './framework'

/**
 * Input purchases by supplier: every invoice line in the year, a group per
 * supplier with the lines in product order, and — where Alberta's monthly
 * farm input survey prices the same thing — the survey price for that month
 * beside what was paid. Comparable means the same product in the same unit:
 * the bulk fertilizer straights by analysis (the survey's own matching,
 * fert-savings/adder.ts), and the few branded chemicals the survey carries,
 * per litre. Blends, custom work and everything else are listed without one.
 */

export type Purchase = {
  supplier: string | null
  invoice_no: string | null
  invoice_date: string | null
  description: string | null
  quantity: unknown
  pack_unit: string | null
  unit_price: unknown
  amount: unknown
  canonical_unit: string | null
  price_per_canonical: unknown
  product_id: string | null
}
export type SurveyRow = { item_key: string; item: string; unit: string | null; observed_on: string; price: unknown }

/** A survey price in the unit it is compared in. */
export type SurveyPrice = { per: number; unit: 't' | 'L'; on: string; item: string }

/** The branded chemicals the survey prices, by a word that only they carry. */
const CHEMICALS: { match: RegExp; key: RegExp }[] = [
  { match: /\baxial\b/i, key: /^axial-/ },
  { match: /\bbuctril\s*m\b/i, key: /^buctril-m-/ },
  { match: /weather\s*max/i, key: /^roundup-weathermax-/ },
  { match: /\brefine\s*sg\b/i, key: /^refine-sg-/ },
  { match: /\bassert\b/i, key: /^assert-300-/ },
]

/** Litres or grams in a survey unit like "10 litre", "10.8 litre", "486 gram". */
function packLitres(itemKey: string): number | null {
  const m = itemKey.match(/(\d+(?:-\d+)?)-litre$/)
  return m ? Number(m[1].replace('-', '.')) : null
}

/**
 * What the survey said in the month of an invoice: the latest observation on
 * or before the invoice date, else the first after it (the survey started
 * after some invoices).
 */
export function surveyFor(rows: SurveyRow[], description: string, on: string): SurveyPrice | null {
  const straight = straightKeyOf(description)
  let pool: { row: SurveyRow; per: number; unit: 't' | 'L' }[] = []
  if (straight) {
    pool = rows.filter((r) => surveyKeyOf(r.item_key) === straight).map((r) => ({ row: r, per: Number(r.price), unit: 't' as const }))
  } else {
    const chem = CHEMICALS.find((c) => c.match.test(description))
    if (chem)
      pool = rows
        .filter((r) => chem.key.test(r.item_key) && packLitres(r.item_key))
        .map((r) => ({ row: r, per: Number(r.price) / packLitres(r.item_key)!, unit: 'L' as const }))
  }
  pool = pool.filter((x) => Number.isFinite(x.per) && x.per > 0)
  if (!pool.length) return null
  const before = pool.filter((x) => x.row.observed_on <= on).sort((a, b) => b.row.observed_on.localeCompare(a.row.observed_on))[0]
  const after = pool.sort((a, b) => a.row.observed_on.localeCompare(b.row.observed_on))[0]
  const hit = before ?? after
  return { per: hit.per, unit: hit.unit, on: hit.row.observed_on, item: hit.row.item }
}

/** What was paid in the survey's unit: $/tonne from $/kg, $/L as it stands. */
export function paidPer(p: Purchase, unit: 't' | 'L'): number | null {
  const per = num(p.price_per_canonical)
  if (per == null || !(per > 0)) return null
  if (unit === 't') return p.canonical_unit === 'kg' ? per * 1000 : null
  return p.canonical_unit === 'L' ? per : null
}

export const PURCHASE_COLUMNS = [
  { label: 'Date' },
  { label: 'Invoice' },
  { label: 'Product' },
  { label: 'Qty', decimals: 2 },
  { label: 'Unit' },
  { label: 'Unit price', decimals: 2, money: true },
  { label: 'Total', decimals: 2, money: true },
  { label: 'Paid per t or L', decimals: 2, money: true },
  { label: 'Alberta survey', decimals: 2, money: true },
  { label: 'vs survey' },
]

export function purchaseGroups(purchases: Purchase[], productName: Map<string, string>, survey: SurveyRow[]): { groups: ReportGroup[]; total: number; compared: number } {
  const bySupplier = new Map<string, Purchase[]>()
  for (const p of purchases) {
    const k = p.supplier?.trim() || 'Supplier not recorded'
    bySupplier.set(k, [...(bySupplier.get(k) ?? []), p])
  }
  let total = 0
  let compared = 0
  const groups: ReportGroup[] = []
  for (const [supplier, list] of [...bySupplier].sort((a, b) => a[0].localeCompare(b[0]))) {
    const named = list.map((p) => ({ p, name: (p.product_id && productName.get(p.product_id)) || p.description?.trim() || '(no description)' }))
    named.sort((a, b) => a.name.localeCompare(b.name) || (a.p.invoice_date ?? '').localeCompare(b.p.invoice_date ?? ''))
    let sum = 0
    const rows: Cell[][] = named.map(({ p, name }) => {
      const amount = num(p.amount)
      sum += amount ?? 0
      const s = surveyFor(survey, `${p.description ?? ''} ${name}`, p.invoice_date ?? '9999')
      const paid = s ? paidPer(p, s.unit) : null
      if (s && paid != null) compared++
      const vs = s && paid != null ? Math.round((paid / s.per - 1) * 100) : null
      return [
        p.invoice_date,
        p.invoice_no,
        name,
        num(p.quantity),
        p.pack_unit,
        num(p.unit_price),
        amount,
        s ? paid : null,
        s && paid != null ? s.per : null,
        vs == null ? null : `${vs > 0 ? '+' : ''}${vs}%`,
      ]
    })
    total += sum
    groups.push({ title: supplier, note: `${list.length} invoice line${list.length === 1 ? '' : 's'}`, rows, totals: ['Supplier total', null, null, null, null, null, sum, null, null, null] })
  }
  return { groups, total, compared }
}

export async function gatherPurchases(p: ParamValues, ctx: GatherContext): Promise<ReportData> {
  const year = yearParam(p, ctx)
  const supplier = pick(p, 'supplier')
  // ab_input_prices is not in the generated types (only its latest-price view is).
  const untyped = supabase as unknown as SupabaseClient
  const [purchases, products, survey] = await Promise.all([
    fetchAll<Purchase>((a, b) => {
      let q = supabase
        .from('product_purchases')
        .select('supplier, invoice_no, invoice_date, description, quantity, pack_unit, unit_price, amount, canonical_unit, price_per_canonical, product_id')
        .gte('invoice_date', `${year}-01-01`)
        .lte('invoice_date', `${year}-12-31`)
        .order('id')
      if (supplier) q = q.eq('supplier', supplier)
      return q.range(a, b)
    }),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from('jd_products').select('id, name').order('id').range(a, b)),
    fetchAll<SurveyRow>((a, b) => untyped.from('ab_input_prices').select('item_key, item, unit, observed_on, price').in('category', ['fertilizer', 'chemical', 'other']).order('id').range(a, b)),
  ])
  if (!purchases.length) throw new Error(`No invoice lines ${supplier ? `from ${supplier} ` : ''}in ${year}.`)
  const r = purchaseGroups(purchases, new Map(products.map((x) => [x.id, x.name])), survey)
  return {
    title: 'Input purchases by supplier',
    subtitle: `${year} · ${supplier ?? 'All suppliers'}`,
    meta: [
      ['Invoice lines', purchases.length],
      ['Invoices', new Set(purchases.map((x) => `${x.supplier}|${x.invoice_no}`)).size],
      ['Spent', `$${Math.round(r.total).toLocaleString('en-CA')}`],
      ['Against the survey', r.compared],
    ],
    summary: [
      'Every invoice line imported from the suppliers’ invoices, by supplier and product. The Alberta survey column is the province’s monthly farm input price for the same product in the month of the invoice: per tonne for the bulk fertilizer straights, per litre for the few chemicals it carries. Blends and custom work have no survey price.',
    ],
    columns: PURCHASE_COLUMNS,
    groups: r.groups,
    groupLabel: 'Supplier',
    totals: r.groups.length > 1 ? ['All suppliers', null, null, null, null, null, r.total, null, null, null] : undefined,
    filename: `Input purchases ${year} ${supplier ?? 'all suppliers'}`,
  }
}
