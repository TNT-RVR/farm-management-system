/**
 * The checks a pivot or pump record has to pass before it is saved, so the
 * form can say what is wrong instead of letting −50 acres or a 150% pivot
 * through (batch 6 page walk, Nov 2026).
 *
 * Each takes the patch RecordEditModal hands to onSave: numbers already
 * typed as numbers, blanks as null, and a scaled field (the pivot's
 * efficiency, shown as 85 and kept as 0.85) already back in its stored form.
 * Each returns the first problem as a sentence, or null when it is fine.
 */

type Patch = Record<string, unknown>

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** "X cannot be negative." for the first of `keys` that is. */
function firstNegative(patch: Patch, keys: [string, string][]): string | null {
  for (const [key, label] of keys) {
    const v = num(patch[key])
    if (v != null && v < 0) return `${label} cannot be negative.`
  }
  return null
}

const PIVOT_NOT_NEGATIVE: [string, string][] = [
  ['acres_irrigated', 'Irrigated acres'],
  ['gpm', 'Flow (gpm)'],
  ['system_capacity_ls', 'Capacity (L/s)'],
  ['towers', 'Towers'],
  ['length_m', 'Length'],
]

/** A pivot record's first problem, or null. Efficiency is the stored fraction (0.85). */
export function pivotProblem(patch: Patch): string | null {
  const neg = firstNegative(patch, PIVOT_NOT_NEGATIVE)
  if (neg) return neg
  const eff = num(patch.application_efficiency)
  // 1–100 %, kept as 0.01–1. A hair of slack for the ÷100 the form does.
  if (eff != null && (eff < 0.01 - 1e-9 || eff > 1 + 1e-9)) return 'Efficiency has to be between 1 and 100%.'
  return null
}

const PUMP_NOT_NEGATIVE: [string, string][] = [
  ['gpm', 'Measured flow (gpm)'],
  ['gpm_estimate', 'Estimated flow (gpm)'],
  ['gpm_estimate_low', 'The low estimate'],
  ['gpm_estimate_high', 'The high estimate'],
]

/** A pump record's first problem, or null. Efficiency and power factor are percents (92, not 0.92). */
export function pumpProblem(patch: Patch): string | null {
  const neg = firstNegative(patch, PUMP_NOT_NEGATIVE)
  if (neg) return neg
  const low = num(patch.gpm_estimate_low)
  const high = num(patch.gpm_estimate_high)
  if (low != null && high != null && low > high) return 'The low estimate has to be at or below the high estimate.'
  // The table's own rule (pumps_efficiency_pct_check and the power factor's):
  // more than 0, at most 100.
  for (const [key, label] of [
    ['efficiency_pct', 'Efficiency'],
    ['power_factor_pct', 'Power factor'],
  ] as const) {
    const v = num(patch[key])
    if (v != null && (v <= 0 || v > 100)) return `${label} has to be more than 0 and at most 100%.`
  }
  return null
}

/** For an onSave: a rejected promise carrying the problem, which RecordEditModal shows. */
export function refuse(problem: string): Promise<never> {
  return Promise.reject(new Error(problem))
}
