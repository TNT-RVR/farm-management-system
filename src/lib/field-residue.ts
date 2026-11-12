import { stubbleCowDays } from './cattle-nutrition'

/**
 * What a crop field inside a pasture's fence gives the cattle, by date
 * (Sam, 2 Nov 2026: "our irrigated circles are not grass but sometimes corn,
 * bean or canola stubble, each with different feed value ... including if that
 * field was disked or cultivated thus removing the feed value").
 *
 * Pure: the Grazing tab, the Plan tab and the server's move-out check all read
 * a field the same way. The farming side's facts come from the
 * pasture_field_crops view (migration 20261102210000); this turns them into
 * pounds of grazeable dry matter and a feed value for a stretch of dates.
 *
 * The rules, in order:
 *   - a field fenced off from the pasture (neither open_to_pasture nor
 *     grazed_after_harvest) gives the pasture nothing;
 *   - a Feed-tab stubble-grazing row on it means the winter plan counts it —
 *     the pasture does not count it twice;
 *   - an annual crop gives nothing until harvest is recorded (cattle are kept
 *     off a growing crop), then its residue;
 *   - tillage on or before the day the cattle could get on it: nothing left;
 *   - a spray whose label says no grazing: available from the day it lifts;
 *   - perennial forage grazes like irrigated pasture, or as regrowth after its
 *     last cut.
 *
 * Residue figures (grazeable dry matter: what cattle actually take, trampling
 * and wind already allowed for — so the grass utilisation rate is NOT applied
 * again; feed value as a percent of DM):
 *   corn      8 lb DM per bushel (UNL, Corn Stalk Grazing: ~16 lb leaf + husk
 *             per bu, about half of it eaten) — the same figure the Feed tab's
 *             corn stubble uses (cattle-nutrition stubbleCowDays), so the two
 *             can never disagree. Leaf and husk weather away: none lost the
 *             first month, then 0.2 %/day to at most half (UNL: a third or
 *             more gone by late winter). TDN 58 % / CP 7 % while the cattle
 *             pick husk and leaf (first ~60 days), 50 % / 5 % after
 *             (NRC 2016; UNL EC-278).
 *   cereal    450 lb/ac of chaff, leaf, regrowth and dropped grain; TDN 45 %,
 *             CP 4 % (Sask. Agriculture, "Grazing crop residues"; barley
 *             straw NRC TDN 42–46 %).
 *   canola    250 lb/ac; TDN 42 %, CP 5 % (Alberta Agriculture, canola straw
 *             and chaff for cattle). Poor.
 *   dry beans nothing: harvested one pass, straight-cut, so next to nothing
 *             is left standing (Sam, 3 Nov 2026).
 *   peas, lentils, faba
 *             300 lb/ac; TDN 45 %, CP 6 %. Poor.
 *   green feed
 *             cut green, short stubble: 300 lb/ac regrowth; TDN 55 %, CP 8 %.
 *   potato    the culls and small tubers the harvester leaves: 6 % of the
 *             yield, 21 % dry matter, three quarters of it found — about
 *             150 lb DM/ac at 160 cwt. Feed value of the tuber, TDN 80 %,
 *             CP 9 % (NRC 2016 cull potatoes; Idaho and Alberta graze dug
 *             fields). Freezing and thawing rots them: none lost the first
 *             month, then 1 %/day. A field with no harvest recorded is taken
 *             as dug by 15 Oct — every potato is off by then here.
 *   silage corn, carrot / spinach seed
 *             nothing worth counting: chopped to the ground, or no published
 *             figure.
 *   perennial forage (alfalfa, sainfoin, grass)
 *             the irrigated pasture yield × utilisation for a season grazed,
 *             or a quarter of it as regrowth from 30 days after the last cut;
 *             TDN 60 % / CP 18 % legume, 58 % / 12 % grass.
 */

export type ResidueKind =
  | 'corn'
  | 'cereal'
  | 'canola'
  | 'bean'
  | 'pulse'
  | 'green_feed'
  | 'potato'
  | 'silage'
  | 'legume'
  | 'grass'
  | 'other'

type ResidueSpec = {
  label: string
  /** Flat grazeable DM, lb/ac (corn uses its yield instead). */
  lbPerAc: number
  tdn: number
  cp: number
  /** Feed value once the best of it is picked over (corn only). */
  lateTdn?: number
  lateCp?: number
  /** Perennial forage: grazes as irrigated pasture. */
  forage?: boolean
}

export const RESIDUE: Record<ResidueKind, ResidueSpec> = {
  corn: { label: 'corn stubble', lbPerAc: 0, tdn: 58, cp: 7, lateTdn: 50, lateCp: 5 },
  cereal: { label: 'cereal stubble', lbPerAc: 450, tdn: 45, cp: 4 },
  canola: { label: 'canola stubble', lbPerAc: 250, tdn: 42, cp: 5 },
  bean: { label: 'bean stubble', lbPerAc: 0, tdn: 0, cp: 0 },
  pulse: { label: 'pea / lentil stubble', lbPerAc: 300, tdn: 45, cp: 6 },
  green_feed: { label: 'green feed regrowth', lbPerAc: 300, tdn: 55, cp: 8 },
  potato: { label: 'cull potatoes', lbPerAc: 0, tdn: 80, cp: 9 },
  silage: { label: 'silage stubble', lbPerAc: 0, tdn: 0, cp: 0 },
  legume: { label: 'legume forage', lbPerAc: 0, tdn: 60, cp: 18, forage: true },
  grass: { label: 'grass forage', lbPerAc: 0, tdn: 58, cp: 12, forage: true },
  other: { label: 'crop', lbPerAc: 0, tdn: 0, cp: 0 },
}

/** Corn's weather loss: nothing the first month, then 0.2 %/day, at most half. */
export const CORN_LOSS_GRACE_DAYS = 30
export const CORN_LOSS_PCT_PER_DAY = 0.2
export const CORN_LOSS_MAX_PCT = 50
/** Days the husk and leaf last before the cattle are down to stalk. */
export const CORN_EARLY_DAYS = 60
/** Regrowth after a hay cut: this share of a season's irrigated yield, from this many days after the cut. */
export const FORAGE_REGROWTH_SHARE = 0.25
export const FORAGE_REGROWTH_DAYS = 30
/** Potatoes left in a dug field: share of the yield, dry matter, share the cattle find. */
export const POTATO_LEFT_SHARE = 0.06
export const POTATO_DM = 0.21
export const POTATO_FOUND = 0.75
export const POTATO_LOSS_GRACE_DAYS = 30
export const POTATO_LOSS_PCT_PER_DAY = 1
/** Month and day a potato field with no harvest recorded is taken as dug. */
export const POTATO_DUG_BY = '10-15'
/** Bushels of corn in a wet tonne of high-moisture corn (CornStubble's figure). */
const BU_PER_WET_TONNE = 32.6

export function residueKind(cropName: string | null | undefined): ResidueKind {
  const n = (cropName ?? '').toLowerCase()
  if (!n) return 'other'
  if (/silage/.test(n)) return 'silage'
  if (/corn/.test(n)) return 'corn'
  if (/potato/.test(n)) return 'potato'
  if (/green feed/.test(n)) return 'green_feed'
  if (/canola|mustard|flax/.test(n)) return 'canola'
  if (/faba/.test(n)) return 'pulse'
  if (/bean/.test(n)) return 'bean'
  if (/pea|lentil|chickpea/.test(n)) return 'pulse'
  if (/wheat|durum|barley|oat|triticale|rye/.test(n)) return 'cereal'
  if (/alfalfa|sainfoin|clover/.test(n)) return 'legume'
  if (/grass|pasture|hay|timothy|brome|fescue/.test(n)) return 'grass'
  return 'other'
}

/** One row of the pasture_field_crops view (numbers may arrive as strings). */
export type PastureFieldRow = {
  grazing_pasture_id: string
  ranch_id?: string | null
  pasture_id?: string | null
  field_id: string
  field_name: string
  open_to_pasture: boolean | null
  grazed_after_harvest: boolean | null
  acres_in: number | string
  field_acres?: number | string | null
  crop_year: number
  crop_id?: string | null
  crop_name: string | null
  crop_share: number | string | null
  yield_per_acre: number | string | null
  yield_source?: string | null
  yield_unit: string | null
  harvest_on: string | null
  harvest_source: string | null
  last_harvest_on: string | null
  tilled_on: string | null
  tilled_how: string | null
  stubble_grazing_id: string | null
  stubble_grazing_name?: string | null
}

/** A spray's no-grazing window on the field: grazing allowed again from `until`. */
export type SprayHold = { until: string; product: string }

export type FieldWindow = { from: string; to: string }

export type FieldForageStatus =
  | 'fenced' // not open to the pasture and not grazed after harvest
  | 'winter_plan' // counted by a Feed-tab stubble-grazing row
  | 'no_crop' // nothing on the plan for that year
  | 'growing' // annual crop, harvest not recorded by the end of the window
  | 'none' // potatoes, silage, a crop with no residue figure
  | 'tilled' // disked / cultivated after harvest
  | 'sprayed' // inside a label's no-grazing window for all of the dates
  | 'stubble' // residue counted
  | 'forage' // perennial forage counted

export type FieldForage = {
  fieldId: string
  fieldName: string
  /** Acres of the field (this crop's share) inside the fence. */
  acres: number
  cropName: string | null
  /** What it is, for the breakdown: "corn stubble", "bean stubble", "Alfalfa". */
  what: string
  kind: ResidueKind
  status: FieldForageStatus
  /** Grazeable dry matter for the dates, lb (already net of trampling / utilisation). */
  lb: number
  lbPerAc: number
  /** Feed value of what is there, % of DM; null when there is nothing. */
  tdnPct: number | null
  cpPct: number | null
  /** First day the cattle can graze it within the dates. */
  availableFrom: string | null
  harvestOn: string | null
  harvestSource: string | null
  tilledOn: string | null
  sprayProduct: string | null
  /** Short phrase for the breakdown: "corn stubble from 26 Oct", "potatoes — no grazing". */
  note: string
}

const DAY = 86_400_000
const utc = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)
const daysBetween = (a: string, b: string) => Math.round((utc(b) - utc(a)) / DAY)
const addDays = (iso: string, n: number) => new Date(utc(iso) + n * DAY).toISOString().slice(0, 10)
const maxIso = (...xs: (string | null | undefined)[]) => xs.filter((x): x is string => Boolean(x)).sort().at(-1) ?? null
const num = (v: number | string | null | undefined) => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "26 Oct" — by hand, so server and phone word it alike. */
export const shortDay = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`

/** "disked", "cultivated" … from the tillage record's kind. */
function tilledWord(how: string | null): string {
  const h = (how ?? '').toLowerCase()
  if (/disc|disk/.test(h)) return 'disked'
  if (/cultivat/.test(h)) return 'cultivated'
  if (/plow|plough/.test(h)) return 'ploughed'
  return 'tilled'
}

/** Corn yield in bu/ac from the plan's unit. */
export function cornBuPerAcre(yieldPerAcre: number, unit: string | null | undefined): number {
  const u = (unit ?? 'bu').toLowerCase()
  if (u === 'mt' || u === 't') return yieldPerAcre * BU_PER_WET_TONNE
  if (u === 'lbs' || u === 'lb') return yieldPerAcre / 56
  return yieldPerAcre
}

/** Potato yield in lb/ac from the plan's unit (cwt by default). */
export function potatoLbPerAcre(yieldPerAcre: number, unit: string | null | undefined): number {
  const u = (unit ?? 'cwt').toLowerCase()
  if (u === 'lbs' || u === 'lb') return yieldPerAcre
  if (u === 't' || u === 'ton' || u === 'tons') return yieldPerAcre * 2000
  if (u === 'mt') return yieldPerAcre * 2204.6
  return yieldPerAcre * 100
}

/** Grazeable cull potatoes, lb DM/ac, `daysSinceHarvest` after digging. */
export function potatoLbDmPerAcre(yieldLbPerAc: number, daysSinceHarvest: number): number {
  const lossPct = Math.min(100, Math.max(0, daysSinceHarvest - POTATO_LOSS_GRACE_DAYS) * POTATO_LOSS_PCT_PER_DAY)
  return yieldLbPerAc * POTATO_LEFT_SHARE * POTATO_DM * POTATO_FOUND * (1 - lossPct / 100)
}

/** Corn's weather loss, % of the stalk grazing, this many days after harvest. */
export function cornWeatherLossPct(daysSinceHarvest: number): number {
  return Math.min(CORN_LOSS_MAX_PCT, Math.max(0, daysSinceHarvest - CORN_LOSS_GRACE_DAYS) * CORN_LOSS_PCT_PER_DAY)
}

/**
 * Grazeable corn stubble, lb DM/ac, `daysSinceHarvest` after harvest: the
 * Feed tab's own stubble arithmetic (stubbleCowDays) with the weather loss
 * worked out from the date instead of typed.
 */
export function cornStubbleLbPerAcre(yieldBu: number, daysSinceHarvest: number): number {
  return stubbleCowDays(1, yieldBu, cornWeatherLossPct(daysSinceHarvest), 1000).perAcreLb
}

/**
 * What one field gives cattle in a pasture over `w` (both ends counted).
 *
 * `irrigatedLbAc` is the irrigated pasture yield for the pasture's grass
 * quality and `utilization` the ranch's rate; both only matter for perennial
 * forage. `spray` is the field's latest-lifting no-grazing restriction, if any.
 */
export function fieldForage(
  row: PastureFieldRow,
  w: FieldWindow,
  opts: { irrigatedLbAc: number; utilization: number; spray?: SprayHold | null },
): FieldForage {
  const kind = residueKind(row.crop_name)
  const spec = RESIDUE[kind]
  const acres = Math.max(0, (num(row.acres_in) ?? 0) * (num(row.crop_share) ?? 1))
  const what = row.crop_name ? (spec.forage || kind === 'other' ? row.crop_name : spec.label) : 'no crop planned'
  const base = {
    fieldId: row.field_id,
    fieldName: row.field_name,
    acres,
    cropName: row.crop_name,
    what,
    kind,
    harvestOn: row.harvest_on,
    harvestSource: row.harvest_source,
    tilledOn: row.tilled_on,
    sprayProduct: null as string | null,
  }
  const nothing = (status: FieldForageStatus, note: string, extra: Partial<FieldForage> = {}): FieldForage => ({
    ...base,
    status,
    lb: 0,
    lbPerAc: 0,
    tdnPct: null,
    cpPct: null,
    availableFrom: null,
    note,
    ...extra,
  })

  if (!row.open_to_pasture && !row.grazed_after_harvest) return nothing('fenced', `${row.crop_name ?? 'crop'} — fenced off, not counted`)
  if (!row.crop_name) return nothing('no_crop', 'no crop on the plan — not counted')
  if (row.stubble_grazing_id) return nothing('winter_plan', `${what} — counted in the winter feed plan`)
  if (kind === 'silage') return nothing('none', 'silage corn — no grazing')
  if (kind === 'bean') return nothing('none', `${row.crop_name}, one-pass harvest — next to nothing left, not counted`)
  if (kind === 'other') return nothing('none', `${row.crop_name} — no residue figure, not counted`)

  // Perennial forage: open to the pasture, it is irrigated pasture all season;
  // cut for hay, the regrowth after the last cut.
  if (spec.forage) {
    const cut = row.last_harvest_on
    const regrowFrom = cut ? addDays(cut, FORAGE_REGROWTH_DAYS) : null
    const from = maxIso(w.from, regrowFrom, opts.spray?.until)
    if (!from || from > w.to) {
      if (opts.spray && opts.spray.until > w.to) return nothing('sprayed', `${what} — sprayed (${opts.spray.product}), no grazing until ${shortDay(opts.spray.until)}`, { sprayProduct: opts.spray.product })
      return nothing('growing', `${what} — regrowing after the cut on ${shortDay(cut!)}`)
    }
    const lbPerAc = opts.irrigatedLbAc * opts.utilization * (cut ? FORAGE_REGROWTH_SHARE : 1)
    return {
      ...base,
      status: 'forage',
      lb: lbPerAc * acres,
      lbPerAc,
      tdnPct: spec.tdn,
      cpPct: spec.cp,
      availableFrom: from,
      sprayProduct: opts.spray && opts.spray.until > w.from ? opts.spray.product : null,
      note: cut ? `${what} regrowth from ${shortDay(from)}` : `${what}, grazed as irrigated pasture`,
    }
  }

  // An annual crop: nothing while it grows. Potatoes with no harvest recorded
  // are taken as dug by mid-October.
  const assumedDug = kind === 'potato' && !row.harvest_on
  const harvest = assumedDug ? `${row.crop_year}-${POTATO_DUG_BY}` : row.harvest_on
  if (!harvest || harvest > w.to) {
    return nothing('growing', harvest ? `${what} — not harvested until ${shortDay(harvest)}` : `${row.crop_name} — growing / not harvested yet, no grazing`)
  }
  const from = maxIso(w.from, harvest, opts.spray?.until)!
  if (row.tilled_on && row.tilled_on <= from) {
    return nothing('tilled', `${row.crop_name}, ${tilledWord(row.tilled_how)} ${shortDay(row.tilled_on)} — no grazing`)
  }
  if (from > w.to) {
    return nothing('sprayed', `${what} — sprayed (${opts.spray!.product}), no grazing until ${shortDay(opts.spray!.until)}`, { sprayProduct: opts.spray!.product })
  }
  const since = Math.max(0, daysBetween(harvest, from))
  let lbPerAc = spec.lbPerAc
  let tdn = spec.tdn
  let cp = spec.cp
  if (kind === 'corn') {
    const bu = cornBuPerAcre(num(row.yield_per_acre) ?? 0, row.yield_unit)
    lbPerAc = cornStubbleLbPerAcre(bu, since)
    if (since > CORN_EARLY_DAYS) {
      tdn = spec.lateTdn!
      cp = spec.lateCp!
    }
  } else if (kind === 'potato') {
    lbPerAc = potatoLbDmPerAcre(potatoLbPerAcre(num(row.yield_per_acre) ?? 0, row.yield_unit), since)
  }
  const sprayNote = opts.spray && opts.spray.until > harvest && opts.spray.until === from ? ` (after the ${opts.spray.product} spray)` : ''
  return {
    ...base,
    status: 'stubble',
    lb: lbPerAc * acres,
    lbPerAc,
    tdnPct: tdn,
    cpPct: cp,
    availableFrom: from,
    sprayProduct: sprayNote ? opts.spray!.product : null,
    note: `${what} from ${shortDay(from)}${assumedDug ? ' (dug date not recorded, taken as 15 Oct)' : ''}${sprayNote}`,
  }
}

/**
 * The grazing season the Grazing tab totals over: the herd classes' earliest
 * turnout and latest coming-off day (month and day, put in `year`), else
 * 1 May to 16 Nov — the default ReplacementHeifers plans a cow's season on.
 */
export function grazingSeason(herd: { graze_start: string | null; graze_end: string | null }[], year: number): FieldWindow {
  const starts = herd.map((h) => h.graze_start?.slice(5, 10)).filter((x): x is string => Boolean(x)).sort()
  const ends = herd.map((h) => h.graze_end?.slice(5, 10)).filter((x): x is string => Boolean(x)).sort()
  return { from: `${year}-${starts[0] ?? '05-01'}`, to: `${year}-${ends.at(-1) ?? '11-16'}` }
}

/** The rows for one Grazing-tab pasture and one crop year, the field's latest boundary only once. */
export function rowsFor(rows: PastureFieldRow[] | null | undefined, grazingPastureId: string, year: number): PastureFieldRow[] {
  return (rows ?? []).filter((r) => r.grazing_pasture_id === grazingPastureId && Number(r.crop_year) === year)
}
