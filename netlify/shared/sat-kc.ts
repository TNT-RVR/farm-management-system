// Measured crop coefficient from NDVI (spec §8.1).
//
// "This replaces table-lookup Kc with a measured value and is the highest-value
// single output of this whole module." The table Kc says what a crop of this
// type is USUALLY doing on day 63 after planting. The satellite says what THIS
// crop is doing, on this field, this year — after the hail, after the reseed,
// after the corner the pivot never reaches.
//
// The route is NDVI -> fractional cover -> Kc, in two steps, as the spec asks.
// Going straight from NDVI to Kc with one fitted line is common and tempting,
// and it buries the assumption that matters: NDVI saturates as a canopy closes,
// so a single linear fit that is right at emergence is wrong at full cover.
// fcover is where that non-linearity belongs.
//
// What this is NOT, until a season of comparison says otherwise: trustworthy
// enough to be on by default. The spec is explicit for phase 4 — "behind a
// per-field toggle, defaulting off. Compare satellite Kc against table Kc for a
// full season before defaulting on." So this computes and stores a number, and
// the irrigation module keeps using its table value until someone deliberately
// turns a field over.

/**
 * NDVI of bare ground and of a closed canopy, for this soil.
 *
 * The dark chocolate-brown soils south of Taber read around 0.15 bare; a closed
 * irrigated canopy reads 0.85 to 0.90. These two numbers set the whole scale,
 * and they are SOIL AND CROP SPECIFIC — the honest way to fix them is to read
 * them off this farm's own record once there are two seasons of it (the same
 * data the zone gate is waiting for). Until then they are a documented
 * assumption, not a measurement.
 */
export const NDVI_BARE = 0.15
export const NDVI_FULL_COVER = 0.90

/**
 * Fractional canopy cover from NDVI.
 *
 * The squared form of the scaled-NDVI relation (Gutman & Ignatov and the many
 * papers after it). The square matters: NDVI rises quickly while a canopy is
 * sparse and then flattens, so cover grows more slowly than NDVI early on. A
 * linear version overstates cover — and therefore Kc, and therefore irrigation
 * — at exactly the emergence stage when a young crop is least able to use it.
 */
export function fcoverFromNdvi(ndvi: number | null): number | null {
  if (ndvi == null || !Number.isFinite(ndvi)) return null
  const scaled = (ndvi - NDVI_BARE) / (NDVI_FULL_COVER - NDVI_BARE)
  const clamped = Math.max(0, Math.min(1, scaled))
  return Number((clamped * clamped).toFixed(4))
}

/**
 * Basal crop coefficient from fractional cover.
 *
 * FAO-56 shape: Kcb runs from a bare-soil floor to a full-canopy ceiling in
 * proportion to how much of the ground the canopy covers. 1.15 is the FAO-56
 * mid-season basal figure for the cereals and pulses grown here; 0.15 is the
 * residual transpiration of effectively bare ground.
 *
 * Deliberately NOT extended above 1.15 for a very green canopy. NDVI saturates,
 * so a reading of 0.95 is not evidence of a crop transpiring harder than one at
 * 0.88 — it is evidence the index has run out of range. Letting Kc climb there
 * would schedule water for transpiration that is not happening.
 */
export const KCB_BARE = 0.15
export const KCB_FULL = 1.15

export function kcbFromFcover(fcover: number | null): number | null {
  if (fcover == null || !Number.isFinite(fcover)) return null
  const clamped = Math.max(0, Math.min(1, fcover))
  return Number((KCB_BARE + (KCB_FULL - KCB_BARE) * clamped).toFixed(4))
}

/** NDVI straight through to Kcb, for callers that do not need the middle step. */
export function kcbFromNdvi(ndvi: number | null): number | null {
  return kcbFromFcover(fcoverFromNdvi(ndvi))
}

/**
 * Whether a satellite Kc may be used in place of the table value.
 *
 * Two independent gates, and both must pass (spec §8.1 and §12 phase 4):
 *
 *   1. The per-field toggle. Off by default, and it stays off until satellite
 *      Kc has been compared against table Kc for a full season on that field.
 *   2. confidence = 'high'. Anything less falls back to the table, which
 *      "preserves the module's current behaviour as a floor and makes the
 *      satellite input a strict improvement".
 *
 * The second gate is doing real work right now: this season's smoke leaves most
 * days at 'low', so even an enabled field would spend most of August on its
 * table value. That is the design behaving correctly, not a failure.
 */
export function satelliteKcUsable(
  enabled: boolean,
  confidence: 'high' | 'medium' | 'low' | null | undefined,
  kc: number | null | undefined,
): boolean {
  return enabled && confidence === 'high' && kc != null && Number.isFinite(kc)
}

/**
 * How far a satellite Kc may sit from the table before it is refused.
 *
 * A measured value that disagrees mildly with the table is the entire point of
 * measuring. One that disagrees violently is far more likely to be a bad
 * observation that survived scoring — a smoke edge, a misregistered boundary, a
 * field harvested between passes — and feeding it into a water balance schedules
 * real water onto real ground. Beyond this the table wins and the disagreement
 * is worth looking at rather than acting on.
 */
export const KC_SANITY_SPREAD = 0.5

export function kcWithinSanity(satelliteKc: number, tableKc: number): boolean {
  return Math.abs(satelliteKc - tableKc) <= KC_SANITY_SPREAD
}
