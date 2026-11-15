/**
 * The cow-calf scorecard: seventeen indicators from nineteen figures, each one
 * against an industry target and what the neighbours actually manage.
 *
 * Nothing here talks to Supabase, so the page and the tests use the same
 * numbers.
 *
 * ---------------------------------------------------------------------------
 * The definitions, targets and benchmarks are the BCRC's Cow-Calf Production
 * Indicators Calculator, whose spreadsheet was read on 13 Nov 2026. The
 * benchmarks are the 2023 Canadian Cow-Calf Survey; the targets come from the
 * BCRC's own topic pages, cited per row in INDICATORS below.
 *
 * Three things are done differently:
 *
 *   1. THEIRS FORGETS EVERYTHING. "User data is not collected, stored or
 *      retained ... by exiting or refreshing the page, all data will be
 *      automatically cleared and cannot be recovered." A scorecard you cannot
 *      hold against last year's is half a scorecard, so ours is saved per
 *      ranch per calf crop (cow_calf_indicators).
 *
 *   2. THEIR "MEETS OR EXCEEDS" HIDES A MISSING NUMBER. Their cells test
 *      `IF(G=0,"",...)`, so a figure that is genuinely zero — no abortions, no
 *      dead calves — is treated as "not entered" and silently scores nothing,
 *      while a rate that cannot be computed at all shows blank the same way.
 *      Here a missing input gives `null` and says which input is missing; a
 *      real zero is scored like any other number, and on a death-loss row a
 *      zero is the best score there is.
 *
 *   3. THEIR CALVING-PERIOD TARGET IS HARD-CODED TWICE. Cell K15 compares
 *      against a literal 63 rather than against J15, the target beside it, so
 *      editing the target changes the number on screen and not the verdict.
 *      Here every verdict reads the same target the row displays.
 * ---------------------------------------------------------------------------
 */

const n = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}

const days = (from: string | null | undefined, to: string | null | undefined): number | null => {
  if (!from || !to) return null
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`)
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.round((b - a) / 86_400_000)
}

/**
 * The figures the scorecard is built from. Nineteen, not the fifteen the
 * BCRC advertises: they count a date range as one number and leave the cow
 * weight out of the tally, but every one of these has to be typed.
 */
export type IndicatorInputs = {
  femalesExposed?: number | null
  bullsUsed?: number | null
  femalesBred?: number | null
  femalesCalved?: number | null
  setsOfTwins?: number | null
  firstCalvingOn?: string | null
  lastCalvingOn?: string | null
  /** The day half the calves had been born. */
  medianCalvingOn?: string | null
  weaningOn?: string | null
  calvesBorn1_21?: number | null
  calvesBorn22_42?: number | null
  calvesBorn43_63?: number | null
  calvesBorn64Plus?: number | null
  calvesDead24h?: number | null
  calvesDeadToWean?: number | null
  calvesWeaned?: number | null
  avgBirthWeightLb?: number | null
  avgWeaningWeightLb?: number | null
  avgCowWeightLb?: number | null
}

export type Region = 'west' | 'east' | 'national'

export const REGION_LABEL: Record<Region, string> = {
  west: 'Western Canada',
  east: 'Eastern Canada',
  national: 'National',
}

/** How a row is read: bigger is better, or smaller is. */
export type Direction = 'higher' | 'lower'
export type Format = 'percent' | 'number' | 'days' | 'lb' | 'ratio'

export type IndicatorSpec = {
  key: string
  label: string
  format: Format
  direction: Direction
  /** The industry target, or null where the BCRC gives none. */
  target: number | null
  /** By region, from the 2023 Canadian Cow-Calf Survey. Null where none. */
  benchmark: Record<Region, number | null>
  /** One of the four the BCRC calls its GOLD indicators. */
  gold?: boolean
  source?: string
}

/**
 * Every indicator, its target and its benchmarks.
 *
 * Percentages are fractions here, not 0-100, so a target and a computed value
 * are always the same kind of thing. The benchmark weaning rate is derived the
 * way their sheet derives it — calving rate times both survival rates — rather
 * than surveyed directly, which is why it is not a round number.
 */
export const INDICATORS: IndicatorSpec[] = [
  { key: 'cowBullRatio', label: 'Cow : bull ratio', format: 'ratio', direction: 'higher', target: null, benchmark: { west: 20.1, east: 21.1, national: 20.4 } },
  { key: 'conceptionRate', label: 'Conception rate', format: 'percent', direction: 'higher', target: 0.94, benchmark: { west: 1 - 0.076, east: 1 - 0.056, national: 0.926 }, gold: true, source: 'BCRC, Breeding Cow Management' },
  { key: 'calvingPeriod', label: 'Length of calving period', format: 'days', direction: 'lower', target: 63, benchmark: { west: 83, east: 106, national: 89 }, gold: true, source: 'BCRC, Tightening the Calving Season' },
  { key: 'born1_21', label: 'Calves born days 1–21', format: 'percent', direction: 'higher', target: 0.6, benchmark: { west: 0.604, east: 0.52, national: 0.58 } },
  { key: 'born22_42', label: 'Calves born days 22–42', format: 'percent', direction: 'higher', target: 0.25, benchmark: { west: 0.254, east: 0.294, national: 0.264 } },
  { key: 'born43_63', label: 'Calves born days 43–63', format: 'percent', direction: 'lower', target: 0.1, benchmark: { west: 0.102, east: 0.109, national: 0.103 } },
  { key: 'born64Plus', label: 'Calves born day 64+', format: 'percent', direction: 'lower', target: 0.05, benchmark: { west: 0.039, east: 0.077, national: 0.048 } },
  { key: 'abortionRate', label: 'Abortion rate', format: 'percent', direction: 'lower', target: 0.03, benchmark: { west: 0.0101, east: 0.0101, national: 0.0101 } },
  { key: 'calvingRate', label: 'Calving rate', format: 'percent', direction: 'higher', target: 0.91, benchmark: { west: 0.897, east: 0.899, national: 0.897 } },
  { key: 'deathLoss24h', label: 'Calf death loss, first 24 h', format: 'percent', direction: 'lower', target: null, benchmark: { west: 0.022, east: 0.024, national: 0.022 } },
  { key: 'deathLossToWean', label: 'Calf death loss, day 1 to weaning', format: 'percent', direction: 'lower', target: null, benchmark: { west: 0.024, east: 0.028, national: 0.025 }, gold: true },
  { key: 'weaningRate', label: 'Weaning rate', format: 'percent', direction: 'higher', target: 0.85, benchmark: { west: 0.897 * (1 - 0.022) * (1 - 0.024), east: 0.899 * (1 - 0.024) * (1 - 0.028), national: 0.897 * (1 - 0.022) * (1 - 0.025) } },
  { key: 'weaningWeight', label: 'Average weaning weight', format: 'lb', direction: 'higher', target: null, benchmark: { west: 573, east: 590, national: 577 }, gold: true },
  { key: 'lbWeanedPerExposed', label: 'Lb weaned per female exposed', format: 'lb', direction: 'higher', target: 460, benchmark: { west: null, east: null, national: null } },
  { key: 'weaningAge', label: 'Age at weaning', format: 'days', direction: 'higher', target: null, benchmark: { west: 211, east: 226, national: 215 } },
  { key: 'adj205', label: 'Adjusted 205-day weaning weight', format: 'lb', direction: 'higher', target: null, benchmark: { west: 557, east: 546, national: 554 } },
  { key: 'adgPreWean', label: 'Pre-weaning average daily gain', format: 'number', direction: 'higher', target: null, benchmark: { west: null, east: null, national: null } },
  { key: 'wwPctCowWeight', label: 'Weaning weight as % of cow weight', format: 'percent', direction: 'higher', target: 0.45, benchmark: { west: 0.417, east: 0.41, national: 0.415 } },
]

export type Verdict = 'meets' | 'below' | null

export type IndicatorRow = IndicatorSpec & {
  /** The farm's figure, or null when an input it needs is missing. */
  value: number | null
  /** Which input is missing, when the value is null. */
  missing: string | null
  benchmarkValue: number | null
  vsTarget: Verdict
  vsBenchmark: Verdict
}

/** Is `value` on the right side of `mark`? Null when either is absent. */
export function verdict(value: number | null, mark: number | null, direction: Direction): Verdict {
  if (value == null || mark == null) return null
  return direction === 'higher' ? (value >= mark ? 'meets' : 'below') : value <= mark ? 'meets' : 'below'
}

/** Live calves born: those that calved, plus the twins, less the ones born dead. */
export function liveCalvesBorn(i: IndicatorInputs): number | null {
  const calved = n(i.femalesCalved)
  if (calved == null) return null
  return calved + (n(i.setsOfTwins) ?? 0) - (n(i.calvesDead24h) ?? 0)
}

/** Total calves born across the four calving cycles. */
export function totalCalvesBorn(i: IndicatorInputs): number | null {
  const parts = [i.calvesBorn1_21, i.calvesBorn22_42, i.calvesBorn43_63, i.calvesBorn64Plus].map(n)
  if (parts.every((p) => p == null)) return null
  return parts.reduce((a: number, p) => a + (p ?? 0), 0)
}

type Computed = { value: number | null; missing: string | null }

const need = (label: string): Computed => ({ value: null, missing: label })

/** Every indicator worked out, or told which figure it is waiting on. */
export function computeIndicators(i: IndicatorInputs, region: Region = 'west'): IndicatorRow[] {
  const exposed = n(i.femalesExposed)
  const bred = n(i.femalesBred)
  const calved = n(i.femalesCalved)
  const weaned = n(i.calvesWeaned)
  const bornTotal = totalCalvesBorn(i)
  const live = liveCalvesBorn(i)
  const bw = n(i.avgBirthWeightLb)
  const ww = n(i.avgWeaningWeightLb)
  const cowWt = n(i.avgCowWeightLb)
  const weanAge = days(i.medianCalvingOn, i.weaningOn)

  const share = (count: number | null | undefined): Computed => {
    const c = n(count)
    if (bornTotal == null) return need('the calving distribution')
    if (!(bornTotal > 0)) return { value: null, missing: 'calves born' }
    return { value: (c ?? 0) / bornTotal, missing: null }
  }

  const calc: Record<string, Computed> = {
    cowBullRatio:
      exposed == null ? need('females exposed') : n(i.bullsUsed) ? { value: exposed / n(i.bullsUsed)!, missing: null } : need('bulls used'),
    conceptionRate:
      bred == null ? need('females bred') : exposed ? { value: bred / exposed, missing: null } : need('females exposed'),
    calvingPeriod: (() => {
      const d = days(i.firstCalvingOn, i.lastCalvingOn)
      return d == null ? need('the first and last calving dates') : { value: d, missing: null }
    })(),
    born1_21: share(i.calvesBorn1_21),
    born22_42: share(i.calvesBorn22_42),
    born43_63: share(i.calvesBorn43_63),
    born64Plus: share(i.calvesBorn64Plus),
    abortionRate:
      bred == null || calved == null ? need('females bred and calved') : bred > 0 ? { value: (bred - calved) / bred, missing: null } : need('females bred'),
    calvingRate: calved == null ? need('females calved') : exposed ? { value: calved / exposed, missing: null } : need('females exposed'),
    deathLoss24h: (() => {
      const d = n(i.calvesDead24h)
      const base = calved == null ? null : calved + (n(i.setsOfTwins) ?? 0)
      if (d == null) return need('calves lost in the first 24 h')
      return base ? { value: d / base, missing: null } : need('females calved')
    })(),
    deathLossToWean: (() => {
      const d = n(i.calvesDeadToWean)
      if (d == null) return need('calves lost after the first day')
      return live ? { value: d / live, missing: null } : need('females calved')
    })(),
    weaningRate: weaned == null ? need('calves weaned') : exposed ? { value: weaned / exposed, missing: null } : need('females exposed'),
    weaningWeight: ww == null ? need('the average weaning weight') : { value: ww, missing: null },
    lbWeanedPerExposed:
      ww == null || weaned == null ? need('weaning weight and calves weaned') : exposed ? { value: (ww * weaned) / exposed, missing: null } : need('females exposed'),
    weaningAge: weanAge == null ? need('the median calving date and the weaning date') : { value: weanAge, missing: null },
    adj205:
      ww == null || bw == null ? need('birth and weaning weights') : weanAge ? { value: ((ww - bw) / weanAge) * 205 + bw, missing: null } : need('the weaning age'),
    adgPreWean:
      ww == null || bw == null ? need('birth and weaning weights') : weanAge ? { value: (ww - bw) / weanAge, missing: null } : need('the weaning age'),
    wwPctCowWeight: ww == null ? need('the average weaning weight') : cowWt ? { value: ww / cowWt, missing: null } : need('the average cow weight'),
  }

  return INDICATORS.map((spec) => {
    const c = calc[spec.key] ?? { value: null, missing: 'a figure' }
    const benchmarkValue = spec.benchmark[region]
    return {
      ...spec,
      value: c.value,
      missing: c.missing,
      benchmarkValue,
      vsTarget: verdict(c.value, spec.target, spec.direction),
      vsBenchmark: verdict(c.value, benchmarkValue, spec.direction),
    }
  })
}

/** How many of the figures are in, for a progress line. */
export function inputsEntered(i: IndicatorInputs): { entered: number; total: number } {
  const keys: (keyof IndicatorInputs)[] = [
    'femalesExposed', 'bullsUsed', 'femalesBred', 'femalesCalved', 'setsOfTwins',
    'firstCalvingOn', 'lastCalvingOn', 'medianCalvingOn', 'weaningOn',
    'calvesBorn1_21', 'calvesBorn22_42', 'calvesBorn43_63', 'calvesBorn64Plus',
    'calvesDead24h', 'calvesDeadToWean', 'calvesWeaned',
    'avgBirthWeightLb', 'avgWeaningWeightLb', 'avgCowWeightLb',
  ]
  const entered = keys.filter((k) => {
    const v = i[k]
    return v != null && v !== ''
  }).length
  return { entered, total: keys.length }
}

/**
 * A consistency check their sheet writes as a note beside the cell and never
 * enforces: the calving distribution should add to the calves born, and the
 * calves weaned cannot exceed the live ones.
 */
export function consistencyWarnings(i: IndicatorInputs): string[] {
  const out: string[] = []
  const bornTotal = totalCalvesBorn(i)
  const calved = n(i.femalesCalved)
  const twins = n(i.setsOfTwins) ?? 0
  if (bornTotal != null && calved != null && bornTotal !== calved + twins)
    out.push(`The calving distribution adds to ${bornTotal}, but ${calved} females calved plus ${twins} sets of twins is ${calved + twins}.`)
  const live = liveCalvesBorn(i)
  const weaned = n(i.calvesWeaned)
  const deadToWean = n(i.calvesDeadToWean) ?? 0
  if (live != null && weaned != null && weaned > live - deadToWean)
    out.push(`${weaned} calves weaned is more than the ${live - deadToWean} live calves left after losses.`)
  const bred = n(i.femalesBred)
  const exposed = n(i.femalesExposed)
  if (bred != null && exposed != null && bred > exposed) out.push(`${bred} females bred is more than the ${exposed} exposed.`)
  return out
}
