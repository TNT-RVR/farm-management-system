import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { midYield } from './yield-zones'

/**
 * Salinity by field, from the topsoil EC on the soil tests.
 *
 * The labs report EC in mS/cm (the same number as dS/m). There are no sample
 * coordinates, so the measurement is a field figure: the mean of its latest
 * report's topsoil samples, with the worst sample beside it — salt comes in
 * patches, and the patch is what hurts beans. Where the field to hand has a
 * productivity zone map, `zoneSalinity` lays that measured spread out across
 * it rather than painting eighty acres one colour.
 *
 * Classes follow the usual crop-tolerance breaks: dry beans lose yield from
 * about 1, wheat and durum from about 4–6, barley and canola hold to 6–8.
 */
/**
 * Pale and cool where there is no salt, dark red where there is.
 *
 * Two things were wrong with the ramp this replaces (Sam, 6 Nov 2026).
 *
 * It ran green to red, and green over a green field is invisible — which is
 * the one colour a salinity map cannot afford to lose, because clean ground is
 * most of the farm. Salt is a hazard, not a balance, so the ramp is now
 * sequential: nothing to see reads as nothing to see and the eye goes to the
 * dark patches. No class is a vegetation colour, so each stands off the
 * imagery underneath.
 *
 * And its lowest break was 1, which put 148 of our 151 topsoil samples in a
 * single colour: the whole farm tests between 0.09 and 1.32, so the map was
 * one flat wash however opaque it was drawn. The top four breaks are still the
 * crop-tolerance thresholds, which is what a number means agronomically; the
 * bottom three split the range our own ground actually occupies, so the map
 * can show which end of the farm is saltier without overstating any of it.
 * Below 1 nothing is losing yield, and the labels say so.
 */
export const SALT_CLASSES = [
  { max: 0.4, label: 'Under 0.4 — clean', colour: '#eff7fa' },
  { max: 0.7, label: '0.4–0.7 — a trace', colour: '#bfe3f0' },
  { max: 1, label: '0.7–1 — still no yield effect', colour: '#fde68a' },
  { max: 2, label: '1–2 — beans and peas feel it', colour: '#f59e0b' },
  { max: 4, label: '2–4 — most crops slowed', colour: '#ea580c' },
  { max: 8, label: '4–8 — only tolerant crops', colour: '#dc2626' },
  { max: Infinity, label: 'Over 8 — severe', colour: '#7f1d1d' },
] as const

export const SALT_NO_DATA = '#9ca3af'

export function saltColour(ec: number | null | undefined): string {
  if (ec == null || !Number.isFinite(ec)) return SALT_NO_DATA
  return SALT_CLASSES.find((c) => ec < c.max)!.colour
}

export type FieldSalt = { ec: number; worst: number; naPct: number | null; year: number; samples: number }

type Row = { ec_ms_cm: number | null; base_na_pct: number | null; depth_top_in: number | null; depth_label: string | null; soil_test_reports: { field_id: string | null; crop_year: number | null; report_date: string | null } | null }

const isTopsoil = (r: Row) => r.depth_top_in === 0 || (r.depth_top_in == null && /^0\b|^0"/.test((r.depth_label ?? '').trim()))

/** Latest report per field that carries a topsoil EC. Pure, for the test. */
export function fieldSalinity(rows: Row[]): Map<string, FieldSalt> {
  const byField = new Map<string, { key: string; year: number; ecs: number[]; nas: number[] }>()
  for (const r of rows) {
    const rep = r.soil_test_reports
    if (!rep?.field_id || r.ec_ms_cm == null || !isTopsoil(r)) continue
    const key = `${rep.crop_year ?? 0}|${rep.report_date ?? ''}`
    const cur = byField.get(rep.field_id)
    if (!cur || key > cur.key) byField.set(rep.field_id, { key, year: rep.crop_year ?? 0, ecs: [Number(r.ec_ms_cm)], nas: r.base_na_pct == null ? [] : [Number(r.base_na_pct)] })
    else if (key === cur.key) {
      cur.ecs.push(Number(r.ec_ms_cm))
      if (r.base_na_pct != null) cur.nas.push(Number(r.base_na_pct))
    }
  }
  const out = new Map<string, FieldSalt>()
  for (const [id, v] of byField) {
    const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length
    out.set(id, { ec: mean(v.ecs), worst: Math.max(...v.ecs), naPct: v.nas.length ? mean(v.nas) : null, year: v.year, samples: v.ecs.length })
  }
  return out
}

/**
 * The field's measured salinity, laid out across its productivity zones.
 *
 * A soil report gives two numbers for a whole field — the mean of its topsoil
 * samples and the worst of them — and no coordinates, so the map had no way to
 * say WHICH eighty acres the worst sample came off. The productivity zones do
 * know: they are drawn off years of yield maps, and on irrigated ground here
 * the ground that keeps yielding below its field's average is very often the
 * ground carrying the salt.
 *
 * So the pattern comes from the zone map and both ends come from the lab:
 *
 *   The acre-weighted mean of the zone figures is exactly the measured mean.
 *   Nothing is added to the field's total salt; it is only distributed.
 *
 *   The poorest zone reads exactly the worst sample on the report. The spread
 *   is the farm's own measured spread, not a modelled one.
 *
 *   A report with one sample has no spread to lay out (worst equals the mean),
 *   so every zone comes back the same. The screens get no invented detail from
 *   a field that was sampled once.
 *
 * It is an estimate of where the measured salt sits, and the screens say so.
 * It is not a measurement of each zone, and a bare patch you can see from the
 * truck beats it.
 */
export function zoneSalinity(
  salt: FieldSalt,
  zones: { id: string; acres: number | null; min_yield: number | null; max_yield: number | null }[],
): Map<string, number> {
  const out = new Map<string, number>()
  if (!zones.length) return out

  const idx = (z: (typeof zones)[number]) => {
    const mid = midYield(z)
    return mid != null && Number.isFinite(mid) ? mid : null
  }
  const rated = zones.filter((z) => idx(z) != null)
  // No index on any zone, or a report with a single sample: one figure for the
  // field, which is what we actually know.
  if (!rated.length || !(salt.worst > salt.ec) || !(salt.ec > 0)) {
    for (const z of zones) out.set(z.id, salt.ec)
    return out
  }

  // Acres where we have them, equal weight where we do not — the index is
  // already normalised per acre, so the weighted centre lands near 100 either
  // way, and subtracting it keeps the measured mean exact regardless.
  const totalAcres = rated.reduce((s, z) => s + (z.acres ?? 0), 0)
  const weight = (z: (typeof zones)[number]) => (totalAcres > 0 ? (z.acres ?? 0) : 1)
  const totalWeight = rated.reduce((s, z) => s + weight(z), 0)
  const centre = rated.reduce((s, z) => s + weight(z) * idx(z)!, 0) / totalWeight

  // How far below its field's own average each zone runs. Positive is poorer.
  const below = (z: (typeof zones)[number]) => centre - idx(z)!
  const worstBelow = Math.max(...rated.map(below))
  // Every zone at or above the centre: nothing to lean the salt towards.
  if (!(worstBelow > 0)) {
    for (const z of zones) out.set(z.id, salt.ec)
    return out
  }

  // Spread multiplicatively, not in equal steps per index point.
  //
  // A straight ramp cannot do this: a field averaging 2 with a worst sample of
  // 6 would need its best zone to come out at minus 2, and clamping that at
  // zero quietly adds salt the lab never found. Salt is not laid out evenly
  // anyway — it concentrates in the low spots where water sits and evaporates,
  // which is why a field's worst sample is so often several times its mean. So
  // the figures are a geometric spread: scale k is solved for so the poorest
  // zone lands on the worst sample, then everything is rescaled so the
  // acre-weighted mean is the measured mean. Both ends stay exact, nothing can
  // go negative, and the good ground reads as the near-nothing it is.
  const ds = rated.map(below)
  const ws = rated.map(weight)
  const spread = (k: number) => {
    const f = ds.map((d) => Math.exp(k * d))
    const mean = f.reduce((s, x, i) => s + ws[i] * x, 0) / totalWeight
    return { f, ratio: Math.max(...f) / mean, mean }
  }
  // Monotonic in k, from 1 at k=0. Bisect rather than solve: five zones and a
  // closed form that does not exist. The cap is the ceiling of what a geometric
  // spread can express — past it the ratio approaches total acres over the
  // poorest zone's acres, so an extreme worst sample lands a little short of
  // itself rather than taking the whole field with it.
  const target = salt.worst / salt.ec
  let lo = 0
  let hi = 0.5
  if (spread(hi).ratio > target) {
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2
      if (spread(mid).ratio < target) lo = mid
      else hi = mid
    }
  } else {
    lo = hi
  }
  const k = (lo + hi) / 2
  const { f, mean } = spread(k)
  const byZone = new Map(rated.map((z, i) => [z.id, (salt.ec * f[i]) / mean]))
  for (const z of zones) out.set(z.id, byZone.get(z.id) ?? salt.ec)
  return out
}

export function useFieldSalinity(enabled = true) {
  return useQuery({
    queryKey: ['field-salinity'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('soil_test_samples')
        .select('ec_ms_cm, base_na_pct, depth_top_in, depth_label, soil_test_reports(field_id, crop_year, report_date)')
        .not('ec_ms_cm', 'is', null)
      if (error) throw error
      // Rows, not the Map: the persisted cache cannot hold a Map.
      return (data ?? []) as unknown as Row[]
    },
    staleTime: 3_600_000,
  })
}
