import type { Database } from './database.types'
import { fieldForage, rowsFor, type FieldForage, type FieldWindow, type PastureFieldRow, type SprayHold } from './field-residue'

// The grazing calculator's arithmetic, with no Supabase client attached, so the
// pasture move-out check on the server reads forage exactly the way the Grazing
// tab does. grazing.ts re-exports all of it; nothing outside imports this file
// except code that runs where the browser client cannot.

export type PastureRow = Database['public']['Tables']['grazing_pastures']['Row']

// ---- constants (from the spreadsheet) ----
export const ACRES_PER_HECTARE = 2.47105

/**
 * What one animal unit takes out of a pasture in a day — in two parts, because
 * two conventions are in circulation and they are 22% apart.
 *
 *   INTAKE, 26 lb DM a day (780 lb a month): 2.6% of a 1,000 lb cow's body
 *   weight. What goes in her mouth. The figure behind the Alberta Forage
 *   Manual's tables and the BCRC's carrying-capacity calculator.
 *
 *   TOTAL, 33.3 lb DM a day (1,000 lb a month = 455 kg): Alberta's
 *   public-lands AUM. Intake plus the grass she tramples, beds on and fouls.
 *   Every Ecologically Sustainable Stocking Rate in the range plant community
 *   guides is denominated in this one.
 *
 * Which to count is the ranch's call (ranches.grazing_count_waste, toggled on
 * the Grazing tab). It is a real 220 lb an animal-unit month: the difference
 * between a paddock lasting 40 days and lasting 31.
 *
 * Not to be confused with the utilization rate, which answers a different
 * question — how much of the standing grass the herd may take before the
 * plants suffer. This is how much forage one grazing day draws out of what it
 * was allowed to take. Multiplying the two is correct; swapping one for the
 * other is not.
 */
export const AU_INTAKE_LB_PER_DAY = 26
/** Alberta's AUM: 455 kg of dry matter, intake plus waste. */
export const AUM_TOTAL_LB = 1000
export const AU_TOTAL_LB_PER_DAY = AUM_TOTAL_LB / 30
/** The trampled, bedded-on and fouled share: ~7.3 lb a day, 22% of the total. */
export const AU_WASTE_LB_PER_DAY = AU_TOTAL_LB_PER_DAY - AU_INTAKE_LB_PER_DAY

/** lb DM one animal-unit day draws out of a pasture, per the ranch's setting. */
export const lbPerAuDay = (countWaste: boolean): number =>
  countWaste ? AU_TOTAL_LB_PER_DAY : AU_INTAKE_LB_PER_DAY

/**
 * Pounds of grazeable forage read as animal-unit days: the only figure that
 * says how long feed lasts. An acre count does not — 74 acres of corn stubble
 * and 74 acres of canola stubble are not the same feed.
 *
 * `perDay` is deliberately required. Both conventions are defensible and a
 * silent default is how the app came to mix them in the first place.
 */
export const audsFromLb = (lb: number, perDay: number) => lb / perDay
export const GRASS_QUALITIES = ['Excellent', 'Good', 'Fair', 'Poor'] as const
export type GrassQuality = (typeof GRASS_QUALITIES)[number]

/**
 * Forage Yield Estimator — lbs/acre by precipitation zone × grass quality.
 *
 * THE FALLBACK, not the model. Sam, 12 Nov 2026: the carrying-capacity
 * tables are "just trying to be a real rough guide for a regular producer...
 * not taking into account the evaporation or the rain value in April versus
 * September". Both halves of that are now handled elsewhere:
 *
 *   - How a YEAR moves is forage-response.ts — the evaporation threshold, the
 *     April-June weighting, the nitrogen ceiling. The table never sees it.
 *   - How much a pasture grows in a NORMAL year is this table only while
 *     nothing has measured the pasture itself. A clip-and-weigh takes over the
 *     moment there is one: see normalYearYield and pasture_measured_yield.
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
 * a different quantity: at Home Ranch the growing-season normal is
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

/** 1 kg/ha of dry matter in lb/ac. */
export const KG_HA_TO_LB_AC = 0.892179

/**
 * Where a pasture's normal-year yield came from, best evidence first.
 *
 *   measured — somebody cut and weighed this pasture.
 *   grazed   — the level, lifted to meet what the cattle actually took off
 *              this ranch (grazed-yield.ts).
 *   rated    — the ranch's own level times this paddock's measured cover
 *              against its ranch's median paddock (ratedYieldPerAcre).
 *   zone     — the estimator's table alone, a rough provincial guide.
 */
export type YieldSource = 'measured' | 'grazed' | 'rated' | 'zone'

/** A pasture's normal-year yield and what it rests on. */
export type PastureAnchor = { lbPerAcre: number; source: Exclude<YieldSource, 'zone'> }

/**
 * What this pasture grows in a NORMAL year, and on what evidence.
 *
 * A clip-and-weigh from this pasture beats a provincial table about this
 * pasture, every time: the table is a rough guide for a regular producer and
 * cannot know that this paddock is thin on a side hill or heavy in a draw.
 * Where no one has cut and weighed anything, the table's row stands, which
 * today is everywhere — pasture_measured_yield is empty until the first
 * samples are taken.
 *
 * What this never does is mix the two. Half a measurement and half a table is
 * neither, and nobody could say afterwards which number they were looking at.
 */
export function normalYearYield(
  precipMm: number,
  quality: string,
  anchor?: PastureAnchor | null,
): { lbPerAcre: number; source: YieldSource } {
  if (anchor && Number.isFinite(anchor.lbPerAcre) && anchor.lbPerAcre > 0) return anchor
  return { lbPerAcre: forageYieldPerAcre(precipMm, quality), source: 'zone' }
}

/**
 * A paddock's normal-year yield from the ranch's own level and the paddock's
 * own measured cover.
 *
 * `baseLbAc` is what a MEDIAN paddock on this ranch grows in an ordinary year
 * (ranches.forage_base_lb_ac). `rel` is grass_quality_rel: that paddock's
 * canopy cover over its ranch's median paddock, which is what the satellite
 * rating actually measures.
 *
 * Keeping those apart is the whole point. The rating is relative and always
 * was — its median paddock is 1.00 on any ranch, good or poor — so handing it
 * to a table of absolute pounds threw the ranch's level away and replaced it
 * with a provincial average. Here the rating decides only the spread between
 * paddocks, and the level is a number somebody can see and argue with.
 *
 * It also ends the four-word bucketing: a paddock at 0.79 of its ranch's
 * median is read at 0.79, not rounded down to "Poor" and a figure 19% under
 * its own measurement.
 *
 * Null when the paddock has no measured cover yet, so the caller falls back to
 * the table rather than inventing one.
 */
export function ratedYieldPerAcre(baseLbAc: number, rel: number | string | null | undefined): number | null {
  const r = typeof rel === 'string' ? Number(rel) : rel
  if (r == null || !Number.isFinite(r) || r <= 0) return null
  if (!Number.isFinite(baseLbAc) || baseLbAc <= 0) return null
  return baseLbAc * r
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
  /** Whether the normal-year figure came off this pasture's own samples or the table. */
  yieldSource: YieldSource
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
  /**
   * lb DM one animal-unit day drew out of the paddock to give the AUD and AUM
   * columns below: 33.3 counting trampling and fouling, 26 for intake alone.
   * On the row so a screen can say which convention its figure is in.
   */
  lbPerAuDay: number
  /** Whether lbPerAuDay includes the wasted grass (ranches.grazing_count_waste). */
  countsWaste: boolean
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
  /** The long-term average season total, or the typed figure. */
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
  anchors?: Map<string, PastureAnchor> | null,
  countWaste: boolean = true,
): PastureCalc[] {
  // No archive, no zone: fall back to the season figures, as it read before.
  const zone = rain.zoneMm ?? rain.projectedMm ?? rain.forecastMm
  const fromRain = rain.rainFactor ?? 1
  return pastures.map((p) =>
    computePasture(p, zone, utilization, ctx, factors?.get(p.id) ?? fromRain, anchors?.get(p.id) ?? null, countWaste),
  )
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
  anchor?: PastureAnchor | null,
  /**
   * Whether a grazing day draws the trampled and fouled grass as well as the
   * eaten grass (ranches.grazing_count_waste). It changes the AUD and AUM
   * columns only — the pounds standing in the paddock are the same either way.
   */
  countWaste: boolean = true,
): PastureCalc {
  const hectares = p.km2 * 100
  const acres = hectares * ACRES_PER_HECTARE
  const factor = seasonFactor != null && Number.isFinite(seasonFactor) && seasonFactor > 0 ? seasonFactor : 1
  const normal = normalYearYield(precipMm, p.grass_quality, anchor)
  const foragePerAcre = normal.lbPerAcre * factor
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
  // The pounds standing in the paddock do not depend on this; only how many
  // grazing days they come to does.
  //
  // The waste allowance is charged on grass the herd will tread through, and
  // NOT on pounds that have already had trampling taken off upstream. Which of
  // those the field pounds are depends on where they came from:
  //
  //   linked (field-residue.ts) — its figures are "grazeable dry matter: what
  //     cattle actually take, trampling [counted]", so the loss is already
  //     gone. Charging Alberta's AUM waste share as well would take it twice.
  //   not linked — the hand-typed irrigated acres, grown at the estimator's
  //     irrigated yield. That is standing GRASS with nothing taken off it, so
  //     it is charged exactly like the native grass beside it.
  //
  // So on a paddock with mapped fields the toggle moves the grass AUDs and
  // leaves the crop-field AUDs alone; on a hand-typed one it moves both.
  const linked = Boolean(ctx && anyMapped)
  const perDay = lbPerAuDay(countWaste)
  const nativeAuds = audsFromLb(nativeLbs, perDay)
  const fieldAuds = audsFromLb(fieldLbs, linked ? AU_INTAKE_LB_PER_DAY : perDay)
  const auds = nativeAuds + fieldAuds
  return {
    ...p,
    hectares,
    acres,
    nativeGrassAc,
    totalGrazeableAc,
    foragePerAcre,
    yieldSource: normal.source,
    irrigatedForagePerAcre,
    foragePerAcreUtil,
    seasonFactor: factor,
    totalLbs,
    lbPerAuDay: perDay,
    countsWaste: countWaste,
    aums: auds / 30,
    auds,
    fieldsLinked: linked,
    fields,
    fieldAc,
    nativeLbs,
    fieldLbs,
    nativeAuds,
    fieldAuds,
    window: ctx && anyMapped ? ctx.window : null,
  }
}
