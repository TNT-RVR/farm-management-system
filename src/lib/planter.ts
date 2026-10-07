/**
 * Planter arithmetic.
 *
 * Four questions, all the same equation rearranged:
 *   - what seed spacing gives this population?
 *   - what population does this spacing give?
 *   - how far does the planter drive for ten full plate turns?
 *   - how long does a field take, and how fast do the plates spin?
 *
 * The one that has to be right is the calibration distance, because it is the
 * only one somebody checks against the ground. Get it wrong and the seed count
 * comes out wrong in a way that looks like a planter fault.
 */

/** 43,560 square feet in an acre. */
export const SQ_FT_PER_ACRE = 43_560

export type PlanterSetup = {
  /** Inches between rows. 22 on this farm. */
  rowSpacingIn: number
  /** How many rows the planter puts down at once. 20 here. */
  rows: number
}

/**
 * Row feet on an acre, at a given row spacing.
 *
 * One row 12 inches apart covers a strip a foot wide, so an acre is 43,560 row
 * feet. At 22 inches each foot of travel covers 22/12 square feet, so an acre
 * takes proportionally fewer.
 */
export const rowFeetPerAcre = (rowSpacingIn: number) =>
  rowSpacingIn > 0 ? SQ_FT_PER_ACRE / (rowSpacingIn / 12) : 0

/** Seed spacing down the row, in inches, for a target population. */
export function spacingFromPopulation(population: number, rowSpacingIn: number): number | null {
  if (!(population > 0) || !(rowSpacingIn > 0)) return null
  return (rowFeetPerAcre(rowSpacingIn) * 12) / population
}

/** Population, in seeds an acre, from a seed spacing down the row. */
export function populationFromSpacing(spacingIn: number, rowSpacingIn: number): number | null {
  if (!(spacingIn > 0) || !(rowSpacingIn > 0)) return null
  return (rowFeetPerAcre(rowSpacingIn) * 12) / spacingIn
}

/**
 * How far the planter travels for N complete turns of the plate.
 *
 * One turn drops one seed per hole, so a plate with `holes` holes lays
 * `holes × spacing` inches of row per turn. This is the number somebody paces
 * out in the yard: drive it, count the seeds in a row, and the count should be
 * holes × turns.
 *
 * Independent of ground speed and of how the plate is driven — the drive ratio
 * is whatever makes the spacing come out, and the spacing is the input here.
 */
export function calibrationDistanceFt(
  spacingIn: number,
  holes: number,
  turns = 10,
): number | null {
  if (!(spacingIn > 0) || !(holes > 0) || !(turns > 0)) return null
  return (spacingIn * holes * turns) / 12
}

/** Seeds expected on the ground over that distance, per row. */
export const seedsPerCalibration = (holes: number, turns = 10) => holes * turns

/**
 * Acres an hour, from width and speed.
 *
 * Width is rows × row spacing. No allowance for turning, filling or moving
 * between fields — this is the machine's rate at the stated speed, and the
 * screen says as much rather than quietly padding it.
 */
export function acresPerHour(setup: PlanterSetup, mph: number): number | null {
  if (!(setup.rows > 0) || !(setup.rowSpacingIn > 0) || !(mph > 0)) return null
  const widthFt = (setup.rows * setup.rowSpacingIn) / 12
  return (widthFt * mph * 5280) / SQ_FT_PER_ACRE
}

/** Hours to plant an area at that rate. */
export function hoursForAcres(acres: number, acresHr: number | null): number | null {
  if (!(acres > 0) || !acresHr || !(acresHr > 0)) return null
  return acres / acresHr
}

/**
 * Plate revolutions a minute.
 *
 * The plate turns once per `holes` seeds, and seeds go down at
 * speed ÷ spacing. So rpm = (inches travelled per minute ÷ spacing) ÷ holes.
 *
 * Worth a look on screen: past roughly 30 rpm most plate meters start skipping
 * and doubling, so this is the number that says a target population is not
 * achievable at the speed somebody wants to drive.
 */
export function plateRpm(mph: number, spacingIn: number, holes: number): number | null {
  if (!(mph > 0) || !(spacingIn > 0) || !(holes > 0)) return null
  const inchesPerMinute = (mph * 5280 * 12) / 60
  return inchesPerMinute / spacingIn / holes
}

/** Seeds needed for an area, and bags at a given seeds-per-bag. */
export function seedForAcres(population: number, acres: number): number | null {
  if (!(population > 0) || !(acres > 0)) return null
  return population * acres
}
