import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { compareFieldNames } from '@/lib/queries'
import { productResolver, sprayedProducts, type PriceBookAlias, type PriceBookProduct } from '@/lib/spray-products'
import { fetchAll, fieldLabel, num, yearParam, type Cell, type GatherContext, type ParamValues, type ReportData, type ReportGroup } from './framework'

/**
 * Missing information: everything the app still needs a person to fill in,
 * as one row each — the area, the thing, what is missing, and the page to
 * fix it on. Each check is a small pure function over one snapshot of the
 * database (MissingData), so adding a check is adding a function to CHECKS
 * (and a test), and the loader below if it needs a table not read yet.
 *
 * A check whose page is switched off for the farm (no cattle, no
 * irrigation) or closed to the person is skipped: there is nothing they can
 * do about it. The fixed-cost check runs only for an owner, and says only
 * that the breakdown is missing, never what is in it.
 */

export type MissingItem = { area: string; item: string; missing: string; where: string; path: string }

export type MissingData = {
  year: number
  fields: { id: string; name: string; active: boolean; legal_land_description: string | null }[]
  plans: { field_id: string; crop_id: string | null; crop_year: number; planned_acres: unknown }[]
  tenure: { field_id: string; crop_year: number; rented_to: string | null }[]
  crops: { id: string; name: string; active: boolean; default_yield_per_acre: unknown; renter_only: boolean | null; land_rent_only: boolean | null }[]
  prices: { crop_id: string; crop_year: number; price_per_unit: unknown }[]
  inputs: { crop_id: string; crop_year: number; name: string | null; category: string | null }[]
  pivots: {
    field_id: string
    pump_id: string | null
    gpm: unknown
    acres_irrigated: unknown
    water_source: string | null
    water_licence_id: string | null
    smrid_area: unknown
    sprinkler_package: string | null
    drop_height_ft: unknown
    pressure_regulators: boolean | null
    nozzles_replaced_year: unknown
    end_gun: boolean | null
    pivot_pressure_psi: unknown
    /** The landowner runs this pivot and its pump for us: nothing to ask for. */
    operated_by?: string | null
    fields: { name: string; active: boolean | null } | null
  }[]
  pumps: { id: string; name: string; horse_power: unknown; gpm: unknown }[]
  entries: { field_id: string }[]
  routes: { from_key: string; to_key: string; method: string | null }[]
  ops: { products: unknown; crop_season: number | null }[]
  products: PriceBookProduct[]
  aliases: PriceBookAlias[]
  labels: { registration_number: string; grazing_rules_status: string | null; recrop_status: string | null }[]
  ranches: { id: string; name: string; mymaps_url: string | null }[]
  herd: { ranch_id: string | null; class_name: string; head_count: number | null; avg_weight_lb: unknown; bcs: unknown }[]
  feed: { ranch_id: string | null; remaining_lb: unknown }[]
  cattleCosts: { ranch: string; crop_year: number; cow_cost_per_head: unknown; feed_cost_per_head: unknown; pasture_cost_per_head: unknown; vet_cost_per_head: unknown; death_loss_pct: unknown; weaning_rate_pct: unknown }[]
  leases: { landlord: string | null; legal_land: string | null; acres: unknown; start_date: string | null; end_date: string | null; rent_per_acre: unknown; rent_total: unknown; crop_share_pct: unknown; our_share_pct: unknown; arrangement: string | null; active: boolean | null }[]
  grazingPastures: { name: string; active: boolean | null; pasture_id: string | null }[]
  licences: { licence_number: string | null; volume: unknown }[]
  allotments: { year: number }[]
  /** Owner only; empty for everyone else. */
  fixedCosts: { crop_year: number }[]
  fixedLines: { crop_year: number; category: string | null }[]
  progress: { field_id: string; crop_year: number; has_harvest: boolean | null }[]
  loads: { field_id: string | null }[]
  history: { field_id: string; crop_year: number; yield_per_acre: unknown; clean_yield_per_acre: unknown }[]
}

export type MissingCheck = {
  id: string
  /** Owner-only checks: the fixed-cost breakdown is theirs alone. */
  ownersOnly?: boolean
  run: (d: MissingData) => MissingItem[]
}

const fieldName = (d: MissingData) => {
  const m = new Map(d.fields.map((f) => [f.id, fieldLabel(f.name)]))
  return (id: string) => m.get(id) ?? 'A field'
}
const byName = (a: MissingItem, b: MissingItem) => compareFieldNames(a.item, b.item)
/** Fields with a crop this year that is ours — not land rented out to someone else. */
function farmedFields(d: MissingData): Set<string> {
  const rentOnly = new Set(d.crops.filter((c) => c.land_rent_only).map((c) => c.id))
  const rentedOut = new Set(d.tenure.filter((t) => t.crop_year === d.year && t.rented_to).map((t) => t.field_id))
  return new Set(d.plans.filter((p) => p.crop_year === d.year && p.crop_id && !rentOnly.has(p.crop_id) && !rentedOut.has(p.field_id)).map((p) => p.field_id))
}
/** Phrases as one sentence: "No price; no normal yield" → capitalised, semicolons between. */
const sentence = (parts: string[]) => parts.join('; ').replace(/^./, (c) => c.toUpperCase())
const blank = (v: unknown) => v == null || v === ''
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`)

/* ── Checks ─────────────────────────────────────────────────────────────── */

export const CHECKS: MissingCheck[] = [
  {
    // The pumping cost, the water review and the efficiency suggestion all
    // read these off Pivot Information.
    id: 'pivot-equipment',
    run: (d) =>
      [...d.pivots]
        .filter((p) => p.fields?.active !== false && !p.operated_by)
        .sort((a, b) => compareFieldNames(a.fields?.name ?? '', b.fields?.name ?? ''))
        .map((p) => {
          const gaps: string[] = []
          if (blank(p.gpm)) gaps.push('flow (gpm)')
          if (!p.pump_id) gaps.push('pump')
          if (blank(p.acres_irrigated)) gaps.push('irrigated acres')
          if (!p.water_source && blank(p.smrid_area) && !p.water_licence_id) gaps.push('water source')
          const equipment: string[] = []
          if (!p.sprinkler_package) equipment.push('sprinkler package')
          if (blank(p.drop_height_ft)) equipment.push('drop height')
          if (p.pressure_regulators == null) equipment.push('pressure regulators')
          if (blank(p.nozzles_replaced_year)) equipment.push('year nozzles were replaced')
          if (p.end_gun == null) equipment.push('end gun')
          if (blank(p.pivot_pressure_psi)) equipment.push('pressure')
          if (equipment.length) gaps.push(`equipment: ${list(equipment)}`)
          return gaps.length ? { area: 'Irrigation', item: `Pivot on ${fieldLabel(p.fields?.name ?? '?')}`, missing: `No ${list(gaps)}`, where: 'Pivots & pumps → Pivot Information', path: '/irrigation-info?tab=pivot' } : null
        })
        .filter((x): x is MissingItem => x != null),
  },
  {
    id: 'pump-power',
    run: (d) =>
      d.pumps
        .map((p) => {
          const gaps = [blank(p.horse_power) ? 'horsepower' : null, blank(p.gpm) ? 'flow (gpm)' : null].filter((x): x is string => !!x)
          return gaps.length ? { area: 'Irrigation', item: /pump/i.test(p.name) ? p.name : `Pump ${p.name}`, missing: `No ${list(gaps)} — the pumping cost cannot be worked out`, where: 'Pivots & pumps → Pump Information', path: '/irrigation-info?tab=pump' } : null
        })
        .filter((x): x is MissingItem => x != null),
  },
  {
    id: 'licence-volume',
    run: (d) =>
      d.licences
        .filter((l) => num(l.volume) == null)
        .map((l) => ({ area: 'Irrigation', item: `Licence ${l.licence_number ?? '(no number)'}`, missing: 'No volume (acre-feet) — its pivots cannot be judged against it', where: 'Soil moisture → a field on it → Water rights', path: '/irrigation' })),
  },
  {
    id: 'district-allotment',
    run: (d) =>
      d.pivots.some((p) => p.water_source === 'smrid' || !blank(p.smrid_area)) && !d.allotments.some((a) => a.year === d.year)
        ? [{ area: 'Irrigation', item: `District allotment ${d.year}`, missing: `Not set for ${d.year}; the last year’s figure is being used`, where: 'Soil moisture → Overview', path: '/irrigation' }]
        : [],
  },
  {
    // Field work, fuel and hauling are measured from the shop to the field's
    // entry; without a pin a suggested one is used.
    id: 'entry-pins',
    run: (d) => {
      const pinned = new Set(d.entries.map((e) => e.field_id))
      return d.fields
        .filter((f) => f.active && !pinned.has(f.id))
        .sort((a, b) => compareFieldNames(a.name, b.name))
        .map((f) => ({ area: 'Travel & trucking', item: fieldLabel(f.name), missing: 'No entry pin — distances use a suggested gate', where: 'Travel & trucking → Distances', path: '/hauling?tab=distances' }))
    },
  },
  {
    id: 'farm-trails',
    run: (d) => {
      const name = fieldName(d)
      const ids = new Set(d.routes.filter((r) => r.from_key === 'shop' && r.to_key.startsWith('field:') && r.method === 'road+straight').map((r) => r.to_key.slice(6)))
      const active = new Set(d.fields.filter((f) => f.active).map((f) => f.id))
      return [...ids]
        .filter((id) => active.has(id))
        .map((id) => ({ area: 'Travel & trucking', item: name(id), missing: 'No farm trail mapped — the last stretch is a straight line × 1.3', where: 'Travel & trucking → Distances', path: '/hauling?tab=distances' }))
        .sort(byName)
    },
  },
  {
    id: 'legal-land',
    run: (d) =>
      d.fields
        .filter((f) => f.active && !f.legal_land_description?.trim())
        .map((f) => ({ area: 'Fields', item: fieldLabel(f.name), missing: 'No legal land description', where: 'The field → Settings', path: `/fields/${f.id}/settings` })),
  },
  {
    id: 'harvest-yield',
    run: (d) => {
      const name = fieldName(d)
      const harvested = new Set([...d.progress.filter((p) => p.crop_year === d.year && p.has_harvest).map((p) => p.field_id), ...d.loads.map((l) => l.field_id).filter((x): x is string => !!x)])
      const withYield = new Set(d.history.filter((h) => h.crop_year === d.year && (num(h.yield_per_acre) != null || num(h.clean_yield_per_acre) != null)).map((h) => h.field_id))
      const ours = farmedFields(d)
      return [...harvested]
        .filter((id) => !withYield.has(id) && ours.has(id))
        .map((id) => ({ area: 'Crops', item: name(id), missing: `Harvested in ${d.year} but no yield entered (tick the last load, or type it)`, where: 'The field → History', path: `/fields/${id}/history` }))
        .sort(byName)
    },
  },
  {
    // A crop grown on our own account needs a price and a normal yield for
    // the plan, the budget and the break-even. Rented-out crops do not.
    id: 'crop-price-yield',
    run: (d) => {
      const grown = new Set(d.plans.filter((p) => p.crop_year === d.year && p.crop_id).map((p) => p.crop_id!))
      return d.crops
        .filter((c) => grown.has(c.id) && !c.land_rent_only && !c.renter_only && !/fallow/i.test(c.name))
        .map((c) => {
          const gaps: string[] = []
          if (!d.prices.some((p) => p.crop_id === c.id && p.crop_year <= d.year && num(p.price_per_unit) != null)) gaps.push(`no price for ${d.year} or any year before`)
          if (num(c.default_yield_per_acre) == null) gaps.push('no normal yield')
          return gaps.length ? { area: 'Crops', item: c.name, missing: sentence(gaps), where: 'Crop settings', path: '/crops' } : null
        })
        .filter((x): x is MissingItem => x != null)
    },
  },
  {
    id: 'crop-inputs',
    run: (d) => {
      const grown = new Set(d.plans.filter((p) => p.crop_year === d.year && p.crop_id).map((p) => p.crop_id!))
      return d.crops
        .filter((c) => grown.has(c.id) && !c.land_rent_only && !c.renter_only && !/fallow/i.test(c.name))
        .filter((c) => !d.inputs.some((i) => i.crop_id === c.id && i.crop_year === d.year && !/fixed/i.test(i.category ?? '')))
        .map((c) => ({ area: 'Crops', item: c.name, missing: `No input costs for ${d.year}`, where: 'Crop settings → the crop → Inputs', path: '/crops' }))
    },
  },
  {
    // The 50/50 deals take hail and crop insurance off the top; with no line
    // named for it, nothing comes off.
    id: 'insurance',
    run: (d) =>
      d.inputs.some((i) => i.crop_year === d.year && /insurance|hail|afsc/i.test(`${i.name ?? ''} ${i.category ?? ''}`))
        ? []
        : [{ area: 'Money', item: `Insurance ${d.year}`, missing: 'No crop or hail insurance premium in any crop’s inputs', where: 'Crop settings → a crop → Inputs', path: '/crops' }],
  },
  {
    id: 'fixed-costs',
    ownersOnly: true,
    run: (d) => {
      const out: MissingItem[] = []
      if (!d.fixedCosts.some((f) => f.crop_year === d.year)) out.push({ area: 'Money', item: `Fixed costs ${d.year}`, missing: 'Not set for the year', where: 'Financials → Farm costs', path: '/plan?tab=farm%20costs' })
      else if (!d.fixedLines.some((l) => l.crop_year === d.year)) out.push({ area: 'Money', item: `Fixed costs ${d.year}`, missing: 'One lump sum; the breakdown (land, interest, depreciation, labour…) is not entered', where: 'Financials → Farm costs', path: '/plan?tab=farm%20costs' })
      if (d.fixedLines.some((l) => l.crop_year === d.year) && !d.fixedLines.some((l) => l.crop_year === d.year && /interest/i.test(l.category ?? '')))
        out.push({ area: 'Money', item: `Operating interest ${d.year}`, missing: 'No interest line in the fixed costs', where: 'Financials → Farm costs', path: '/plan?tab=farm%20costs' })
      return out
    },
  },
  {
    id: 'unmatched-products',
    run: (d) => {
      const resolve = productResolver(d.products, d.aliases)
      const ignored = new Set(d.aliases.filter((a) => a.ignored).map((a) => a.deere_name.trim().toLowerCase()))
      const names = new Map<string, number>()
      for (const op of d.ops) for (const s of sprayedProducts(op.products, resolve)) if (!s.matched && !ignored.has(s.deereName.toLowerCase())) names.set(s.deereName, (names.get(s.deereName) ?? 0) + 1)
      return [...names]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([n, passes]) => ({ area: 'Spraying', item: n, missing: `Deere name not matched to the price book (${passes} pass${passes === 1 ? '' : 'es'}) — no price, no PCP number`, where: 'Fertilizer → Pricing', path: '/fertilizer?tab=Pricing' }))
    },
  },
  {
    // The grazing restrictions and the rotation's re-crop rules are read off
    // each label; one not read yet is a product the checks know nothing about.
    id: 'label-rules',
    run: (d) => {
      const regs = new Set(d.products.map((p) => p.pmra_registration?.trim()).filter((x): x is string => !!x))
      const name = new Map(d.products.filter((p) => p.pmra_registration).map((p) => [p.pmra_registration!.trim(), p.name]))
      const label = new Map(d.labels.map((l) => [l.registration_number, l]))
      const done = (s: string | null | undefined) => s === 'read' || s === 'none_on_label'
      return [...regs]
        .map((reg) => {
          const l = label.get(reg)
          const gaps = [!done(l?.grazing_rules_status) ? 'grazing' : null, !done(l?.recrop_status) ? 're-cropping' : null].filter((x): x is string => !!x)
          return gaps.length ? { area: 'Spraying', item: `${name.get(reg) ?? 'Product'} (PCP ${reg})`, missing: `Label not read for ${list(gaps)} rules`, where: 'Chemical → the product → Read label', path: '/chemicals' } : null
        })
        .filter((x): x is MissingItem => x != null)
        .sort((a, b) => a.item.localeCompare(b.item))
    },
  },
  {
    // The migration's starting figures: every class got these, and the
    // feed budget runs on them until someone weighs and scores the cattle.
    id: 'herd-defaults',
    run: (d) => {
      const ranch = new Map(d.ranches.map((r) => [r.id, r.name]))
      const start = (c: string) => (/bull/i.test(c) ? 1700 : /heifer/i.test(c) ? 900 : /cal(f|ves)/i.test(c) ? 650 : /cow/i.test(c) ? 1400 : null)
      return d.herd
        .filter((h) => (h.head_count ?? 0) > 0 && num(h.avg_weight_lb) === start(h.class_name) && num(h.bcs) === 3)
        .map((h) => ({
          area: 'Cattle',
          item: `${ranch.get(h.ranch_id ?? '') ?? 'Ranch'} · ${h.class_name}`,
          missing: `Weight (${num(h.avg_weight_lb)?.toLocaleString('en-CA')} lb) and condition score (3) are still the starting figures`,
          where: 'Herd',
          path: '/herd',
        }))
    },
  },
  {
    id: 'feed-on-hand',
    run: (d) =>
      d.ranches
        .filter((r) => !d.feed.some((f) => f.ranch_id === r.id && (num(f.remaining_lb) ?? 0) > 0))
        .map((r) => ({ area: 'Cattle', item: `${r.name} feed`, missing: 'No feed counted on hand — “Will the feed last” cannot answer', where: 'Feed records → Feed put up → Counted on hand', path: '/feed-records' })),
  },
  {
    id: 'cattle-costs',
    run: (d) =>
      d.ranches
        .map((r) => {
          const row = [...d.cattleCosts].filter((c) => c.ranch === r.name && c.crop_year <= d.year).sort((a, b) => b.crop_year - a.crop_year)[0]
          if (!row) return { area: 'Cattle', item: `${r.name} costs`, missing: 'No cost assumptions (cow, feed, pasture, vet)', where: 'Cattle → Settings', path: '/cattle-settings' }
          const named: [string, unknown][] = [
            ['cow cost', row.cow_cost_per_head],
            ['feed cost', row.feed_cost_per_head],
            ['pasture cost', row.pasture_cost_per_head],
            ['vet cost', row.vet_cost_per_head],
          ]
          const none = named.filter(([, v]) => num(v) == null).map(([k]) => k)
          // A per-head cost under $10 is a test figure, not a real one.
          const tiny = named.filter(([, v]) => num(v) != null && num(v)! < 10).map(([k, v]) => `${k} $${num(v)}`)
          const gaps = [...(none.length ? [`no ${list(none)}`] : []), ...(tiny.length ? [`${list(tiny)} a head looks like a placeholder`] : [])]
          if (num(row.death_loss_pct) == null || num(row.weaning_rate_pct) == null) gaps.push('no death loss or weaning rate')
          return gaps.length ? { area: 'Cattle', item: `${r.name} costs`, missing: sentence(gaps), where: 'Cattle → Settings', path: '/cattle-settings' } : null
        })
        .filter((x): x is MissingItem => x != null),
  },
  {
    id: 'pasture-links',
    run: (d) =>
      d.grazingPastures
        .filter((g) => g.active !== false && !g.pasture_id)
        .map((g) => ({ area: 'Cattle', item: g.name, missing: 'On the grazing list but not linked to a mapped pasture', where: 'Grazing', path: '/grazing' })),
  },
  {
    id: 'my-maps',
    run: (d) =>
      d.ranches.filter((r) => !r.mymaps_url).map((r) => ({ area: 'Cattle', item: `${r.name} map`, missing: 'Google My Map not linked — its pastures and water points are not synced', where: 'Cattle → Map', path: '/cattle' })),
  },
  {
    id: 'leases',
    run: (d) =>
      d.leases
        .filter((l) => l.active !== false)
        .map((l) => {
          const gaps: string[] = []
          if (!l.start_date) gaps.push('start date')
          if (!l.end_date) gaps.push('end date')
          if (num(l.acres) == null) gaps.push('acres')
          const share = l.arrangement && /share|profit/i.test(l.arrangement)
          if (!share && num(l.rent_per_acre) == null && num(l.rent_total) == null) gaps.push('rent')
          if (share && num(l.crop_share_pct) == null && num(l.our_share_pct) == null) gaps.push('share')
          return gaps.length ? { area: 'Leases', item: l.landlord ?? l.legal_land ?? 'A lease', missing: `No ${list(gaps)}`, where: 'Leases', path: '/leases' } : null
        })
        .filter((x): x is MissingItem => x != null),
  },
]

/** Every check's rows, owner-only ones only for an owner, minus those whose page the person cannot use. */
export function missingItems(d: MissingData, o: { isOwner: boolean; viewOff?: (path: string) => boolean }): MissingItem[] {
  return CHECKS.filter((c) => !c.ownersOnly || o.isOwner)
    .flatMap((c) => c.run(d))
    .filter((i) => !o.viewOff?.(i.path.split('?')[0]))
}

/** The order areas are listed in. */
const AREAS = ['Fields', 'Crops', 'Money', 'Spraying', 'Irrigation', 'Travel & trucking', 'Cattle', 'Leases']

export function missingGroups(items: MissingItem[]): ReportGroup[] {
  const by = new Map<string, Cell[][]>()
  for (const i of items) by.set(i.area, [...(by.get(i.area) ?? []), [i.item, i.missing, i.where, i.path]])
  return [...by]
    .sort((a, b) => (AREAS.indexOf(a[0]) + 1 || 99) - (AREAS.indexOf(b[0]) + 1 || 99))
    .map(([area, rows]) => ({ title: area, note: `${rows.length} to fill in`, rows }))
}

/* ── Loading ────────────────────────────────────────────────────────────── */

/** One read of everything the checks look at. Takes the client so a script can run it too. */
export async function loadMissingData(sb: SupabaseClient, year: number, isOwner: boolean): Promise<MissingData> {
  // The few filters used here, without the client's full generic typing
  // (which gives up on a table name that is only a string).
  type Sel = {
    eq: (c: string, v: unknown) => Sel
    gte: (c: string, v: unknown) => Sel
    lte: (c: string, v: unknown) => Sel
    is: (c: string, v: null) => Sel
    order: (c: string) => Sel
    range: (a: number, b: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>
  }
  const all = <T>(table: string, cols: string, filter?: (q: Sel) => Sel, order = 'id') =>
    fetchAll<T>((a, b) => {
      let q = sb.from(table).select(cols) as unknown as Sel
      if (filter) q = filter(q)
      return q.order(order).range(a, b)
    })
  const [fields, plans, tenure, crops, prices, inputs, pivots, pumps, entries, routes, ops, products, aliases, labels, ranches, herd, feed, cattleCosts, leases, grazingPastures, licences, allotments, fixedCosts, fixedLines, progress, loads, history] =
    await Promise.all([
      all<MissingData['fields'][number]>('fields', 'id, name, active, legal_land_description'),
      all<MissingData['plans'][number]>('crop_plans', 'field_id, crop_id, crop_year, planned_acres', (q) => q.eq('crop_year', year)),
      all<MissingData['tenure'][number]>('field_year_tenure', 'field_id, crop_year, rented_to', (q) => q.eq('crop_year', year)),
      all<MissingData['crops'][number]>('crops', 'id, name, active, default_yield_per_acre, renter_only, land_rent_only'),
      all<MissingData['prices'][number]>('crop_prices', 'crop_id, crop_year, price_per_unit', (q) => q.lte('crop_year', year)),
      all<MissingData['inputs'][number]>('crop_inputs', 'crop_id, crop_year, name, category', (q) => q.eq('crop_year', year)),
      all<MissingData['pivots'][number]>(
        'field_pivots',
        'field_id, pump_id, gpm, acres_irrigated, water_source, water_licence_id, smrid_area, sprinkler_package, drop_height_ft, pressure_regulators, nozzles_replaced_year, end_gun, pivot_pressure_psi, operated_by, fields(name, active)',
      ),
      all<MissingData['pumps'][number]>('pumps', 'id, name, horse_power, gpm'),
      all<MissingData['entries'][number]>('field_entries', 'field_id'),
      all<MissingData['routes'][number]>('road_routes', 'from_key, to_key, method', (q) => q.eq('from_key', 'shop')),
      all<MissingData['ops'][number]>('jd_field_operations', 'products, crop_season', (q) =>
        q.eq('operation_type', 'application').gte('crop_season', year - 1).is('duplicate_of', null).is('not_ours', null),
      ),
      all<PriceBookProduct>('jd_products', 'id, name, pmra_registration'),
      all<PriceBookAlias>('jd_product_aliases', 'deere_name, product_id, ignored', undefined, 'deere_name'),
      all<MissingData['labels'][number]>('chemical_labels', 'registration_number, grazing_rules_status, recrop_status', undefined, 'registration_number'),
      all<MissingData['ranches'][number]>('ranches', 'id, name, mymaps_url'),
      all<MissingData['herd'][number]>('herd_counts', 'ranch_id, class_name, head_count, avg_weight_lb, bcs'),
      all<MissingData['feed'][number]>('feed_on_hand', 'ranch_id, remaining_lb', undefined, 'ranch_id'),
      all<MissingData['cattleCosts'][number]>('cattle_cost_assumptions', 'ranch, crop_year, cow_cost_per_head, feed_cost_per_head, pasture_cost_per_head, vet_cost_per_head, death_loss_pct, weaning_rate_pct'),
      all<MissingData['leases'][number]>('land_leases', 'landlord, legal_land, acres, start_date, end_date, rent_per_acre, rent_total, crop_share_pct, our_share_pct, arrangement, active'),
      all<MissingData['grazingPastures'][number]>('grazing_pastures', 'name, active, pasture_id'),
      all<MissingData['licences'][number]>('water_licences', 'licence_number, volume'),
      all<MissingData['allotments'][number]>('water_allotments', 'year', (q) => q.eq('source', 'smrid'), 'year'),
      // Row security returns nothing to anyone else; not asking at all is plainer.
      isOwner ? all<MissingData['fixedCosts'][number]>('farm_fixed_costs', 'crop_year', (q) => q.eq('crop_year', year)) : Promise.resolve([]),
      isOwner ? all<MissingData['fixedLines'][number]>('farm_fixed_cost_lines', 'crop_year, category', (q) => q.eq('crop_year', year)) : Promise.resolve([]),
      all<MissingData['progress'][number]>('field_season_progress', 'field_id, crop_year, has_harvest', (q) => q.eq('crop_year', year), 'field_id'),
      all<MissingData['loads'][number]>('bin_loads', 'field_id', (q) => q.eq('crop_year', year)),
      all<MissingData['history'][number]>('crop_history', 'field_id, crop_year, yield_per_acre, clean_yield_per_acre', (q) => q.eq('crop_year', year)),
    ])
  return { year, fields, plans, tenure, crops, prices, inputs, pivots, pumps, entries, routes, ops, products, aliases, labels, ranches, herd, feed, cattleCosts, leases, grazingPastures, licences, allotments, fixedCosts, fixedLines, progress, loads, history }
}

export const MISSING_COLUMNS = [{ label: 'Item' }, { label: 'What is missing' }, { label: 'Where to fill it in' }, { label: 'Page', link: true }]

export async function gatherMissing(p: ParamValues, ctx: GatherContext): Promise<ReportData> {
  const year = yearParam(p, ctx)
  const data = await loadMissingData(supabase as unknown as SupabaseClient, year, ctx.isOwner)
  const items = missingItems(data, { isOwner: ctx.isOwner, viewOff: ctx.viewOff })
  if (!items.length) throw new Error('Nothing is missing — every check passed.')
  const groups = missingGroups(items)
  return {
    title: 'Missing information',
    subtitle: `What the app still needs filled in · ${year}`,
    meta: groups.slice(0, 10).map((g) => [g.title, g.rows.length] as [string, Cell]),
    summary: [
      'Each line is something the app is estimating, guessing or leaving blank until a person fills it in, and the page where it is filled in. Fixing one removes it from the next copy of this report.',
    ],
    columns: MISSING_COLUMNS,
    groups,
    groupLabel: 'Area',
    filename: `Missing information ${ctx.today}`,
  }
}
