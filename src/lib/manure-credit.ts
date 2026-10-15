// Kept free of react-query and of the browser Supabase client on purpose: the
// assessment writer runs this same arithmetic inside a Netlify function, and a
// module that reaches for import.meta.env cannot be imported there.
import type { MultiPolygon } from 'geojson'

/**
 * Manure: what went on, and what the next crop actually gets from it.
 *
 * Two numbers are not the same and the difference is most of the point. A
 * twenty ton load carries roughly 240 lb of nitrogen; the crop that follows it
 * sees about 60. The rest is organic, mineralising over the next three or four
 * years — which is why a field manured two years ago still needs less fertiliser
 * than one that never was, and why a spread that never got recorded turns into
 * a soil test nobody can explain.
 */

/**
 * The typical analysis, wet basis, pounds per ton.
 *
 * Alberta figures for a farm that does not test its manure, which is nearly
 * everyone. A starting point and nothing more: real manure varies by a factor
 * of two with bedding, storage and moisture, so anywhere a number comes from
 * this table rather than from a lab the screen must say so.
 */
export type ManureSource = 'solid_beef'

export const MANURE_SOURCES: {
  key: ManureSource
  label: string
  n: number
  p2o5: number
  k2o: number
  /** Units the rate is given in. Solids are tons an acre, slurry is gallons. */
  unit: string
}[] = [
  // Feedlot solid, and the only one. Dairy, compost and hog slurry were here
  // as options nobody would ever pick — a list this farm has to read past every
  // time it records a load, carrying release rates nothing checks. The array
  // stays an array so a second kind is one line rather than a refactor.
  { key: 'solid_beef', label: 'Solid beef', n: 12, p2o5: 9, k2o: 14, unit: 'ton/ac' },
]

export const sourceOf = (key: string | null | undefined) =>
  MANURE_SOURCES.find((s) => s.key === key) ?? MANURE_SOURCES[0]

/**
 * What kind of manure it was, which decides how much of its nitrogen is
 * ammonium (available now, and lost to the air if left on top) and how fast the
 * organic rest comes back.
 *
 * Alberta's feedlot method (Feedlot Environmental BMP Manual, 2002): year-1 N
 * is all the ammonium less ammonia loss, plus a quarter of the organic N; 12%
 * and 6% of the organic N in the two years after. Bedded manure and compost
 * release far less — straw-bedded gives 10–20% of its N in year 1
 * (BeefResearch.ca), and compost is only about 5% inorganic (Larney 2006).
 */
export type ManureType = 'fresh_pen' | 'stockpiled' | 'straw_bedded' | 'composted'

export const MANURE_TYPES: {
  key: ManureType
  label: string
  /** Share of total N that is ammonium. */
  nh4: number
  /** Share of the ORGANIC N released in years 1, 2 and 3. */
  org: [number, number, number]
}[] = [
  { key: 'fresh_pen', label: 'Fresh from the pens', nh4: 0.1, org: [0.25, 0.12, 0.06] },
  { key: 'stockpiled', label: 'Stockpiled over a season', nh4: 0.07, org: [0.2, 0.1, 0.05] },
  { key: 'straw_bedded', label: 'Straw- or chip-bedded', nh4: 0.05, org: [0.12, 0.08, 0.05] },
  { key: 'composted', label: 'Composted', nh4: 0.05, org: [0.08, 0.05, 0.03] },
]

export const typeOf = (key: string | null | undefined) =>
  MANURE_TYPES.find((t) => t.key === key) ?? MANURE_TYPES[0]

/**
 * Phosphate and potash release, which do not follow nitrogen.
 *
 * Alberta's feedlot method and Saskatchewan both put manure P at 50% in the
 * first year — it was 70% here, which over-credited 20 t/ac by about 36 lb
 * P2O5. Potassium is soluble and essentially all available at once.
 */
export const P_YEAR = [0.5, 0.2, 0]
export const K_YEAR = [0.9, 0.05, 0]

/**
 * Ammonia lost from the AMMONIUM pool, by days until it was worked in.
 *
 * Alberta: 25% if incorporated within a day, 30% within two, 66% if never
 * (10–100% with the weather). The organic N does not volatilise, so taking the
 * loss off total available N — as this did before — docked the wrong pool.
 */
export function nh4LossShare(app: {
  incorporated: boolean | null
  incorporated_days?: number | null
}): { loss: number; known: boolean } {
  const d = app.incorporated_days
  if (d != null && d >= 0) {
    if (d <= 1) return { loss: 0.25, known: true }
    if (d <= 2) return { loss: 0.3, known: true }
    if (d <= 7) return { loss: 0.45, known: true }
    return { loss: 0.66, known: true }
  }
  if (app.incorporated === true) return { loss: 0.3, known: false }
  if (app.incorporated === false) return { loss: 0.66, known: true }
  // Not recorded: assume the worst case and say so, rather than no loss.
  return { loss: 0.66, known: false }
}

/** Year-1 share of total N for a type and loss — for the screens that explain it. */
export function firstYearNShare(type: string | null | undefined, loss = 0.3): number {
  const t = typeOf(type)
  return t.nh4 * (1 - loss) + (1 - t.nh4) * t.org[0]
}

export type ManureApplication = {
  id: string
  field_id: string | null
  crop_year: number
  applied_on: string | null
  source: string
  rate_tons_per_acre: number | null
  n_lb_ton: number | null
  p2o5_lb_ton: number | null
  k2o_lb_ton: number | null
  incorporated: boolean | null
  incorporated_days?: number | null
  manure_type?: string | null
  geojson: MultiPolygon
  acres: number | null
  notes: string | null
  created_at: string
}

export type Analysis = { n: number; p2o5: number; k2o: number }

/**
 * The farm's own manure, once any of it has been to a lab: the mean of every
 * tested spread, nutrient by nutrient. Replaces the Alberta table figure for
 * the spreads nobody tested — this farm's pens and bedding, not a provincial
 * average. Null until there is a test.
 */
export function farmTypical(
  apps: { n_lb_ton: number | string | null; p2o5_lb_ton: number | string | null; k2o_lb_ton: number | string | null }[],
): (Analysis & { samples: number }) | null {
  const vals = (k: 'n_lb_ton' | 'p2o5_lb_ton' | 'k2o_lb_ton') =>
    apps.map((a) => (a[k] == null ? null : Number(a[k]))).filter((x): x is number => x != null && Number.isFinite(x) && x > 0)
  const n = vals('n_lb_ton')
  const p = vals('p2o5_lb_ton')
  const k = vals('k2o_lb_ton')
  const samples = apps.filter((a) => a.n_lb_ton != null || a.p2o5_lb_ton != null || a.k2o_lb_ton != null).length
  if (!samples) return null
  const mean = (xs: number[], d: number) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : d)
  const base = MANURE_SOURCES[0]
  return { n: mean(n, base.n), p2o5: mean(p, base.p2o5), k2o: mean(k, base.k2o), samples }
}

/**
 * The analysis to use: the lab's where there is one; otherwise the farm's own
 * tested average when there is one; otherwise the Alberta table.
 */
export function analysisOf(
  app: {
    source: string
    n_lb_ton: number | null
    p2o5_lb_ton: number | null
    k2o_lb_ton: number | null
  },
  farm?: Analysis | null,
): { n: number; p2o5: number; k2o: number; measured: boolean } {
  const typical = farm ?? sourceOf(app.source)
  const measured =
    app.n_lb_ton != null || app.p2o5_lb_ton != null || app.k2o_lb_ton != null
  return {
    n: app.n_lb_ton ?? typical.n,
    p2o5: app.p2o5_lb_ton ?? typical.p2o5,
    k2o: app.k2o_lb_ton ?? typical.k2o,
    measured,
  }
}

export type Credit = { n: number; p2o5: number; k2o: number }

/**
 * Pounds an acre of each nutrient a crop in `forYear` gets from this spread.
 *
 * Zero before it was applied and zero more than three years after: past that
 * the release is real but too small and too uncertain to put a number on, and
 * a figure that keeps ticking down forever invites somebody to cut fertiliser
 * on the strength of a spread from a decade ago.
 */
export function manureCredit(
  app: Pick<
    ManureApplication,
    'crop_year' | 'source' | 'rate_tons_per_acre' | 'n_lb_ton' | 'p2o5_lb_ton' | 'k2o_lb_ton' | 'incorporated'
  > & { incorporated_days?: number | null; manure_type?: string | null },
  forYear: number,
  farm?: Analysis | null,
): Credit {
  const rate = app.rate_tons_per_acre
  const age = forYear - app.crop_year
  if (rate == null || rate <= 0 || age < 0 || age > 2) return { n: 0, p2o5: 0, k2o: 0 }

  const analysis = analysisOf(app, farm)
  const type = typeOf(app.manure_type)
  const totalN = analysis.n * rate
  const organic = totalN * (1 - type.nh4)
  // The ammonium counts in year 1 only, less what went to the air; the organic
  // pool releases over three years however it went on.
  const nh4 = age === 0 ? totalN * type.nh4 * (1 - nh4LossShare(app).loss) : 0

  return {
    n: nh4 + organic * type.org[age],
    p2o5: analysis.p2o5 * rate * P_YEAR[age],
    k2o: analysis.k2o * rate * K_YEAR[age],
  }
}

/** What was assumed about a spread, for the screen to say out loud. */
export function manureAssumptions(app: {
  manure_type?: string | null
  incorporated: boolean | null
  incorporated_days?: number | null
}): string[] {
  const out: string[] = []
  if (!app.manure_type) out.push('manure type not recorded — read as fresh pen manure')
  if (!nh4LossShare(app).known) {
    out.push(
      app.incorporated === true
        ? 'days to incorporation not recorded — read as two days'
        : 'incorporation not recorded — read as left on the surface',
    )
  }
  return out
}

/** Everything a field's crop gets this year from every spread on it. */
export function creditForField(apps: ManureApplication[], forYear: number, farm?: Analysis | null): Credit {
  return apps.reduce<Credit>(
    (a, app) => {
      const c = manureCredit(app, forYear, farm)
      return { n: a.n + c.n, p2o5: a.p2o5 + c.p2o5, k2o: a.k2o + c.k2o }
    },
    { n: 0, p2o5: 0, k2o: 0 },
  )
}

/**
 * The credit weighted by how much of the field was actually covered.
 *
 * A twenty-acre spread on a hundred-and-thirty-acre field is not a
 * field-wide credit, and treating it as one is how a fertiliser plan ends up
 * short across the other hundred and ten acres. Only meaningful as a
 * field-average figure — the covered ground got the full rate, and that is what
 * the map is for.
 */
export function creditSpreadOver(
  apps: ManureApplication[],
  forYear: number,
  fieldAcres: number | null,
  farm?: Analysis | null,
): Credit {
  if (!fieldAcres || fieldAcres <= 0) return creditForField(apps, forYear, farm)
  return apps.reduce<Credit>(
    (a, app) => {
      const c = manureCredit(app, forYear, farm)
      const share = Math.max(0, Math.min(1, (app.acres ?? 0) / fieldAcres))
      return { n: a.n + c.n * share, p2o5: a.p2o5 + c.p2o5 * share, k2o: a.k2o + c.k2o * share }
    },
    { n: 0, p2o5: 0, k2o: 0 },
  )
}
