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
 * The app fed this measured April–October rainfall until 12 Nov 2026, which is
 * a different quantity: at Home Ranch the 10-year growing-season normal is
 * 270 mm against a 382 mm annual normal — one row apart, 414 against 690 lb/ac
 * on Good grass. It now gets the annual figure, and how this season is going
 * scales the row rather than moving to another one. See computePastures.
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

/** The rainfall figures from grazingRain that costing a season needs. */
export type SeasonRain = {
  /** The 10-year average season total, or the typed figure. */
  forecastMm: number
  /** This year so far plus a normal rest of season. */
  projectedMm: number | null
  /**
   * The precipitation zone: the long-term ANNUAL average here, which is what
   * the estimator's rows measure. Falls back to the season figures when the
   * archive gave none.
   */
  zoneMm?: number | null
  /** This season against its own normal, scaling the zone's yield. */
  rainFactor?: number | null
}

/**
 * Cost a season's grass the one way, so every screen says the same number.
 *
 * The ZONE picks the row and never moves: it is the long-term annual average
 * here, which is what the estimator's rows measure (see FORAGE_YIELD_ESTIMATOR
 * and annualNormalMm). Rain does not promote a pasture to a wetter zone — the
 * zone is where you ranch. What this year's weather does is scale what that
 * row yields, and there are two measurements of it, so the rule for choosing
 * lives here rather than in four screens:
 *
 *   - A paddock the satellite has watched grow, with no cattle on it this
 *     year, uses its own measured growth. That is this season, seen directly.
 *   - Everything else uses the rainfall ratio: the projected season against a
 *     normal one. A grazed paddock has to, because cattle eat the green and a
 *     used paddock looks like a poor one from orbit.
 *
 * Never both: they measure the same weather, and multiplying them would count
 * it twice. Sam settled the zone-plus-ratio rule on 12 Nov 2026, after the
 * estimator's rows turned out to be annual.
 *
 * Pass `factors` as NULL to cost a past season, or any season this has no
 * measurement for: then it is the rainfall ratio throughout.
 */
export function computePastures(
  pastures: PastureRow[],
  rain: SeasonRain,
  utilization: number,
  ctx?: PastureFieldContext | null,
  factors?: Map<string, number> | null,
): PastureCalc[] {
  // No archive, no zone: fall back to the season figures, as it read before.
  const zone = rain.zoneMm ?? rain.projectedMm ?? rain.forecastMm
  const fromRain = rain.rainFactor ?? 1
  return pastures.map((p) => computePasture(p, zone, utilization, ctx, factors?.get(p.id) ?? fromRain))
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
 * `precipMm` is the ZONE — the long-term annual average here, which is what
 * the estimator's rows measure. It does not move with the weather.
 *
 * `seasonFactor` is how this season has gone, and it is what the weather moves.
 * computePastures picks it: the satellite's own measurement of THIS paddock
 * where there is one (peak canopy cover so far against its own cover over the
 * same calendar window in earlier years, pasture_season_factor), otherwise the
 * projected season's rain over a normal one. Never both, because they measure
 * the same weather and multiplying them counts it twice.
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
