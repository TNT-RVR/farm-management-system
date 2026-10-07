/**
 * Pure helpers for adding and removing a field's crop-history rows by hand
 * (Sam, 7 Oct 2026: rows can be added and deleted, not only typed over).
 */

/**
 * Per-acre and total for a new row. On UPDATE the crop_history triggers
 * derive one from the other; on INSERT they do not (both count as "typed"),
 * so a new row fills the missing one here, rounded the way the triggers
 * round: per-acre to 0.1, total to a whole unit.
 */
export function fillYieldPair(acres: number | null, perAcre: number | null, total: number | null): { perAcre: number | null; total: number | null } {
  if (acres == null || !(acres > 0)) return { perAcre, total }
  if (perAcre != null && total == null) return { perAcre, total: Math.round(perAcre * acres) }
  if (total != null && perAcre == null) return { perAcre: Math.round((total / acres) * 10) / 10, total }
  return { perAcre, total }
}

/** fn_year_guard's rule: a crop year before this calendar year is read-only unless unlocked. */
export function isCropYearLocked(cropYear: number, unlockedYears: number[], currentYear = new Date().getFullYear()): boolean {
  return cropYear < currentYear && !unlockedYears.includes(cropYear)
}

/**
 * Whether deleting the row has to hand the plan its estimate back first.
 * The after-trigger copies a scale or typed yield into the season's plan and
 * restores the estimate only when the yield is cleared on UPDATE — a DELETE
 * would leave the harvest yield sitting in the plan.
 */
export function deleteNeedsPlanRestore(h: { plan_yield_saved: boolean; source: string }): boolean {
  return h.plan_yield_saved && (h.source === 'scale' || h.source === 'manual')
}
