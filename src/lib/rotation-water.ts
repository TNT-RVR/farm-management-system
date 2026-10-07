import { allottedInchesFor, smridAllotmentFor, type YearAllotment } from './water-allocation'
import { farmDistrict } from './farm-context'

/**
 * The irrigation water a year's plan has to live inside, pooled the way it
 * can actually be moved:
 *
 *   smrid        every SMRID parcel shares the district allotment × its acres
 *                (smrid.com's current figure; a pivot's own override wins)
 *   licence:<id> the pivots on one licence share its volume (acre-feet)
 *
 * A pivot with neither is not limited: it is listed as having no water
 * right on file, so the gap shows instead of a false cap.
 */

export type WaterPivot = {
  field_id: string
  acres_irrigated: number | string | null
  alloted_inches: number | string | null
  smrid_area: number | string | null
  water_licence_id: string | null
  water_source?: string | null
}
export type WaterLicence = { id: string; licence_number: string | null; volume: number | string | null }

export type WaterSource = { key: string; label: string; acreInches: number; acres: number; basis: string }

export function waterBudget(
  pivots: WaterPivot[],
  licences: WaterLicence[],
  allotments: YearAllotment[],
  year: number,
  fieldAcres: Map<string, number>,
  /** A what-if SMRID allotment (inches), e.g. a dry year; null = the year's own. */
  smridOverride: number | null = null,
): {
  byField: Map<string, { source: string; irrigatedAcres: number }>
  sources: WaterSource[]
  smridInches: number | null
  smridSetFor: number | null
  /** Irrigated fields with no SMRID parcel or licence on file. */
  noRight: string[]
} {
  const byField = new Map<string, { source: string; irrigatedAcres: number }>()
  const smrid = smridAllotmentFor(allotments, year)
  const smridInches = smridOverride ?? smrid.inches
  const pools = new Map<string, WaterSource>()
  const noRight: string[] = []
  const add = (key: string, label: string, acres: number, acreInches: number, basis: string) => {
    const p = pools.get(key) ?? { key, label, acreInches: 0, acres: 0, basis }
    p.acres += acres
    p.acreInches += acreInches
    pools.set(key, p)
  }
  for (const p of pivots) {
    const acres = p.acres_irrigated != null ? Number(p.acres_irrigated) : (fieldAcres.get(p.field_id) ?? 0)
    if (!(acres > 0)) continue
    if (p.smrid_area != null || p.water_source === 'smrid') {
      byField.set(p.field_id, { source: 'smrid', irrigatedAcres: acres })
      // smrid.com's figure (or the what-if), unless the pivot has its own override.
      const inches = allottedInchesFor({ alloted_inches: p.alloted_inches, smrid_area: p.smrid_area, water_source: p.water_source ?? null }, smridInches).inches
      add('smrid', farmDistrict(), acres, inches != null ? acres * inches : 0,
        smridOverride != null ? `${smridOverride}" what-if` : smrid.setFor === year ? `${smridInches}" set for ${year}` : smridInches != null ? `${smridInches}" (${smrid.setFor}'s, until ${year}'s is set)` : 'no allotment on file')
    } else if (p.water_licence_id) {
      const lic = licences.find((l) => l.id === p.water_licence_id)
      const key = `licence:${p.water_licence_id}`
      byField.set(p.field_id, { source: key, irrigatedAcres: acres })
      if (!pools.has(key)) {
        const af = lic?.volume != null ? Number(lic.volume) : 0
        pools.set(key, { key, label: `Licence ${lic?.licence_number ?? ''}`.trim(), acreInches: af * 12, acres: 0, basis: lic?.volume != null ? `${af} acre-feet` : 'volume not on file — not limited' })
      }
      pools.get(key)!.acres += acres
    } else if (p.acres_irrigated != null && Number(p.acres_irrigated) > 0) {
      // Irrigated acres entered but no water right: a gap to show. A pivot
      // row with nothing in it is a dryland field, not a gap.
      noRight.push(p.field_id)
    }
  }
  return { byField, sources: [...pools.values()], smridInches, smridSetFor: smrid.setFor, noRight }
}
