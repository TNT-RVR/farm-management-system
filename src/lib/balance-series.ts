import { cropColour } from './crop-colour'
import type { WaterBalanceRow } from '@/lib/irrigation'

/** One drawn line on the balance graph: a whole field, or one crop zone in it. */
export type BalanceSeries = {
  key: string
  label: string
  color: string
  rows: WaterBalanceRow[]
}

/** Fallback line colours for zones whose crop has no colour set. */
export const ZONE_COLORS = ['#0f172a', '#0284c7', '#7c3aed', '#c2410c', '#0f766e']

/**
 * Split a field's daily balance into one series per crop zone.
 *
 * A zoned field stores one balance row per zone per day, so the flat query
 * result has repeated dates. Handing that to a chart draws each zone back over
 * the last and quietly shows only whichever sorted last — the whole reason this
 * grouping exists rather than passing rows straight through.
 *
 * An unzoned field returns exactly one series, so nothing about the single-crop
 * case changes.
 */
export function groupBalanceByZone(
  rows: WaterBalanceRow[],
  zones: { id: string; crop_id: string }[],
  crops: { id: string; name: string; color?: string | null }[],
): BalanceSeries[] {
  if (!rows.length) return []

  // '' stands for "no zone". Insertion order follows the query, which is
  // ordered by zone, so colours stay stable between renders.
  const zoneIds = [...new Set(rows.map((r) => r.zone_id ?? ''))]
  if (zoneIds.length <= 1) {
    return [{ key: 'field', label: 'Available Soil Moisture', color: ZONE_COLORS[0], rows }]
  }

  const zoneById = new Map(zones.map((z) => [z.id, z]))
  const cropById = new Map(crops.map((c) => [c.id, c]))
  return zoneIds.map((zid, i) => {
    const zone = zid ? zoneById.get(zid) : null
    const crop = zone ? cropById.get(zone.crop_id) : null
    return {
      key: zid || 'field',
      // A zone whose crop row is missing still gets a line — an unlabelled
      // series is recoverable, a silently dropped one is not.
      label: crop?.name ?? (zid ? 'Zone' : 'Rest of field'),
      // A crop the user has coloured wins; without one, the crop still gets a
      // stable colour of its own rather than a position in this chart's list.
      color: crop ? cropColour(crop) : ZONE_COLORS[i % ZONE_COLORS.length],
      rows: rows.filter((r) => (r.zone_id ?? '') === zid),
    }
  })
}
