/**
 * The research report's "new automation" list, as plain arithmetic.
 *
 * Every function here is pure — no React, no Supabase — so the Savings cards,
 * the crons and the tests all share it. The data plumbing lives with the
 * cards; the agronomy lives here, with its source beside each number.
 */

/* ------------------------------------------------------------------ units */

export type YieldUnit = 'bu' | 'lbs' | 'cwt' | 'ton' | 'MT'

/** Convert a yield between mass units. Bushels only convert with a test weight. */
export function convertYield(v: number, from: YieldUnit, to: YieldUnit, lbPerBu?: number | null): number | null {
  if (from === to) return v
  const toLb: Record<YieldUnit, number | null> = { bu: lbPerBu ?? null, lbs: 1, cwt: 100, ton: 2000, MT: 2204.62262 }
  const a = toLb[from]
  const b = toLb[to]
  return a == null || b == null ? null : (v * a) / b
}

/* ------------------------------------------------------ 1. N price re-solve */

/**
 * Whether the nitrogen-to-crop price ratio has moved enough to re-solve.
 * The economic rate moves with the ratio, not with either price alone: N up
 * 10% and canola up 10% changes nothing. 10% is about where Alberta's curves
 * move the answer by one 5-lb step on a typical field.
 */
export function ratioMoved(before: number | null | undefined, now: number | null | undefined, threshold = 0.1): boolean {
  if (before == null || now == null || !(before > 0) || !(now > 0)) return false
  return Math.abs(now / before - 1) >= threshold
}

/* ------------------------------------------------- 2. yield-goal sanity bands */

/**
 * Where a yield goal stops being believable. The fixed bands are from the
 * research report's crop reports (potatoes 300–550 cwt, dry beans 2,000–3,500
 * lb, corn 100–200 bu, irrigated canola 50–80 bu, alfalfa 4–7 t); the farm's
 * own history beats them wherever three or more years exist.
 */
export const YIELD_BANDS: { match: RegExp; unit: YieldUnit; low: number; high: number; irrigatedOnly?: boolean }[] = [
  { match: /potato/i, unit: 'cwt', low: 300, high: 550 },
  { match: /bean/i, unit: 'lbs', low: 2000, high: 3500 },
  { match: /corn/i, unit: 'bu', low: 100, high: 200 },
  { match: /canola/i, unit: 'bu', low: 50, high: 80, irrigatedOnly: true },
  { match: /alfalfa/i, unit: 'ton', low: 4, high: 7 },
]

export type GoalCheck = { verdict: 'ok' | 'high' | 'low' | 'unknown'; why: string; median: number | null }

export function yieldGoalCheck(args: {
  crop: string | null | undefined
  goal: number | null | undefined
  unit: YieldUnit | null | undefined
  lbPerBu?: number | null
  irrigated: boolean
  /** This field's own past yields for the crop, in the crop's unit. */
  history: number[]
}): GoalCheck {
  const { goal, unit } = args
  if (goal == null || !(goal > 0) || !unit) return { verdict: 'unknown', why: 'no yield goal', median: null }
  const past = args.history.filter((x) => x > 0).sort((a, b) => a - b)
  const median = past.length ? past[Math.floor((past.length - 1) / 2)] + (past.length % 2 ? 0 : (past[past.length / 2] - past[(past.length - 1) / 2]) / 2) : null
  if (median != null && past.length >= 3) {
    if (goal > median * 1.25) return { verdict: 'high', why: `more than 25% over this field's ${past.length}-year median of ${Math.round(median)}`, median }
    if (goal < median * 0.7) return { verdict: 'low', why: `under 70% of this field's ${past.length}-year median of ${Math.round(median)}`, median }
    return { verdict: 'ok', why: `within reach of this field's ${past.length}-year median of ${Math.round(median)}`, median }
  }
  const band = YIELD_BANDS.find((b) => b.match.test(args.crop ?? '') && (!b.irrigatedOnly || args.irrigated))
  if (!band) return { verdict: 'unknown', why: 'no band for this crop and under three years of history', median }
  const g = convertYield(goal, unit, band.unit, args.lbPerBu)
  if (g == null) return { verdict: 'unknown', why: `goal is in ${unit}, the band in ${band.unit}`, median }
  const range = `${band.low.toLocaleString('en-CA')}–${band.high.toLocaleString('en-CA')} ${band.unit}`
  if (g > band.high) return { verdict: 'high', why: `above the ${range} that southern Alberta grows`, median }
  if (g < band.low) return { verdict: 'low', why: `below the ${range} that southern Alberta grows`, median }
  return { verdict: 'ok', why: `inside ${range}`, median }
}

/* ------------------------------------------------------ 3. leaching & resample */

export type LeachingRisk = { level: 'high' | 'moderate' | 'low'; resample: boolean; reasons: string[] }

/**
 * Whether last fall's soil nitrate can still be trusted in spring.
 *
 * Research report automation #7: resample in spring when fall nitrate is over
 * 60 lb/ac AND the ground is sandy, took heavy fall irrigation, or had a wet
 * winter. Water that drains past the root zone carries nitrate with it; on
 * coarse soil an inch of drainage moves a lot of it (Olson 2009, coarse
 * irrigated sites).
 */
export function leachingRisk(args: {
  fallNitrateLbAc: number | null
  texture: string | null | undefined
  /** Water that drained below the root zone since the soil sample, mm. */
  drainageMm: number | null
  /** Irrigation applied between the sample and freeze-up, mm. */
  fallIrrigationMm: number | null
  /** Precipitation from November to the spring sample date, mm. */
  winterPrecipMm: number | null
}): LeachingRisk {
  const reasons: string[] = []
  const t = (args.texture ?? '').toLowerCase()
  const sandy = /sand/.test(t)
  const n = args.fallNitrateLbAc
  if (sandy) reasons.push(`${args.texture} lets nitrate move`)
  if ((args.drainageMm ?? 0) >= 25) reasons.push(`${Math.round(args.drainageMm!)} mm drained below the root zone since sampling`)
  if ((args.fallIrrigationMm ?? 0) >= 50) reasons.push(`${Math.round(args.fallIrrigationMm!)} mm irrigated after the sample`)
  if ((args.winterPrecipMm ?? 0) >= 100) reasons.push(`${Math.round(args.winterPrecipMm!)} mm of winter precipitation`)
  const wet = (args.drainageMm ?? 0) >= 25 || (args.fallIrrigationMm ?? 0) >= 50 || (args.winterPrecipMm ?? 0) >= 100
  const resample = n != null && n > 60 && (sandy || wet)
  const level: LeachingRisk['level'] = sandy && wet ? 'high' : sandy || wet ? 'moderate' : 'low'
  if (n != null && n > 60) reasons.unshift(`${Math.round(n)} lb/ac nitrate left in the fall`)
  return { level, resample, reasons }
}

/* ------------------------------------------------------------ 4. salinity */

/**
 * Salt tolerance, Maas–Hoffman: relative yield = 100 − slope × (ECe − threshold),
 * ECe in dS/m (saturated paste). Maas 1990 / FAO Irrigation & Drainage Paper 29
 * & 48. Crops listed as tolerant with no threshold are left out rather than
 * guessed. Beans, carrots and corn are where it bites here.
 */
export const SALT_TOLERANCE: { match: RegExp; label: string; threshold: number; slope: number }[] = [
  { match: /bean/i, label: 'dry beans', threshold: 1.0, slope: 19 },
  { match: /carrot/i, label: 'carrots', threshold: 1.0, slope: 14 },
  { match: /corn/i, label: 'corn', threshold: 1.7, slope: 12 },
  { match: /potato/i, label: 'potatoes', threshold: 1.7, slope: 12 },
  { match: /flax/i, label: 'flax', threshold: 1.7, slope: 12 },
  { match: /alfalfa/i, label: 'alfalfa', threshold: 2.0, slope: 7.3 },
  { match: /spinach/i, label: 'spinach', threshold: 2.0, slope: 7.6 },
  { match: /pea/i, label: 'peas', threshold: 3.4, slope: 10.6 },
  { match: /soy/i, label: 'soybeans', threshold: 5.0, slope: 20 },
  { match: /durum/i, label: 'durum', threshold: 5.9, slope: 3.8 },
  { match: /(^|[^a-z])wheat|cwrs/i, label: 'wheat', threshold: 6.0, slope: 7.1 },
  { match: /sugar ?beet/i, label: 'sugar beets', threshold: 7.0, slope: 5.9 },
  { match: /barley/i, label: 'barley', threshold: 8.0, slope: 5.0 },
  { match: /canola|rapeseed/i, label: 'canola', threshold: 11.0, slope: 13 },
]

export function saltTolerance(crop: string | null | undefined) {
  if (/buckwheat/i.test(crop ?? '')) return null
  return SALT_TOLERANCE.find((s) => s.match.test(crop ?? '')) ?? null
}

/** Share of full yield (0–1) at a soil EC, or null for a crop without a published threshold. */
export function relativeYieldAtEc(crop: string | null | undefined, ecDsM: number | null | undefined): number | null {
  const t = saltTolerance(crop)
  if (!t || ecDsM == null || !Number.isFinite(ecDsM)) return null
  if (ecDsM <= t.threshold) return 1
  return Math.max(0, 1 - (t.slope * (ecDsM - t.threshold)) / 100)
}

/**
 * A field's salinity cap: the yield goal scaled by the acres at each EC.
 * `sites` are soil-test sites, each standing for an equal share of the field
 * unless it says otherwise.
 */
export function salinityCap(
  crop: string | null | undefined,
  sites: { ec: number | null; share?: number }[],
): { factor: number | null; worst: number | null; affectedShare: number } {
  const usable = sites.filter((s) => s.ec != null)
  if (!usable.length || !saltTolerance(crop)) return { factor: null, worst: null, affectedShare: 0 }
  const total = usable.reduce((a, s) => a + (s.share ?? 1), 0)
  let factor = 0
  let affected = 0
  let worst = 1
  for (const s of usable) {
    const ry = relativeYieldAtEc(crop, s.ec)!
    const w = (s.share ?? 1) / total
    factor += ry * w
    if (ry < 1) affected += w
    worst = Math.min(worst, ry)
  }
  return { factor, worst, affectedShare: affected }
}

/* ------------------------------------------------- 5. potato petiole → pivot */

export type PetioleAdvice = { lbN: number; verdict: 'short' | 'in band' | 'high' | 'late' | 'unknown'; why: string }

/**
 * Turning a 4th-petiole nitrate reading into a pivot top-up.
 *
 * Alberta's Russet Burbank bands by days after planting (Agdex 258/541-1);
 * Taber growers top up 20–40 lb N/ac through the pivot when a reading falls
 * under the band (Spud Smart 2011). Past about 100 days the crop is bulking
 * and late N grows vines, not tubers, so nothing is suggested then.
 */
export function petioleFertigation(reading: number | null | undefined, band: [number, number] | null, dap: number | null): PetioleAdvice {
  if (reading == null || !band || dap == null) return { lbN: 0, verdict: 'unknown', why: 'needs a reading and days after planting' }
  if (dap > 100) return { lbN: 0, verdict: 'late', why: `${dap} days after planting — too late for N to pay` }
  const [low, high] = band
  if (reading > high) return { lbN: 0, verdict: 'high', why: `${reading.toLocaleString('en-CA')} ppm is over the ${high.toLocaleString('en-CA')} top of the band — hold N` }
  if (reading >= low) return { lbN: 0, verdict: 'in band', why: `in the ${low.toLocaleString('en-CA')}–${high.toLocaleString('en-CA')} band — no top-up` }
  const short = (low - reading) / low
  const lbN = short <= 0.15 ? 20 : short <= 0.35 ? 30 : 40
  return { lbN, verdict: 'short', why: `${Math.round(short * 100)}% under the ${low.toLocaleString('en-CA')} ppm floor at ${dap} days — ${lbN} lb N through the pivot, retest in a week` }
}

/* --------------------------------------------------- 6. P and K running balance */

/**
 * The farm's own soil buffer: how many ppm the test moved per 100 lb/ac of
 * surplus, fitted through the origin across a field's successive tests. The
 * Alberta default (20–37 lb P2O5 per ppm Olsen) is used until two tests with a
 * balance between them exist. Swift Current tracked Olsen against balance over
 * 39 years; this is that idea on one farm.
 */
export function fitBuffer(points: { surplusLb: number; deltaPpm: number }[]): { ppmPer100Lb: number | null; n: number } {
  const usable = points.filter((p) => Math.abs(p.surplusLb) >= 20)
  if (usable.length < 2) return { ppmPer100Lb: null, n: usable.length }
  const sxy = usable.reduce((a, p) => a + p.surplusLb * p.deltaPpm, 0)
  const sxx = usable.reduce((a, p) => a + p.surplusLb * p.surplusLb, 0)
  return { ppmPer100Lb: sxx > 0 ? (sxy / sxx) * 100 : null, n: usable.length }
}

/* ------------------------------------------------ 7. N-rich strip + red edge */

/**
 * Sufficiency index: the field's red-edge index over the N-rich strip's. Under
 * 0.95 the crop is short of N (Holzapfel et al. 2009 used sensors and strips
 * to cut canola N 34 kg/ha with no yield loss outside drought). The top-up
 * scales with how far under it is; before the late-June cut-off only.
 */
export function nSufficiency(field: number | null | undefined, strip: number | null | undefined): { si: number | null; verdict: 'short' | 'ok' | 'unknown'; lbN: number } {
  if (field == null || strip == null || !(strip > 0)) return { si: null, verdict: 'unknown', lbN: 0 }
  const si = Math.round((field / strip) * 1000) / 1000
  if (si >= 0.95) return { si, verdict: 'ok', lbN: 0 }
  return { si, verdict: 'short', lbN: si >= 0.9 ? 20 : si >= 0.85 ? 30 : 40 }
}

/* ------------------------------------------------------ 8. N-rate trials */

/**
 * Quadratic response y = a + b·N + c·N², least squares. Enough for 4–5 rates
 * with replicates; the economic optimum is where the last pound pays:
 * dY/dN = price ratio → N* = (ratio − b) / (2c), inside the rates tested.
 */
export function fitQuadratic(pts: { n: number; y: number }[]): { a: number; b: number; c: number; r2: number } | null {
  if (pts.length < 3 || new Set(pts.map((p) => p.n)).size < 3) return null
  // Normal equations for [1, n, n²].
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0
  for (const { n, y } of pts) {
    s0 += 1; s1 += n; s2 += n * n; s3 += n ** 3; s4 += n ** 4
    t0 += y; t1 += n * y; t2 += n * n * y
  }
  const M = [
    [s0, s1, s2, t0],
    [s1, s2, s3, t1],
    [s2, s3, s4, t2],
  ]
  for (let i = 0; i < 3; i++) {
    let p = i
    for (let r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r
    ;[M[i], M[p]] = [M[p], M[i]]
    if (Math.abs(M[i][i]) < 1e-12) return null
    for (let r = 0; r < 3; r++) {
      if (r === i) continue
      const f = M[r][i] / M[i][i]
      for (let k = i; k < 4; k++) M[r][k] -= f * M[i][k]
    }
  }
  const a = M[0][3] / M[0][0]
  const b = M[1][3] / M[1][1]
  const c = M[2][3] / M[2][2]
  const mean = t0 / s0
  const ssTot = pts.reduce((acc, p) => acc + (p.y - mean) ** 2, 0)
  const ssRes = pts.reduce((acc, p) => acc + (p.y - (a + b * p.n + c * p.n * p.n)) ** 2, 0)
  return { a, b, c, r2: ssTot > 0 ? 1 - ssRes / ssTot : 0 }
}

export function economicOptimum(fit: { b: number; c: number }, ratio: number, range: [number, number]): { n: number; capped: boolean } | null {
  if (!(fit.c < 0)) return null // no diminishing return — the trial did not find a top
  const n = (ratio - fit.b) / (2 * fit.c)
  const clamped = Math.min(range[1], Math.max(range[0], n))
  return { n: Math.round(clamped / 5) * 5, capped: clamped !== n }
}

/** Randomised complete blocks: each replicate is every rate once, in a fresh order. */
export function trialLayout(rates: number[], reps: number, seed = 1): number[] {
  let s = seed >>> 0 || 1
  const rand = () => {
    // xorshift32 — reproducible, so a trial can be re-drawn exactly.
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 4294967296
  }
  const out: number[] = []
  for (let r = 0; r < reps; r++) {
    const order = [...rates]
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    out.push(...order)
  }
  return out
}

/* ------------------------------------------------------------ 9. protein */

/**
 * Grain protein as an after-the-fact N check (Heard 2022): CWRS under 13.2%
 * or durum under 13.5% usually means the crop ran short of N late.
 */
export function proteinCheck(crop: string | null | undefined, protein: number | null | undefined): { short: boolean; line: number | null } {
  const c = (crop ?? '').toLowerCase()
  const line = /durum/.test(c) ? 13.5 : /wheat|cwrs/.test(c) && !/buckwheat/.test(c) ? 13.2 : null
  if (line == null || protein == null) return { short: false, line }
  return { short: protein < line, line }
}

/** The farm's own manure analysis: the mean of every lab-tested spread, once there is one. */
export function rollingManureAnalysis(
  tested: { n: number | null; p2o5: number | null; k2o: number | null }[],
  fallback: { n: number; p2o5: number; k2o: number },
): { n: number; p2o5: number; k2o: number; samples: number } {
  const mean = (xs: (number | null)[], d: number) => {
    const v = xs.filter((x): x is number => x != null && Number.isFinite(x) && x > 0)
    return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : d
  }
  return {
    n: mean(tested.map((t) => t.n), fallback.n),
    p2o5: mean(tested.map((t) => t.p2o5), fallback.p2o5),
    k2o: mean(tested.map((t) => t.k2o), fallback.k2o),
    samples: tested.filter((t) => t.n != null || t.p2o5 != null || t.k2o != null).length,
  }
}
