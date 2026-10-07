import type { Geometry, MultiPolygon } from 'geojson'
import { supabase } from '@/lib/supabase'
import { distanceToFeature } from '@/lib/aopa'
import { haToAcres } from '@/lib/applied'
import { asTrait, grownTrait, isBothTraits, isCanola, TRAIT_SHORT, volunteerConflicts } from '@/lib/canola-trait'
import { companyLookup, cropLabel as companyCropLabel } from '@/lib/crop-label'
import { mergeMixEntries, unitLabel, type OpProduct, type OpVariety } from '@/lib/fieldOps'
import { loadPhiSeason, type PhiSeason } from '@/lib/phi-data'
import { boundariesForYear, compareFieldNames, type BoundaryRow } from '@/lib/queries'
import { cropKey, groupOf } from '@/lib/rotation-engine'
import { albertaDay, type ResolvedProduct } from '@/lib/spray-products'
import type { ReportSection } from '@/lib/table-report'
import { fetchAll, fieldLabel, num, pick, yearParam, type Cell, type GatherContext, type ParamValues, type ReportColumn, type ReportData, type ReportGroup, type SectionedReport } from './framework'
import { loadSeasonBasics, yieldText, type CropArea, type DayFrom, type HistoryLite } from './field-season'
import { fieldFertility, loadFertility, type FertilityData, type FertSource } from './nutrients'
import { fertilizerOnly, loadSprayOps, loadSprayResolver, sprayRows, type SprayOp } from './spray'

/**
 * Contract canola field records: one record per field of seed canola grown
 * for a company (BASF, Corteva, Nutrien), with the sections their field
 * records ask for — the field, its crop history, how far it is from our other
 * canola, the seeding, every pesticide with its PCP number and pre-harvest
 * interval, the fertilizer, and the harvest into bins and out on tickets.
 *
 * It mirrors what those records cover; it is NOT the company's own form. What
 * the app does not hold (a seed lot, a cleanout date, a ticket number) is left
 * blank with "Fill in" beside it, never guessed.
 *
 * What the companies and the seed rules ask for, read 3 Oct 2026:
 *  - CSGA Circular 6, section 5, certified hybrid canola: no spring B. napus,
 *    carinata, mustard or radish on the land in the 3 years before (5 for
 *    B. rapa / winter B. napus); 800 m isolation from any other canola.
 *    https://seedgrowers.ca/wp-content/uploads/2019/01/Circ6-SECTION-05-ENGLISH_Rev02.01-2019_20181217.pdf
 *    https://seedgrowers.ca/wp-content/uploads/pdf/en/2022/CANOLA_(HYBRID_B.NAPUS_&_B.RAPA)_C_ENGLISH_Rev.__0201-2020_20211014.pdf
 *  - Southern Alberta hybrid seed growers: the farm grows no other canola and
 *    none within 800 m of the seed field; all under irrigation.
 *    https://www.producer.com/news/alta-firm-major-player-in-hybrid-canola-business/
 *  - CFIA's crop inspection reads the planting date and the pedigree of the
 *    seed planted off the application for inspection.
 *    https://inspection.canada.ca/plant-health/seeds/seed-inspection-procedures/open-pollinated-and-hybrid-cruciferous-seed-crop-i/eng/1347390022952/1347391637966
 *  - BASF's Liberty & Trait Agreement and Corteva's Canada canola Product Use
 *    Guide bind the grower to their stewardship terms (one crop, no saved seed).
 *    https://agriculture.basf.ca/west/invigor-hybrid-canola/lta.html
 *    https://www.corteva.com/content/dam/dpagco/corteva/na/ca/en/files/trait-stewardship/DF-Corteva-Canada-English-Canola-PUG.pdf
 *  - Keep it Clean (Canola Council, Cereals Canada, Pulse Canada): follow the
 *    label and its PHI, check the year's product advisory for export (MRL)
 *    concerns. The 2026 advisory lists none for products registered on canola.
 *    https://keepitclean.ca/tools-resources/product-advisory/
 *
 * Rules are the app's own, not new ones: the canola break is the contract
 * crop's return interval and the rotation engine's canola host group
 * (rotation-engine.ts); same-trait volunteers are canola-trait.ts's rule.
 * Only canola is flagged: no mustard or other brassica has ever been grown on
 * the farm's land (Sam, 3 Oct 2026). The companies want 1 mile of isolation
 * for seed production, more than CSGA's 800 m, so ISOLATION_M is a mile.
 */

/** One mile: the seed companies' isolation for seed canola production (Sam, 3 Oct 2026). */
export const ISOLATION_M = 1609
/** Years of history each record shows. */
export const HISTORY_YEARS = 5

/* ── The record's lines ─────────────────────────────────────────────────── */

/** One line of a record. Each section shows the keys it needs; the CSV has them all. */
export type Line = {
  date?: Cell
  item?: Cell
  detail?: Cell
  pcp?: Cell
  rate?: Cell
  unit?: Cell
  water?: Cell
  area?: Cell
  amount?: Cell
  nutrients?: Cell
  phi?: Cell
  clear?: Cell
  check?: Cell
  caution?: Cell
  note?: Cell
}
type Key = keyof Line

/** A line the app has no value for: the value blank, and what to fill in. */
export const fillIn = (item: Cell, what: string, rest: Line = {}): Line => ({ ...rest, item, note: `Fill in: ${what}` })

const FLAT: { key: Key; col: ReportColumn }[] = [
  { key: 'date', col: { label: 'Date / year' } },
  { key: 'item', col: { label: 'Item' } },
  { key: 'detail', col: { label: 'Detail' } },
  { key: 'pcp', col: { label: 'PCP no.' } },
  { key: 'rate', col: { label: 'Rate', upTo: 3 } },
  { key: 'unit', col: { label: 'Rate unit' } },
  { key: 'water', col: { label: 'Water volume' } },
  { key: 'area', col: { label: 'Area (ac)', decimals: 1 } },
  { key: 'amount', col: { label: 'Amount' } },
  { key: 'nutrients', col: { label: 'N-P2O5-K2O-S (lb/ac)' } },
  { key: 'phi', col: { label: 'PHI (days)', decimals: 0 } },
  { key: 'clear', col: { label: 'Clear to harvest' } },
  { key: 'check', col: { label: 'Check' } },
  { key: 'caution', col: { label: 'Keep it Clean / MRL' } },
  { key: 'note', col: { label: 'Note' } },
]

type SectionSpec = { name: string; note?: string; cols: [Key, string][]; lines: Line[]; empty?: string }

const SECTION_COLS = {
  field: [['item', 'Item'], ['detail', 'Record'], ['note', 'Note']],
  history: [['date', 'Year'], ['item', 'Crop'], ['detail', 'Variety / company'], ['check', 'Volunteer risk'], ['note', 'Note']],
  isolation: [['item', 'Field'], ['detail', 'Crop'], ['amount', 'Distance (m)'], ['check', 'Within 1 mile'], ['note', 'Note']],
  seeding: [['date', 'Date'], ['item', 'Variety'], ['detail', 'Seed lot'], ['rate', 'Rate'], ['unit', 'Rate unit'], ['area', 'Area (ac)'], ['note', 'Note']],
  spray: [
    ['date', 'Date'],
    ['item', 'Product'],
    ['pcp', 'PCP no.'],
    ['detail', 'Type'],
    ['rate', 'Rate'],
    ['unit', 'Rate unit'],
    ['water', 'Water'],
    ['area', 'Area (ac)'],
    ['phi', 'PHI (days)'],
    ['clear', 'Clear to harvest'],
    ['check', 'PHI check'],
    ['caution', 'Keep it Clean / MRL'],
    ['note', 'Operator / note'],
  ],
  fertility: [['date', 'Date'], ['detail', 'Source'], ['item', 'Product'], ['rate', 'Rate'], ['unit', 'Unit'], ['amount', 'Total'], ['nutrients', 'N-P2O5-K2O-S lb/ac'], ['note', 'Note']],
  harvest: [['date', 'Date'], ['item', 'Item'], ['detail', 'Detail'], ['amount', 'Amount'], ['note', 'Note']],
} satisfies Record<string, [Key, string][]>

/* ── Which fields are contract canola ───────────────────────────────────── */

export type CanolaCrop = {
  id: string
  name: string
  category: string | null
  herbicide_trait: string | null
  min_return_years: number | null
  average_of: string[] | null
  yield_unit: string | null
}

/**
 * The company a canola is grown for, or null when it is not contract canola.
 * The variety's company first (crop-label.ts: the company is the variety's);
 * else a seed-category canola named for its company ("BASF Canola"). A
 * planning stand-in (Unknown Canola, average_of set) has no company yet.
 */
export function contractCompany(crop: CanolaCrop | undefined, variety: string | null, companyOf: (cropId: string, variety: string | null) => string | null): string | null {
  if (!crop || !isCanola(crop.name) || crop.average_of?.length) return null
  const own = companyOf(crop.id, variety)
  if (own) return own
  if (crop.category !== 'seed') return null
  const prefix = crop.name.replace(/canola/i, '').trim()
  return prefix && !/^unknown$/i.test(prefix) ? prefix : null
}

/* ── Field history ──────────────────────────────────────────────────────── */

export type PastCrop = { fieldId: string; year: number; cropId: string | null; variety: string | null; source: 'history' | 'plan' }

/**
 * The field's crops in the years before, newest first, each canola flagged:
 * inside the contract crop's own return interval between canola crops (the
 * rotation engine's canola host group), and of the same herbicide trait as
 * the contract crop inside canola-trait's volunteer window. History wins over
 * a plan for a year; a year with neither is a line to fill in.
 */
export function historyLines(o: {
  year: number
  contract: CanolaCrop
  past: PastCrop[]
  crops: CanolaCrop[]
  companyOf: (cropId: string, variety: string | null) => string | null
  span?: number
}): { lines: Line[]; flagged: number } {
  const byId = new Map(o.crops.map((c) => [c.id, c]))
  const minReturn = o.contract.min_return_years ?? 0
  const window = minReturn > 0 ? minReturn : (o.span ?? HISTORY_YEARS)
  const trait = asTrait(o.contract.herbicide_trait)
  const lines: Line[] = []
  let flagged = 0
  for (let y = o.year - 1; y >= o.year - (o.span ?? HISTORY_YEARS); y--) {
    const hist = o.past.filter((p) => p.year === y && p.source === 'history')
    const rows = hist.length ? hist : o.past.filter((p) => p.year === y && p.source === 'plan')
    if (!rows.length) {
      lines.push(fillIn(null, 'no crop on record for this year', { date: y }))
      continue
    }
    for (const r of rows) {
      const crop = r.cropId ? byId.get(r.cropId) : undefined
      const name = crop?.name ?? null
      const company = r.cropId ? o.companyOf(r.cropId, r.variety) : null
      const canola = name != null && groupOf(cropKey(name)) === 'canola'
      const ago = o.year - y
      const checks: string[] = []
      const notes: string[] = [r.source === 'history' ? 'crop history' : 'crop plan (no history for the year)']
      if (canola) {
        checks.push(ago <= window ? `canola ${ago} yr before, inside the ${window}-year break` : 'canola, outside the break')
        const grown = grownTrait(crop, company, o.crops)
        if (trait && grown) {
          const clash = volunteerConflicts({ name: o.contract.name, trait }, o.year, [{ year: y, crop: name, trait: grown.trait }])
          if (clash.length) {
            checks.push(`same trait (${TRAIT_SHORT[trait]})`)
            notes.push(clash[0])
          }
        } else if (!grown) notes.push('herbicide trait not known')
        if (ago <= window || checks.length > 1) flagged++
      }
      lines.push({
        date: y,
        item: name ?? 'crop not named',
        detail: [r.variety, company && !(r.variety ?? '').toLowerCase().includes(company.toLowerCase()) ? company : null].filter(Boolean).join(' · ') || null,
        check: checks.join('; ') || (name ? 'none' : null),
        note: notes.join('; '),
      })
    }
  }
  return { lines, flagged }
}

/* ── Isolation ──────────────────────────────────────────────────────────── */

export type CanolaPlace = { key: string; fieldId: string; field: string; crop: string; company: string | null; geometry: Geometry | null }

const asMulti = (g: Geometry): MultiPolygon | null =>
  g.type === 'MultiPolygon' ? g : g.type === 'Polygon' ? { type: 'MultiPolygon', coordinates: [g.coordinates] } : null

/**
 * Edge-to-edge distance from this field's canola to each of our other canola
 * areas the same year (aopa.ts's measure, the one the manure setbacks use),
 * nearest first, with the ones inside the isolation distance flagged.
 */
export function isolationLines(target: CanolaPlace, others: CanolaPlace[]): { lines: Line[]; within: number } {
  const from = target.geometry ? asMulti(target.geometry) : null
  const measured = others
    .filter((o) => o.key !== target.key)
    .map((o) => {
      const d = from && o.geometry ? distanceToFeature(from, o.geometry) : null
      return { o, d: d != null && Number.isFinite(d) ? d : null }
    })
    .sort((a, b) => (a.d ?? Infinity) - (b.d ?? Infinity) || compareFieldNames(a.o.field, b.o.field))
  let within = 0
  const lines: Line[] = measured.map(({ o, d }) => {
    const close = d != null && d < ISOLATION_M
    if (close) within++
    const sameContract = (o.company ?? '').toLowerCase() === (target.company ?? '').toLowerCase() && o.crop === target.crop
    return {
      item: fieldLabel(o.field),
      detail: companyCropLabel(o.crop, o.company),
      amount: d == null ? null : Math.round(d),
      check: d == null ? null : close ? 'yes' : 'no',
      note:
        d == null
          ? `Fill in: ${from ? 'that field has' : 'this field has'} no boundary on the map`
          : [o.fieldId === target.fieldId ? 'another area of the same field' : null, close ? (sameContract ? 'same contract: check it is the same hybrid' : 'different contract or crop') : null].filter(Boolean).join('; ') || null,
    }
  })
  if (!others.some((o) => o.key !== target.key)) lines.push({ item: 'Our other canola', detail: 'none this year', note: null })
  lines.push(fillIn('Neighbours’ canola', 'any canola within 1 mile (1,609 m) — neighbours’ fields are not in the app'))
  return { lines, within }
}

/* ── Seeding ────────────────────────────────────────────────────────────── */

export type SeedingOp = { id: string; field_id: string | null; started_at: string | null; operator_name: string | null; applied_area_ha: unknown; products: unknown; varieties: unknown }

/** Each Deere seeding pass: date, variety, rate and acres. Deere sends no seed lot, so it is to fill in. */
export function seedingLines(ops: SeedingOp[], seeded: DayFrom | null, planVariety: string | null): Line[] {
  const lines: Line[] = []
  for (const o of [...ops].sort((a, b) => (a.started_at ?? '').localeCompare(b.started_at ?? ''))) {
    const varieties = ((o.varieties ?? []) as OpVariety[]).map((v) => [v.brand, v.name].filter(Boolean).join(' ')).filter(Boolean)
    const products = mergeMixEntries((o.products ?? []) as OpProduct[])
    const rated = products.find((p) => p.rate?.value != null)
    const ha = num(o.applied_area_ha)
    lines.push({
      date: o.started_at ? albertaDay(o.started_at) : null,
      item: varieties.join(', ') || products.map((p) => p.name).filter(Boolean).join(', ') || planVariety,
      detail: null,
      rate: rated?.rate?.value ?? null,
      unit: unitLabel(rated?.rate?.unitId) || null,
      area: ha != null && ha > 0 ? Math.round(haToAcres(ha) * 10) / 10 : null,
      note: ['Fill in: seed lot / tag number', rated ? null : 'and the seeding rate', o.operator_name ? `operator ${o.operator_name}` : null, 'John Deere'].filter(Boolean).join('; '),
    })
  }
  if (!lines.length && seeded) lines.push({ date: seeded.date, item: planVariety, note: `Fill in: seed lot / tag number and the seeding rate; date ${seeded.from}` })
  if (!lines.length) lines.push(fillIn(planVariety, 'seeding date, seed lot / tag number and rate'))
  return lines
}

/* ── Pesticides ─────────────────────────────────────────────────────────── */

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)

/** The label's PHI against the harvest: when it is clear, and whether harvest kept to it. */
export function phiCheck(applied: string | null, phi: number | null, harvest: string | null, today: string): { clear: string | null; check: string } {
  if (!applied) return { clear: null, check: 'no date on the pass' }
  if (phi == null) return { clear: null, check: 'PHI unknown: label not read, or the crop is not on it' }
  const clear = addDays(applied, phi)
  if (harvest) {
    const early = daysBetween(harvest, clear)
    return { clear, check: early > 0 ? `harvest began ${early} day${early === 1 ? '' : 's'} inside the PHI` : 'clear when harvest began' }
  }
  return { clear, check: clear <= today ? 'clear now' : `not clear until ${clear}` }
}

/** The tank's carrier (water) rate, from Deere's tank mix record. */
export function waterVolume(products: unknown): string | null {
  for (const p of mergeMixEntries((products ?? []) as OpProduct[])) {
    const r = p.carrier?.rate
    if (r?.value != null) {
      const v = Number(r.value).toLocaleString('en-CA', { maximumFractionDigits: 1 })
      const name = p.carrier?.name && !/water/i.test(p.carrier.name) ? `${p.carrier.name} ` : ''
      return `${name}${v} ${unitLabel(r.unitId)}`.trim()
    }
  }
  return null
}

/** The PHI the Harvest page reads for a product put on a field on a day. */
export function phiLookup(season: PhiSeason): (fieldId: string, day: string, reg: string | null, product: string) => number | null {
  const norm = (s: string) => s.replace(/[®™]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
  return (fieldId, day, reg, product) => {
    const mine = season.apps.filter((a) => a.fieldId === fieldId && (reg ? a.registration === reg : norm(a.product) === norm(product)))
    // The two records date a pass in different time zones now and then: a day either side is the same pass.
    const hit = mine.find((a) => a.appliedOn === day) ?? mine.find((a) => Math.abs(daysBetween(a.appliedOn, day)) <= 1)
    return hit?.phiDays ?? null
  }
}

export function sprayLines(o: {
  fieldId: string
  ops: SprayOp[]
  fieldAcres: number
  resolve: (deereName: string) => ResolvedProduct | undefined
  phiOf: ReturnType<typeof phiLookup>
  harvest: string | null
  today: string
}): { lines: Line[]; unmatched: Set<string>; unknownPhi: number; early: number } {
  const out: { at: string; line: Line }[] = []
  const unmatched = new Set<string>()
  let unknownPhi = 0
  let early = 0
  for (const op of o.ops.filter((x) => x.field_id === o.fieldId && !fertilizerOnly(x.products))) {
    const water = waterVolume(op.products)
    const r = sprayRows([op], o.fieldAcres, o.resolve)
    r.unmatched.forEach((n) => !/^-+$/.test(n.trim()) && unmatched.add(n))
    for (const s of r.rows) {
      // A fertilizer in the tank is in the fertilizer section, as the season summary has it.
      if (s[4] === 'fertilizer') continue
      const empty = /^-+$/.test(String(s[2] ?? '').trim())
      const day = s[0] as string | null
      const adjuvant = s[4] === 'adjuvant'
      const phi = empty || adjuvant || !day ? null : o.phiOf(o.fieldId, day, (s[3] as string | null) ?? null, String(s[2] ?? ''))
      const c = empty || adjuvant ? null : phiCheck(day, phi, o.harvest, o.today)
      if (c && phi == null) unknownPhi++
      if (c?.check.includes('inside the PHI')) early++
      out.push({
        at: String(day ?? ''),
        line: {
          date: day,
          item: empty ? 'product not named in Deere' : s[2],
          pcp: s[3] ?? null,
          detail: s[4],
          rate: s[5],
          unit: s[6],
          water,
          area: typeof s[7] === 'number' ? Math.round(s[7] * 10) / 10 : null,
          phi,
          clear: c?.clear ?? null,
          check: adjuvant ? 'adjuvant: no PHI' : (c?.check ?? null),
          caution: null,
          note: [s[9], s[3] == null && !empty ? 'Fill in: PCP no. (not matched to the price book)' : null, empty ? 'Fill in: the product' : null].filter(Boolean).join('; ') || null,
        },
      })
    }
  }
  out.sort((a, b) => a.at.localeCompare(b.at))
  return { lines: out.map((x) => x.line), unmatched, unknownPhi, early }
}

/* ── Fertilizer ─────────────────────────────────────────────────────────── */

const FERT_SOURCE: Record<FertSource, string> = { machine: 'machine record', retailer: 'retailer (ICI ticket)', manure: 'manure credit' }
const lb = (v: number) => Math.round(v).toString()

export function fertilityLines(fieldId: string, year: number, d: FertilityData, fieldAcres: number | null): Line[] {
  return fieldFertility(fieldId, year, d, fieldAcres).lines.map((l) => ({
    date: l.date,
    detail: FERT_SOURCE[l.source],
    item: l.product,
    rate: l.rate,
    unit: l.unit,
    amount: l.total,
    nutrients: l.nutrients ? `${lb(l.nutrients.n)}-${lb(l.nutrients.p2o5)}-${lb(l.nutrients.k2o)}-${lb(l.nutrients.s)}` : null,
    note: l.note,
  }))
}

/* ── Harvest, bins and delivery ─────────────────────────────────────────── */

export type HarvestIn = { field_id: string | null; bin_id: string; bushels: unknown; moved_at: string; ticket_number: string | null }
export type FieldLoad = { id: string; field_id: string | null; delivery_site_id: string | null; loaded_on: string; bushels: unknown }
export type Ticket = { bin_load_id: string | null; bin_id: string | null; crop_id: string | null; ticket_no: string | null; delivered_on: string; buyer: string | null }
export type DeliveryMove = { bin_id: string; field_id: string | null; crop_id: string | null; moved_at: string; ticket_number: string | null; bushels: unknown }
export type BinFill = { bin_id: string; emptied_on: string | null; crop_year: number; crop_id: string | null }

const bu = (v: number) => `${Math.round(v).toLocaleString('en-CA')} bu`

/**
 * Harvest to delivery: when it began and what it yielded, each bin it went
 * into (the grain movements ledger, which carries every load), a cleanout
 * line per bin and per machine to fill in, and every delivery ticket the app
 * can tie to the field.
 */
export function harvestLines(o: {
  fieldId: string
  cropId: string
  harvested: DayFrom | null
  yields: HistoryLite[]
  yieldUnit: string | null
  moves: HarvestIn[]
  loads: FieldLoad[]
  tickets: Ticket[]
  deliveries: DeliveryMove[]
  fills: BinFill[]
  bin: (id: string | null) => string
  site: (id: string | null) => string
}): Line[] {
  const lines: Line[] = []
  lines.push(o.harvested ? { date: o.harvested.date, item: 'Harvest began', note: o.harvested.from } : fillIn('Harvest began', 'harvest date'))
  const y = o.yields.filter((h) => h.field_id === o.fieldId && h.crop_id === o.cropId && num(h.yield_per_acre) != null)
  if (y.length) for (const h of y) lines.push({ item: 'Yield', amount: yieldText(num(h.yield_per_acre), h.yield_unit ?? o.yieldUnit), note: h.source === 'scale' ? 'from the loads weighed' : (h.source?.replace(/_/g, ' ') ?? null) })
  else lines.push(fillIn('Yield', 'yield (no loads flagged last off the field yet)'))

  const mine = o.moves.filter((m) => m.field_id === o.fieldId)
  const bins = new Map<string, { first: string; last: string; bushels: number; loads: number }>()
  for (const m of mine) {
    const b = bins.get(m.bin_id) ?? { first: m.moved_at, last: m.moved_at, bushels: 0, loads: 0 }
    b.bushels += num(m.bushels) ?? 0
    b.loads++
    if (m.moved_at < b.first) b.first = m.moved_at
    if (m.moved_at > b.last) b.last = m.moved_at
    bins.set(m.bin_id, b)
  }
  const binOrder = [...bins].sort((a, b) => a[1].first.localeCompare(b[1].first))
  for (const [id, b] of binOrder) {
    lines.push({ date: b.first.slice(0, 10), item: 'Into bin', detail: o.bin(id), amount: bu(b.bushels), note: `${b.loads} load${b.loads === 1 ? '' : 's'}${b.last.slice(0, 10) !== b.first.slice(0, 10) ? `, to ${b.last.slice(0, 10)}` : ''}` })
  }
  const direct = o.loads.filter((l) => l.field_id === o.fieldId && l.delivery_site_id)
  if (!bins.size && !direct.length) lines.push(fillIn('Into bin', 'the bins it went into (no loads recorded off the field)'))

  // Cleanout: before the grain went in. The bin's last emptying, where the
  // app has it, is shown beside — emptied is not the same as cleaned.
  for (const [id, b] of binOrder) {
    const before = o.fills.filter((f) => f.bin_id === id && f.emptied_on && f.emptied_on <= b.first.slice(0, 10)).sort((a, z) => (z.emptied_on ?? '').localeCompare(a.emptied_on ?? ''))[0]
    lines.push(fillIn('Bin cleanout', `date ${o.bin(id)} was cleaned out and inspected${before ? ` (last emptied ${before.emptied_on})` : ''}`, { detail: o.bin(id) }))
  }
  for (const m of ['Seeder / drill (before seeding)', 'Combine', 'Grain cart and trucks', 'Augers and conveyors']) lines.push(fillIn('Equipment cleanout', 'date cleaned out and by whom', { detail: m }))

  // Delivery tickets the app can tie to the field.
  const loadIds = new Set(o.loads.filter((l) => l.field_id === o.fieldId).map((l) => l.id))
  const binIds = new Set(bins.keys())
  const seen = new Set<string>()
  const tickets: Line[] = []
  for (const t of o.tickets) {
    const off = t.bin_load_id && loadIds.has(t.bin_load_id)
    const fromBin = !off && t.bin_id && binIds.has(t.bin_id) && t.crop_id === o.cropId
    if (!off && !fromBin) continue
    if (t.ticket_no) seen.add(t.ticket_no.trim())
    tickets.push({
      date: t.delivered_on,
      item: 'Delivery ticket',
      detail: t.ticket_no ?? null,
      note: [t.buyer, off ? 'straight off the field' : `from ${o.bin(t.bin_id)}; the bin may hold other fields’ grain`, t.ticket_no ? null : 'Fill in: ticket number'].filter(Boolean).join('; '),
    })
  }
  for (const m of o.deliveries) {
    if (!binIds.has(m.bin_id) || (m.crop_id && m.crop_id !== o.cropId)) continue
    const no = m.ticket_number && !m.ticket_number.startsWith('load:') ? m.ticket_number.trim() : null
    if (no && seen.has(no)) continue
    tickets.push({ date: m.moved_at.slice(0, 10), item: 'Delivered from bin', detail: no, amount: num(m.bushels) != null ? bu(num(m.bushels)!) : null, note: [`from ${o.bin(m.bin_id)}`, no ? null : 'Fill in: ticket number'].filter(Boolean).join('; ') })
  }
  for (const l of direct) {
    if (o.tickets.some((t) => t.bin_load_id === l.id)) continue
    tickets.push({ date: l.loaded_on, item: 'Load to buyer', detail: null, amount: num(l.bushels) != null ? bu(num(l.bushels)!) : null, note: `to ${o.site(l.delivery_site_id)}; Fill in: ticket number (no buyer ticket matched)` })
  }
  tickets.sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')))
  lines.push(...(tickets.length ? tickets : [fillIn('Delivery tickets', 'ticket numbers')]))
  return lines
}

/* ── Putting a record together ──────────────────────────────────────────── */

export function sectionOf(field: string, s: SectionSpec, first: boolean): ReportSection {
  return {
    title: `${field} · ${s.name}`,
    note: s.note,
    head: s.cols.map(([, label]) => label),
    rows: s.lines.map((l) => s.cols.map(([k]) => l[k] ?? null)),
    empty: s.empty,
    pageBreakBefore: first,
  }
}

/** The flat CSV's rows for one field: one row per line item, its section first, then every key. */
export function flatRows(specs: SectionSpec[]): Cell[][] {
  return specs.flatMap((s) => s.lines.map((l) => [s.name, ...FLAT.map((f) => l[f.key] ?? null)]))
}

/* ── The gather ─────────────────────────────────────────────────────────── */

type ContractArea = CropArea & { company: string; crop0: CanolaCrop }

export async function gatherSeedCanola(p: ParamValues, ctx: GatherContext): Promise<SectionedReport | ReportData> {
  const year = yearParam(p, ctx)
  const fieldId = pick(p, 'field')
  const [basics, crops, varieties, past, pastPlans, bounds, zones, contracts] = await Promise.all([
    loadSeasonBasics(year),
    fetchAll<CanolaCrop>((a, b) => supabase.from('crops').select('id, name, category, herbicide_trait, min_return_years, average_of, yield_unit').order('id').range(a, b)),
    fetchAll<{ crop_id: string; name: string; company: string | null }>((a, b) => supabase.from('crop_varieties').select('crop_id, name, company').order('id').range(a, b)),
    fetchAll<{ field_id: string; crop_year: number; crop_id: string | null; variety: string | null }>((a, b) =>
      supabase.from('crop_history').select('field_id, crop_year, crop_id, variety').gte('crop_year', year - HISTORY_YEARS).lt('crop_year', year).order('id').range(a, b),
    ),
    fetchAll<{ field_id: string; crop_year: number; crop_id: string; variety: string | null }>((a, b) =>
      supabase.from('crop_plans').select('field_id, crop_year, crop_id, variety').gte('crop_year', year - HISTORY_YEARS).lt('crop_year', year).order('id').range(a, b),
    ),
    fetchAll<BoundaryRow>((a, b) => supabase.from('field_boundaries_geojson').select('*').order('id').range(a, b)),
    fetchAll<{ id: string; field_id: string; crop_id: string; geojson: unknown }>((a, b) => supabase.from('field_crop_zones').select('id, field_id, crop_id, geojson').eq('crop_year', year).order('id').range(a, b)),
    fetchAll<{ crop_id: string | null; contract_number: string | null; status: string | null }>((a, b) =>
      supabase.from('contracts').select('crop_id, contract_number, status').eq('crop_year', year).neq('status', 'cancelled').order('id').range(a, b),
    ),
  ])
  const lookup = companyLookup(varieties)
  const companyOf = (cropId: string, variety: string | null) => lookup(cropId, variety)
  const cropById = new Map(crops.map((c) => [c.id, c]))
  const fieldById = new Map(basics.fields.map((f) => [f.id, f]))

  const ours = basics.areas.filter((a) => !a.renters && !basics.rentedOut.has(a.fieldId))
  const contractAreas: ContractArea[] = ours.flatMap((a) => {
    const c = cropById.get(a.cropId)
    const company = contractCompany(c, a.variety, companyOf)
    return c && company ? [{ ...a, company, crop0: c }] : []
  })
  const unknownCompany = ours.filter((a) => isCanola(a.crop) && !contractCompany(cropById.get(a.cropId), a.variety, companyOf))
  const chosen = contractAreas.filter((a) => !fieldId || a.fieldId === fieldId)
  chosen.sort((a, b) => compareFieldNames(fieldById.get(a.fieldId)?.name ?? '', fieldById.get(b.fieldId)?.name ?? ''))
  if (!chosen.length) {
    throw new Error(fieldId ? `That field has no contract canola in ${year}.` : `No field has contract canola (BASF, Corteva, Nutrien) planned for ${year}.`)
  }
  const ids = [...new Set(chosen.map((a) => a.fieldId))]

  const [ops, resolve, phiSeason, fertility, seedOps, moves, loads, tickets, deliveries, binRows, siteRows] = await Promise.all([
    loadSprayOps(year, fieldId),
    loadSprayResolver(),
    loadPhiSeason(year),
    loadFertility(year, fieldId),
    fetchAll<SeedingOp>((a, b) =>
      supabase
        .from('jd_field_operations')
        .select('id, field_id, started_at, operator_name, applied_area_ha, products, varieties:raw->varieties')
        .eq('operation_type', 'seeding')
        .eq('crop_season', year)
        .in('field_id', ids)
        .is('duplicate_of', null)
        .is('not_ours', null)
        .or('confirm_status.is.null,confirm_status.eq.confirmed')
        .order('id')
        .range(a, b),
    ),
    fetchAll<HarvestIn>((a, b) => supabase.from('grain_movements').select('field_id, bin_id, bushels, moved_at, ticket_number').eq('crop_year', year).eq('movement_type', 'harvest_in').in('field_id', ids).order('id').range(a, b)),
    fetchAll<FieldLoad>((a, b) => supabase.from('bin_loads').select('id, field_id, delivery_site_id, loaded_on, bushels').eq('crop_year', year).in('field_id', ids).order('id').range(a, b)),
    fetchAll<Ticket>((a, b) => supabase.from('scale_tickets').select('bin_load_id, bin_id, crop_id, ticket_no, delivered_on, buyer').eq('crop_year', year).order('id').range(a, b)),
    fetchAll<DeliveryMove>((a, b) => supabase.from('grain_movements').select('bin_id, field_id, crop_id, moved_at, ticket_number, bushels').eq('crop_year', year).eq('movement_type', 'delivery_out').order('id').range(a, b)),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from('bins').select('id, name').order('id').range(a, b)),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from('delivery_sites').select('id, name').order('id').range(a, b)),
  ])
  const binIds = [...new Set(moves.map((m) => m.bin_id))]
  const fills = binIds.length
    ? await fetchAll<BinFill>((a, b) => supabase.from('bin_contents').select('bin_id, emptied_on, crop_year, crop_id').in('bin_id', binIds).order('id').range(a, b))
    : []
  const binName = new Map(binRows.map((b) => [b.id, b.name]))
  const siteName = new Map(siteRows.map((s) => [s.id, s.name]))
  const phiOf = phiLookup(phiSeason)

  // Every canola area on our land this year, contract or not — a renter's
  // canola sheds pollen like ours does.
  const boundary = new Map(boundariesForYear(bounds, year).map((b) => [b.field_id, (b.geometry as unknown as Geometry) ?? null]))
  const zoneGeom = (a: CropArea) => (a.zone ? ((zones.find((z) => z.field_id === a.fieldId && z.crop_id === a.cropId)?.geojson as Geometry | null) ?? null) : null)
  const places: CanolaPlace[] = basics.areas
    .filter((a) => groupOf(cropKey(a.crop)) === 'canola')
    .map((a) => ({
      key: `${a.fieldId}:${a.cropId}`,
      fieldId: a.fieldId,
      field: `${fieldById.get(a.fieldId)?.name ?? 'A field'}${a.renters || basics.rentedOut.has(a.fieldId) ? ' (renter’s crop)' : ''}`,
      crop: a.crop,
      company: contractCompany(cropById.get(a.cropId), a.variety, companyOf),
      geometry: zoneGeom(a) ?? boundary.get(a.fieldId) ?? null,
    }))

  const pastAll: PastCrop[] = [
    ...past.map((h) => ({ fieldId: h.field_id, year: h.crop_year, cropId: h.crop_id, variety: h.variety, source: 'history' as const })),
    ...pastPlans.map((h) => ({ fieldId: h.field_id, year: h.crop_year, cropId: h.crop_id, variety: h.variety, source: 'plan' as const })),
  ]

  const sections: ReportSection[] = []
  const flat: ReportGroup[] = []
  let within = 0
  let flagged = 0
  let sprayCount = 0
  let unknownPhi = 0
  let early = 0
  const unmatched = new Set<string>()
  chosen.forEach((a, i) => {
    const f = fieldById.get(a.fieldId)!
    const name = fieldLabel(f.name)
    const mapAcres = basics.acresOf.get(a.fieldId) ?? null
    const harvest = basics.harvested.get(a.fieldId) ?? null
    const trait = asTrait(a.crop0.herbicide_trait)
    const numbers = [...new Set(contracts.filter((c) => c.crop_id === a.cropId && c.contract_number).map((c) => c.contract_number!))]
    const place = places.find((x) => x.key === `${a.fieldId}:${a.cropId}`)!

    const fieldLinesList: Line[] = [
      { item: 'Field', detail: f.name, note: a.zone ? 'part of the field, split on the map' : null },
      f.legal_land_description ? { item: 'Legal land', detail: f.legal_land_description } : fillIn('Legal land', 'legal land description'),
      { item: 'Acres', detail: [a.acres != null ? `${a.acres.toLocaleString('en-CA', { maximumFractionDigits: 1 })} ac planted` : null, mapAcres ? `${mapAcres.toLocaleString('en-CA', { maximumFractionDigits: 1 })} ac on the map` : null].filter(Boolean).join(' · ') || null, note: a.acres == null && !mapAcres ? 'Fill in: acres' : null },
      { item: 'Crop', detail: a.crop },
      a.variety ? { item: 'Variety', detail: a.variety, note: /^specialty/i.test(a.variety) ? 'Fill in: the hybrid or variety name if the company gave one' : null } : fillIn('Variety', 'hybrid or variety'),
      { item: 'Contract company', detail: a.company },
      numbers.length ? { item: 'Contract no.', detail: numbers.join(', ') } : fillIn('Contract no.', 'contract number (none entered on Contracts)'),
      trait
        ? { item: 'Herbicide trait', detail: TRAIT_SHORT[trait] }
        : isBothTraits(a.crop0.herbicide_trait)
          ? fillIn('Herbicide trait', `Liberty or Roundup: ${a.company} contracts both, so it is this year’s hybrid’s`)
          : fillIn('Herbicide trait', 'Liberty or Roundup (set it on the crop)'),
      { item: 'Irrigated', detail: basics.irrigated.has(a.fieldId) ? 'yes' : 'no' },
      fillIn('Company field / inspection no.', 'the company’s field number or seed inspection number'),
    ]
    const h = historyLines({ year, contract: a.crop0, past: pastAll.filter((x) => x.fieldId === a.fieldId), crops, companyOf })
    flagged += h.flagged
    const iso = isolationLines(place, places)
    within += iso.within
    const seed = seedingLines(seedOps.filter((o) => o.field_id === a.fieldId), basics.seeded.get(a.fieldId) ?? null, a.variety)
    const spray = sprayLines({ fieldId: a.fieldId, ops: ops.filter((o) => !o.not_ours), fieldAcres: mapAcres ?? 0, resolve, phiOf, harvest: harvest?.date ?? null, today: ctx.today })
    spray.unmatched.forEach((n) => unmatched.add(n))
    sprayCount += spray.lines.length
    unknownPhi += spray.unknownPhi
    early += spray.early
    const fert = fertilityLines(a.fieldId, year, fertility, mapAcres)
    const harvestList = harvestLines({
      fieldId: a.fieldId,
      cropId: a.cropId,
      harvested: harvest,
      yields: basics.history,
      yieldUnit: a.crop0.yield_unit,
      moves,
      loads,
      tickets,
      deliveries,
      fills,
      bin: (id) => (id ? (binName.get(id) ?? 'a bin') : 'a bin'),
      site: (id) => (id ? (siteName.get(id) ?? 'a buyer') : 'a buyer'),
    })

    const specs: SectionSpec[] = [
      { name: 'Field', note: `${companyCropLabel(a.crop, a.company)} · crop year ${year}`, cols: SECTION_COLS.field, lines: fieldLinesList },
      { name: 'Field history', note: `The ${HISTORY_YEARS} years before. Canola is flagged inside the ${a.crop0.min_return_years || HISTORY_YEARS}-year break the crop sets; same-trait canola for its volunteers.`, cols: SECTION_COLS.history, lines: h.lines },
      { name: 'Isolation', note: `Edge to edge from this field’s canola to our other canola in ${year}; the companies want 1 mile (1,609 m) for seed production. Neighbours’ fields are not in the app.`, cols: SECTION_COLS.isolation, lines: iso.lines },
      { name: 'Seeding', cols: SECTION_COLS.seeding, lines: seed },
      {
        name: 'Pesticides',
        note: 'Every chemical pass John Deere logged, a line per product. PHI is off the label for canola; clear to harvest is the spray date plus the PHI. The app holds no Keep it Clean list: check each product against the year’s advisory and the company’s own list.',
        cols: SECTION_COLS.spray,
        lines: spray.lines,
        empty: 'No chemical passes recorded this year. Fill in any applied by hand or custom.',
      },
      { name: 'Fertilizer', cols: SECTION_COLS.fertility, lines: fert, empty: 'No fertilizer recorded this year. Fill in any applied.' },
      { name: 'Harvest, bins and delivery', cols: SECTION_COLS.harvest, lines: harvestList },
    ]
    specs.forEach((s, j) => sections.push(sectionOf(name, s, i > 0 && j === 0)))
    flat.push({ title: name, rows: flatRows(specs) })
  })

  const which = fieldId ? fieldLabel(fieldById.get(fieldId)?.name ?? 'One field') : 'All contract canola fields'
  const acres = chosen.reduce((s, a) => s + (a.acres ?? basics.acresOf.get(a.fieldId) ?? 0), 0)
  const meta: [string, Cell][] = [
    ['Fields', chosen.length],
    ['Contract acres', `${Math.round(acres).toLocaleString('en-CA')} ac`],
    ['Companies', [...new Set(chosen.map((a) => a.company))].join(', ')],
    ['Canola history flags', flagged],
    ['Our canola within 1 mile', within],
    ['Pesticide lines', sprayCount],
    ['PHI unknown', unknownPhi],
    ['Harvested inside a PHI', early],
  ]
  const summary = [
    'One record per contract canola field: the field, its crop history, isolation from our other canola, seeding, every pesticide with its PCP number and pre-harvest interval, fertilizer, and harvest into bins and out on tickets. It mirrors what the seed companies’ field records cover; it is not their form — copy it onto theirs.',
    'Anything the app does not hold is left blank with “Fill in” beside it: seed lots, cleanout dates, neighbours’ canola, and any ticket number not entered.',
    'No mustard or other brassica has ever been grown on the farm’s land (Sam, 3 Oct 2026), so history flags canola only.',
  ]
  const named = [...unmatched].sort()
  if (named.length) summary.push(`Not matched to the price book, so no PCP number: ${named.join(', ')}. Match them on Fertilizer → Pricing.`)
  if (!fieldId && unknownCompany.length) summary.push(`Canola with no company yet, so left out: ${[...new Set(unknownCompany.map((a) => fieldLabel(fieldById.get(a.fieldId)?.name ?? 'a field')))].join(', ')}.`)
  const filename = `Contract canola field records ${year} ${which}`
  const title = 'Contract canola field records'
  const subtitle = `Crop year ${year} · ${which}`

  if (ctx.format === 'CSV') {
    return { title, subtitle, meta, summary, columns: [{ label: 'Section' }, ...FLAT.map((x) => x.col)], groups: flat, groupLabel: 'Field', filename }
  }
  return { title, subtitle, meta, lead: summary, sections, orientation: 'landscape', filename }
}
