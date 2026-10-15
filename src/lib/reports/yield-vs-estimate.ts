import type { ExportColumn } from '@/hooks/useExport'
import type { PlanRowView } from '@/lib/planner'
import { compareFieldNames } from '@/lib/queries'

/**
 * Each planted field's yield against its estimate and its goal for a year
 * (yield-goal.ts): the actual once harvested, the estimate and how it was
 * worked out, the goal, and the differences per acre and in %. Made from the
 * plan's rows (usePlanRows), so it says what the Plan tab says.
 */

const r1 = (v: number | null | undefined) => (v == null ? null : Math.round(v * 10) / 10)
const r0 = (v: number | null | undefined) => (v == null ? null : Math.round(v))

/** The rows worth a line: a crop that expects a yield. Harvested first, then by crop and field. */
export function yieldVsEstimateRows(rows: PlanRowView[]): PlanRowView[] {
  return rows
    .filter((r) => r.score && r.crop)
    .sort(
      (a, b) =>
        Number(Boolean(b.score!.actual)) - Number(Boolean(a.score!.actual)) ||
        a.crop!.name.localeCompare(b.crop!.name) ||
        compareFieldNames(a.field.name, b.field.name),
    )
}

export function yieldVsEstimateColumns(): ExportColumn<PlanRowView>[] {
  return [
    { key: 'field', label: 'Field', value: (r) => r.field.name },
    { key: 'crop', label: 'Crop', value: (r) => r.crop?.name ?? '' },
    { key: 'unit', label: 'Unit /ac', value: (r) => r.crop?.yield_unit ?? '' },
    { key: 'acres', label: 'Acres', value: (r) => r1(r.acres) },
    { key: 'actual', label: 'Actual /ac', value: (r) => r1(r.score?.actual?.value) },
    { key: 'basis', label: 'Actual is', value: (r) => (r.score?.actual ? (r.score.actual.clean ? 'clean' : 'pre-clean') : '') },
    { key: 'estimate', label: 'Estimate /ac', value: (r) => r1(r.score?.estimate.value) },
    { key: 'how', label: 'Estimate from', value: (r) => r.score?.estimate.note ?? '' },
    { key: 'vs_est', label: 'vs estimate /ac', value: (r) => r1(r.score?.vsEstimate?.diff) },
    { key: 'vs_est_pct', label: 'vs estimate %', value: (r) => r0(r.score?.vsEstimate?.pct) },
    { key: 'goal', label: 'Goal /ac', value: (r) => r1(r.score?.goal.value) },
    { key: 'goal_from', label: 'Goal from', value: (r) => (r.score?.goal.source === 'field' ? 'field' : r.score?.goal.source === 'crop' ? 'crop default' : '') },
    { key: 'vs_goal', label: 'vs goal /ac', value: (r) => r1(r.score?.vsGoal?.diff) },
    { key: 'vs_goal_pct', label: 'vs goal %', value: (r) => r0(r.score?.vsGoal?.pct) },
  ]
}
