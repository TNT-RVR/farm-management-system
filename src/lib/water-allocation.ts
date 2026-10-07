/**
 * Water used against water allotted, per pivot, with a projection to the end
 * of the season.
 *
 * Two allotments are on file: inches per acre for the SMRID canal pivots —
 * whatever smrid.com currently says, read daily into water_allotments — and
 * a licence share in acre-feet for the river pivots. Each is judged where it
 * is filled in; neither is guessed. A pivot's own "allotment override" on
 * Pivot Information beats the website figure, and is labelled as such.
 * Used is the gross depth FieldNET logged — what came out of the canal or the
 * river, not what the crop kept.
 */

export type PivotAllotment = {
  fieldId: string
  name: string
  acres: number | null
  allottedInches: number | null
  /** Where allottedInches came from: SMRID's website figure, or this pivot's override. */
  allottedFrom: 'smrid' | 'override' | null
  licenceAcreFeet: number | null
  source: string
}

/**
 * A field's share of its licence, acre-feet. Until 29 Sep 2026 the column
 * held the licence duty in inches (15, 14.2, 10.5) and was read that way; it
 * now holds the acre-feet share (equal depth over the licence's pivots unless
 * set by hand), so the figure is taken as it stands. readAsInches stays in the
 * shape for the page, always null.
 */
export function licenceVolume(value: number | null): { acreFeet: number | null; readAsInches: number | null } {
  if (value == null || !(value > 0)) return { acreFeet: null, readAsInches: null }
  return { acreFeet: value, readAsInches: null }
}

export type AllocationRow = PivotAllotment & {
  usedInches: number
  usedAcreFeet: number | null
  /** Inches a day over the last fortnight. */
  recentRate: number
  projectedInches: number
  inchesPct: number | null
  licencePct: number | null
  projectedLicencePct: number | null
  verdict: 'over' | 'will_run_out' | 'close' | 'ok' | 'unknown'
  /** The licence figure on file when it was read as inches per acre. */
  licenceInches: number | null
}

export function allocationRow(
  p: PivotAllotment,
  events: { date: string; gross_mm: number | null; net_mm: number | null }[],
  today: string,
  seasonEnd: string,
): AllocationRow {
  const mm = events.reduce((a, e) => a + Number(e.gross_mm ?? e.net_mm ?? 0), 0)
  const usedInches = mm / 25.4
  const since = new Date(`${today}T12:00:00Z`)
  since.setUTCDate(since.getUTCDate() - 14)
  const recentMm = events.filter((e) => e.date > since.toISOString().slice(0, 10)).reduce((a, e) => a + Number(e.gross_mm ?? e.net_mm ?? 0), 0)
  const recentRate = recentMm / 25.4 / 14
  const daysLeft = Math.max(0, Math.round((Date.parse(`${seasonEnd}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000))
  const projectedInches = usedInches + recentRate * daysLeft
  const usedAcreFeet = p.acres ? (usedInches * p.acres) / 12 : null
  const lic = licenceVolume(p.licenceAcreFeet)
  const inchesPct = p.allottedInches ? (usedInches / p.allottedInches) * 100 : null
  const licencePct = lic.acreFeet && usedAcreFeet != null ? (usedAcreFeet / lic.acreFeet) * 100 : null
  const projectedLicencePct = lic.acreFeet && p.acres ? ((projectedInches * p.acres) / 12 / lic.acreFeet) * 100 : null
  // Where a licence is on file it is the limit that binds; an inches
  // allotment beside it is shown but not judged.
  const judgeInches = licencePct == null
  const worstNow = Math.max(judgeInches ? (inchesPct ?? -1) : -1, licencePct ?? -1)
  const worstProjected = Math.max(judgeInches && p.allottedInches ? (projectedInches / p.allottedInches) * 100 : -1, projectedLicencePct ?? -1)
  const verdict: AllocationRow['verdict'] =
    worstNow < 0 ? 'unknown' : worstNow >= 100 ? 'over' : worstProjected >= 100 ? 'will_run_out' : worstNow >= 85 ? 'close' : 'ok'
  return { ...p, licenceAcreFeet: lic.acreFeet, licenceInches: lic.readAsInches, usedInches, usedAcreFeet, recentRate, projectedInches, inchesPct, licencePct, projectedLicencePct, verdict }
}

/** A field_pivots row as the allocation reads it. */
export type PivotRow = {
  field_id: string
  acres_irrigated: number | string | null
  alloted_inches: number | string | null
  acre_feet_allotment: number | string | null
  on_river: boolean | null
  smrid_area: string | number | null
  water_licence_id: string | null
  water_source?: string | null
  fields: { name: string } | null
}

export type YearAllotment = { year: number; inches: number; contract_inches: number | null }

/**
 * SMRID's allotment for a year: that year's figure where it has been set,
 * otherwise the latest year before it (and the caller is told it is a carry).
 */
export function smridAllotmentFor(rows: YearAllotment[], year: number): { inches: number | null; contract: number | null; setFor: number | null } {
  const exact = rows.find((r) => r.year === year)
  const prior = [...rows].filter((r) => r.year < year).sort((a, b) => b.year - a.year)[0]
  const hit = exact ?? prior
  return { inches: hit ? Number(hit.inches) : null, contract: hit?.contract_inches == null ? null : Number(hit.contract_inches), setFor: hit?.year ?? null }
}

/**
 * The inches a pivot is allowed: its own override where one is set
 * (field_pivots.alloted_inches — blank on every pivot since the 8 in
 * placeholders were cleared), else SMRID's current allotment for a canal
 * pivot, else none.
 */
export function allottedInchesFor(p: Pick<PivotRow, 'alloted_inches' | 'smrid_area' | 'water_source'>, smridInches: number | null): { inches: number | null; from: 'smrid' | 'override' | null } {
  const override = p.alloted_inches == null || p.alloted_inches === '' ? null : Number(p.alloted_inches)
  if (override != null && Number.isFinite(override) && override > 0) return { inches: override, from: 'override' }
  const onSmrid = p.smrid_area != null || p.water_source === 'smrid'
  return onSmrid && smridInches != null ? { inches: smridInches, from: 'smrid' } : { inches: null, from: null }
}

/**
 * The allotment a pivot is judged on. A SMRID pivot gets the district's
 * allotment for the year, which SMRID sets for everybody and the app reads
 * off smrid.com — unless the pivot carries an override.
 */
export function pivotAllotment(p: PivotRow, smridInches: number | null, district = 'SMRID'): PivotAllotment {
  const onSmrid = p.smrid_area != null || p.water_source === 'smrid'
  const allot = allottedInchesFor(p, smridInches)
  return {
    fieldId: p.field_id,
    name: p.fields?.name ?? 'Pivot',
    acres: p.acres_irrigated == null ? null : Number(p.acres_irrigated),
    allottedInches: allot.inches,
    allottedFrom: allot.from,
    licenceAcreFeet: p.acre_feet_allotment == null ? null : Number(p.acre_feet_allotment),
    source: onSmrid
      ? `${district} canal${p.smrid_area != null ? ` (area ${p.smrid_area})` : ''}`
      : p.water_source === 'oldman_river'
        ? 'Oldman River licence'
        : p.water_source === 'south_saskatchewan_river'
          ? 'South Sask. River licence'
          : p.on_river || p.water_licence_id
            ? 'River licence'
            : 'not set',
  }
}
