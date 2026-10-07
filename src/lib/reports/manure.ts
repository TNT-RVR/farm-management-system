import { supabase } from '@/lib/supabase'
import { compareFieldNames } from '@/lib/queries'
import { analysisOf, farmTypical, manureAssumptions, manureCredit, type Analysis, type ManureApplication } from '@/lib/manure-credit'
import { fetchAll, fieldLabel, num, yearParam, type Cell, type GatherContext, type ParamValues, type ReportData } from './framework'
import { loadManure } from './nutrients'

/**
 * Every manure spread in a year: where, how much, what it carried, the
 * nutrient credit its first crop takes, what that is worth at today's
 * cheapest pound of fertilizer, and what the haul cost on the hauler's
 * invoice. The credit is the Manure tab's (manure-credit.ts): the lab's
 * analysis, else the farm's own tested average, else Alberta's table, with
 * ammonia lost by how soon it was worked in.
 *
 * The value is every pound credited, priced at the cheapest straight; the
 * Manure tab's "what a load is worth" counts only what each field needs,
 * which is the better guide to where the next load should go.
 */

export const MANURE_COLUMNS = [
  { label: 'Spread' },
  { label: 'Field' },
  { label: 'Acres', decimals: 1 },
  { label: 't/ac', decimals: 1 },
  { label: 'Tonnes', decimals: 0 },
  { label: 'N-P2O5-K2O lb/ton' },
  { label: 'N credit', decimals: 0 },
  { label: 'P2O5 credit', decimals: 0 },
  { label: 'K2O credit', decimals: 0 },
  { label: 'Worth $/ac', decimals: 0, money: true },
  { label: 'Haul cost', decimals: 0, money: true },
  { label: 'Cost $/t', decimals: 2, money: true },
  { label: 'Hauled by' },
]

/** Dollars a pound of each nutrient, at today's cheapest straight; null where none is priced. */
export type NutrientPrice = { n: number | null; p2o5: number | null; k2o: number | null }

export type HaulInvoice = { manure_application_id: string | null; field_id: string | null; hauler: string | null; invoice_no: string | null; work_date: string | null; amount: unknown; tonnes: unknown; loads: number | null }

export type ManureResult = { rows: Cell[][]; acres: number; tonnes: number; cost: number; value: number; assumed: Set<string>; unpriced: boolean }

/** The year's spreads as rows, oldest first, with what the hauler's invoice says each cost. */
export function manureRows(apps: ManureApplication[], invoices: HaulInvoice[], farm: Analysis | null, price: NutrientPrice | null, fieldName: (id: string | null) => string): ManureResult {
  const out: { at: string; field: string; cells: Cell[] }[] = []
  const assumed = new Set<string>()
  let acres = 0
  let tonnes = 0
  let cost = 0
  let value = 0
  let unpriced = false
  for (const m of apps) {
    const bills = invoices.filter((i) => i.manure_application_id === m.id)
    const billedT = bills.reduce((s, i) => s + (num(i.tonnes) ?? 0), 0)
    const t = billedT > 0 ? billedT : m.rate_tons_per_acre != null && m.acres != null ? m.rate_tons_per_acre * m.acres : null
    const billed = bills.length ? bills.reduce((s, i) => s + (num(i.amount) ?? 0), 0) : null
    const a = analysisOf(m, farm)
    const c = manureCredit(m, m.crop_year, farm)
    const worth = price && price.n != null && price.p2o5 != null && price.k2o != null ? c.n * price.n + c.p2o5 * price.p2o5 + c.k2o * price.k2o : null
    if (worth == null) unpriced = true
    manureAssumptions(m).forEach((x) => assumed.add(x))
    acres += m.acres ?? 0
    tonnes += t ?? 0
    cost += billed ?? 0
    value += worth != null && m.acres != null ? worth * m.acres : 0
    const field = fieldName(m.field_id)
    out.push({
      at: m.applied_on ?? '',
      field,
      cells: [
        m.applied_on,
        fieldLabel(field),
        m.acres,
        m.rate_tons_per_acre,
        t,
        `${a.n}-${a.p2o5}-${a.k2o} (${a.measured ? 'lab' : farm ? 'farm average' : 'Alberta typical'})`,
        c.n,
        c.p2o5,
        c.k2o,
        worth,
        billed,
        billed != null && t ? billed / t : null,
        [...new Set(bills.map((b) => [b.hauler?.replace(/\s*\(.*\)$/, ''), b.invoice_no ? `#${b.invoice_no}` : null].filter(Boolean).join(' ')))].join('; ') || null,
      ],
    })
  }
  out.sort((a, b) => a.at.localeCompare(b.at) || compareFieldNames(a.field, b.field))
  return { rows: out.map((r) => r.cells), acres, tonnes, cost, value, assumed, unpriced }
}

export async function gatherManure(p: ParamValues, ctx: GatherContext, price: NutrientPrice | null): Promise<ReportData> {
  const year = yearParam(p, ctx)
  const [all, invoices, fields] = await Promise.all([
    loadManure(),
    fetchAll<HaulInvoice>((a, b) => supabase.from('manure_haul_invoices').select('manure_application_id, field_id, hauler, invoice_no, work_date, amount, tonnes, loads').order('id').range(a, b)),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from('fields').select('id, name').order('id').range(a, b)),
  ])
  const apps = all.filter((m) => m.crop_year === year)
  if (!apps.length) throw new Error(`No manure spread is recorded for ${year}.`)
  const nameOf = new Map(fields.map((f) => [f.id, f.name]))
  const farm = farmTypical(all)
  const r = manureRows(apps, invoices, farm, price, (id) => (id ? (nameOf.get(id) ?? 'A field') : 'No field'))
  const money = (v: number) => `$${Math.round(v).toLocaleString('en-CA')}`
  const summary = [
    'Every manure spread this year. The credit is what the first crop after it gets, lb/ac on the acres spread: the lab’s analysis where it went to a lab, else the farm’s own tested average, else Alberta’s table, with the ammonia lost by how soon it was worked in. Two more years of smaller credits follow, which the nutrient balance counts.',
    price
      ? 'Worth is every pound credited at today’s cheapest pound of N, P2O5 and K2O from straight fertilizer (Fertilizer → Pricing). The Manure tab values only what each field needs.'
      : 'No fertilizer is priced, so the credit is not valued.',
    'Haul cost is the hauler’s invoice before GST; tonnes are the invoice’s where there is one, else the rate over the acres.',
  ]
  if (r.assumed.size) summary.push(`Assumed: ${[...r.assumed].join('; ')}.`)
  return {
    title: 'Manure applications and credit',
    subtitle: `${year}`,
    meta: [
      ['Spreads', apps.length],
      ['Acres', `${r.acres.toLocaleString('en-CA', { maximumFractionDigits: 1 })} ac`],
      ['Tonnes', Math.round(r.tonnes).toLocaleString('en-CA')],
      ['Hauling', money(r.cost)],
      ...(price && !r.unpriced ? ([['Credit worth', money(r.value)]] as [string, Cell][]) : []),
    ],
    summary,
    columns: MANURE_COLUMNS,
    groups: [{ title: '', rows: r.rows }],
    totals: ['Total', null, r.acres, null, r.tonnes, null, null, null, null, null, r.cost, r.tonnes ? r.cost / r.tonnes : null, null],
    orientation: 'landscape',
    filename: `Manure applications ${year}`,
  }
}
