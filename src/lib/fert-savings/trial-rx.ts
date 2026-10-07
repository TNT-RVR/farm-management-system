import type { Geometry, MultiPolygon, Polygon } from 'geojson'
import type { Json } from '@/lib/database.types'
import { prescriptionZip } from '@/lib/geo/shp-write'

/**
 * An on-farm N-rate trial's prescription: its strips as a zipped shapefile
 * Operations Center loads, one polygon a strip with its rate. Made from the
 * trial on the Savings tab and from the Reports page, the same file both ways.
 */

/** One strip as the n_trial_strips function lays it out. */
export type TrialStrip = { strip: number; rep: number; rate: number; geojson: Json; acres: number; heading: number }

/** Urea is 46-0-0: pounds of product for a pound of N. */
export const UREA_N = 0.46

/** Longitude/latitude rings of a GeoJSON polygon or multipolygon. */
export function ringsOf(g: Geometry | null | undefined): number[][][][] {
  if (!g) return []
  if (g.type === 'Polygon') return [(g as Polygon).coordinates]
  if (g.type === 'MultiPolygon') return (g as MultiPolygon).coordinates
  return []
}

/** The file's name, without .zip: what the person sees in Operations Center's import list. */
export const trialRxName = (fieldName: string | null | undefined, cropYear: number) => `${fieldName || 'field'} N trial ${cropYear}`

/** The zip: STRIP, REP, N_LB_AC and UREA_LB on every strip's polygon. */
export function trialPrescriptionZip(fieldName: string | null | undefined, cropYear: number, strips: TrialStrip[]): Uint8Array {
  const polys = strips.flatMap((s) =>
    ringsOf(s.geojson as unknown as Geometry).map((rings) => ({
      rings,
      props: { STRIP: s.strip, REP: s.rep, N_LB_AC: Number(s.rate), UREA_LB: Math.round(Number(s.rate) / UREA_N) },
    })),
  )
  return prescriptionZip(trialRxName(fieldName, cropYear), polys, [
    { name: 'STRIP', type: 'N', length: 4 },
    { name: 'REP', type: 'N', length: 3 },
    { name: 'N_LB_AC', type: 'N', length: 8, decimals: 1 },
    { name: 'UREA_LB', type: 'N', length: 8 },
  ])
}
