/**
 * Fusarium head blight risk, field by field.
 *
 * Everything here comes out of Alberta's own factsheet, "Fusarium head blight
 * of barley and wheat" (2020), which the research library holds. The sheet is
 * not a scored checklist like the sclerotinia one — it is a set of conditions,
 * which suits the app better, because the app already holds most of the inputs:
 * planting dates, stage lengths, rotation history, hourly weather, irrigation
 * passes and spray records.
 *
 * The one place the sheet leaves room is its weather rule. It says disease
 * development accelerates "when air temperatures around 25 degrees C are
 * associated with precipitation, or very high humidity, for 36 hours" — words,
 * not thresholds. WARM_LO_C, WARM_HI_C, HUMID_RH and WET_MM below are this
 * app's reading of "around", "very high" and "precipitation", and they are
 * named, exported and shown on screen so the reading is visible rather than
 * buried. Change them and the page changes with them.
 *
 * What the sheet is quoted on, and what this file does not invent:
 *  - the 36-hour rule above;
 *  - rotating away from cereals and corn for at least two years, because both
 *    residues carry the fungus over winter;
 *  - susceptibility falling from durum, through CPS and hard red spring wheat,
 *    to barley and oat, with winter wheat usually escaping because it flowers
 *    before the spores are about;
 *  - a spray window of about seven days, from the heads being out of the boot
 *    to half the main-stem heads in flower, narrowed by warm weather;
 *  - Group 11 strobilurins not being FHB fungicides — they may raise DON;
 *  - holding irrigation off just before and during flowering;
 *  - staggering seeding dates so the cereal fields do not all flower at once.
 */

import { daysBetween, phaseForDay, type StageLengths } from './crop-irrigation'

/** The paper every rule here comes from, for the citation on screen. */
export const FHB_PAPER = {
  id: 'f7f938c0-a358-4fbb-b8da-2293fce82569',
  title: 'Fusarium head blight of barley and wheat',
  publisher: 'Alberta Agriculture and Forestry',
  year: 2020,
} as const

// ---------------------------------------------------------------------------
// The weather rule
// ---------------------------------------------------------------------------

/**
 * The sheet's "around 25 degrees C", read as a band.
 *
 * Deliberately wide. A 36-hour spell never sits at one temperature, and a band
 * narrow enough to exclude a 29 °C afternoon would miss the weather the sheet
 * is describing.
 */
export const WARM_LO_C = 20
export const WARM_HI_C = 30

/** The sheet's "very high humidity", read as a mean relative humidity. */
export const HUMID_RH = 85

/** The sheet's "associated with precipitation", read as a total over the spell. */
export const WET_MM = 1

/** The sheet's "for 36 hours", exactly as printed. */
export const SPELL_HOURS = 36

/** How this app reads the sheet's words, for the note on screen. */
export const RULE_IN_WORDS =
  `${SPELL_HOURS} hours whose mean temperature is ${WARM_LO_C}–${WARM_HI_C} °C, ` +
  `with at least ${WET_MM} mm of rain over the spell or a mean humidity of ${HUMID_RH}% or more`

export type Hour = { ts: string; temp_c: number | null; rh: number | null; precip_mm: number | null; forecast?: boolean }
export type Day = {
  date: string
  tmax_c: number | null
  tmin_c: number | null
  rh_mean: number | null
  rh_max: number | null
  rh_min: number | null
  precip_mm: number | null
}

/** A run of weather the sheet would call conducive. */
export type Spell = {
  /** First and last hour (or day) of the run, as ISO dates. */
  from: string
  to: string
  hours: number
  meanTempC: number
  meanRh: number | null
  rainMm: number
  /** What tipped it: rain, humidity, or both. */
  wet: 'rain' | 'humidity' | 'both'
  /** True when any reading in the run is still a forecast. */
  forecast: boolean
}

/** What the spells were worked out from. Hourly is the sheet's own rule; daily is a reading of it. */
export type SpellBasis = 'hourly' | 'daily' | 'none'

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const dayOf = (ts: string) => ts.slice(0, 10)

/**
 * The 36-hour spells inside a window, from hourly readings.
 *
 * This is the sheet's rule as printed: a sliding 36-hour window, qualifying on
 * its mean temperature and either its rain total or its mean humidity.
 * Overlapping windows are merged, so a four-day wet warm spell reads as one
 * spell rather than sixty.
 */
export function spellsFromHours(hours: Hour[], from: string, to: string): Spell[] {
  const inWindow = hours
    .filter((h) => dayOf(h.ts) >= from && dayOf(h.ts) <= to)
    .sort((a, b) => a.ts.localeCompare(b.ts))
  if (inWindow.length < SPELL_HOURS) return []

  const qualifying: { i: number; j: number }[] = []
  for (let i = 0; i + SPELL_HOURS <= inWindow.length; i++) {
    const run = inWindow.slice(i, i + SPELL_HOURS)
    // A gap in the record is not a spell: the 36 readings must really span 36
    // hours, or a station that dropped out for a week would read as conducive.
    const spanH = (Date.parse(run[run.length - 1].ts) - Date.parse(run[0].ts)) / 3_600_000
    if (!Number.isFinite(spanH) || spanH > SPELL_HOURS * 1.5) continue
    const t = mean(run.map((h) => h.temp_c).filter((v): v is number => v != null))
    if (t == null || t < WARM_LO_C || t > WARM_HI_C) continue
    const rain = run.reduce((s, h) => s + (h.precip_mm ?? 0), 0)
    const rh = mean(run.map((h) => h.rh).filter((v): v is number => v != null))
    if (rain < WET_MM && (rh == null || rh < HUMID_RH)) continue
    qualifying.push({ i, j: i + SPELL_HOURS - 1 })
  }
  if (!qualifying.length) return []

  const merged: { i: number; j: number }[] = []
  for (const q of qualifying) {
    const last = merged[merged.length - 1]
    if (last && q.i <= last.j) last.j = Math.max(last.j, q.j)
    else merged.push({ ...q })
  }
  return merged.map(({ i, j }) => {
    const run = inWindow.slice(i, j + 1)
    const rain = run.reduce((s, h) => s + (h.precip_mm ?? 0), 0)
    const rh = mean(run.map((h) => h.rh).filter((v): v is number => v != null))
    return {
      from: dayOf(run[0].ts),
      to: dayOf(run[run.length - 1].ts),
      hours: run.length,
      meanTempC: mean(run.map((h) => h.temp_c).filter((v): v is number => v != null)) ?? 0,
      meanRh: rh,
      rainMm: rain,
      wet: wetKind(rain, rh),
      forecast: run.some((h) => h.forecast),
    }
  })
}

const wetKind = (rainMm: number, rh: number | null): Spell['wet'] => {
  const wetEnough = rainMm >= WET_MM
  const humid = rh != null && rh >= HUMID_RH
  return wetEnough && humid ? 'both' : wetEnough ? 'rain' : 'humidity'
}

/**
 * The same rule read off daily records, for the seasons hourly does not reach.
 *
 * Hourly readings are kept for about four months, so any earlier season has
 * only daily ones. Thirty-six hours spans two calendar days, so a run of two
 * or more days counts when each day's high sits in the band and the run as a
 * whole was wet or humid. It is a coarser instrument than the hourly scan and
 * the screen says which one produced the answer.
 */
export function spellsFromDays(days: Day[], from: string, to: string): Spell[] {
  const inWindow = days.filter((d) => d.date >= from && d.date <= to).sort((a, b) => a.date.localeCompare(b.date))
  const rhOf = (d: Day) =>
    d.rh_mean ?? (d.rh_max != null && d.rh_min != null ? (Number(d.rh_max) + Number(d.rh_min)) / 2 : null)
  const warm = (d: Day) => d.tmax_c != null && Number(d.tmax_c) >= WARM_LO_C && Number(d.tmax_c) <= WARM_HI_C

  const out: Spell[] = []
  let run: Day[] = []
  const close = () => {
    if (run.length >= 2) {
      const rain = run.reduce((s, d) => s + Number(d.precip_mm ?? 0), 0)
      const rh = mean(run.map(rhOf).filter((v): v is number => v != null))
      if (rain >= WET_MM || (rh != null && rh >= HUMID_RH)) {
        const temps = run.flatMap((d) => [d.tmax_c, d.tmin_c].filter((v): v is number => v != null).map(Number))
        out.push({
          from: run[0].date,
          to: run[run.length - 1].date,
          hours: run.length * 24,
          meanTempC: mean(temps) ?? 0,
          meanRh: rh,
          rainMm: rain,
          wet: wetKind(rain, rh),
          forecast: false,
        })
      }
    }
    run = []
  }
  for (const d of inWindow) {
    const consecutive = !run.length || daysBetween(run[run.length - 1].date, d.date) === 1
    if (!warm(d) || !consecutive) close()
    if (warm(d)) run.push(d)
  }
  close()
  return out
}

/**
 * The spells in a window, from the sharpest record that covers it.
 *
 * Hourly wins where it reaches, because it is the sheet's own rule rather than
 * a reading of it; daily stands in for the earlier seasons. "Covers" means the
 * hourly record reaches the start of the window — a window half covered would
 * report no spell for the uncovered half and look quieter than it was.
 */
export function fhbSpells(args: {
  from: string
  to: string
  hours: Hour[]
  days: Day[]
}): { spells: Spell[]; basis: SpellBasis } {
  const earliestHour = args.hours.length ? dayOf(args.hours.map((h) => h.ts).sort()[0]) : null
  if (earliestHour != null && earliestHour <= args.from) {
    return { spells: spellsFromHours(args.hours, args.from, args.to), basis: 'hourly' }
  }
  if (args.days.some((d) => d.date >= args.from && d.date <= args.to)) {
    return { spells: spellsFromDays(args.days, args.from, args.to), basis: 'daily' }
  }
  return { spells: [], basis: 'none' }
}

// ---------------------------------------------------------------------------
// Which crops are in this at all
// ---------------------------------------------------------------------------

/**
 * How susceptible a cereal is, in the sheet's own order.
 *
 * "In general, the level of FHB susceptibility decreases from durum wheat to
 * CPS wheat to hard red spring wheat to barley and to oat." Winter wheat is
 * its own case: it usually escapes, flowering before the spores are about.
 * Triticale is a host the sheet does not rank, so it is not given a rank here
 * either.
 */
export type CerealClass = 'durum' | 'spring wheat' | 'winter wheat' | 'barley' | 'oat' | 'triticale'

export const SUSCEPTIBILITY: Record<CerealClass, { rank: number | null; label: string }> = {
  durum: { rank: 1, label: 'the most susceptible cereal Alberta lists' },
  'spring wheat': { rank: 2, label: 'more susceptible than barley, less than durum' },
  barley: { rank: 3, label: 'less susceptible than wheat' },
  oat: { rank: 4, label: 'the least susceptible, but with very little tolerance for damaged kernels' },
  'winter wheat': { rank: null, label: 'usually escapes: it flowers before the spores are about' },
  triticale: { rank: null, label: 'a host the sheet does not rank' },
}

/**
 * Which cereal a crop in the plan is, for the risk note.
 *
 * Matched on explicit names, not similarity. Green feed is barley cut green on
 * this farm, and shares barley's susceptibility; a crop this does not know
 * comes back null and is left out rather than guessed at.
 */
export function cerealClass(cropName: string | null | undefined): CerealClass | null {
  if (!cropName) return null
  const n = cropName.toLowerCase()
  if (/durum/.test(n)) return 'durum'
  if (/winter wheat/.test(n)) return 'winter wheat'
  if (/triticale/.test(n)) return 'triticale'
  if (/\bwheat\b/.test(n)) return 'spring wheat'
  if (/\boat/.test(n)) return 'oat'
  if (/barley|green ?feed/.test(n)) return 'barley'
  return null
}

/**
 * Whether a crop's residue carries the fungus over winter.
 *
 * Cereals and corn both do. The sheet is explicit that corn is the worse of
 * the two for sheer volume of residue — "corn stubble has the capability of
 * containing huge amounts of Fusarium fungi inoculum" — even though corn is
 * not an essential link in the cycle.
 */
export function isResidueHost(cropName: string | null | undefined): boolean {
  if (!cropName) return false
  if (cerealClass(cropName)) return true
  return /\bcorn\b|sorghum/i.test(cropName)
}

export const isCorn = (cropName: string | null | undefined) => /\bcorn\b|sorghum/i.test(cropName ?? '')

// ---------------------------------------------------------------------------
// When the crop is open to infection
// ---------------------------------------------------------------------------

/**
 * How long the heads stay open to infection once the crop starts heading.
 *
 * The sheet puts the spray window at "approximately seven days", from the
 * heads being out of the boot until half the main-stem heads are in flower,
 * and says FHB is favoured by warm humid weather "during flowering and early
 * stages of kernel development" — so the weather that matters runs past the
 * end of the spray window. Fourteen days carries it through early kernel fill.
 */
export const SPRAY_WINDOW_DAYS = 7
export const INFECTION_WINDOW_DAYS = 14

export type FhbWindow = {
  /** Early heading: where the crop's own water-use curve puts the mid stage. */
  headingOn: string
  /** The sheet's roughly seven-day fungicide window. */
  sprayFrom: string
  sprayTo: string
  /** Flowering and early kernel fill, the weather that decides the year. */
  from: string
  to: string
}

const shift = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * The infection window for one field, from its planting date.
 *
 * Heading is taken as the start of the FAO mid stage — exactly the boundary
 * `phaseForDay` already uses, and the one Alberta's own irrigation sheets
 * label "early heading to fruit formation". Taking it from there rather than
 * from a second model means the page cannot disagree with the irrigation
 * trigger about when the crop is heading.
 */
export function infectionWindow(plantingDate: string | null, lengths: StageLengths | null): FhbWindow | null {
  if (!plantingDate || !lengths) return null
  const toMid = Number(lengths.l_ini) + Number(lengths.l_dev)
  if (!Number.isFinite(toMid) || toMid <= 0) return null
  const headingOn = shift(plantingDate.slice(0, 10), toMid)
  return {
    headingOn,
    sprayFrom: headingOn,
    sprayTo: shift(headingOn, SPRAY_WINDOW_DAYS),
    from: headingOn,
    to: shift(headingOn, INFECTION_WINDOW_DAYS),
  }
}

/** Where today sits against a window, for the chip on the row. */
export type WindowState = 'before' | 'spray window' | 'open' | 'past'

export function windowState(w: FhbWindow, today: string): WindowState {
  if (today < w.from) return 'before'
  if (today <= w.sprayTo) return 'spray window'
  if (today <= w.to) return 'open'
  return 'past'
}

/** The stage the crop's own curve says it is in, for the row's subtitle. */
export function phaseToday(plantingDate: string | null, lengths: StageLengths | null, today: string) {
  if (!plantingDate || !lengths) return null
  return phaseForDay(lengths, daysBetween(plantingDate.slice(0, 10), today))
}

// ---------------------------------------------------------------------------
// Residue, irrigation and the fungicide
// ---------------------------------------------------------------------------

/**
 * What the last two years left on the field.
 *
 * The sheet asks for at least two years away from cereals and corn, so the
 * residue is gone before the next cereal. Two years is the whole question, so
 * only two are looked at; a field with a host in either of them has not had
 * them.
 */
export function residueRisk(
  history: { crop_year: number; cropName: string | null }[],
  cropYear: number,
): { hosts: { crop_year: number; cropName: string | null; corn: boolean }[]; clear: boolean; unknown: boolean } {
  const want = [cropYear - 1, cropYear - 2]
  const seen = want.map((y) => history.find((h) => h.crop_year === y) ?? null)
  const hosts = seen
    .filter((h): h is { crop_year: number; cropName: string | null } => h != null && isResidueHost(h.cropName))
    .map((h) => ({ ...h, corn: isCorn(h.cropName) }))
  return { hosts, clear: hosts.length === 0, unknown: seen.some((h) => h == null) }
}

/** Alberta's own words on Group 11, which is why they are quoted on screen. */
export const GROUP_11_NOTE =
  'Strobilurin fungicides (group 11) should not be used for FHB management because they may cause increased DON contamination in harvested grain.'

export type Applied = { applied_on: string; name: string; scheme: string | null; group_code: string | null }

/** Any Group 11 fungicide that went on inside the window — the sheet's hard no. */
export function group11InWindow(applied: Applied[], w: FhbWindow): Applied[] {
  return applied.filter(
    (a) => a.scheme === 'fungicide' && a.group_code === '11' && a.applied_on >= w.from && a.applied_on <= w.to,
  )
}

/** Irrigation the sheet would have held off: passes just before and during flowering. */
export const HOLD_OFF_BEFORE_DAYS = 7

export function irrigationInWindow(
  events: { date: string; gross_mm: number | null }[],
  w: FhbWindow,
): { date: string; gross_mm: number | null; before: boolean }[] {
  const opens = shift(w.from, -HOLD_OFF_BEFORE_DAYS)
  return events
    .filter((e) => e.date >= opens && e.date <= w.to)
    .map((e) => ({ ...e, before: e.date < w.from }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

// ---------------------------------------------------------------------------
// Putting a field together
// ---------------------------------------------------------------------------

export type FhbLevel = 'low' | 'watch' | 'high'

export type FhbField = {
  fieldId: string
  fieldName: string
  cropName: string | null
  cereal: CerealClass
  variety: string | null
  irrigated: boolean
  plantingDate: string | null
  window: FhbWindow | null
  phase: ReturnType<typeof phaseToday>
  state: WindowState | null
  spells: Spell[]
  basis: SpellBasis
  residue: ReturnType<typeof residueRisk>
  irrigation: ReturnType<typeof irrigationInWindow>
  group11: Applied[]
  level: FhbLevel
  reasons: string[]
}

/**
 * The level for one field, and why.
 *
 * Deliberately only three levels and a list of sentences. The sheet gives no
 * score and no weights, so a number here would be this app's invention dressed
 * as Alberta's; the reasons are what a person actually acts on.
 */
export function levelFor(f: {
  spells: Spell[]
  residue: ReturnType<typeof residueRisk>
  irrigation: ReturnType<typeof irrigationInWindow>
  cereal: CerealClass
  irrigated: boolean
  state: WindowState | null
}): { level: FhbLevel; reasons: string[] } {
  const reasons: string[] = []
  const conducive = f.spells.length

  if (conducive) {
    // The spells' own hours and temperatures are listed underneath, so this
    // line names the weather rather than restating the rule. It used to splice
    // in the rule's own "36 hours", which read as the length of the spell and
    // contradicted a 38-hour spell printed two lines below it.
    const forecast = f.spells.some((s) => s.forecast)
    reasons.push(
      `${conducive} spell${conducive === 1 ? '' : 's'} of the warm, wet weather Alberta describes, in the flowering window` +
        `${forecast ? ', one of them still a forecast' : ''}`,
    )
  }
  for (const h of f.residue.hosts) {
    reasons.push(
      h.corn
        ? `${h.cropName} in ${h.crop_year}: corn stubble carries the most inoculum of any residue`
        : `${h.cropName} in ${h.crop_year}: cereal residue still carrying the fungus`,
    )
  }
  if (f.residue.unknown) reasons.push('one of the last two years has no crop on record')
  if (f.irrigation.length) {
    const during = f.irrigation.filter((e) => !e.before).length
    reasons.push(
      during
        ? `${during} irrigation pass${during === 1 ? '' : 'es'} during flowering, when the sheet asks for the canopy to stay dry`
        : 'irrigated in the week before flowering',
    )
  }
  const s = SUSCEPTIBILITY[f.cereal]
  if (s.rank != null && s.rank <= 2) reasons.push(`${f.cereal} is ${s.label}`)
  if (f.cereal === 'winter wheat') reasons.push(SUSCEPTIBILITY['winter wheat'].label)
  if (f.irrigated) reasons.push('irrigated: Alberta finds F. graminearum most often in irrigated southern fields')

  // Weather is the thing that decides a year, so it is the thing that lifts a
  // field to high. Residue and irrigation on their own are a reason to watch
  // and to plan next year's rotation, not a reason to call the crop infected.
  const level: FhbLevel =
    conducive && (f.residue.hosts.length > 0 || f.irrigation.some((e) => !e.before))
      ? 'high'
      : conducive || f.residue.hosts.length > 0
        ? 'watch'
        : 'low'
  return { level: f.cereal === 'winter wheat' && level === 'high' ? 'watch' : level, reasons }
}

export const LEVEL_LABEL: Record<FhbLevel, string> = { low: 'Low', watch: 'Watch', high: 'High' }
export const LEVEL_STYLE: Record<FhbLevel, string> = {
  low: 'bg-green-100 text-green-800',
  watch: 'bg-yellow-100 text-yellow-800',
  high: 'bg-red-100 text-red-800',
}

/** Most pressing first, so the row that needs a decision is at the top. */
export function sortFields(rows: FhbField[]): FhbField[] {
  const order: Record<FhbLevel, number> = { high: 0, watch: 1, low: 2 }
  return [...rows].sort(
    (a, b) =>
      order[a.level] - order[b.level] ||
      (a.window?.from ?? '9999').localeCompare(b.window?.from ?? '9999') ||
      a.fieldName.localeCompare(b.fieldName),
  )
}

/**
 * Cereal fields whose flowering windows land on top of each other.
 *
 * "Vary seeding dates to avoid having all cereal fields flowering at the same
 * time" is the one piece of the sheet's advice that cannot be acted on in the
 * year it is noticed — it is a note for next spring's seeding plan, and for
 * the sprayer, which cannot cover every field in one seven-day window.
 */
export function floweringClashes(rows: FhbField[]): { on: string; fields: string[] }[] {
  const byDay = new Map<string, string[]>()
  for (const r of rows) {
    if (!r.window) continue
    for (let i = 0; i <= SPRAY_WINDOW_DAYS; i++) {
      const d = shift(r.window.sprayFrom, i)
      byDay.set(d, [...(byDay.get(d) ?? []), r.fieldName])
    }
  }
  const worst = [...byDay.entries()].filter(([, f]) => f.length > 1).sort((a, b) => b[1].length - a[1].length)
  if (!worst.length) return []
  // One line, not thirty: the busiest day in each run of overlapping days.
  const out: { on: string; fields: string[] }[] = []
  const claimed = new Set<string>()
  for (const [on, fields] of worst) {
    if (fields.every((f) => claimed.has(f))) continue
    fields.forEach((f) => claimed.add(f))
    out.push({ on, fields: [...fields].sort() })
  }
  return out
}

export { shift as addDaysISO }
