import type { SupabaseClient } from '@supabase/supabase-js'

// Cross-sensor harmonization (spec §4.5).
//
// Landsat and Sentinel-2 do not report the same NDVI over the same canopy on
// the same day. The difference is small — hundredths — and that is exactly what
// makes it dangerous: §4.5 warns that "a 0.04 NDVI step artifact reads as a
// real event and will generate a false alert". Big errors get noticed. This one
// looks like a crop changing.
//
// The remedy is a linear adjustment onto the Sentinel-2 scale, and the spec is
// specific about where the coefficients come from: regress the same field seen
// by both sensors within a day, both looks above 0.90 valid fraction, and do
// not believe the result until there are fifteen such pairs. Until then a
// published default applies and the values are labelled provisional.
//
// Fifteen is not arbitrary caution. Our first three pairs differ by +0.081,
// -0.032 and +0.119 — a spread far wider than the effect being measured. A
// regression on three points would produce a confident coefficient built
// entirely out of noise, and bake it into every Landsat reading afterwards.

/** Pairs required before this farm's own numbers beat the published default. */
export const MIN_PAIRS_FOR_LOCAL = 15

export type Pair = { s2: number; landsat: number }

export type Fit = { slope: number; intercept: number; r2: number; n: number }

/**
 * Ordinary least squares of Sentinel-2 NDVI on Landsat NDVI.
 *
 * Landsat is the predictor because Landsat is what gets corrected: the fit
 * answers "given this Landsat value, what would Sentinel-2 have said". Running
 * it the other way round and inverting is a different estimator and a
 * measurably biased one when both axes carry error.
 */
export function fitHarmonization(pairs: Pair[]): Fit | null {
  const n = pairs.length
  if (n < 2) return null
  const mx = pairs.reduce((a, p) => a + p.landsat, 0) / n
  const my = pairs.reduce((a, p) => a + p.s2, 0) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (const p of pairs) {
    const dx = p.landsat - mx
    const dy = p.s2 - my
    sxy += dx * dy
    sxx += dx * dx
    syy += dy * dy
  }
  // Every Landsat value identical: no slope is identifiable from this.
  if (sxx === 0) return null
  const slope = sxy / sxx
  const intercept = my - slope * mx
  const r2 = syy === 0 ? 0 : (sxy * sxy) / (sxx * syy)
  return { slope, intercept, r2, n }
}

/**
 * A fit can be well-determined and still be wrong for this purpose.
 *
 * Two sensors looking at the same canopy a day apart should agree closely, so
 * the honest correction is near-identity. A slope far from 1 is not a
 * discovery about the sensors; it is a sign the pairs contain something else —
 * a crop that actually changed between the two overpasses, a smoke edge, a
 * misregistered boundary. Rejecting it leaves the published default in place,
 * which is the outcome the spec already accepts as adequate.
 */
export const PLAUSIBLE_SLOPE = { min: 0.7, max: 1.3 }
export const PLAUSIBLE_INTERCEPT = 0.15

export function fitIsPlausible(fit: Fit): boolean {
  return (
    fit.slope >= PLAUSIBLE_SLOPE.min &&
    fit.slope <= PLAUSIBLE_SLOPE.max &&
    Math.abs(fit.intercept) <= PLAUSIBLE_INTERCEPT
  )
}

export type HarmonizeResult = {
  pairs: number
  updated: boolean
  rowsTouched: number
  detail: string
}

/**
 * Refresh the Landsat coefficients from this farm's own pairs, then restate
 * every observation on the Sentinel-2 scale.
 *
 * The apply step runs whether or not the coefficients changed: new Landsat
 * observations arrive unharmonized, and it is what puts them on the scale.
 */
export async function runHarmonization(sb: SupabaseClient): Promise<HarmonizeResult> {
  const { data: rows, error } = await sb
    .from('sat_harmonization_pairs')
    .select('s2_ndvi, landsat_ndvi')
  if (error) throw new Error(`reading pairs: ${error.message}`)

  const num = (v: number | string | null): number | null => {
    const n = typeof v === 'string' ? Number(v) : v
    return typeof n === 'number' && Number.isFinite(n) ? n : null
  }
  const pairs: Pair[] = []
  for (const r of (rows ?? []) as { s2_ndvi: number | string | null; landsat_ndvi: number | string | null }[]) {
    const s2 = num(r.s2_ndvi)
    const landsat = num(r.landsat_ndvi)
    if (s2 != null && landsat != null) pairs.push({ s2, landsat })
  }

  let updated = false
  let note = `${pairs.length}/${MIN_PAIRS_FOR_LOCAL} pairs — published default still in use`

  if (pairs.length >= MIN_PAIRS_FOR_LOCAL) {
    const fit = fitHarmonization(pairs)
    if (fit && fitIsPlausible(fit)) {
      const { error: upErr } = await sb
        .from('sat_harmonization')
        .update({
          slope: Number(fit.slope.toFixed(6)),
          intercept: Number(fit.intercept.toFixed(6)),
          n_pairs: fit.n,
          r2: Number(fit.r2.toFixed(4)),
          source: 'local',
          derived_on: new Date().toISOString().slice(0, 10),
          updated_at: new Date().toISOString(),
        })
        .eq('collection', 'landsat-c2-l2')
      if (upErr) throw new Error(`writing coefficients: ${upErr.message}`)
      updated = true
      note = `local fit from ${fit.n} pairs: slope ${fit.slope.toFixed(3)}, intercept ${fit.intercept.toFixed(3)}, r2 ${fit.r2.toFixed(2)}`
    } else if (fit) {
      note = `${pairs.length} pairs but the fit is implausible (slope ${fit.slope.toFixed(2)}, intercept ${fit.intercept.toFixed(2)}) — keeping the default`
    }
  }

  const { data: touched, error: applyErr } = await sb.rpc('sat_apply_harmonization')
  if (applyErr) throw new Error(`applying harmonization: ${applyErr.message}`)

  return {
    pairs: pairs.length,
    updated,
    rowsTouched: (touched as number) ?? 0,
    detail: `harmonization: ${note}`,
  }
}
