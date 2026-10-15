/**
 * Grain moisture: what the meter says, and what it means for the bin.
 *
 * Two separate jobs that get confused for one another.
 *
 * THE CONVERSION is arithmetic on a published table. A Model 919 does not read
 * out a percentage — it reads out a dial number, and that number means a
 * different moisture at 12 °C than it does at 28 °C. The Canadian Grain
 * Commission publishes one conversion table per crop, and those tables are in
 * src/data/919-charts, read out of the real PDFs (see
 * scripts/extract_919_charts.py). There is no formula to fall back on: off the
 * end of a table this refuses to answer rather than extrapolating, because the
 * one thing worse than no moisture reading is a confident wrong one.
 *
 * THE GRADE is a judgement about storage, and it belongs to the farm. The
 * defaults are the CGC's straight-grade limits, which is what a buyer will
 * grade against; they are stored on the crop and editable, because what is safe
 * to bin here is a decision about this farm's aeration and how long the grain is
 * going to sit, not a fact about the grain.
 */

import CHART_INDEX from '../data/919-charts/index.json'

// ---- the charts -----------------------------------------------------------

/** A chart as the extractor writes it. Readings are implied by row position. */
export type MoistureChart = {
  key: string
  crop: string
  table_no: string
  revised: string
  /**
   * Grams of grain the table is calibrated for. Not a detail: the meter reads
   * the resistance of a FIXED MASS, so a 250 g table read on a 225 g sample is
   * not slightly out, it is a reading of nothing.
   */
  sample_weight_g: number
  /** What the meter is zeroed at before the sample goes in. 53 for everything
   *  here; sunflower, safflower and hemp use 73. */
  calibrate_at: number
  temperatures_c: number[]
  first_reading: number
  reading_step: number
  /** One row per dial reading, values comma-joined from the coldest column. */
  rows: string[]
}

/** The picker's view: names and weights, without 200 KB of numbers behind it. */
export type ChartSummary = {
  key: string
  crop: string
  table_no: string
  revised: string
  sample_weight_g: number
  calibrate_at: number
  first_reading: number
  last_reading: number
}

export const CHARTS: ChartSummary[] = CHART_INDEX

export function chartSummary(key: string | null | undefined): ChartSummary | undefined {
  return key ? CHARTS.find((c) => c.key === key) : undefined
}

/** Where the real PDF is served from, for the chart icon. */
export function chartPdfUrl(key: string): string {
  return `/919-charts/${key}.pdf`
}

/**
 * Load one chart's numbers.
 *
 * A dynamic import so each table is its own chunk: fourteen of them is 196 KB,
 * and a phone opening the calculator for canola has no reason to carry the
 * bean tables. The service worker precaches the chunks, so this still answers
 * with no signal — which is the point, since the shop is where the testing
 * happens and the shop is not where the bars are.
 */
const TABLES = import.meta.glob<MoistureChart>('../data/919-charts/*.json', {
  import: 'default',
})

export async function loadChart(key: string): Promise<MoistureChart> {
  const load = TABLES[`../data/919-charts/${key}.json`]
  if (!load) throw new Error(`No Model 919 chart called "${key}".`)
  return load()
}

// ---- the conversion -------------------------------------------------------

export type MoistureLookup =
  | {
      ok: true
      moisture: number
      /** The whole degree the table was read at. */
      temperature: number
      /** The dial reading asked for. */
      reading: number
      /** True when the reading fell between two rows and was interpolated. */
      interpolated: boolean
    }
  | { ok: false; problem: string }

function rowValues(chart: MoistureChart, index: number): number[] {
  return chart.rows[index].split(',').map(Number)
}

const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * Dial reading + grain temperature → moisture per cent.
 *
 * Refuses rather than guesses in four cases, each of which is a real thing that
 * happens at the bench:
 *
 *  - the grain is outside 11–30 °C, where the meter itself is not valid;
 *  - the dial reading is off either end of this crop's table;
 *  - the table is ragged (high-moisture corn) and has no cell at that
 *    temperature for that reading, meaning the sample is outside the range the
 *    table covers at all;
 *  - the crop has no chart.
 *
 * Between two dial rows it interpolates, and says so. The rows are half a
 * division apart and moisture moves about a tenth of a point across that gap,
 * so a straight line between them is honest; rounding to the nearer row would
 * throw away real resolution on a digital-converted meter.
 */
export function lookupMoisture(
  chart: MoistureChart,
  temperatureC: number,
  reading: number,
): MoistureLookup {
  const temps = chart.temperatures_c
  const loT = temps[0]
  const hiT = temps[temps.length - 1]
  if (!Number.isFinite(temperatureC) || !Number.isFinite(reading)) {
    return { ok: false, problem: 'Enter the grain temperature and the dial reading.' }
  }
  // Checked BEFORE rounding: 10.6 °C rounds to 11 but the grain is still colder
  // than the meter is good for.
  if (temperatureC < loT || temperatureC > hiT) {
    return {
      ok: false,
      problem: `The meter is only valid between ${loT} °C and ${hiT} °C. Leave the sample in a sealed container until it comes into range — do not warm it in the open, it will pick up moisture.`,
    }
  }
  const temperature = Math.round(temperatureC)
  const column = temps.indexOf(temperature)

  const last = chart.first_reading + (chart.rows.length - 1) * chart.reading_step
  if (reading < chart.first_reading || reading > last) {
    return {
      ok: false,
      problem: `A reading of ${reading} is off this chart, which runs ${chart.first_reading} to ${last}.`,
    }
  }

  const exactIndex = (reading - chart.first_reading) / chart.reading_step
  const lo = Math.floor(exactIndex + 1e-9)
  const hi = Math.ceil(exactIndex - 1e-9)

  const loRow = rowValues(chart, lo)
  const hiRow = rowValues(chart, hi)
  if (loRow[column] == null || hiRow[column] == null) {
    // Only ragged tables get here. The cell is missing because the sample is
    // outside the moisture range this table covers at that temperature.
    return {
      ok: false,
      problem: `This chart does not reach a reading of ${reading} at ${temperature} °C — the sample is outside the range it covers. Check you are on the right chart for how wet the grain is.`,
    }
  }

  if (lo === hi) {
    return { ok: true, moisture: loRow[column], temperature, reading, interpolated: false }
  }
  const t = exactIndex - lo
  return {
    ok: true,
    moisture: round1(loRow[column] + (hiRow[column] - loRow[column]) * t),
    temperature,
    reading,
    interpolated: true,
  }
}

/** The average of the three readings the CGC procedure asks for. */
export function averageReading(readings: (number | null)[]): number | null {
  const got = readings.filter((r): r is number => r != null && Number.isFinite(r))
  if (!got.length) return null
  return Math.round((got.reduce((a, b) => a + b, 0) / got.length) * 100) / 100
}

// ---- the grade ------------------------------------------------------------

/**
 * The Canadian Grain Commission's moisture levels, driest first.
 *
 * `dry` is what the trade calls a straight grade. Everything above it carries
 * the word into the grade name — "No. 1 CWRS, Tough" — and everything above it
 * also needs something done to the bin.
 */
export const GRADES = ['dry', 'tough', 'damp', 'moist', 'wet'] as const
export type BandGrade = (typeof GRADES)[number]
/**
 * The bands, plus the one below them. Beans can be too dry: under 14 % they
 * crack and the plant docks for it, so a crop may carry a floor as well as
 * ceilings. It is not a band — nothing is wetter than "too dry" and drier than
 * "dry" — so it lives outside the tuple the maxima index into.
 */
export type Grade = BandGrade | 'too_dry'

/**
 * The upper edge of each band, per crop.
 *
 * Only the maxima are stored, because the bands butt up against one another —
 * storing both ends invites a gap between 14.5 and 14.6 that nothing grades as.
 *
 * TWO CONVENTIONS THAT MATTER:
 *
 * A null max means the band and everything above it is folded into whatever
 * comes next: wheat has `damp_max` null because the CGC simply says "over 17.0
 * is damp", with no moist or wet for wheat. So the OVERFLOW band — what a
 * sample wetter than every recorded maximum grades as — is the one immediately
 * after the last non-null max.
 *
 * An EMPTY band is written by repeating the previous maximum. The CGC gives
 * beans no tough range at all: dry to 18.0, damp over 18.0. That is stored as
 * dry_max 18.0 and tough_max 18.0, which makes tough unreachable (it would need
 * a value above 18.0 and at or below 18.0) and puts the overflow on damp, which
 * is exactly what the published table says.
 */
export type MoistureBands = {
  dry_max: number | null
  tough_max: number | null
  damp_max: number | null
  moist_max: number | null
  /** Below this it is too dry. Null for crops that have no such thing. */
  dry_min?: number | null
  /** What to do with a tough sample of THIS crop, when the general advice is wrong for it. */
  tough_advice?: string | null
}

const MAX_KEYS = ['dry_max', 'tough_max', 'damp_max', 'moist_max'] as const

/** Null when the crop has no bands recorded — hay and potatoes never will. */
export function gradeFor(bands: MoistureBands, pct: number): Grade | null {
  if (bands.dry_min != null && hasBands(bands) && pct < bands.dry_min) return 'too_dry'
  let lastSet = -1
  for (let i = 0; i < MAX_KEYS.length; i++) {
    const max = bands[MAX_KEYS[i]]
    if (max == null) continue
    lastSet = i
    if (pct <= max) return GRADES[i]
  }
  if (lastSet < 0) return null
  return GRADES[lastSet + 1]
}

/** The grade as a word: 'too_dry' reads "too dry". */
export const gradeLabel = (g: Grade): string => g.replace('_', ' ')

/** Anything above a straight grade needs air on it at the very least. */
export function needsAir(grade: Grade | null): boolean {
  return grade != null && grade !== 'dry' && grade !== 'too_dry'
}

/**
 * The advice for a grade, in this crop's own words where it has them.
 *
 * Beans that read tough are not "bin it with air on": they are fine if the
 * truck goes straight to the bean plant and not fine in our bins, and the
 * general line would send them to the wrong place.
 */
export function adviceFor(grade: Grade, bands: MoistureBands): string {
  if (grade === 'tough' && bands.tough_advice) return bands.tough_advice
  return GRADE_ADVICE[grade]
}

export function hasBands(bands: MoistureBands): boolean {
  return MAX_KEYS.some((k) => bands[k] != null)
}

/** What to do about it, in the words somebody would use in the yard. */
export const GRADE_ADVICE: Record<Grade, string> = {
  too_dry: 'Too dry. Below the floor for this crop — expect cracking and dockage; nothing to do for the bin.',
  dry: 'Safe to bin. Straight grade.',
  tough: 'Bin it, but put air on it — it will not keep as it is.',
  damp: 'Needs drying, not just air. Do not leave it sitting.',
  moist: 'Too wet to store. Dry it or move it straight out.',
  wet: 'Too wet to store. Dry it or move it straight out.',
}

export const GRADE_STYLE: Record<Grade, string> = {
  too_dry: 'bg-sky-100 text-sky-900 ring-1 ring-sky-300',
  dry: 'bg-green-100 text-green-900 ring-1 ring-green-300',
  tough: 'bg-amber-100 text-amber-900 ring-1 ring-amber-300',
  damp: 'bg-orange-100 text-orange-900 ring-1 ring-orange-300',
  moist: 'bg-red-100 text-red-900 ring-1 ring-red-300',
  wet: 'bg-red-200 text-red-950 ring-1 ring-red-400',
}

/**
 * Each band as a range somebody can read, skipping the ones that do not exist.
 *
 * Written the way the CGC writes them — "14.6 to 17.0", starting a tenth above
 * the band below — so the farm's numbers can be checked against the published
 * table without translating between two notations.
 */
export function bandRanges(bands: MoistureBands): { grade: Grade; range: string }[] {
  const out: { grade: Grade; range: string }[] = []
  let floor: number | null = null
  let lastSet = -1
  // A floor reads as its own row, and the dry band starts at it rather than
  // at nothing.
  if (bands.dry_min != null && hasBands(bands)) {
    out.push({ grade: 'too_dry', range: `below ${bands.dry_min.toFixed(1)}` })
    floor = round1(bands.dry_min - 0.1)
  }
  for (let i = 0; i < MAX_KEYS.length; i++) {
    const max = bands[MAX_KEYS[i]]
    if (max == null) continue
    lastSet = i
    // An empty band — beans have no tough range — is not worth a row that
    // reads "18.1 to 18.0".
    if (floor != null && max <= floor) continue
    out.push({
      grade: GRADES[i],
      range: floor == null ? `up to ${max.toFixed(1)}` : `${round1(floor + 0.1).toFixed(1)} to ${max.toFixed(1)}`,
    })
    floor = max
  }
  if (lastSet >= 0 && floor != null) {
    out.push({ grade: GRADES[lastSet + 1], range: `over ${floor.toFixed(1)}` })
  }
  return out
}

export type BandSegment = { grade: Grade; from: number; to: number }

/**
 * The bands as lengths along one moisture scale, for drawing them as a bar:
 * from a little under the driest edge to a little over the wettest, each band
 * as wide as its range, the overflow band (everything wetter than the last
 * maximum) shown as a short run past it. Empty bands are left out.
 */
export function bandSegments(bands: MoistureBands, margin = 3): { segments: BandSegment[]; min: number; max: number; edges: number[] } {
  const maxes = MAX_KEYS.map((k) => bands[k] ?? null)
  const set = maxes.map((m, i) => ({ m, i })).filter((x): x is { m: number; i: number } => x.m != null)
  if (!set.length) return { segments: [], min: 0, max: 0, edges: [] }
  const first = bands.dry_min ?? set[0].m
  const min = Math.max(0, round1(first - margin))
  const last = set[set.length - 1]
  const max = round1(last.m + margin)
  const segments: BandSegment[] = []
  let floor = min
  if (bands.dry_min != null) {
    segments.push({ grade: 'too_dry', from: min, to: bands.dry_min })
    floor = bands.dry_min
  }
  for (const { m, i } of set) {
    if (m <= floor) continue
    segments.push({ grade: GRADES[i], from: floor, to: m })
    floor = m
  }
  segments.push({ grade: GRADES[last.i + 1], from: floor, to: max })
  const edges = [...new Set(segments.slice(0, -1).map((s) => s.to))]
  return { segments, min, max, edges }
}
