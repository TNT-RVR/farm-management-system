/**
 * What a centrifugal pump delivers, from its maker's curve and from its motor.
 *
 * Pump nameplates rarely print a flow: the flow depends on the head the pump
 * works against, so the maker prints a curve instead. The Coulee / Crown Hill
 * pump is a Cornell 5H (model 5H100-4) with a 15 7/32" (15.22") impeller on a
 * 100 hp, 1775 rpm motor — the 5H's largest impeller, which Cornell's table
 * puts on a 100 hp motor using its 1.15 service factor.
 *
 * Source: Cornell Pump Co. curve sheet 138-30 (July 1984), Model 5H, 1780 rpm,
 * closed impeller, 60 Hz — the copy the USDA NRCS keeps at
 * https://www.wcc.nrcs.usda.gov/ftpref/wntsc/Pump%20Curves/Cornell/1800/5H.pdf
 * The points below were read off the 15.22" line by eye; good to about ±5 ft.
 */

export type CurvePoint = { gpm: number; headFt: number }

/** Cornell 5H, 1780 rpm, 15.22" impeller: total head, ft, at each flow. */
export const CORNELL_5H_1522: CurvePoint[] = [
  { gpm: 400, headFt: 264 },
  { gpm: 600, headFt: 262 },
  { gpm: 800, headFt: 257 },
  { gpm: 1000, headFt: 250 },
  { gpm: 1200, headFt: 239 },
  { gpm: 1400, headFt: 225 },
  { gpm: 1600, headFt: 206 },
  { gpm: 1800, headFt: 187 },
  { gpm: 1900, headFt: 176 },
]

/** The curve's best efficiency (83%) runs from about 1,250 to 1,600 gpm on this impeller. */
export const CORNELL_5H_BEST_EFF = 0.83

/** Water horsepower per (gpm × ft) of fresh water: 1 hp lifts 3,960 gpm one foot. */
export const GPM_FT_PER_HP = 3960

/**
 * The flow the curve gives at a head, US gpm. Null above the shut-off head
 * (the pump cannot push that high) or past the end of the published curve.
 */
export function flowAtHead(curve: CurvePoint[], headFt: number): number | null {
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1]
    const b = curve[i]
    if (headFt <= a.headFt && headFt >= b.headFt) {
      if (a.headFt === b.headFt) return a.gpm
      return a.gpm + ((a.headFt - headFt) / (a.headFt - b.headFt)) * (b.gpm - a.gpm)
    }
  }
  return null
}

/** The most a motor can push at a head: hp × 3,960 × pump efficiency ÷ head. */
export function motorLimitedGpm(hp: number, pumpEff: number, headFt: number): number {
  return headFt > 0 ? (hp * GPM_FT_PER_HP * pumpEff) / headFt : 0
}

/** Brake horsepower a flow and head take: gpm × head ÷ (3,960 × efficiency). */
export function brakeHp(gpm: number, headFt: number, pumpEff: number): number {
  return pumpEff > 0 ? (gpm * headFt) / (GPM_FT_PER_HP * pumpEff) : 0
}

/** psi to feet of water. */
export const psiToFt = (psi: number) => psi * 2.31

/** The estimate stored on the Coulee / Crown Hill pump, worked out so it can be checked. */
export function couleeCrownHillEstimate() {
  const heads = [205, 225, 240]
  return heads.map((h) => ({
    headFt: h,
    curveGpm: flowAtHead(CORNELL_5H_1522, h),
    motorGpm: motorLimitedGpm(100, CORNELL_5H_BEST_EFF, h),
  }))
}

/**
 * A curve for another impeller of the same pump at the same speed, by the
 * affinity laws: flow scales with the diameter, head with its square. Good
 * for a small trim like 13" to 12.75"; less so for big ones.
 */
export function trimCurve(curve: CurvePoint[], fromIn: number, toIn: number): CurvePoint[] {
  const k = toIn / fromIn
  return curve.map((p) => ({ gpm: p.gpm * k, headFt: p.headFt * k * k }))
}

/** The head on the curve at a flow, ft: where a stated gpm puts the pump. Null off the curve. */
export function headAtFlow(curve: CurvePoint[], gpm: number): number | null {
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1]
    const b = curve[i]
    if (gpm >= a.gpm && gpm <= b.gpm) return a.headFt + ((gpm - a.gpm) / (b.gpm - a.gpm)) * (b.headFt - a.headFt)
  }
  return null
}

/**
 * The Creek flat pump is a Cornell 5RB (model 5RB-60-4) with a 12.75" impeller
 * on a 60 hp, 1785 rpm motor. Cornell's table puts 12.50" on 60 hp at full
 * load and 13.00" using the 1.15 service factor, so 12.75" sits between.
 *
 * Source: Cornell Pump Co. curve sheet 136-30 (November 1984), Model 5RB,
 * 1780 rpm, closed impeller, double volute, 60 Hz — the NRCS copy at
 * https://www.wcc.nrcs.usda.gov/ftpref/wntsc/Pump%20Curves/Cornell/1800/5RB.pdf
 * It draws 10", 11", 12", 13" and 13.5" lines. These points were read off the
 * 13" line by eye; good to about ±5 ft. (The 12" line, scaled up to 12.75" the
 * same way, lands within about 3 ft of the 13" line scaled down.)
 */
export const CORNELL_5RB_13: CurvePoint[] = [
  { gpm: 400, headFt: 182 },
  { gpm: 600, headFt: 180 },
  { gpm: 800, headFt: 175 },
  { gpm: 1000, headFt: 167 },
  { gpm: 1250, headFt: 158 },
  { gpm: 1500, headFt: 146 },
  { gpm: 1750, headFt: 127 },
  { gpm: 2000, headFt: 102 },
  { gpm: 2140, headFt: 92 },
]

/** Cornell 5RB, 1780 rpm, the plate's 12.75" impeller. */
export const CORNELL_5RB_1275 = trimCurve(CORNELL_5RB_13, 13, 12.75)

/** The 5RB's efficiency where this impeller works (about 1,200–1,700 gpm) is 83–86%; 84% is used. */
export const CORNELL_5RB_EFF = 0.84

/**
 * The head a river pivot is taken to need, ft, for the Creek flat, Maple
 * and Jensen pumps: 40–55 psi at the pivot point (92–127 ft) plus the lift
 * from the river and the pipe friction. A guess, until a gauge reading or a
 * flow meter replaces it.
 */
export const RIVER_PIVOT_HEADS_FT = [130, 145, 155] as const

function estimateAt(curve: CurvePoint[], hp: number, eff: number) {
  return RIVER_PIVOT_HEADS_FT.map((h) => ({
    headFt: h,
    curveGpm: flowAtHead(curve, h),
    motorGpm: motorLimitedGpm(hp, eff, h),
  }))
}

/** The estimate stored on the Creek Flat Pump, worked out so it can be checked. */
export function creekflatEstimate() {
  return estimateAt(CORNELL_5RB_1275, 60, CORNELL_5RB_EFF)
}

/**
 * The #9 Maple Flat pump is a Cornell 4RB (model 4RB-CC) with a 12.62"
 * impeller on a 40 hp, 1775 rpm Baldor. Cornell's table gives 12.00" for 40
 * hp at full load and 12.62" — this one — as the most it takes using the 1.15
 * service factor, so the motor runs into its service factor over most of the
 * curve.
 *
 * Source: Cornell curve sheet 136-25 (November 1984), Model 4RB, 1775 rpm,
 * closed impeller, single volute — the NRCS copy at
 * https://www.wcc.nrcs.usda.gov/ftpref/wntsc/Pump%20Curves/Cornell/1800/4RB.pdf
 * It draws 8" to 12.75" lines; these points were read off the 12.75" line by
 * eye (±5 ft) and trimmed to 12.62".
 */
export const CORNELL_4RB_1275: CurvePoint[] = [
  { gpm: 400, headFt: 176 },
  { gpm: 600, headFt: 172 },
  { gpm: 800, headFt: 164 },
  { gpm: 900, headFt: 158 },
  { gpm: 1000, headFt: 150 },
  { gpm: 1100, headFt: 140 },
  { gpm: 1200, headFt: 129 },
  { gpm: 1300, headFt: 117 },
  { gpm: 1390, headFt: 105 },
]
export const CORNELL_4RB_1262 = trimCurve(CORNELL_4RB_1275, 12.75, 12.62)
/** The 4RB's efficiency where this impeller works (about 850–1,150 gpm) is 80–85%; 83% is used. */
export const CORNELL_4RB_EFF = 0.83

export function mapleEstimate() {
  return estimateAt(CORNELL_4RB_1262, 40, CORNELL_4RB_EFF)
}

/**
 * The #8 Ray Dalton pump is another 4RB (model 4RB-25-3-4) with a 10.69"
 * impeller on a 25 hp, 1760 rpm Baldor. Cornell's table gives 10.50" for 25
 * hp at full load and 10.75" using the service factor. Same sheet 136-25; the
 * 11" line read by eye (±5 ft) and trimmed to 10.69". (The 12.75" line
 * trimmed to 11" lands within about 2 ft of it.)
 *
 * This impeller tops out near 123 ft, so this pivot must run at a lower head
 * than the river pivots: 100–115 ft is taken (a low-pressure package at 25–35
 * psi at the pivot point, 58–81 ft, plus the lift and the friction).
 */
export const CORNELL_4RB_11: CurvePoint[] = [
  { gpm: 400, headFt: 130 },
  { gpm: 600, headFt: 126 },
  { gpm: 800, headFt: 116 },
  { gpm: 900, headFt: 110 },
  { gpm: 1000, headFt: 101 },
  { gpm: 1100, headFt: 92 },
  { gpm: 1200, headFt: 81 },
]
export const CORNELL_4RB_1069 = trimCurve(CORNELL_4RB_11, 11, 10.69)
/** The 4RB's efficiency with the 10.69" impeller around 700–900 gpm: about 82%. */
export const CORNELL_4RB_1069_EFF = 0.82
export const RAY_DALTON_HEADS_FT = [100, 107, 115] as const

export function rayDaltonEstimate() {
  return RAY_DALTON_HEADS_FT.map((h) => ({
    headFt: h,
    curveGpm: flowAtHead(CORNELL_4RB_1069, h),
    motorGpm: motorLimitedGpm(25, CORNELL_4RB_1069_EFF, h),
  }))
}

/**
 * The #6 pump (6/Kellers) is a 4RB (model 4RB-30-3-4) with an 11.38" impeller
 * on a 30 hp, 1760 rpm Baldor. Cornell's table gives 11.00" for 30 hp at full
 * load and 11.50" using the service factor. The 11" line above, scaled up to
 * 11.38": about 139 ft near shut-off, so 110–130 ft is taken.
 */
export const CORNELL_4RB_1138 = trimCurve(CORNELL_4RB_11, 11, 11.38)
export const PUMP_6_HEADS_FT = [110, 120, 130] as const

export function pump6Estimate() {
  return PUMP_6_HEADS_FT.map((h) => ({
    headFt: h,
    curveGpm: flowAtHead(CORNELL_4RB_1138, h),
    motorGpm: motorLimitedGpm(30, CORNELL_4RB_1069_EFF, h),
  }))
}

/**
 * The #10 Aspen Flat pump is a Cornell 3RB (model 3RB-25-3-4) with a 12.25"
 * impeller on a 25 hp, 1760 rpm Baldor. Cornell's table gives 11.88" for 25
 * hp at full load and 12.62" using the service factor: 12.25" sits between.
 *
 * Source: Cornell curve sheet 136-15 (September 1986), Model 3RB, 1775 rpm,
 * closed impeller, single volute — the NRCS copy at
 * https://www.wcc.nrcs.usda.gov/ftpref/wntsc/Pump%20Curves/Cornell/1800/3RB.pdf
 * It draws 9", 10", 11", 12" and 12.88" lines; these points were read off the
 * 12" line by eye (±5 ft) and scaled up to 12.25". (The 12.88" line scaled
 * down lands within about 4 ft.) The motor turns 1760 rpm against the curve's
 * 1775, which takes about 1% off the flow and 2% off the head — inside the
 * reading error, so not applied.
 */
export const CORNELL_3RB_12: CurvePoint[] = [
  { gpm: 200, headFt: 160.6 },
  { gpm: 300, headFt: 159 },
  { gpm: 400, headFt: 153 },
  { gpm: 450, headFt: 149 },
  { gpm: 500, headFt: 143 },
  { gpm: 550, headFt: 134 },
  { gpm: 600, headFt: 124 },
  { gpm: 650, headFt: 113 },
  { gpm: 670, headFt: 106 },
]
export const CORNELL_3RB_1225 = trimCurve(CORNELL_3RB_12, 12, 12.25)
/** The 3RB's efficiency where this impeller works (about 450–600 gpm) is 75–78%; 76% is used. */
export const CORNELL_3RB_EFF = 0.76

export function jensenEstimate() {
  return estimateAt(CORNELL_3RB_1225, 25, CORNELL_3RB_EFF)
}
