import { supabase } from '@/lib/supabase'
import { appliedByProduct, fmtQty, type AppliedOp, type ProductResolver } from '@/lib/applied'
import { unitLabel } from '@/lib/fieldOps'
import { boundariesForYear, compareFieldNames, type BoundaryRow } from '@/lib/queries'
import { albertaDay, productResolver, sprayedProducts, type PriceBookAlias, type PriceBookProduct, type ResolvedProduct } from '@/lib/spray-products'
import { fetchAll, fieldLabel, num, pick, yearParam, type Cell, type GatherContext, type ParamValues, type ReportData, type ReportGroup } from './framework'

/**
 * Spray records: every application pass John Deere logged, one row per
 * product on it, with the PCP number the price book holds for it — the
 * record a buyer, CanadaGAP or the insurer asks for. Rate is as the operator
 * set it in the display (so it can be checked against the ticket); the
 * total is that rate over the acres the pass is costed on (lib/applied.ts,
 * the same figure every cost screen uses). Weather is what was stored with
 * the pass: off the machine where Deere sent it, modelled at the field where
 * it did not. Pasture sprays logged by hand follow the fields.
 */

export type SprayOp = AppliedOp & { id: string; field_id: string | null }

export const SPRAY_COLUMNS = [
  { label: 'Date' },
  { label: 'Crop' },
  { label: 'Product' },
  { label: 'PCP no.' },
  { label: 'Type' },
  { label: 'Rate', upTo: 3 },
  { label: 'Rate unit' },
  { label: 'Area (ac)', decimals: 1 },
  { label: 'Total' },
  { label: 'Operator' },
  { label: 'Wind (km/h)', decimals: 0 },
  { label: 'Temp (°C)', decimals: 0 },
  { label: 'RH (%)', decimals: 0 },
]

/** Deere's crop codes ("EDIBLE_BEANS", "Corn_wet") as words: "Edible beans". */
export const cropLabel = (c: string | null | undefined): string | null => {
  const t = (c ?? '').replace(/_/g, ' ').trim().toLowerCase()
  return t ? t[0].toUpperCase() + t.slice(1) : null
}

/**
 * A pass that put on nothing but fertilizer (a liquid or dry fertilizer
 * application) is a fertility record, not a spray record — it is in the
 * 4R / NERP pack. A fertilizer tank-mixed with a chemical stays, as part of
 * what was in the tank.
 */
export function fertilizerOnly(products: unknown): boolean {
  const parts = sprayedProducts(products, () => undefined)
  return parts.length > 0 && parts.every((p) => (p.productType ?? '').toUpperCase() === 'FERTILIZER')
}

const TYPE_LABEL: Record<string, string> = { CHEMICAL: 'chemical', FERTILIZER: 'fertilizer', ADJUVANT: 'adjuvant' }

/** One field's passes as report rows, oldest first; also the names the price book could not place. */
export function sprayRows(ops: SprayOp[], fieldAcres: number, resolve: (deereName: string) => ResolvedProduct | undefined): { rows: Cell[][]; unmatched: Set<string>; acres: number } {
  const forApplied: ProductResolver = (n) => {
    const hit = resolve(n)
    return hit ? { name: hit.name, pricePerUnit: null } : null
  }
  const rows: { at: string; cells: Cell[] }[] = []
  const unmatched = new Set<string>()
  let acres = 0
  for (const op of ops) {
    const typeOf = new Map(sprayedProducts(op.products, resolve).map((s) => [s.deereName.toLowerCase(), s.productType]))
    const { lines } = appliedByProduct([op], fieldAcres, forApplied)
    let passAcres = 0
    for (const line of lines) {
      for (const e of line.events) {
        const hit = resolve(e.typedAs)
        if (!hit) unmatched.add(e.typedAs)
        passAcres = Math.max(passAcres, e.acres)
        const type = typeOf.get(e.typedAs.toLowerCase())
        rows.push({
          at: e.startedAt ?? '',
          cells: [
            e.startedAt ? albertaDay(e.startedAt) : null,
            cropLabel(e.crop),
            line.product,
            hit?.reg ?? null,
            type ? (TYPE_LABEL[type] ?? type.toLowerCase()) : null,
            e.rawRate?.value ?? null,
            unitLabel(e.rawRate?.unitId) || null,
            e.acres > 0 ? e.acres : null,
            e.total != null && e.unit ? fmtQty(e.total, e.unit) : null,
            e.operator,
            e.windKmh,
            e.tempC,
            e.humidityPct,
          ],
        })
      }
    }
    acres += passAcres
  }
  rows.sort((a, b) => a.at.localeCompare(b.at) || String(a.cells[2]).localeCompare(String(b.cells[2])))
  return { rows: rows.map((r) => r.cells), unmatched, acres }
}

/**
 * Every application pass of a crop year (one field, or all), as the spray
 * records read them — somebody else's crop included, marked by not_ours, for
 * the report to count and leave out. Shared with the contract canola field
 * records so the two cannot disagree about what was sprayed.
 */
export function loadSprayOps(year: number, fieldId: string | null): Promise<(SprayOp & { not_ours: string | null })[]> {
  return fetchAll<SprayOp & { not_ours: string | null }>((a, b) => {
    let q = supabase
      .from('jd_field_operations')
      .select(
        'id, field_id, jd_id, started_at, ended_at, operator_name, treated_crop, products, raw, applied_area_ha, as_applied, wind_speed_kmh, wind_gust_kmh, wind_dir_deg, air_temp_c, humidity_pct, app_speed_kmh, conditions_source, weather_at, sessions, cost_acres_override, not_ours',
      )
      .eq('operation_type', 'application')
      .eq('crop_season', year)
      // The screens' row security hides these already; said again so the
      // report never depends on it.
      .is('duplicate_of', null)
      .or('confirm_status.is.null,confirm_status.eq.confirmed')
      .order('id')
    if (fieldId) q = q.eq('field_id', fieldId)
    return q.range(a, b)
  })
}

/** The price book, as a resolver from Deere's product names to the product and its PCP number. */
export async function loadSprayResolver(): Promise<(deereName: string) => ResolvedProduct | undefined> {
  const [products, aliases] = await Promise.all([
    fetchAll<PriceBookProduct>((a, b) => supabase.from('jd_products').select('id, name, pmra_registration').order('id').range(a, b)),
    fetchAll<PriceBookAlias>((a, b) => supabase.from('jd_product_aliases').select('deere_name, product_id, ignored').order('deere_name').range(a, b)),
  ])
  return productResolver(products, aliases)
}

export async function gatherSprayRecords(p: ParamValues, ctx: GatherContext): Promise<ReportData> {
  const year = yearParam(p, ctx)
  const fieldId = pick(p, 'field')
  const [ops, fields, bounds, resolve, pastureSprays, pastures] = await Promise.all([
    loadSprayOps(year, fieldId),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from('fields').select('id, name').order('id').range(a, b)),
    fetchAll<BoundaryRow>((a, b) => supabase.from('field_boundaries').select('id, field_id, acres, valid_from, valid_to').order('id').range(a, b)),
    loadSprayResolver(),
    fieldId
      ? Promise.resolve([])
      : fetchAll<{ pasture_id: string; applied_on: string; product: string | null; registration_number: string | null; notes: string | null }>((a, b) =>
          supabase.from('pasture_sprays').select('pasture_id, applied_on, product, registration_number, notes').gte('applied_on', `${year}-01-01`).lte('applied_on', `${year}-12-31`).order('applied_on').range(a, b),
        ),
    fieldId ? Promise.resolve([]) : fetchAll<{ id: string; name: string }>((a, b) => supabase.from('pastures').select('id, name').order('id').range(a, b)),
  ])

  const acresOf = new Map(boundariesForYear(bounds, year).map((b) => [b.field_id, num(b.acres) ?? 0]))
  const nameOf = new Map(fields.map((f) => [f.id, f.name]))
  // Somebody else's crop (custom work, a rented-out field) is kept on the
  // pass for the record but is not this farm's spray record.
  const notOurs = ops.filter((o) => o.not_ours).length
  const fert = ops.filter((o) => !o.not_ours && fertilizerOnly(o.products)).length
  const ours = ops.filter((o) => !o.not_ours && !fertilizerOnly(o.products))

  const byField = new Map<string, SprayOp[]>()
  for (const o of ours) {
    const k = o.field_id ?? ''
    byField.set(k, [...(byField.get(k) ?? []), o])
  }
  const groups: ReportGroup[] = []
  const unmatched = new Set<string>()
  let acres = 0
  let lines = 0
  for (const [fid, list] of [...byField].sort((a, b) => compareFieldNames(nameOf.get(a[0]) ?? '~', nameOf.get(b[0]) ?? '~'))) {
    const r = sprayRows(list, acresOf.get(fid) ?? 0, resolve)
    r.unmatched.forEach((n) => unmatched.add(n))
    acres += r.acres
    lines += r.rows.length
    groups.push({
      title: fid ? fieldLabel(nameOf.get(fid) ?? 'A field') : 'No field',
      note: `${list.length} pass${list.length === 1 ? '' : 'es'}, ${Math.round(r.acres).toLocaleString('en-CA')} ac sprayed`,
      rows: r.rows,
    })
  }

  const pastureName = new Map(pastures.map((x) => [x.id, x.name]))
  const byPasture = new Map<string, Cell[][]>()
  for (const s of pastureSprays) {
    const k = pastureName.get(s.pasture_id) ?? 'Pasture'
    byPasture.set(k, [...(byPasture.get(k) ?? []), [s.applied_on, 'Pasture', s.product, s.registration_number, null, null, null, null, null, s.notes, null, null, null]])
  }
  for (const [name, rows] of byPasture) groups.push({ title: `${name} (pasture)`, note: 'Logged by hand on the pasture.', rows })

  if (!groups.length) throw new Error(`No spray passes ${fieldId ? 'on that field ' : ''}in ${year}.`)
  const which = fieldId ? fieldLabel(nameOf.get(fieldId) ?? 'One field') : 'All fields'
  const summary = [
    'Every application pass John Deere logged, one line per product in the tank. Rate is as set in the display; the total is that rate over the acres the pass covered.',
  ]
  if (unmatched.size) summary.push(`Not matched to the price book, so no PCP number: ${[...unmatched].sort().join(', ')}. Match them on Fertilizer → Pricing.`)
  if (fert) summary.push(`${fert} fertilizer-only pass${fert === 1 ? '' : 'es'} left out: they are in the 4R / NERP record pack.`)
  if (notOurs) summary.push(`${notOurs} pass${notOurs === 1 ? '' : 'es'} on someone else’s crop (custom work or rented out) left out.`)
  return {
    title: 'Spray records',
    subtitle: `Crop year ${year} · ${which}`,
    meta: [
      ['Passes', ours.length],
      ['Product lines', lines],
      ['Fields', groups.length - byPasture.size],
      ['Acres sprayed', `${Math.round(acres).toLocaleString('en-CA')} ac`],
      ['Without a PCP no.', unmatched.size],
    ],
    summary,
    columns: SPRAY_COLUMNS,
    groups,
    groupLabel: 'Field',
    filename: `Spray records ${year} ${which}`,
  }
}
