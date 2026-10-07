/**
 * The rotation recommender.
 *
 * Built the way the published rotation tools are (ROTOR, ROTAT, CropRota —
 * see reports/Southern Alberta crop rotation.md): hard rules filter out what
 * must not be planted, then what is left is scored on three separate axes —
 * agronomy, profit and soil — and a plan is built for each, inside the acre
 * limits the farm sets per crop.
 *
 * Hard rules: return intervals (a crop and its host group), the succession
 * matrix's blocked pairs, irrigation-only crops kept off dryland, salinity a
 * crop cannot stand, and herbicide carryover from what the labels say may
 * follow each product sprayed on the field.
 *
 * Warnings only: a seed canola on a field that grew a canola of the same
 * herbicide trait in recent years (canola-trait.ts).
 */

import { volunteerConflicts, type CanolaYear, type HerbicideTrait } from './canola-trait'
import { farmDistrict } from './farm-context'

export type CropKey =
  | 'canola' | 'seed_canola' | 'corn' | 'potato' | 'dry_bean' | 'wheat' | 'durum' | 'barley' | 'oats' | 'pea'
  | 'alfalfa' | 'sainfoin' | 'green_feed' | 'carrot' | 'spinach' | 'soybean' | 'other'

export function cropKey(name: string): CropKey {
  const n = name.toLowerCase()
  if (/seed canola/.test(n)) return 'seed_canola'
  if (/canola/.test(n)) return 'canola'
  if (/corn/.test(n)) return 'corn'
  if (/potato/.test(n)) return 'potato'
  if (/soybean/.test(n)) return 'soybean'
  if (/bean/.test(n)) return 'dry_bean'
  if (/durum/.test(n)) return 'durum'
  if (/wheat/.test(n)) return 'wheat'
  if (/barley/.test(n)) return 'barley'
  if (/oat/.test(n)) return 'oats'
  if (/pea/.test(n)) return 'pea'
  if (/alfalfa/.test(n)) return 'alfalfa'
  if (/sainfoin/.test(n)) return 'sainfoin'
  if (/green feed/.test(n)) return 'green_feed'
  if (/carrot/.test(n)) return 'carrot'
  if (/spinach/.test(n)) return 'spinach'
  return 'other'
}

/** Crops that share a return interval: all beans are one crop to the disease, canola and seed canola likewise. */
const HOST_GROUP: Partial<Record<CropKey, string>> = {
  canola: 'canola', seed_canola: 'canola', dry_bean: 'dry_bean', soybean: 'dry_bean', alfalfa: 'forage_legume', sainfoin: 'forage_legume',
}
export const groupOf = (k: CropKey) => HOST_GROUP[k] ?? k

/** Groups that can carry one combined acre limit (crop_acre_limits.crop_group). */
export const LIMIT_GROUPS = [
  { group: 'dry_bean', label: 'All dry beans (combined)' },
  { group: 'canola', label: 'All canola (combined)' },
  { group: 'forage_legume', label: 'Alfalfa + sainfoin (combined)' },
] as const

/** Grown only under a pivot in southern Alberta. */
const IRRIGATED_ONLY = new Set<CropKey>(['potato', 'dry_bean', 'corn', 'carrot', 'spinach', 'seed_canola', 'soybean'])
const LOW_RESIDUE = new Set<CropKey>(['potato', 'dry_bean', 'carrot', 'soybean'])
const CEREAL = new Set<CropKey>(['wheat', 'durum', 'barley', 'oats', 'green_feed'])
const LEGUME = new Set<CropKey>(['pea', 'dry_bean', 'soybean', 'alfalfa', 'sainfoin'])

/** FAO salt tolerance: yield loss starts at `thr` dS/m, `slope` % per dS/m above it. Canola per Canola Council. */
const SALT: Partial<Record<CropKey, { thr: number; slope: number }>> = {
  dry_bean: { thr: 1.0, slope: 19 }, soybean: { thr: 5.0, slope: 20 }, potato: { thr: 1.7, slope: 12 }, corn: { thr: 1.7, slope: 12 },
  carrot: { thr: 1.0, slope: 14 }, spinach: { thr: 2.0, slope: 7.6 }, alfalfa: { thr: 2.0, slope: 7.3 }, pea: { thr: 3.4, slope: 10.6 },
  wheat: { thr: 6.0, slope: 7.1 }, durum: { thr: 5.9, slope: 3.8 }, barley: { thr: 8.0, slope: 5 }, oats: { thr: 5.0, slope: 7 },
  canola: { thr: 5.5, slope: 10 }, seed_canola: { thr: 5.5, slope: 10 },
}

/**
 * Soil score, 0–10: carbon returned, residue left over winter, disturbance.
 * Vauxhall: wheat 4.6 Mg C/ha/yr, oat 3.0, potato 2.3, dry bean 1.1; spring
 * residue 33.7% after wheat, 6.5% after potato, 3.6% after wide-row bean.
 * Crops the study did not measure are estimates (flagged in the UI).
 */
export const SOIL_SCORE: Record<CropKey, { score: number; measured: boolean }> = {
  alfalfa: { score: 9.5, measured: false }, sainfoin: { score: 9.5, measured: false },
  wheat: { score: 8, measured: true }, durum: { score: 8, measured: false }, barley: { score: 7.5, measured: false },
  corn: { score: 7.5, measured: false }, oats: { score: 6, measured: true }, green_feed: { score: 5, measured: false },
  canola: { score: 5.5, measured: false }, seed_canola: { score: 5, measured: false }, pea: { score: 5, measured: false },
  potato: { score: 2.5, measured: true }, dry_bean: { score: 1.5, measured: true }, soybean: { score: 2.5, measured: false },
  carrot: { score: 1.5, measured: false }, spinach: { score: 3, measured: false }, other: { score: 4, measured: false },
}

export type Preference = 'recommended' | 'possible' | 'caution' | 'no_go'

export type RecropRule = {
  registration_number: string
  crop_key: string | null
  following_crop: string
  months: number | null
  status: 'ok' | 'wait' | 'second_season' | 'bioassay' | 'not_listed' | 'do_not'
  condition: string | null
  quote: string | null
}

export type FieldApp = { product: string; registration: string | null; appliedOn: string }

export type CarryoverHit = { product: string; registration: string; appliedOn: string; block: boolean; message: string; quote: string | null }

/** Months between two ISO dates. */
const monthsBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / (30.44 * 86_400_000)

/** The label's key for one of our crops (a crop key the label extraction uses). */
function labelKeys(k: CropKey): string[] {
  if (k === 'seed_canola') return ['canola']
  if (k === 'green_feed') return ['oats', 'barley']
  if (k === 'sainfoin') return ['alfalfa']
  return [k]
}

/** A label line that really means "every crop not listed", not one named crop the extraction could not key. */
const CATCH_ALL = /(all|any) (other )?crops?|other crops|crops? (not|other than)|other than|not listed|not on the/i
/** Restrictions that only bind in the season the product went on. */
const SAME_SEASON = /same (season|year)|year of (application|treatment)|this season|in the season of|within \d+ days/i

/**
 * What the products sprayed on this field say about planting `crop` on
 * `plantOn` (default 1 May of the crop year). Uses the rule for the crop, or
 * the label's catch-all for crops not listed.
 *
 * `block` is true where the label names the crop (or bans every other crop
 * outright); a catch-all that only asks for a bioassay is a caution. Sprays
 * after the planting date, same-season rules in a later year, and waits with
 * no month count are skipped; a product sprayed twice reports once, from its
 * latest (most restrictive) application.
 */
export function carryover(crop: CropKey, apps: FieldApp[], rulesByReg: Map<string, RecropRule[]>, plantOn: string): CarryoverHit[] {
  const hits = new Map<string, CarryoverHit & { m: number }>()
  const keys = labelKeys(crop)
  for (const a of apps) {
    if (!a.registration || a.appliedOn >= plantOn) continue
    const rules = rulesByReg.get(a.registration)
    if (!rules?.length) continue
    const mine = rules.filter((r) => r.crop_key && keys.includes(r.crop_key))
    const named = mine.length > 0
    const pool = named ? mine : rules.filter((r) => r.crop_key === 'any_other' && CATCH_ALL.test(r.following_crop))
    if (!pool.length) continue
    const m = monthsBetween(a.appliedOn, plantOn)
    const firstSeason = m < 13
    const sameYear = a.appliedOn.slice(0, 4) === plantOn.slice(0, 4)
    for (const r of pool) {
      if (SAME_SEASON.test(`${r.condition ?? ''} ${r.following_crop}`) && !sameYear) continue
      // 'ok' with 11 months or fewer is a real wait (Zidua: barley 11 months);
      // 'ok' with 12 or more is the label's "the following year" (Impact: corn
      // "12 months … the following year"), so next spring is fine.
      if (r.status === 'ok' && (r.months == null || m >= r.months || (r.months >= 12 && !sameYear))) continue
      if (r.status === 'wait' && (r.months == null || m >= r.months)) continue
      if (r.status === 'second_season' && !firstSeason) continue
      if ((r.status === 'bioassay' || r.status === 'not_listed') && m >= 36) continue
      if (r.status === 'do_not' && r.months != null && m >= r.months) continue
      // A "do not plant" with no month count means the season after the spray
      // (Edge: oats), not every season after.
      if (r.status === 'do_not' && r.months == null && !firstSeason) continue
      const need =
        r.months != null && (r.status === 'wait' || r.status === 'ok' || r.status === 'do_not')
          ? `label needs ${r.months} months before ${r.following_crop}; this is ${Math.floor(m)}`
          : r.status === 'second_season'
            ? `label says ${r.following_crop} not until the second season`
            : r.status === 'bioassay'
              ? `label says ${r.following_crop} only after a field bioassay`
              : r.status === 'not_listed'
                ? `${r.following_crop} is not on the label's list of crops that may follow`
                : `label says do not plant ${r.following_crop}`
      const block = named ? r.status !== 'bioassay' : r.status === 'do_not' || r.status === 'wait'
      const id = `${a.registration}|${r.crop_key}|${r.status}|${r.months}`
      const prev = hits.get(id)
      if (prev && prev.m <= m) continue
      hits.set(id, {
        m,
        product: a.product,
        registration: a.registration,
        appliedOn: a.appliedOn,
        block,
        message: `${a.product} sprayed ${a.appliedOn}: ${need}${r.condition ? ` (${r.condition})` : ''}.`,
        quote: r.quote,
      })
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- m is dropped from the result on purpose
  return [...hits.values()].map(({ m: _m, ...h }) => h)
}

export type CropInfo = {
  id: string
  name: string
  key: CropKey
  minReturn: number
  margin: number | null
  /** Grown here only by a renter: never recommended, still plannable by hand. */
  renterOnly?: boolean
  /** Irrigation the crop needs in an average year, inches over the irrigated acres. */
  waterNeedIn?: number | null
  /** Years it may run on a field back to back (1 = never twice). */
  maxInARow?: number
  /** A perennial: kept in at least standMin years, taken out after standMax. */
  standMin?: number | null
  standMax?: number | null
  /** Herbicide trait, for a canola whose company's trait is set. */
  trait?: HerbicideTrait | null
}

/** Years the same crop has run on the field up to (not including) `year`. */
export function runLength(crops: Map<number, string[]>, cropId: string, year: number): number {
  let n = 0
  for (let y = year - 1; y >= year - 12 && (crops.get(y) ?? []).includes(cropId); y--) n++
  return n
}

/** A crop's economics on one field: revenue and cost when built from the farm's own numbers, else only a margin. */
export type FieldEconomics = { revenue: number | null; cost: number | null; margin: number | null; basis: string }

/** Something the scouts found on the field. */
export type ScoutFinding = { category: string; subject: string; severity: number; year: number }

/**
 * What a scouting find means for the next crops. Hosts are the crops the
 * problem carries into; `years` is how long it is taken to matter.
 */
export const SCOUT_RULES: { match: RegExp; hosts: CropKey[]; years: number; block?: boolean; why: string }[] = [
  { match: /clubroot/i, hosts: ['canola', 'seed_canola'], years: 4, block: true, why: 'Alberta clubroot plan: at least a two-year break from canola, three to four on an infested field' },
  { match: /sclerotinia|white mou?ld/i, hosts: ['canola', 'seed_canola', 'dry_bean', 'soybean', 'pea', 'carrot'], years: 3, why: 'sclerotia live three to five years in the soil; a cereal or corn breaks it' },
  { match: /blackleg/i, hosts: ['canola', 'seed_canola'], years: 2, why: 'blackleg lives on canola stubble until it breaks down' },
  { match: /fusarium|fhb/i, hosts: ['wheat', 'durum', 'barley', 'oats', 'green_feed', 'corn'], years: 2, why: 'Fusarium carries on cereal and corn residue' },
  { match: /bacterial blight/i, hosts: ['dry_bean'], years: 2, why: 'bean blight carries on residue; Alberta Pulse wants a long break' },
  { match: /late blight/i, hosts: ['potato'], years: 1, why: 'late blight on volunteers and cull piles' },
  { match: /wireworm/i, hosts: ['potato', 'carrot', 'corn', 'dry_bean'], years: 3, why: 'wireworms thin stands and scar tubers' },
  { match: /volunteer canola/i, hosts: ['dry_bean'], years: 1, why: 'volunteer canola cannot be controlled in dry beans' },
  { match: /ergot/i, hosts: ['wheat', 'durum', 'barley', 'oats'], years: 1, why: 'ergot bodies survive a year in the soil' },
  { match: /salin/i, hosts: ['dry_bean', 'corn', 'potato', 'carrot', 'pea'], years: 6, why: 'salt-sensitive crop on ground scouted as saline' },
]

/** What the scouting finds on a field say about planting `crop` in `year`. */
export function scoutHits(crop: CropKey, findings: ScoutFinding[], year: number): { block: boolean; severity: number; message: string }[] {
  const out: { block: boolean; severity: number; message: string }[] = []
  for (const f of findings) {
    const rule = SCOUT_RULES.find((r) => r.match.test(f.subject))
    if (!rule || !rule.hosts.includes(crop) || f.year < year - rule.years || f.year >= year) continue
    const sev = ['', 'light', 'moderate', 'heavy'][f.severity] ?? ''
    out.push({
      block: Boolean(rule.block) && f.severity >= 2,
      severity: f.severity,
      message: `${f.subject} scouted here in ${f.year}${sev ? ` (${sev})` : ''}: ${rule.why}`,
    })
  }
  return out
}

/** Corn heat units a crop needs to mature, for the earliest hybrids and varieties grown here. */
export const CHU_NEED: Partial<Record<CropKey, number>> = { corn: 2300, soybean: 2400, dry_bean: 2000 }

export type FieldCtx = {
  id: string
  name: string
  acres: number
  irrigated: boolean
  sandy: boolean
  ec: number | null
  /** year → crop ids that year (history and plans). */
  crops: Map<number, string[]>
  apps: FieldApp[]
  /** crop id → economics on this field (the farm's own numbers). */
  economics?: Map<string, FieldEconomics>
  /** Scouting finds on this field, recent years. */
  scouting?: ScoutFinding[]
  /** Corn heat units expected here in the plan year (normal, or the outlook's). */
  chu?: number | null
  /** Where this field's water comes from ('smrid', a licence id), and over how many acres. */
  waterSource?: string | null
  irrigatedAcres?: number
  /**
   * A crop's season need on this field, inches (the farm figure moved for
   * the field's soil, pivot and AIMM seasons); null falls back to the crop's.
   */
  waterNeedIn?: (cropId: string) => number | null
  /**
   * Every canola on the field's record with its trait — history read through
   * its variety (plain "Canola" grown for BASF), plans through their crop.
   * Without it, the trait comes from the crops in `crops`.
   */
  canola?: CanolaYear[]
}

export type Evaluation = {
  cropId: string
  blocked: string[]
  cautions: string[]
  /** Products whose label raised a carryover caution or block, so their labels can be opened. */
  labels: { product: string; registration: string }[]
  plus: string[]
  agronomy: number
  /** $/ac, or null when the crop has no margin set. */
  profit: number | null
  soil: number
}

export function evaluate(
  field: FieldCtx,
  crop: CropInfo,
  year: number,
  cropsById: Map<string, CropInfo>,
  pref: (prevId: string, nextId: string) => { preference: Preference; notes: string | null } | null,
  rulesByReg: Map<string, RecropRule[]>,
): Evaluation {
  const blocked: string[] = []
  const cautions: string[] = []
  const plus: string[] = []
  let agronomy = 0
  const k = crop.key
  const g = groupOf(k)
  const keysIn = (y: number) => (field.crops.get(y) ?? []).map((id) => cropsById.get(id)).filter(Boolean) as CropInfo[]
  const last = keysIn(year - 1)

  // A perennial stand carries on until its maximum age; a crop allowed to
  // repeat may run back to back up to its limit. Either way the return
  // interval and "no X after X" are about starting it again, not carrying on.
  const run = runLength(field.crops, crop.id, year)
  const isStand = crop.standMax != null && crop.standMax > 0
  const continuing = run > 0 && (isStand ? run < crop.standMax! : run < (crop.maxInARow ?? 1))
  if (run > 0 && isStand && run >= crop.standMax!) blocked.push(`${crop.name} stand is ${run} years old — it comes out after ${crop.standMax}`)
  if (run > 0 && !isStand && continuing) {
    cautions.push(`${crop.name} year ${run + 1} in a row here (allowed up to ${crop.maxInARow})`)
    agronomy -= 1
  }
  // Return interval over the host group.
  if (!continuing && crop.minReturn > 0) {
    for (let y = year - 1; y >= year - crop.minReturn; y--) {
      const hit = keysIn(y).find((c) => groupOf(c.key) === g)
      if (hit) {
        blocked.push(`${hit.name} was here in ${y}; ${crop.name} needs ${crop.minReturn} years between host crops`)
        break
      }
    }
  }
  // Years since this host group last grew here, beyond the minimum — counted
  // only as far back as the field has records, so a missing year is not a clean one.
  const known = [...field.crops.keys()].filter((y) => y < year)
  const earliest = known.length ? Math.min(...known) : year
  let since = 0
  let found = false
  for (let y = year - 1; y >= Math.max(earliest, year - 8); y--) {
    if (keysIn(y).some((c) => groupOf(c.key) === g)) {
      found = true
      break
    }
    since++
  }
  if (!continuing && since > crop.minReturn) {
    const extra = Math.min(3, since - crop.minReturn)
    agronomy += extra * 0.5
    if (extra >= 2) plus.push(found ? `${since} years since ${crop.name} here` : `not grown here in the ${since} years on record`)
  }
  // Succession after last year's crop(s).
  for (const p of last) {
    if (continuing && p.key === k) continue
    const r = pref(p.id, crop.id)
    if (!r) continue
    if (r.preference === 'no_go') blocked.push(r.notes ?? `${crop.name} must not follow ${p.name}`)
    else if (r.preference === 'caution') {
      cautions.push(r.notes ?? `${crop.name} after ${p.name}: caution`)
      agronomy -= 2
    } else if (r.preference === 'recommended') {
      agronomy += 3
      plus.push(r.notes?.replace(/^Recommended:\s*/i, '') ?? `${crop.name} after ${p.name} is recommended`)
    }
  }
  if (!field.irrigated && IRRIGATED_ONLY.has(k)) blocked.push(`${crop.name} needs irrigation; this field is dryland`)
  // Salinity.
  let yieldFactor = 1
  const salt = SALT[k]
  if (field.ec != null && salt && field.ec > salt.thr) {
    const loss = Math.min(100, salt.slope * (field.ec - salt.thr))
    yieldFactor = 1 - loss / 100
    if (loss >= 50) blocked.push(`Topsoil EC ${field.ec.toFixed(1)} costs ${crop.name} about ${Math.round(loss)}% of its yield`)
    else if (loss >= 10) {
      cautions.push(`Salinity (EC ${field.ec.toFixed(1)}) costs ${crop.name} about ${Math.round(loss)}%`)
      agronomy -= loss / 20
    }
  }
  // Sandy fields: a low-residue crop after a low-residue crop leaves the ground bare two winters.
  if (field.sandy && LOW_RESIDUE.has(k) && last.some((c) => LOW_RESIDUE.has(c.key))) {
    cautions.push('Sandy field: two low-residue crops in a row — plan a fall rye cover')
    agronomy -= 1
  }
  // Herbicide carryover.
  const labels: { product: string; registration: string }[] = []
  for (const h of carryover(k, field.apps, rulesByReg, `${year}-05-01`)) {
    ;(h.block ? blocked : cautions).push(h.message)
    if (!labels.some((l) => l.registration === h.registration)) labels.push({ product: h.product, registration: h.registration })
  }
  // Volunteers of a recent canola that the planned canola's own herbicide
  // won't take out. A warning: the company decides whether it takes the field.
  if (g === 'canola' && crop.trait) {
    const record =
      field.canola ??
      [...field.crops].flatMap(([y, ids]) =>
        ids.flatMap((id) => {
          const c = cropsById.get(id)
          return c?.trait ? [{ year: y, crop: c.name, trait: c.trait }] : []
        }),
      )
    for (const w of volunteerConflicts({ name: crop.name, trait: crop.trait }, year, record)) {
      cautions.push(w)
      agronomy -= 1
    }
  }
  // What the scouts found here.
  for (const h of scoutHits(k, field.scouting ?? [], year)) {
    if (h.block) blocked.push(h.message)
    else {
      cautions.push(h.message)
      agronomy -= h.severity
    }
  }
  // Heat units: corn and beans need a long enough season.
  let heatFactor = 0
  // Silage hybrids are chopped before black layer and need less heat.
  const need = k === 'corn' && /silage/i.test(crop.name) ? 2100 : CHU_NEED[k]
  if (need && field.chu != null && field.chu < need) {
    const short = need - field.chu
    heatFactor = Math.min(0.3, short / need)
    cautions.push(`About ${Math.round(field.chu)} corn heat units expected here; ${crop.name} needs about ${need}`)
    agronomy -= Math.min(3, short / 100)
  }
  // Diversity: a crop new to the field in the last three years.
  const recent = new Set([year - 1, year - 2, year - 3].flatMap((y) => keysIn(y).map((c) => c.key)))
  if (!recent.has(k)) agronomy += 1

  // Profit: margin with the rotation effects the research measured.
  let profit: number | null = null
  const econ = field.economics?.get(crop.id)
  const baseMargin = econ?.margin ?? crop.margin
  if ((econ?.revenue != null && econ.cost != null) || baseMargin != null) {
    let factor = yieldFactor - heatFactor
    if (g === 'canola' && since > crop.minReturn) factor += Math.min(0.15, 0.05 * (since - crop.minReturn))
    if (CEREAL.has(k) && last.some((c) => LEGUME.has(c.key))) factor += 0.1
    if (k === 'potato' && last.some((c) => c.key === 'dry_bean' || c.key === 'canola')) factor += 0.05
    if (cautions.length) factor -= 0.05 * cautions.length
    // The rotation effects move the yield, so they scale revenue, not the margin.
    profit = econ?.revenue != null && econ.cost != null ? econ.revenue * factor - econ.cost : baseMargin! * factor
  }
  // Soil.
  let soil = SOIL_SCORE[k].score
  if (LEGUME.has(k) && !LOW_RESIDUE.has(k)) soil += 0.5
  if (field.sandy && LOW_RESIDUE.has(k)) soil -= 1.5
  if (!recent.has(k)) soil += 0.5
  return { cropId: crop.id, blocked, cautions, labels, plus, agronomy, profit, soil }
}

export type Objective = 'rotation' | 'profit' | 'soil'

export const OBJECTIVE_LABEL: Record<Objective, string> = {
  rotation: 'Best rotation',
  profit: 'Most profitable',
  soil: 'Best for the soil',
}

export function objectiveScore(e: Evaluation, o: Objective): number {
  const profit = e.profit ?? -150
  if (o === 'rotation') return e.agronomy * 10 + e.soil * 2 + profit / 100
  if (o === 'profit') return profit + e.agronomy * 15
  return e.soil * 10 + e.agronomy * 4 + profit / 200
}

export type Assignment = { fieldId: string; cropId: string | null; evaluation: Evaluation | null; note: string | null }

/**
 * One plan for `year`: every farmed field gets the best-scoring allowed crop
 * for the objective, highest-scoring pairs first, inside each crop's acre limit.
 * A perennial stand under three years old stays.
 */
export function buildPlan(
  o: Objective,
  year: number,
  fields: FieldCtx[],
  crops: CropInfo[],
  pref: (prevId: string, nextId: string) => { preference: Preference; notes: string | null } | null,
  rulesByReg: Map<string, RecropRule[]>,
  maxAcres: Map<string, number>,
  /** Combined limits by group (all beans together), keyed as groupOf(). */
  groupMax: Map<string, number> = new Map(),
  /** Fields whose crop is already settled: they keep it and count toward the limits. */
  fixed: Map<string, string> = new Map(),
  opts: {
    /** Acres a crop must have (contracts, the herd's feed); filled first, on its best fields. */
    minAcres?: Map<string, number>
    /** Why a crop has its minimum — the note on the fields placed to fill it. */
    minNote?: Map<string, string>
    /** Acre-inches of irrigation water available per source ('smrid', a licence id). */
    waterAvailable?: Map<string, number>
  } = {},
): {
  assignments: Assignment[]
  acres: Map<string, number>
  margin: number
  unpriced: number
  /** Acre-inches the plan needs, per source. */
  water: Map<string, number>
  /** Minimums (contracts, feed) the plan could not fill: crop id → acres short. */
  shortOfContract: Map<string, number>
} {
  const byId = new Map(crops.map((c) => [c.id, c]))
  const acres = new Map<string, number>()
  const groupAcres = new Map<string, number>()
  const water = new Map<string, number>()
  const waterFor = (f: FieldCtx, cropId: string) => (f.irrigatedAcres ?? 0) * (f.waterNeedIn?.(cropId) ?? byId.get(cropId)?.waterNeedIn ?? 0)
  const drink = (f: FieldCtx, cropId: string) => {
    if (!f.waterSource) return
    water.set(f.waterSource, (water.get(f.waterSource) ?? 0) + waterFor(f, cropId))
  }
  const groupOfId = (id: string) => {
    const c = byId.get(id)
    return c ? groupOf(c.key) : id
  }
  const take = (id: string, ac: number) => {
    acres.set(id, (acres.get(id) ?? 0) + ac)
    const g = groupOfId(id)
    groupAcres.set(g, (groupAcres.get(g) ?? 0) + ac)
  }
  // With no limit set, no crop takes more than a share of the farm — a plan
  // that puts every acre in its single best crop is not a rotation.
  const total = fields.reduce((a, f) => a + f.acres, 0)
  const softShare = o === 'profit' ? 0.5 : 0.35
  const out = new Map<string, Assignment>()
  const cands: { f: FieldCtx; e: Evaluation; s: number }[] = []
  /** field → the first reason each crop was ruled out there. */
  const blockedWhy = new Map<string, string[]>()
  /** Fields whose crop is settled (already planned, a stand, a contract): never swapped. */
  const locked = new Set<string>()
  for (const f of fields) {
    const settled = fixed.get(f.id)
    if (settled) {
      const c = byId.get(settled)
      out.set(f.id, { fieldId: f.id, cropId: settled, evaluation: c ? evaluate(f, c, year, byId, pref, rulesByReg) : null, note: 'Already planned — kept' })
      take(settled, f.acres)
      drink(f, settled)
      locked.add(f.id)
      continue
    }
    const last = (f.crops.get(year - 1) ?? []).map((id) => byId.get(id)).filter(Boolean) as CropInfo[]
    const stand = last.find((c) => c.standMax != null && c.standMax > 0)
    if (stand) {
      const age = runLength(f.crops, stand.id, year)
      // Kept in until its minimum; between the minimum and the maximum it may
      // stay or come out, whichever scores better.
      if (age < (stand.standMin ?? stand.standMax!)) {
        const e = evaluate(f, stand, year, byId, pref, rulesByReg)
        out.set(f.id, { fieldId: f.id, cropId: stand.id, evaluation: e, note: `${stand.name} stand, year ${age + 1} — keep it` })
        take(stand.id, f.acres)
        drink(f, stand.id)
        locked.add(f.id)
        continue
      }
    }
    for (const c of crops) {
      // A renter's crop stays in `crops` so the rules still know what it leaves behind.
      if (c.renterOnly) continue
      const e = evaluate(f, c, year, byId, pref, rulesByReg)
      if (e.blocked.length) {
        blockedWhy.set(f.id, [...(blockedWhy.get(f.id) ?? []), e.blocked[0]])
        continue
      }
      cands.push({ f, e, s: objectiveScore(e, o) })
    }
  }
  cands.sort((a, b) => b.s - a.s)
  // The soft share applies to a host group as well as a crop — grain,
  // high-moisture and silage corn are one crop to the rotation, so they share
  // the one cap.
  const softCap = Math.max(softShare * total, Math.max(...fields.map((f) => f.acres)))
  const fits = (f: FieldCtx, cropId: string, relax: { water?: boolean; soft?: boolean } = {}) => {
    const userMax = maxAcres.get(cropId)
    if ((acres.get(cropId) ?? 0) + f.acres > (userMax ?? (relax.soft ? Infinity : softCap)) + 0.5) return false
    const g = groupOfId(cropId)
    const gLim = groupMax.get(g) ?? (relax.soft ? undefined : softCap)
    if (gLim != null && (groupAcres.get(g) ?? 0) + f.acres > gLim + 0.5) return false
    const avail = f.waterSource ? opts.waterAvailable?.get(f.waterSource) : undefined
    if (!relax.water && avail != null && (water.get(f.waterSource!) ?? 0) + waterFor(f, cropId) > avail + 0.5) return false
    return true
  }
  const place = (f: FieldCtx, e: Evaluation, note: string | null) => {
    out.set(f.id, { fieldId: f.id, cropId: e.cropId, evaluation: e, note })
    take(e.cropId, f.acres)
    drink(f, e.cropId)
  }
  // Contracts first: each gets its best fields until its acres are covered.
  const shortOfContract = new Map<string, number>()
  for (const [cropId, need] of opts.minAcres ?? []) {
    for (const { f, e } of cands) {
      if ((acres.get(cropId) ?? 0) >= need - 0.5) break
      if (e.cropId !== cropId || out.has(f.id) || !fits(f, cropId)) continue
      place(f, e, opts.minNote?.get(cropId) ?? 'Placed to fill a contract')
      locked.add(f.id)
    }
    const got = acres.get(cropId) ?? 0
    if (got < need - 0.5) shortOfContract.set(cropId, need - got)
  }
  for (const { f, e } of cands) {
    if (out.has(f.id) || !fits(f, e.cropId)) continue
    place(f, e, null)
  }
  const unplace = (f: FieldCtx) => {
    const a = out.get(f.id)
    if (!a?.cropId) return
    out.delete(f.id)
    acres.set(a.cropId, (acres.get(a.cropId) ?? 0) - f.acres)
    const g = groupOfId(a.cropId)
    groupAcres.set(g, (groupAcres.get(g) ?? 0) - f.acres)
    if (f.waterSource) water.set(f.waterSource, (water.get(f.waterSource) ?? 0) - waterFor(f, a.cropId))
  }
  // Water repair: a field left without a crop because its licence ran dry
  // gets room made for it — the other fields on that licence step down to a
  // lighter crop, cheapest score per inch saved first — rather than one field
  // going over. The greedy pass hands the thirsty crops out first; this undoes
  // the ones that cost the least to undo.
  const candsOf = new Map<string, { f: FieldCtx; e: Evaluation; s: number }[]>()
  for (const c of cands) candsOf.set(c.f.id, [...(candsOf.get(c.f.id) ?? []), c])
  const scoreOf = (fid: string) => {
    const a = out.get(fid)
    return a?.evaluation ? objectiveScore(a.evaluation, o) : 0
  }
  /**
   * Make room on f's water source for one of its crops: step the other fields
   * on that source down to lighter crops, cheapest score per inch saved first,
   * until one of f's crops fits. `soft` lets f (only f) go past the one-crop
   * share. Returns whether f was placed.
   */
  const makeRoom = (f: FieldCtx, soft: boolean): boolean => {
    if (!f.waterSource || opts.waterAvailable?.get(f.waterSource) == null) return false
    const mine = candsOf.get(f.id) ?? []
    const relaxed = soft ? { soft: true } : {}
    if (!mine.some((c) => fits(f, c.e.cropId, { ...relaxed, water: true }))) return false
    for (let guard = 0; guard < 40 && !mine.some((c) => fits(f, c.e.cropId, relaxed)); guard++) {
      let best: { g: FieldCtx; alt: { e: Evaluation; s: number }; loss: number } | null = null
      for (const g of fields) {
        const a = out.get(g.id)
        if (!a?.cropId || locked.has(g.id) || g.id === f.id || g.waterSource !== f.waterSource) continue
        const curW = waterFor(g, a.cropId)
        const curS = scoreOf(g.id)
        const current = { e: a.evaluation!, note: a.note }
        unplace(g)
        for (const alt of candsOf.get(g.id) ?? []) {
          const saved = curW - waterFor(g, alt.e.cropId)
          if (saved <= 0.5 || !fits(g, alt.e.cropId)) continue
          const loss = (curS - alt.s) / saved
          if (!best || loss < best.loss) best = { g, alt, loss }
        }
        place(g, current.e, current.note)
      }
      if (!best) break
      unplace(best.g)
      place(best.g, best.alt.e, 'Stepped down to a lighter crop to leave water for the rest of its licence')
    }
    const now = mine.find((c) => fits(f, c.e.cropId, relaxed))
    if (!now) return false
    place(f, now.e, soft ? 'Past the usual one-crop share of the farm — nothing else fits here' : null)
    return true
  }
  // 1. Room on the licence, within every limit.
  for (const f of fields) if (!out.has(f.id)) makeRoom(f, false)
  // 2. Past the one-crop share, but inside the water.
  for (const { f, e } of cands) {
    if (out.has(f.id) || !fits(f, e.cropId, { soft: true })) continue
    place(f, e, 'Past the usual one-crop share of the farm — nothing else fits here')
  }
  // 3. Room on the licence for a field that can only go past the share.
  for (const f of fields) if (!out.has(f.id)) makeRoom(f, true)
  const sourceName = (k: string | null | undefined) => (k === 'smrid' ? `${farmDistrict()} allotment` : k?.startsWith('licence:') ? 'licence' : 'water')
  // 4. Last resort — a field is never left empty for want of water: the
  // least thirsty crop that passes the rules, and the plan says it is over.
  const byThirst = [...cands].sort((a, b) => waterFor(a.f, a.e.cropId) - waterFor(b.f, b.e.cropId) || b.s - a.s)
  for (const { f, e } of byThirst) {
    if (out.has(f.id) || !fits(f, e.cropId, { water: true, soft: true })) continue
    place(f, e, `Over its ${sourceName(f.waterSource)} even with the others stepped down — needs a transfer, or run it short`)
  }
  let margin = 0
  let unpriced = 0
  for (const f of fields) {
    const a = out.get(f.id)
    if (!a) {
      // Say why: the rule that ruled out the most crops here.
      const why = blockedWhy.get(f.id) ?? []
      const counts = new Map<string, number>()
      for (const w of why) counts.set(w, (counts.get(w) ?? 0) + 1)
      const top = [...counts].sort((x, y) => y[1] - x[1])[0]?.[0]
      out.set(f.id, {
        fieldId: f.id,
        cropId: null,
        evaluation: null,
        note: top ? `Every crop breaks a rule here — most often: ${top}. Pick by hand.` : 'No allowed crop fits inside the acre limits and the water',
      })
    }
    else if (a.evaluation?.profit != null) margin += a.evaluation.profit * f.acres
    else if (a.cropId) unpriced += f.acres
  }
  return { assignments: fields.map((f) => out.get(f.id)!), acres, margin, unpriced, water, shortOfContract }
}
