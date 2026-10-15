import { supabase } from '@/lib/supabase'
import { appliedFertiliser } from '@/lib/fertility-rx'
import { unitLabel, type FieldOperation } from '@/lib/fieldOps'
import { analysisOf, farmTypical, manureCredit, sourceOf, typeOf, type ManureApplication } from '@/lib/manure-credit'
import type { IciLine } from '@/lib/ici-review'
import { fetchAll, num } from './framework'

/**
 * Every pound of N, P2O5, K2O and S a field's crop got in a season, from the
 * three places the app learns of it: the machines' application records
 * (Deere), the retailer's floated blends (the notes under each ICI invoice
 * line — Deere never sees those), and manure spread this year or the two
 * before (its credit to this crop, as the Manure tab works it out). Shared by
 * the field season summary and the nutrient balance so the two add up the
 * same way.
 */

export type Nutrients = { n: number; p2o5: number; k2o: number; s: number }
export const NO_NUTRIENTS: Nutrients = { n: 0, p2o5: 0, k2o: 0, s: 0 }
const add = (a: Nutrients, b: Partial<Nutrients> | null | undefined): Nutrients => ({
  n: a.n + (b?.n ?? 0),
  p2o5: a.p2o5 + (b?.p2o5 ?? 0),
  k2o: a.k2o + (b?.k2o ?? 0),
  s: a.s + (b?.s ?? 0),
})

export type FertSource = 'machine' | 'retailer' | 'manure'

export type FertLine = {
  date: string | null
  source: FertSource
  product: string
  rate: number | null
  unit: string | null
  total: string | null
  /** lb/ac over the whole field; null where the record cannot be read as an analysis. */
  nutrients: Nutrients | null
  note: string | null
}

/** A blend's name as both records spell it: "Tonne 18.2-11.4-6.8 Blend" and "18.2-11.4-6.8 blend" are one. */
export const blendKey = (name: string) =>
  name
    .replace(/^tonne\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

export type FieldFertility ={ lines: FertLine[]; bySource: Record<FertSource, Nutrients>; total: Nutrients }

export type FertilityData = {
  ops: FieldOperation[]
  ici: IciLine[]
  manure: ManureApplication[]
  /** The farm's own tested manure, when any of it has been to a lab. */
  farm: ReturnType<typeof farmTypical>
}

/**
 * One field's fertility lines and totals for a crop year.
 *
 * A retailer blend is put down on the acres its ticket names, and a field
 * billed in two loads has the blend on two lines; the field figure is the
 * blend's target scaled by its acres over the field's largest ticket, as the
 * ICI tab reads it. Manure is credited over the field: a spread on a third of
 * it is a third of the credit as a field average.
 */
export function fieldFertility(fieldId: string, year: number, d: FertilityData, fieldAcres: number | null): FieldFertility {
  const lines: FertLine[] = []

  for (const p of appliedFertiliser(d.ops.filter((o) => o.field_id === fieldId))) {
    lines.push({
      date: p.date,
      source: 'machine',
      product: p.product,
      rate: p.rate,
      unit: unitLabel(p.unitId ?? undefined) || null,
      total: null,
      nutrients: p.nutrients,
      note: p.nutrients ? null : 'a volume with no analysis to read',
    })
  }

  // The ICI tab's reading: one entry a blend, its acres added over the loads.
  const mine = d.ici.filter((l) => l.field_id === fieldId && (l.kind === 'blend' || l.kind === 'fertilizer'))
  const blends = new Map<string, { date: string; rate: number | null; acres: number; tonnes: number; target: Record<string, number> | null }>()
  for (const l of mine) {
    const b = blends.get(l.description) ?? { date: l.invoice_date, rate: num(l.rate_lb_ac), acres: 0, tonnes: 0, target: l.target }
    b.acres += num(l.ticket_acres) ?? 0
    b.tonnes += /metric|tonne/i.test(`${l.unit} ${l.description}`) ? (num(l.quantity) ?? 0) : 0
    if (l.invoice_date < b.date) b.date = l.invoice_date
    blends.set(l.description, b)
  }
  const maxAcres = Math.max(1, ...[...blends.values()].map((b) => b.acres))
  // The floater's own monitor sometimes reaches Deere as well (field 1's
  // 18.2-11.4 blend on 22 Apr 2026 is in both): the same blend twice is one
  // application, kept as the machine's record, which has the day it went on.
  const logged = new Set(lines.map((l) => blendKey(l.product)))
  for (const [description, b] of blends) {
    if (logged.has(blendKey(description))) {
      const m = lines.find((l) => blendKey(l.product) === blendKey(description))
      if (m) m.note = [m.note, `also on the ICI ticket, ${Math.round(b.acres)} ac`].filter(Boolean).join('; ')
      continue
    }
    const share = b.acres > 0 ? b.acres / maxAcres : 1
    const t = b.target
    lines.push({
      date: b.date,
      source: 'retailer',
      product: description.replace(/^Tonne\s+/i, ''),
      rate: b.rate,
      unit: b.rate != null ? 'lb/ac' : null,
      total: b.tonnes > 0 ? `${b.tonnes.toLocaleString('en-CA', { maximumFractionDigits: 2 })} t` : null,
      nutrients: t ? { n: (num(t.N) ?? 0) * share, p2o5: (num(t.P) ?? 0) * share, k2o: (num(t.K) ?? 0) * share, s: (num(t.S) ?? 0) * share } : null,
      note: `floated on ${Math.round(b.acres)} ac (ICI ticket)`,
    })
  }

  for (const m of d.manure.filter((x) => x.field_id === fieldId)) {
    const c = manureCredit(m, year, d.farm)
    if (!(c.n + c.p2o5 + c.k2o > 0)) continue
    const share = fieldAcres && fieldAcres > 0 && m.acres ? Math.max(0, Math.min(1, m.acres / fieldAcres)) : 1
    const a = analysisOf(m, d.farm)
    const age = year - m.crop_year
    const tonnes = m.rate_tons_per_acre != null && m.acres != null ? m.rate_tons_per_acre * m.acres : null
    lines.push({
      date: m.applied_on,
      source: 'manure',
      product: `Manure, ${sourceOf(m.source).label.toLowerCase()}${m.manure_type ? ` (${typeOf(m.manure_type).label.toLowerCase()})` : ''}`,
      rate: m.rate_tons_per_acre,
      unit: 't/ac',
      total: tonnes != null ? `${Math.round(tonnes).toLocaleString('en-CA')} t` : null,
      nutrients: { n: c.n * share, p2o5: c.p2o5 * share, k2o: c.k2o * share, s: 0 },
      note: `${age === 0 ? 'this year’s' : age === 1 ? 'second-year' : 'third-year'} credit; ${a.n}-${a.p2o5}-${a.k2o} lb/ton (${a.measured ? 'lab test' : d.farm ? 'farm average' : 'Alberta typical'})${share < 1 ? `, on ${Math.round(share * 100)}% of the field` : ''}`,
    })
  }

  lines.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
  const bySource: Record<FertSource, Nutrients> = { machine: { ...NO_NUTRIENTS }, retailer: { ...NO_NUTRIENTS }, manure: { ...NO_NUTRIENTS } }
  for (const l of lines) bySource[l.source] = add(bySource[l.source], l.nutrients)
  const total = add(add(bySource.machine, bySource.retailer), bySource.manure)
  return { lines, bySource, total }
}

/** What fieldFertility reads for a season: the application passes, the retailer's lines, and manure from the two years before on. */
export async function loadFertility(year: number, fieldId: string | null): Promise<FertilityData> {
  const [ops, ici, manure] = await Promise.all([
    fetchAll<FieldOperation>((a, b) => {
      let q = supabase
        .from('jd_field_operations')
        .select('id, field_id, crop_season, operation_type, started_at, products')
        .eq('crop_season', year)
        .eq('operation_type', 'application')
        .is('duplicate_of', null)
        .is('not_ours', null)
        .or('confirm_status.is.null,confirm_status.eq.confirmed')
        .order('id')
      if (fieldId) q = q.eq('field_id', fieldId)
      return q.range(a, b)
    }),
    fetchAll<IciLine>((a, b) => {
      let q = supabase.from('ici_field_lines').select('*').eq('crop_year', year).order('id')
      if (fieldId) q = q.eq('field_id', fieldId)
      return q.range(a, b)
    }),
    // Every spread, for the farm's own tested average; the credit itself only
    // reaches back two years.
    loadManure(),
  ])
  return { ops, ici, manure: manure.filter((m) => m.crop_year <= year && m.crop_year >= year - 2), farm: farmTypical(manure) }
}

/** Every manure spread, its numbers as numbers (Postgres numerics can arrive as strings). */
export async function loadManure(): Promise<ManureApplication[]> {
  const rows = await fetchAll<ManureApplication>((a, b) =>
    supabase
      .from('manure_applications')
      .select('id, field_id, crop_year, applied_on, source, rate_tons_per_acre, n_lb_ton, p2o5_lb_ton, k2o_lb_ton, incorporated, incorporated_days, manure_type, acres, notes, created_at')
      .order('id')
      .range(a, b),
  )
  return rows.map((m) => ({
    ...m,
    rate_tons_per_acre: num(m.rate_tons_per_acre),
    n_lb_ton: num(m.n_lb_ton),
    p2o5_lb_ton: num(m.p2o5_lb_ton),
    k2o_lb_ton: num(m.k2o_lb_ton),
    incorporated_days: num(m.incorporated_days),
    acres: num(m.acres),
  }))
}
