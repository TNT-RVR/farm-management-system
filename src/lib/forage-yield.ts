import type { Database } from './database.types'
import { fieldForage, rowsFor, type FieldForage, type FieldWindow, type PastureFieldRow, type SprayHold } from './field-residue'

// The grazing calculator's arithmetic, with no Supabase client attached, so the
// pasture move-out check on the server reads forage exactly the way the Grazing
// tab does. grazing.ts re-exports all of it; nothing outside imports this file
// except code that runs where the browser client cannot.

export type PastureRow = Database['public']['Tables']['grazing_pastures']['Row']

// ---- constants (from the spreadsheet) ----
export const ACRES_PER_HECTARE = 2.47105
export const AU_LBS_PER_DAY = 26 // 1 Animal Unit eats 26 lbs of feed/day
export const AUM_LBS = AU_LBS_PER_DAY * 30 // 780 lbs = one Animal Unit Month
/**
 * Pounds of grazeable forage read as animal-unit days: the only figure that
 * says how long feed lasts. An acre count does not — 74 acres of corn stubble
 * and 74 acres of canola stubble are not the same feed.
 */
export const audsFromLb = (lb: number) => lb / AU_LBS_PER_DAY
export const GRASS_QUALITIES = ['Excellent', 'Good', 'Fair', 'Poor'] as const
export type GrassQuality = (typeof GRASS_QUALITIES)[number]

/**
 * Forage Yield Estimator — lbs/acre by precipitation zone × grass quality.
 *
 * Alberta Forage Manual (2nd ed.) p.205, Table 36, the lb/ac column, adapted
 * from Wroe et al., Guide to Range Condition and Stocking Rates for Alberta
 * Grasslands, 1988. Every cell here was read back off that page on 11 Nov 2026.
 *
 * The rows are the table's own "**Annual** Precipitation Zones mm (inches)" —
 * long-term annual precipitation, which classifies a site the way a soil zone
 * does. They are not a rain gauge reading, and not a growing-season total. The
 * manual's worked examples make it plain: it picks 300 mm for the Brown soil
 * climatic zone and 400 mm for the Black, straight off the soil map.
 *
 * The app feeds this measured April–October rainfall (grazingRain), which is a
 * different quantity. For Home Ranch the 10-year growing-season normal is
 * 270 mm and the 10-year annual normal is 382 mm — one row apart, and 414 vs
 * 690 lb/ac on Good grass. Which of the two belongs here is Sam's call and
 * is not settled; nothing was changed on the strength of it.
 */
export const FORAGE_YIELD_ESTIMATOR: {
  label: string
  lo: number
  hi: number
  yields: Record<GrassQuality, number>
}[] = [
  { label: '250–350 mm', lo: 250, hi: 350, yields: { Excellent: 700, Good: 460, Fair: 370, Poor: 230 } },
  { label: '350–450 mm', lo: 350, hi: 450, yields: { Excellent: 1150, Good: 740, Fair: 550, Poor: 370 } },
  { label: '450–550 mm', lo: 450, hi: 550, yields: { Excellent: 1850, Good: 1300, Fair: 1000, Poor: 650 } },
  { label: '550–650 mm', lo: 550, hi: 650, yields: { Excellent: 3000, Good: 2000, Fair: 1500, Poor: 1000 } },
]
/**
 * Irrigated grass, lbs/acre by quality: the estimator's own Irrigation row,
 * which rain does not set.
 *
 * Table 36 gives each cell twice, kg/ha then lb/ac in brackets: 7,730 (6,900) ·
 * 5,150 (4,600) · 3,920 (3,500) · 2,580 (2,300). Good had been entered as
 * 5,150 — the kg/ha number in the lb/ac slot, overstating irrigated Good grass
 * by 12 %. Corrected to 4,600 against the page on 11 Nov 2026.
 */
export const FORAGE_YIELD_IRRIGATION: Record<GrassQuality, number> = {
  Excellent: 6900,
  Good: 4600,
  Fair: 3500,
  Poor: 2300,
}

const qualityOf = (quality: string) => (GRASS_QUALITIES.includes(quality as GrassQuality) ? quality : 'Fair') as GrassQuality

/**
 * lbs/acre for the given precipitation figure + grass quality.
 *
 * Each band's yield is read as the yield at the band's MIDDLE (300, 400, 500,
 * 600 mm) and the line is drawn straight between middles, so 349 mm and 351 mm
 * no longer differ by half — the old lookup was a staircase that jumped at
 * every band edge. Above the top middle it holds at the top band's figure (no
 * band says more rain keeps paying). Below the lowest middle the yield falls in
 * proportion to the rain, to nothing at no rain: the estimator has no band
 * under 250 mm, and holding the 250–350 figure there made a drought year read
 * as an ordinary dry one.
 */
export function forageYieldPerAcre(precipMm: number, quality: string): number {
  const q = qualityOf(quality)
  const pts = FORAGE_YIELD_ESTIMATOR.map((b) => ({ x: (b.lo + b.hi) / 2, y: b.yields[q] }))
  const mm = Number.isFinite(precipMm) ? precipMm : 0
  if (mm <= pts[0].x) return Math.max(0, (pts[0].y * mm) / pts[0].x)
  for (let i = 1; i < pts.length; i++) {
    if (mm <= pts[i].x) return pts[i - 1].y + ((pts[i].y - pts[i - 1].y) * (mm - pts[i - 1].x)) / (pts[i].x - pts[i - 1].x)
  }
  return pts[pts.length - 1].y
}

/** lbs/acre on irrigated grass of this quality. */
export const irrigatedYieldPerAcre = (quality: string) => FORAGE_YIELD_IRRIGATION[qualityOf(quality)]

export type PrecipZone = {
  /** Band floor, mm. */
  lo: number
  /** Band ceiling, mm; null for the open band above the table. */
  hi: number | null
  /** The estimator's own row label, or how the open bands read. */
  label: string
  /** True for a row the estimator actually has yields for. */
  inTable: boolean
}

/**
 * The estimator's precipitation rows as bands to shade behind the rain graph,
 * driest first, plus the open bands below and above the table.
 *
 * Derived from FORAGE_YIELD_ESTIMATOR rather than written out again, so the
 * chart can never drift from the table the calculator reads.
 *
 * These are precipitation bands and nothing else — the table's own annual
 * precipitation zones. Poor/Fair/Good/Excellent are the estimator's COLUMNS —
 * each pasture's own grass quality, which changes over years of grazing
 * management, not with the weather. The graph used to label
 * 250 mm "Fair" and 350 mm "Good", which took the table's rows and dressed them
 * in its columns' names, and so told you rain promotes a pasture. It does not: a
 * dry year on good grass still grows more than a wet year on poor grass (370 vs
 * 230 lb/ac in the lowest row). Sam caught it on 11 Nov 2026.
 *
 * `under 250 mm` is not a row. The estimator has no band below its lowest, and
 * forageYieldPerAcre deliberately ramps straight down to nothing there, so it is
 * marked out as off the bottom of the table rather than drawn as a peer.
 */
export function precipZones(maxMm: number): PrecipZone[] {
  const rows = FORAGE_YIELD_ESTIMATOR
  const floor = rows[0].lo
  const top = rows[rows.length - 1].hi
  const zones: PrecipZone[] = [{ lo: 0, hi: floor, label: `under ${floor} mm`, inTable: false }]
  for (const r of rows) zones.push({ lo: r.lo, hi: r.hi, label: r.label, inTable: true })
  zones.push({ lo: top, hi: null, label: `over ${top} mm`, inTable: false })
  return zones.filter((z) => z.lo < maxMm)
}

/** The mm the estimator's rows change at: every row edge, driest first. */
export const precipZoneEdges = (): number[] => [
  ...FORAGE_YIELD_ESTIMATOR.map((r) => r.lo),
  FORAGE_YIELD_ESTIMATOR[FORAGE_YIELD_ESTIMATOR.length - 1].hi,
]

export type PastureCalc = PastureRow & {
  hectares: number
  acres: number
  nativeGrassAc: number
  totalGrazeableAc: number
  /** Dryland (native) grass, lbs/acre at this rain. */
  foragePerAcre: number
  /** Irrigated grass, lbs/acre. */
  irrigatedForagePerAcre: number
  /** Average over all the grazeable acres, after utilisation. */
  foragePerAcreUtil: number
  /**
   * What this season's own growth did to the dryland yield: 1 when the rain
   * figure is carrying the year on its own, otherwise the measured ratio from
   * pasture_season_factor.
   */
  seasonFactor: number
  totalLbs: number
  aums: number
  auds: number
  /**
   * True when the pasture's crop fields come from the farming side (the
   * pasture_field_crops view); false when the hand-typed irrigated acres are
   * used, which is only for a pasture with no field mapped inside it.
   */
  fieldsLinked: boolean
  /** Each crop field inside the fence and what it gives for the dates. */
  fields: FieldForage[]
  /** Acres of crop fields inside the fence (taken out of the native grass). */
  fieldAc: number
  /** Native grass, lb after utilisation. */
  nativeLbs: number
  /** Crop fields (stubble, forage, or the hand-typed irrigated grass), lb. */
  fieldLbs: number
  /** Native grass as animal-unit days. */
  nativeAuds: number
  /**
   * The crop fields inside the fence as animal-unit days — the hand-typed
   * irrigated acres where no field is mapped. With nativeAuds it adds to auds.
   */
  fieldAuds: number
  /** The dates the field forage is counted for, when linked. */
  window: FieldWindow | null
}

/**
 * The farming side's fields for one pasture, and the dates being planned.
 *
 * `fields` are the pasture_field_crops rows for THIS pasture (any crop year;
 * the window's year is used). `spray` gives a field's latest-lifting
 * no-grazing restriction. Without a context the hand-typed irrigated acres are
 * used, as before.
 */
export type PastureFieldContext = {
  fields: PastureFieldRow[]
  window: FieldWindow
  spray?: (fieldId: string) => SprayHold | null
}

/** Just the two rainfall figures from grazingRain that costing a season needs. */
export type SeasonRain = { forecastMm: number; projectedMm: number | null }

/**
 * Cost a season's grass the one way, so every screen says the same number.
 *
 * Two sources of "how did this year go", and the rule for choosing between
 * them lives here rather than in four screens:
 *
 *   - A paddock the satellite has watched grow, with no cattle on it this
 *     year, is costed on the NORMAL season's rain times its own measured
 *     growth. The factor already is this year; multiplying it by a wet year's
 *     rainfall as well would count the same weather twice.
 *   - Everything else is costed on this year's projected rain — the rain so
 *     far plus a normal rest of season. That is what a grazed paddock has to
 *     use, because cattle eat the green and a used paddock looks like a poor
 *     one from orbit.
 *
 * Pass `factors` as NULL to cost a past season, or any season this has no
 * measurement for: then it is rainfall throughout, as it always was.
 */
export function computePastures(
  pastures: PastureRow[],
  rain: SeasonRain,
  utilization: number,
  ctx?: PastureFieldContext | null,
  factors?: Map<string, number> | null,
): PastureCalc[] {
  const live = rain.projectedMm ?? rain.forecastMm
  return pastures.map((p) => {
    const f = factors?.get(p.id)
    return f == null
      ? computePasture(p, live, utilization, ctx)
      : computePasture(p, rain.forecastMm, utilization, ctx, f)
  })
}

/**
 * Expand a pasture's stored inputs into all the derived columns (mirrors the sheet).
 *
 * With the pasture's crop fields (ctx), the native grass is the pasture less
 * its waste acres and the fields' acres, and each field adds what it gives for
 * the dates (field-residue.ts): nothing while a crop grows, its stubble after
 * harvest, nothing once it is worked. Without any mapped field the old
 * hand-typed irrigated acres are used, labelled as such (fieldsLinked false).
 *
 * `seasonFactor` is how this season has actually gone on THIS paddock, from
 * the satellite: its peak canopy cover so far against its own cover over the
 * same calendar window in earlier years (pasture_season_factor). Pass it and
 * `precipMm` should be the NORMAL season's rain, because the factor is already
 * this year's deviation and multiplying a wet-year rainfall figure by a
 * wet-year growth measurement counts the same weather twice. Leave it out and
 * `precipMm` carries the year on its own, which is what a grazed paddock has
 * to do — cattle eat the green, so a grazed paddock looks thin from orbit
 * whether it grew badly or grew well and got used.
 *
 * It scales the dryland grass only. Irrigated grass does not grow on rain, and
 * the crop fields have their own residue model with its own loss factors.
 */
export function computePasture(
  p: PastureRow,
  precipMm: number,
  utilization: number,
  ctx?: PastureFieldContext | null,
  seasonFactor?: number | null,
): PastureCalc {
  const hectares = p.km2 * 100
  const acres = hectares * ACRES_PER_HECTARE
  const factor = seasonFactor != null && Number.isFinite(seasonFactor) && seasonFactor > 0 ? seasonFactor : 1
  const foragePerAcre = forageYieldPerAcre(precipMm, p.grass_quality) * factor
  // Irrigated grass grows to the irrigated yield, not the dryland rain band.
  const irrigatedForagePerAcre = irrigatedYieldPerAcre(p.grass_quality)
  const year = ctx ? Number(ctx.window.from.slice(0, 4)) : null
  const anyMapped = Boolean(ctx?.fields.some((r) => r.grazing_pasture_id === p.id))

  let nativeGrassAc: number
  let fieldAc: number
  let fields: FieldForage[] = []
  let fieldLbs: number
  let fieldGrazeAc: number
  if (ctx && anyMapped) {
    const mine = rowsFor(ctx.fields, p.id, year!)
    // A field counts its acres once however many crops are split on it.
    const byField = new Map<string, number>()
    for (const r of ctx.fields) if (r.grazing_pasture_id === p.id) byField.set(r.field_id, Number(r.acres_in) || 0)
    fieldAc = [...byField.values()].reduce((a, b) => a + b, 0)
    nativeGrassAc = Math.max(0, acres - (p.non_grazeable_ac + fieldAc))
    fields = mine.map((r) => fieldForage(r, ctx.window, { irrigatedLbAc: irrigatedForagePerAcre, utilization, spray: ctx.spray?.(r.field_id) ?? null }))
    // A field with no row for this year (no plan) still shows, as nothing.
    for (const [fid] of byField) {
      if (fields.some((f) => f.fieldId === fid)) continue
      const any = ctx.fields.find((r) => r.grazing_pasture_id === p.id && r.field_id === fid)!
      fields.push(fieldForage({ ...any, crop_year: year!, crop_name: null, crop_share: 1 }, ctx.window, { irrigatedLbAc: irrigatedForagePerAcre, utilization }))
    }
    fields.sort((a, b) => a.fieldName.localeCompare(b.fieldName, 'en-CA', { numeric: true }))
    fieldLbs = fields.reduce((a, f) => a + f.lb, 0)
    fieldGrazeAc = fields.filter((f) => f.lb > 0).reduce((a, f) => a + f.acres, 0)
  } else {
    // Manual fallback, typed by hand: no field is mapped inside this pasture.
    // Never negative: a paddock typed with more irrigated and waste acres than
    // it has would otherwise subtract grass from its own irrigated acres.
    nativeGrassAc = Math.max(0, acres - (p.non_grazeable_ac + p.irrigated_ac))
    fieldAc = p.irrigated_ac
    fieldGrazeAc = Math.max(0, p.grazeable_irrigated_ac)
    fieldLbs = fieldGrazeAc * irrigatedForagePerAcre * utilization
  }
  const nativeLbs = nativeGrassAc * foragePerAcre * utilization
  const totalLbs = nativeLbs + fieldLbs
  const totalGrazeableAc = fieldGrazeAc + nativeGrassAc
  const foragePerAcreUtil = totalGrazeableAc > 0 ? totalLbs / totalGrazeableAc : foragePerAcre * utilization
  return {
    ...p,
    hectares,
    acres,
    nativeGrassAc,
    totalGrazeableAc,
    foragePerAcre,
    irrigatedForagePerAcre,
    foragePerAcreUtil,
    seasonFactor: factor,
    totalLbs,
    aums: totalLbs / AUM_LBS,
    auds: totalLbs / AU_LBS_PER_DAY,
    fieldsLinked: Boolean(ctx && anyMapped),
    fields,
    fieldAc,
    nativeLbs,
    fieldLbs,
    nativeAuds: audsFromLb(nativeLbs),
    fieldAuds: audsFromLb(fieldLbs),
    window: ctx && anyMapped ? ctx.window : null,
  }
}
