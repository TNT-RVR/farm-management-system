/**
 * Canola bloom from the satellite: when a canola field starts to flower, how
 * far along it is, and when it is done.
 *
 * Worked out on nine canola field-seasons, 2024-26, against each field's first
 * fungicide (sprayed at roughly 20-50 % bloom):
 *
 * - Each satellite look gives the share of the field's clear pixels that are
 *   YELLOW — a plant, red high next to green, blue low next to green. The test
 *   itself runs in the satellite request (netlify/shared/sat-ingest.ts, and
 *   sat-landsat.ts for Landsat); this file decides what the shares mean.
 * - The share is taken over the CROP alone where the look says how much of the
 *   field is crop: sloughs, yards and pivot corners no longer dilute it.
 * - Stages, from the share (the farm's settings, canola_bloom_settings):
 *   starting at 10 % (Sam, 2 Nov 2026 — the first heads-up, before the
 *   fungicide window), the fungicide window at 25 %, full bloom at 50 %,
 *   petals falling once the share drops well off its peak, and over below
 *   10 % after the bloom reached the window.
 * - A start that collapses inside ten days without reaching full bloom was a
 *   canopy closing, not flowers (Whitfield 2024 read 32 % on 21 June, 9 % two
 *   days later, and flowered on 6 July). It is taken back.
 * - Guards. Ripening pods go yellow in late August, so no new start is called
 *   past 1,150 degree days (15 August without a seeding date), and the
 *   cut-off ends a bloom that never went green again. Smoke the cloud mask
 *   lets through washes blue up and every pixel fails the test, so a look with
 *   blue over 0.08 or a high aerosol reading is skipped rather than read as
 *   "not flowering". And a canopy just closing can pass the test, so nothing
 *   is called before 450 degree days (base 5 C) from seeding — 6-Kellers 2025
 *   read 69 % yellow at 404, two weeks before its spray.
 * - A second opinion: a small model (BLOOM_MODEL) trained on the same seasons
 *   from the field's colours, used only to grade how sure a call is.
 */

export type BloomSettings = {
  startFraction: number
  windowFraction: number
  fullFraction: number
  endFraction: number
  /** Degree days (base 5 C) from seeding before a yellow look counts. */
  gateGdd: number
  /**
   * And after which a NEW start is not called. Ripening pods turn the field
   * yellow again in late August (90 %+ on 2026's fields at ~1,700 degree days).
   */
  latestGdd: number
  /** Degree days from seeding to the first flowers on a typical field: the forecast. */
  typicalStartGdd: number
  /** Field mean blue reflectance above which a look is treated as hazy. */
  hazeBlueMax: number
  /** Aerosol optical thickness above which a look is treated as smoky. */
  hazeAotMax: number
  /** The least of the field that must be seen for a look to count. */
  minValid: number
  /** Days with no clear look before the "gone blind" warning. */
  blindDays: number
  /** Gate degree days for a variety that flowers earlier or later. */
  varietyGate: Record<string, number>
}

export const DEFAULT_BLOOM_SETTINGS: BloomSettings = {
  startFraction: 0.1,
  windowFraction: 0.25,
  fullFraction: 0.5,
  endFraction: 0.1,
  gateGdd: 450,
  latestGdd: 1150,
  typicalStartGdd: 560,
  hazeBlueMax: 0.08,
  hazeAotMax: 0.4,
  minValid: 0.3,
  blindDays: 6,
  varietyGate: {},
}

type SettingsRow = {
  start_fraction: number | string
  window_fraction: number | string
  full_fraction: number | string
  end_fraction: number | string
  gate_gdd: number | string
  latest_gdd: number | string
  typical_start_gdd: number | string
  haze_blue_max: number | string
  haze_aot_max: number | string
  min_valid: number | string
  blind_days: number
  variety_gate: unknown
}

/** The settings row as numbers; the defaults where there is no row. */
export function settingsFromRow(r: SettingsRow | null | undefined): BloomSettings {
  if (!r) return DEFAULT_BLOOM_SETTINGS
  const vg = r.variety_gate && typeof r.variety_gate === 'object' ? (r.variety_gate as Record<string, unknown>) : {}
  return {
    startFraction: Number(r.start_fraction),
    windowFraction: Number(r.window_fraction),
    fullFraction: Number(r.full_fraction),
    endFraction: Number(r.end_fraction),
    gateGdd: Number(r.gate_gdd),
    latestGdd: Number(r.latest_gdd),
    typicalStartGdd: Number(r.typical_start_gdd),
    hazeBlueMax: Number(r.haze_blue_max),
    hazeAotMax: Number(r.haze_aot_max),
    minValid: Number(r.min_valid),
    blindDays: r.blind_days,
    varietyGate: Object.fromEntries(Object.entries(vg).filter(([, v]) => Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)])),
  }
}

/** A field's gate, its variety's where the farm has set one (matched ignoring case). */
export function gateFor(set: BloomSettings, variety: string | null | undefined): number {
  if (variety) {
    const v = variety.trim().toLowerCase()
    for (const [k, g] of Object.entries(set.varietyGate)) if (k.trim().toLowerCase() === v) return g
  }
  return set.gateGdd
}

/** With no seeding date, 15 August stands in for the ripening cut-off. */
export const BLOOM_LATEST_DAY = '08-15'
export const GDD_BASE_C = 5
/** The months worth watching: June to August. Outside them nothing is called. */
export const WATCH_FROM_MONTH = 6
export const WATCH_TO_MONTH = 8
/** A start that falls back inside this many days without reaching full bloom is taken back. */
export const FALSE_START_DAYS = 10

export type BloomStatus = 'waiting' | 'watching' | 'flowering' | 'over'
export type BloomStage = 'none' | 'starting' | 'window' | 'full' | 'falling' | 'over'
export type BloomConfidence = 'high' | 'medium' | 'low'

export type BloomLook = {
  sensedOn: string
  /** Share of the clear pixels that pass the flower test. */
  yellow: number | null
  blue: number | null
  /** Share of the clear pixels that are crop: the yellow share is taken over these. */
  plant?: number | null
  aot?: number | null
  /** Share of the field seen. */
  validFraction?: number | null
  /** Sentinel-2 by default. A scouting report is a person's own bloom %. */
  source?: 'sentinel' | 'landsat' | 'scout'
  quality?: 'full' | 'partial' | 'thin'
  ndvi?: number | null
  bands?: Record<string, number | null> | null
}

export type BloomState = {
  status: BloomStatus
  stage: BloomStage
  lastClearOn: string | null
  /** The crop's yellow share on the newest usable look. */
  yellowNow: number | null
  startedOn: string | null
  windowOn: string | null
  fullOn: string | null
  fallingOn: string | null
  peakFraction: number | null
  peakOn: string | null
  endedOn: string | null
  /** The field's own yellow before it could flower, taken off every later look. */
  baseline: number | null
  /** Starts that were taken back. */
  falseStarts: string[]
  confidence: BloomConfidence | null
  /** The second opinion on the newest look, 0-1, where its colours are on file. */
  modelScore: number | null
}

/** The yellow share over the crop alone, when the look says how much is crop. */
export function cropShare(l: BloomLook): number | null {
  if (l.yellow == null) return null
  if (l.source === 'scout' || l.plant == null || l.plant < 0.5) return l.yellow
  return Math.min(1, l.yellow / l.plant)
}

/** A look that can be read: has a yellow share, is not hazy, is seen well enough and is in the watch months. */
export function usableLook(l: BloomLook, set: BloomSettings = DEFAULT_BLOOM_SETTINGS): boolean {
  if (l.yellow == null) return false
  const m = Number(l.sensedOn.slice(5, 7))
  if (m < WATCH_FROM_MONTH || m > WATCH_TO_MONTH) return false
  if (l.source === 'scout') return true
  // Landsat's yellow is stored but not read yet. Its broader bands put a green
  // canopy over the flower thresholds: Dale G Home 2026 read 70 % on Landsat
  // on 4 July between Sentinel's 8 % and 7 %. It needs calibrating against
  // same-day Sentinel looks before it can call anything.
  if (l.source === 'landsat') return false
  if (l.blue != null && l.blue > set.hazeBlueMax) return false
  if (l.aot != null && l.aot > set.hazeAotMax) return false
  if (l.validFraction != null && l.validFraction < set.minValid) return false
  return true
}

/** The stage a share stands for, before the season's shape is known. */
export function stageOfShare(y: number, set: BloomSettings = DEFAULT_BLOOM_SETTINGS): BloomStage {
  if (y >= set.fullFraction) return 'full'
  if (y >= set.windowFraction) return 'window'
  if (y >= set.startFraction) return 'starting'
  return 'none'
}

/** Degree days (base 5 C) one day adds. */
export const dayGdd = (tmax: number, tmin: number) => Math.max(0, (tmax + tmin) / 2 - GDD_BASE_C)

/** Degree days (base 5 C) accumulated on each date, from daily max/min. */
export function gddByDate(days: { date: string; tmax: number | null; tmin: number | null }[], from: string): Map<string, number> {
  const out = new Map<string, number>()
  let total = 0
  for (const d of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    if (d.date < from) continue
    if (d.tmax != null && d.tmin != null) total += dayGdd(d.tmax, d.tmin)
    out.set(d.date, total)
  }
  return out
}

/** Degree days reached by `date`: the newest weather day on or before it. */
export function gddOn(gdd: Map<string, number>, date: string): number | null {
  let best: string | null = null
  for (const d of gdd.keys()) if (d <= date && (best == null || d > best)) best = d
  return best == null ? null : gdd.get(best)!
}

/**
 * The second opinion: a logistic model on the field's mean colours, trained on
 * the 2024-26 seasons against the first fungicide (looks from a week before to
 * ten days after it are "flowering"; more than two weeks before, or 25 days
 * after but before ripening, are not). 84 % right on those 38 looks. It cannot
 * tell flowers from ripening pods — the date guard does that — so it only
 * grades confidence, and never makes a call on its own.
 *
 * Features: crop yellow share, NDVI, red/green, blue/green, near-infrared.
 */
export const BLOOM_MODEL = {
  mean: [0.3665, 0.6813, 0.7318, 0.5379, 0.4384],
  sd: [0.3637, 0.1566, 0.2208, 0.0967, 0.1194],
  w: [1.729, 0.8678, 0.5905, 0.0286, -0.3482],
  b: 0.4068,
}

export function modelScore(l: BloomLook): number | null {
  const share = cropShare(l)
  const b = l.bands
  if (share == null || l.ndvi == null || !b || !b.B02 || !b.B03 || !b.B04 || b.B08 == null) return null
  const x = [share, l.ndvi, b.B04 / b.B03, b.B02 / b.B03, b.B08]
  const { mean, sd, w, b: bias } = BLOOM_MODEL
  const t = x.reduce((s, v, i) => s + ((v - mean[i]) / sd[i]) * w[i], bias)
  return 1 / (1 + Math.exp(-t))
}

const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)

/**
 * The season so far, from every look in date order.
 *
 * `gddAt` gives the degree days on a date, or null when there is no seeding
 * date — then the gate is skipped rather than holding the field forever, and
 * the June-August window is the only guard. `gate` is the field's own (its
 * variety's), defaulting to the farm's.
 */
export function bloomState(
  looks: BloomLook[],
  gddAt: (date: string) => number | null,
  gddNow: number | null,
  set: BloomSettings = DEFAULT_BLOOM_SETTINGS,
  gate: number = set.gateGdd,
): BloomState {
  const usable = looks.filter((l) => usableLook(l, set)).sort((a, b) => a.sensedOn.localeCompare(b.sensedOn))
  const s: BloomState = {
    status: gddNow != null && gddNow < gate ? 'waiting' : 'watching',
    stage: 'none',
    lastClearOn: null,
    yellowNow: null,
    startedOn: null,
    windowOn: null,
    fullOn: null,
    fallingOn: null,
    peakFraction: null,
    peakOn: null,
    endedOn: null,
    baseline: null,
    falseStarts: [],
    confidence: null,
    modelScore: null,
  }

  // The field's own yellow well before it could flower (a weedy field, a
  // yellow-green variety): the median of those looks, at most 10 %.
  const early = usable.filter((l) => {
    if (l.source === 'scout') return false
    const g = gddAt(l.sensedOn)
    return g != null ? g < gate * 0.75 : l.sensedOn.slice(5) < '06-10'
  })
  const base = early.length >= 2 ? median(early.map((l) => cropShare(l)!)) : null
  s.baseline = base == null ? null : Math.min(0.1, base)

  let prevLow = false
  let call: { look: BloomLook; y: number; threshold: number; prev: number | null } | null = null
  let prevY: number | null = null
  for (const l of usable) {
    const share = cropShare(l)!
    const y = l.source === 'scout' ? share : Math.max(0, share - (s.baseline ?? 0))
    s.lastClearOn = l.sensedOn
    s.yellowNow = share
    const g = gddAt(l.sensedOn)
    const pastGate = g == null || g >= gate
    const tooLate = g != null ? g > set.latestGdd : l.sensedOn.slice(5) > BLOOM_LATEST_DAY
    const solid = l.source === 'scout' || ((l.source ?? 'sentinel') === 'sentinel' && (l.quality ?? 'full') === 'full')
    let threshold = set.startFraction

    if (!s.startedOn) {
      // A person who saw flowers is believed past the gate too.
      if ((pastGate || l.source === 'scout') && !tooLate && y >= set.startFraction) {
        s.startedOn = l.sensedOn
        s.status = 'flowering'
      }
    } else if (!s.endedOn) {
      const low = y < set.endFraction
      if (tooLate) {
        // A seed field whose rows flower in turn can stay yellow until the
        // pods take over, so the ripening cut-off ends it too.
        s.endedOn = l.sensedOn
      } else if (low && (s.peakFraction ?? 0) < set.fullFraction && daysBetween(s.startedOn, l.sensedOn) <= FALSE_START_DAYS) {
        // A canopy closing, not flowers: take the start back.
        s.falseStarts.push(s.startedOn)
        Object.assign(s, { startedOn: null, windowOn: null, fullOn: null, fallingOn: null, peakFraction: null, peakOn: null, status: 'watching' })
      } else if (low && (s.peakFraction ?? 0) >= set.windowFraction && (solid || prevLow)) {
        s.endedOn = l.sensedOn
      }
      threshold = set.endFraction
      prevLow = low
    }
    if (s.endedOn && s.status !== 'over') {
      s.status = 'over'
      s.stage = 'over'
    }
    if (s.startedOn && !s.endedOn) {
      if (s.peakFraction == null || y > s.peakFraction) {
        s.peakFraction = y
        s.peakOn = l.sensedOn
      }
      if (y >= set.windowFraction && !s.windowOn) s.windowOn = l.sensedOn
      if (y >= set.fullFraction && !s.fullOn) s.fullOn = l.sensedOn
      const falling = s.peakFraction >= set.windowFraction && y < s.peakFraction * 0.6
      if (falling && !s.fallingOn) s.fallingOn = l.sensedOn
      s.stage = falling ? 'falling' : stageOfShare(y, set) === 'none' ? 'starting' : stageOfShare(y, set)
      threshold = s.stage === 'starting' ? set.startFraction : s.stage === 'window' ? set.windowFraction : set.fullFraction
    }
    if (!s.startedOn && !s.endedOn) s.stage = 'none'
    call = { look: l, y, threshold, prev: prevY }
    prevY = y
  }

  if (call) {
    const { look, y, threshold, prev } = call
    s.modelScore = modelScore(look)
    const flowering = s.stage !== 'none' && s.stage !== 'over'
    let pts = look.source === 'scout' ? 3 : look.source === 'landsat' || look.quality === 'thin' ? 0 : look.quality === 'partial' ? 1 : 2
    if (Math.abs(y - threshold) >= 0.1) pts++
    if (s.modelScore != null) pts += (s.modelScore >= 0.5) === flowering ? 1 : -1
    if (prev != null && (prev >= set.startFraction) === (y >= set.startFraction)) pts++
    if (gddAt(look.sensedOn) == null && flowering) pts--
    s.confidence = pts >= 4 ? 'high' : pts >= 2 ? 'medium' : 'low'
  }
  return s
}

/**
 * When the field should start to flower: today's degree days, then the
 * forecast's day by day, then the forecast's average pace past its end. Null
 * once the target is passed, or with nothing to go on.
 */
export function forecastStartOn(gddNow: number | null, target: number, upcoming: { date: string; gdd: number }[]): string | null {
  if (gddNow == null || gddNow >= target || !upcoming.length) return null
  let total = gddNow
  for (const d of upcoming) {
    total += d.gdd
    if (total >= target) return d.date
  }
  const pace = upcoming.reduce((s, d) => s + d.gdd, 0) / upcoming.length
  if (pace <= 0) return null
  const last = upcoming[upcoming.length - 1].date
  const more = Math.ceil((target - total) / pace)
  return new Date(Date.parse(`${last}T12:00:00Z`) + more * 86_400_000).toISOString().slice(0, 10)
}

export type SeasonTruth = {
  /** When flowering really began: a scouting report, else five days before the first fungicide. */
  truthOn: string
  gddAtTruth: number | null
  /** Only a scouting report says the share at the start; a spray date says roughly when. */
  source: 'scouting' | 'fungicide'
  looks: { sensedOn: string; share: number }[]
}

/**
 * Settings the farm's own seasons support: degree days to the first flowers
 * (the forecast, and the gate 110 below it) from every season with a mark,
 * and the crop yellow share on the look nearest a scouted start — from
 * scouting reports alone, since "five days before the spray" can be anywhere
 * from 10 to 50 % bloom and would talk the 10 % start back up to 40.
 * Null until three seasons have a mark.
 */
export function suggestSettings(seasons: SeasonTruth[]): { typicalStartGdd: number | null; gateGdd: number | null; startFraction: number | null; seasons: number } | null {
  if (seasons.length < 3) return null
  const gdds = seasons.map((s) => s.gddAtTruth).filter((g): g is number => g != null)
  const shares: number[] = []
  for (const s of seasons) {
    if (s.source !== 'scouting') continue
    let best: { d: number; share: number } | null = null
    for (const l of s.looks) {
      const d = Math.abs(daysBetween(s.truthOn, l.sensedOn))
      if (d <= 3 && (!best || d < best.d)) best = { d, share: l.share }
    }
    if (best) shares.push(best.share)
  }
  const typical = gdds.length >= 3 ? Math.round(median(gdds)! / 10) * 10 : null
  const start = shares.length >= 3 ? Math.min(0.4, Math.max(0.05, Math.round(median(shares)! * 20) / 20)) : null
  return { typicalStartGdd: typical, gateGdd: typical == null ? null : typical - 110, startFraction: start, seasons: seasons.length }
}

/** The stage a field was at on a date, from its stored looks: the nearest within three days. */
export function stageOnDay(looks: { d: string; s: number }[], day: string, set: BloomSettings = DEFAULT_BLOOM_SETTINGS): BloomStage | null {
  let best: { d: number; s: number } | null = null
  for (const l of looks) {
    const d = Math.abs(daysBetween(day, l.d))
    if (d <= 3 && (!best || d < best.d)) best = { d, s: l.s }
  }
  return best ? stageOfShare(best.s, set) : null
}

export const BLOOM_LABEL: Record<BloomStatus, string> = {
  waiting: 'Too early to flower',
  watching: 'Watching for flowers',
  flowering: 'Flowering',
  over: 'Flowering over',
}

export const STAGE_LABEL: Record<BloomStage, string> = {
  none: 'Not flowering',
  starting: 'Starting to flower',
  window: 'Fungicide window',
  full: 'Full bloom',
  falling: 'Petals falling',
  over: 'Flowering over',
}

export const STAGE_STYLE: Record<BloomStage | 'waiting', string> = {
  waiting: 'bg-gray-100 text-gray-700',
  none: 'bg-sky-100 text-sky-800',
  starting: 'bg-yellow-100 text-yellow-900',
  window: 'bg-yellow-200 text-yellow-900',
  full: 'bg-yellow-300 text-yellow-950',
  falling: 'bg-amber-100 text-amber-900',
  over: 'bg-green-100 text-green-800',
}

/** The chip a field's bloom shows: its stage, or "too early" before the degree days are in. */
export function bloomChip(b: { status: string; stage: BloomStage | null }): { label: string; style: string } {
  if (b.status === 'waiting') return { label: 'Too early to flower', style: STAGE_STYLE.waiting }
  const stage = b.stage ?? (b.status === 'over' ? 'over' : b.status === 'flowering' ? 'starting' : 'none')
  return { label: stage === 'none' ? 'Watching for flowers' : STAGE_LABEL[stage], style: STAGE_STYLE[stage] }
}
