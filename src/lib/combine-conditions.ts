import type { CombineCropKey, SettingKey } from './combine'
import { combineCropOf } from './combine-field'
import { gradeFor, hasBands, type Grade, type MoistureBands } from './moisture'

/**
 * Conditions in, starting adjustments out (Sam, 17 Oct 2026: "takes the
 * NDVI maps … the moisture test … and the humidity/wind/temp for how the
 * combine settings should be").
 *
 * A TRANSPARENT RULES ENGINE, deliberately. Every suggestion is one named
 * rule firing on one measured condition, with the reason and where the rule
 * comes from beside it, so the operator can see why and disagree. Nothing is
 * learned and nothing is hidden.
 *
 * DIRECTIONS, NEVER NUMBERS. The New Holland CR manual gives a starting
 * setting per crop and says which way to move a setting for a symptom; it
 * gives no step sizes. So a suggestion is "+1 step", "open a step" or
 * "slower", measured from the crop's saved (or last year's, or the book's)
 * setting, and never an absolute figure the manual does not print.
 *
 * NOTHING IS SENT TO THE COMBINE. The app does not talk to the machine at
 * all; these are starting points for the operator to try on the monitor and
 * check with a kill-stop and a loss check.
 *
 * SOURCES, in order of authority:
 *  - `manual`: New Holland CR operator's manual, section 6, as typed into
 *    combine-manual.ts (INDICATORS, LOSS_SITES): over-threshing → open the
 *    concave and/or slow the rotor; unthreshed → rotor up and/or concave in;
 *    cracked grain → open the concave, then slow the rotor; grain on the rear
 *    third of the upper sieve → open it; lots of trash → more fan or close the
 *    upper sieve; fan too fast → grain blown out (loss site 5).
 *  - `app`: the app's own settings guide (combine.ts SETTINGS / SYMPTOMS,
 *    our estimate, not the book): ground speed is the feed rate; tough crop
 *    at eight in the morning is not a settings problem.
 *  - `ccc2017`: Canola Council of Canada, Canola Watch, 13 Sep 2017,
 *    "Combine performance expectations for naturally ripened canola": green
 *    material → cut higher, go slower; rubbery green pods → more rotor and a
 *    tighter concave; check for cracked seed through the day and thresh less
 *    hard later in the day.
 *  - `cccSurvey`: Canola Council of Canada on-farm combine-loss survey
 *    (research blog, "How manual combine loss corrections compare to
 *    auto-adjusting capabilities"): losses ran significantly higher below
 *    23 °C, above 45 % RH and under cloud.
 *  - `ndsuPeas`: NDSU Extension, field pea harvest: combine at 17–20 %
 *    moisture to limit splits, run the cylinder slow and slower as the seed
 *    dries, humid hours (night, early morning) limit shatter.
 *  - `iowaDry`: Iowa State University Extension, Integrated Crop Management,
 *    "Tips for 2023 harvest: handling grain when moisture is low": dry grain
 *    is brittle and the threshing system is the main cause of breakage, so
 *    decrease rotor speed as the crop dries.
 *  - `iowaCorn`: Iowa State University Extension, "Combining in a year with
 *    heavy southern rust and leaf diseases": open the concave slightly for
 *    fragile corn, tighten a touch if cobs come out carrying kernels.
 *  - `extShoe`: Farm and Dairy (Ohio State extension column), "Adjust the
 *    combine for drought-stricken crops": a tight concave puts more broken
 *    straw on the cleaning shoe; brittle material loads the shoe.
 *  - `dew`: dew forms as the air cools to its dew point; air within 2 °C of
 *    it is the usual rule of thumb for dew forming (standard meteorology).
 *  - `ours`: a threshold we chose; said so wherever it is used.
 */

// ---- crops --------------------------------------------------------------

/** The crops these rules know. Peas share the book's "Peas / Edible beans" row. */
export type ConditionsCrop = CombineCropKey | 'peas'

export function conditionsCropOf(name: string | null | undefined): ConditionsCrop | null {
  const n = (name ?? '').toLowerCase()
  if (/pea|lentil|chickpea|faba/.test(n) && !/peanut/.test(n)) return 'peas'
  return combineCropOf(name)
}

/** The Combines page crop whose settings a crop starts from. */
export const settingsCropFor = (c: ConditionsCrop): CombineCropKey => (c === 'peas' ? 'beans' : c)

const PULSES: ConditionsCrop[] = ['peas', 'beans']
/** Light seed: the fan and the wind are what lose it. */
const LIGHT_SEED: ConditionsCrop[] = ['canola', 'sainfoin', 'oats']

/** What damage looks like in each crop's sample, for the reasons. */
const DAMAGE: Record<ConditionsCrop, string> = {
  canola: 'cracked seed',
  wheat: 'cracked kernels',
  durum: 'checked and broken kernels',
  barley: 'peeled kernels',
  oats: 'dehulled kernels',
  peas: 'splits',
  beans: 'splits and cracked seed coats',
  corn: 'cracked kernels',
  sainfoin: 'dehulled seed',
}

// ---- thresholds -----------------------------------------------------------

/**
 * Every number the rules turn on, in one place. All `ours` unless the
 * comment names a source.
 */
export const THRESHOLDS = {
  /** NDVI either side of the crop's farm median that counts as heavy or thin (about one colour step of the map's ramp). */
  ndviMargin: 0.05,
  /** Share of the field heavy (or thin) before the field is called heavy (or thin). */
  areaShare: 0.4,
  /** p90 − p10 of NDVI across the field at its peak that counts as uneven. */
  unevenSpread: 0.15,
  /** Same-crop fields (this one included) needed to call a field heavy or thin against the farm. */
  referenceFields: 3,
  /** Latest NDVI at or above this: still green. Mature, senesced cereal and canola canopies read roughly 0.2–0.35. */
  greenNdvi: 0.5,
  /** Latest NDVI at or above this (below greenNdvi): some green left. */
  someGreenNdvi: 0.38,
  /** A latest look older than this says nothing about green material today. */
  greenMaxAgeDays: 10,
  /** Below this share of the field cloud-free, a look is not used. */
  minValid: 0.6,
  /** RH under this: dry, brittle straw. */
  rhDry: 30,
  /** RH at or over this: straw toughening. */
  rhDamp: 70,
  /** Air within this of its dew point: dew forming (`dew`). */
  dewSpreadC: 2,
  /** Sustained wind, km/h, that counts as strong. */
  windKmh: 30,
  /** Gusts, km/h, that count as strong. */
  gustKmh: 50,
  /** Grain this many points under its dry limit: dry enough to crack. */
  overDryPts: 3,
  /** Canola: losses ran higher below this temperature (`cccSurvey`). */
  canolaCoolC: 23,
  /** Canola: and above this RH (`cccSurvey`). */
  canolaHumidRh: 45,
  /** Peas thresh with the fewest splits from here up (`ndsuPeas`: 17–20 %). */
  peasSplitBelow: 17,
} as const

// ---- NDVI: thickness and green ------------------------------------------

/** One satellite look at the whole field. */
export type NdviLook = {
  date: string
  mean: number
  p10: number | null
  p90: number | null
  sd: number | null
  /** Share of the field cloud-free and usable, 0–1. */
  validFraction: number | null
  quality: 'full' | 'partial'
  ndre: number | null
}

const Z90 = 1.2816

/** p10 and p90 of a look, from its standard deviation when they are missing. */
function tails(l: NdviLook): [number, number] | null {
  if (l.p10 != null && l.p90 != null && l.p90 > l.p10) return [l.p10, l.p90]
  if (l.sd != null && l.sd > 0) return [l.mean - Z90 * l.sd, l.mean + Z90 * l.sd]
  return null
}

/**
 * Share of the field above an NDVI value, from the look's p10, mean and p90:
 * a straight line between (p10, 10 %), (mean, 50 %) and (p90, 90 %), run on
 * at the same slope past each end. An estimate of the field's spread, not a
 * pixel count; with no spread recorded, all or nothing by the mean.
 */
export function shareAbove(l: NdviLook, t: number): number {
  const tl = tails(l)
  if (!tl) return l.mean > t ? 1 : 0
  const [p10, p90] = tl
  const mid = Math.min(Math.max(l.mean, p10 + 1e-6), p90 - 1e-6)
  let below: number
  if (t <= p10) below = 0.1 - (0.4 / (mid - p10)) * (p10 - t)
  else if (t <= mid) below = 0.1 + (0.4 * (t - p10)) / (mid - p10)
  else if (t <= p90) below = 0.5 + (0.4 * (t - mid)) / (p90 - mid)
  else below = 0.9 + (0.4 / (p90 - mid)) * (t - p90)
  return 1 - Math.min(1, Math.max(0, below))
}

/** A look clear enough to trust. */
export const usable = (l: NdviLook) => (l.validFraction ?? 1) >= THRESHOLDS.minValid

/** The season's thickest look: the highest field mean among the clear ones. */
export function peakLook(looks: NdviLook[]): NdviLook | null {
  const ok = looks.filter(usable)
  return ok.length ? ok.reduce((a, b) => (b.mean > a.mean ? b : a)) : null
}

/** The newest clear look. */
export function latestLook(looks: NdviLook[]): NdviLook | null {
  const ok = looks.filter(usable)
  return ok.length ? ok.reduce((a, b) => (b.date > a.date ? b : a)) : null
}

export type Reference = { median: number; fields: number }

/** The crop's middle on the farm, from each same-crop field's season peak. Null under `referenceFields`. */
export function referenceOf(peaks: number[]): Reference | null {
  const xs = peaks.filter(Number.isFinite).sort((a, b) => a - b)
  if (xs.length < THRESHOLDS.referenceFields) return null
  const m = xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2
  return { median: m, fields: xs.length }
}

export type Thickness = {
  peak: NdviLook
  latest: NdviLook | null
  /** What heavy and thin were measured against. */
  against: 'farm' | 'field'
  reference: Reference | null
  heavyShare: number
  thinShare: number
  averageShare: number
  /** p90 − p10 at the peak, when known. */
  spread: number | null
  overall: 'heavy' | 'thin' | 'average' | 'uneven'
  /** What the latest look says is still green; null when it is too old, or the crop is swathed. */
  green: 'green' | 'some' | 'ripe' | null
  latestAgeDays: number | null
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)

/**
 * How thick the crop is, from the season's peak NDVI (biomass is what the
 * peak measures; at harvest a ripe crop reads low whatever it carried), and
 * how green it still is, from the latest look.
 *
 * Heavy and thin are against the crop's median on the farm when enough
 * fields of it were seen, else against the field's own mean (which can only
 * say "uneven", never "heavy").
 */
export function thicknessOf(o: { looks: NdviLook[]; reference: Reference | null; today: string; swathed: boolean }): Thickness | null {
  const peak = peakLook(o.looks)
  if (!peak) return null
  const latest = latestLook(o.looks)
  const T = THRESHOLDS
  const centre = o.reference?.median ?? peak.mean
  const heavyShare = shareAbove(peak, centre + T.ndviMargin)
  const thinShare = 1 - shareAbove(peak, centre - T.ndviMargin)
  const tl = tails(peak)
  const spread = tl ? tl[1] - tl[0] : null
  let overall: Thickness['overall'] = 'average'
  if (o.reference && heavyShare >= T.areaShare && heavyShare > thinShare) overall = 'heavy'
  else if (o.reference && thinShare >= T.areaShare && thinShare > heavyShare) overall = 'thin'
  else if (spread != null && spread >= T.unevenSpread) overall = 'uneven'
  const latestAgeDays = latest ? daysBetween(latest.date, o.today) : null
  let green: Thickness['green'] = null
  if (latest && !o.swathed && latestAgeDays != null && latestAgeDays <= T.greenMaxAgeDays && latest.date > peak.date) {
    green = latest.mean >= T.greenNdvi ? 'green' : latest.mean >= T.someGreenNdvi ? 'some' : 'ripe'
  }
  return {
    peak,
    latest,
    against: o.reference ? 'farm' : 'field',
    reference: o.reference,
    heavyShare,
    thinShare,
    averageShare: Math.max(0, 1 - heavyShare - thinShare),
    spread,
    overall,
    green,
    latestAgeDays,
  }
}

// ---- weather ------------------------------------------------------------

/** One hour of weather at the field. Local (farm) time, "YYYY-MM-DDTHH:MM". */
export type WxHour = {
  time: string
  tempC: number | null
  rh: number | null
  dewC: number | null
  windKmh: number | null
  gustKmh: number | null
  windDir: number | null
}

/** Dew point from temperature and RH (Magnus, Alduchov–Eskridge constants), when the forecast has none. */
export function dewPointC(tempC: number, rh: number): number {
  const a = 17.625
  const b = 243.04
  const g = Math.log(Math.max(1, rh) / 100) + (a * tempC) / (b + tempC)
  return (b * g) / (a - g)
}

/** Degrees between the air and its dew point; null without both. */
export function dewSpread(h: WxHour): number | null {
  if (h.tempC == null) return null
  const d = h.dewC ?? (h.rh != null ? dewPointC(h.tempC, h.rh) : null)
  return d == null ? null : h.tempC - d
}

const isDamp = (h: WxHour) => (h.rh ?? 0) >= THRESHOLDS.rhDamp
const isDew = (h: WxHour) => {
  const s = dewSpread(h)
  return s != null && s <= THRESHOLDS.dewSpreadC
}

// ---- moisture -----------------------------------------------------------

export type MoistureNow = {
  /** The grain now: the latest test if it is fresh, else the dry-down model. */
  pct: number
  source: 'test' | 'model'
}

export type MoistureHour = { time: string; pct: number }

// ---- the rules ----------------------------------------------------------

export type Dir = 'up' | 'down' | 'check'
export type SourceKey = 'manual' | 'app' | 'ccc2017' | 'cccSurvey' | 'ndsuPeas' | 'iowaDry' | 'iowaCorn' | 'extShoe' | 'dew' | 'ours'

export const SOURCE_LABELS: Record<SourceKey, string> = {
  manual: 'NH CR operator’s manual, §6',
  app: 'This app’s settings guide (our estimate)',
  ccc2017: 'Canola Council, Canola Watch 13 Sep 2017 (naturally ripened canola)',
  cccSurvey: 'Canola Council on-farm combine-loss survey',
  ndsuPeas: 'NDSU Extension, field pea harvest',
  iowaDry: 'Iowa State Extension, low-moisture harvest 2023',
  iowaCorn: 'Iowa State Extension, combining fragile corn',
  extShoe: 'Farm and Dairy extension column, drought-stricken crops',
  dew: 'Dew-point rule of thumb (meteorology)',
  ours: 'Our threshold',
}

export type ConditionsInput = {
  crop: ConditionsCrop
  swathed: boolean
  thickness: Thickness | null
  moisture: { now: MoistureNow | null; next: MoistureHour[]; bands: MoistureBands | null }
  weather: { now: WxHour | null; next: WxHour[] }
}

type Ctx = ConditionsInput & {
  grade: Grade | null
  dryMax: number | null
  firstDamp: WxHour | null
  firstDew: WxHour | null
  firstDry: WxHour | null
  firstTough: MoistureHour | null
}

export type Reason = { rule: string; text: string; dir: Dir; sources: SourceKey[] }

type Fired = {
  text: string
  effects?: Partial<Record<AdviceSetting, Dir>>
  /** A note on what to expect later, not a change now. */
  later?: boolean
}

export type Rule = {
  id: string
  /** What it looks at, for the fold. */
  when: string
  /** What it suggests, for the fold. */
  then: string
  sources: SourceKey[]
  fire: (c: Ctx) => Fired | null
}

/** The settings the card suggests on, in the order they are usually touched. */
export const ADVICE_SETTINGS = ['rotor_rpm', 'concave_mm', 'fan_rpm', 'chaffer_mm', 'sieve_mm', 'ground_speed_mph'] as const satisfies readonly SettingKey[]
export type AdviceSetting = (typeof ADVICE_SETTINGS)[number]

const pctText = (v: number) => `${Math.round(v * 100)}%`
const fix1 = (v: number) => v.toFixed(1)
/** "8 pm" from "YYYY-MM-DDTHH:MM". */
export function hourLabel(time: string): string {
  const h = Number(time.slice(11, 13))
  if (!Number.isFinite(h)) return time
  if (h === 0) return 'midnight'
  if (h === 12) return 'noon'
  return h < 12 ? `${h} am` : `${h - 12} pm`
}

export const RULES: Rule[] = [
  {
    id: 'heavy',
    when: 'Most of the field above the crop’s farm median NDVI at its peak',
    then: 'Slower; open the concave a step; open the upper sieve a step',
    sources: ['app', 'manual', 'extShoe', 'ours'],
    fire: (c) => {
      const t = c.thickness
      if (t?.overall !== 'heavy') return null
      return {
        text: `Heavy crop (NDVI high in ${pctText(t.heavyShare)} of the field) → slower, open the concave a step, open the upper sieve a step`,
        effects: { ground_speed_mph: 'down', concave_mm: 'up', chaffer_mm: 'up' },
      }
    },
  },
  {
    id: 'thin',
    when: 'Most of the field below the crop’s farm median NDVI at its peak',
    then: 'Faster to keep the rotor full; close the concave a step only if heads come through',
    sources: ['app', 'manual', 'ours'],
    fire: (c) => {
      const t = c.thickness
      if (t?.overall !== 'thin') return null
      return {
        text: `Thin crop (NDVI low in ${pctText(t.thinShare)} of the field) → faster to keep the rotor loaded; close the concave a step only if heads come through`,
        effects: { ground_speed_mph: 'up', concave_mm: 'check' },
      }
    },
  },
  {
    id: 'uneven',
    when: 'NDVI spread (p90 − p10) across the field at its peak of 0.15 or more',
    then: 'Set the threshing for the heavy parts; let ground speed take up the difference',
    sources: ['app', 'ours'],
    fire: (c) => {
      const t = c.thickness
      if (!t || t.spread == null || t.spread < THRESHOLDS.unevenSpread || t.overall === 'thin') return null
      return {
        text: `Uneven field (NDVI ${fix2(t.spread)} from thin to heavy) → set for the heavy parts and slow down in them`,
        effects: { ground_speed_mph: 'check' },
      }
    },
  },
  {
    id: 'green',
    when: 'Standing crop whose latest look (10 days or less) is still green',
    then: 'Slower and cut higher; in canola, rotor up a step and concave closed a step for rubbery green pods',
    sources: ['ccc2017', 'ours'],
    fire: (c) => {
      const g = c.thickness?.green
      if (g !== 'green' && g !== 'some') return null
      const ndvi = fix2(c.thickness!.latest!.mean)
      if (c.crop === 'canola') {
        return {
          text: `Green stems and pods (latest NDVI ${ndvi}) → slower, cut higher; rotor +1 step and close the concave a step for rubbery pods`,
          effects: { ground_speed_mph: 'down', rotor_rpm: 'up', concave_mm: 'down' },
        }
      }
      return { text: `Green material left (latest NDVI ${ndvi}) → slower and cut higher; it is what plugs the rotor`, effects: { ground_speed_mph: 'down' } }
    },
  },
  {
    id: 'tough-grain',
    when: 'Grain above the crop’s dry limit now (cereals, oilseeds, corn)',
    then: 'Rotor up a step, concave closed a step — or wait: it may thresh clean on the same settings by afternoon',
    sources: ['manual', 'app'],
    fire: (c) => {
      if (PULSES.includes(c.crop) || !c.moisture.now || c.grade == null || c.grade === 'dry' || c.grade === 'too_dry') return null
      return {
        text: `${c.grade === 'tough' ? 'Tough' : 'Damp'} grain (${fix1(c.moisture.now.pct)}%) → rotor +1 step, close the concave a step; or wait, it may thresh clean on the same settings later`,
        effects: { rotor_rpm: 'up', concave_mm: 'down' },
      }
    },
  },
  {
    id: 'brittle-straw',
    when: `Air under ${THRESHOLDS.rhDry}% RH now (not corn)`,
    then: 'Rotor down a step, concave open a step: brittle straw breaks into chaff that loads the sieves',
    sources: ['manual', 'extShoe', 'ours'],
    fire: (c) => {
      const rh = c.weather.now?.rh
      if (rh == null || rh >= THRESHOLDS.rhDry || c.crop === 'corn') return null
      return {
        text: `Dry, brittle straw (RH ${Math.round(rh)}%) → rotor −1 step, open the concave a step; broken straw loads the sieves`,
        effects: { rotor_rpm: 'down', concave_mm: 'up' },
      }
    },
  },
  {
    id: 'over-dry',
    when: `Grain below the crop’s floor, or ${THRESHOLDS.overDryPts} points or more under its dry limit`,
    then: 'Open the concave a step, then the rotor down a step (durum: rotor first); watch the sample for damage',
    sources: ['manual', 'iowaDry', 'ndsuPeas', 'iowaCorn', 'ours'],
    fire: (c) => {
      const m = c.moisture.now
      if (!m || c.dryMax == null) return null
      const under = c.dryMax - m.pct
      if (c.grade !== 'too_dry' && under < THRESHOLDS.overDryPts) return null
      const order = c.crop === 'durum' ? 'rotor −1 step first, then open the concave a step' : 'open the concave a step, then rotor −1 step'
      return {
        text: `Very dry grain (${fix1(m.pct)}% against dry at ${fix1(c.dryMax)}%) → ${order}; watch for ${DAMAGE[c.crop]}`,
        effects: { concave_mm: 'up', rotor_rpm: 'down' },
      }
    },
  },
  {
    id: 'damp-air',
    when: `Air at ${THRESHOLDS.rhDamp}% RH or more, or within ${THRESHOLDS.dewSpreadC} °C of its dew point, now`,
    then: 'Slower; rotor up a step only if heads or pods come through',
    sources: ['ccc2017', 'dew', 'ours'],
    fire: (c) => {
      const h = c.weather.now
      if (!h || !(isDamp(h) || isDew(h))) return null
      const why = isDew(h) ? `dew forming (air ${fix1(dewSpread(h)!)} °C off its dew point)` : `damp air (RH ${Math.round(h.rh!)}%)`
      return { text: `Straw toughening, ${why} → slower; rotor +1 step only if heads or pods come through`, effects: { ground_speed_mph: 'down', rotor_rpm: 'check' } }
    },
  },
  {
    id: 'wind',
    when: `Wind ${THRESHOLDS.windKmh} km/h or gusts ${THRESHOLDS.gustKmh} km/h (not corn or pulses)`,
    then: 'Check the chaff for seed; lower the fan a step if it is there',
    sources: ['manual', 'ours'],
    fire: (c) => {
      const h = c.weather.now
      if (!h || c.crop === 'corn' || PULSES.includes(c.crop)) return null
      const strong = (h.windKmh ?? 0) >= THRESHOLDS.windKmh || (h.gustKmh ?? 0) >= THRESHOLDS.gustKmh
      if (!strong) return null
      const light = LIGHT_SEED.includes(c.crop) ? ' Light seed goes first.' : ''
      const head = c.crop === 'canola' && !c.swathed ? ' Watch shatter at the reel.' : ''
      return {
        text: `Strong wind (${Math.round(h.windKmh ?? 0)} km/h, gusts ${Math.round(h.gustKmh ?? 0)}) → check the chaff for seed and lower the fan a step if it is there.${light}${head}`,
        effects: { fan_rpm: LIGHT_SEED.includes(c.crop) ? 'down' : 'check' },
      }
    },
  },
  {
    id: 'canola-cool-humid',
    when: `Canola, under ${THRESHOLDS.canolaCoolC} °C and over ${THRESHOLDS.canolaHumidRh}% RH`,
    then: 'No change: losses run higher in these conditions, so check the pan more often',
    sources: ['cccSurvey'],
    fire: (c) => {
      const h = c.weather.now
      if (c.crop !== 'canola' || !h || h.tempC == null || h.rh == null) return null
      if (h.tempC >= THRESHOLDS.canolaCoolC || h.rh <= THRESHOLDS.canolaHumidRh) return null
      return { text: `Cool, humid canola weather (${Math.round(h.tempC)} °C, RH ${Math.round(h.rh)}%) → losses run higher in it; drop the pan more often`, effects: {} }
    },
  },
  {
    id: 'pulse-rotor',
    when: 'Peas or beans',
    then: 'Rotor as slow as threshes clean, and slower as the crop dries',
    sources: ['ndsuPeas', 'iowaDry'],
    fire: (c) => {
      if (!PULSES.includes(c.crop)) return null
      const peasDry = c.crop === 'peas' && c.moisture.now && c.moisture.now.pct < THRESHOLDS.peasSplitBelow
      return {
        text: peasDry
          ? `Peas at ${fix1(c.moisture.now!.pct)}% split more as they dry → rotor as slow as threshes clean; the humid hours suit them`
          : `${c.crop === 'peas' ? 'Peas' : 'Beans'} → rotor as slow as threshes clean, slower as they dry`,
        effects: peasDry ? { rotor_rpm: 'down' } : { rotor_rpm: 'check' },
      }
    },
  },
  {
    id: 'later-damp',
    when: `RH climbing to ${THRESHOLDS.rhDamp}% in the next 12 hours`,
    then: 'Expect to slow down and bring the rotor back up; test a sample then',
    sources: ['ccc2017', 'ours'],
    fire: (c) => (c.firstDamp ? { later: true, text: `RH reaches ${Math.round(c.firstDamp.rh!)}% about ${hourLabel(c.firstDamp.time)} → straw toughens: expect to slow down and bring the rotor back up; test a sample then` } : null),
  },
  {
    id: 'later-dew',
    when: `Air within ${THRESHOLDS.dewSpreadC} °C of its dew point in the next 12 hours`,
    then: 'Dew expected: plan the stop',
    sources: ['dew'],
    fire: (c) =>
      c.firstDew
        ? { later: true, text: `Dew likely from about ${hourLabel(c.firstDew.time)}${c.swathed ? ' — a swath takes it up fast' : ''}` }
        : null,
  },
  {
    id: 'later-tough',
    when: 'Grain predicted to pass its dry limit in the next 12 hours',
    then: 'When it does, the tough-grain rule applies — or stop',
    sources: ['ours'],
    fire: (c) =>
      c.firstTough && c.dryMax != null
        ? { later: true, text: `Grain predicted over dry (${fix1(c.dryMax)}%) from about ${hourLabel(c.firstTough.time)}` }
        : null,
  },
  {
    id: 'later-dry',
    when: `RH falling under ${THRESHOLDS.rhDry}% in the next 12 hours`,
    then: 'Expect to back the rotor off and open the concave as the straw turns brittle',
    sources: ['ccc2017', 'manual', 'ours'],
    fire: (c) =>
      c.firstDry && c.crop !== 'corn'
        ? { later: true, text: `RH under ${THRESHOLDS.rhDry}% from about ${hourLabel(c.firstDry.time)} → expect to back the rotor off a step and open the concave; check for ${DAMAGE[c.crop]}` }
        : null,
  },
]

function fix2(v: number) {
  return v.toFixed(2)
}

export type Suggestion = {
  setting: AdviceSetting
  /** none: no rule touched it; hold: rules pull both ways. */
  direction: 'up' | 'down' | 'hold' | 'check' | 'none'
  reasons: Reason[]
}

export type Advice = {
  suggestions: Suggestion[]
  /** Changes nothing now: notes on what the next hours will do. */
  later: Reason[]
  /** Rules that fired with no setting to change. */
  notes: Reason[]
  fired: string[]
}

/** The rules' context: the grade now and the first hour each later condition arrives. */
function contextOf(i: ConditionsInput): Ctx {
  const bands = i.moisture.bands && hasBands(i.moisture.bands) ? i.moisture.bands : null
  const grade = bands && i.moisture.now ? gradeFor(bands, i.moisture.now.pct) : null
  const dryMax = bands?.dry_max ?? null
  const now = i.weather.now
  const firstDamp = now && !isDamp(now) ? (i.weather.next.find(isDamp) ?? null) : null
  const firstDew = now && !isDew(now) ? (i.weather.next.find(isDew) ?? null) : null
  const firstDry = now && (now.rh ?? 0) >= THRESHOLDS.rhDry ? (i.weather.next.find((h) => h.rh != null && h.rh < THRESHOLDS.rhDry) ?? null) : null
  const firstTough =
    dryMax != null && i.moisture.now && i.moisture.now.pct <= dryMax ? (i.moisture.next.find((h) => h.pct > dryMax) ?? null) : null
  return { ...i, grade, dryMax, firstDamp, firstDew, firstDry, firstTough }
}

/**
 * Run every rule and put what they say together, setting by setting. A
 * setting two rules push opposite ways is "hold": start where it is and let
 * the loss check decide, rather than splitting the difference.
 */
export function suggest(input: ConditionsInput): Advice {
  const c = contextOf(input)
  const per = new Map<AdviceSetting, Reason[]>(ADVICE_SETTINGS.map((s) => [s, []]))
  const later: Reason[] = []
  const notes: Reason[] = []
  const fired: string[] = []
  for (const r of RULES) {
    const f = r.fire(c)
    if (!f) continue
    fired.push(r.id)
    if (f.later) {
      later.push({ rule: r.id, text: f.text, dir: 'check', sources: r.sources })
      continue
    }
    const effects = Object.entries(f.effects ?? {}) as [AdviceSetting, Dir][]
    if (!effects.length) notes.push({ rule: r.id, text: f.text, dir: 'check', sources: r.sources })
    for (const [s, dir] of effects) per.get(s)!.push({ rule: r.id, text: f.text, dir, sources: r.sources })
  }
  const suggestions = ADVICE_SETTINGS.map((setting): Suggestion => {
    const reasons = per.get(setting)!
    const up = reasons.some((r) => r.dir === 'up')
    const down = reasons.some((r) => r.dir === 'down')
    const direction: Suggestion['direction'] = up && down ? 'hold' : up ? 'up' : down ? 'down' : reasons.length ? 'check' : 'none'
    return { setting, direction, reasons }
  })
  return { suggestions, later, notes, fired }
}

/** A suggestion's direction in the words the monitor's knob would use. */
export function directionWords(s: AdviceSetting, d: Suggestion['direction']): string {
  if (d === 'none') return 'as is'
  if (d === 'hold') return 'hold — rules pull both ways'
  if (d === 'check') return 'check'
  const opening = s === 'concave_mm' || s === 'chaffer_mm' || s === 'sieve_mm'
  if (s === 'ground_speed_mph') return d === 'up' ? 'faster' : 'slower'
  if (opening) return d === 'up' ? 'open a step' : 'close a step'
  return d === 'up' ? '+1 step' : '−1 step'
}

/** The moisture hours from the dry-down forecast that fall in the next `n` hours from `nowKey` ("YYYY-MM-DD|H"). */
export function nextMoistureHours(hourly: { date: string; hour: number; pct: number }[], now: { date: string; hour: number }, n = 12): MoistureHour[] {
  const at = (d: string, h: number) => Date.parse(`${d}T00:00:00Z`) + h * 3_600_000
  const from = at(now.date, now.hour)
  return hourly
    .filter((h) => at(h.date, h.hour) > from && at(h.date, h.hour) <= from + n * 3_600_000)
    .map((h) => ({ time: `${h.date}T${String(h.hour).padStart(2, '0')}:00`, pct: h.pct }))
}

/** The dry-down model's figure for this hour, if it has one. */
export function moistureAtHour(hourly: { date: string; hour: number; pct: number }[], now: { date: string; hour: number }): number | null {
  return hourly.find((h) => h.date === now.date && h.hour === now.hour)?.pct ?? null
}
